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

/* =========================
BLOCK 1 — Hjälpare: säker registrering
========================= */

/**
 * Skapar + validerar + fryser en vy.
 * Registry kan använda detta när riktiga vyer läggs in.
 *
 * @param {Parameters<typeof createView>[0]} spec
 * @returns {import("./00-view-interface.js").FreezerView}
 */
export function defineView(spec) {
  const view = createView(spec);
  const v = validateViewShape(view);
  if (!v.ok) {
    // Fail-closed: stoppa trasiga vyer tidigt.
    throw new Error(
      "AO-01/15 view-registry: View validation failed: " + v.errors.join("; ")
    );
  }
  return freezeView(view);
}

/**
 * Validerar + fryser en redan-skapad vy (t.ex. importerad).
 * Fail-closed med tydligt fel för att undvika “tysta” router-problem.
 *
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
/**
 * AO-11/15 DoD: Alla roller får se Saldo/Historik som views.
 * Därför läggs de i sharedViews.
 */
const _sharedSaldo = defineExistingView(sharedSaldoView, "sharedSaldoView");
const _sharedHistory = defineExistingView(sharedHistoryView, "sharedHistoryView");

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const sharedViews = [_sharedSaldo, _sharedHistory];

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const adminViews = [];

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const buyerViews = [];

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const pickerViews = [];

/* =========================
BLOCK 3 — Aggregat (praktiskt för router senare)
========================= */

/**
 * Normaliserar roll-sträng så legacy ("ADMIN") och nya ("admin") fungerar.
 * @param {string} role
 * @returns {"admin"|"buyer"|"picker"|""}
 */
function normalizeRole(role) {
  const r = String(role || "").trim();
  if (!r) return "";
  const up = r.toUpperCase();
  if (up === "ADMIN") return "admin";
  if (up === "BUYER") return "buyer";
  if (up === "PICKER") return "picker";
  if (up === "SYSTEM_ADMIN") return ""; // SYSTEM_ADMIN ska vara read-only/ingen extra vy här
  const low = r.toLowerCase();
  if (low === "admin" || low === "buyer" || low === "picker") return /** @type any */ (low);
  return "";
}

/**
 * Router kan använda detta för att slå ihop vyer per roll.
 * @param {"admin"|"buyer"|"picker"|string} role
 * @returns {import("./00-view-interface.js").FreezerView[]}
 */
export function getViewsForRole(role) {
  // GUARD: enkel och förutsägbar. Okända roller får bara shared.
  const nr = normalizeRole(role);
  if (nr === "admin") return [...sharedViews, ...adminViews];
  if (nr === "buyer") return [...sharedViews, ...buyerViews];
  if (nr === "picker") return [...sharedViews, ...pickerViews];
  return [...sharedViews];
}

/**
 * Router kan använda detta för att hitta en view by id.
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
BLOCK 4 — (Förberett) Export för framtida meny
========================= */

/**
 * Returnerar meny-ready items (id/label/requiredPerm).
 * @param {import("./00-view-interface.js").FreezerView[]} list
 * @returns {{ id: string, label: string, requiredPerm: string|null }[]}
 */
export function toMenuItems(list) {
  return (Array.isArray(list) ? list : [])
    .filter(Boolean)
    .map((v) => ({ id: v.id, label: v.label, requiredPerm: v.requiredPerm ?? null }));
}
