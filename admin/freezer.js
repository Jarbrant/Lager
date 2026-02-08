/* ============================================================
AO-LOGIN-01 | FIL: Lager/admin/freezer.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte (AO-LOGIN-01):
- Session-guard för admin-sidan:
  - Kräver FRZ_SESSION_V1 (sessionStorage-first, localStorage fallback)
  - Fail-closed: om saknas/utgången/ej ADMIN -> redirect till ../index.html

OBS:
- Detta är UI-only demo-login (inte riktig säkerhet).
- Inga nya storage keys/datamodell i denna fil.
============================================================ */

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

AO-LOGIN-02 (DENNA PATCH) — UI-CLEANUP (Admin topbar):
- Tar bort all gammal rollväxlar-logik (select + BUYER-redirect etc).
- Sätter topbar: #frzRoleText = "ADMIN" och #frzUserName från session.
- Uppdaterar #frzViewHint så mittenytan inte är tom (Dashboard/Saldo/Historik + ev router-vy).

AO-LOGIN-03 (DENNA PATCH) — USER MODAL (P0 FIX):
- Fixar att “Skapa användare” modal går att stänga:
  - Stäng-knapp, Avbryt, klick på overlay, Escape
  - Vid lyckad Spara -> stäng modal + reset form
- Fail-closed: öppna knapp disabled vid locked/readOnly/utan users_manage.

AO-LOGIN-03 (P0 UI-FIX, DENNA PATCH) — RÄTT MSG-BOX:
- Visar fel/info i MODAL när modal är öppen (frzUsersMsg).
- Visar fel/info i DASHBOARD inline när modal är stängd (frzUsersInlineMsg).
- Rensar båda vid modal open/close för att undvika “Fel”-ruta på första sidan.

Policy:
- Inga nya storage-keys/datamodell
- XSS-safe (render sköter textContent)
============================================================ */

