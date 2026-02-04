/* ============================================================
AO-02/15 — Statuspanel + Read-only UX + felkoder | BLOCK 1/3
AUTOPATCH | FIL: admin/freezer.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte (AO-02):
- Koppla statusbanner (OK/TOM/KORRUPT) + felorsak/felkod till UI-refresh
- Read-only UX: actions spärras med “varför” (via renderMode i render.js)
- Debug-ruta (valfri) renderas om DOM finns (renderDebug i render.js)

OBS:
- Inga UX/redesign utanför AO
- Inga nya storage-keys/datamodell
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
    // Full render pass (includes AO-02 status/mode/lock/debug)
    window.FreezerRender.renderAll(state);
    window.FreezerRender.setActiveTabUI(activeTab);

    // AO-02: ensure debug renders if available (no-op if DOM missing)
    if (typeof window.FreezerRender.renderDebug === "function") {
      try { window.FreezerRender.renderDebug(state); } catch {}
    }

    // AO-02: keep action UX aligned (titles/disabled handled in renderMode)
    if (typeof window.FreezerRender.renderMode === "function") {
      try { window.FreezerRender.renderMode(state); } catch {}
    }
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

      // AO-02: fail-closed + rely on renderMode tooltip for "why"
      if (status.locked) return;
      if (status.readOnly) return;

      const res = window.FreezerStore.resetDemo();
      if (!res.ok) {
        // store will lock itself if needed; render will reflect
        console.warn("Reset misslyckades:", res.reason);
      }
    });
  }

  // Initial UI
  window.FreezerRender.setActiveTabUI(activeTab);
  // AO-02: ensure first paint includes status/mode/lock/debug even before first subscribe tick
  forceRenderOnce();

  // -----------------------------
  // HELPERS
  // -----------------------------
  function bindTab(btn, key) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      // Tabs allowed even when locked/readOnly
      activeTab = key;
      window.FreezerRender.setActiveTabUI(activeTab);

      // Ensure status/mode/lock/debug up to date
      const state = window.FreezerStore.getState();
      window.FreezerRender.renderStatus(state);
      window.FreezerRender.renderMode(state);
      window.FreezerRender.renderLockPanel(state);
      if (typeof window.FreezerRender.renderDebug === "function") {
        try { window.FreezerRender.renderDebug(state); } catch {}
      }
    });
  }

  function forceRenderOnce() {
    try {
      const state = window.FreezerStore.getState();
      window.FreezerRender.renderStatus(state);
      window.FreezerRender.renderMode(state);
      window.FreezerRender.renderLockPanel(state);
      if (typeof window.FreezerRender.renderDebug === "function") {
        try { window.FreezerRender.renderDebug(state); } catch {}
      }
    } catch {}
  }

  function byId(id) { return document.getElementById(id); }

})();
