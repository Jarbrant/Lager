/* ============================================================
AO-01/15 — NY-BASELINE | BLOCK 1/5 | FIL: UI/freezer-store.js
Projekt: Freezer (UI-only / localStorage-first)
Syfte: Store + storage-guards + demo-init + status/readOnly + local adapter

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

  const loadRes = loadFromStorage();
  if (!loadRes.ok) {
    // fail-closed: lock in memory, DO NOT write anything back
    _state = createLockedState(role, loadRes.reason || "Korrupt eller ogiltig lagring.");
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
      _state = createLockedState(role, w.reason || "Kunde inte skriva demo-data till lagring.");
    } else {
      _state = demo;
    }
  }

  notify();
  return getStatus();
}

function loadFromStorage() {
  const raw = StorageAdapter.getRaw();
  if (!raw || raw.trim() === "") {
    return { ok: true, state: createEmptyState("ADMIN") };
  }

  try {
    const parsed = JSON.parse(raw);
    const validated = validateAndNormalize(parsed);
    if (!validated.ok) return { ok: false, reason: validated.reason };
    return { ok: true, state: validated.state };
  } catch (e) {
    _lastLoadError = String(e && e.message ? e.message : e);
    return { ok: false, reason: "JSON-parse misslyckades (korrupt data)." };
  }
}

/* -----------------------------
  STATE HELPERS
----------------------------- */
function getState() {
  // Defensive copy (shallow); caller should treat as read-only
  return _state ? JSON.parse(JSON.stringify(_state)) : null;
}

function getStatus() {
  if (!_state) {
    return {
      ok: false,
      locked: true,
      readOnly: true,
      role: "ADMIN",
      reason: "Ej initierad."
    };
  }
  return {
    ok: !_state.flags.locked,
    locked: !!_state.flags.locked,
    readOnly: !!_state.flags.readOnly,
    role: _state.user.role,
    reason: _state.flags.lockReason || null,
    lastLoadError: _lastLoadError || null
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
    _state = createLockedState(_state.user.role, w.reason || "Kunde inte skriva demo-data.");
    notify();
    return { ok: false, reason: _state.flags.lockReason };
  }

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
    _state = createLockedState(_state.user.role, w.reason || "Lagring misslyckades.");
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
    return { ok: false, reason: "localStorage write misslyckades (blockerad/quota/privat läge)." };
  }
}

/* -----------------------------
  VALIDATION / NORMALIZATION
----------------------------- */
function validateAndNormalize(obj) {
  // Strict-ish validation to detect corruption
  if (!obj || typeof obj !== "object") return { ok: false, reason: "Ogiltig root." };

  const meta = obj.meta;
  const user = obj.user;
  const data = obj.data;
  const flags = obj.flags;

  if (!meta || typeof meta !== "object") return { ok: false, reason: "Saknar meta." };
  if (meta.schemaVersion !== FRZ_SCHEMA_VERSION) return { ok: false, reason: "Fel schemaVersion." };

  if (!user || typeof user !== "object") return { ok: false, reason: "Saknar user." };
  const role = user.role;
  if (!isValidRole(role)) return { ok: false, reason: "Ogiltig roll i lagring." };

  if (!data || typeof data !== "object") return { ok: false, reason: "Saknar data." };
  if (!Array.isArray(data.items)) return { ok: false, reason: "items måste vara array." };
  if (!Array.isArray(data.history)) return { ok: false, reason: "history måste vara array." };

  // flags may be missing -> normalize
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
  }

  return { ok: true, state: norm };
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

function createLockedState(role, reason) {
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

