/* ============================================================
AO-02/15 — Statuspanel + Read-only UX + felkoder | BLOCK 1/3
+ AO-03/15 — Users CRUD + rättigheter (Admin) | STORE-DEL (för att UI ska funka)
AUTOPATCH | FIL: UI/freezer-store.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
AO-02:
- Status: OK / TOM / KORRUPT + felorsak
- Read-only: tydlig “varför”
- Debug (ej känsligt): storageKey + schemaVersion
- Felkoder (stabila)
- Korrupt storage => fail-closed (LOCKED) + KORRUPT-status

AO-03 (för att Admin ska kunna skapa/redigera users):
- Users shape: förnamn unikt + perms + audit + active
- Users CRUD: create/update/activate/deactivate (endast om can('users_manage'))
- can(perm): baseras på aktiv user (kopplad till roll) + fail-closed
- Inaktiva users kan inte väljas (setActiveUser fail-closed)
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

  // AO-03 users
  USER_NAME_NOT_UNIQUE: "FRZ_E_USER_NAME_NOT_UNIQUE",
  USER_NOT_FOUND: "FRZ_E_USER_NOT_FOUND",
  USER_INACTIVE: "FRZ_E_USER_INACTIVE",
  FORBIDDEN: "FRZ_E_FORBIDDEN"
});

/* -----------------------------
  LOCAL STORAGE ADAPTER
----------------------------- */
const StorageAdapter = {
  getRaw() {
    try { return window.localStorage.getItem(FRZ_STORAGE_KEY); }
    catch { return null; }
  },
  setRaw(raw) {
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

  // AO-03 users
  can,
  listUsers,
  getActiveUser,
  setActiveUser,
  createUser,
  updateUser,
  setUserActive
};

window.FreezerStore = FreezerStore;

/* -----------------------------
  INIT / LOAD
----------------------------- */
function init(opts = {}) {
  const role = isValidRole(opts.role) ? opts.role : "ADMIN";

  _boot = { rawWasEmpty: true, demoCreated: false, loadErrorCode: FRZ_ERR.NONE };
  _lastLoadError = null;

  const loadRes = loadFromStorage();
  _boot.rawWasEmpty = !!loadRes.rawWasEmpty;
  _boot.loadErrorCode = loadRes.errorCode || FRZ_ERR.NONE;

  if (!loadRes.ok) {
    _state = createLockedState(role, loadRes.reason || "Korrupt eller ogiltig lagring.", loadRes.errorCode || FRZ_ERR.CORRUPT_JSON);
    notify();
    return getStatus();
  }

  _state = loadRes.state;

  // Ensure role + readonly aligned
  _state.user.role = role;
  _state.flags.readOnly = computeReadOnly(role);

  // Empty -> demo
  if (isEmptyDataset(_state) && !_state.flags.locked) {
    const demo = createDemoState(role);
    const w = safeWriteToStorage(demo);
    if (!w.ok) {
      _state = createLockedState(role, w.reason || "Kunde inte skriva demo-data till lagring.", w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED);
    } else {
      _boot.demoCreated = true;
      _state = demo;
    }
  }

  // AO-03: Ensure users exist (back-compat if old storage saknar users)
  ensureUsersBaseline();

  // AO-03: Align active user with role (fail-closed if inactive/missing)
  alignActiveUserToRole();

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
    if (!validated.ok) return { ok: false, reason: validated.reason, rawWasEmpty: false, errorCode: validated.errorCode || FRZ_ERR.INVALID_SHAPE };
    return { ok: true, state: validated.state, rawWasEmpty: false, errorCode: FRZ_ERR.NONE };
  } catch (e) {
    _lastLoadError = String(e && e.message ? e.message : e);
    return { ok: false, reason: "JSON-parse misslyckades (korrupt data).", rawWasEmpty: false, errorCode: FRZ_ERR.CORRUPT_JSON };
  }
}

/* -----------------------------
  STATUS / SUBSCRIBE
----------------------------- */
function getState() {
  return _state ? JSON.parse(JSON.stringify(_state)) : null;
}

function getStatus() {
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

  let status = "OK";
  if (locked) status = "KORRUPT";
  else if (isEmptyDataset(_state) && !_boot.demoCreated) status = "TOM";

  const role = _state.user.role;

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
  try { fn(getState()); } catch {}
  return () => { _subscribers = _subscribers.filter(x => x !== fn); };
}

function notify() {
  const snapshot = getState();
  _subscribers.forEach(fn => { try { fn(snapshot); } catch {} });
}

