/* ============================================================
AO-01/15 — NY-BASELINE | BLOCK 1/5 | FIL: UI/freezer-store.js
+ AO-02/15 — Statuspanel + Read-only UX + felkoder | BLOCK 1/3
+ AO-03/15 — Users CRUD + rättigheter (Admin) | BLOCK 1/4
AUTOPATCH (hel fil)
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- Store + storage-guards + demo-init + status/readOnly + local adapter
- AO-02: Status OK/TOM/KORRUPT + felkoder + debug
- AO-03: Users CRUD (förnamn unikt + perms + audit + active/inactive)
  - RBAC: endast ADMIN med users_manage får CRUD
  - Inaktiva users syns i listan men får inte vara aktiv user
  - Inga nya storage-keys (fortsätter AO-FREEZER_V1)

DoD:
- Tom storage -> demo-data skapas
- Korrupt storage -> fail-closed (LOCKED) och inga writes till storage
- SYSTEM_ADMIN -> read-only
============================================================ */

/* -----------------------------
  CONFIG
----------------------------- */
const FRZ_STORAGE_KEY = "AO-FREEZER_V1";
const FRZ_SCHEMA_VERSION = 1;

const FRZ_ROLES = /** @type {const} */ (["ADMIN", "BUYER", "PICKER", "SYSTEM_ADMIN"]);
function isValidRole(v) { return FRZ_ROLES.includes(v); }

/* -----------------------------
  STATUS + ERROR CODES (AO-02)
----------------------------- */
const FRZ_STATUS = /** @type {const} */ (["OK", "TOM", "KORRUPT"]);
const FRZ_ERR = /** @type {const} */ ({
  NONE: "FRZ_E_NONE",
  NOT_INIT: "FRZ_E_NOT_INIT",
  CORRUPT_JSON: "FRZ_E_CORRUPT_JSON",
  INVALID_ROOT: "FRZ_E_INVALID_ROOT",
  INVALID_SCHEMA: "FRZ_E_INVALID_SCHEMA",
  INVALID_ROLE: "FRZ_E_INVALID_ROLE",
  INVALID_SHAPE: "FRZ_E_INVALID_SHAPE",
  STORAGE_WRITE_BLOCKED: "FRZ_E_STORAGE_WRITE_BLOCKED",

  // AO-03 (users)
  USER_NAME_NOT_UNIQUE: "FRZ_E_USER_NAME_NOT_UNIQUE",
  USER_INVALID: "FRZ_E_USER_INVALID",
  USER_INACTIVE: "FRZ_E_USER_INACTIVE",
  FORBIDDEN: "FRZ_E_FORBIDDEN"
});

/* -----------------------------
  PERMISSIONS (AO-03)
----------------------------- */
const FRZ_PERMS = /** @type {const} */ ([
  "users_manage",
  "inventory_write",
  "history_write",
  "dashboard_view"
]);

function isValidPermKey(k) { return FRZ_PERMS.includes(k); }

/* -----------------------------
  LOCAL STORAGE ADAPTER
----------------------------- */
const StorageAdapter = {
  getRaw() {
    try { return window.localStorage.getItem(FRZ_STORAGE_KEY); }
    catch { return null; }
  },
  setRaw(raw) {
    // NOTE: may throw if storage is blocked/quota
    window.localStorage.setItem(FRZ_STORAGE_KEY, raw);
  },
  remove() {
    window.localStorage.removeItem(FRZ_STORAGE_KEY);
  }
};

/* -----------------------------
  STATE (in-memory)
----------------------------- */
let _state = null;
let _subscribers = [];
let _lastLoadError = null;

// AO-02: boot facts for status (OK/TOM/KORRUPT)
let _boot = {
  rawWasEmpty: true,
  demoCreated: false,
  loadErrorCode: FRZ_ERR.NONE
};

/* -----------------------------
  PUBLIC API
----------------------------- */
const FreezerStore = {
  init,
  getState,
  getStatus,
  subscribe,
  setRole,
  resetDemo,
  trySave,

  // AO-03: Users CRUD + RBAC helpers
  can,
  listUsers,
  createUser,
  updateUser,
  setUserActive
};

// Expose globally (UI-only baseline)
window.FreezerStore = FreezerStore;

