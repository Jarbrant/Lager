/* ============================================================
AO-03/15 — Users CRUD + rättigheter (Admin) | BLOCK 1/4
NY-BASELINE AUTOPATCH | FIL: UI/freezer-store.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte (AO-03 BLOCK 1/4):
- Inför users-shape (förnamn unik + perms + audit)
- RBAC-grund i store: endast ADMIN (users_manage) får CRUD
- Inaktiva users finns i data och kan markeras/filtreras (UI görs i render/freezer.js senare)

Behåller AO-02:
- Status OK/TOM/KORRUPT + felkoder + debug
- Fail-closed vid korrupt storage / write-block
- SYSTEM_ADMIN = read-only
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
  RBAC_DENY: "FRZ_E_RBAC_DENY",
  USER_NAME_NOT_UNIQUE: "FRZ_E_USER_NAME_NOT_UNIQUE",
  USER_NOT_FOUND: "FRZ_E_USER_NOT_FOUND"
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

function emptyPerms() {
  return {
    users_manage: false,
    inventory_write: false,
    history_write: false,
    dashboard_view: true
  };
}

function normalizePerms(p) {
  const base = emptyPerms();
  if (!p || typeof p !== "object") return base;
  for (const k of FRZ_PERMS) base[k] = !!p[k];
  return base;
}

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

// AO-02: boot facts for status (OK/TOM/KORRUPT)
let _boot = { rawWasEmpty: true, demoCreated: false, loadErrorCode: FRZ_ERR.NONE };

/* -----------------------------
  PUBLIC API
----------------------------- */
const FreezerStore = {
  init,
  getState,
  getStatus,
  subscribe,

  // Session / RBAC
  setRole,          // legacy: maps to default users
  setActiveUser,    // new: chooses active user by id
  getActiveUser,
  can,

  // Users CRUD (AO-03)
  listUsers,
  createUser,
  updateUser,
  setUserActive,

  // Baseline utilities
  resetDemo,
  trySave
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

  // Ensure users exist (back-compat) + pick active user
  ensureUsersBaseline(_state);

  // Legacy: align role -> active user
  applyLegacyRole(role);

  // Read-only: SYSTEM_ADMIN or locked
  _state.flags.readOnly = computeReadOnly(_state.user.role);

  // If empty -> init demo (only if not locked)
  if (isEmptyDataset(_state) && !_state.flags.locked) {
    const demo = createDemoState(_state.user.role);
    ensureUsersBaseline(demo);
    applyLegacyRole(_state.user.role, demo);

    const w = safeWriteToStorage(demo);
    if (!w.ok) {
      _state = createLockedState(_state.user.role, w.reason || "Kunde inte skriva demo-data till lagring.", w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED);
    } else {
      _boot.demoCreated = true;
      _state = demo;
    }
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
    if (!validated.ok) return { ok: false, reason: validated.reason, rawWasEmpty: false, errorCode: validated.errorCode || FRZ_ERR.INVALID_SHAPE };
    return { ok: true, state: validated.state, rawWasEmpty: false, errorCode: FRZ_ERR.NONE };
  } catch (e) {
    _lastLoadError = String(e && e.message ? e.message : e);
    return { ok: false, reason: "JSON-parse misslyckades (korrupt data).", rawWasEmpty: false, errorCode: FRZ_ERR.CORRUPT_JSON };
  }
}

/* -----------------------------
  STATE HELPERS
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
  SESSION / RBAC
----------------------------- */
function setRole(role) {
  if (!_state) return getStatus();
  if (!isValidRole(role)) return getStatus();

  // Legacy support: role maps to a default user
  applyLegacyRole(role);
  _state.flags.readOnly = computeReadOnly(_state.user.role);

  // Role/user change allowed even in locked (in-memory), but don't write if locked/readOnly
  trySave();
  notify();
  return getStatus();
}