(function () {
  "use strict";

  // ------------------------------------------------------------
  // AO-LOGIN-01: SESSION GUARD (fail-closed)
  // ------------------------------------------------------------
  const SESSION_KEY = "FRZ_SESSION_V1";

  function safeJsonParse(raw) {
    try { return JSON.parse(raw); } catch { return null; }
  }

  function readSession() {
    try {
      const sRaw = (window.sessionStorage && window.sessionStorage.getItem(SESSION_KEY)) || null;
      if (sRaw) return safeJsonParse(sRaw);
    } catch {}
    try {
      const lRaw = (window.localStorage && window.localStorage.getItem(SESSION_KEY)) || null;
      if (lRaw) return safeJsonParse(lRaw);
    } catch {}
    return null;
  }

  function clearSession() {
    try { window.sessionStorage && window.sessionStorage.removeItem(SESSION_KEY); } catch {}
    try { window.localStorage && window.localStorage.removeItem(SESSION_KEY); } catch {}
  }

  function isSessionValidAndAdmin(sess) {
    try {
      if (!sess || typeof sess !== "object") return { ok: false, reason: "NO_SESSION" };

      const role = String(sess.role || "").toUpperCase().trim();
      if (role !== "ADMIN") return { ok: false, reason: "NOT_ADMIN" };

      const exp = Number(sess.exp || 0);
      if (exp && Date.now() > exp) return { ok: false, reason: "EXPIRED" };

      const firstName = String(sess.firstName || "").trim();
      if (!firstName) return { ok: false, reason: "BAD_SESSION" };

      return { ok: true, role: role, firstName: firstName };
    } catch {
      return { ok: false, reason: "BAD_SESSION" };
    }
  }

  function redirectToLogin() {
    // admin/freezer.js ligger i Lager/admin/ -> login i Lager/index.html
    try { window.location.replace("../index.html"); } catch {
      try { window.location.href = "../index.html"; } catch {}
    }
  }

  // P0: Guard direkt vid start (innan store/init/render)
  let sessionView = { ok: false, role: "ADMIN", firstName: "" };
  (function guardNow() {
    const sess = readSession();
    const v = isSessionValidAndAdmin(sess);
    if (!v.ok) {
      if (v.reason === "EXPIRED" || v.reason === "BAD_SESSION") clearSession();
      redirectToLogin();
      return;
    }
    sessionView = v;
  })();

  // ------------------------------------------------------------
  // AO-15: INIT-GUARD (förhindra dubbla document-level listeners)
  // ------------------------------------------------------------
  if (window.__FRZ_ADMIN_PAGE_INIT__) {
    console.warn("[Freezer] admin/freezer.js redan initierad (guard).");
    return;
  }
  window.__FRZ_ADMIN_PAGE_INIT__ = true;

  function byId(id) { return document.getElementById(id); }

  const tabDashboard = byId("tabDashboard");
  const tabSaldo = byId("tabSaldo");
  const tabHistorik = byId("tabHistorik");

  const resetBtn = byId("frzResetDemoBtn");

  // AO-LOGIN-02: topbar locked labels
  const roleText = byId("frzRoleText");
  const userNameText = byId("frzUserName");
  const viewHint = byId("frzViewHint");

  // Router shell (AO-11)
  const viewMenu = byId("freezerViewMenu");
  const viewRoot = byId("freezerViewRoot");

  // Users UI (legacy panel i dashboard)
  const usersPanel = byId("frzUsersPanel");
  const usersList = byId("frzUsersList");

  // AO-LOGIN-03: MODAL msg-box
  const msgBox = byId("frzUsersMsg");
  const msgTitle = byId("frzUsersMsgTitle");
  const msgText = byId("frzUsersMsgText");

  // AO-LOGIN-03: DASHBOARD inline msg-box (för fel när modal är stängd)
  const inlineMsgBox = byId("frzUsersInlineMsg");
  const inlineMsgTitle = byId("frzUsersInlineMsgTitle");
  const inlineMsgText = byId("frzUsersInlineMsgText");

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

  // AO-LOGIN-03: modal wiring (IDs ska komma från freezer.html)
  const openCreateUserBtn = byId("frzOpenCreateUserBtn");
  const userModalOverlay = byId("frzUserModalOverlay");
  const userModalCloseBtn = byId("frzUserModalCloseBtn");

  let lastFocusEl = null;

  // ------------------------------------------------------------
  // AO-LOGIN-02: TOPBAR SYNC (roll + namn)
  // ------------------------------------------------------------
  function syncTopbarIdentity() {
    const sess = readSession();
    const v = isSessionValidAndAdmin(sess);
    if (!v.ok) {
      redirectToLogin();
      return false;
    }

    // Låst roll i admin-vy
    if (roleText) roleText.textContent = "ADMIN";

    // Namn från session
    if (userNameText) userNameText.textContent = String(v.firstName || "—");

    return true;
  }
  syncTopbarIdentity();

  // ------------------------------------------------------------
  // AO-LOGIN-02: VIEW HINT (fyll “tom yta”)
  // ------------------------------------------------------------
  function setViewHint(text) {
    if (!viewHint) return;
    viewHint.textContent = String(text || "—");
  }

  function setHintForTab(tabKey) {
    const map = {
      dashboard: "Vy: Dashboard",
      saldo: "Vy: Saldo",
      history: "Vy: Historik"
    };
    setViewHint(map[String(tabKey || "")] || "Vy: —");
  }

  // Page state
  let activeTab = "dashboard";

  // AO-11: router state (in-memory)
  let routerActiveViewId = ""; // default: första view i listan
  let routerMountedView = null;
  let routerActiveLabel = "";  // AO-LOGIN-02: för hint

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
        role: "ADMIN",
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
  // AO-LOGIN-03: USER MODAL HELPERS (P0)
  // ------------------------------------------------------------
  function isUserModalOpen() {
    if (!userModalOverlay) return false;
    return !userModalOverlay.hidden;
  }

  // AO-LOGIN-03: message routing (modal vs dashboard)
  function getUsersMsgTarget() {
    // MODAL när modal är öppen
    if (isUserModalOpen() && msgBox && msgTitle && msgText) {
      return { box: msgBox, title: msgTitle, text: msgText };
    }
    // Annars: dashboard inline om finns
    if (inlineMsgBox && inlineMsgTitle && inlineMsgText) {
      return { box: inlineMsgBox, title: inlineMsgTitle, text: inlineMsgText };
    }
    // Fallback: modalbox om finns (fail-closed UI)
    if (msgBox && msgTitle && msgText) {
      return { box: msgBox, title: msgTitle, text: msgText };
    }
    return null;
  }

  function clearMsgBox(target) {
    if (!target) return;
    try {
      target.box.hidden = true;
      target.title.textContent = "Info";
      target.text.textContent = "—";
    } catch {}
  }

  function showMsgBox(target, title, text) {
    if (!target) return;
    try {
      target.title.textContent = title || "Info";
      target.text.textContent = text || "—";
      target.box.hidden = false;
    } catch {}
  }

  function clearUsersMsg() {
    // Rensa båda så inget “hänger kvar” på dashboard när modal öppnas/stängs
    clearMsgBox({ box: msgBox, title: msgTitle, text: msgText });
    clearMsgBox({ box: inlineMsgBox, title: inlineMsgTitle, text: inlineMsgText });
  }

  function showUsersMsg(title, text) {
    const tgt = getUsersMsgTarget();
    if (!tgt) return;
    showMsgBox(tgt, title, text);
  }

  function closeUserModal(reason) {
    if (!userModalOverlay) return;
    userModalOverlay.hidden = true;
    userModalOverlay.setAttribute("aria-hidden", "true");

    // AO-LOGIN-03: undvik felruta på första sidan efter stängning
    clearUsersMsg();

    // Städa fokus
    try {
      if (lastFocusEl && typeof lastFocusEl.focus === "function") lastFocusEl.focus();
    } catch {}
    lastFocusEl = null;

    // reason används inte i UI just nu (ingen ny data / inga nya keys)
    void reason;
  }

  function openUserModal() {
    // fail-closed om session tappas
    if (!syncTopbarIdentity()) return;

    const status = safeGetStatus();
    if (status.locked || status.readOnly) return;

    if (!safeCan("users_manage")) return;

    if (!userModalOverlay) return;

    lastFocusEl = document.activeElement;

    // AO-LOGIN-03: öppna alltid “ren” modal (ingen hängande dashboardruta)
    clearUsersMsg();

    userModalOverlay.hidden = false;
    userModalOverlay.setAttribute("aria-hidden", "false");

    // säkerställ “Skapa”-läge
    resetUserForm();
    clearUsersMsg();

    // fokus på första fält
    try { if (firstNameInput && typeof firstNameInput.focus === "function") firstNameInput.focus(); } catch {}
  }

  function syncCreateUserTopbarBtn() {
    if (!openCreateUserBtn) return;

    const status = safeGetStatus();
    const canUsers = safeCan("users_manage");

    const disabled = !!status.locked || !!status.readOnly || !canUsers;

    openCreateUserBtn.disabled = disabled;

    // title som hjälptext (UI-only)
    if (disabled) {
      if (status.locked) openCreateUserBtn.title = status.reason ? `Låst: ${status.reason}` : "Låst läge.";
      else if (status.readOnly) openCreateUserBtn.title = status.whyReadOnly || "Read-only.";
      else openCreateUserBtn.title = "Saknar behörighet (users_manage).";
    } else {
      openCreateUserBtn.title = "Skapa ny användare";
    }
  }

  function wireUserModal() {
    // Öppna
    if (openCreateUserBtn) {
      openCreateUserBtn.addEventListener("click", () => {
        openUserModal();
      });
    }

    // Stäng-knapp
    if (userModalCloseBtn) {
      userModalCloseBtn.addEventListener("click", () => {
        closeUserModal("close-btn");
      });
    }

    // Klick på overlay (utanför kort) stänger
    if (userModalOverlay) {
      userModalOverlay.addEventListener("click", (ev) => {
        // Stäng bara om man klickar på själva overlayn (inte i dialogen)
        if (ev.target === userModalOverlay) closeUserModal("overlay");
      });
    }

    // Esc stänger
    document.addEventListener("keydown", (ev) => {
      if (!isUserModalOpen()) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeUserModal("esc");
      }
    });

    // Avbryt ska även stänga modal (om modal används)
    if (cancelBtn) {
      cancelBtn.addEventListener("click", () => {
        if (isUserModalOpen()) closeUserModal("cancel");
      });
    }
  }

  // ------------------------------------------------------------
  // BOOT
  // ------------------------------------------------------------
  const initialRole = "ADMIN";

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
        // AO-LOGIN-02: håll topbar synkad (om session byts/expirerar)
        syncTopbarIdentity();

        window.FreezerRender.renderAll(state || {}, itemsUI);
        window.FreezerRender.setActiveTabUI(activeTab);

        // AO-11: uppdatera router view (om aktiv)
        routerRerender();

        if (usersPanel && !usersPanel.hidden) {
          refreshFormHeader();
        }

        // AO-LOGIN-02: uppdatera hint (tab eller router label)
        updateHint();

        // AO-LOGIN-03: disable/enable create user i topbar
        syncCreateUserTopbarBtn();
      });
    }
  } catch (e) {
    markStoreCorrupt(e);
  }

  // Initial paint (även vid shim)
  window.FreezerRender.renderAll(safeGetState(), itemsUI);
  window.FreezerRender.setActiveTabUI(activeTab);
  refreshFormHeader();

  // AO-LOGIN-03: se till att ingen felruta syns på första sidan vid load
  clearUsersMsg();

  // Hint initial
  setHintForTab(activeTab);

  // AO-11: init router menu (saldo/historik för alla)
  initRouterMenu();

  // Tabs (legacy navigation ska funka även om store är korrupt)
  bindTab(tabDashboard, "dashboard");
  bindTab(tabSaldo, "saldo");
  bindTab(tabHistorik, "history");

  // AO-LOGIN-03: wire modal (P0)
  wireUserModal();
  syncCreateUserTopbarBtn();

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

        // AO-LOGIN-03: om modal är öppen -> håll den i sync (fail-closed)
        syncCreateUserTopbarBtn();
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
      role: "ADMIN",
      locked: !!status.locked,
      readOnly: !!status.readOnly,
      whyReadOnly: status.whyReadOnly || "",
      can: function (perm) { return safeCan(String(perm || "")); }
    };
  }

  function hasLegacyTabs() {
    return !!(tabDashboard || tabSaldo || tabHistorik);
  }

  function normalizeMenuLabel(mi) {
    const raw = String((mi && mi.label) ? mi.label : (mi && mi.id) ? mi.id : "").trim();
    if (!raw) return raw;

    const lowered = raw.toLowerCase();
    if (lowered.includes("inköp") && lowered.includes("dashboard")) return "Inköp";
    return raw;
  }

  function isLegacyDuplicate(mi) {
    const id = String((mi && mi.id) ? mi.id : "").trim();
    if (!id) return false;
    return (id === "shared-saldo" || id === "shared-history");
  }

  function initRouterMenu() {
    const reg = getRegistry();
    if (!viewMenu || !viewRoot || !reg || typeof reg.getViewsForRole !== "function") {
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

    const menuItems = (typeof reg.toMenuItems === "function") ? reg.toMenuItems(views) : [];

    const visible = menuItems
      .filter((mi) => {
        if (!mi) return false;
        if (hasLegacyTabs() && isLegacyDuplicate(mi)) return false;
        if (!mi.requiredPerm) return true;
        return !!ctx.can(mi.requiredPerm);
      })
      .map((mi) => Object.assign({}, mi, { label: normalizeMenuLabel(mi) }));

    if (!routerActiveViewId && visible.length) routerActiveViewId = visible[0].id;
    if (routerActiveViewId && visible.length && !visible.some(x => x.id === routerActiveViewId)) {
      routerActiveViewId = visible[0].id;
    }

    viewMenu.textContent = "";
    for (const mi of visible) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tabBtn";
      b.setAttribute("data-view-id", mi.id);
      b.setAttribute("aria-selected", mi.id === routerActiveViewId ? "true" : "false");
      b.textContent = String(mi.label || mi.id);
      b.addEventListener("click", () => {
        routerActivateView(mi.id, String(mi.label || mi.id));
      });
      viewMenu.appendChild(b);
    }

    if (visible.length) {
      const first = visible.find(v => v.id === routerActiveViewId) || visible[0];
      routerActivateView(first.id || "", String(first.label || first.id || ""));
    } else {
      try {
        if (routerMountedView && typeof routerMountedView.unmount === "function") {
          routerMountedView.unmount({ root: viewRoot, ctx });
        }
      } catch {}
      routerMountedView = null;
      routerActiveViewId = "";
      routerActiveLabel = "";
      try { while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild); } catch {}
      updateHint();
    }
  }

  function routerActivateView(viewId, label) {
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

    try {
      if (routerMountedView && typeof routerMountedView.unmount === "function") {
        routerMountedView.unmount({ root: viewRoot, ctx });
      }
    } catch {}

    while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild);

    routerMountedView = view;
    routerActiveViewId = id;
    routerActiveLabel = String(label || id || "");

    try {
      const btns = viewMenu ? viewMenu.querySelectorAll("button[data-view-id]") : [];
      btns.forEach((b) => {
        const bid = b.getAttribute("data-view-id") || "";
        b.setAttribute("aria-selected", bid === routerActiveViewId ? "true" : "false");
      });
    } catch {}

    try {
      if (typeof view.mount === "function") {
        view.mount({ root: viewRoot, ctx });
      }
    } catch (e) {
      console.error("[Freezer] Router: mount-fel.", e);
    }

    routerRerender();
    updateHint();
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

  function updateHint() {
    // Primärt: tabs (Dashboard/Saldo/Historik). Sekundärt: router (om den används).
    if (activeTab === "dashboard") setHintForTab("dashboard");
    else if (activeTab === "saldo") setHintForTab("saldo");
    else if (activeTab === "history") setHintForTab("history");
    else setHintForTab(activeTab);

    // Om router har en aktiv vy och vi inte är i dashboard-tab kan vi visa båda
    if (routerActiveLabel) {
      // kort, utan att störa: “Vy: Saldo • Router: X”
      const base = viewHint ? String(viewHint.textContent || "") : "";
      if (base && base !== "—") {
        setViewHint(`${base} • Router: ${routerActiveLabel}`);
      } else {
        setViewHint(`Router: ${routerActiveLabel}`);
      }
    }
  }

  // -----------------------------
  // USERS: FORM (legacy)
  // -----------------------------
  function wireUsersForm() {
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        clearUsersMsg();

        // AO-LOGIN-01/02: extra fail-closed om session försvinner
        if (!syncTopbarIdentity()) return;

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

            // AO-LOGIN-03: lyckad save -> stäng modal om öppen
            if (isUserModalOpen()) closeUserModal("saved-edit");
            return;
          }

          const r = s.createUser({ firstName, perms });
          if (!r.ok) {
            if (r.errorCode === "FRZ_E_USER_NAME_NOT_UNIQUE") return showUsersMsg("Fel", "Förnamn måste vara unikt.");
            return showUsersMsg("Fel", r.reason || "Kunde inte skapa.");
          }
          resetUserForm();

          // AO-LOGIN-03: lyckad create -> stäng modal om öppen
          if (isUserModalOpen()) closeUserModal("saved-new");
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
        // (stängning av modal sker även i wireUserModal())
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

      // AO-LOGIN-01/02: extra fail-closed om session försvinner
      if (!syncTopbarIdentity()) return;

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

        // Om modal används: öppna modalen för edit (ingen ny data / inga nya keys)
        if (!isUserModalOpen()) openUserModal();
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

          // topbar knapp kan påverkas om perms ändras i systemet i framtiden
          syncCreateUserTopbarBtn();
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
    try {
      const hasClosest = el && typeof el.closest === "function";

      const viewSaldo = document.getElementById("viewSaldo");
      if (viewSaldo && hasClosest) return !!el.closest("#viewSaldo");
      if (viewSaldo && !hasClosest) return true;

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
          if (root && !hasClosest) return true;
        }
      }

      if (document.getElementById("frzSaldoTableWrap") && hasClosest) return !!el.closest("#frzSaldoTableWrap");
      if (document.getElementById("frzItemsPanel") && hasClosest) return !!el.closest("#frzItemsPanel");

      return true;
    } catch {
      return true;
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
      // AO-LOGIN-02: fail-closed om session tappas
      if (!syncTopbarIdentity()) return;

      const state = safeGetState();
      window.FreezerRender.renderAll(state, itemsUI);
      window.FreezerRender.setActiveTabUI(activeTab);

      window.FreezerRender.renderStatus && window.FreezerRender.renderStatus(state);
      window.FreezerRender.renderMode && window.FreezerRender.renderMode(state);
      window.FreezerRender.renderLockPanel && window.FreezerRender.renderLockPanel(state);
      window.FreezerRender.renderDebug && window.FreezerRender.renderDebug(state);

      routerRerender();
      updateHint();

      // AO-LOGIN-03: håll topbar-knapp i sync
      syncCreateUserTopbarBtn();
    } catch (e) {}
  }

  // -----------------------------
  // MESSAGES (Users) - (funktioner ligger ovan för routing)
  // -----------------------------

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

      updateHint();
      syncCreateUserTopbarBtn();
    });
  }

})();
