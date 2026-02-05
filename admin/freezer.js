/* ============================================================
AO-03/15 — Users CRUD + rättigheter (Admin) | BLOCK 4/4
AUTOPATCH | FIL: admin/freezer.js
Projekt: Freezer (UI-only / localStorage-first)

AO-13/15 — Flytta Users CRUD från router till admin-users view
- Users CRUD wiring flyttas från denna fil till UI/pages/freezer/admin/admin-users.js
- Denna fil ska vara tunn och endast bootstrap + legacy tabs + role/reset + render

Policy:
- Inga nya storage-keys/datamodell
- XSS-safe (render sköter textContent; controller använder textContent)
============================================================ */

(function () {
  "use strict";

  // ----------------------------------------------------------
  // P1 GUARD: skydda mot dubbel init (dubbla listeners)
  // ----------------------------------------------------------
  if (window.__FREEZER_ADMIN_PAGE_INIT__) return;
  window.__FREEZER_ADMIN_PAGE_INIT__ = true;

  const tabDashboard = byId("tabDashboard");
  const tabSaldo = byId("tabSaldo");
  const tabHistorik = byId("tabHistorik");

  const userSelect = byId("frzUserSelect");
  const resetBtn = byId("frzResetDemoBtn");

  // Page state
  let activeTab = "dashboard";

  // AO-04: Items UI state (in-memory only) — ligger kvar här tills AO-12 flyttar Items till admin-items view
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

  // ----------------------------------------------------------
  // BOOT
  // ----------------------------------------------------------
  const initialRole = (userSelect && userSelect.value) ? userSelect.value : "ADMIN";
  window.FreezerStore.init({ role: initialRole });

  // AO-13: skapa Users-controller om viewen finns (ESM laddad före denna fil)
  const usersCtrl = (window.FreezerAdminUsers && typeof window.FreezerAdminUsers.createController === "function")
    ? window.FreezerAdminUsers.createController({
        store: window.FreezerStore,
        render: window.FreezerRender,
        getActiveTab: () => activeTab,
        rerender
      })
    : null;

  window.FreezerStore.subscribe((state) => {
    window.FreezerRender.renderAll(state, itemsUI);
    window.FreezerRender.setActiveTabUI(activeTab);

    // AO-13: låt view/controller synca headers/UX vid state-ändring (utan att röra store/render-ansvar)
    if (usersCtrl && typeof usersCtrl.onState === "function") {
      try { usersCtrl.onState(state); } catch {}
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
    });
  }

  // Reset demo
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const status = window.FreezerStore.getStatus();
      if (status.locked || status.readOnly) return;

      const res = window.FreezerStore.resetDemo();
      if (!res.ok) {
        // Users-controller ansvarar för user-meddelanden; här lämnar vi tyst (render kan visa status om ni vill)
        // För Items: visa msg i items-panelen
        setItemsMsg(res.reason || "Reset misslyckades.");
      } else {
        resetItemsForm();
        itemsUI.itemsEditingArticleNo = "";
        setItemsMsg("Demo återställd.");
        rerender();
      }
    });
  }

  // AO-04: Items actions (delegation in scope) — kvar här tills AO-12 flytt
  wireItemsDelegation();

  // Initial UI
  window.FreezerRender.setActiveTabUI(activeTab);

  // ----------------------------------------------------------
  // AO-04: ITEMS (delegation)
  // ----------------------------------------------------------
  function wireItemsDelegation() {
    // NOTE: document-level delegation med scope-guard så andra vyer inte triggar items-logik.
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

        if (itemsUI.itemsEditingArticleNo) {
          const r = window.FreezerStore.updateItem(itemsUI.itemsEditingArticleNo, payload);
          if (!r.ok) return setItemsMsg(r.reason || "Kunde inte spara.");

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
      const viewSaldo = document.getElementById("viewSaldo");
      if (viewSaldo) return !!el.closest("#viewSaldo");

      if (document.getElementById("frzSaldoTableWrap")) return !!el.closest("#frzSaldoTableWrap");
      if (document.getElementById("frzItemsPanel")) return !!el.closest("#frzItemsPanel");

      return true; // fail-soft
    } catch {
      return true; // fail-soft
    }
  }

  function gateItemsWrite(status) {
    if (status.locked) return { ok: false, msg: status.reason ? `Låst: ${status.reason}` : "Låst läge." };
    if (status.readOnly) return { ok: false, msg: status.whyReadOnly || "Read-only: skrivning är spärrad." };

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
      minLevel = n;
    }

    return {
      ok: true,
      payload: {
        articleNo,
        packSize: String(itemsUI.formPackSize || "").trim(),
        supplier: String(itemsUI.formSupplier || "").trim(),
        category: String(itemsUI.formCategory || "").trim(),
        pricePerKg,
        minLevel,
        tempClass: String(itemsUI.formTempClass || "").trim(),
        requiresExpiry: !!itemsUI.formRequiresExpiry,
        isActive: !!itemsUI.formIsActive
      }
    };
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

  // ----------------------------------------------------------
  // TABS
  // ----------------------------------------------------------
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

      window.FreezerRender.renderAll(state, itemsUI);

      if (usersCtrl && typeof usersCtrl.onTabChange === "function") {
        try { usersCtrl.onTabChange(activeTab); } catch {}
      }
    });
  }

  function byId(id) { return document.getElementById(id); }

})();
