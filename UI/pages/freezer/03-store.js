/* ============================================================
AO-02/15 — Store (baseline, fail-closed) | FIL-ID: UI/pages/freezer/03-store.js
Projekt: Freezer (UI-only / localStorage-first)

P0-FIX:
- Denna fil MÅSTE definiera window.FreezerStore.
- Den får INTE råka innehålla admin/freezer.js (controller) — det orsakar FRZ_E_NOT_INIT.

P0 SUPPLIERS (DENNA PATCH):
- Leverantörsregister UTAN ny top-level state-nyckel.
- Återanvänder _state.history som källa (event-sourcing):
  -> create/update supplier skriver "supplier"-event
  -> listSuppliers() bygger listan från history
- När supplier skapas/uppdateras -> notify() -> UI kan rendera direkt.

NYTT (AUTOPATCH v1.1) — LOKAL PERSISTENS (SUPPLIERS):
- Spara/återläs _state.history via localStorage (endast history).
- Minimal scope: leverantörer byggs från history => leverantörer överlever reload.
- Storage-key: FRZ_DEMO_HISTORY_V1 (1 st, endast history JSON).
- Fail-closed: om storage är korrupt -> ignorera och fortsätt i demo-läge.

Beslut:
- Org-nr (orgNo) får vara TOMT (valfritt).
- Kontaktperson räcker med 1 st och får vara TOMT (valfritt).
- supplierId kan vara TOMT på produkt.
- Produkter kan kopplas till leverantör via supplierId:
  -> om supplierId är ifyllt måste leverantören finnas + vara aktiv.

POLICY (LÅST):
- Fail-closed
- XSS-safe (store renderar inget)
============================================================ */
(function () {
  "use strict";

  // ------------------------------------------------------------
  // Storage (lokal persistens för history)
  // ------------------------------------------------------------
  const STORAGE_KEY_HISTORY = "FRZ_DEMO_HISTORY_V1"; // endast history-array (supplier events)

  function readJsonFromLS(key) {
    try {
      const raw = window.localStorage ? window.localStorage.getItem(key) : null;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed;
    } catch {
      return null;
    }
  }

  function writeJsonToLS(key, value) {
    try {
      if (!window.localStorage) return false;
      const raw = JSON.stringify(value);
      window.localStorage.setItem(key, raw);
      return true;
    } catch {
      return false;
    }
  }

  function removeLS(key) {
    try {
      if (!window.localStorage) return;
      window.localStorage.removeItem(key);
    } catch {}
  }

  function sanitizeHistoryArray(arr) {
    // Fail-closed: godkänn bara array av objekt med basfält
    try {
      if (!Array.isArray(arr)) return [];
      const out = [];
      for (let i = 0; i < arr.length; i++) {
        const ev = arr[i];
        if (!ev || typeof ev !== "object") continue;
        const type = String(ev.type || "");
        const msg = String(ev.msg || "");
        const at = String(ev.at || "");
        const id = String(ev.id || "");
        const meta = (ev.meta && typeof ev.meta === "object") ? ev.meta : null;

        out.push({ id, at, type, msg, meta });
        if (out.length >= 500) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  function loadHistoryFromStorage() {
    const parsed = readJsonFromLS(STORAGE_KEY_HISTORY);
    const safe = sanitizeHistoryArray(parsed);
    return safe;
  }

  function persistHistoryToStorage() {
    // Vi sparar bara _state.history (max 500) för minimal risk/scope.
    try {
      const hist = Array.isArray(_state.history) ? _state.history.slice(0, 500) : [];
      writeJsonToLS(STORAGE_KEY_HISTORY, hist);
    } catch {}
  }

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

  function normStr(v) { return String(v == null ? "" : v).trim(); }
  function normEmail(v) { return normStr(v); }   // fail-soft: ingen validering här
  function normPhone(v) { return normStr(v); }   // fail-soft
  function normOrg(v) { return normStr(v); }     // valfritt

  // ------------------------------------------------------------
  // In-memory state (history persistas i LS)
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
    if (_state.history.length > 500) _state.history.length = 500;

    // PERSIST: skriv ut history till localStorage (fail-soft)
    persistHistoryToStorage();
  }

  // ------------------------------------------------------------
  // SUPPLIERS (P0) — byggs från history (ingen ny state-nyckel)
  // ------------------------------------------------------------
  function isSupplierEvent(ev) {
    try {
      if (!ev) return false;
      if (String(ev.type || "") !== "supplier") return false;
      const m = ev.meta && typeof ev.meta === "object" ? ev.meta : null;
      const s = m && m.supplier && typeof m.supplier === "object" ? m.supplier : null;
      return !!s;
    } catch {
      return false;
    }
  }

  function getSuppliersSnapshotFromHistory() {
    const byId = Object.create(null);
    const hist = Array.isArray(_state.history) ? _state.history : [];

    for (let i = hist.length - 1; i >= 0; i--) {
      const ev = hist[i];
      if (!isSupplierEvent(ev)) continue;

      const meta = ev.meta || {};
      const sup = meta.supplier || {};
      const id = normStr(sup.id);
      if (!id) continue;

      const action = normStr(meta.action || "upsert");

      if (action === "setActive") {
        const cur = byId[id] || {};
        byId[id] = Object.assign({}, cur, { id: id, active: !!sup.active, updatedAt: ev.at || nowIso() });
        continue;
      }

      const next = {
        id: id,
        companyName: normStr(sup.companyName),
        orgNo: normOrg(sup.orgNo), // kan vara ""
        contactPerson: normStr(sup.contactPerson), // kan vara ""
        phone: normPhone(sup.phone),
        email: normEmail(sup.email),
        address: normStr(sup.address),
        notes: normStr(sup.notes),
        active: ("active" in sup) ? !!sup.active : true,
        createdAt: sup.createdAt ? String(sup.createdAt) : (ev.at || nowIso()),
        updatedAt: ev.at || nowIso()
      };

      if (byId[id] && byId[id].createdAt) next.createdAt = byId[id].createdAt;
      byId[id] = next;
    }

    const list = Object.values(byId);

    list.sort((a, b) => {
      const an = String(a.companyName || "").toLowerCase();
      const bn = String(b.companyName || "").toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return String(a.orgNo || "").localeCompare(String(b.orgNo || ""));
    });

    return list;
  }

  function findSupplierByOrgNo(orgNo) {
    const want = normOrg(orgNo);
    if (!want) return null;
    const list = getSuppliersSnapshotFromHistory();
    return list.find(s => s && normOrg(s.orgNo) === want) || null;
  }

  function findSupplierById(id) {
    const want = normStr(id);
    if (!want) return null;
    const list = getSuppliersSnapshotFromHistory();
    return list.find(s => s && normStr(s.id) === want) || null;
  }

  function isSupplierActive(id) {
    const s = findSupplierById(id);
    if (!s) return false;
    return s.active !== false;
  }

  function validateSupplierInput(data, mode) {
    const d = (data && typeof data === "object") ? data : {};

    const companyName = normStr(d.companyName);
    const orgNo = normOrg(d.orgNo); // VALFRITT

    // KRAV: Företagsnamn
    if (!companyName) return { ok: false, reason: "Företagsnamn krävs." };

    // Valfria fält
    const contactPerson = normStr(d.contactPerson); // valfritt
    const phone = normPhone(d.phone);
    const email = normEmail(d.email);              // valfritt, ingen validering här
    const address = normStr(d.address);
    const notes = normStr(d.notes);

    // Unikhet: orgNo kontrolleras bara om det är ifyllt
    if (orgNo) {
      const existing = findSupplierByOrgNo(orgNo);
      if (existing) {
        if (mode === "create") return { ok: false, reason: "Org-nr finns redan." };
        if (mode === "update") {
          const updId = normStr(d.id);
          if (updId && existing.id !== updId) return { ok: false, reason: "Org-nr finns redan på annan leverantör." };
        }
      }
    }

    return {
      ok: true,
      supplier: { companyName, orgNo, contactPerson, phone, email, address, notes }
    };
  }

  // ------------------------------------------------------------
  // Demo baseline (in-memory) + history kan återläsas från LS
  // ------------------------------------------------------------
  function seedDemo() {
    _state.users = [
      { id: uid("u"), firstName: "Admin", perms: safeClone(ROLE_PERMS.ADMIN), active: true },
      { id: uid("u"), firstName: "Inköp", perms: safeClone(ROLE_PERMS.BUYER), active: true },
      { id: uid("u"), firstName: "Plock", perms: safeClone(ROLE_PERMS.PICKER), active: true }
    ];

    _state.items = [];
    _state.history = [];

    addHistory("info", "Demo initierad (in-memory).", { role: _state.role });
  }

  function hydrateFromStorageIfAny() {
    // Vi håller demo-setup för users/items men återläs history om den finns,
    // så leverantörer överlever reload.
    const hist = loadHistoryFromStorage();
    if (hist && Array.isArray(hist) && hist.length > 0) {
      _state.history = hist.slice(0, 500);
      // Lägg en info-event i minnet (utan att spamma storage för mycket)
      // (persistHistoryToStorage kallas av addHistory, så vi lägger INTE addHistory här)
      try {
        _state.history.unshift({
          id: uid("h"),
          at: nowIso(),
          type: "info",
          msg: "History återläst från localStorage (DEMO).",
          meta: { key: STORAGE_KEY_HISTORY }
        });
        if (_state.history.length > 500) _state.history.length = 500;
        persistHistoryToStorage();
      } catch {}
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  const FreezerStore = {
    init(opts) {
      try {
        const role = opts && opts.role ? String(opts.role) : "ADMIN";
        _state.role = normalizeRole(role);

        const ro = computeReadOnly(_state.role);
        _state.readOnly = ro.readOnly;
        _state.whyReadOnly = ro.why;

        // Bas-demo (users/items) men INTE radera history om den finns i LS
        seedDemo();
        const restored = hydrateFromStorageIfAny();

        clearLocked();
        notify();
        return { ok: true, restoredHistory: !!restored };
      } catch (e) {
        setLocked("FRZ_E_NOT_INIT");
        return { ok: false, reason: (e && e.message) ? e.message : "FRZ_E_NOT_INIT" };
      }
    },

    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      _subs.add(fn);
      try { fn(safeClone(_state)); } catch {}
      return () => { try { _subs.delete(fn); } catch {} };
    },

    getState() { return safeClone(_state); },

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

    hasPerm(perm) {
      const p = String(perm || "");
      const map = ROLE_PERMS[_state.role] || {};
      return !!map[p];
    },

    can(perm) { return FreezerStore.hasPerm(perm); },

    resetDemo() {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };

      // Rensa lokal history också (annars kommer leverantörer tillbaka efter reload)
      removeLS(STORAGE_KEY_HISTORY);

      seedDemo();
      notify();
      return { ok: true };
    },

    // -----------------------------
    // Suppliers API (P0)
    // -----------------------------
    listSuppliers(opts) {
      const includeInactive = !!(opts && opts.includeInactive);
      const list = getSuppliersSnapshotFromHistory();
      const out = includeInactive ? list : list.filter(s => s && s.active !== false);
      return safeClone(out);
    },

    createSupplier(data) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("inventory_write")) return { ok: false, reason: "Saknar behörighet (inventory_write)." };

      const v = validateSupplierInput(data, "create");
      if (!v.ok) return { ok: false, reason: v.reason || "Ogiltig leverantör." };

      const s = v.supplier;
      const supplierId = uid("sup");

      const supplier = {
        id: supplierId,
        companyName: s.companyName,
        orgNo: s.orgNo, // kan vara ""
        contactPerson: s.contactPerson, // kan vara ""
        phone: s.phone,
        email: s.email,
        address: s.address,
        notes: s.notes,
        active: true,
        createdAt: nowIso()
      };

      addHistory("supplier", "Leverantör skapad.", { action: "upsert", supplier: supplier });
      notify();
      return { ok: true, supplier: safeClone(supplier) };
    },

    updateSupplier(supplierId, patch) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("inventory_write")) return { ok: false, reason: "Saknar behörighet (inventory_write)." };

      const id = normStr(supplierId);
      if (!id) return { ok: false, reason: "supplierId saknas." };

      const cur = findSupplierById(id);
      if (!cur) return { ok: false, reason: "Leverantör hittades inte." };

      const merged = Object.assign({}, cur, (patch && typeof patch === "object" ? patch : {}), { id: id });
      const v = validateSupplierInput(merged, "update");
      if (!v.ok) return { ok: false, reason: v.reason || "Ogiltig leverantör." };

      const s = v.supplier;

      const supplier = {
        id: id,
        companyName: s.companyName,
        orgNo: s.orgNo,
        contactPerson: s.contactPerson,
        phone: s.phone,
        email: s.email,
        address: s.address,
        notes: s.notes,
        active: ("active" in merged) ? !!merged.active : (cur.active !== false),
        createdAt: cur.createdAt || nowIso()
      };

      addHistory("supplier", "Leverantör uppdaterad.", { action: "upsert", supplier: supplier });
      notify();
      return { ok: true, supplier: safeClone(supplier) };
    },

    setSupplierActive(supplierId, active) {
      const st = FreezerStore.getStatus();
      if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
      if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };
      if (!FreezerStore.can("inventory_write")) return { ok: false, reason: "Saknar behörighet (inventory_write)." };

      const id = normStr(supplierId);
      if (!id) return { ok: false, reason: "supplierId saknas." };

      const cur = findSupplierById(id);
      if (!cur) return { ok: false, reason: "Leverantör hittades inte." };

      addHistory("supplier", "Leverantör aktiv-status ändrad.", { action: "setActive", supplier: { id: id, active: !!active } });
      notify();
      return { ok: true };
    },

    // -----------------------------
    // Users API
    // -----------------------------
    listUsers() { return safeClone(_state.users || []); },

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

    // -----------------------------
    // Items API (med supplierId)
    // -----------------------------
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

      const supplierId = normStr(p.supplierId);
      if (supplierId) {
        if (!findSupplierById(supplierId)) return { ok: false, reason: "supplierId finns inte (okänd leverantör)." };
        if (!isSupplierActive(supplierId)) return { ok: false, reason: "Leverantören är inaktiv." };
      }

      const it = safeClone(p);
      it.articleNo = articleNo;
      it.supplierId = supplierId || "";

      if (typeof it.isActive !== "boolean") it.isActive = true;

      _state.items.push(it);
      addHistory("item", "Item skapad.", { articleNo, supplierId: supplierId || "" });
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

      if ("supplierId" in p) {
        const supId = normStr(p.supplierId);
        if (supId) {
          if (!findSupplierById(supId)) return { ok: false, reason: "supplierId finns inte (okänd leverantör)." };
          if (!isSupplierActive(supId)) return { ok: false, reason: "Leverantören är inaktiv." };
          it.supplierId = supId;
        } else {
          it.supplierId = "";
        }
      }

      it.packSize = String(p.packSize || it.packSize || "");
      it.supplier = String(p.supplier || it.supplier || "");
      it.category = String(p.category || it.category || "");
      it.tempClass = String(p.tempClass || it.tempClass || "");
      it.requiresExpiry = ("requiresExpiry" in p) ? !!p.requiresExpiry : !!it.requiresExpiry;
      it.isActive = ("isActive" in p) ? !!p.isActive : (it.isActive !== false);

      if ("pricePerKg" in p) it.pricePerKg = p.pricePerKg;
      if ("minLevel" in p) it.minLevel = p.minLevel;

      addHistory("item", "Item uppdaterad.", { articleNo: id, supplierId: String(it.supplierId || "") });
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
})();
