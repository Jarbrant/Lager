
/* ============================================================
AO-13/15 — Flytta Users CRUD från router till admin-users view
NY FIL | UI/pages/freezer/admin/admin-users.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- Flyttar all Users CRUD wiring (form + lista + messages) från admin/freezer.js till en view-controller
- Exponerar window.FreezerAdminUsers.createController(...) så legacy page/controller kan använda den
- Ingen storage, inga sid-effekter utanför event listeners
- XSS-safe: endast textContent

Policy:
- Inga nya storage-keys/datamodell
============================================================ */

function safeText(v) { return String(v == null ? "" : v); }

function pickEl(root, id) {
  // Root-scoped först (minskar risk för id-krockar), fallback till document.
  return (root && root.querySelector && root.querySelector(`#${id}`)) || document.getElementById(id);
}

function isEl(x) { return !!x && typeof x === "object" && x.nodeType === 1; }

function getUsersRoot() {
  // Users-panelen ligger i dashboard-vyn i admin/freezer.html
  const panel = document.getElementById("frzUsersPanel");
  return panel || document;
}

export function createController({ store, render, getActiveTab, rerender }) {
  const root = getUsersRoot();

  // DOM
  const usersPanel = pickEl(root, "frzUsersPanel");
  const usersList = pickEl(root, "frzUsersList");

  const msgBox = pickEl(root, "frzUsersMsg");
  const msgTitle = pickEl(root, "frzUsersMsgTitle");
  const msgText = pickEl(root, "frzUsersMsgText");

  const formTitle = pickEl(root, "frzUserFormTitle");
  const formMode = pickEl(root, "frzUserFormMode");
  const firstNameInput = pickEl(root, "frzUserFirstName");
  const editingIdInput = pickEl(root, "frzUserEditingId");
  const saveBtn = pickEl(root, "frzUserSaveBtn");
  const cancelBtn = pickEl(root, "frzUserCancelBtn");

  const cbUsersManage = pickEl(root, "perm_users_manage");
  const cbInvWrite = pickEl(root, "perm_inventory_write");
  const cbHistWrite = pickEl(root, "perm_history_write");
  const cbDashView = pickEl(root, "perm_dashboard_view");

  // listeners references
  let bound = false;

  function canUsersManage(status) {
    if (status && status.locked) return { ok: false, msg: status.reason ? `Låst: ${status.reason}` : "Låst läge." };
    if (status && status.readOnly) return { ok: false, msg: status.whyReadOnly || "Read-only." };
    if (!store || typeof store.can !== "function") return { ok: false, msg: "Systemfel: store.can saknas." };
    if (!store.can("users_manage")) return { ok: false, msg: "Saknar behörighet (users_manage)." };
    return { ok: true, msg: "" };
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

  function showMsg(title, text) {
    if (!msgBox || !msgTitle || !msgText) return;
    msgTitle.textContent = title || "Info";
    msgText.textContent = text || "—";
    msgBox.hidden = false;
  }

  function clearMsg() {
    if (!msgBox || !msgTitle || !msgText) return;
    msgBox.hidden = true;
    msgTitle.textContent = "Info";
    msgText.textContent = "—";
  }

  function findUserById(id) {
    try {
      const users = store.listUsers();
      return users.find(u => u && u.id === id) || null;
    } catch {
      return null;
    }
  }

  function onSaveClick() {
    clearMsg();

    const status = store.getStatus();
    const gate = canUsersManage(status);
    if (!gate.ok) return showMsg("Spärrad", gate.msg);

    const firstName = (firstNameInput && firstNameInput.value) ? firstNameInput.value.trim() : "";
    if (!firstName) return showMsg("Fel", "Förnamn krävs.");

    const perms = readPermsFromUI();
    const editingId = (editingIdInput && editingIdInput.value) ? editingIdInput.value : "";

    if (editingId) {
      const r = store.updateUser(editingId, { firstName, perms });
      if (!r.ok) return showMsg("Fel", r.reason || "Kunde inte spara.");
      resetUserForm();
      return;
    }

    const r = store.createUser({ firstName, perms });
    if (!r.ok) {
      if (r.errorCode === "FRZ_E_USER_NAME_NOT_UNIQUE") return showMsg("Fel", "Förnamn måste vara unikt.");
      return showMsg("Fel", r.reason || "Kunde inte skapa.");
    }

    resetUserForm();
  }

  function onCancelClick() {
    clearMsg();
    resetUserForm();
  }

  function onListClick(ev) {
    const t = ev.target;
    if (!t || !isEl(t)) return;

    const btn = t.closest("button[data-action]");
    if (!btn) return;

    const action = btn.getAttribute("data-action") || "";
    const userId = btn.getAttribute("data-user-id") || "";

    clearMsg();

    const status = store.getStatus();
    const gate = canUsersManage(status);
    if (!gate.ok) return showMsg("Spärrad", gate.msg);

    if (!userId) return;

    if (action === "user-edit") {
      const u = findUserById(userId);
      if (!u) return showMsg("Fel", "User hittades inte.");

      if (editingIdInput) editingIdInput.value = safeText(u.id);
      if (firstNameInput) firstNameInput.value = safeText(u.firstName);
      setPermsToUI(u.perms || {});
      refreshFormHeader();
      if (firstNameInput && firstNameInput.focus) firstNameInput.focus();
      return;
    }

    if (action === "user-toggle-active") {
      const u = findUserById(userId);
      if (!u) return showMsg("Fel", "User hittades inte.");

      const next = !u.active;
      const r = store.setUserActive(userId, next);
      if (!r.ok) return showMsg("Fel", r.reason || "Kunde inte uppdatera.");

      if (editingIdInput && editingIdInput.value === userId && !next) {
        resetUserForm();
      }
      return;
    }
  }

  function mount() {
    if (bound) return;
    bound = true;

    if (saveBtn) saveBtn.addEventListener("click", onSaveClick);
    if (cancelBtn) cancelBtn.addEventListener("click", onCancelClick);
    if (usersList) usersList.addEventListener("click", onListClick);

    refreshFormHeader();
  }

  function unmount() {
    if (!bound) return;
    bound = false;

    if (saveBtn) saveBtn.removeEventListener("click", onSaveClick);
    if (cancelBtn) cancelBtn.removeEventListener("click", onCancelClick);
    if (usersList) usersList.removeEventListener("click", onListClick);
  }

  // API för freezer.js
  const api = {
    onState(state) {
      // Om panelen visas (RBAC i render/controller) — håll rubriker synkade
      try {
        if (usersPanel && !usersPanel.hidden) refreshFormHeader();
      } catch {}
    },
    onTabChange(tabKey) {
      // Behåll enkelhet: inga tab-specifika side effects nu.
      // (Users-panel ligger i dashboard; render styr visibility)
      try {
        if (tabKey === "dashboard" && usersPanel && !usersPanel.hidden) refreshFormHeader();
      } catch {}
    },
    dispose() { unmount(); }
  };

  mount();
  return api;
}

// Global registry så legacy script (admin/freezer.js) kan hitta controllern
if (!window.FreezerAdminUsers) {
  window.FreezerAdminUsers = { createController };
} else {
  // Fail-soft: uppdatera om det redan finns (t.ex. vid hot reload)
  window.FreezerAdminUsers.createController = createController;
}

