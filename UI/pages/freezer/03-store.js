/* ============================================================
AO-02/15 — Store (baseline, fail-closed) | FIL-ID: UI/pages/freezer/03-store.js
Projekt: Freezer (UI-only / localStorage-first)

P0-FIX:
- Denna fil MÅSTE definiera window.FreezerStore.
- Den får INTE råka innehålla admin/freezer.js (controller) — det orsakar FRZ_E_NOT_INIT.

P0 SUPPLIERS:
- Leverantörsregister UTAN ny top-level state-nyckel.
- Återanvänder _state.history som källa (event-sourcing):
  -> create/update supplier skriver "supplier"-event
  -> listSuppliers() bygger listan från history
- När supplier skapas/uppdateras -> notify() -> UI kan rendera direkt.

AUTOPATCH v1.4 — P0 INIT-GUARD (utan nya storage keys/state keys):
- P0: Store startar LOCKED (FRZ_E_NOT_INIT) tills init() körs.
  Detta förhindrar att controller tror att store redan är initad.
- history (leverantörer + lagersaldo-events): FRZ_DEMO_HISTORY_V1
- items  (produkter/masterdata):             FRZ_DEMO_ITEMS_V1
- Lagersaldo byggs från history (event-sourcing): INGA nya storage-keys.

POLICY (LÅST):
- Fail-closed
- XSS-safe (store renderar inget)
============================================================ */
(function () {
  "use strict";

  // ------------------------------------------------------------
  // Storage (lokal persistens för demo)
  // ------------------------------------------------------------
  const STORAGE_KEY_HISTORY = "FRZ_DEMO_HISTORY_V1"; // history-array (supplier + stock events)
  const STORAGE_KEY_ITEMS = "FRZ_DEMO_ITEMS_V1";     // items-array (produkter/masterdata)

  function hasLocalStorage() {
    try { return !!window.localStorage; } catch { return false; }
  }

  function readJsonFromLS(key) {
    try {
      const raw = hasLocalStorage() ? window.localStorage.getItem(key) : null;
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function writeJsonToLS(key, value) {
    try {
      if (!hasLocalStorage()) return false;
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function removeLS(key) {
    try {
      if (!hasLocalStorage()) return;
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
        out.push({
          id: String(ev.id || ""),
          at: String(ev.at || ""),
          type: String(ev.type || ""),
          msg: String(ev.msg || ""),
          meta: (ev.meta && typeof ev.meta === "object") ? ev.meta : null
        });
        if (out.length >= 500) break;
      }
      return out;
    } catch {
      return [];
    }
  }

  function loadHistoryFromStorage() {
    const parsed = readJsonFromLS(STORAGE_KEY_HISTORY);
    return sanitizeHistoryArray(parsed);
  }

  function persistHistoryToStorage() {
    try {
      const hist = Array.isArray(_state.history) ? _state.history.slice(0, 500) : [];
      writeJsonToLS(STORAGE_KEY_HISTORY, hist);
    } catch {}
  }

  function sanitizeItemsArray(arr) {
    // Fail-closed: sanera minimalt; artikelnummer måste vara sträng
    try {
      if (!Array.isArray(arr)) return [];
      const byArticle = Object.create(null);
      const out = [];

      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        if (!it || typeof it !== "object") continue;

        const articleNo = String(it.articleNo || "").trim();
        if (!articleNo) continue;

        if (byArticle[articleNo]) continue; // dedupe fail-closed
        byArticle[articleNo] = true;

        const supplierId = String(it.supplierId || "").trim();

        const next = {
          articleNo,
          supplierId,

          // Frivilliga fält (normaliseras)
          productName: String(it.productName || "").trim(),
          category: String(it.category || "").trim(),
          packSize: String(it.packSize || "").trim(),
          unit: String(it.unit || "").trim(),
          tempClass: String(it.tempClass || "").trim(),
          ean: String(it.ean || "").trim(),
          notes: String(it.notes || "").trim(),
          location: String(it.location || "").trim(),

          // Tal/boolean (fail-soft: om NaN -> null)
          pricePerKg: (typeof it.pricePerKg === "number" && isFinite(it.pricePerKg)) ? it.pricePerKg : null,
          minLevel: (typeof it.minLevel === "number" && isFinite(it.minLevel)) ? it.minLevel : null,
          requiresExpiry: !!it.requiresExpiry,

          // Extra frivilliga fält (P2, men stöds)
          maxLevel: (typeof it.maxLevel === "number" && isFinite(it.maxLevel)) ? it.maxLevel : null,
          targetLevel: (typeof it.targetLevel === "number" && isFinite(it.targetLevel)) ? it.targetLevel : null,
          lastPrice: (typeof it.lastPrice === "number" && isFinite(it.lastPrice)) ? it.lastPrice : null,
          lastPriceAt: String(it.lastPriceAt || "").trim(),
          lastSupplierRef: String(it.lastSupplierRef || "").trim(),
          lastInventoryAt: String(it.lastInventoryAt || "").trim(),

          // Aktivitet
          isActive: ("isActive" in it) ? !!it.isActive : true
        };

        out.push(next);
        if (out.length >= 2000) break;
      }

      return out;
    } catch {
      return [];
    }
  }

  function loadItemsFromStorage() {
    const parsed = readJsonFromLS(STORAGE_KEY_ITEMS);
    return sanitizeItemsArray(parsed);
  }

  function persistItemsToStorage() {
    try {
      const items = Array.isArray(_state.items) ? _state.items.slice(0, 2000) : [];
      writeJsonToLS(STORAGE_KEY_ITEMS, items);
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
  function normEmail(v) { return normStr(v); }
  function normPhone(v) { return normStr(v); }
  function normOrg(v) { return normStr(v); }

  function normNumOrNull(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    return n;
  }

  function normIntOrNull(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    return Math.trunc(n);
  }

  // ------------------------------------------------------------
  // In-memory state (history + items persistas i LS)
  // ------------------------------------------------------------
  const _subs = new Set();

  const _state = {
    role: "ADMIN",

    // P0: starta låst tills init() körs
    locked: true,
    reason: "FRZ_E_NOT_INIT",

    readOnly: false,
    whyReadOnly: "",
    users: [],
    items: [],
    history: []
  };

  // Permissions per role (baseline)
  const ROLE_PERMS = {
    ADMIN: { users_manage: true, inventory_write: true, history_write: true, dashboard_view: true },
    BUYER: { users_manage: false, inventory_write: true, history_write: false, dashboard_view: true },
    PICKER:{ users_manage: false, inventory_write: false, history_write: true, dashboard_view: true },
    SYSTEM_ADMIN:{ users_manage: false, inventory_write: false, history_write: false, dashboard_view: true }
  };

  function computeReadOnly(role) {
    if (role === "SYSTEM_ADMIN") return { readOnly: true, why: "SYSTEM_ADMIN är read-only (policy)." };
    return { readOnly: false, why: "" };
  }

  function notify() {
    const snap = safeClone(_state);
    for (const fn of _subs) {
      try { fn(snap); } catch {}
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
    persistHistoryToStorage();
  }

  // ------------------------------------------------------------
  // SUPPLIERS — byggs från history
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
        orgNo: normOrg(sup.orgNo),
        contactPerson: normStr(sup.contactPerson),
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
    const orgNo = normOrg(d.orgNo);

    if (!companyName) return { ok: false, reason: "Företagsnamn krävs." };

    const contactPerson = normStr(d.contactPerson);
    const phone = normPhone(d.phone);
    const email = normEmail(d.email);
    const address = normStr(d.address);
    const notes = normStr(d.notes);

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

    return { ok: true, supplier: { companyName, orgNo, contactPerson, phone, email, address, notes } };
  }

  // ------------------------------------------------------------
  // LAGERSALDO — byggs från history (inga nya state-nycklar)
  // ------------------------------------------------------------
  function isStockEvent(ev) {
    try {
      if (!ev) return false;
      if (String(ev.type || "") !== "stock") return false;
      const m = ev.meta && typeof ev.meta === "object" ? ev.meta : null;
      if (!m) return false;
      const action = normStr(m.action);
      if (action !== "adjust" && action !== "set") return false;
      const articleNo = normStr(m.articleNo);
      if (!articleNo) return false;
      return true;
    } catch {
      return false;
    }
  }

  function getItemByArticleNo(articleNo) {
    const id = normStr(articleNo);
    if (!id) return null;
    const items = Array.isArray(_state.items) ? _state.items : [];
    return items.find(it => it && normStr(it.articleNo) === id) || null;
  }

  function getStockSnapshotFromHistory() {
    const byArticle = Object.create(null);
    const hist = Array.isArray(_state.history) ? _state.history : [];

    for (let i = hist.length - 1; i >= 0; i--) {
      const ev = hist[i];
      if (!isStockEvent(ev)) continue;

      const m = ev.meta || {};
      const articleNo = normStr(m.articleNo);
      if (!articleNo) continue;

      const action = normStr(m.action);
      const unit = normStr(m.unit);
      const reasonCode = normStr(m.reasonCode);
      const at = normStr(ev.at) || nowIso();

      const cur = byArticle[articleNo] || { articleNo, onHand: 0, unit: "", updatedAt: "", lastReasonCode: "" };

      if (action === "set") {
        const qty = normIntOrNull(m.qty);
        if (qty == null) continue;
        cur.onHand = qty;
      } else if (action === "adjust") {
        const delta = normIntOrNull(m.delta);
        if (delta == null) continue;
        cur.onHand = (Number(cur.onHand) || 0) + delta;
      }

      if (unit) cur.unit = unit;
      cur.updatedAt = at;
      cur.lastReasonCode = reasonCode || cur.lastReasonCode || "";

      byArticle[articleNo] = cur;
    }

    const out = Object.values(byArticle);
    out.sort((a, b) => String(a.articleNo || "").localeCompare(String(b.articleNo || "")));
    return out;
  }

  function validateStockWriteCommon(st) {
    if (st.locked) return { ok: false, reason: st.reason || "Låst läge." };
    if (st.readOnly) return { ok: false, reason: st.whyReadOnly || "Read-only." };

    // AUTOPATCH (P0):
    // Stock-ändringar ska kunna göras av BUYER (inventory_write) och PICKER (history_write).
    const canWrite = FreezerStore.can("inventory_write") || FreezerStore.can("history_write");
    if (!canWrite) return { ok: false, reason: "Saknar inventory_write/history_write." };

    return { ok: true };
  }

  // ------------------------------------------------------------
  // Demo baseline + hydrate från storage
  // ------------------------------------------------------------
  function seedUsers() {
    _state.users = [
      { id: uid("u"), firstName: "Admin", perms: safeClone(ROLE_PERMS.ADMIN), active: true },
      { id: uid("u"), firstName: "Inköp", perms: safeClone(ROLE_PERMS.BUYER), active: true },
      { id: uid("u"), firstName: "Plock", perms: safeClone(ROLE_PERMS.PICKER), active: true }
    ];
  }

  function initDemoStateFromStorageOrEmpty() {
    seedUsers();

    const hist = loadHistoryFromStorage();
    const items = loadItemsFromStorage();

    const hasHist = Array.isArray(hist) && hist.length > 0;
    const hasItems = Array.isArray(items) && items.length > 0;

    _state.history = hasHist ? hist.slice(0, 500) : [];
    _state.items = hasItems ? items.slice(0, 2000) : [];

    if (_state.items.length > 0) {
      for (let i = 0; i < _state.items.length; i++) {
        const it = _state.items[i];
        if (!it) continue;
        const sid = normStr(it.supplierId);
        if (sid && !findSupplierById(sid)) it.supplierId = "";
      }
    }

    if (hasHist || hasItems) {
      _state.history.unshift({
        id: uid("h"),
        at: nowIso(),
        type: "info",
        msg: "DEMO återläst från localStorage.",
        meta: { historyKey: STORAGE_KEY_HISTORY, itemsKey: STORAGE_KEY_ITEMS }
      });
      if (_state.history.length > 500) _state.history.length = 500;

      persistHistoryToStorage();
      persistItemsToStorage();
      return true;
    }

    _state.history = [];
    _state.items = [];

    _state.history.unshift({
      id: uid("h"),
      at: nowIso(),
      type: "info",
      msg: "Demo initierad (localStorage-first).",
      meta: { role: _state.role }
    });
    if (_state.history.length > 500) _state.history.length = 500;

    persistHistoryToStorage();
    persistItemsToStorage();
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

        const restored = initDemoStateFromStorageOrEmpty();

        clearLocked();
        notify();
        return { ok: true, restored: !!restored };
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

      removeLS(STORAGE_KEY_HISTORY);
      removeLS(STORAGE_KEY_ITEMS);

      seedUsers();
      _state.items = [];
      _state.history = [];

      _state.history.unshift({
        id: uid("h"),
        at: nowIso(),
        type: "info",
        msg: "Demo återställd (localStorage rensad).",
        meta: { role: _state.role }
      });
      if (_state.history.length > 500) _state.history.length = 500;

      persistHistoryToStorage();
      persistItemsToStorage();

      notify();
      return { ok: true };
    },

    // -----------------------------
    // Suppliers API
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
        orgNo: s.orgNo,
        contactPerson: s.contactPerson,
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
    // Items API (produkter/masterdata)
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

      const pricePerKg = normNumOrNull(p.pricePerKg);
      const minLevel = normNumOrNull(p.minLevel);
      const maxLevel = normNumOrNull(p.maxLevel);
      const targetLevel = normNumOrNull(p.targetLevel);
      const lastPrice = normNumOrNull(p.lastPrice);

      if (p.pricePerKg != null && p.pricePerKg !== "" && pricePerKg == null) return { ok: false, reason: "kg/pris (pricePerKg) måste vara ett nummer." };
      if (p.minLevel != null && p.minLevel !== "" && minLevel == null) return { ok: false, reason: "Min-nivå (minLevel) måste vara ett nummer." };
      if (p.maxLevel != null && p.maxLevel !== "" && maxLevel == null) return { ok: false, reason: "Max-nivå (maxLevel) måste vara ett nummer." };
      if (p.targetLevel != null && p.targetLevel !== "" && targetLevel == null) return { ok: false, reason: "Mål-nivå (targetLevel) måste vara ett nummer." };
      if (p.lastPrice != null && p.lastPrice !== "" && lastPrice == null) return { ok: false, reason: "Senaste pris (lastPrice) måste vara ett nummer." };

      const it = {
        articleNo,
        supplierId: supplierId || "",

        productName: String(p.productName || "").trim(),
        category: String(p.category || "").trim(),
        packSize: String(p.packSize || "").trim(),
        unit: String(p.unit || "").trim(),
        tempClass: String(p.tempClass || "").trim(),
        ean: String(p.ean || "").trim(),
        notes: String(p.notes || "").trim(),
        location: String(p.location || "").trim(),

        pricePerKg: pricePerKg,
        minLevel: minLevel,
        requiresExpiry: !!p.requiresExpiry,

        maxLevel: maxLevel,
        targetLevel: targetLevel,
        lastPrice: lastPrice,
        lastPriceAt: String(p.lastPriceAt || "").trim(),
        lastSupplierRef: String(p.lastSupplierRef || "").trim(),
        lastInventoryAt: String(p.lastInventoryAt || "").trim(),

        isActive: ("isActive" in p) ? !!p.isActive : true
      };

      _state.items.push(it);
      persistItemsToStorage();

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

      if ("productName" in p) it.productName = String(p.productName || "").trim();
      if ("category" in p) it.category = String(p.category || "").trim();
      if ("packSize" in p) it.packSize = String(p.packSize || "").trim();
      if ("unit" in p) it.unit = String(p.unit || "").trim();
      if ("tempClass" in p) it.tempClass = String(p.tempClass || "").trim();
      if ("ean" in p) it.ean = String(p.ean || "").trim();
      if ("notes" in p) it.notes = String(p.notes || "").trim();
      if ("location" in p) it.location = String(p.location || "").trim();

      if ("requiresExpiry" in p) it.requiresExpiry = !!p.requiresExpiry;
      if ("isActive" in p) it.isActive = !!p.isActive;

      if ("pricePerKg" in p) {
        const n = normNumOrNull(p.pricePerKg);
        if (p.pricePerKg != null && p.pricePerKg !== "" && n == null) return { ok: false, reason: "kg/pris (pricePerKg) måste vara ett nummer." };
        it.pricePerKg = n;
      }

      if ("minLevel" in p) {
        const n = normNumOrNull(p.minLevel);
        if (p.minLevel != null && p.minLevel !== "" && n == null) return { ok: false, reason: "Min-nivå (minLevel) måste vara ett nummer." };
        it.minLevel = n;
      }

      if ("maxLevel" in p) {
        const n = normNumOrNull(p.maxLevel);
        if (p.maxLevel != null && p.maxLevel !== "" && n == null) return { ok: false, reason: "Max-nivå (maxLevel) måste vara ett nummer." };
        it.maxLevel = n;
      }

      if ("targetLevel" in p) {
        const n = normNumOrNull(p.targetLevel);
        if (p.targetLevel != null && p.targetLevel !== "" && n == null) return { ok: false, reason: "Mål-nivå (targetLevel) måste vara ett nummer." };
        it.targetLevel = n;
      }

      if ("lastPrice" in p) {
        const n = normNumOrNull(p.lastPrice);
        if (p.lastPrice != null && p.lastPrice !== "" && n == null) return { ok: false, reason: "Senaste pris (lastPrice) måste vara ett nummer." };
        it.lastPrice = n;
      }

      if ("lastPriceAt" in p) it.lastPriceAt = String(p.lastPriceAt || "").trim();
      if ("lastSupplierRef" in p) it.lastSupplierRef = String(p.lastSupplierRef || "").trim();
      if ("lastInventoryAt" in p) it.lastInventoryAt = String(p.lastInventoryAt || "").trim();

      persistItemsToStorage();

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
      persistItemsToStorage();

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
      persistItemsToStorage();

      addHistory("item", "Item raderad.", { articleNo: id });
      notify();
      return { ok: true };
    },

    // -----------------------------
    // Stock API (events i history)
    // -----------------------------
    listStock() { return safeClone(getStockSnapshotFromHistory()); },

    getStock(articleNo) {
      const id = normStr(articleNo);
      if (!id) return null;
      const snap = getStockSnapshotFromHistory();
      return snap.find(x => x && normStr(x.articleNo) === id) || { articleNo: id, onHand: 0, unit: "", updatedAt: "", lastReasonCode: "" };
    },

    adjustStock(input) {
      const st = FreezerStore.getStatus();
      const ok = validateStockWriteCommon(st);
      if (!ok.ok) return ok;

      const p = (input && typeof input === "object") ? input : {};
      const articleNo = normStr(p.articleNo);
      if (!articleNo) return { ok: false, reason: "articleNo krävs." };

      const it = getItemByArticleNo(articleNo);
      if (!it) return { ok: false, reason: "Okänt artikelnummer (skapa produkt först)." };

      const delta = normIntOrNull(p.delta);
      if (delta == null || delta === 0) return { ok: false, reason: "delta måste vara ett heltal (≠ 0)." };

      const unit = normStr(p.unit) || normStr(it.unit) || "";
      const reasonCode = normStr(p.reasonCode);
      const note = normStr(p.note);
      const ref = normStr(p.ref);

      addHistory("stock", "Lagersaldo ändrat.", { action: "adjust", articleNo, delta, unit, reasonCode, note, ref });
      notify();
      return { ok: true };
    },

    setStock(input) {
      const st = FreezerStore.getStatus();
      const ok = validateStockWriteCommon(st);
      if (!ok.ok) return ok;

      const p = (input && typeof input === "object") ? input : {};
      const articleNo = normStr(p.articleNo);
      if (!articleNo) return { ok: false, reason: "articleNo krävs." };

      const it = getItemByArticleNo(articleNo);
      if (!it) return { ok: false, reason: "Okänt artikelnummer (skapa produkt först)." };

      const qty = normIntOrNull(p.qty);
      if (qty == null || qty < 0) return { ok: false, reason: "qty måste vara ett heltal (>= 0)." };

      const unit = normStr(p.unit) || normStr(it.unit) || "";
      const reasonCode = normStr(p.reasonCode);
      const note = normStr(p.note);
      const ref = normStr(p.ref);

      addHistory("stock", "Lagersaldo satt.", { action: "set", articleNo, qty, unit, reasonCode, note, ref });

      try {
        if (reasonCode.toUpperCase() === "INVENTERING") {
          it.lastInventoryAt = nowIso();
          persistItemsToStorage();
        }
      } catch {}

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

/* ============================================================
ÄNDRINGSLOGG (≤8)
1) P0: Store startar LOCKED (FRZ_E_NOT_INIT) tills init() körs → controller kan inte felaktigt hoppa över init/hydrate.
2) P0: Stock-write visar nu korrekt policy: inventory_write OR history_write (BUYER/PICKER) → PICKER kan göra OUT.
3) Inga nya storage keys, inga nya top-level state-nycklar.
============================================================ */

/* ============================================================
TESTNOTERINGAR (3–10)
- Öppna buyer/freezer.html → kör: window.FreezerStore.getStatus() före init (ska visa locked:true).
- Efter att sidan laddat: window.FreezerStore.getStatus() (ska visa locked:false).
- Logga in som Plock (PICKER) → försök justera stock (OUT) → ska inte blockas av "Saknar inventory_write".
- Skapa leverantör (BUYER/ADMIN) → reload → window.FreezerStore.listSuppliers() ska visa leverantören.
============================================================ */
