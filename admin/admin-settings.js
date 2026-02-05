/* ============================================================
AO-06/15 — Admin view: Settings (placeholder) | FIL-ID: UI/pages/freezer/admin/admin-settings.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Admin-vy (placeholder) så router kan mount/render/unmount robust.
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
export const adminSettingsView = defineView({
  id: "admin-settings",
  label: "Inställningar",
  requiredPerm: null, // Placeholder: öppen. Sätt perm senare när RBAC kopplas.

  mount(root, ctx) {
    try {
      if (!root || !(root instanceof HTMLElement)) return;

      // Kontrakt: router ger vyn en tom container.
      while (root.firstChild) root.removeChild(root.firstChild);

      _viewState.root = root;
      _viewState.statusEl = null;

      const wrap = document.createElement("section");
      wrap.setAttribute("data-view", "admin-settings");

      const h1 = document.createElement("h2");
      h1.textContent = "Admin – Inställningar";

      const p = document.createElement("p");
      p.textContent = "Kommer snart.";

      const hint = document.createElement("div");
      hint.style.opacity = "0.75";
      hint.style.fontSize = "13px";
      hint.textContent = "Placeholder-vy (AO-06/15).";

      const status = document.createElement("div");
      status.style.marginTop = "10px";
      status.style.opacity = "0.75";
      status.style.fontSize = "13px";
      status.textContent = formatCtxLine(ctx);
      _viewState.statusEl = status;

      // Minimal box för framtida settings-form
      const box = document.createElement("div");
      box.style.marginTop = "12px";
      box.style.border = "1px dashed #ddd";
      box.style.borderRadius = "10px";
      box.style.padding = "10px";
      box.style.background = "#fafafa";

      const boxTitle = document.createElement("b");
      boxTitle.textContent = "Här kommer settings-UI att monteras";

      const boxText = document.createElement("div");
      boxText.style.opacity = "0.75";
      boxText.style.fontSize = "13px";
      boxText.style.marginTop = "6px";
      boxText.textContent =
        "Exempel: demo-flaggor, visning av debug-panel, exports, och policy-indikatorer (utan nya storage-keys).";

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