/* -----------------------------
  INIT / LOAD
----------------------------- */
function init(opts = {}) {
  const role = isValidRole(opts.role) ? opts.role : "ADMIN";

  // Reset boot markers each init
  _boot = { rawWasEmpty: true, demoCreated: false, loadErrorCode: FRZ_ERR.NONE };
  _lastLoadError = null;

  const loadRes = loadFromStorage();
  _boot.rawWasEmpty = !!loadRes.rawWasEmpty;
  _boot.loadErrorCode = loadRes.errorCode || FRZ_ERR.NONE;

  if (!loadRes.ok) {
    // fail-closed: lock in memory, DO NOT write anything back
    _state = createLockedState(
      role,
      loadRes.reason || "Korrupt eller ogiltig lagring.",
      loadRes.errorCode || FRZ_ERR.CORRUPT_JSON
    );
    notify();
    return getStatus();
  }

  _state = loadRes.state;

  // Ensure role + readonly aligned
  _state.user.role = role;
  _state.flags.readOnly = computeReadOnly(role);

  // AO-03: ensure users exist and activeUserId is valid
  ensureUsersBaseline();

  // If empty -> init demo (only if not locked)
  if (isEmptyDataset(_state) && !_state.flags.locked) {
    const demo = createDemoState(role);

    // Keep any existing users if already present (but demo normally starts fresh)
    demo.data.users = _state.data && Array.isArray(_state.data.users) && _state.data.users.length
      ? _state.data.users
      : demo.data.users;

    // Align active user with role
    demo.user.activeUserId = pickActiveUserForRole(role, demo.data.users);

    // Try to write demo; if write fails -> lock
    const w = safeWriteToStorage(demo);
    if (!w.ok) {
      _state = createLockedState(
        role,
        w.reason || "Kunde inte skriva demo-data till lagring.",
        w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED
      );
    } else {
      _boot.demoCreated = true;
      _state = demo;
    }
  } else {
    // Align active user with role if current active user is missing/inactive
    const picked = pickActiveUserForRole(role, _state.data.users);
    _state.user.activeUserId = picked;
  }

  notify();
  return getStatus();
}

function loadFromStorage() {
  const raw = StorageAdapter.getRaw();
  const rawWasEmpty = (!raw || raw.trim() === "");

  if (rawWasEmpty) {
    return { ok: true, state: createEmptyState("ADMIN"), rawWasEmpty: true, errorCode: FRZ_ERR.NONE };
  }

  try {
    const parsed = JSON.parse(raw);
    const validated = validateAndNormalize(parsed);
    if (!validated.ok) {
      return {
        ok: false,
        reason: validated.reason,
        rawWasEmpty: false,
        errorCode: validated.errorCode || FRZ_ERR.INVALID_SHAPE
      };
    }
    return { ok: true, state: validated.state, rawWasEmpty: false, errorCode: FRZ_ERR.NONE };
  } catch (e) {
    _lastLoadError = String(e && e.message ? e.message : e);
    return {
      ok: false,
      reason: "JSON-parse misslyckades (korrupt data).",
      rawWasEmpty: false,
      errorCode: FRZ_ERR.CORRUPT_JSON
    };
  }
}

/* -----------------------------
  STATE HELPERS
----------------------------- */
function getState() {
  // Defensive copy; caller should treat as read-only
  return _state ? JSON.parse(JSON.stringify(_state)) : null;
}

function getStatus() {
  // AO-02: stable status object for UI banner/debug
  if (!_state) {
    return {
      ok: false,
      status: "KORRUPT",
      errorCode: FRZ_ERR.NOT_INIT,
      locked: true,
      readOnly: true,
      role: "ADMIN",
      reason: "Ej initierad.",
      whyReadOnly: "Store ej initierad.",
      debug: {
        storageKey: FRZ_STORAGE_KEY,
        schemaVersion: FRZ_SCHEMA_VERSION,
        rawWasEmpty: null,
        demoCreated: null,
        lastLoadError: _lastLoadError || null
      }
    };
  }

  const locked = !!_state.flags.locked;
  const readOnly = !!_state.flags.readOnly;

  // Status: KORRUPT om locked, annars TOM om tom data (och inte demo), annars OK
  let status = "OK";
  if (locked) status = "KORRUPT";
  else if (isEmptyDataset(_state) && !_boot.demoCreated) status = "TOM";

  const role = _state.user.role;

  // whyReadOnly (för UI)
  let whyReadOnly = null;
  if (locked) whyReadOnly = "Låst läge (korrupt/ogiltig lagring).";
  else if (readOnly && role === "SYSTEM_ADMIN") whyReadOnly = "SYSTEM_ADMIN är read-only enligt policy.";
  else if (readOnly) whyReadOnly = "Read-only är aktivt.";

  const errCode = locked
    ? (_state.flags.lockCode || _boot.loadErrorCode || FRZ_ERR.INVALID_SHAPE)
    : FRZ_ERR.NONE;

  const reason = locked ? (_state.flags.lockReason || "Låst läge.") : null;

  return {
    ok: !locked,
    status,
    errorCode: errCode,
    locked,
    readOnly,
    role,
    reason,
    whyReadOnly,
    lastLoadError: _lastLoadError || null,
    debug: {
      storageKey: FRZ_STORAGE_KEY,
      schemaVersion: FRZ_SCHEMA_VERSION,
      rawWasEmpty: !!_boot.rawWasEmpty,
      demoCreated: !!_boot.demoCreated,
      lastLoadError: _lastLoadError || null
    }
  };
}