function setActiveUser(userId) {
  if (!_state) return { ok: false, reason: "Ej initierad." };
  if (!_state.data || !Array.isArray(_state.data.users)) return { ok: false, reason: "Users saknas." };

  const u = _state.data.users.find(x => x && x.id === userId);
  if (!u) return { ok: false, reason: "User hittades inte.", errorCode: FRZ_ERR.USER_NOT_FOUND };

  // UI ska inte kunna välja inaktiv (AO-03), men store fail-closed också:
  if (!u.active) return { ok: false, reason: "Inaktiv användare kan inte väljas.", errorCode: FRZ_ERR.RBAC_DENY };

  _state.user.userId = u.id;
  _state.user.firstName = u.firstName;
  _state.user.role = deriveRoleFromUser(u);          // keeps compatibility
  _state.flags.readOnly = computeReadOnly(_state.user.role);

  trySave();
  notify();
  return { ok: true };
}

function getActiveUser() {
  if (!_state || !_state.data || !Array.isArray(_state.data.users)) return null;
  const id = _state.user && _state.user.userId ? _state.user.userId : "";
  return _state.data.users.find(x => x && x.id === id) || null;
}

function can(perm) {
  if (!_state) return false;
  if (_state.flags.locked) return false;
  if (!perm || typeof perm !== "string") return false;

  // SYSTEM_ADMIN always read-only; allow view perms only
  const role = _state.user.role;
  if (role === "SYSTEM_ADMIN") {
    return perm === "dashboard_view";
  }

  const u = getActiveUser();
  if (!u || !u.active) return false;

  const p = u.perms || {};
  return !!p[perm];
}

function deriveRoleFromUser(u) {
  // Compatibility-only: we still expose role for existing UI.
  // Admin is defined by users_manage=true.
  if (u && u.perms && u.perms.users_manage) return "ADMIN";
  if (u && u.firstName && String(u.firstName).toUpperCase() === "SYSTEM_ADMIN") return "SYSTEM_ADMIN";
  // Default to BUYER/PICKER if their firstName matches; else BUYER.
  const fn = (u && u.firstName) ? String(u.firstName).toUpperCase() : "";
  if (fn === "PICKER" || fn === "PLOCK") return "PICKER";
  return "BUYER";
}

/* -----------------------------
  USERS CRUD (AO-03)
----------------------------- */
function listUsers() {
  if (!_state || !_state.data || !Array.isArray(_state.data.users)) return [];
  return _state.data.users.slice().map(u => JSON.parse(JSON.stringify(u)));
}

function createUser(payload) {
  if (!_state) return { ok: false, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, reason: "Låst läge.", errorCode: FRZ_ERR.RBAC_DENY };
  if (_state.flags.readOnly) return { ok: false, reason: "Read-only.", errorCode: FRZ_ERR.RBAC_DENY };
  if (!can("users_manage")) return { ok: false, reason: "Saknar behörighet (users_manage).", errorCode: FRZ_ERR.RBAC_DENY };

  ensureUsersBaseline(_state);

  const firstName = safeName(payload && payload.firstName);
  if (!firstName) return { ok: false, reason: "Förnamn krävs." };

  if (!isFirstNameUnique(firstName, null)) {
    return { ok: false, reason: "Förnamn måste vara unikt.", errorCode: FRZ_ERR.USER_NAME_NOT_UNIQUE };
  }

  const now = new Date().toISOString();
  const me = getAuditActor();

  const user = {
    id: genUserId(),
    firstName,
    active: true,
    perms: normalizePerms(payload && payload.perms),
    audit: {
      createdAt: now,
      createdBy: me,
      updatedAt: now,
      updatedBy: me,
      disabledAt: "",
      disabledBy: ""
    }
  };

  _state.data.users.push(user);
  const s = trySave();
  notify();

  if (!s.ok) return { ok: false, reason: s.reason || "Kunde inte spara." };
  return { ok: true, user: JSON.parse(JSON.stringify(user)) };
}

