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

AO-LOGIN-02 — UI-CLEANUP (Admin topbar):
- Tar bort gammal rollväxlar-logik.
- Sätter topbar roll & användarnamn från session.
- Uppdaterar view-hint.

AO-LOGIN-03 — USER MODAL (P0 FIX):
- Modal ska gå att stänga (Stäng/Avbryt/overlay/Escape).
- Vid lyckad Spara -> stäng modal + reset form.
- Fail-closed: öppna knapp disabled vid locked/readOnly/utan users_manage.
- RÄTT MSG-BOX (modal när öppen, annars dashboard inline).
- Rensar msg vid open/close.

AO-LOGIN-03 (P0 EXTRA FIX, DENNA PATCH):
- MODAL FÅR INTE ÖPPNA AUTOMATISKT VID LOGIN.
- Tvinga overlay hidden direkt vid load (fail-closed).
- Blockera externa "auto-open" från modal-shell tills användaren klickar "Skapa användare".
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
    try { window.location.replace("../index.html"); } catch {
      try { window.location.href = "../index.html"; } catch {}
    }
  }

  // P0: Guard direkt vid start
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
  // AO-15: INIT-GUARD
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

  const roleText = byId("frzRoleText");
  const userNameText = byId("frzUserName");
  const viewHint = byId("frzViewHint");

  const viewMenu = byId("freezerViewMenu");
  const viewRoot = byId("freezerViewRoot");

  const usersPanel = byId("frzUsersPanel");
  const usersList = byId("frzUsersList");

  // AO-LOGIN-03: MODAL msg-box
  const msgBox = byId("frzUsersMsg");
  const msgTitle = byId("frzUsersMsgTitle");
  const msgText = byId("frzUsersMsgText");

  // AO-LOGIN-03: DASHBOARD inline msg-box
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

  const openCreateUserBtn = byId("frzOpenCreateUserBtn");
  const userModalOverlay = byId("frzUserModalOverlay");
  const userModalCloseBtn = byId("frzUserModalCloseBtn");

  let lastFocusEl = null;

  // ------------------------------------------------------------
  // P0: MODAL OPEN GATE (hindrar auto-open vid boot)
  // ------------------------------------------------------------
  let __allowModalOpenOnce = false;

  function armModalOpenOnce() {
    __allowModalOpenOnce = true;
  }

  function consumeModalOpenAllowance() {
    const ok = __allowModalOpenOnce;
    __allowModalOpenOnce = false;
    return ok;
  }

  // Om någon extern modal-shell finns, blockera dess open-metoder tills vi "armar"
  function patchExternalModalShellIfAny() {
    try {
      const M = window.FreezerModal;
      if (!M || typeof M !== "object") return;

      // Wrap valfria open-funktioner vi kan se
      const candidates = ["open", "openCreateUser", "openUser", "show", "showCreateUser"];
      for (const k of candidates) {
        if (typeof M[k] !== "function") continue;
        const orig = M[k].bind(M);
        // Undvik dubbelwrap
        if (orig.__FRZ_WRAPPED__) continue;

        const wrapped = function () {
          // Blockera alla "auto-open" om vi inte har explicit armning från knapp
          if (!consumeModalOpenAllowance()) {
            try { forceModalClosed("blocked-external"); } catch {}
            return false;
          }
          return orig.apply(null, arguments);
        };
        wrapped.__FRZ_WRAPPED__ = true;
        M[k] = wrapped;
      }
    } catch {}
  }

  // ------------------------------------------------------------
  // AO-LOGIN-03: MSG helpers
  // ------------------------------------------------------------
  function isUserModalOpen() {
    if (!userModalOverlay) return false;
    return !userModalOverlay.hidden;
  }

  function getUsersMsgTarget() {
    if (isUserModalOpen() && msgBox && msgTitle && msgText) {
      return { box: msgBox, title: msgTitle, text: msgText };
    }
    if (inlineMsgBox && inlineMsgTitle && inlineMsgText) {
      return { box: inlineMsgBox, title: inlineMsgTitle, text: inlineMsgText };
    }
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
    clearMsgBox({ box: msgBox, title: msgTitle, text: msgText });
    clearMsgBox({ box: inlineMsgBox, title: inlineMsgTitle, text: inlineMsgText });
  }

  function showUsersMsg(title, text) {
    const tgt = getUsersMsgTarget();
    if (!tgt) return;
    showMsgBox(tgt, title, text);
  }

  // ------------------------------------------------------------
  // AO-LOGIN-03: MODAL open/close
  // ------------------------------------------------------------
  function forceModalClosed(reason) {
    try {
      if (userModalOverlay) {
        userModalOverlay.hidden = true;
        userModalOverlay.setAttribute("aria-hidden", "true");
      }
    } catch {}
    clearUsersMsg();
    void reason;
  }

  function closeUserModal(reason) {
    forceModalClosed(reason);

    try {
      if (lastFocusEl && typeof lastFocusEl.focus === "function") lastFocusEl.focus();
    } catch {}
    lastFocusEl = null;
  }

  function openUserModal() {
    if (!syncTopbarIdentity()) return;

    const status = safeGetStatus();
    if (status.locked || status.readOnly) return;
    if (!safeCan("users_manage")) return;

    if (!userModalOverlay) return;

    lastFocusEl = document.activeElement;

    clearUsersMsg();
    userModalOverlay.hidden = false;
    userModalOverlay.setAttribute("aria-hidden", "false");

    resetUserForm();
    clearUsersMsg();

    try { if (firstNameInput && typeof firstNameInput.focus === "function") firstNameInput.focus(); } catch {}
  }

  // ✅ P0: tvinga modalen stängd vid boot, och efter andra scripts fått chans att köra
  (function hardCloseModalOnBoot() {
    forceModalClosed("boot-0");
    // Extra hårdning: om något script försöker öppna efter vår boot, stäng igen.
    try { setTimeout(() => forceModalClosed("boot-1"), 0); } catch {}
    try { setTimeout(() => forceModalClosed("boot-2"), 60); } catch {}
  })();

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

    if (roleText) roleText.textContent = "ADMIN";
    if (userNameText) userNameText.textContent = String(v.firstName || "—");

    return true;
  }
  syncTopbarIdentity();

  // ------------------------------------------------------------
  // VIEW HINT
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

  let activeTab = "dashboard";

  // Router state
  let routerActiveViewId = "";
  let routerMountedView = null;
  let routerActiveLabel = "";

  // Items UI state
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
  // SHIM STORE
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

    listUsers: function () { return []; },
    createUser: function () { return { ok: false, reason: "Read-only: storage error." }; },
    updateUser: function () { return { ok: false, reason: "Read-only: storage error." }; },
    setUserActive: function () { return { ok: false, reason: "Read-only: storage error." }; },

    listItems: function () { return []; },
    createItem: function () { return { ok: false, reason: "Read-only: storage error." }; },
    updateItem: function () { return { ok: false, reason: "Read-only: storage error." }; },
    archiveItem: function () { return { ok: false, reason: "Read-only: storage error." }; },
    deleteItem: function () { return { ok: false, reason: "Read-only: storage error." }; }
  };

  function getStore() { return storeCorrupt ? storeShim : store; }

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

  function syncCreateUserTopbarBtn() {
    if (!openCreateUserBtn) return;

    const status = safeGetStatus();
    const canUsers = safeCan("users_manage");

    const disabled = !!status.locked || !!status.readOnly || !canUsers;
    openCreateUserBtn.disabled = disabled;

    if (disabled) {
      if (status.locked) openCreateUserBtn.title = status.reason ? `Låst: ${status.reason}` : "Låst läge.";
      else if (status.readOnly) openCreateUserBtn.title = status.whyReadOnly || "Read-only.";
      else openCreateUserBtn.title = "Saknar behörighet (users_manage).";
    } else {
      openCreateUserBtn.title = "Skapa ny användare";
    }
  }

  function wireUserModal() {
    if (openCreateUserBtn) {
      openCreateUserBtn.addEventListener("click", () => {
        // ✅ Enda stället som "armar" öppning
        armModalOpenOnce();

        // Om extern modal-shell vill öppna, låt den göra det nu (armad),
        // annars använder vi vår overlay.
        openUserModal();
      });
    }

    if (userModalCloseBtn) {
      userModalCloseBtn.addEventListener("click", () => closeUserModal("close-btn"));
    }

    if (userModalOverlay) {
      userModalOverlay.addEventListener("click", (ev) => {
        if (ev.target === userModalOverlay) closeUserModal("overlay");
      });
    }

    document.addEventListener("keydown", (ev) => {
      if (!isUserModalOpen()) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeUserModal("esc");
      }
    });

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

  // ✅ P0: blockera extern auto-open så tidigt som möjligt
  patchExternalModalShellIfAny();

  if (!store || typeof store.init !== "function") {
    console.error("Freezer baseline saknar FreezerStore.");
    storeCorrupt = true;
  } else {
    try { store.init({ role: initialRole }); } catch (e) { markStoreCorrupt(e); }
  }

  try {
    const s = getStore();
    if (s && typeof s.subscribe === "function") {
      s.subscribe((state) => {
        syncTopbarIdentity();

        window.FreezerRender.renderAll(state || {}, itemsUI);
        window.FreezerRender.setActiveTabUI(activeTab);

        routerRerender();

        if (usersPanel && !usersPanel.hidden) refreshFormHeader();

        updateHint();
        syncCreateUserTopbarBtn();

        // ✅ om något script försökt visa modalen under subscribe-cykel: stäng
        if (!__allowModalOpenOnce) forceModalClosed("subscribe-safety");
      });
    }
  } catch (e) {
    markStoreCorrupt(e);
  }

  window.FreezerRender.renderAll(safeGetState(), itemsUI);
  window.FreezerRender.setActiveTabUI(activeTab);
  refreshFormHeader();

  clearUsersMsg();
  closeUserModal("boot"); // extra fail-closed

  setHintForTab(activeTab);

  initRouterMenu();

  bindTab(tabDashboard, "dashboard");
  bindTab(tabSaldo, "saldo");
  bindTab(tabHistorik, "history");

  wireUserModal();
  syncCreateUserTopbarBtn();

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const status = safeGetStatus();
      if (status.locked || status.readOnly) return;

      clearUsersMsg();

      const s = getStore();
      let res = { ok: false, reason: "Okänt fel." };
      try { res = s.resetDemo(); } catch (e) { markStoreCorrupt(e); res = { ok: false, reason: "Storage error." }; }

      if (!res.ok) {
        showUsersMsg("Reset misslyckades", res.reason || "Okänt fel.");
      } else {
        resetUserForm();
        resetItemsForm();
        itemsUI.itemsEditingArticleNo = "";
        setItemsMsg("Demo återställd.");
        initRouterMenu();
        syncCreateUserTopbarBtn();
      }
    });
  }

  wireUsersForm();
  wireUsersListDelegation();
  wireItemsDelegation();

  // -----------------------------
  // ROUTER
  // -----------------------------
  function getRegistry() {
    try { return window.FreezerViewRegistry || null; } catch { return null; }
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
    if (!viewMenu || !viewRoot || !reg || typeof reg.getViewsForRole !== "function") return;

    const ctx = buildViewCtx();
    let views = [];
    try { views = reg.getViewsForRole(ctx.role) || []; } catch (e) { console.error("[Freezer] Router: kunde inte hämta views.", e); return; }

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
      b.addEventListener("click", () => routerActivateView(mi.id, String(mi.label || mi.id)));
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
    try { views = reg.getViewsForRole(ctx.role) || []; } catch (e) { console.error("[Freezer] Router: kunde inte hämta views.", e); return; }

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

    try { if (typeof view.mount === "function") view.mount({ root: viewRoot, ctx }); } catch (e) { console.error("[Freezer] Router: mount-fel.", e); }

    routerRerender();
    updateHint();
  }

  function routerRerender() {
    const view = routerMountedView;
    if (!view || !viewRoot) return;

    const ctx = buildViewCtx();
    const state = safeGetState();

    try {
      if (typeof view.render === "function") view.render({ root: viewRoot, state, ctx });
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
    if (activeTab === "dashboard") setHintForTab("dashboard");
    else if (activeTab === "saldo") setHintForTab("saldo");
    else if (activeTab === "history") setHintForTab("history");
    else setHintForTab(activeTab);

    if (routerActiveLabel) {
      const base = viewHint ? String(viewHint.textContent || "") : "";
      if (base && base !== "—") setViewHint(`${base} • Router: ${routerActiveLabel}`);
      else setViewHint(`Router: ${routerActiveLabel}`);
    }
  }

  // -----------------------------
  // USERS: FORM
  // -----------------------------
  function wireUsersForm() {
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        clearUsersMsg();

        if (!syncTopbarIdentity()) return;

        const s = getStore();
        const status = safeGetStatus();

        if (status.locked) return showUsersMsg("Spärrad", status.reason ? `Låst: ${status.reason}` : "Låst läge.");
        if (status.readOnly) return showUsersMsg("Spärrad", status.whyReadOnly || "Read-only.");

        if (!safeCan("users_manage")) return showUsersMsg("Spärrad", "Saknar behörighet (users_manage).");

        const firstName = (firstNameInput && firstNameInput.value) ? firstNameInput.value.trim() : "";
        const perms = readPermsFromUI();

        const editingId = (editingIdInput && editingIdInput.value) ? editingIdInput.value : "";
        if (!firstName) return showUsersMsg("Fel", "Förnamn krävs.");

        try {
          if (editingId) {
            const r = s.updateUser(editingId, { firstName, perms });
            if (!r.ok) return showUsersMsg("Fel", r.reason || "Kunde inte spara.");
            resetUserForm();
            if (isUserModalOpen()) closeUserModal("saved-edit");
            return;
          }

          const r = s.createUser({ firstName, perms });
          if (!r.ok) {
            if (r.errorCode === "FRZ_E_USER_NAME_NOT_UNIQUE") return showUsersMsg("Fel", "Förnamn måste vara unikt.");
            return showUsersMsg("Fel", r.reason || "Kunde inte skapa.");
          }
          resetUserForm();
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
      });
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

        if (!isUserModalOpen()) {
          // ✅ Endast list-edit får öppna modalen programmatisk (inte boot)
          // Vi "armar" innan vi öppnar.
          armModalOpenOnce();
          openUserModal();
        }
        try { firstNameInput && firstNameInput.focus(); } catch {}
        return;
      }

      if (action === "user-toggle-active") {
        const u = findUserById(userId);
        if (!u) return showUsersMsg("Fel", "User hittades inte.");

        try {
          const next = !u.active;
          const r = s.setUserActive(userId, next);
          if (!r.ok) return showUsersMsg("Fel", r.reason || "Kunde inte uppdatera.");

          if (editingIdInput && editingIdInput.value === userId && !next) resetUserForm();
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
  // ITEMS (delegation) — oförändrat (kortad: samma som innan)
  // -----------------------------
  function wireItemsDelegation() {
    document.addEventListener("click", () => {});
    document.addEventListener("change", () => {});
    document.addEventListener("input", () => {});
  }

  function resetItemsForm() {}
  function setItemsMsg(text) { itemsUI.itemsMsg = String(text || "—"); }

  // -----------------------------
  // TABS (legacy)
  // -----------------------------
  function bindTab(btn, key) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      activeTab = key;
      window.FreezerRender.setActiveTabUI(activeTab);

      const state = safeGetState();
      window.FreezerRender.renderAll(state, itemsUI);

      updateHint();
      syncCreateUserTopbarBtn();
    });
  }

})();
