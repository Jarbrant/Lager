/* ============================================================
AO-01/15 — View Registry (minsta baseline) | FIL-ID: UI/pages/freezer/01-view-registry.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Central export av vy-listor per roll (ej kopplat ännu).

VIKTIGT:
- När listorna fylls i senare AO: använd alltid defineView() (inte handskrivna objekt).
- Undvik dubbla id mellan shared + roll-listor (dedupe finns som skydd, men ska inte “behövas”).

POLICY: Inga nya storage-keys • Ingen UX/redesign • Fail-closed friendly
============================================================ */

import { createView, freezeView, validateViewShape } from "./00-view-interface.js";

/* =========================
BLOCK 1 — Rollnamn (för att minska stavnings-varianter)
========================= */
export const ROLES = Object.freeze({
  ADMIN: "admin",
  BUYER: "buyer",
  PICKER: "picker"
});

/* =========================
BLOCK 2 — Hjälpare: säker registrering
========================= */

/**
 * Skapar + validerar + fryser en vy.
 * Registry kan använda detta när riktiga vyer läggs in i senare AO.
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
BLOCK 3 — Baseline listor (tomma nu)
========================= */
/**
 * OBS: AO-01/15 DoD: Laddar utan fel, men inget är kopplat än.
 * Därför exporteras TOMMA listor som baseline.
 *
 * NÄR LISTOR FYLLS: använd alltid defineView() (inte raw-objekt).
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
BLOCK 4 — Intern helper: dedupe på id
========================= */

/**
 * Returnerar en ny lista där första förekomsten av ett id vinner.
 * (Skydd mot subtila buggar om samma id råkar finnas i shared + roll-lista.)
 *
 * @param {import("./00-view-interface.js").FreezerView[]} list
 * @returns {import("./00-view-interface.js").FreezerView[]}
 */
function dedupeById(list) {
  const out = [];
  const seen = new Set();
  for (const v of Array.isArray(list) ? list : []) {
    if (!v || typeof v.id !== "string") continue;
    const id = v.id.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(v);
  }
  return out;
}

/* =========================
BLOCK 5 — Aggregat (praktiskt för router senare)
========================= */

/**
 * Router kan använda detta för att slå ihop vyer per roll.
 * Okända roller får bara shared (fail-closed-ish).
 *
 * @param {"admin"|"buyer"|"picker"|string} role
 * @returns {import("./00-view-interface.js").FreezerView[]}
 */
export function getViewsForRole(role) {
  // GUARD: enkel och förutsägbar. Okända roller får bara shared.
  const r = String(role || "").trim();

  if (r === ROLES.ADMIN) return dedupeById([...sharedViews, ...adminViews]);
  if (r === ROLES.BUYER) return dedupeById([...sharedViews, ...buyerViews]);
  if (r === ROLES.PICKER) return dedupeById([...sharedViews, ...pickerViews]);

  return dedupeById([...sharedViews]);
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

  for (const v of Array.isArray(list) ? list : []) {
    if (v && v.id === want) return v;
  }
  return null;
}

/* =========================
BLOCK 6 — Export för framtida meny
========================= */

/**
 * Returnerar meny-ready items (id/label/requiredPerm).
 * Skydd: trim + filtrera bort whitespace-id/label även om någon skulle lägga in fel.
 *
 * @param {import("./00-view-interface.js").FreezerView[]} list
 * @returns {{ id: string, label: string, requiredPerm: string|null }[]}
 */
export function toMenuItems(list) {
  return (Array.isArray(list) ? list : [])
    .filter(Boolean)
    .map((v) => ({
      id: String(v.id || "").trim(),
      label: String(v.label || "").trim(),
      requiredPerm: v.requiredPerm ?? null
    }))
    .filter((x) => x.id.length > 0 && x.label.length > 0);
}
