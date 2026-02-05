/* ============================================================
AO-03/15 — Users CRUD + rättigheter (Admin) | BLOCK 4/4
AUTOPATCH | FIL: admin/freezer.js
Projekt: Freezer (UI-only / localStorage-first)

AO-04/15 — Produktregister (Items) CRUD (Admin) — LÅST fältkontrakt
BLOCK 1/6 (stort AO):
- Wire Items CRUD UI (renderas i Saldo-vyn av freezer-render.js)
- Sök + sort + kategori-filter
- Create/Update/Archive/Delete(guarded)
- Arkivera är standard-action; delete kräver confirm och kan blockeras av guard

PATCH (AO-04 BLOCK 4/6):
- Begränsa Items-delegation till Saldo/Items-scope (scope-guard, fail-soft om DOM-id saknas)
- Inför tydlig semantik: hasPerm (RBAC) vs can (write-allowed) i controller
- Tydliga spärr-meddelanden: locked vs read-only vs saknar perm
- Stoppa NaN i payload (validering)
- Konsekvent editor-läge: new/edit/cancel/save
- Ingen ny storage-key/datamodell, XSS-safe (render ansvarar)

Policy:
- Inga nya storage-keys/datamodell
- XSS-safe (render sköter textContent)
============================================================ */

(function () {
  "use strict";

  const tabDashboard = byId("tabDashboard");
  const tabSaldo = byId("tabSaldo");
  const tabHistorik = byId("tabHistorik");

  const userSelect = byId("frzUserSelect");
  const resetBtn = byId("frzResetDemoBtn");

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

  if (!window.FreezerStore || !window.FreezerRender) {
    console.error("Freezer baseline saknar FreezerStore eller FreezerRender.");
    return;
  }

  // -----------------------------
  // BOOT
  // -----------------------------
  const initialRole = (userSelect && userSelect.value) ? userSelect.value : "ADMIN";
  window.FreezerStore.init({ role: initialRole });

  window.FreezerStore.subscribe((state) => {
    window.FreezerRender.renderAll(state, itemsUI);
    window.FreezerRender.setActiveTabUI(activeTab);

    if (usersPanel && !usersPanel.hidden) {
      refreshFormHeader();
    }
  });

  // Tabs
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
        resetItemsForm();
        itemsUI.itemsEditingArticleNo = "";
        setItemsMsg("Demo återställd.");
      }
    });
  }

  // Users actions
  wireUsersForm();
  wireUsersListDelegation();

  // AO-04: Items actions (delegation in scope)
  wireItemsDelegation();

  // Initial UI
  window.FreezerRender.setActiveTabUI(activeTab);
  refreshFormHeader();

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
  // AO-04: ITEMS (delegation)
  // -----------------------------
  function wireItemsDelegation() {
    // NOTE: Vi kör document-level delegation men med hård scope-guard så att andra vyer inte triggar items-logik.
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
      const status = window.FreezerStore.getStatus();

      // Always block if locked
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

        // read fields from DOM (render creates these ids)
        readItemsFormFromDOM();

        const payloadRes = buildItemPayloadFromUIValidated();
        if (!payloadRes.ok) return setItemsMsg(payloadRes.reason);

        const payload = payloadRes.payload;

        if (itemsUI.itemsEditingArticleNo) {
          const r = window.FreezerStore.updateItem(itemsUI.itemsEditingArticleNo, payload);
          if (!r.ok) return setItemsMsg(r.reason || "Kunde inte spara.");

          // Konsekvent policy: lämna editläge efter save
          resetItemsForm();
          itemsUI.itemsEditingArticleNo = "";
          setItemsMsg("Uppdaterad.");
          rerender();
          return;
        }

        const r = window.FreezerStore.createItem(payload);
        if (!r.ok) return setItemsMsg(r.reason || "Kunde inte skapa.");

        resetItemsForm();
        itemsUI.itemsEditingArticleNo = "";
        setItemsMsg("Skapad.");
        rerender();
        return;
      }

      if (action === "item-edit") {
        // Read-action: tillåt även i read-only (render ska disable:a inputs/knappar)
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

        const r = window.FreezerStore.archiveItem(articleNo);
        if (!r.ok) return setItemsMsg(r.reason || "Kunde inte arkivera.");

        if (itemsUI.itemsEditingArticleNo === articleNo) {
          resetItemsForm();
          itemsUI.itemsEditingArticleNo = "";
        }
        setItemsMsg("Arkiverad.");
        rerender();
        return;
      }

      if (action === "item-delete") {
        const gate = gateItemsWrite(status);
        if (!gate.ok) return setItemsMsg(gate.msg);
        if (!articleNo) return;

        const ok = window.confirm(`Radera ${articleNo} permanent?\n(Detta kan blockeras om referenser finns.)`);
        if (!ok) return;

        const r = window.FreezerStore.deleteItem(articleNo);
        if (!r.ok) return setItemsMsg(r.reason || "Radering blockerad.");

        if (itemsUI.itemsEditingArticleNo === articleNo) {
          resetItemsForm();
          itemsUI.itemsEditingArticleNo = "";
        }
        setItemsMsg("Raderad.");
        rerender();
        return;
      }
    });

    document.addEventListener("change", (ev) => {
      const t = ev.target;
      if (!t || !(t instanceof HTMLElement)) return;

      // Scope-guard: Items-filters endast inom items-scope
      if (!isInItemsScope(t)) return;

      const id = t.id || "";
      if (!id) return;

      if (id === "frzItemsQ") {
        itemsUI.itemsQ = String(t.value || "");
        rerender();
        return;
      }
      if (id === "frzItemsCategory") {
        itemsUI.itemsCategory = String(t.value || "");
        rerender();
        return;
      }
      if (id === "frzItemsSortKey") {
        itemsUI.itemsSortKey = String(t.value || "articleNo");
        rerender();
        return;
      }
      if (id === "frzItemsSortDir") {
        itemsUI.itemsSortDir = String(t.value || "asc");
        rerender();
        return;
      }
      if (id === "frzItemsIncludeInactive") {
        itemsUI.itemsIncludeInactive = !!(t.checked);
        rerender();
        return;
      }
    });

    document.addEventListener("input", (ev) => {
      const t = ev.target;
      if (!t || !(t instanceof HTMLElement)) return;

      // Scope-guard
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
    // GUARD: Om DOM-id saknas (t.ex. render ändrar wrapper) -> fail-soft (tillåt) för att inte "döda" items.
    try {
      const viewSaldo = document.getElementById("viewSaldo");
      if (viewSaldo) return !!el.closest("#viewSaldo");

      // Fallback: om vi hittar någon känd items-control i DOM, använd dess närmaste container som scope-hint
      const q = document.getElementById("frzItemsQ");
      if (q && q.parentElement) {
        const root = q.closest("#frzItemsPanel") || q.closest("#frzSaldoTableWrap") || q.closest("main") || q.closest("section");
        if (root) return !!el.closest(`#${root.id}`) || root.contains(el);
      }

      // Direkt kända wrappers/containers (om de finns)
      if (document.getElementById("frzSaldoTableWrap")) return !!el.closest("#frzSaldoTableWrap");
      if (document.getElementById("frzItemsPanel")) return !!el.closest("#frzItemsPanel");

      return true; // fail-soft
    } catch {
      return true; // fail-soft
    }
  }

  function gateItemsWrite(status) {
    if (status.locked) {
      return { ok: false, msg: status.reason ? `Låst: ${status.reason}` : "Låst läge." };
    }
    if (status.readOnly) {
      return { ok: false, msg: status.whyReadOnly || "Read-only: skrivning är spärrad." };
    }

    // Semantik: hasPerm = RBAC, can = write-allowed.
    // Här vill vi: RBAC + (inte readOnly/locked) => write.
    const hasPermFn = (window.FreezerStore && typeof window.FreezerStore.hasPerm === "function")
      ? window.FreezerStore.hasPerm
      : null;

    const hasPerm = hasPermFn
      ? !!hasPermFn.call(window.FreezerStore, "inventory_write")
      : !!(window.FreezerStore && window.FreezerStore.can && window.FreezerStore.can("inventory_write"));

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
      // Min level är normalt heltal, men kontraktet får avgöra. Vi skickar Number.
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
      const all = window.FreezerStore.listItems({ includeInactive: true });
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
    } catch {}
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
      const state = window.FreezerStore.getState();
      window.FreezerRender.renderAll(state, itemsUI);
      window.FreezerRender.setActiveTabUI(activeTab);
    } catch {}
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
      window.FreezerRender.renderStatus(state);
      window.FreezerRender.renderMode(state);
      window.FreezerRender.renderLockPanel(state);
      window.FreezerRender.renderDebug(state);

      // AO-04: keep items panel updated when entering saldo
      window.FreezerRender.renderAll(state, itemsUI);
    });
  }

  function byId(id) { return document.getElementById(id); }

})();
