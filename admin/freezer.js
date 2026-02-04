/* ============================================================
AO-01/15 — NY-BASELINE | BLOCK 1/5 | FIL: admin/freezer.js
Projekt: Freezer (UI-only / localStorage-first)
Syfte: Page/controller (boot + tabs + userSelect + renderAll)
Krav:
- Init store (demo vid tom storage)
- Fail-closed: om locked -> visa lockpanel och blockera reset
- Tabs: dashboard/saldo/history
============================================================ */

(function () {
  "use strict";

  // -----------------------------
  // DOM
  // -----------------------------
  const tabDashboard = byId("tabDashboard");
  const tabSaldo = byId("tabSaldo");
  const tabHistorik = byId("tabHistorik");

  const userSelect = byId("frzUserSelect");
  const resetBtn = byId("frzResetDemoBtn");

  // -----------------------------
  // STATE (page)
  // -----------------------------
  let activeTab = "dashboard";

  // -----------------------------
  // BOOT
  // -----------------------------
  if (!window.FreezerStore || !window.FreezerRender) {
    console.error("Freezer baseline saknar FreezerStore eller FreezerRender.");
    return;
  }

  // Role from select initial value
  const initialRole = (userSelect && userSelect.value) ? userSelect.value : "ADMIN";

  // Init Store
  window.FreezerStore.init({ role: initialRole });

  // Subscribe -> render all
  window.FreezerStore.subscribe((state) => {
    window.FreezerRender.renderAll(state);
    window.FreezerRender.setActiveTabUI(activeTab);
  });

  // Wire tabs
  bindTab(tabDashboard, "dashboard");
  bindTab(tabSaldo, "saldo");
  bindTab(tabHistorik, "history");

  // Wire role select
  if (userSelect) {
    userSelect.addEventListener("change", () => {
      const role = userSelect.value || "ADMIN";
      window.FreezerStore.setRole(role);
      // render will happen via subscribe after save attempt
    });
  }

  // Wire reset demo
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const status = window.FreezerStore.getStatus();
      if (status.locked) return;      // fail-closed
      if (status.readOnly) return;    // fail-closed

      const res = window.FreezerStore.resetDemo();
      if (!res.ok) {
        // store will lock itself if needed; render will reflect
        console.warn("Reset misslyckades:", res.reason);
      }
    });
  }

  // Initial UI
  window.FreezerRender.setActiveTabUI(activeTab);

  // -----------------------------
  // HELPERS
  // -----------------------------
  function bindTab(btn, key) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      const status = window.FreezerStore.getStatus();
      // Tabs allowed even when locked/readOnly
      activeTab = key;
      window.FreezerRender.setActiveTabUI(activeTab);

      // Ensure status/mode up to date
      const state = window.FreezerStore.getState();
      window.FreezerRender.renderStatus(state);
      window.FreezerRender.renderMode(state);
      window.FreezerRender.renderLockPanel(state);
    });
  }

  function byId(id) { return document.getElementById(id); }

})();

