/* ============================================================
AO-09/15 — Shared view: Saldo (wrapper runt freezer-render) | FIL-ID: UI/pages/freezer/shared/shared-saldo.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Router-vy som visar Saldo genom att återanvända FreezerRender (ingen ny logik här).
POLICY: Ingen storage här • XSS-safe (ingen innerHTML) • Inga sid-effekter
OBS: ESM-fil (import/export) → måste laddas med <script type="module">
DoD: Saldo kan visas via router.
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
export const sharedSaldoView = defineView({
  id: "shared-saldo",
  label: "Saldo",
  requiredPerm: null, // Kopplas via router/roll senare. Wrappern är neutral.

  mount(root, ctx) {
    try {
      if (!root || !(root instanceof HTMLElement)) return;

      // Router ger vyn en tom container (kontrakt). Vi rensar ändå fail-soft.
      while (root.firstChild) root.removeChild(root.firstChild);

      _viewState.root = root;
      _viewState.mounted = true;

      // Viktigt: skapa DOM-ids som FreezerRender redan använder idag (document.getElementById).
      // Då kan vi återanvända samma renderkod utan att patcha render just nu.
      const headerRow = document.createElement("div");
      headerRow.style.display = "flex";
      headerRow.style.gap = "10px";
      headerRow.style.alignItems = "center";
      headerRow.style.flexWrap = "wrap";
      headerRow.style.marginBottom = "10px";

      const h2 = document.createElement("h2");
      h2.textContent = "Lagersaldo";
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
      pillMuted.textContent = "Artiklar:";

      const pillCount = document.createElement("b");
      pillCount.id = "frzSaldoCount"; // FreezerRender använder denna
      pillCount.textContent = "0";

      pill.appendChild(pillMuted);
      pill.appendChild(pillCount);

      headerRow.appendChild(h2);
      headerRow.appendChild(spacer);
      headerRow.appendChild(pill);

      const wrap = document.createElement("div");
      wrap.id = "frzSaldoTableWrap"; // FreezerRender använder denna
      wrap.style.border = "1px solid #e6e6e6";
      wrap.style.borderRadius = "12px";
      wrap.style.padding = "12px";
      wrap.style.background = "#fafafa";

      root.appendChild(headerRow);
      root.appendChild(wrap);

      // Initial render
      renderSaldoNow(ctx);
      applyWriteGate(ctx);
    } catch {
      /* fail-soft */
    }
z
  },

  render(ctx) {
    try {
      if (!_viewState.root || !_viewState.mounted) return;

      renderSaldoNow(ctx);
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

function renderSaldoNow(ctx) {
  // Robust: hämta state antingen från ctx eller direkt från FreezerStore.
  const state =
    (ctx && ctx.state) ||
    (window.FreezerStore && typeof window.FreezerStore.getState === "function"
      ? window.FreezerStore.getState()
      : null);

  if (!state) return;

  // FreezerRender kan ha olika API beroende på var ni är i refactor.
  // Vi försöker den mest specifika först, sedan fallbacks.
  const R = window.FreezerRender;

  if (!R) return;

  // 1) Om det finns en dedikerad renderSaldo → använd den.
  if (typeof R.renderSaldo === "function") {
    R.renderSaldo(state);
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

  // 3) Sista fallback: om inget finns, gör inget (fail-soft).
}

function applyWriteGate(ctx) {
  // Respektera ctx.can("inventory_write") för actions/knappar (om render stödjer).
  // Eftersom render kan vara “global” och använda document.getElementById,
  // gör vi en extra spärr i vyn: disable/enable item-actions inom vyns root.
  const root = _viewState.root;
  if (!root) return;

  const canFn = ctx && typeof ctx.can === "function" ? ctx.can : null;
  const canWrite = canFn ? !!canFn("inventory_write") : true;

  // Disable alla item-actions i denna vy om man inte kan skriva.
  // (Read-only roller ska fortfarande kunna se listan.)
  const buttons = root.querySelectorAll('button[data-action^="item-"]');
  for (const b of buttons) {
    if (!(b instanceof HTMLButtonElement)) continue;
    b.disabled = !canWrite;
  }

  // Om render skapar inputs/selects för items-edit i denna vy, disable dem också.
  const controls = root.querySelectorAll("input, select, textarea");
  for (const el of controls) {
    // Vi vill inte disable hela vyn generellt (t.ex. sök), men placeholder-stöd:
    // endast items-formfält brukar ligga i saldo wrap. Vi håller det enkelt:
    // disable om element-id börjar med "frzItem" (kontrakt i controller/render).
    const id = (el instanceof HTMLElement && el.id) ? el.id : "";
    if (id && id.startsWith("frzItem")) {
      /** @type {any} */ (el).disabled = !canWrite;
    }
  }
}

