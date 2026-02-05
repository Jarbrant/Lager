/* ============================================================
AO-07/15 — Buyer view: Inleverans (placeholder) | FIL-ID: UI/pages/freezer/buyer/buyer-in.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Buyer-vy (placeholder) så router kan mount/render/unmount robust.
POLICY: Ingen storage här • XSS-safe (ingen innerHTML) • Inga sid-effekter
OBS: ESM-fil (import/export) → måste laddas med <script type="module">
============================================================ */

import { defineView } from "../01-view-registry.js";

/* =========================
BLOCK 1 — Lokal vy-state (ingen storage)
========================= */
const _viewState = {
  root: /** @type {HTMLElement|null} */ (null),
  statusEl: /** @type {HTMLElement|null} */ (null)
};

/* =========================
BLOCK 2 — View definition
========================= */
export const buyerInView = defineView({
  id: "buyer-in",
  label: "Inleverans",
  requiredPerm: null, // Placeholder: öppen. Sätt perm senare när RBAC kopplas.

  mount(a) {
    try {
      const root = a && typeof a === "object" && a.root ? a.root : null;
      const ctx = a && typeof a === "object" && a.ctx ? a.ctx : null;
      if (!root || !(root instanceof HTMLElement)) return;

      while (root.firstChild) root.removeChild(root.firstChild);

      _viewState.root = root;
      _viewState.statusEl = null;

      const wrap = document.createElement("section");
      wrap.setAttribute("data-view", "buyer-in");

      const h1 = document.createElement("h2");
      h1.textContent = "Inköp – Inleverans";

      const p = document.createElement("p");
      p.textContent = "Kommer snart.";

      const hint = document.createElement("div");
      hint.style.opacity = "0.75";
      hint.style.fontSize = "13px";
      hint.textContent = "Placeholder-vy (AO-07/15).";

      const status = document.createElement("div");
      status.style.marginTop = "10px";
      status.style.opacity = "0.75";
      status.style.fontSize = "13px";
      status.textContent = formatCtxLine(ctx);
      _viewState.statusEl = status;

      const box = document.createElement("div");
      box.style.marginTop = "12px";
      box.style.border = "1px dashed #ddd";
      box.style.borderRadius = "10px";
      box.style.padding = "10px";
      box.style.background = "#fafafa";

      const boxTitle = document.createElement("b");
      boxTitle.textContent = "Här kommer inleverans-flödet att monteras";

      const boxText = document.createElement("div");
      boxText.style.opacity = "0.75";
      boxText.style.fontSize = "13px";
      boxText.style.marginTop = "6px";
      boxText.textContent = "Exempel: skapa leverans, lägg till rader, uppdatera saldo, logga historik.";

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

  render(a) {
    try {
      const ctx = a && typeof a === "object" && a.ctx ? a.ctx : null;
      if (!_viewState.root || !_viewState.statusEl) return;
      if (!_viewState.root.contains(_viewState.statusEl)) return;

      _viewState.statusEl.textContent = formatCtxLine(ctx);
    } catch {
      /* fail-soft */
    }
  },

  unmount() {
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
