/* ============================================================
AO-05/15 — Admin view: Dashboard (placeholder) | FIL-ID: UI/pages/freezer/admin/admin-dashboard.js
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
  statusEl: /** @type {HTMLElement|null} */ (null)
};

/* =========================
BLOCK 2 — View definition
========================= */
export const adminDashboardView = defineView({
  id: "admin-dashboard",
  label: "Dashboard",
  requiredPerm: null,

  mount(root, ctx) {
    try {
      if (!root || !(root instanceof HTMLElement)) return;

      // Kontrakt: router ger vyn en tom container.
      // Vi rensar bara root vi fick (inte globalt).
      while (root.firstChild) root.removeChild(root.firstChild);

      _viewState.root = root;
      _viewState.statusEl = null;

      const wrap = document.createElement("section");
      wrap.setAttribute("data-view", "admin-dashboard");

      const h1 = document.createElement("h2");
      h1.textContent = "Admin – Dashboard";

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

      wrap.appendChild(h1);
      wrap.appendChild(p);
      wrap.appendChild(hint);
      wrap.appendChild(status);

      root.appendChild(wrap);
    } catch {
      /* fail-soft */
    }
  },

  render(ctx) {
    try {
      // Robust: om vyn inte är mountad → gör inget
      if (!_viewState.root || !_viewState.statusEl) return;

      // Extra guard: uppdatera bara om statusEl fortfarande sitter i root
      if (!_viewState.root.contains(_viewState.statusEl)) return;

      _viewState.statusEl.textContent = formatCtxLine(ctx);
    } catch {
      /* fail-soft */
    }
  },

  unmount() {
    // Städar endast våra referenser (inga listeners/timers i placeholder)
    _viewState.root = null;
    _viewState.statusEl = null;
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
