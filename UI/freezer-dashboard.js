/* ============================================================
AO-01/15 — NY-BASELINE | FIL: UI/freezer-dashboard.js
AUTOPATCH (hel fil)
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- Dashboard-beräkningar (baseline: stub)
- Får aldrig kasta fel även om state är null/korrupt
- Exporterar stabila helpers som render/controller kan anropa

DoD:
- Sidan laddar utan errors även om dashboard ej används
============================================================ */
(function () {
  "use strict";

  const FreezerDashboard = {
    // Baseline exports (stub-safe)
    computeKpis,
    computeNotes
  };

  window.FreezerDashboard = FreezerDashboard;

  /**
   * Return minimal KPI object without throwing.
   * @param {any} state
   * @returns {{ itemCount:number, lowStockCount:number }}
   */
  function computeKpis(state) {
    try {
      const items = (state && state.data && Array.isArray(state.data.items)) ? state.data.items : [];
      const itemCount = items.length;

      let lowStockCount = 0;
      for (const it of items) {
        const onHand = safeNum(it && it.onHand, 0);
        const min = safeNum(it && it.min, 0);
        if (onHand < min) lowStockCount++;
      }

      return { itemCount, lowStockCount };
    } catch {
      return { itemCount: 0, lowStockCount: 0 };
    }
  }

  /**
   * Return a short human note array without throwing.
   * @param {any} statusObj output from FreezerStore.getStatus()
   * @returns {string[]}
   */
  function computeNotes(statusObj) {
    try {
      const st = statusObj && typeof statusObj === "object" ? statusObj : {};
      const notes = [];

      if (st.debug && st.debug.rawWasEmpty) notes.push("Tom lagring vid start.");
      if (st.debug && st.debug.demoCreated) notes.push("Demo-data skapad.");
      if (st.locked) notes.push(`Låst läge: ${st.errorCode || "okänt fel"}`);
      if (st.readOnly && !st.locked) notes.push("Read-only: vissa knappar är spärrade.");

      return notes;
    } catch {
      return [];
    }
  }

  function safeNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
})();

