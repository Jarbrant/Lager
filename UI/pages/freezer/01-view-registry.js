/* ============================================================
AO-01/15 — View Registry (minsta baseline) | FIL-ID: UI/pages/freezer/01-view-registry.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Central export av vy-listor per roll (ej kopplat ännu).
POLICY: Inga nya storage-keys • Ingen UX/redesign • Fail-closed friendly
============================================================ */

import { createView, freezeView, validateViewShape } from "./00-view-interface.js";

/* =========================
BLOCK 1 — Hjälpare: säker registrering
========================= */

/**
 * Skapar + validerar + fryser en vy.
 * Registry kan använda detta när riktiga vyer läggs in i AO-04/15.
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

/* =========================
BLOCK 2 — Baseline listor (tomma nu)
========================= */
/**
 * OBS: AO-01/15 DoD: Laddar utan fel, men inget är kopplat än.
 * Därför exporteras TOMMA listor som baseline.
 * När AO-04/15 REBOOT implementeras fylls dessa med riktiga vyer.
 */

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const sharedViews = [];

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
 * Router kan använda detta för att slå ihop vyer per roll.
 * @param {"admin"|"buyer"|"picker"|string} role
 * @returns {import("./00-view-interface.js").FreezerView[]}
 */
export function getViewsForRole(role) {
  // GUARD: enkel och förutsägbar. Okända roller får bara shared.
  if (role === "admin") return [...sharedViews, ...adminViews];
  if (role === "buyer") return [...sharedViews, ...buyerViews];
  if (role === "picker") return [...sharedViews, ...pickerViews];
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

