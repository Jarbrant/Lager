/* ============================================================
AO-03/15 — Users CRUD + rättigheter (Admin) | BLOCK 4/4
AUTOPATCH | FIL: admin/freezer.js
Projekt: Freezer (UI-only / localStorage-first)

AO-11/15 — Router kopplar in shared views i meny för alla roller

AO-12/15 — Flytta Items CRUD från router till admin-items view
PATCH:
- Tar bort Items-delegation/controller från denna fil
- Initierar Items-controller från UI/pages/freezer/admin/admin-items.js (global: window.FreezerAdminItems)
- Page/router hålls tunn: renderAll(state, itemsUI) får itemsUI från controller

Policy:
- Inga nya storage-keys/datamodell
- XSS-safe (render sköter textContent)
============================================================ */

(function () {
  "use strict";

  // P0 GUARD: skydda mot dubbel init (dubbla event listeners)
  if (window.__FREEZER_PAGE_INIT__) return;
  window.__FREEZER_PAGE_INIT__ = true;

  const tabDashboard = byId("tabDashboard");
  const tabSaldo = byId("tabSaldo");
  const tabHistorik = byId("tabHistorik");

  const userSelect = byId("frzUserSelect");
  const resetBtn = byId("frzResetDemoBtn");

  // Router shell DOM
  const viewMenu = byId("freezerViewMenu");

  // Users UI
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

  // Page state
  let activeTab = "dashboard";

  if (!window.FreezerStore || !window.FreezerRender) {
    console.error("Freezer baseline saknar FreezerStore eller FreezerRender.");
    return;
  }

  // -----------------------------
  // BOOT
  // -----------------------------
  const initialRole = (userSelect && userSelect.value) ? userSelect.value : "ADMIN";
  window.FreezerStore.init({ role: initialRole });

  // AO-12: Items controller (flyttad hit från denna fil)
  // Fail-soft: om admin-items.js inte är laddad än, blir Items inte wired.
  const itemsController = initItemsControllerFailSoft();

  window.FreezerStore.subscribe((state) => {
    const itemsUI = itemsController ? itemsController.itemsUI : null;

    window.FreezerRender.renderAll(state, itemsUI);
    window.FreezerRender.setActiveTabUI(activeTab);

    // AO-11: uppdatera router-meny när state/role ändras
    renderRouterMenuFromState(state);

    if (usersPanel && !usersPanel.hidden) {
      refreshFormHeader();
    }
  });

  // Tabs (legacy)
  bindTab(tabDashboard, "dashboard");
  bindTab(tabSaldo, "saldo");
  bindTab(tabHistorik, "history");

  // Role select (legacy)
  if (userSelect) {
    userSelect.addEventListener("change", () => {
      const role = userSelect.value || "ADMIN";
      window.FreezerStore.setRole(role);

      const st = window.FreezerStore.getStatus();
      if (st && userSelect.value !== st.role) userSelect.value = st.role;

      // AO-11: håll router-menyn i sync
      const state = window.FreezerStore.getState();
      renderRouterMenuFromState(state);
    });
  }

  // Reset demo
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const status = window.FreezerStore.getStatus();
      if (status.locked || status.readOnly) return;

      clearUsersMsg();
      const res = window.FreezerStore.resetDemo();
      if (!res.ok) {
        showUsersMsg("Reset misslyckades", res.reason || "Okänt fel.");
      } else {
        resetUserForm();
        if (itemsController && typeof itemsController.reset === "function") {
          itemsController.reset();
        }
        // Items msg/refresh sker via controller->rerender + store subscribe
      }
    });
  }

  // Users actions
  wireUsersForm();
  wireUsersListDelegation();

  // AO-11: första render av router-menyn (fail-soft om shell saknas)
  try {
    renderRouterMenuFromState(window.FreezerStore.getState());
  } catch {}

  // Initial UI
  window.FreezerRender.setActiveTabUI(activeTab);
  refreshFormHeader();

  // -----------------------------
  // AO-12: Items controller init (fail-soft)
  // -----------------------------
  function initItemsControllerFailSoft() {
    try {
      const api = window.FreezerAdminItems;
      if (!api || typeof api.createController !== "function") {
        // Fail-soft: lämna items unwired om filen inte laddas än
        return null;
      }
      const ctrl = api.createController({
        rerender
      });
      return ctrl;
    } catch {
      return null;
    }
  }

  function rerender() {
    try {
      const state = window.FreezerStore.getState();
      const itemsUI = itemsController ? itemsController.itemsUI : null;
      window.FreezerRender.renderAll(state, itemsUI);
      window.FreezerRender.setActiveTabUI(activeTab);
      renderRouterMenuFromState(state);
    } catch {}
  }

  // -----------------------------
  // AO-11: ROUTER-MENY (Saldo/Historik för alla roller)
  // -----------------------------
  function renderRouterMenuFromState(state) {
    if (!viewMenu) return;

    while (viewMenu.firstChild) viewMenu.removeChild(viewMenu.firstChild);

    const role = (state && state.status && state.status.role) ? String(state.status.role) : "";
    const isRO = !!(state && state.status && state.status.readOnly);

    const btnSaldo = makeViewBtn("Saldo", "shared-saldo", () => {
      switchToLegacyTab("saldo");
    });

    const btnHist = makeViewBtn("Historik", "shared-history", () => {
      switchToLegacyTab("history");
    });

    btnSaldo.setAttribute("aria-selected", activeTab === "saldo" ? "true" : "false");
    btnHist.setAttribute("aria-selected", activeTab === "history" ? "true" : "false");

    btnSaldo.title = `Router-vy: Saldo • role=${role || "—"}${isRO ? " • read-only" : ""}`;
    btnHist.title = `Router-vy: Historik • role=${role || "—"}${isRO ? " • read-only" : ""}`;

    viewMenu.appendChild(btnSaldo);
    viewMenu.appendChild(btnHist);
  }

  function makeViewBtn(label, viewId, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tabBtn";
    b.setAttribute("data-view-id", viewId);
    b.textContent = String(label || "Vy");
    b.addEventListener("click", onClick);
    return b;
  }

  function switchToLegacyTab(key) {
    if (key === "dashboard" && tabDashboard) return tabDashboard.click();
    if (key === "saldo" && tabSaldo) return tabSaldo.click();
    if (key === "history" && tabHistorik) return tabHistorik.click();

    activeTab = key;
    window.FreezerRender.setActiveTabUI(activeTab);
    rerender();
  }

  // -----------------------------
  // USERS: FORM
  // -----------------------------
  function wireUsersForm() {
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        clearUsersMsg();

        const status = window.FreezerStore.getStatus();
        if (status.locked) return showUsersMsg("Spärrad", status.reason ? `Låst: ${status.reason}` : "Låst läge.");
        if (status.readOnly) return showUsersMsg("Spärrad", status.whyReadOnly || "Read-only.");

        if (!window.FreezerStore.can("users_manage")) {
          return showUsersMsg("Spärrad", "Saknar behörighet (users_manage).");
        }

        const firstName = (firstNameInput && firstNameInput.value) ? firstNameInput.value.trim() : "";
        const perms = readPermsFromUI();

        const editingId = (editingIdInput && editingIdInput.value) ? editingIdInput.value : "";

        if (!firstName) return showUsersMsg("Fel", "Förnamn krävs.");

        if (editingId) {
          const r = window.FreezerStore.updateUser(editingId, { firstName, perms });
          if (!r.ok) return showUsersMsg("Fel", r.reason || "Kunde inte spara.");
          resetUserForm();
          return;
        }

        const r = window.FreezerStore.createUser({ firstName, perms });
        if (!r.ok) {
          if (r.errorCode === "FRZ_E_USER_NAME_NOT_UNIQUE") return showUsersMsg("Fel", "Förnamn måste vara unikt.");
          return showUsersMsg("Fel", r.reason || "Kunde inte skapa.");
        }

        resetUserForm();
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

      const action = btn.getAttribute("data-action") || "";
      const userId = btn.getAttribute("data-user-id") || "";

      clearUsersMsg();

      const status = window.FreezerStore.getStatus();
      if (status.locked) return showUsersMsg("Spärrad", status.reason ? `Låst: ${status.reason}` : "Låst läge.");
      if (status.readOnly) return showUsersMsg("Spärrad", status.whyReadOnly || "Read-only.");
      if (!window.FreezerStore.can("users_manage")) return showUsersMsg("Spärrad", "Saknar behörighet (users_manage).");

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

        const next = !u.active;
        const r = window.FreezerStore.setUserActive(userId, next);
        if (!r.ok) return showUsersMsg("Fel", r.reason || "Kunde inte uppdatera.");

        if (editingIdInput && editingIdInput.value === userId && !next) {
          resetUserForm();
        }
        return;
      }
    });
  }

  function findUserById(id) {
    try {
      const users = window.FreezerStore.listUsers();
      return users.find(u => u && u.id === id) || null;
    } catch {
      return null;
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
  // TABS
  // -----------------------------
  function bindTab(btn, key) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      activeTab = key;
      window.FreezerRender.setActiveTabUI(activeTab);

      const state = window.FreezerStore.getState();
      const itemsUI = itemsController ? itemsController.itemsUI : null;

      window.FreezerRender.renderStatus(state);
      window.FreezerRender.renderMode(state);
      window.FreezerRender.renderLockPanel(state);
      window.FreezerRender.renderDebug(state);

      window.FreezerRender.renderAll(state, itemsUI);
      renderRouterMenuFromState(state);
    });
  }

  function byId(id) { return document.getElementById(id); }

})();