function updateUser(userId, patch) {
  if (!_state) return { ok: false, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, reason: "Låst läge.", errorCode: FRZ_ERR.RBAC_DENY };
  if (_state.flags.readOnly) return { ok: false, reason: "Read-only.", errorCode: FRZ_ERR.RBAC_DENY };
  if (!can("users_manage")) return { ok: false, reason: "Saknar behörighet (users_manage).", errorCode: FRZ_ERR.RBAC_DENY };

  ensureUsersBaseline(_state);

  const u = _state.data.users.find(x => x && x.id === userId);
  if (!u) return { ok: false, reason: "User hittades inte.", errorCode: FRZ_ERR.USER_NOT_FOUND };

  const nextFirst = (patch && "firstName" in patch) ? safeName(patch.firstName) : u.firstName;
  if (!nextFirst) return { ok: false, reason: "Förnamn krävs." };
  if (!isFirstNameUnique(nextFirst, u.id)) {
    return { ok: false, reason: "Förnamn måste vara unikt.", errorCode: FRZ_ERR.USER_NAME_NOT_UNIQUE };
  }

  u.firstName = nextFirst;
  if (patch && "perms" in patch) u.perms = normalizePerms(patch.perms);

  const now = new Date().toISOString();
  const me = getAuditActor();
  u.audit = u.audit || {};
  u.audit.updatedAt = now;
  u.audit.updatedBy = me;

  const s = trySave();
  notify();

  if (!s.ok) return { ok: false, reason: s.reason || "Kunde inte spara." };
  return { ok: true };
}

function setUserActive(userId, active) {
  if (!_state) return { ok: false, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, reason: "Låst läge.", errorCode: FRZ_ERR.RBAC_DENY };
  if (_state.flags.readOnly) return { ok: false, reason: "Read-only.", errorCode: FRZ_ERR.RBAC_DENY };
  if (!can("users_manage")) return { ok: false, reason: "Saknar behörighet (users_manage).", errorCode: FRZ_ERR.RBAC_DENY };

  ensureUsersBaseline(_state);

  const u = _state.data.users.find(x => x && x.id === userId);
  if (!u) return { ok: false, reason: "User hittades inte.", errorCode: FRZ_ERR.USER_NOT_FOUND };

  const next = !!active;
  if (u.active === next) return { ok: true }; // no-op

  const now = new Date().toISOString();
  const me = getAuditActor();

  u.active = next;
  u.audit = u.audit || {};
  u.audit.updatedAt = now;
  u.audit.updatedBy = me;

  if (!next) {
    u.audit.disabledAt = now;
    u.audit.disabledBy = me;

    // If disabling the currently active user: fail-closed by switching to ADMIN (first active admin)
    if (_state.user && _state.user.userId === u.id) {
      const fallback = findFirstActiveAdmin(_state);
      if (fallback) {
        _state.user.userId = fallback.id;
        _state.user.firstName = fallback.firstName;
        _state.user.role = deriveRoleFromUser(fallback);
      } else {
        // If no active admin exists, keep session but it will fail permissions.
        _state.user.userId = "";
        _state.user.firstName = "";
        _state.user.role = "BUYER";
      }
    }
  } else {
    u.audit.disabledAt = "";
    u.audit.disabledBy = "";
  }

  _state.flags.readOnly = computeReadOnly(_state.user.role);

  const s = trySave();
  notify();

  if (!s.ok) return { ok: false, reason: s.reason || "Kunde inte spara." };
  return { ok: true };
}