function subscribe(fn) {
  if (typeof fn !== "function") return () => {};
  _subscribers.push(fn);
  // call immediately with current state
  try { fn(getState()); } catch {}
  return () => {
    _subscribers = _subscribers.filter(x => x !== fn);
  };
}

function notify() {
  const snapshot = getState();
  _subscribers.forEach(fn => {
    try { fn(snapshot); } catch {}
  });
}

function setRole(role) {
  if (!_state) return getStatus();
  if (!isValidRole(role)) return getStatus();

  _state.user.role = role;
  _state.flags.readOnly = computeReadOnly(role);

  // AO-03: never leave activeUserId pointing to inactive/missing user
  ensureUsersBaseline();
  _state.user.activeUserId = pickActiveUserForRole(role, _state.data.users);

  // Role change is allowed even in locked mode (in-memory only).
  // But we do not write to storage if locked/readOnly.
  trySave();
  notify();
  return getStatus();
}

function resetDemo() {
  if (!_state) return { ok: false, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, reason: "Låst läge: kan inte återställa." };
  if (_state.flags.readOnly) return { ok: false, reason: "Read-only: kan inte återställa." };

  const demo = createDemoState(_state.user.role);

  const w = safeWriteToStorage(demo);
  if (!w.ok) {
    _state = createLockedState(
      _state.user.role,
      w.reason || "Kunde inte skriva demo-data.",
      w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED
    );
    notify();
    return { ok: false, reason: _state.flags.lockReason };
  }

  _boot.demoCreated = true;
  _state = demo;
  notify();
  return { ok: true };
}

/**
 * Attempt to persist current in-memory state, respecting fail-closed + read-only.
 * Returns status object.
 */
function trySave() {
  if (!_state) return { ok: false, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, reason: "Låst läge." };
  if (_state.flags.readOnly) return { ok: false, reason: "Read-only." };

  // Update meta
  _state.meta.updatedAt = new Date().toISOString();

  const w = safeWriteToStorage(_state);
  if (!w.ok) {
    _state = createLockedState(
      _state.user.role,
      w.reason || "Lagring misslyckades.",
      w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED
    );
    notify();
    return { ok: false, reason: _state.flags.lockReason };
  }
  return { ok: true };
}

function safeWriteToStorage(stateObj) {
  try {
    const raw = JSON.stringify(stateObj);
    StorageAdapter.setRaw(raw);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: "localStorage write misslyckades (blockerad/quota/privat läge).",
      errorCode: FRZ_ERR.STORAGE_WRITE_BLOCKED
    };
  }
}

/* -----------------------------
  AO-03: RBAC + USERS CRUD
----------------------------- */
function can(permKey) {
  if (!_state) return false;
  if (!isValidPermKey(permKey)) return false;
  if (_state.flags.locked) return false;
  if (_state.flags.readOnly) return false;

  const u = getActiveUser();
  if (!u || !u.active) return false;
  return !!(u.perms && u.perms[permKey]);
}

function listUsers() {
  if (!_state || !_state.data || !Array.isArray(_state.data.users)) return [];
  // Return a safe copy
  return JSON.parse(JSON.stringify(_state.data.users));
}

