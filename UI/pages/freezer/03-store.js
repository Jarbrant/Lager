/* ============================================================
AO-02/15 — Store (baseline, fail-closed) | FIL-ID: UI/pages/freezer/03-store.js
Projekt: Freezer (UI-only / localStorage-first)

P0-FIX:
- Denna fil MÅSTE definiera window.FreezerStore.
- Den får INTE råka innehålla admin/freezer.js (controller) — det orsakar FRZ_E_NOT_INIT.

POLICY (LÅST):
- Inga nya storage-keys/datamodell
- Fail-closed
- XSS-safe (store renderar inget)

Notis:
- Detta är en robust baseline-store som kör "demo i minne".
- Om ni redan har en Contract/Storage-nyckel i 04-contract.js kan den kopplas in senare.
============================================================ */
(function () {
  "use strict";

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function nowIso() {
    try { return new Date().toISOString(); } catch { return ""; }
  }

  function uid(prefix) {
    const p = prefix || "id";
    const r = Math.random().toString(16).slice(2);
    return `${p}_${Date.now().toString(16)}_${r}`;
  }

  function safeClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch { return obj; }
  }

  // ------------------------------------------------------------
  // In-memory state (no new storage keys)
  // ------------------------------------------------------------
  const _subs = new Set();

  const _state = {
    role: "ADMIN",
    locked: false,
    reason: "",
    readOnly: false,
    whyReadOnly: "",
    users: [],
    items: [],
    history: []
  };

  // Permissions per role (baseline)
  // SYSTEM_ADMIN: read-only, no writes
  const ROLE_PERMS = {
    ADMIN: {
      users_manage: true,
      inventory_write: true,
      history_write: true,
      dashboard_view: true
    },
    BUYER: {
      users_manage: false,
      inventory_write: true,
      history_write: false,
      dashboard_view: true
    },
    PICKER: {
      users_manage: false,
      inventory_write: false,
      history_write: true,
      dashboard_view: true
    },
    SYSTEM_ADMIN: {
      users_manage: false,
      inventory_write: false,
      history_write: false,
      dashboard_view: true
    }
  };

  function computeReadOnly(role) {
    if (role === "SYSTEM_ADMIN") return { readOnly: true, why: "SYSTEM_ADMIN är read-only (policy)." };
    return { readOnly: false, why: "" };
  }

  function notify() {
    const snap = safeClone(_state);
    for (const fn of _subs) {
      try { fn(snap); } catch { /* ignore */ }
    }
  }

  function setLocked(reason) {
    _state.locked = true;
    _state.reason = String(reason || "FRZ_E_NOT_INIT");
    notify();
  }

  function clearLocked() {
    _state.locked = false;
    _state.reason = "";
    notify();
  }

  function addHistory(type, msg, meta) {
    _state.history.unshift({
      id: uid("h"),
      at: nowIso(),
      type: String(type || "info"),
      msg: String(msg || ""),
      meta: meta ? safeClone(meta) : null
    });
    // håll listan rimlig
    if (_state.history.length > 500) _state.history.length = 500;
  }

  // ------------------------------------------------------------
  // Demo baseline (in-memory)
  // ------------------------------------------------------------
  function seedDemo() {
    _state.users = [
      { id: uid("u"), firstName: "Admin", perms: safeClone(ROLE_PERMS.ADMIN), active: true },
      { id: uid("u"), firstName: "Inköp", perms: safeClone(ROLE_PERMS.BUYER), active: true },
      { id: uid("u"), firstName: "Plock", perms: safeClone(ROLE_PERMS.PICKER), active: true }
    ];

    _state.items = [
      // tomt baseline – användaren kan lägga till
    ];

    _state.history = [];
    addHistory("info", "Demo initierad (in-memory).", { role: _state.role });
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  const FreezerStore = {
    // Init must exist
    init(opts) {
      try {
        const role = opts && opts.role ? String(opts.role) : "ADMIN";
        _state.role = normalizeRole(role);

        const ro = computeReadOnly(_state.role);
        _state.readOnly = ro.readOnly;
        _state.whyReadOnly = ro.why;

        // Baseline: starta alltid demo i minne (ingen ny storage-key).
        seedDemo();
        clearLocked();
        notify();
        return { ok: true };
      } catch (e) {
        setLocked("FRZ_E_NOT_INIT");
        return { ok: false, reason: (e && e.message) ? e.message : "FRZ_E_NOT_INIT" };
      }
    },

    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      _subs.add(fn);
      // direkt callback
      try { fn(safeClone(_state)); } catch { /* ignore */ }
      return () => { try { _subs.delete(fn); } catch { /* ignore */ } };
    },

    getState() {
      return safeClone(_state);
    },

    getStatus() {
      return {
        role: _state.role,
        locked: !!_state.locked,
        reason: String(_state.reason || ""),
        readOnly: !!_state.readOnly,
        whyReadOnly: String(_state.whyReadOnly || "")
      };
    },

    setRole(role) {
      const next = normalizeRole(role);
      _state.role = next;

      const ro = computeReadOnly(_state.role);
      _state.readOnly = ro.readOnly;
      _state.whyReadOnly = ro.why;

      addHistory("info", `Roll bytt till ${_state.role}.`, null);
      notify();
      return { ok: true };
    },

    // RBAC helpers
    hasPerm(perm) {
      const p = String(perm || "");
      const map = ROLE_PERMS[_state.role] || {};
      return !!map[p];
    },

    can(perm) {
      // alias för äldre kod
      return FreezerStore.hasPerm(perm);
    },

    // Demo reset
    resetDemo() {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };

      seedDemo();
      notify();
      return { ok: true };
    },

    // ----------------------------------------------------------
    // Users API (used by admin/freezer.js)
    // ----------------------------------------------------------
    listUsers() {
      return safeClone(_state.users || []);
    },

    createUser(data) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("users_manage")) return { ok: false, reason: "Saknar users_manage." };

      const firstName = data && data.firstName ? String(data.firstName).trim() : "";
      if (!firstName) return { ok: false, reason: "Förnamn krävs." };

      const exists = (_state.users || []).some(u => u && String(u.firstName || "").toLowerCase() === firstName.toLowerCase());
      if (exists) return { ok: false, errorCode: "FRZ_E_USER_NAME_NOT_UNIQUE", reason: "Förnamn måste vara unikt." };

      const perms = (data && data.perms && typeof data.perms === "object") ? safeClone(data.perms) : {};
      const u = { id: uid("u"), firstName, perms, active: true };
      _state.users.push(u);

      addHistory("user", "User skapad.", { userId: u.id, firstName: u.firstName });
      notify();
      return { ok: true, user: safeClone(u) };
    },

    updateUser(userId, patch) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("users_manage")) return { ok: false, reason: "Saknar users_manage." };

      const id = String(userId || "");
      const u = (_state.users || []).find(x => x && x.id === id);
      if (!u) return { ok: false, reason: "User hittades inte." };

      const nextFirst = patch && typeof patch.firstName === "string" ? patch.firstName.trim() : u.firstName;
      if (!nextFirst) return { ok: false, reason: "Förnamn krävs." };

      // Unik
      const clash = (_state.users || []).some(x => x && x.id !== id && String(x.firstName || "").toLowerCase() === nextFirst.toLowerCase());
      if (clash) return { ok: false, errorCode: "FRZ_E_USER_NAME_NOT_UNIQUE", reason: "Förnamn måste vara unikt." };

      u.firstName = nextFirst;
      if (patch && patch.perms && typeof patch.perms === "object") u.perms = safeClone(patch.perms);

      addHistory("user", "User uppdaterad.", { userId: u.id });
      notify();
      return { ok: true };
    },

    setUserActive(userId, active) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("users_manage")) return { ok: false, reason: "Saknar users_manage." };

      const id = String(userId || "");
      const u = (_state.users || []).find(x => x && x.id === id);
      if (!u) return { ok: false, reason: "User hittades inte." };

      u.active = !!active;
      addHistory("user", "User aktiv-status ändrad.", { userId: u.id, active: u.active });
      notify();
      return { ok: true };
    },

    // ----------------------------------------------------------
    // Items API (used by admin/freezer.js)
    // ----------------------------------------------------------
    listItems(opts) {
      const includeInactive = !!(opts && opts.includeInactive);
      const items = Array.isArray(_state.items) ? _state.items : [];
      const out = includeInactive ? items : items.filter(x => x && x.isActive !== false);
      return safeClone(out);
    },

    createItem(payload) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("inventory_write")) return { ok: false, reason: "Saknar inventory_write." };

      const p = payload && typeof payload === "object" ? payload : null;
      if (!p) return { ok: false, reason: "Fel payload." };

      const articleNo = String(p.articleNo || "").trim();
      if (!articleNo) return { ok: false, reason: "articleNo krävs." };

      const exists = (_state.items || []).some(x => x && String(x.articleNo || "") === articleNo);
      if (exists) return { ok: false, reason: "articleNo måste vara unikt." };

      const it = safeClone(p);
      it.articleNo = articleNo;
      if (typeof it.isActive !== "boolean") it.isActive = true;

      _state.items.push(it);
      addHistory("item", "Item skapad.", { articleNo });
      notify();
      return { ok: true };
    },

    updateItem(articleNo, patch) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("inventory_write")) return { ok: false, reason: "Saknar inventory_write." };

      const id = String(articleNo || "").trim();
      const it = (_state.items || []).find(x => x && String(x.articleNo || "") === id);
      if (!it) return { ok: false, reason: "Item hittades inte." };

      const p = patch && typeof patch === "object" ? patch : {};
      // articleNo är låst nyckel – uppdatera inte
      it.packSize = String(p.packSize || it.packSize || "");
      it.supplier = String(p.supplier || it.supplier || "");
      it.category = String(p.category || it.category || "");
      it.tempClass = String(p.tempClass || it.tempClass || "");
      it.requiresExpiry = ("requiresExpiry" in p) ? !!p.requiresExpiry : !!it.requiresExpiry;
      it.isActive = ("isActive" in p) ? !!p.isActive : (it.isActive !== false);

      if ("pricePerKg" in p) it.pricePerKg = p.pricePerKg;
      if ("minLevel" in p) it.minLevel = p.minLevel;

      addHistory("item", "Item uppdaterad.", { articleNo: id });
      notify();
      return { ok: true };
    },

    archiveItem(articleNo) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("inventory_write")) return { ok: false, reason: "Saknar inventory_write." };

      const id = String(articleNo || "").trim();
      const it = (_state.items || []).find(x => x && String(x.articleNo || "") === id);
      if (!it) return { ok: false, reason: "Item hittades inte." };

      it.isActive = false;
      addHistory("item", "Item arkiverad.", { articleNo: id });
      notify();
      return { ok: true };
    },

    deleteItem(articleNo) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("inventory_write")) return { ok: false, reason: "Saknar inventory_write." };

      const id = String(articleNo || "").trim();
      const idx = (_state.items || []).findIndex(x => x && String(x.articleNo || "") === id);
      if (idx < 0) return { ok: false, reason: "Item hittades inte." };

      // Guard för framtiden: om referenser finns kan ni blockera här
      _state.items.splice(idx, 1);
      addHistory("item", "Item raderad.", { articleNo: id });
      notify();
      return { ok: true };
    }
  };

  function normalizeRole(role) {
    const r = String(role || "").toUpperCase();
    if (r === "ADMIN" || r === "BUYER" || r === "PICKER" || r === "SYSTEM_ADMIN") return r;
    return "ADMIN";
  }

  // ------------------------------------------------------------
  // Expose (P0)
  // ------------------------------------------------------------
  window.FreezerStore = FreezerStore;

  // If något går fel ovan ska vi fail-closed på ett kontrollerat sätt
  // (men här har vi redan definierat API)
})();
