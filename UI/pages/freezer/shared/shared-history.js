/* ============================================================
AO-10/15 — Shared view: Historik (wrapper runt freezer-render) | FIL-ID: UI/pages/freezer/shared/shared-history.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Router-vy som visar Historik genom att återanvända FreezerRender (ingen ny logik här).
POLICY: Ingen storage här • XSS-safe (ingen innerHTML) • Inga sid-effekter
OBS: ESM-fil (import/export) → måste laddas med <script type="module">
DoD: Historik kan visas via router.
============================================================ */

import { defineView } from "../01-view-registry.js";

/* =========================
BLOCK 1 — Lokal vy-state (ingen storage)
========================= */
const _viewState = {
  root: /** @type {HTMLElement|null} */ (null),
  mounted: false
};

/* =========================
BLOCK 2 — View definition
========================= */
export const sharedHistoryView = defineView({
  id: "shared-history",
  label: "Historik",
  requiredPerm: null, // Kopplas via router/roll senare. Wrappern är neutral.

  mount(root, ctx) {
    try {
      if (!root || !(root instanceof HTMLElement)) return;

      // Router ger vyn en tom container (kontrakt). Vi rensar ändå fail-soft.
      while (root.firstChild) root.removeChild(root.firstChild);

      _viewState.root = root;
      _viewState.mounted = true;

      // Skapa DOM-ids som FreezerRender redan använder idag (document.getElementById).
      const headerRow = document.createElement("div");
      headerRow.style.display = "flex";
      headerRow.style.gap = "10px";
      headerRow.style.alignItems = "center";
      headerRow.style.flexWrap = "wrap";
      headerRow.style.marginBottom = "10px";

      const h2 = document.createElement("h2");
      h2.textContent = "Historik";
      h2.style.margin = "0";

      const spacer = document.createElement("div");
      spacer.style.flex = "1";

      const pill = document.createElement("div");
      pill.style.display = "inline-flex";
      pill.style.gap = "8px";
      pill.style.alignItems = "center";
      pill.style.padding = "6px 10px";
      pill.style.borderRadius = "999px";
      pill.style.border = "1px solid #e6e6e6";
      pill.style.background = "#fafafa";
      pill.style.fontSize = "13px";

      const pillMuted = document.createElement("span");
      pillMuted.style.opacity = "0.75";
      pillMuted.textContent = "Händelser:";

      const pillCount = document.createElement("b");
      pillCount.id = "frzHistoryCount"; // FreezerRender använder denna
      pillCount.textContent = "0";

      pill.appendChild(pillMuted);
      pill.appendChild(pillCount);

      headerRow.appendChild(h2);
      headerRow.appendChild(spacer);
      headerRow.appendChild(pill);

      const list = document.createElement("div");
      list.id = "frzHistoryList"; // FreezerRender använder denna
      list.style.border = "1px solid #e6e6e6";
      list.style.borderRadius = "12px";
      list.style.padding = "12px";
      list.style.background = "#fafafa";

      root.appendChild(headerRow);
      root.appendChild(list);

      // Initial render
      renderHistoryNow(ctx);
      applyWriteGate(ctx);
    } catch {
      /* fail-soft */
    }
  },

  render(ctx) {
    try {
      if (!_viewState.root || !_viewState.mounted) return;

      renderHistoryNow(ctx);
      applyWriteGate(ctx);
    } catch {
      /* fail-soft */
    }
  },

  unmount() {
    _viewState.root = null;
    _viewState.mounted = false;
  }
});

/* =========================
BLOCK 3 — Rendering helpers
========================= */

function renderHistoryNow(ctx) {
  // Robust: hämta state antingen från ctx eller direkt från FreezerStore.
  const state =
    (ctx && ctx.state) ||
    (window.FreezerStore && typeof window.FreezerStore.getState === "function"
      ? window.FreezerStore.getState()
      : null);

  if (!state) return;

  const R = window.FreezerRender;
  if (!R) return;

  // 1) Om det finns en dedikerad renderHistory → använd den.
  if (typeof R.renderHistory === "function") {
    R.renderHistory(state);
    return;
  }

  // 2) Fallback: renderAll med en minimal itemsUI (för att inte krascha signaturen).
  if (typeof R.renderAll === "function") {
    const itemsUIStub = {
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

    R.renderAll(state, itemsUIStub);
    return;
  }

  // 3) Sista fallback: gör inget (fail-soft).
}

function applyWriteGate(ctx) {
  // Respektera ctx.can("history_write") för actions/knappar (om render stödjer).
  // I historik-vyn brukar actions vara få (ofta bara read), men vi gate:ar ändå.
  const root = _viewState.root;
  if (!root) return;

  const canFn = ctx && typeof ctx.can === "function" ? ctx.can : null;
  const canWrite = canFn ? !!canFn("history_write") : true;

  // Disable alla historik-actions om render använder data-action prefix "hist-" (framtidssäkert).
  const buttons = root.querySelectorAll('button[data-action^="hist-"], button[data-action^="history-"]');
  for (const b of buttons) {
    if (!(b instanceof HTMLButtonElement)) continue;
    b.disabled = !canWrite;
  }
}

