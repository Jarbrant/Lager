/* ============================================================
AO-03/15 — Users CRUD + rättigheter (Admin) | BLOCK 4/4
AUTOPATCH v1.0.1 | FIL: admin/freezer.js
Projekt: Freezer (UI-only / localStorage-first)

AO-04/15 — Produktregister (Items) CRUD (Admin) — delegation (tills flytt i AO-12)
AO-11/15 — Router: shared views i meny för alla roller (Saldo/Historik)
AO-15/15 — QA-stabilisering:
- Inga dubbla listeners vid vybyte / dubbel script-load (init-guard)
- Korrupt storage -> read-only men navigation funkar (shim-store fail-soft)
- Robust scope-guard + readVal
- P0 FIX: kör init först när DOM är redo + skapa router-shell via JS om saknas
- P0 FIX: retry-vänta på FreezerViewRegistry (ESM) om den laddas efter denna fil

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

  // ------------------------------------------------------------
  // P0: kör init först när DOM är redo (om script ligger i <head>)
  // ------------------------------------------------------------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  function boot() {
    // ====== DOM helpers ======
    function byId(id) { return document.getElementById(id); }
    function el(tag) { return document.createElement(tag); }

    // ------------------------------------------------------------
    // Hämta tabs (kan vara null om layout inte har legacy-tabs)
    // ------------------------------------------------------------
    const tabDashboard = byId("tabDashboard");
    const tabSaldo = byId("tabSaldo");
    const tabHistorik = byId("tabHistorik");

    const userSelect = byId("frzUserSelect");
    const resetBtn = byId("frzResetDemoBtn");

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

    // Page state
    let activeTab = "dashboard";

    // AO-11: router state (in-memory)
    let routerActiveViewId = "";
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
      console.error("[Freezer] baseline saknar FreezerRender. Kontrollera script-ordning i admin/freezer.html.");
      return;
    }

    // ------------------------------------------------------------
    // AO-11: Router shell (SKAPA VIA JS om saknas)
    // ------------------------------------------------------------
    const routerShell = ensureRouterShell();
    const viewMenu = routerShell.menu;
    const viewRoot = routerShell.root;

    function ensureRouterShell() {
      // Försök hitta befintliga
      let menu = byId("freezerViewMenu");
      let root = byId("freezerViewRoot");

      if (menu && root) return { menu, root };

      // Skapa container och lägg på ett rimligt ställe:
      // 1) i dashboard-vyn om den finns
      // 2) annars i <main>
      // 3) annars i <body>
      const host =
        byId("viewDashboard") ||
        byId("dashboardView") ||
        document.querySelector("main") ||
        document.body;

      const shell = el("section");
      shell.id = "freezerRouterShell";
      shell.style.margin = "12px 0";
      shell.style.padding = "0";
      shell.style.display = "block";

      // Menyrad
      menu = el("div");
      menu.id = "freezerViewMenu";
      menu.style.display = "flex";
      menu.style.flexWrap = "wrap";
      menu.style.gap = "8px";
      menu.style.alignItems = "center";
      menu.style.margin = "0 0 10px 0";

      // Root (render-yta)
      root = el("div");
      root.id = "freezerViewRoot";
      root.style.minHeight = "80px";

      shell.appendChild(menu);
      shell.appendChild(root);

      try {
        host.appendChild(shell);
        console.warn("[Freezer] Router-shell saknades i DOM → skapad via JS (#freezerViewMenu/#freezerViewRoot).");
      } catch (e) {
        console.error("[Freezer] Kunde inte injicera router-shell.", e);
      }

      return { menu, root };
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
    // BOOT: init store
    // ------------------------------------------------------------
    const initialRole = (userSelect && userSelect.value) ? userSelect.value : "ADMIN";

    if (!store || typeof store.init !== "function") {
      console.error("[Freezer] baseline saknar FreezerStore. (Render kör ändå; router försöker ändå.)");
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

    // Tabs (legacy navigation ska funka även om store är korrupt)
    bindTab(tabDashboard, "dashboard");
    bindTab(tabSaldo, "saldo");
    bindTab(tabHistorik, "history");

    // Role select (legacy)
    if (userSelect) {
      userSelect.addEventListener("change", () => {
        const role = userSelect.value || "ADMIN";
        const s = getStore();

        try {
          if (!storeCorrupt && s && typeof s.setRole === "function") s.setRole(role);
        } catch (e) {
          markStoreCorrupt(e);
        }

        // router meny efter rollbyte
        initRouterMenuWithRetry();

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
          initRouterMenuWithRetry();
        }
      });
    }

    // Users actions (legacy)
    wireUsersForm();
    wireUsersListDelegation();

    // AO-04: Items actions (delegation in scope) — tills flytt i AO-12
    wireItemsDelegation();

    // ------------------------------------------------------------
    // AO-11: ROUTER MENU + MOUNT (med retry om registry laddas efter)
    // ------------------------------------------------------------
    initRouterMenuWithRetry();

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
        can: function (perm) { return safeCan(String(perm || "")); }
      };
    }

    function initRouterMenuWithRetry() {
      // P0: om ESM registry laddas efter denna non-module fil, vänta kort.
      const maxTries = 30;        // ~3s
      const delayMs = 100;

      let tries = 0;
      (function tick() {
        tries++;

        const reg = getRegistry();
        if (reg && typeof reg.getViewsForRole === "function") {
          initRouterMenu();
          return;
        }

        if (tries === 1) {
          console.warn("[Freezer] Router: FreezerViewRegistry ej redo ännu → retry...");
        }

        if (tries >= maxTries) {
          console.error("[Freezer] Router: FreezerViewRegistry hittades inte. Kontrollera att UI/pages/freezer/01-view-registry.js laddas och sätter window.FreezerViewRegistry.");
          // fail-soft: visa fallback i root
          try {
            if (viewRoot) {
              viewRoot.textContent = "";
              const box = el("div");
              box.className = "panel warn";
              const b = el("b");
              b.textContent = "Router ej aktiv";
              const m = el("div");
              m.className = "muted";
              m.textContent = "FreezerViewRegistry saknas (se Console).";
              box.appendChild(b);
              box.appendChild(m);
              viewRoot.appendChild(box);
            }
          } catch {}
          return;
        }

        setTimeout(tick, delayMs);
      })();
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
      const visible = menuItems.filter((mi) => {
        if (!mi) return false;
        if (!mi.requiredPerm) return true;
        return !!ctx.can(mi.requiredPerm);
      });

      if (!routerActiveViewId && visible.length) routerActiveViewId = visible[0].id;
      if (routerActiveViewId && visible.length && !visible.some(x => x.id === routerActiveViewId)) {
        routerActiveViewId = visible[0].id;
      }

      viewMenu.textContent = "";
      for (const mi of visible) {
        const b = el("button");
        b.type = "button";
        b.className = "tabBtn";
        b.setAttribute("data-view-id", mi.id);
        b.setAttribute("aria-selected", mi.id === routerActiveViewId ? "true" : "false");
        b.textContent = String(mi.label || mi.id);
        b.addEventListener("click", () => routerActivateView(mi.id));
        viewMenu.appendChild(b);
      }

      if (!visible.length) {
        const hint = el("div");
        hint.className = "muted";
        hint.textContent = "Inga views tillgängliga för denna roll (eller saknar behörighet).";
        viewMenu.appendChild(hint);
      }

      routerActivateView(routerActiveViewId || "");
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
      if (!view) {
        console.warn("[Freezer] Router: view saknas:", id);
        return;
      }

      try {
        if (routerMountedView && typeof routerMountedView.unmount === "function") {
          routerMountedView.unmount({ root: viewRoot, ctx });
        }
      } catch {}

      while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild);

      routerMountedView = view;
      routerActiveViewId = id;

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
          const box = el("div");
          box.className = "panel warn";
          const b = el("b");
          b.textContent = "Vyn kunde inte renderas";
          const m = el("div");
          m.className = "muted";
          m.textContent = "Kontrollera Console för fel.";
          box.appendChild(b);
          box.appendChild(m);
          while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild);
          viewRoot.appendChild(box);
        } catch {}
      }
    }

    // ------------------------------------------------------------
    // USERS: FORM (legacy)
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // USERS: LIST (delegation)
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // AO-04: ITEMS (delegation)
    // ------------------------------------------------------------
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

    function isInItemsScope(elm) {
      try {
        const hasClosest = elm && typeof elm.closest === "function";

        const viewSaldo = byId("viewSaldo");
        if (viewSaldo && hasClosest) return !!elm.closest("#viewSaldo");
        if (viewSaldo && !hasClosest) return true;

        const q = byId("frzItemsQ");
        if (q) {
          const qClosestOk = typeof q.closest === "function";
          if (qClosestOk) {
            const root =
              q.closest("#frzItemsPanel") ||
              q.closest("#frzSaldoTableWrap") ||
              q.closest("main") ||
              q.closest("section");

            if (root && root.id && hasClosest) return !!elm.closest(`#${root.id}`) || root.contains(elm);
            if (root && !hasClosest) return true;
          }
        }

        if (byId("frzSaldoTableWrap") && hasClosest) return !!elm.closest("#frzSaldoTableWrap");
        if (byId("frzItemsPanel") && hasClosest) return !!elm.closest("#frzItemsPanel");

        return true;
      } catch {
        return true;
      }
    }

    function gateItemsWrite(status) {
      if (status.locked) return { ok: false, msg: status.reason ? `Låst: ${status.reason}` : "Låst läge." };
      if (status.readOnly) return { ok: false, msg: status.whyReadOnly || "Read-only: skrivning är spärrad." };
      if (!safeCan("inventory_write")) return { ok: false, msg: "Saknar behörighet (inventory_write)." };
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
      const n = byId(id);
      if (!n) return "";
      if (!("value" in n)) return "";
      return String(n.value || "");
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

        window.FreezerRender.renderStatus && window.FreezerRender.renderStatus(state);
        window.FreezerRender.renderMode && window.FreezerRender.renderMode(state);
        window.FreezerRender.renderLockPanel && window.FreezerRender.renderLockPanel(state);
        window.FreezerRender.renderDebug && window.FreezerRender.renderDebug(state);

        routerRerender();
      } catch {}
    }

    // ------------------------------------------------------------
    // MESSAGES (Users)
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // TABS (legacy)
    // ------------------------------------------------------------
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
        routerRerender();
      });
    }
  }
})();