/* -----------------------------
  ROLE / RESET / SAVE
----------------------------- */
function setRole(role) {
  if (!_state) return getStatus();
  if (!isValidRole(role)) return getStatus();

  _state.user.role = role;
  _state.flags.readOnly = computeReadOnly(role);

  // AO-03: align active user to new role (even if locked/readOnly: in-memory only)
  alignActiveUserToRole();

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
    _state = createLockedState(_state.user.role, w.reason || "Kunde inte skriva demo-data.", w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED);
    notify();
    return { ok: false, reason: _state.flags.lockReason };
  }

  _boot.demoCreated = true;
  _state = demo;

  // AO-03: ensure + align (fresh demo)
  ensureUsersBaseline();
  alignActiveUserToRole();

  notify();
  return { ok: true };
}

function trySave() {
  if (!_state) return { ok: false, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, reason: "Låst läge." };
  if (_state.flags.readOnly) return { ok: false, reason: "Read-only." };

  _state.meta.updatedAt = new Date().toISOString();

  const w = safeWriteToStorage(_state);
  if (!w.ok) {
    _state = createLockedState(_state.user.role, w.reason || "Lagring misslyckades.", w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED);
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
    return { ok: false, reason: "localStorage write misslyckades (blockerad/quota/privat läge).", errorCode: FRZ_ERR.STORAGE_WRITE_BLOCKED };
  }
}

/* -----------------------------
  AO-03: PERMISSIONS + USERS
----------------------------- */
function can(perm) {
  // Fail-closed
  if (!_state) return false;
  if (_state.flags.locked) return false;

  const role = _state.user.role;
  if (role === "SYSTEM_ADMIN") return false;

  // Always allow admin baseline to manage users (but still via perms on active user)
  const au = getActiveUser();
  if (!au || !au.active) return false;

  const perms = au.perms || {};
  return !!perms[perm];
}

function listUsers() {
  if (!_state || !_state.data) return [];
  const users = Array.isArray(_state.data.users) ? _state.data.users : [];
  return users.map(u => JSON.parse(JSON.stringify(u)));
}

function getActiveUser() {
  if (!_state || !_state.data) return null;
  const users = Array.isArray(_state.data.users) ? _state.data.users : [];
  const id = _state.user.activeUserId || "";
  const u = users.find(x => x && x.id === id) || null;
  return u ? JSON.parse(JSON.stringify(u)) : null;
}

function setActiveUser(userId) {
  if (!_state) return { ok: false, reason: "Ej initierad.", errorCode: FRZ_ERR.NOT_INIT };
  if (_state.flags.locked) return { ok: false, reason: "Låst läge.", errorCode: _state.flags.lockCode || FRZ_ERR.INVALID_SHAPE };

  const users = Array.isArray(_state.data.users) ? _state.data.users : [];
  const u = users.find(x => x && x.id === userId) || null;
  if (!u) return { ok: false, reason: "User hittades inte.", errorCode: FRZ_ERR.USER_NOT_FOUND };
  if (!u.active) return { ok: false, reason: "User är inaktiv.", errorCode: FRZ_ERR.USER_INACTIVE };

  _state.user.activeUserId = u.id;

  // Save only if allowed
  const s = trySave();
  notify();
  return { ok: true, status: s };
}

function createUser({ firstName, perms }) {
  if (!_state) return { ok: false, reason: "Ej initierad.", errorCode: FRZ_ERR.NOT_INIT };
  const status = getStatus();
  if (status.locked) return { ok: false, reason: "Låst läge.", errorCode: status.errorCode };
  if (status.readOnly) return { ok: false, reason: status.whyReadOnly || "Read-only.", errorCode: FRZ_ERR.FORBIDDEN };
  if (!can("users_manage")) return { ok: false, reason: "Saknar behörighet (users_manage).", errorCode: FRZ_ERR.FORBIDDEN };

  const name = normalizeFirstName(firstName);
  if (!name) return { ok: false, reason: "Förnamn krävs.", errorCode: FRZ_ERR.INVALID_SHAPE };

  const users = ensureUsersArray();
  if (!isFirstNameUnique(users, name, null)) {
    return { ok: false, reason: "Förnamn måste vara unikt.", errorCode: FRZ_ERR.USER_NAME_NOT_UNIQUE };
  }

  const now = new Date().toISOString();
  const actor = safeStr((_state.user.role || "")) || "ADMIN";

  const u = {
    id: makeId("u"),
    firstName: name,
    active: true,
    perms: normalizePerms(perms),
    audit: {
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor
    }
  };

  users.push(u);

  const s = trySave();
  notify();
  return { ok: true, id: u.id, status: s };
}

