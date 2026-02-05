/* ============================================================
AO-01/15 — View Registry (minsta baseline) | FIL-ID: UI/pages/freezer/01-view-registry.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Central export av vy-listor per roll.
POLICY: Inga nya storage-keys • Ingen UX/redesign • Fail-closed friendly
============================================================ */

import { createView, freezeView, validateViewShape } from "./00-view-interface.js";

// AO-11/15: Shared views (Saldo/Historik)
import { sharedSaldoView } from "./shared/shared-saldo.js";
import { sharedHistoryView } from "./shared/shared-history.js";

// BUYER views
import { buyerDashboardView } from "./buyer/buyer-dashboard.js";
import { buyerInView } from "./buyer/buyer-in.js";

/* =========================
BLOCK 1 — Hjälpare: säker registrering
========================= */

/**
 * Skapar + validerar + fryser en vy.
 * @param {Parameters<typeof createView>[0]} spec
 * @returns {import("./00-view-interface.js").FreezerView}
 */
export function defineView(spec) {
  const view = createView(spec);
  const v = validateViewShape(view);
  if (!v.ok) {
    throw new Error(
      "AO-01/15 view-registry: View validation failed: " + v.errors.join("; ")
    );
  }
  return freezeView(view);
}

/**
 * Validerar + fryser en redan-skapad vy (t.ex. importerad).
 * Fail-closed med tydligt fel.
 * @param {any} view
 * @param {string} name
 * @returns {import("./00-view-interface.js").FreezerView}
 */
function defineExistingView(view, name) {
  const v = validateViewShape(view);
  if (!v.ok) {
    throw new Error(
      `AO-11/15 view-registry: Importerad vy är ogiltig (${name}): ` + v.errors.join("; ")
    );
  }
  return freezeView(view);
}

/* =========================
BLOCK 2 — Listor per roll
========================= */

const _sharedSaldo = defineExistingView(sharedSaldoView, "sharedSaldoView");
const _sharedHistory = defineExistingView(sharedHistoryView, "sharedHistoryView");

const _buyerDash = defineExistingView(buyerDashboardView, "buyerDashboardView");
const _buyerIn = defineExistingView(buyerInView, "buyerInView");

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const sharedViews = [_sharedSaldo, _sharedHistory];

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const adminViews = [];

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const buyerViews = [_buyerDash, _buyerIn];

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const pickerViews = [];

/* =========================
BLOCK 3 — Aggregat (praktiskt för router)
========================= */

/**
 * Normaliserar roll-sträng så legacy ("ADMIN") och nya ("admin") fungerar.
 * ✅ P0: stöd för svenska roller ("INKÖPARE", "PLOCKARE")
 * @param {string} role
 * @returns {"admin"|"buyer"|"picker"|""}
 */
function normalizeRole(role) {
  const r = String(role || "").trim();
  if (!r) return "";

  const up = r.toUpperCase();

  // Legacy / engelska
  if (up === "ADMIN") return "admin";
  if (up === "BUYER") return "buyer";
  if (up === "PICKER") return "picker";
  if (up === "SYSTEM_ADMIN") return "";

  // Svenska (UI)
  if (up === "INKÖPARE") return "buyer";
  if (up === "PLOCKARE") return "picker";

  // Nya (småbokstäver)
  const low = r.toLowerCase();
  if (low === "admin" || low === "buyer" || low === "picker") return /** @type any */ (low);

  return "";
}

/**
 * @param {"admin"|"buyer"|"picker"|string} role
 * @returns {import("./00-view-interface.js").FreezerView[]}
 */
export function getViewsForRole(role) {
  const nr = normalizeRole(role);
  if (nr === "admin") return [...sharedViews, ...adminViews];
  if (nr === "buyer") return [...sharedViews, ...buyerViews];
  if (nr === "picker") return [...sharedViews, ...pickerViews];
  return [...sharedViews];
}

/**
 * @param {import("./00-view-interface.js").FreezerView[]} list
 * @param {string} id
 * @returns {import("./00-view-interface.js").FreezerView|null}
 */
export function findView(list, id) {
  const want = String(id || "").trim();
  if (!want) return null;
  for (const v of list) {
    if (v && v.id === want) return v;
  }
  return null;
}

/* =========================
BLOCK 4 — Export för meny
========================= */

/**
 * @param {import("./00-view-interface.js").FreezerView[]} list
 * @returns {{ id: string, label: string, requiredPerm: string|null }[]}
 */
export function toMenuItems(list) {
  return (Array.isArray(list) ? list : [])
    .filter(Boolean)
    .map((v) => ({ id: v.id, label: v.label, requiredPerm: v.requiredPerm ?? null }));
}

/* =========================
BLOCK 5 — AO-11 BRIDGE: gör registry tillgänglig för non-module freezer.js
========================= */
/**
 * POLICY: ingen storage, bara en window-bridge.
 * Detta behövs eftersom admin/freezer.js laddas som vanlig <script>.
 */
try {
  if (!window.FreezerViewRegistry) {
    window.FreezerViewRegistry = {
      // helpers
      defineView,
      getViewsForRole,
      findView,
      toMenuItems,
      // lists (read-only)
      sharedViews,
      adminViews,
      buyerViews,
      pickerViews
    };
  }
} catch {
  // fail-soft
}
