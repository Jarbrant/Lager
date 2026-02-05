/* ============================================================
AO-05/15 — Admin view: Items (placeholder) | FIL-ID: UI/pages/freezer/admin/admin-items.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Admin-vy (placeholder) så router kan mount/render/unmount robust.
POLICY: Ingen storage här • XSS-safe (ingen innerHTML) • Inga sid-effekter
============================================================ */

import { defineView } from "../01-view-registry.js";

/**
 * Admin Items placeholder view
 * - Robust mount/render/unmount
 * - Minimal DOM med textContent (XSS-safe)
 * - Inga listeners/timers (än)
 */
export const adminItemsView = defineView({
  id: "admin-items",
  label: "Produkter",
  requiredPerm: null,

  mount(root, ctx) {
    try {
      if (!root || !(root instanceof HTMLElement)) return;

      // Rensa container (fail-soft)
      while (root.firstChild) root.removeChild(root.firstChild);

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
      status.id = "frzAdminItemsPlaceholderStatus";
      status.style.marginTop = "10px";
      status.style.opacity = "0.75";
      status.style.fontSize = "13px";
      status.textContent = formatCtxLine(ctx);

      // Extra: minimal “safe list” container (för framtida items-lista)
      const box = document.createElement("div");
      box.id = "frzAdminItemsPlaceholderBox";
      box.style.marginTop = "12px";
      box.style.border = "1px dashed #ddd";
      box.style.borderRadius = "10px";
      box.style.padding = "10px";
      box.style.background = "#fafafa";

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
    // Robust: om DOM inte finns (t.ex. vy ej mountad) gör inget
    try {
      const el = document.getElementById("frzAdminItemsPlaceholderStatus");
      if (!el) return;
      el.textContent = formatCtxLine(ctx);
    } catch {
      /* fail-soft */
    }
  },

  unmount() {
    // Placeholder: inget att städa (inga listeners/timers)
  }
});

function formatCtxLine(ctx) {
  try {
    const role = ctx && ctx.role ? String(ctx.role) : "—";
    const mode = ctx && ctx.readOnly ? "read-only" : "write";
    return `Ctx: role=${role} • mode=${mode}`;
  } catch {
    return "Ctx: —";
  }
}