/* -----------------------------
  BASELINE UTILITIES
----------------------------- */
function resetDemo() {
  if (!_state) return { ok: false, reason: "Ej initierad." };
  if (_state.flags.locked) return { ok: false, reason: "Låst läge: kan inte återställa." };
  if (_state.flags.readOnly) return { ok: false, reason: "Read-only: kan inte återställa." };

  const demo = createDemoState(_state.user.role);
  ensureUsersBaseline(demo);
  applyLegacyRole(_state.user.role, demo);

  const w = safeWriteToStorage(demo);
  if (!w.ok) {
    _state = createLockedState(_state.user.role, w.reason || "Kunde inte skriva demo-data.", w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED);
    notify();
    return { ok: false, reason: _state.flags.lockReason };
  }

  _boot.demoCreated = true;
  _state = demo;
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

  // AO-03: users may be missing -> normalize
  const usersArr = Array.isArray(data.users) ? data.users : [];

  const norm = {
    meta: {
      schemaVersion: FRZ_SCHEMA_VERSION,
      createdAt: typeof meta.createdAt === "string" ? meta.createdAt : new Date().toISOString(),
      updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : new Date().toISOString()
    },
    user: {
      role,
      userId: typeof user.userId === "string" ? user.userId : "",
      firstName: typeof user.firstName === "string" ? user.firstName : ""
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
      users: usersArr.map(normalizeUser).filter(Boolean)
    }
  };

  if (norm.flags.locked) {
    norm.flags.readOnly = true;
    if (!norm.flags.lockCode) norm.flags.lockCode = FRZ_ERR.INVALID_SHAPE;
  }

  // Ensure user baseline for back-compat
  ensureUsersBaseline(norm);

  // If stored userId invalid/inactive -> select first active admin
  const active = norm.data.users.find(u => u.id === norm.user.userId && u.active);
  if (!active) {
    const fb = findFirstActiveAdmin(norm) || findFirstActiveUser(norm);
    if (fb) {
      norm.user.userId = fb.id;
      norm.user.firstName = fb.firstName;
      norm.user.role = deriveRoleFromUser(fb);
      norm.flags.readOnly = computeReadOnly(norm.user.role);
    }
  }

  return { ok: true, state: norm, errorCode: FRZ_ERR.NONE };
}

function normalizeUser(u) {
  if (!u || typeof u !== "object") return null;

  const id = safeStr(u.id) || genUserId();
  const firstName = safeName(u.firstName);
  if (!firstName) return null;

  const active = ("active" in u) ? !!u.active : true;
  const perms = normalizePerms(u.perms);

  const auditIn = u.audit && typeof u.audit === "object" ? u.audit : {};
  const audit = {
    createdAt: typeof auditIn.createdAt === "string" ? auditIn.createdAt : new Date().toISOString(),
    createdBy: safeStr(auditIn.createdBy) || "",
    updatedAt: typeof auditIn.updatedAt === "string" ? auditIn.updatedAt : new Date().toISOString(),
    updatedBy: safeStr(auditIn.updatedBy) || "",
    disabledAt: typeof auditIn.disabledAt === "string" ? auditIn.disabledAt : "",
    disabledBy: safeStr(auditIn.disabledBy) || ""
  };

  return { id, firstName, active, perms, audit };
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
    user: { role: r, userId: "", firstName: "" },
    flags: { locked: false, lockReason: "", lockCode: "", readOnly: computeReadOnly(r) },
    data: { items: [], history: [], users: [] }
  };
  ensureUsersBaseline(state);
  applyLegacyRole(r, state);
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

  return state;
}

