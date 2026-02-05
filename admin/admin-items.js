/* ============================================================
AO-05/15 — Admin view: Items (placeholder) | FIL-ID: UI/pages/freezer/admin/admin-items.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Admin-vy (placeholder) så router kan mount/render/unmount robust.
POLICY: Ingen storage här • XSS-safe (ingen innerHTML) • Inga sid-effekter
OBS: ESM-fil (import/export) → måste laddas med <script type="module">
============================================================ */

import { defineView } from "../01-view-registry.js";

/* =========================
BLOCK 1 — Lokal vy-state (ingen storage)
- Undviker globala id-krockar (ingen document.getElementById)
- render() uppdaterar bara element som mount() skapade
========================= */
const _viewState = {
  root: /** @type {HTMLElement|null} */ (null),
  statusEl: /** @type {HTMLElement|null} */ (null),
  boxEl: /** @type {HTMLElement|null} */ (null)
};

/* =========================
BLOCK 2 — View definition
========================= */
export const adminItemsView = defineView({
  id: "admin-items",
  label: "Produkter",
  requiredPerm: null, // Placeholder: öppen. Sätt perm senare när RBAC kopplas.

  mount(root, ctx) {
    try {
      if (!root || !(root instanceof HTMLElement)) return;

      // Kontrakt: router ger vyn en tom container.
      // Vi rensar bara root vi fick (inte globalt).
      while (root.firstChild) root.removeChild(root.firstChild);

      _viewState.root = root;
      _viewState.statusEl = null;
      _viewState.boxEl = null;

      const wrap = document.createElement("section");
      wrap.setAttribute("data-view", "admin-items");

      const h1 = document.createElement("h2");
      h1.textContent = "Admin – Produkter";

      const p = document.createElement("p");
      p.textContent = "Kommer snart.";

      const hint = document.createElement("div");
      hint.style.opacity = "0.75";
      hint.style.fontSize = "13px";
      hint.textContent = "Placeholder-vy (AO-05/15).";

      const status = document.createElement("div");
      status.style.marginTop = "10px";
      status.style.opacity = "0.75";
      status.style.fontSize = "13px";
      status.textContent = formatCtxLine(ctx);
      _viewState.statusEl = status;

      // Minimal “safe box” container (för framtida items-lista)
      const box = document.createElement("div");
      box.style.marginTop = "12px";
      box.style.border = "1px dashed #ddd";
      box.style.borderRadius = "10px";
      box.style.padding = "10px";
      box.style.background = "#fafafa";
      _viewState.boxEl = box;

      const boxTitle = document.createElement("b");
      boxTitle.textContent = "Här kommer items-UI att monteras";

      const boxText = document.createElement("div");
      boxText.style.opacity = "0.75";
      boxText.style.fontSize = "13px";
      boxText.style.marginTop = "6px";
      boxText.textContent = "När router + vy-wire är klar ersätts detta med riktig CRUD (AO-06+).";

      box.appendChild(boxTitle);
      box.appendChild(boxText);

      wrap.appendChild(h1);
      wrap.appendChild(p);
      wrap.appendChild(hint);
      wrap.appendChild(status);
      wrap.appendChild(box);

      root.appendChild(wrap);
    } catch {
      /* fail-soft */
    }
  },

  render(ctx) {
    try {
      // Robust: om vyn inte är mountad → gör inget
      if (!_viewState.root) return;

      // Uppdatera bara om statusEl fortfarande sitter i vår root
      if (_viewState.statusEl && _viewState.root.contains(_viewState.statusEl)) {
        _viewState.statusEl.textContent = formatCtxLine(ctx);
      }
    } catch {
      /* fail-soft */
    }
  },

  unmount() {
    // Städar endast våra referenser (inga listeners/timers i placeholder)
    _viewState.root = null;
    _viewState.statusEl = null;
    _viewState.boxEl = null;
  }
});

/* =========================
BLOCK 3 — Hjälpare
========================= */
function formatCtxLine(ctx) {
  try {
    const role = ctx && ctx.role ? String(ctx.role) : "—";
    const ro = !!(ctx && (ctx.readOnly || ctx.isReadOnly));
    const mode = ro ? "read-only" : "write";
    return `Ctx: role=${role} • mode=${mode}`;
  } catch {
    return "Ctx: —";
  }
}
