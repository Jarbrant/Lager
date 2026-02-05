/* ============================================================
AO-05/15 — Admin view: Dashboard (placeholder) | FIL-ID: UI/pages/freezer/admin/admin-dashboard.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Admin-vy (placeholder) så router kan mount/render/unmount robust.
POLICY: Ingen storage här • XSS-safe (ingen innerHTML) • Inga sid-effekter
============================================================ */

import { defineView } from "../01-view-registry.js";

/**
 * Admin Dashboard placeholder view
 * - Robust mount/render/unmount
 * - Bygger minimal DOM med textContent
 * - Ingen logik, inga event listeners (än)
 */
export const adminDashboardView = defineView({
  id: "admin-dashboard",
  label: "Dashboard",
  requiredPerm: null,

  mount(root, ctx) {
    try {
      if (!root || !(root instanceof HTMLElement)) return;

      // Rensa (fail-soft) – router ansvarar för att mountas i rätt container
      while (root.firstChild) root.removeChild(root.firstChild);

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
      status.id = "frzAdminDashPlaceholderStatus";
      status.style.marginTop = "10px";
      status.style.opacity = "0.75";
      status.style.fontSize = "13px";
      status.textContent = formatCtxLine(ctx);

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
    // Robust: om DOM inte finns (t.ex. vy ej mountad) gör inget
    try {
      const el = document.getElementById("frzAdminDashPlaceholderStatus");
      if (!el) return;
      el.textContent = formatCtxLine(ctx);
    } catch {
      /* fail-soft */
    }
  },

  unmount() {
    // Inga listeners/timers i placeholder – men håll robust API
    // Router kan rensa container själv.
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