function updateUser(userId, { firstName, perms }) {
  if (!_state) return { ok: false, reason: "Ej initierad.", errorCode: FRZ_ERR.NOT_INIT };
  const status = getStatus();
  if (status.locked) return { ok: false, reason: "Låst läge.", errorCode: status.errorCode };
  if (status.readOnly) return { ok: false, reason: status.whyReadOnly || "Read-only.", errorCode: FRZ_ERR.FORBIDDEN };
  if (!can("users_manage")) return { ok: false, reason: "Saknar behörighet (users_manage).", errorCode: FRZ_ERR.FORBIDDEN };

  const users = ensureUsersArray();
  const idx = users.findIndex(x => x && x.id === userId);
  if (idx < 0) return { ok: false, reason: "User hittades inte.", errorCode: FRZ_ERR.USER_NOT_FOUND };

  const name = normalizeFirstName(firstName);
  if (!name) return { ok: false, reason: "Förnamn krävs.", errorCode: FRZ_ERR.INVALID_SHAPE };

  if (!isFirstNameUnique(users, name, userId)) {
    return { ok: false, reason: "Förnamn måste vara unikt.", errorCode: FRZ_ERR.USER_NAME_NOT_UNIQUE };
  }

  const now = new Date().toISOString();
  const actor = safeStr((_state.user.role || "")) || "ADMIN";

  users[idx].firstName = name;
  users[idx].perms = normalizePerms(perms);
  users[idx].audit = users[idx].audit && typeof users[idx].audit === "object" ? users[idx].audit : {};
  users[idx].audit.updatedAt = now;
  users[idx].audit.updatedBy = actor;

  const s = trySave();
  notify();
  return { ok: true, status: s };
}

function setUserActive(userId, active) {
  if (!_state) return { ok: false, reason: "Ej initierad.", errorCode: FRZ_ERR.NOT_INIT };
  const status = getStatus();
  if (status.locked) return { ok: false, reason: "Låst läge.", errorCode: status.errorCode };
  if (status.readOnly) return { ok: false, reason: status.whyReadOnly || "Read-only.", errorCode: FRZ_ERR.FORBIDDEN };
  if (!can("users_manage")) return { ok: false, reason: "Saknar behörighet (users_manage).", errorCode: FRZ_ERR.FORBIDDEN };

  const users = ensureUsersArray();
  const idx = users.findIndex(x => x && x.id === userId);
  if (idx < 0) return { ok: false, reason: "User hittades inte.", errorCode: FRZ_ERR.USER_NOT_FOUND };

  users[idx].active = !!active;

  const now = new Date().toISOString();
  const actor = safeStr((_state.user.role || "")) || "ADMIN";
  users[idx].audit = users[idx].audit && typeof users[idx].audit === "object" ? users[idx].audit : {};
  users[idx].audit.updatedAt = now;
  users[idx].audit.updatedBy = actor;

  // If we deactivated active user -> fail-closed to admin
  if (!users[idx].active && _state.user.activeUserId === userId) {
    alignActiveUserToRole(true /*forceAdminFallback*/);
  }

  const s = trySave();
  notify();
  return { ok: true, status: s };
}

/* -----------------------------
  AO-03: INTERNAL HELPERS
----------------------------- */
function ensureUsersArray() {
  if (!_state.data) _state.data = {};
  if (!Array.isArray(_state.data.users)) _state.data.users = [];
  return _state.data.users;
}

function ensureUsersBaseline() {
  if (!_state || !_state.data) return;

  const users = ensureUsersArray();

  // If already has at least one user, keep, but ensure each user normalized
  if (users.length > 0) {
    _state.data.users = users.map(normalizeUser).filter(Boolean);
    if (!_state.user.activeUserId) {
      // try pick first active
      const firstActive = _state.data.users.find(u => u && u.active);
      if (firstActive) _state.user.activeUserId = firstActive.id;
    }
    return;
  }

  // Create baseline demo users (active)
  const now = new Date().toISOString();
  const mk = (firstName, perms) => ({
    id: makeId("u"),
    firstName,
    active: true,
    perms: normalizePerms(perms),
    audit: { createdAt: now, createdBy: "SYSTEM", updatedAt: now, updatedBy: "SYSTEM" }
  });

  // IMPORTANT: Admin MUST have users_manage to create/edit users
  const admin = mk("Admin", { users_manage: true, inventory_write: true, history_write: true, dashboard_view: true });
  const buyer = mk("Inköp", { users_manage: false, inventory_write: true, history_write: false, dashboard_view: true });
  const picker = mk("Plock", { users_manage: false, inventory_write: false, history_write: true, dashboard_view: true });

  _state.data.users = [admin, buyer, picker];

  // Default active user aligns with role
  _state.user.activeUserId = admin.id;

  // Try save (only if allowed)
  trySave();
}

