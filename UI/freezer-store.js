/* ============================================================
AO-02/15 — Statuspanel + Read-only UX + felkoder | BLOCK 1/3
AUTOPATCH | FIL: UI/freezer-store.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte (AO-02):
- Status: OK / TOM / KORRUPT + felorsak
- Read-only: tydlig “varför” (SYSTEM_ADMIN / LOCKED / etc.)
- Debug (ej känsligt): storageKey + schemaVersion
- Felkoder (enkla, stabila)

DoD påverkan:
- Korrupt storage => fail-closed (LOCKED) + KORRUPT-status
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
  STORAGE_WRITE_BLOCKED: "FRZ_E_STORAGE_WRITE_BLOCKED"
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
  trySave
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
    _state = createLockedState(role, loadRes.reason || "Korrupt eller ogiltig lagring.", loadRes.errorCode || FRZ_ERR.CORRUPT_JSON);
    notify();
    return getStatus();
  }

  _state = loadRes.state;

  // Ensure role + readonly aligned
  _state.user.role = role;
  _state.flags.readOnly = computeReadOnly(role);

  // If empty -> init demo (only if not locked)
  if (isEmptyDataset(_state) && !_state.flags.locked) {
    const demo = createDemoState(role);
    // Try to write demo; if write fails -> lock
    const w = safeWriteToStorage(demo);
    if (!w.ok) {
      _state = createLockedState(role, w.reason || "Kunde inte skriva demo-data till lagring.", w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED);
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
    _state = createLockedState(_state.user.role, w.reason || "Kunde inte skriva demo-data.", w.errorCode || FRZ_ERR.STORAGE_WRITE_BLOCKED);
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
    user: { role },
    flags: {
      locked: !!(flags && flags.locked),
      lockReason: (flags && typeof flags.lockReason === "string") ? flags.lockReason : "",
      lockCode: (flags && typeof flags.lockCode === "string") ? flags.lockCode : "",
      readOnly: computeReadOnly(role)
    },
    data: {
      items: data.items.map(normalizeItem).filter(Boolean),
      history: data.history.map(normalizeHistory).filter(Boolean)
    }
  };

  // If storage says locked, keep it locked
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
    user: { role: isValidRole(role) ? role : "ADMIN" },
    flags: {
      locked: false,
      lockReason: "",
      lockCode: "",
      readOnly: computeReadOnly(role)
    },
    data: {
      items: [],
      history: []
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
    user: { role: r },
    flags: {
      locked: true,
      lockReason: safeStr(reason) || "Låst läge.",
      lockCode: safeStr(code) || FRZ_ERR.INVALID_SHAPE,
      readOnly: true
    },
    data: { items: [], history: [] }
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
