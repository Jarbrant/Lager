/* ============================================================
AO-REFAC-STORE-SPLIT-01 (PROD) | FIL: UI/pages/freezer/03-store.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- (KRAV 4) Public Store API: init/load/save/getState/getStatus/subscribe/setRole/resetDemo/trySave
- Users CRUD + Items CRUD + RBAC (refactor-only: ingen funktionsförändring)
- Policy: 1 storage key AO-FREEZER_V1, fail-closed vid korrupt storage, SYSTEM_ADMIN read-only
- Store renderar inte

ÄNDRING (REFAC-ONLY):
- CONTRACT shim bortkopplad: använder nu window.FreezerContract (04-contract.js)

Taggar:
- GUARD / STORAGE / RBAC / FLOW / DEBUG
============================================================ */

(function () {
  "use strict";

  // Version-guard (stabil hook)
  if (window.FreezerStore && window.FreezerStore.version === "AO-REFAC-STORE-SPLIT-01:03-store@1") return;

  /* -----------------------------
    BLOCK 1/9 — Core hooks (GUARD)
  ----------------------------- */
  const Core = window.FreezerCore || null;

  // Fail-closed: om core saknas, exponera minimal store som alltid är read-only.
  if (!Core) {
    window.FreezerStore = {
      version: "AO-REFAC-STORE-SPLIT-01:03-store@1",
      init: () => ({ ok: false, status: "KORRUPT", errorCode: "FRZ_E_NOT_INIT", locked: true, readOnly: true, role: "ADMIN", reason: "FreezerCore saknas." }),
      getState: () => null,
      getStatus: () => ({ ok: false, status: "KORRUPT", errorCode: "FRZ_E_NOT_INIT", locked: true, readOnly: true, role: "ADMIN", reason: "FreezerCore saknas." }),
      subscribe: () => () => {},
      setRole: () => ({ ok: false }),
      resetDemo: () => ({ ok: false, reason: "FreezerCore saknas." }),
      trySave: () => ({ ok: false, reason: "FreezerCore saknas." }),

      can: () => false,
      listUsers: () => [],
      createUser: () => ({ ok: false, reason: "FreezerCore saknas." }),
      updateUser: () => ({ ok: false, reason: "FreezerCore saknas." }),
      setUserActive: () => ({ ok: false, reason: "FreezerCore saknas." }),

      listItems: () => [],
      queryItems: () => [],
      createItem: () => ({ ok: false, reason: "FreezerCore saknas." }),
      updateItem: () => ({ ok: false, reason: "FreezerCore saknas." }),
      archiveItem: () => ({ ok: false, reason: "FreezerCore saknas." }),
      deleteItem: () => ({ ok: false, reason: "FreezerCore saknas." })
    };
    return;
  }

  const { nowIso, safeStr, safeNum, safeInt, deepClone, safeJsonParse, makeId, safeUserName, normNameKey, normKey } = Core;

  /* -----------------------------
    BLOCK 2/9 — Contract hooks (GUARD)
  ----------------------------- */
  const Contract = (window.FreezerContract && window.FreezerContract.ok) ? window.FreezerContract : null;

  // Fail-closed: om contract saknas/är fel -> exponera minimal store som alltid är read-only.
  if (!Contract) {
    const reason = (window.FreezerContract && window.FreezerContract.reason)
      ? String(window.FreezerContract.reason)
      : "FreezerContract saknas (import-ordning fel).";

    window.FreezerStore = {
      version: "AO-REFAC-STORE-SPLIT-01:03-store@1",
      init: () => ({ ok: false, status: "KORRUPT", errorCode: "FRZ_E_NOT_INIT", locked: true, readOnly: true, role: "ADMIN", reason }),
      getState: () => null,
      getStatus: () => ({ ok: false, status: "KORRUPT", errorCode: "FRZ_E_NOT_INIT", locked: true, readOnly: true, role: "ADMIN", reason }),
      subscribe: () => () => {},
      setRole: () => ({ ok: false }),
      resetDemo: () => ({ ok: false, reason }),
      trySave: () => ({ ok: false, reason }),

      can: () => false,
      listUsers: () => [],
      createUser: () => ({ ok: false, reason }),
      updateUser: () => ({ ok: false, reason }),
      setUserActive: () => ({ ok: false, reason }),

      listItems: () => [],
      queryItems: () => [],
      createItem: () => ({ ok: false, reason }),
      updateItem: () => ({ ok: false, reason }),
      archiveItem: () => ({ ok: false, reason }),
      deleteItem: () => ({ ok: false, reason })
    };
    return;
  }

  // Contract constants + helpers (refactor-only: samma beteende, bara flyttat)
  const FRZ_STORAGE_KEY = "AO-FREEZER_V1"; // (KRAV 3) store äger storage-key
  const {
    FRZ_SCHEMA_VERSION,
    FRZ_STATUS,
    FRZ_ERR,
    // enums/guards
    isValidRole,
    isValidPermKey,
    computeReadOnly,
    // normalizers/validators
    normalizePerms,
    normalizeUser,
    normalizeItemAny,
    validateNewItem,
    normalizeHistory,
    // defaults + helpers
    createDefaultUsers,
    pickActiveUserForRole,
    isUserNameUnique: contractIsUserNameUnique,
    isArticleNoUnique: contractIsArticleNoUnique,
    deriveLegacyName,
    deriveLegacyUnit
  } = Contract;

  /* -----------------------------
    BLOCK 3/9 — Storage adapter (STORAGE)
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
    BLOCK 4/9 — In-memory state + boot (FLOW/DEBUG)
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
    BLOCK 5/9 — Public API (stable surface)
  ----------------------------- */
  const FreezerStore = {
    version: "AO-REFAC-STORE-SPLIT-01:03-store@1",

    init,
    getState,
    getStatus,
    subscribe,
    setRole,
    resetDemo,
    trySave,

    // users
    can,
    listUsers,
    createUser,
    updateUser,
    setUserActive,

    // items
    listItems,
    queryItems,
    createItem,
    updateItem,
    archiveItem,
    deleteItem
  };

  window.FreezerStore = FreezerStore;

  /* -----------------------------
    BLOCK 6/9 — Init / load / save (GUARD/STORAGE/FLOW)
  ----------------------------- */
  function init(opts = {}) {
    const role = isValidRole(opts.role) ? opts.role : "ADMIN";

    _boot = { rawWasEmpty: true, demoCreated: false, loadErrorCode: FRZ_ERR.NONE };
    _lastLoadError = null;

    const loadRes = loadFromStorage();
    _boot.rawWasEmpty = !!loadRes.rawWasEmpty;
    _boot.loadErrorCode = loadRes.errorCode || FRZ_ERR.NONE;

    if (!loadRes.ok) {
      _state = createLockedState(
        role,
        loadRes.reason || "Korrupt eller ogiltig lagring.",
        loadRes.errorCode || FRZ_ERR.CORRUPT_JSON
      );
      notify();
      return getStatus();
    }

    _state = loadRes.state;

    _state.user.role = role;
    _state.flags.readOnly = computeReadOnly(role);

    ensureUsersBaseline();
    ensureItemsBaseline();

    if (isEmptyDataset(_state) && !_state.flags.locked) {
      const demo = createDemoState(role);

      demo.data.users = (_state.data && Array.isArray(_state.data.users) && _state.data.users.length)
        ? _state.data.users
        : demo.data.users;

      demo.user.activeUserId = pickActiveUserForRole(role, demo.data.users);

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

    const parsed = safeJsonParse(raw);
    if (!parsed.ok) {
      _lastLoadError = parsed.error;
      return {
        ok: false,
        reason: "JSON-parse misslyckades (korrupt data).",
        rawWasEmpty: false,
        errorCode: FRZ_ERR.CORRUPT_JSON
      };
    }

    const validated = Contract.validateAndNormalize(parsed.value);
    if (!validated.ok) {
      return {
        ok: false,
        reason: validated.reason,
        rawWasEmpty: false,
        errorCode: validated.errorCode || FRZ_ERR.INVALID_SHAPE
      };
    }

    return { ok: true, state: validated.state, rawWasEmpty: false, errorCode: FRZ_ERR.NONE };
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

  function trySave() {
    if (!_state) return { ok: false, reason: "Ej initierad." };
    if (_state.flags.locked) return { ok: false, reason: "Låst läge." };
    if (_state.flags.readOnly) return { ok: false, reason: "Read-only." };

    _state.meta.updatedAt = nowIso();

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

  /* -----------------------------
    BLOCK 7/9 — Getters + subscribe + role (FLOW/RBAC)
  ----------------------------- */
  function getState() {
    return _state ? deepClone(_state) : null;
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

  function setRole(role) {
    if (!_state) return getStatus();
    if (!isValidRole(role)) return getStatus();

    _state.user.role = role;
    _state.flags.readOnly = computeReadOnly(role);

    ensureUsersBaseline();
    _state.user.activeUserId = pickActiveUserForRole(role, _state.data.users);

    // rollbyte får ske in-memory även om låst; men skriv inte om readOnly/locked
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

  /* -----------------------------
    BLOCK 8/9 — RBAC + Users + Items + History (RBAC/FLOW)
  ----------------------------- */
  function getActiveUser() {
    try {
      if (!_state || !_state.data || !Array.isArray(_state.data.users)) return null;
      const id = (_state.user && _state.user.activeUserId) ? _state.user.activeUserId : "";
      const u = _state.data.users.find(x => x && x.id === id) || null;
      if (!u || !u.active) return null;
      return u;
    } catch {
      return null;
    }
  }

  function getAuditActor() {
    try {
      const role = (_state && _state.user) ? _state.user.role : "ADMIN";
      const u = getActiveUser();
      const who = (u && u.firstName) ? u.firstName : role;
      return `${who}`;
    } catch {
      return "system";
    }
  }

  function pushHistory(type, sku, qty, by, note) {
    try {
      if (!_state || !_state.data || !Array.isArray(_state.data.history)) return;
      _state.data.history.push(normalizeHistory({
        ts: nowIso(),
        type: safeStr(type) || "note",
        sku: safeStr(sku) || "",
        qty: safeNum(qty, 0),
        by: safeStr(by) || "",
        note: safeStr(note) || ""
      }));
    } catch {}
  }

  function can(permKey) {
    if (!_state) return false;
    if (!isValidPermKey(permKey)) return false;
    if (_state.flags.locked) return false;
    if (_state.flags.readOnly) return false;

    const u = getActiveUser();
    if (!u || !u.active) return false;
    return !!(u.perms && u.perms[permKey]);
  }

  function ensureUsersBaseline() {
    if (!_state || !_state.data) return;
    if (!Array.isArray(_state.data.users)) _state.data.users = [];

    if (_state.data.users.length === 0) {
      _state.data.users = createDefaultUsers();
    } else {
      _state.data.users = _state.data.users.map(normalizeUser).filter(Boolean);
      if (_state.data.users.length === 0) _state.data.users = createDefaultUsers();
    }

    if (!_state.data.users.some(u => u && u.active)) {
      _state.data.users[0].active = true;
    }

    _state.user.activeUserId = pickActiveUserForRole(_state.user.role, _state.data.users);
  }

  function isUserNameUnique(firstName, excludeId) {
    const users = (_state && _state.data && Array.isArray(_state.data.users)) ? _state.data.users : [];
    return contractIsUserNameUnique(firstName, excludeId, users);
  }

  function listUsers() {
    if (!_state || !_state.data || !Array.isArray(_state.data.users)) return [];
    return deepClone(_state.data.users) || [];
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

    const now = nowIso();
    const id = makeId("u");
    const createdBy = getAuditActor();

    // REFAC-ONLY: behåller shape (roleKey kan sättas senare via UI om det finns)
    const user = normalizeUser({
      id,
      firstName,
      active: true,
      perms: normalizePerms(input && input.perms),
      audit: { createdAt: now, updatedAt: now, createdBy, updatedBy: createdBy }
    });

    if (!user) return { ok: false, errorCode: FRZ_ERR.USER_INVALID, reason: "User blev ogiltig." };

    _state.data.users.push(user);
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

    const now = nowIso();
    const actor = getAuditActor();
    const nameChanged = (String(u.firstName || "") !== nextName);

    u.firstName = nextName;
    u.perms = normalizePerms(patch && patch.perms);
    u.audit = (u.audit && typeof u.audit === "object") ? u.audit : {};
    u.audit.updatedAt = now;
    u.audit.updatedBy = actor;

    if (nameChanged) pushHistory("users_update", "", 0, actor, `User uppdaterad: ${nextName}`);
    else pushHistory("users_update", "", 0, actor, `Behörigheter uppdaterade: ${nextName}`);

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

    if (!next) {
      const activeCount = _state.data.users.filter(x => x && x.active).length;
      if (activeCount <= 1 && u.active) {
        return { ok: false, errorCode: FRZ_ERR.USER_INVALID, reason: "Minst en aktiv användare krävs." };
      }
    }

    const now = nowIso();
    const actor = getAuditActor();

    u.active = next;
    u.audit = (u.audit && typeof u.audit === "object") ? u.audit : {};
    u.audit.updatedAt = now;
    u.audit.updatedBy = actor;

    pushHistory("users_toggle", "", 0, actor, `${u.firstName} är nu ${next ? "aktiv" : "inaktiv"}.`);

    if (!u.active && _state.user && _state.user.activeUserId === u.id) {
      _state.user.activeUserId = pickActiveUserForRole(_state.user.role, _state.data.users);
    }

    const s = trySave();
    notify();
    if (!s.ok) return { ok: false, errorCode: FRZ_ERR.STORAGE_WRITE_BLOCKED, reason: s.reason || "Kunde inte spara." };
    return { ok: true };
  }

  function ensureItemsBaseline() {
    if (!_state || !_state.data) return;
    if (!Array.isArray(_state.data.items)) _state.data.items = [];
    _state.data.items = _state.data.items.map(normalizeItemAny).filter(Boolean);
  }

  function isArticleNoUnique(articleNo, excludeArticleNo) {
    const items = (_state && _state.data && Array.isArray(_state.data.items)) ? _state.data.items : [];
    return contractIsArticleNoUnique(articleNo, excludeArticleNo, items);
  }

  function canDeleteItemNow(articleNo) {
    // STOCK_MOVES: FINNS INTE ÄN (hook)
    return { ok: true };
  }

  function listItems(opts = {}) {
    if (!_state || !_state.data || !Array.isArray(_state.data.items)) return [];
    ensureItemsBaseline();

    const includeInactive = ("includeInactive" in opts) ? !!opts.includeInactive : true;
    const items = _state.data.items.filter(it => includeInactive ? true : !!it.isActive);

    return deepClone(items) || [];
  }

  function getSortValue(it, key) {
    const k = String(key || "");
    if (k === "pricePerKg") return safeNum(it.pricePerKg, 0);
    if (k === "minLevel") return safeNum(it.minLevel, 0);
    if (k === "updatedAt") return safeStr(it.updatedAt) || (it.audit && it.audit.updatedAt) || "";
    if (k === "supplier") return safeStr(it.supplier);
    if (k === "category") return safeStr(it.category);
    return safeStr(it.articleNo);
  }

  function queryItems(query = {}) {
    if (!_state || !_state.data || !Array.isArray(_state.data.items)) return [];
    ensureItemsBaseline();

    const q = safeStr(query.q).toLocaleLowerCase("sv-SE");
    const category = safeStr(query.category).toLocaleLowerCase("sv-SE");
    const includeInactive = ("includeInactive" in query) ? !!query.includeInactive : true;
    const sortKey = safeStr(query.sortKey) || "articleNo";
    const sortDir = (safeStr(query.sortDir).toLowerCase() === "desc") ? "desc" : "asc";

    let out = _state.data.items.slice();

    if (!includeInactive) out = out.filter(it => !!it.isActive);

    if (category) {
      out = out.filter(it => safeStr(it.category).toLocaleLowerCase("sv-SE") === category);
    }

    if (q) {
      out = out.filter(it => {
        const a = safeStr(it.articleNo).toLocaleLowerCase("sv-SE");
        const s = safeStr(it.supplier).toLocaleLowerCase("sv-SE");
        const c = safeStr(it.category).toLocaleLowerCase("sv-SE");
        return a.includes(q) || s.includes(q) || c.includes(q);
      });
    }

    out.sort((x, y) => {
      const ax = getSortValue(x, sortKey);
      const ay = getSortValue(y, sortKey);

      if (typeof ax === "number" && typeof ay === "number") {
        return sortDir === "desc" ? (ay - ax) : (ax - ay);
      }
      const sx = String(ax ?? "").toLocaleLowerCase("sv-SE");
      const sy = String(ay ?? "").toLocaleLowerCase("sv-SE");
      if (sx < sy) return sortDir === "desc" ? 1 : -1;
      if (sx > sy) return sortDir === "desc" ? -1 : 1;
      return 0;
    });

    return deepClone(out) || [];
  }

  function createItem(input) {
    if (!_state) return { ok: false, errorCode: FRZ_ERR.NOT_INIT, reason: "Ej initierad." };
    if (_state.flags.locked) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Låst läge." };
    if (_state.flags.readOnly) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Read-only." };
    if (!can("inventory_write")) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Saknar behörighet (inventory_write)." };

    ensureItemsBaseline();

    const v = validateNewItem(input);
    if (!v.ok) return { ok: false, errorCode: v.errorCode || FRZ_ERR.ITEM_INVALID, reason: v.reason || "Ogiltig item." };

    if (!isArticleNoUnique(v.item.articleNo, null)) {
      return { ok: false, errorCode: FRZ_ERR.ITEM_ARTICLE_NO_NOT_UNIQUE, reason: "articleNo måste vara unikt." };
    }

    const now = nowIso();
    const actor = getAuditActor();

    const item = normalizeItemAny({
      articleNo: v.item.articleNo,
      packSize: v.item.packSize,
      supplier: v.item.supplier,
      category: v.item.category,
      pricePerKg: v.item.pricePerKg,
      minLevel: v.item.minLevel,
      tempClass: v.item.tempClass,
      requiresExpiry: v.item.requiresExpiry,
      isActive: v.item.isActive,
      audit: { createdAt: now, updatedAt: now, createdBy: actor, updatedBy: actor },

      // legacy extras (contract fyller/deriverar vid behov)
      sku: v.item.articleNo,
      name: deriveLegacyName(v.item),
      unit: deriveLegacyUnit(v.item),
      onHand: 0,
      min: v.item.minLevel,
      updatedAt: now
    });

    if (!item) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "Ogiltig item (normalize)." };

    _state.data.items.push(item);
    pushHistory("item_create", item.articleNo, 0, actor, `Produkt skapad: ${item.articleNo}`);

    const s = trySave();
    notify();
    if (!s.ok) return { ok: false, errorCode: FRZ_ERR.STORAGE_WRITE_BLOCKED, reason: s.reason || "Kunde inte spara." };
    return { ok: true, articleNo: item.articleNo };
  }

  function updateItem(articleNo, patch) {
    if (!_state) return { ok: false, errorCode: FRZ_ERR.NOT_INIT, reason: "Ej initierad." };
    if (_state.flags.locked) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Låst läge." };
    if (_state.flags.readOnly) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Read-only." };
    if (!can("inventory_write")) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Saknar behörighet (inventory_write)." };

    ensureItemsBaseline();

    const key = safeStr(articleNo);
    if (!key) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "articleNo krävs." };

    const it = _state.data.items.find(x => x && safeStr(x.articleNo) === key) || null;
    if (!it) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "Produkt hittades inte." };

    if (patch && typeof patch === "object" && "articleNo" in patch) {
      const attempted = safeStr(patch.articleNo);
      if (attempted && attempted !== it.articleNo) {
        return { ok: false, errorCode: FRZ_ERR.ITEM_ARTICLE_NO_IMMUTABLE, reason: "articleNo är immutable och kan inte ändras." };
      }
    }

    const next = {
      articleNo: it.articleNo,
      packSize: ("packSize" in (patch || {})) ? safeStr(patch.packSize) : safeStr(it.packSize),
      supplier: ("supplier" in (patch || {})) ? safeStr(patch.supplier) : safeStr(it.supplier),
      category: ("category" in (patch || {})) ? safeStr(patch.category) : safeStr(it.category),
      pricePerKg: ("pricePerKg" in (patch || {})) ? safeNum(patch.pricePerKg, NaN) : safeNum(it.pricePerKg, NaN),
      minLevel: ("minLevel" in (patch || {})) ? safeInt(patch.minLevel, NaN) : safeInt(it.minLevel, NaN),
      tempClass: ("tempClass" in (patch || {})) ? safeStr(patch.tempClass) : safeStr(it.tempClass),
      requiresExpiry: ("requiresExpiry" in (patch || {})) ? !!patch.requiresExpiry : !!it.requiresExpiry,
      isActive: ("isActive" in (patch || {})) ? !!patch.isActive : !!it.isActive
    };

    const v = validateNewItem(next);
    if (!v.ok) return { ok: false, errorCode: v.errorCode || FRZ_ERR.ITEM_INVALID, reason: v.reason || "Ogiltig uppdatering." };

    it.packSize = v.item.packSize;
    it.supplier = v.item.supplier;
    it.category = v.item.category;
    it.pricePerKg = v.item.pricePerKg;
    it.minLevel = v.item.minLevel;
    it.tempClass = v.item.tempClass;
    it.requiresExpiry = v.item.requiresExpiry;
    it.isActive = v.item.isActive;

    const now = nowIso();
    const actor = getAuditActor();

    it.audit = (it.audit && typeof it.audit === "object") ? it.audit : {};
    it.audit.updatedAt = now;
    it.audit.updatedBy = actor;

    it.sku = it.articleNo;
    it.name = deriveLegacyName(it);
    it.unit = deriveLegacyUnit(it);
    it.min = it.minLevel;
    it.updatedAt = now;

    pushHistory("item_update", it.articleNo, 0, actor, `Produkt uppdaterad: ${it.articleNo}`);

    const s = trySave();
    notify();
    if (!s.ok) return { ok: false, errorCode: FRZ_ERR.STORAGE_WRITE_BLOCKED, reason: s.reason || "Kunde inte spara." };
    return { ok: true };
  }

  function archiveItem(articleNo) {
    return updateItem(articleNo, { isActive: false });
  }

  function deleteItem(articleNo) {
    if (!_state) return { ok: false, errorCode: FRZ_ERR.NOT_INIT, reason: "Ej initierad." };
    if (_state.flags.locked) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Låst läge." };
    if (_state.flags.readOnly) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Read-only." };
    if (!can("inventory_write")) return { ok: false, errorCode: FRZ_ERR.FORBIDDEN, reason: "Saknar behörighet (inventory_write)." };

    ensureItemsBaseline();

    const key = safeStr(articleNo);
    if (!key) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "articleNo krävs." };

    const idx = _state.data.items.findIndex(x => x && safeStr(x.articleNo) === key);
    if (idx < 0) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "Produkt hittades inte." };

    const guard = canDeleteItemNow(key);
    if (!guard.ok) {
      return { ok: false, errorCode: FRZ_ERR.ITEM_DELETE_GUARDED, reason: guard.reason || "Delete spärrad." };
    }

    const actor = getAuditActor();
    _state.data.items.splice(idx, 1);
    pushHistory("item_delete", key, 0, actor, `Produkt borttagen: ${key}`);

    const s = trySave();
    notify();
    if (!s.ok) return { ok: false, errorCode: FRZ_ERR.STORAGE_WRITE_BLOCKED, reason: s.reason || "Kunde inte spara." };
    return { ok: true };
  }

  /* -----------------------------
    BLOCK 9/9 — State factories (FLOW)
  ----------------------------- */
  function createEmptyState(role) {
    const r = isValidRole(role) ? role : "ADMIN";
    const state = {
      meta: { schemaVersion: FRZ_SCHEMA_VERSION, createdAt: nowIso(), updatedAt: nowIso() },
      user: { role: r, activeUserId: "" },
      flags: { locked: false, lockReason: "", lockCode: "", readOnly: computeReadOnly(r) },
      data: { items: [], history: [], users: createDefaultUsers() }
    };
    state.user.activeUserId = pickActiveUserForRole(r, state.data.users);
    return state;
  }

  function createDemoState(role) {
    const now = nowIso();
    const r = isValidRole(role) ? role : "ADMIN";
    const state = createEmptyState(r);

    state.data.items = [
      {
        articleNo: "FZ-001",
        packSize: "2kg",
        supplier: "FoodSupplier AB",
        category: "Kyckling",
        pricePerKg: 89.0,
        minLevel: 6,
        tempClass: "FROZEN",
        requiresExpiry: true,
        isActive: true,
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" },
        sku: "FZ-001",
        name: "FoodSupplier AB • Kyckling • 2kg",
        unit: "fp",
        onHand: 12,
        min: 6,
        updatedAt: now
      },
      {
        articleNo: "FZ-002",
        packSize: "150g",
        supplier: "SeaTrade",
        category: "Lax",
        pricePerKg: 199.0,
        minLevel: 30,
        tempClass: "FROZEN",
        requiresExpiry: true,
        isActive: true,
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" },
        sku: "FZ-002",
        name: "SeaTrade • Lax • 150g",
        unit: "st",
        onHand: 48,
        min: 30,
        updatedAt: now
      },
      {
        articleNo: "FZ-003",
        packSize: "1kg",
        supplier: "VeggieCo",
        category: "Grönsaker",
        pricePerKg: 35.0,
        minLevel: 10,
        tempClass: "FROZEN",
        requiresExpiry: false,
        isActive: true,
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" },
        sku: "FZ-003",
        name: "VeggieCo • Grönsaker • 1kg",
        unit: "fp",
        onHand: 20,
        min: 10,
        updatedAt: now
      }
    ].map(normalizeItemAny).filter(Boolean);

    state.data.history = [normalizeHistory({ ts: now, type: "init_demo", sku: "", qty: 0, by: r, note: "Demo-data skapad." })];
    state.user.activeUserId = pickActiveUserForRole(r, state.data.users);
    return state;
  }

  function createLockedState(role, reason, code) {
    const r = isValidRole(role) ? role : "ADMIN";
    return {
      meta: { schemaVersion: FRZ_SCHEMA_VERSION, createdAt: nowIso(), updatedAt: nowIso() },
      user: { role: r, activeUserId: "" },
      flags: { locked: true, lockReason: safeStr(reason) || "Låst läge.", lockCode: safeStr(code) || FRZ_ERR.INVALID_SHAPE, readOnly: true },
      data: { items: [], history: [], users: createDefaultUsers() }
    };
  }

  function isEmptyDataset(state) {
    return !!state && state.data && Array.isArray(state.data.items) && state.data.items.length === 0;
  }
})();
