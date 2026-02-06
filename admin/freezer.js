/* ============================================================
AO-03/15 — Users CRUD + rättigheter (Admin) | BLOCK 4/4
AUTOPATCH | FIL: Lager/admin/freezer.js
Projekt: Freezer (UI-only / localStorage-first)

AO-04/15 — Produktregister (Items) CRUD (Admin) — delegation (tills flytt i AO-12)
AO-11/15 — Router: shared views i meny för alla roller (Saldo/Historik)
AO-15/15 — QA-stabilisering:
- Inga dubbla listeners vid vybyte / dubbel script-load (init-guard)
- Korrupt storage -> read-only men navigation funkar (shim-store fail-soft)
- Robust scope-guard + readVal

P0 FIX (DENNA PATCH):
- BUYER (INKÖPARE) ska ha egen sida: Lager/buyer/freezer.html
- När man väljer roll=BUYER i admin-sidan -> redirect direkt till buyer-sidan.
- Undvik dubbel-navigering: om legacy-tabs finns (Dashboard/Saldo/Historik),
  så ska router-menyn INTE visa "shared-saldo" + "shared-history".
- Förbättra label: "Inköp • Dashboard" -> "Inköp" (endast UI-text, ingen logik ändras).

Policy:
- Inga nya storage-keys/datamodell
- XSS-safe (render sköter textContent)
============================================================ */

