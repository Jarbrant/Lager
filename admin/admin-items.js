/* ============================================================
AO-12/15 — Admin Items View/Controller (flytt av Items CRUD)
FIL-ID: UI/pages/freezer/admin/admin-items.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- Flytta Items CRUD delegation + UI-state + validering från admin/freezer.js
- admin/freezer.js ska vara tunn (router/page), endast passera itemsUI till renderAll

Policy:
- Inga nya storage-keys/datamodell
- XSS-safe (render sköter textContent)
- Fail-soft om DOM-id saknas
============================================================ */

(function () {
  "use strict";

  // Exponeras globalt så admin/freezer.js kan initiera utan ESM-import.
  window.FreezerAdminItems = window.FreezerAdminItems || {};
  window.FreezerAdminItems.createController = createController;

  function createController(opts) {
    const rerender = (opts && typeof opts.rerender === "function") ? opts.rerender : function () {};

    // In-memory UI state (ingen storage)
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
      formTempClass: "FROZEN",
      formRequiresExpiry: true,
      formIsActive: true,

      itemsMsg: "—"
    };

    // P0 GUARD: undvik dubbel-wire om createController råkar köras två gånger
    if (!window.__FREEZER_ITEMS_WIRED__) {
      window.__FREEZER_ITEMS_WIRED__ = true;
      wireItemsDelegation();
    }

    function reset() {
      resetItemsForm();
      itemsUI.itemsEditingArticleNo = "";
      setItemsMsg("Demo återställd.");
      rerender();
    }

    function wireItemsDelegation() {
      // Click delegation
      document.addEventListener("click", (ev) => {
        const t = ev.target;
        if (!t || !(t instanceof HTMLElement)) return;

        const btn = t.closest("button[data-action]");
        if (!btn) return;

        const action = btn.getAttribute("data-action") || "";
        if (!action) return;

        if (isItemsAction(action) && !isInItemsScope(btn)) return;

        if (!window.FreezerStore) return setItemsMsg("Store saknas.");
        const status = window.FreezerStore.getStatus ? window.FreezerStore.getStatus() : { locked: false, readOnly: false };

        if (status.locked) return setItemsMsg(status.reason ? `Låst: ${status.reason}` : "Låst läge.");

        const articleNo = btn.getAttribute("data-article-no") || "";

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
            if (!r || !r.ok) return setItemsMsg((r && r.reason) ? r.reason : "Kunde inte spara.");

            // Konsekvent policy: lämna editläge efter save
            resetItemsForm();
            itemsUI.itemsEditingArticleNo = "";
            setItemsMsg("Uppdaterad.");
            rerender();
            return;
          }

          const r = window.FreezerStore.createItem(payload);
          if (!r || !r.ok) return setItemsMsg((r && r.reason) ? r.reason : "Kunde inte skapa.");

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
          if (!r || !r.ok) return setItemsMsg((r && r.reason) ? r.reason : "Kunde inte arkivera.");

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
          if (!r || !r.ok) return setItemsMsg((r && r.reason) ? r.reason : "Radering blockerad.");

          if (itemsUI.itemsEditingArticleNo === articleNo) {
            resetItemsForm();
            itemsUI.itemsEditingArticleNo = "";
          }
          setItemsMsg("Raderad.");
          rerender();
          return;
        }
      });

      // Change delegation
      document.addEventListener("change", (ev) => {
        const t = ev.target;
        if (!t || !(t instanceof HTMLElement)) return;

        if (!isInItemsScope(t)) return;

        const id = t.id || "";
        if (!id) return;

        if (id === "frzItemsQ") {
          itemsUI.itemsQ = safeVal(t);
          rerender();
          return;
        }
        if (id === "frzItemsCategory") {
          itemsUI.itemsCategory = safeVal(t);
          rerender();
          return;
        }
        if (id === "frzItemsSortKey") {
          itemsUI.itemsSortKey = safeVal(t) || "articleNo";
          rerender();
          return;
        }
        if (id === "frzItemsSortDir") {
          itemsUI.itemsSortDir = safeVal(t) || "asc";
          rerender();
          return;
        }
        if (id === "frzItemsIncludeInactive") {
          itemsUI.itemsIncludeInactive = !!(t instanceof HTMLInputElement ? t.checked : false);
          rerender();
          return;
        }
      });

      // Input delegation (search)
      document.addEventListener("input", (ev) => {
        const t = ev.target;
        if (!t || !(t instanceof HTMLElement)) return;

        if (!isInItemsScope(t)) return;

        if (t.id === "frzItemsQ") {
          itemsUI.itemsQ = safeVal(t);
          rerender();
        }
      });
    }

    function isItemsAction(action) {
      return String(action || "").startsWith("item-");
    }

    function isInItemsScope(el) {
      // Stram men fail-soft: primärt #viewSaldo (legacy), annars wrap-ids.
      try {
        const viewSaldo = document.getElementById("viewSaldo");
        if (viewSaldo && typeof el.closest === "function") return !!el.closest("#viewSaldo");

        const wrap = document.getElementById("frzSaldoTableWrap");
        if (wrap && typeof el.closest === "function") return !!el.closest("#frzSaldoTableWrap");

        const panel = document.getElementById("frzItemsPanel");
        if (panel && typeof el.closest === "function") return !!el.closest("#frzItemsPanel");

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

    function safeVal(el) {
      try {
        if (el instanceof HTMLInputElement) return String(el.value || "");
        if (el instanceof HTMLSelectElement) return String(el.value || "");
        if (el instanceof HTMLTextAreaElement) return String(el.value || "");
        return "";
      } catch {
        return "";
      }
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
      return safeVal(el);
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
        if (!window.FreezerStore || typeof window.FreezerStore.listItems !== "function") return;
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
    }

    // Public controller surface
    return {
      itemsUI,
      reset
    };
  }
})();