function alignActiveUserToRole(forceAdminFallback = false) {
  if (!_state || !_state.data) return;

  const role = _state.user.role;
  const users = Array.isArray(_state.data.users) ? _state.data.users : [];

  // If SYSTEM_ADMIN -> keep activeUserId but can() will always be false anyway
  if (role === "SYSTEM_ADMIN") return;

  const current = users.find(u => u && u.id === _state.user.activeUserId) || null;
  if (!forceAdminFallback && current && current.active) {
    // keep current if active
    return;
  }

  // Map role -> preferred user by firstName (demo) OR fall back to first active admin-like
  let target = null;

  if (!forceAdminFallback) {
    if (role === "BUYER") target = users.find(u => u && u.active && normalizeFirstName(u.firstName) === "Inköp") || null;
    if (role === "PICKER") target = users.find(u => u && u.active && normalizeFirstName(u.firstName) === "Plock") || null;
    if (role === "ADMIN") target = users.find(u => u && u.active && normalizeFirstName(u.firstName) === "Admin") || null;
  }

  // Admin fallback (must be active)
  if (!target) {
    target = users.find(u => u && u.active && u.perms && u.perms.users_manage) || null;
  }
  if (!target) {
    target = users.find(u => u && u.active) || null;
  }

  if (target) {
    _state.user.activeUserId = target.id;
  }
}

function normalizeUser(u) {
  if (!u || typeof u !== "object") return null;
  const id = safeStr(u.id);
  const firstName = normalizeFirstName(u.firstName);
  if (!id || !firstName) return null;

  const active = !!u.active;
  const perms = normalizePerms(u.perms);

  const a = u.audit && typeof u.audit === "object" ? u.audit : {};
  const now = new Date().toISOString();

  return {
    id,
    firstName,
    active,
    perms,
    audit: {
      createdAt: typeof a.createdAt === "string" ? a.createdAt : now,
      createdBy: typeof a.createdBy === "string" ? a.createdBy : "",
      updatedAt: typeof a.updatedAt === "string" ? a.updatedAt : now,
      updatedBy: typeof a.updatedBy === "string" ? a.updatedBy : ""
    }
  };
}

function normalizePerms(p) {
  const x = (p && typeof p === "object") ? p : {};
  return {
    users_manage: !!x.users_manage,
    inventory_write: !!x.inventory_write,
    history_write: !!x.history_write,
    dashboard_view: ("dashboard_view" in x) ? !!x.dashboard_view : true
  };
}

function normalizeFirstName(v) {
  const s = safeStr(String(v || ""));
  if (!s) return "";
  // Keep human readable, but enforce max length
  return s.slice(0, 32);
}

function isFirstNameUnique(users, name, excludeId) {
  const n = name.toLocaleLowerCase("sv-SE");
  return !users.some(u => {
    if (!u) return false;
    if (excludeId && u.id === excludeId) return false;
    const fn = normalizeFirstName(u.firstName).toLocaleLowerCase("sv-SE");
    return fn === n;
  });
}

function makeId(prefix) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

/* -----------------------------
  VALIDATION / NORMALIZATION
----------------------------- */
function validateAndNormalize(obj) {
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

  const normUsers = Array.isArray(data.users) ? data.users.map(normalizeUser).filter(Boolean) : [];
  const activeUserId = (typeof user.activeUserId === "string") ? user.activeUserId : "";

  const norm = {
    meta: {
      schemaVersion: FRZ_SCHEMA_VERSION,
      createdAt: typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString(),
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : new Date().toISOString()
    },
    user: {
      role,
      activeUserId
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
      users: normUsers
    }
  };

  if (norm.flags.locked) {
    norm.flags.readOnly = true;
    if (!norm.flags.lockCode) norm.flags.lockCode = FRZ_ERR.INVALID_SHAPE;
  }

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
  return {
    meta: {
      schemaVersion: FRZ_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    user: {
      role: isValidRole(role) ? role : "ADMIN",
      activeUserId: ""
    },
    flags: {
      locked: false,
      lockReason: "",
      lockCode: "",
      readOnly: computeReadOnly(role)
    },
    data: {
      items: [],
      history: [],
      users: []
    }
  };
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

  // Users created in ensureUsersBaseline()

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
      activeUserId: ""
    },
    flags: {
      locked: true,
      lockReason: safeStr(reason) || "Låst läge.",
      lockCode: safeStr(code) || FRZ_ERR.INVALID_SHAPE,
      readOnly: true
    },
    data: { items: [], history: [], users: [] }
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
