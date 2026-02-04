/* ============================================================
AO-01/15 — NY-BASELINE | BLOCK 1/5 | FIL: UI/freezer-dashboard.js
Projekt: Freezer (UI-only / localStorage-first)
Syfte: Dashboard-beräkningar (stub exports) — ska inte kasta fel.

Krav (baseline):
- Existerar och kan importeras/anropas utan fel
- Har enkla, defensiva beräkningar (valfritt)
============================================================ */

const FreezerDashboard = {
  computeSummary,
  computeNotes
};

window.FreezerDashboard = FreezerDashboard;

/**
 * Compute a tiny summary object for dashboard cards.
 * Defensive: never throws, always returns stable shape.
 */
function computeSummary(state) {
  try {
    const items = (state && state.data && Array.isArray(state.data.items)) ? state.data.items : [];
    let totalSkus = items.length;

    let totalUnits = 0;
    let belowMin = 0;

    for (const it of items) {
      const onHand = num(it && it.onHand);
      const min = num(it && it.min);
      totalUnits += onHand;
      if (onHand < min) belowMin += 1;
    }

    return {
      totalSkus,
      totalUnits,
      belowMin
    };
  } catch {
    return { totalSkus: 0, totalUnits: 0, belowMin: 0 };
  }
}

/**
 * Returns human-friendly notes (array of strings), safe default.
 */
function computeNotes(state) {
  try {
    const s = computeSummary(state);
    const out = [];
    out.push(`Artiklar: ${s.totalSkus}`);
    out.push(`Totalt i lager: ${s.totalUnits}`);
    out.push(`Under min-nivå: ${s.belowMin}`);
    return out;
  } catch {
    return ["—"];
  }
}

/* -----------------------------
  Utils
----------------------------- */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