function createUser(input) {
  if (!_state) return { ok: false, errorCode: FRZ_ERR.NOT_INIT, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Låst läge." };
  if (_state.flags.readOnly) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Read-only." };
  if (!can("users_manage")) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Saknar behörighet (users_manage)." };

  ensureUsersBaseline();

  const firstName = safeUserName(input && input.firstName);
  if (!firstName) return { ok: false, errorCode: FRZ_ERR.USER_INVALID, reason: "Förnamn krävs." };

  if (!isUserNameUnique(firstName, null)) {
    return { ok: false, errorCode: FRZ_ERR.USER_NAME_NOT_UNIQUE, reason: "Förnamn måste vara unikt." };
  }

  const now = new Date().toISOString();
  const id = makeId("u");
  const createdBy = getAuditActor();

  const user = {
    id,
    firstName,
    active: true,
    perms: normalizePerms(input && input.perms),
    audit: {
      createdAt: now,
      updatedAt: now,
      createdBy,
      updatedBy: createdBy
    }
  };

  _state.data.users.push(user);

  // Audit/history (non-sensitive)
  pushHistory("users_create", "", 0, createdBy, `User skapad: ${firstName}`);

  const s = trySave();
  notify();
  if (!s.ok) return { ok: false, errorCode: FRZ_ERR.STORAGE_WRITE_BLOCKED, reason: s.reason || "Kunde inte spara." };
  return { ok: true, id };
}

function updateUser(userId, patch) {
  if (!_state) return { ok: false, errorCode: FRZ_ERR.NOT_INIT, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Låst läge." };
  if (_state.flags.readOnly) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Read-only." };
  if (!can("users_manage")) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Saknar behörighet (users_manage)." };

  ensureUsersBaseline();

  const u = _state.data.users.find(x => x && x.id === userId);
  if (!u) return { ok: false, errorCode: FRZ_ERR.USER_INVALID, reason: "User hittades inte." };

  const nextName = safeUserName(patch && patch.firstName);
  if (!nextName) return { ok: false, errorCode: FRZ_ERR.USER_INVALID, reason: "Förnamn krävs." };

  if (!isUserNameUnique(nextName, userId)) {
    return { ok: false, errorCode: FRZ_ERR.USER_NAME_NOT_UNIQUE, reason: "Förnamn måste vara unikt." };
  }

  const now = new Date().toISOString();
  const actor = getAuditActor();

  const nameChanged = (String(u.firstName || "") !== nextName);

  u.firstName = nextName;
  u.perms = normalizePerms(patch && patch.perms);
  u.audit = u.audit && typeof u.audit === "object" ? u.audit : {};
  u.audit.updatedAt = now;
  u.audit.updatedBy = actor;

  if (nameChanged) {
    pushHistory("users_update", "", 0, actor, `User uppdaterad: ${nextName}`);
  } else {
    pushHistory("users_update", "", 0, actor, `Behörigheter uppdaterade: ${nextName}`);
  }

  const s = trySave();
  notify();
  if (!s.ok) return { ok: false, errorCode: FRZ_ERR.STORAGE_WRITE_BLOCKED, reason: s.reason || "Kunde inte spara." };
  return { ok: true };
}

function setUserActive(userId, active) {
  if (!_state) return { ok: false, errorCode: FRZ_ERR.NOT_INIT, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Låst läge." };
  if (_state.flags.readOnly) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Read-only." };
  if (!can("users_manage")) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Saknar behörighet (users_manage)." };

  ensureUsersBaseline();

  const u = _state.data.users.find(x => x && x.id === userId);
  if (!u) return { ok: false, errorCode: FRZ_ERR.USER_INVALID, reason: "User hittades inte." };

  const next = !!active;

  // Fail-closed: allow deactivating anyone, but never leave system with 0 active users
  if (!next) {
    const activeCount = _state.data.users.filter(x => x && x.active).length;
    if (activeCount <= 1 && u.active) {
      return { ok: false, errorCode: FRZ_ERR.USER_INVALID, reason: "Minst en aktiv användare krävs." };
    }
  }

  const now = new Date().toISOString();
  const actor = getAuditActor();

  u.active = next;
  u.audit = u.audit && typeof u.audit === "object" ? u.audit : {};
  u.audit.updatedAt = now;
  u.audit.updatedBy = actor;

  pushHistory("users_toggle", "", 0, actor, `${u.firstName} är nu ${next ? "aktiv" : "inaktiv"}.`);

  // If we inactivated the currently active user -> fallback to a valid active user for role
  if (!u.active && _state.user && _state.user.activeUserId === u.id) {
    _state.user.activeUserId = pickActiveUserForRole(_state.user.role, _state.data.users);
  }

  const s = trySave();
  notify();
  if (!s.ok) return { ok: false, errorCode: FRZ_ERR.STORAGE_WRITE_BLOCKED, reason: s.reason || "Kunde inte spara." };
  return { ok: true };
}

/* -----------------------------
  USERS HELPERS (AO-03)
----------------------------- */
function ensureUsersBaseline() {
  if (!_state || !_state.data) return;
  if (!Array.isArray(_state.data.users)) _state.data.users = [];

  // If storage existed but had no users -> create minimal baseline users (safe/back-compat)
  if (_state.data.users.length === 0) {
    _state.data.users = createDefaultUsers();
  } else {
    // Normalize each user entry defensively
    _state.data.users = _state.data.users.map(normalizeUser).filter(Boolean);
    if (_state.data.users.length === 0) _state.data.users = createDefaultUsers();
  }

  // Ensure there is at least one active user
  if (!_state.data.users.some(u => u && u.active)) {
    // force-activate first user (fail-closed but recoverable)
    _state.data.users[0].active = true;
  }

  // Ensure activeUserId exists and points to an active user
  const picked = pickActiveUserForRole(_state.user.role, _state.data.users);
  _state.user.activeUserId = picked;
}

function getActiveUser() {
  try {
    if (!_state || !_state.data || !Array.isArray(_state.data.users)) return null;
    const id = _state.user && _state.user.activeUserId ? _state.user.activeUserId : "";
    const u = _state.data.users.find(x => x && x.id === id) || null;
    if (!u || !u.active) return null;
    return u;
  } catch {
    return null;
  }
}

function pickActiveUserForRole(role, users) {
  const list = Array.isArray(users) ? users : [];
  // Preferred mapping by roleKey on user (if present)
  const byRole = list.find(u => u && u.active && u.roleKey === role);
  if (byRole && byRole.id) return byRole.id;

  // Fallback: first active ADMIN-mapped user if role is ADMIN
  if (role === "ADMIN") {
    const admin = list.find(u => u && u.active && (u.roleKey === "ADMIN" || String(u.firstName || "").toLowerCase() === "admin"));
    if (admin && admin.id) return admin.id;
  }

  // Fallback: any active user
  const any = list.find(u => u && u.active);
  return any && any.id ? any.id : "";
}

function isUserNameUnique(firstName, excludeId) {
  const nameKey = normNameKey(firstName);
  const users = _state && _state.data && Array.isArray(_state.data.users) ? _state.data.users : [];
  return !users.some(u => {
    if (!u || !u.firstName) return false;
    if (excludeId && u.id === excludeId) return false;
    return normNameKey(u.firstName) === nameKey;
  });
}

function normNameKey(s) {
  return String(s || "")
    .trim()
    .toLocaleLowerCase("sv-SE");
}

function safeUserName(v) {
  const s = safeStr(v);
  if (!s) return "";
  // Keep simple (UI-only): allow letters, space, dash, apostrophe
  const cleaned = s.replace(/[^A-Za-zÀ-ÖØ-öø-ÿÅÄÖåäö '\-]/g, "").trim();
  if (!cleaned) return "";
  return cleaned.slice(0, 32);
}

function normalizePerms(perms) {
  const out = { users_manage: false, inventory_write: false, history_write: false, dashboard_view: true };
  const p = perms && typeof perms === "object" ? perms : {};
  FRZ_PERMS.forEach(k => {
    if (k === "dashboard_view") out[k] = ("dashboard_view" in p) ? !!p[k] : true;
    else out[k] = !!p[k];
  });
  return out;
}

function normalizeUser(u) {
  if (!u || typeof u !== "object") return null;
  const id = safeStr(u.id) || makeId("u");
  const firstName = safeUserName(u.firstName);
  if (!firstName) return null;

  const active = ("active" in u) ? !!u.active : true;

  const auditIn = u.audit && typeof u.audit === "object" ? u.audit : {};
  const now = new Date().toISOString();

  return {
    id,
    firstName,
    active,
    // Optional internal mapping helper
    roleKey: isValidRole(u.roleKey) ? u.roleKey : (isValidRole(u.role) ? u.role : (safeStr(u.roleKey) || "")),
    perms: normalizePerms(u.perms),
    audit: {
      createdAt: typeof auditIn.createdAt === "string" ? auditIn.createdAt : now,
      updatedAt: typeof auditIn.updatedAt === "string" ? auditIn.updatedAt : now,
      createdBy: safeStr(auditIn.createdBy) || "",
      updatedBy: safeStr(auditIn.updatedBy) || ""
    }
  };
}

function createDefaultUsers() {
  const now = new Date().toISOString();
  return [
    {
      id: makeId("u"),
      firstName: "Admin",
      active: true,
      roleKey: "ADMIN",
      perms: { users_manage: true, inventory_write: true, history_write: true, dashboard_view: true },
      audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
    },
    {
      id: makeId("u"),
      firstName: "Inköp",
      active: true,
      roleKey: "BUYER",
      perms: { users_manage: false, inventory_write: true, history_write: false, dashboard_view: true },
      audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
    },
    {
      id: makeId("u"),
      firstName: "Plock",
      active: true,
      roleKey: "PICKER",
      perms: { users_manage: false, inventory_write: true, history_write: true, dashboard_view: true },
      audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
    },
    {
      id: makeId("u"),
      firstName: "System",
      active: true,
      roleKey: "SYSTEM_ADMIN",
      perms: { users_manage: false, inventory_write: false, history_write: false, dashboard_view: true },
      audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
    }
  ];
}

function getAuditActor() {
  // Non-sensitive: role + active user name
  try {
    const role = _state && _state.user ? _state.user.role : "ADMIN";
    const u = getActiveUser();
    const who = u && u.firstName ? u.firstName : role;
    return `${who}`;
  } catch {
    return "system";
  }
}

function pushHistory(type, sku, qty, by, note) {
  try {
    if (!_state || !_state.data || !Array.isArray(_state.data.history)) return;
    _state.data.history.push({
      ts: new Date().toISOString(),
      type: safeStr(type) || "note",
      sku: safeStr(sku) || "",
      qty: safeNum(qty, 0),
      by: safeStr(by) || "",
      note: safeStr(note) || ""
    });
  } catch {}
}

/* -----------------------------
  VALIDATION / NORMALIZATION
----------------------------- */
function validateAndNormalize(obj) {
  // Strict-ish validation to detect corruption
  if (!obj || typeof obj !== "object") return { ok: false, reason: "Ogiltig root.", errorCode: FRZ_ERR.INVALID_ROOT };

  const meta = obj.meta;
  const user = obj.user;
  const data = obj.data;
  const flags = obj.flags;

  if (!meta || typeof meta !== "object") return { ok: false, reason: "Saknar meta.", errorCode: FRZ_ERR.INVALID_SHAPE };
  if (meta.schemaVersion !== FRZ_SCHEMA_VERSION) return { ok: false, reason: "Fel schemaVersion.", errorCode: FRZ_ERR.INVALID_SCHEMA };

  if (!user || typeof user !== "object") return { ok: false, reason: "Saknar user.", errorCode: FRZ_ERR.INVALID_SHAPE };
  const role = user.role;
  if (!isValidRole(role)) return { ok: false, reason: "Ogiltig roll i lagring.", errorCode: FRZ_ERR.INVALID_ROLE };

  if (!data || typeof data !== "object") return { ok: false, reason: "Saknar data.", errorCode: FRZ_ERR.INVALID_SHAPE };
  if (!Array.isArray(data.items)) return { ok: false, reason: "items måste vara array.", errorCode: FRZ_ERR.INVALID_SHAPE };
  if (!Array.isArray(data.history)) return { ok: false, reason: "history måste vara array.", errorCode: FRZ_ERR.INVALID_SHAPE };

  // flags may be missing -> normalize (back-compat + AO-02 lockCode)
  const norm = {
    meta: {
      schemaVersion: FRZ_SCHEMA_VERSION,
      createdAt: typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString(),
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : new Date().toISOString()
    },
    user: {
      role,
      // AO-03: back-compat: may be missing
      activeUserId: (user && typeof user.activeUserId === "string") ? user.activeUserId : ""
    },
    flags: {
      locked: !!(flags && flags.locked),
      lockReason: (flags && typeof flags.lockReason === "string") ? flags.lockReason : "",
      lockCode: (flags && typeof flags.lockCode === "string") ? flags.lockCode : "",
      readOnly: computeReadOnly(role)
    },
    data: {
      items: data.items.map(normalizeItem).filter(Boolean),
      history: data.history.map(normalizeHistory).filter(Boolean),

      // AO-03: users array (optional back-compat)
      users: Array.isArray(data.users) ? data.users.map(normalizeUser).filter(Boolean) : []
    }
  };

  // If storage says locked, keep it locked
  if (norm.flags.locked) {
    norm.flags.readOnly = true;
    if (!norm.flags.lockCode) norm.flags.lockCode = FRZ_ERR.INVALID_SHAPE;
  }

  // AO-03: ensure users exist even for older saves
  if (!Array.isArray(norm.data.users) || norm.data.users.length === 0) {
    norm.data.users = createDefaultUsers();
  }

  // Ensure activeUserId points to active user
  norm.user.activeUserId = pickActiveUserForRole(norm.user.role, norm.data.users);

  return { ok: true, state: norm, errorCode: FRZ_ERR.NONE };
}

function normalizeItem(it) {
  if (!it || typeof it !== "object") return null;
  const sku = safeStr(it.sku);
  const name = safeStr(it.name);
  if (!sku || !name) return null;

  const unit = safeStr(it.unit) || "st";
  const onHand = safeNum(it.onHand, 0);
  const min = safeNum(it.min, 0);
  const updatedAt = typeof it.updatedAt === "string" ? it.updatedAt : new Date().toISOString();

  return { sku, name, unit, onHand, min, updatedAt };
}

function normalizeHistory(h) {
  if (!h || typeof h !== "object") return null;
  const ts = typeof h.ts === "string" ? h.ts : new Date().toISOString();
  const type = safeStr(h.type) || "note";
  const sku = safeStr(h.sku) || "";
  const qty = safeNum(h.qty, 0);
  const by = safeStr(h.by) || "";
  const note = safeStr(h.note) || "";

  return { ts, type, sku, qty, by, note };
}

/* -----------------------------
  DEFAULT STATES
----------------------------- */
function createEmptyState(role) {
  const r = isValidRole(role) ? role : "ADMIN";
  const state = {
    meta: {
      schemaVersion: FRZ_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    user: {
      role: r,
      activeUserId: ""
    },
    flags: {
      locked: false,
      lockReason: "",
      lockCode: "",
      readOnly: computeReadOnly(r)
    },
    data: {
      items: [],
      history: [],
      users: createDefaultUsers()
    }
  };

  state.user.activeUserId = pickActiveUserForRole(r, state.data.users);
  return state;
}

function createDemoState(role) {
  const now = new Date().toISOString();
  const r = isValidRole(role) ? role : "ADMIN";
  const state = createEmptyState(r);

  state.data.items = [
    { sku: "FZ-001", name: "Kycklingfilé 2kg", unit: "fp", onHand: 12, min: 6, updatedAt: now },
    { sku: "FZ-002", name: "Laxportion 150g", unit: "st", onHand: 48, min: 30, updatedAt: now },
    { sku: "FZ-003", name: "Grönsaksblandning 1kg", unit: "fp", onHand: 20, min: 10, updatedAt: now }
  ];

  state.data.history = [
    { ts: now, type: "init_demo", sku: "", qty: 0, by: r, note: "Demo-data skapad." }
  ];

  // Users baseline already exists from createEmptyState
  state.user.activeUserId = pickActiveUserForRole(r, state.data.users);

  return state;
}

function createLockedState(role, reason, code) {
  const r = isValidRole(role) ? role : "ADMIN";
  return {
    meta: {
      schemaVersion: FRZ_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    user: {
      role: r,
      activeUserId: "" // keep empty; locked anyway
    },
    flags: {
      locked: true,
      lockReason: safeStr(reason) || "Låst läge.",
      lockCode: safeStr(code) || FRZ_ERR.INVALID_SHAPE,
      readOnly: true
    },
    data: {
      items: [],
      history: [],
      // keep users for UI visibility, but no writes allowed anyway
      users: createDefaultUsers()
    }
  };
}

/* -----------------------------
  UTILS
----------------------------- */
function computeReadOnly(role) {
  return role === "SYSTEM_ADMIN";
}

function isEmptyDataset(state) {
  return !!state && state.data && Array.isArray(state.data.items) && state.data.items.length === 0;
}

function safeStr(v) {
  if (typeof v !== "string") return "";
  return v.trim();
}

function safeNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function makeId(prefix) {
  // UI-only id: stable-enough (not crypto)
  const a = Math.random().toString(16).slice(2);
  const b = Date.now().toString(16);
  return `${prefix}_${b}_${a}`;
}