(function () {
  "use strict";

  // ------------------------------------------------------------
  // AO-15: INIT-GUARD (förhindra dubbla document-level listeners)
  // ------------------------------------------------------------
  if (window.__FRZ_ADMIN_PAGE_INIT__) {
    console.warn("[Freezer] admin/freezer.js redan initierad (guard).");
    return;
  }
  window.__FRZ_ADMIN_PAGE_INIT__ = true;

  const tabDashboard = byId("tabDashboard");
  const tabSaldo = byId("tabSaldo");
  const tabHistorik = byId("tabHistorik");

  const userSelect = byId("frzUserSelect");
  const resetBtn = byId("frzResetDemoBtn");

  // Router shell (AO-11)
  const viewMenu = byId("freezerViewMenu");
  const viewRoot = byId("freezerViewRoot");

  // Users UI (legacy panel i dashboard)
  const usersPanel = byId("frzUsersPanel");
  const usersList = byId("frzUsersList");

  const msgBox = byId("frzUsersMsg");
  const msgTitle = byId("frzUsersMsgTitle");
  const msgText = byId("frzUsersMsgText");

  const formTitle = byId("frzUserFormTitle");
  const formMode = byId("frzUserFormMode");
  const firstNameInput = byId("frzUserFirstName");
  const editingIdInput = byId("frzUserEditingId");
  const saveBtn = byId("frzUserSaveBtn");
  const cancelBtn = byId("frzUserCancelBtn");

  const cbUsersManage = byId("perm_users_manage");
  const cbInvWrite = byId("perm_inventory_write");
  const cbHistWrite = byId("perm_history_write");
  const cbDashView = byId("perm_dashboard_view");

  // ------------------------------------------------------------
  // P0: ROLE -> PAGE ROUTING (Admin -> Buyer)
  // MAPP: Lager/buyer/freezer.html
  // Denna fil ligger i: Lager/admin/freezer.js
  // ------------------------------------------------------------
  const ROLE_PAGE = {
    BUYER: "../buyer/freezer.html",     // från Lager/admin/ -> Lager/buyer/
    ADMIN: "./freezer.html",            // här
    PICKER: "./freezer.html",
    SYSTEM_ADMIN: "./freezer.html"
  };

  function normalizeRoleKey(role) {
    const r = String(role || "").toUpperCase().trim();
    if (r === "ADMIN" || r === "BUYER" || r === "PICKER" || r === "SYSTEM_ADMIN") return r;
    return "ADMIN";
  }

  function navToRolePageIfNeeded(role) {
    // P0: från admin-sidan ska BUYER alltid till buyer-sidan.
    const key = normalizeRoleKey(role);
    const target = ROLE_PAGE[key] || "./freezer.html";

    // Endast redirect om vi faktiskt ska lämna admin-sidan (BUYER)
    if (key !== "BUYER") return;

    try {
      // Anti-loop: om vi redan är på buyer-sidan så gör inget.
      const href = String(window.location.href || "");
      if (href.includes("/buyer/freezer.html")) return;

      window.location.assign(target);
    } catch {
      // fail-soft: gör inget
    }
  }

  // Page state
  let activeTab = "dashboard";

  // AO-11: router state (in-memory)
  let routerActiveViewId = ""; // default: första view i listan
  let routerMountedView = null;

  // AO-04: Items UI state (in-memory only)
  const itemsUI = {
    itemsQ: "",
    itemsCategory: "",
    itemsSortKey: "articleNo",
    itemsSortDir: "asc",
    itemsIncludeInactive: false,

    itemsEditingArticleNo: "",

    formArticleNo: "",
    formPackSize: "",
    formSupplier: "",
    formCategory: "",
    formPricePerKg: "",
    formMinLevel: "",
    formTempClass: "",
    formRequiresExpiry: true,
    formIsActive: true,

    itemsMsg: "—"
  };

  if (!window.FreezerRender) {
    console.error("Freezer baseline saknar FreezerRender.");
    return;
  }

  // ------------------------------------------------------------
  // AO-15: SHIM STORE (korrupt storage -> read-only men nav funkar)
  // ------------------------------------------------------------
  let store = window.FreezerStore || null;
  let storeCorrupt = false;

  const storeShim = {
    init: function () { return { ok: false, reason: "Read-only: storage error." }; },
    setRole: function () {},
    subscribe: function () { return function () {}; },
    getState: function () { return {}; },
    getStatus: function () {
      return {
        role: (userSelect && userSelect.value) ? userSelect.value : "ADMIN",
        locked: false,
        readOnly: true,
        whyReadOnly: "Read-only: korrupt storage eller init-fel.",
        reason: "Storage error"
      };
    },
    can: function () { return false; },
    hasPerm: function () { return false; },

    resetDemo: function () { return { ok: false, reason: "Read-only: storage error." }; },

    // Users
    listUsers: function () { return []; },
    createUser: function () { return { ok: false, reason: "Read-only: storage error." }; },
    updateUser: function () { return { ok: false, reason: "Read-only: storage error." }; },
    setUserActive: function () { return { ok: false, reason: "Read-only: storage error." }; },

    // Items
    listItems: function () { return []; },
    createItem: function () { return { ok: false, reason: "Read-only: storage error." }; },
    updateItem: function () { return { ok: false, reason: "Read-only: storage error." }; },
    archiveItem: function () { return { ok: false, reason: "Read-only: storage error." }; },
    deleteItem: function () { return { ok: false, reason: "Read-only: storage error." }; }
  };

  function getStore() {
    return storeCorrupt ? storeShim : store;
  }

  function markStoreCorrupt(err) {
    storeCorrupt = true;
    console.error("[Freezer] Store fel -> read-only shim aktiverad.", err);
  }

  function safeGetState() {
    try {
      const s = getStore();
      return (s && typeof s.getState === "function") ? s.getState() : {};
    } catch (e) {
      markStoreCorrupt(e);
      return {};
    }
  }

  function safeGetStatus() {
    try {
      const s = getStore();
      return (s && typeof s.getStatus === "function") ? s.getStatus() : storeShim.getStatus();
    } catch (e) {
      markStoreCorrupt(e);
      return storeShim.getStatus();
    }
  }

  // ------------------------------------------------------------
  // BOOT
  // ------------------------------------------------------------
  const initialRole = (userSelect && userSelect.value) ? userSelect.value : "ADMIN";

  // P0: Om admin-sidan råkar öppnas i BUYER-läge -> gå till buyer-sidan direkt.
  navToRolePageIfNeeded(initialRole);

  // Init store fail-soft
  if (!store || typeof store.init !== "function") {
    console.error("Freezer baseline saknar FreezerStore.");
    storeCorrupt = true;
  } else {
    try {
      store.init({ role: initialRole });
    } catch (e) {
      markStoreCorrupt(e);
    }
  }

  // Subscribe fail-soft
  try {
    const s = getStore();
    if (s && typeof s.subscribe === "function") {
      s.subscribe((state) => {
        window.FreezerRender.renderAll(state || {}, itemsUI);
        window.FreezerRender.setActiveTabUI(activeTab);

        // AO-11: uppdatera router view (om aktiv)
        routerRerender();

        if (usersPanel && !usersPanel.hidden) {
          refreshFormHeader();
        }
      });
    }
  } catch (e) {
    markStoreCorrupt(e);
  }

  // Initial paint (även vid shim)
  window.FreezerRender.renderAll(safeGetState(), itemsUI);
  window.FreezerRender.setActiveTabUI(activeTab);
  refreshFormHeader();

  // AO-11: init router menu (saldo/historik för alla)
  initRouterMenu();

  // Tabs (legacy navigation ska funka även om store är korrupt)
  bindTab(tabDashboard, "dashboard");
  bindTab(tabSaldo, "saldo");
  bindTab(tabHistorik, "history");

  // Role select (legacy)
  if (userSelect) {
    userSelect.addEventListener("change", () => {
      const role = userSelect.value || "ADMIN";

      // P0: BUYER -> egen sida
      navToRolePageIfNeeded(role);

      const s = getStore();

      try {
        if (!storeCorrupt && s && typeof s.setRole === "function") s.setRole(role);
      } catch (e) {
        markStoreCorrupt(e);
      }

      // AO-11: uppdatera router meny efter rollbyte
      initRouterMenu();

      const st = safeGetStatus();
      if (st && userSelect.value !== st.role) userSelect.value = st.role;
      rerender();
    });
  }

  // Reset demo
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const status = safeGetStatus();
      if (status.locked || status.readOnly) return;

      clearUsersMsg();

      const s = getStore();
      let res = { ok: false, reason: "Okänt fel." };
      try {
        res = s.resetDemo();
      } catch (e) {
        markStoreCorrupt(e);
        res = { ok: false, reason: "Storage error." };
      }

      if (!res.ok) {
        showUsersMsg("Reset misslyckades", res.reason || "Okänt fel.");
      } else {
        resetUserForm();
        resetItemsForm();
        itemsUI.itemsEditingArticleNo = "";
        setItemsMsg("Demo återställd.");
        initRouterMenu(); // refresh efter reset
      }
    });
  }

  // Users actions (legacy)
  wireUsersForm();
  wireUsersListDelegation();

  // AO-04: Items actions (delegation in scope) — tills flytt i AO-12
  wireItemsDelegation();

  // -----------------------------
  // AO-11: ROUTER MENU + MOUNT
  // -----------------------------
  function getRegistry() {
    try {
      return window.FreezerViewRegistry || null;
    } catch {
      return null;
    }
  }

  function buildViewCtx() {
    const status = safeGetStatus();
    return {
      role: status.role,
      locked: !!status.locked,
      readOnly: !!status.readOnly,
      whyReadOnly: status.whyReadOnly || "",
      // Views ska använda ctx.can(...) för RBAC (AO-09/11 kontrakt)
      can: function (perm) { return safeCan(String(perm || "")); }
    };
  }

  function hasLegacyTabs() {
    // P0: Om legacy-tabs finns ska vi inte dubbla Saldo/Historik i router-menyn.
    return !!(tabDashboard || tabSaldo || tabHistorik);
  }

  function normalizeMenuLabel(mi) {
    // P0: UI-only: förbättra label utan att ändra id/logik.
    const raw = String((mi && mi.label) ? mi.label : (mi && mi.id) ? mi.id : "").trim();
    if (!raw) return raw;

    // "Inköp • Dashboard" -> "Inköp"
    const lowered = raw.toLowerCase();
    if (lowered.includes("inköp") && lowered.includes("dashboard")) return "Inköp";

    return raw;
  }

  function isLegacyDuplicate(mi) {
    const id = String((mi && mi.id) ? mi.id : "").trim();
    if (!id) return false;
    // Duplicerar legacy-tabs: dessa ska inte visas i router-menyn när legacy finns.
    return (id === "shared-saldo" || id === "shared-history");
  }

  function initRouterMenu() {
    const reg = getRegistry();
    if (!viewMenu || !viewRoot || !reg || typeof reg.getViewsForRole !== "function") {
      // Fail-soft: router saknas, legacy tabs fortsatt OK.
      return;
    }

    const ctx = buildViewCtx();
    let views = [];
    try {
      views = reg.getViewsForRole(ctx.role) || [];
    } catch (e) {
      console.error("[Freezer] Router: kunde inte hämta views.", e);
      return;
    }

    // Skapa meny items och filtrera på requiredPerm (om satt)
    const menuItems = (typeof reg.toMenuItems === "function") ? reg.toMenuItems(views) : [];

    const visible = menuItems
      .filter((mi) => {
        if (!mi) return false;

        // P0: undvik dubblering mot legacy-tabs
        if (hasLegacyTabs() && isLegacyDuplicate(mi)) return false;

        if (!mi.requiredPerm) return true;
        return !!ctx.can(mi.requiredPerm);
      })
      .map((mi) => {
        // UI-only label normalize
        return Object.assign({}, mi, { label: normalizeMenuLabel(mi) });
      });

    // Om vi saknar aktiv viewId → ta första
    if (!routerActiveViewId && visible.length) routerActiveViewId = visible[0].id;
    if (routerActiveViewId && visible.length && !visible.some(x => x.id === routerActiveViewId)) {
      routerActiveViewId = visible[0].id;
    }

    // Render meny (XSS-safe)
    viewMenu.textContent = "";
    for (const mi of visible) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tabBtn";
      b.setAttribute("data-view-id", mi.id);
      b.setAttribute("aria-selected", mi.id === routerActiveViewId ? "true" : "false");
      b.textContent = String(mi.label || mi.id);
      b.addEventListener("click", () => {
        routerActivateView(mi.id);
      });
      viewMenu.appendChild(b);
    }

    // Mount aktiv view (om någon finns kvar)
    if (visible.length) {
      routerActivateView(routerActiveViewId || visible[0].id || "");
    } else {
      // Inga router-views synliga -> unmount + töm root
      try {
        if (routerMountedView && typeof routerMountedView.unmount === "function") {
          routerMountedView.unmount({ root: viewRoot, ctx });
        }
      } catch {}
      routerMountedView = null;
      routerActiveViewId = "";
      try { while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild); } catch {}
    }
  }

  function routerActivateView(viewId) {
    const reg = getRegistry();
    if (!viewRoot || !reg || typeof reg.getViewsForRole !== "function") return;

    const ctx = buildViewCtx();
    let views = [];
    try {
      views = reg.getViewsForRole(ctx.role) || [];
    } catch (e) {
      console.error("[Freezer] Router: kunde inte hämta views.", e);
      return;
    }

    const id = String(viewId || "").trim();
    if (!id) return;

    const view = (typeof reg.findView === "function") ? reg.findView(views, id) : null;
    if (!view) return;

    // Unmount tidigare
    try {
      if (routerMountedView && typeof routerMountedView.unmount === "function") {
        routerMountedView.unmount({ root: viewRoot, ctx });
      }
    } catch {
      // fail-soft
    }

    // Rensa root (kontrakt: view får en tom container)
    while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild);

    routerMountedView = view;
    routerActiveViewId = id;

    // Uppdatera aria-selected i menyn
    try {
      const btns = viewMenu ? viewMenu.querySelectorAll("button[data-view-id]") : [];
      btns.forEach((b) => {
        const bid = b.getAttribute("data-view-id") || "";
        b.setAttribute("aria-selected", bid === routerActiveViewId ? "true" : "false");
      });
    } catch {}

    // Mount + första render
    try {
      if (typeof view.mount === "function") {
        view.mount({ root: viewRoot, ctx });
      }
    } catch (e) {
      console.error("[Freezer] Router: mount-fel.", e);
    }

    routerRerender();
  }

  function routerRerender() {
    const view = routerMountedView;
    if (!view || !viewRoot) return;

    const ctx = buildViewCtx();
    const state = safeGetState();

    try {
      if (typeof view.render === "function") {
        view.render({ root: viewRoot, state, ctx });
      }
    } catch (e) {
      console.error("[Freezer] Router: render-fel.", e);
      // fail-soft: visa enkel fallback
      try {
        const box = document.createElement("div");
        box.className = "panel warn";
        const b = document.createElement("b");
        b.textContent = "Vyn kunde inte renderas";
        const m = document.createElement("div");
        m.className = "muted";
        m.textContent = "Kontrollera Console för fel.";
        box.appendChild(b);
        box.appendChild(m);
        while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild);
        viewRoot.appendChild(box);
      } catch {}
    }
  }

  // -----------------------------
  // USERS: FORM (legacy)
  // -----------------------------
  function wireUsersForm() {
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        clearUsersMsg();

        const s = getStore();
        const status = safeGetStatus();

        if (status.locked) return showUsersMsg("Spärrad", status.reason ? `Låst: ${status.reason}` : "Låst läge.");
        if (status.readOnly) return showUsersMsg("Spärrad", status.whyReadOnly || "Read-only.");

        if (!safeCan("users_manage")) {
          return showUsersMsg("Spärrad", "Saknar behörighet (users_manage).");
        }

        const firstName = (firstNameInput && firstNameInput.value) ? firstNameInput.value.trim() : "";
        const perms = readPermsFromUI();

        const editingId = (editingIdInput && editingIdInput.value) ? editingIdInput.value : "";
        if (!firstName) return showUsersMsg("Fel", "Förnamn krävs.");

        try {
          if (editingId) {
            const r = s.updateUser(editingId, { firstName, perms });
            if (!r.ok) return showUsersMsg("Fel", r.reason || "Kunde inte spara.");
            resetUserForm();
            return;
          }

          const r = s.createUser({ firstName, perms });
          if (!r.ok) {
            if (r.errorCode === "FRZ_E_USER_NAME_NOT_UNIQUE") return showUsersMsg("Fel", "Förnamn måste vara unikt.");
            return showUsersMsg("Fel", r.reason || "Kunde inte skapa.");
          }
          resetUserForm();
        } catch (e) {
          markStoreCorrupt(e);
          showUsersMsg("Spärrad", "Read-only: storage error.");
        }
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        clearUsersMsg();
        resetUserForm();
      });
    }
  }

  function safeCan(perm) {
    const s = getStore();
    try {
      if (s && typeof s.hasPerm === "function") return !!s.hasPerm(perm);
      if (s && typeof s.can === "function") return !!s.can(perm);
      return false;
    } catch (e) {
      markStoreCorrupt(e);
      return false;
    }
  }

  function readPermsFromUI() {
    return {
      users_manage: !!(cbUsersManage && cbUsersManage.checked),
      inventory_write: !!(cbInvWrite && cbInvWrite.checked),
      history_write: !!(cbHistWrite && cbHistWrite.checked),
      dashboard_view: !!(cbDashView && cbDashView.checked)
    };
  }

  function setPermsToUI(perms) {
    const p = perms && typeof perms === "object" ? perms : {};
    if (cbUsersManage) cbUsersManage.checked = !!p.users_manage;
    if (cbInvWrite) cbInvWrite.checked = !!p.inventory_write;
    if (cbHistWrite) cbHistWrite.checked = !!p.history_write;
    if (cbDashView) cbDashView.checked = ("dashboard_view" in p) ? !!p.dashboard_view : true;
  }

  function resetUserForm() {
    if (editingIdInput) editingIdInput.value = "";
    if (firstNameInput) firstNameInput.value = "";
    setPermsToUI({ dashboard_view: true });
    refreshFormHeader();
  }

  function refreshFormHeader() {
    const editingId = (editingIdInput && editingIdInput.value) ? editingIdInput.value : "";
    const isEdit = !!editingId;

    if (formTitle) formTitle.textContent = isEdit ? "Redigera användare" : "Skapa användare";
    if (formMode) formMode.textContent = isEdit ? "Editläge" : "Nytt";
  }

  // -----------------------------
  // USERS: LIST (delegation)
  // -----------------------------
  function wireUsersListDelegation() {
    if (!usersList) return;

    usersList.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!t || !(t instanceof HTMLElement)) return;

      const btn = t.closest("button[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action") || "";
      const userId = btn.getAttribute("data-user-id") || "";

      clearUsersMsg();

      const s = getStore();
      const status = safeGetStatus();

      if (status.locked) return showUsersMsg("Spärrad", status.reason ? `Låst: ${status.reason}` : "Låst läge.");
      if (status.readOnly) return showUsersMsg("Spärrad", status.whyReadOnly || "Read-only.");
      if (!safeCan("users_manage")) return showUsersMsg("Spärrad", "Saknar behörighet (users_manage).");

      if (!userId) return;

      if (action === "user-edit") {
        const u = findUserById(userId);
        if (!u) return showUsersMsg("Fel", "User hittades inte.");

        if (editingIdInput) editingIdInput.value = u.id || "";
        if (firstNameInput) firstNameInput.value = String(u.firstName || "");
        setPermsToUI(u.perms || {});
        refreshFormHeader();
        if (firstNameInput) firstNameInput.focus();
        return;
      }

      if (action === "user-toggle-active") {
        const u = findUserById(userId);
        if (!u) return showUsersMsg("Fel", "User hittades inte.");

        try {
          const next = !u.active;
          const r = s.setUserActive(userId, next);
          if (!r.ok) return showUsersMsg("Fel", r.reason || "Kunde inte uppdatera.");

          if (editingIdInput && editingIdInput.value === userId && !next) {
            resetUserForm();
          }
        } catch (e) {
          markStoreCorrupt(e);
          showUsersMsg("Spärrad", "Read-only: storage error.");
        }
        return;
      }
    });
  }

  function findUserById(id) {
    try {
      const s = getStore();
      const users = s.listUsers();
      return users.find(u => u && u.id === id) || null;
    } catch (e) {
      markStoreCorrupt(e);
      return null;
    }
  }

  // -----------------------------
  // AO-04: ITEMS (delegation)
  // -----------------------------
  function wireItemsDelegation() {
    document.addEventListener("click", (ev) => {
      const t = ev.target;
      if (!t || !(t instanceof HTMLElement)) return;

      const btn = t.closest("button[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action") || "";
      if (!action) return;

      // Scope-guard: endast Items-actions i saldo/Items-området
      if (isItemsAction(action) && !isInItemsScope(btn)) return;

      const articleNo = btn.getAttribute("data-article-no") || "";
      const s = getStore();
      const status = safeGetStatus();

      if (status.locked) return setItemsMsg(status.reason ? `Låst: ${status.reason}` : "Låst läge.");

      if (action === "item-new") {
        const gate = gateItemsWrite(status);
        if (!gate.ok) return setItemsMsg(gate.msg);

        resetItemsForm();
        itemsUI.itemsEditingArticleNo = "";
        setItemsMsg("Ny produkt.");
        rerender();
        return;
      }

      if (action === "item-cancel") {
        resetItemsForm();
        itemsUI.itemsEditingArticleNo = "";
        setItemsMsg("Avbrutet.");
        rerender();
        return;
      }

      if (action === "item-save") {
        const gate = gateItemsWrite(status);
        if (!gate.ok) return setItemsMsg(gate.msg);

        readItemsFormFromDOM();

        const payloadRes = buildItemPayloadFromUIValidated();
        if (!payloadRes.ok) return setItemsMsg(payloadRes.reason);

        const payload = payloadRes.payload;

        try {
          if (itemsUI.itemsEditingArticleNo) {
            const r = s.updateItem(itemsUI.itemsEditingArticleNo, payload);
            if (!r.ok) return setItemsMsg(r.reason || "Kunde inte spara.");

            resetItemsForm();
            itemsUI.itemsEditingArticleNo = "";
            setItemsMsg("Uppdaterad.");
            rerender();
            return;
          }

          const r = s.createItem(payload);
          if (!r.ok) return setItemsMsg(r.reason || "Kunde inte skapa.");

          resetItemsForm();
          itemsUI.itemsEditingArticleNo = "";
          setItemsMsg("Skapad.");
          rerender();
        } catch (e) {
          markStoreCorrupt(e);
          setItemsMsg("Read-only: storage error.");
        }
        return;
      }

      if (action === "item-edit") {
        if (!articleNo) return;
        itemsUI.itemsEditingArticleNo = String(articleNo || "");
        loadItemToForm(itemsUI.itemsEditingArticleNo);
        setItemsMsg("Editläge.");
        rerender();
        return;
      }

      if (action === "item-archive") {
        const gate = gateItemsWrite(status);
        if (!gate.ok) return setItemsMsg(gate.msg);
        if (!articleNo) return;

        try {
          const r = s.archiveItem(articleNo);
          if (!r.ok) return setItemsMsg(r.reason || "Kunde inte arkivera.");

          if (itemsUI.itemsEditingArticleNo === articleNo) {
            resetItemsForm();
            itemsUI.itemsEditingArticleNo = "";
          }
          setItemsMsg("Arkiverad.");
          rerender();
        } catch (e) {
          markStoreCorrupt(e);
          setItemsMsg("Read-only: storage error.");
        }
        return;
      }

      if (action === "item-delete") {
        const gate = gateItemsWrite(status);
        if (!gate.ok) return setItemsMsg(gate.msg);
        if (!articleNo) return;

        const ok = window.confirm(`Radera ${articleNo} permanent?\n(Detta kan blockeras om referenser finns.)`);
        if (!ok) return;

        try {
          const r = s.deleteItem(articleNo);
          if (!r.ok) return setItemsMsg(r.reason || "Radering blockerad.");

          if (itemsUI.itemsEditingArticleNo === articleNo) {
            resetItemsForm();
            itemsUI.itemsEditingArticleNo = "";
          }
          setItemsMsg("Raderad.");
          rerender();
        } catch (e) {
          markStoreCorrupt(e);
          setItemsMsg("Read-only: storage error.");
        }
        return;
      }
    });

    document.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!t || !(t instanceof HTMLElement)) return;
      if (!isInItemsScope(t)) return;

      const id = t.id || "";
      if (!id) return;

      if (id === "frzItemsQ") { itemsUI.itemsQ = String(t.value || ""); rerender(); return; }
      if (id === "frzItemsCategory") { itemsUI.itemsCategory = String(t.value || ""); rerender(); return; }
      if (id === "frzItemsSortKey") { itemsUI.itemsSortKey = String(t.value || "articleNo"); rerender(); return; }
      if (id === "frzItemsSortDir") { itemsUI.itemsSortDir = String(t.value || "asc"); rerender(); return; }
      if (id === "frzItemsIncludeInactive") { itemsUI.itemsIncludeInactive = !!(t.checked); rerender(); return; }
    });

    document.addEventListener("input", (ev) => {
      const t = ev.target;
      if (!t || !(t instanceof HTMLElement)) return;
      if (!isInItemsScope(t)) return;

      if (t.id === "frzItemsQ") {
        itemsUI.itemsQ = String(t.value || "");
        rerender();
      }
    });
  }

  function isItemsAction(action) {
    return String(action || "").startsWith("item-");
  }

  function isInItemsScope(el) {
    // AO-15: extra robust: kontrollera att .closest finns innan vi använder den.
    try {
      const hasClosest = el && typeof el.closest === "function";

      const viewSaldo = document.getElementById("viewSaldo");
      if (viewSaldo && hasClosest) return !!el.closest("#viewSaldo");
      if (viewSaldo && !hasClosest) return true; // fail-soft

      const q = document.getElementById("frzItemsQ");
      if (q) {
        const qClosestOk = typeof q.closest === "function";
        if (qClosestOk) {
          const root =
            q.closest("#frzItemsPanel") ||
            q.closest("#frzSaldoTableWrap") ||
            q.closest("main") ||
            q.closest("section");

          if (root && root.id && hasClosest) return !!el.closest(`#${root.id}`) || root.contains(el);
          if (root && !hasClosest) return true; // fail-soft
        }
      }

      if (document.getElementById("frzSaldoTableWrap") && hasClosest) return !!el.closest("#frzSaldoTableWrap");
      if (document.getElementById("frzItemsPanel") && hasClosest) return !!el.closest("#frzItemsPanel");

      return true; // fail-soft
    } catch {
      return true; // fail-soft
    }
  }

  function gateItemsWrite(status) {
    if (status.locked) return { ok: false, msg: status.reason ? `Låst: ${status.reason}` : "Låst läge." };
    if (status.readOnly) return { ok: false, msg: status.whyReadOnly || "Read-only: skrivning är spärrad." };

    const hasPerm = safeCan("inventory_write");
    if (!hasPerm) return { ok: false, msg: "Saknar behörighet (inventory_write)." };

    return { ok: true, msg: "" };
  }

  function readItemsFormFromDOM() {
    itemsUI.formArticleNo = readVal("frzItemArticleNo");
    itemsUI.formPackSize = readVal("frzItemPackSize");
    itemsUI.formSupplier = readVal("frzItemSupplier");
    itemsUI.formCategory = readVal("frzItemCategory");
    itemsUI.formPricePerKg = readVal("frzItemPricePerKg");
    itemsUI.formMinLevel = readVal("frzItemMinLevel");
    itemsUI.formTempClass = readVal("frzItemTempClass");
    itemsUI.formRequiresExpiry = (readVal("frzItemRequiresExpiry") === "true");
    itemsUI.formIsActive = (readVal("frzItemIsActive") === "true");
  }

  function readVal(id) {
    // AO-15: robust: läs bara .value om det faktiskt finns
    const el = document.getElementById(id);
    if (!el) return "";
    if (!("value" in el)) return "";
    return String(el.value || "");
  }

  function buildItemPayloadFromUIValidated() {
    const articleNo = String(itemsUI.formArticleNo || "").trim();
    if (!articleNo) return { ok: false, reason: "Fel: articleNo krävs." };

    const priceRaw = String(itemsUI.formPricePerKg || "").trim();
    const minRaw = String(itemsUI.formMinLevel || "").trim();

    let pricePerKg = "";
    if (priceRaw !== "") {
      const n = Number(priceRaw);
      if (!Number.isFinite(n)) return { ok: false, reason: "Fel: pricePerKg måste vara ett giltigt tal." };
      pricePerKg = n;
    }

    let minLevel = "";
    if (minRaw !== "") {
      const n = Number(minRaw);
      if (!Number.isFinite(n)) return { ok: false, reason: "Fel: minLevel måste vara ett giltigt tal." };
      minLevel = n;
    }

    const payload = {
      articleNo,
      packSize: String(itemsUI.formPackSize || "").trim(),
      supplier: String(itemsUI.formSupplier || "").trim(),
      category: String(itemsUI.formCategory || "").trim(),
      pricePerKg,
      minLevel,
      tempClass: String(itemsUI.formTempClass || "").trim(),
      requiresExpiry: !!itemsUI.formRequiresExpiry,
      isActive: !!itemsUI.formIsActive
    };

    return { ok: true, payload };
  }

  function loadItemToForm(articleNo) {
    try {
      const s = getStore();
      const all = s.listItems({ includeInactive: true });
      const it = all.find(x => x && String(x.articleNo || "") === String(articleNo || "")) || null;
      if (!it) return;

      itemsUI.formArticleNo = String(it.articleNo || "");
      itemsUI.formPackSize = String(it.packSize || "");
      itemsUI.formSupplier = String(it.supplier || "");
      itemsUI.formCategory = String(it.category || "");
      itemsUI.formPricePerKg = (typeof it.pricePerKg !== "undefined" && it.pricePerKg !== null) ? String(it.pricePerKg) : "";
      itemsUI.formMinLevel = (typeof it.minLevel !== "undefined" && it.minLevel !== null) ? String(it.minLevel) : "";
      itemsUI.formTempClass = String(it.tempClass || "");
      itemsUI.formRequiresExpiry = !!it.requiresExpiry;
      itemsUI.formIsActive = !!it.isActive;
    } catch (e) {
      markStoreCorrupt(e);
    }
  }

  function resetItemsForm() {
    itemsUI.formArticleNo = "";
    itemsUI.formPackSize = "";
    itemsUI.formSupplier = "";
    itemsUI.formCategory = "";
    itemsUI.formPricePerKg = "";
    itemsUI.formMinLevel = "";
    itemsUI.formTempClass = "FROZEN";
    itemsUI.formRequiresExpiry = true;
    itemsUI.formIsActive = true;
  }

  function setItemsMsg(text) {
    itemsUI.itemsMsg = String(text || "—");
    rerender();
  }

  function rerender() {
    try {
      const state = safeGetState();
      window.FreezerRender.renderAll(state, itemsUI);
      window.FreezerRender.setActiveTabUI(activeTab);

      // Bonus: render status/mode/lock/debug om de finns
      window.FreezerRender.renderStatus && window.FreezerRender.renderStatus(state);
      window.FreezerRender.renderMode && window.FreezerRender.renderMode(state);
      window.FreezerRender.renderLockPanel && window.FreezerRender.renderLockPanel(state);
      window.FreezerRender.renderDebug && window.FreezerRender.renderDebug(state);

      // AO-11: uppdatera router view
      routerRerender();
    } catch (e) {
      // fail-soft
    }
  }

  // -----------------------------
  // MESSAGES (Users)
  // -----------------------------
  function showUsersMsg(title, text) {
    if (!msgBox || !msgTitle || !msgText) return;
    msgTitle.textContent = title || "Info";
    msgText.textContent = text || "—";
    msgBox.hidden = false;
  }

  function clearUsersMsg() {
    if (!msgBox || !msgTitle || !msgText) return;
    msgBox.hidden = true;
    msgTitle.textContent = "Info";
    msgText.textContent = "—";
  }

  // -----------------------------
  // TABS (legacy)
  // -----------------------------
  function bindTab(btn, key) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      activeTab = key;
      window.FreezerRender.setActiveTabUI(activeTab);

      const state = safeGetState();

      window.FreezerRender.renderStatus && window.FreezerRender.renderStatus(state);
      window.FreezerRender.renderMode && window.FreezerRender.renderMode(state);
      window.FreezerRender.renderLockPanel && window.FreezerRender.renderLockPanel(state);
      window.FreezerRender.renderDebug && window.FreezerRender.renderDebug(state);

      window.FreezerRender.renderAll(state, itemsUI);
    });
  }

  function byId(id) { return document.getElementById(id); }

})();