function createLockedState(role, reason, code) {
  const r = isValidRole(role) ? role : "ADMIN";
  const st = {
    meta: {
      schemaVersion: FRZ_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    user: { role: r, userId: "", firstName: "" },
    flags: {
      locked: true,
      lockReason: safeStr(reason) || "Låst läge.",
      lockCode: safeStr(code) || FRZ_ERR.INVALID_SHAPE,
      readOnly: true
    },
    data: { items: [], history: [], users: [] }
  };
  ensureUsersBaseline(st);
  applyLegacyRole(r, st);
  return st;
}

/* -----------------------------
  USERS BASELINE (AO-03)
----------------------------- */
function ensureUsersBaseline(state) {
  if (!state.data) state.data = {};
  if (!Array.isArray(state.data.users)) state.data.users = [];

  // If empty, create a minimal demo roster
  if (state.data.users.length === 0) {
    const now = new Date().toISOString();
    state.data.users = [
      {
        id: "usr_admin",
        firstName: "Admin",
        active: true,
        perms: { users_manage: true, inventory_write: true, history_write: true, dashboard_view: true },
        audit: { createdAt: now, createdBy: "system", updatedAt: now, updatedBy: "system", disabledAt: "", disabledBy: "" }
      },
      {
        id: "usr_buyer",
        firstName: "Inköp",
        active: true,
        perms: { users_manage: false, inventory_write: true, history_write: true, dashboard_view: true },
        audit: { createdAt: now, createdBy: "system", updatedAt: now, updatedBy: "system", disabledAt: "", disabledBy: "" }
      },
      {
        id: "usr_picker",
        firstName: "Plock",
        active: true,
        perms: { users_manage: false, inventory_write: true, history_write: true, dashboard_view: true },
        audit: { createdAt: now, createdBy: "system", updatedAt: now, updatedBy: "system", disabledAt: "", disabledBy: "" }
      },
      {
        id: "usr_sys",
        firstName: "System_Admin",
        active: true,
        perms: { users_manage: false, inventory_write: false, history_write: false, dashboard_view: true },
        audit: { createdAt: now, createdBy: "system", updatedAt: now, updatedBy: "system", disabledAt: "", disabledBy: "" }
      }
    ];
  }

  // Normalize users & enforce unique firstName (best-effort; keep first occurrence)
  const seen = new Set();
  state.data.users = state.data.users
    .map(normalizeUser)
    .filter(Boolean)
    .filter(u => {
      const key = normNameKey(u.firstName);
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  // Ensure there is at least one active admin (users_manage)
  if (!state.data.users.some(u => u.active && u.perms && u.perms.users_manage)) {
    const first = state.data.users.find(u => u.active);
    if (first) first.perms.users_manage = true;
  }
}

function applyLegacyRole(role, targetState) {
  const st = targetState || _state;
  if (!st) return;

  const r = isValidRole(role) ? role : "ADMIN";
  st.user.role = r;

  // Map to a default active user
  let pick = null;
  if (r === "ADMIN") pick = findUserByName(st, "Admin") || findFirstActiveAdmin(st) || findFirstActiveUser(st);
  if (r === "BUYER") pick = findUserByName(st, "Inköp") || findFirstActiveUser(st);
  if (r === "PICKER") pick = findUserByName(st, "Plock") || findFirstActiveUser(st);
  if (r === "SYSTEM_ADMIN") pick = findUserByName(st, "System_Admin") || findFirstActiveUser(st);

  if (pick && pick.active) {
    st.user.userId = pick.id;
    st.user.firstName = pick.firstName;
  } else {
    st.user.userId = "";
    st.user.firstName = "";
  }
}

function findUserByName(st, name) {
  if (!st || !st.data || !Array.isArray(st.data.users)) return null;
  const key = normNameKey(name);
  return st.data.users.find(u => normNameKey(u.firstName) === key) || null;
}

function findFirstActiveAdmin(st) {
  if (!st || !st.data || !Array.isArray(st.data.users)) return null;
  return st.data.users.find(u => u.active && u.perms && u.perms.users_manage) || null;
}

function findFirstActiveUser(st) {
  if (!st || !st.data || !Array.isArray(st.data.users)) return null;
  return st.data.users.find(u => u.active) || null;
}

function isFirstNameUnique(firstName, excludeId) {
  const key = normNameKey(firstName);
  if (!key) return false;
  return !_state.data.users.some(u => {
    if (!u) return false;
    if (excludeId && u.id === excludeId) return false;
    return normNameKey(u.firstName) === key;
  });
}

function normNameKey(s) {
  return safeName(s).toLowerCase();
}

function safeName(v) {
  // “förnamn unik” — keep it simple: letters, digits, underscore, space, dash (no HTML)
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t) return "";
  return t.replace(/[<>"]/g, "").replace(/\s+/g, " ").slice(0, 32);
}

function genUserId() {
  return "usr_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now().toString(36);
}

function getAuditActor() {
  // Not PII: just the active firstName or role label
  const u = getActiveUser();
  if (u && u.firstName) return u.firstName;
  return (_state && _state.user && _state.user.role) ? _state.user.role : "unknown";
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

