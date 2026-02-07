/* ============================================================
AO-01/15 — View Interface (minsta baseline, AUTOPATCH) | FIL-ID: UI/pages/freezer/00-view-interface.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Standardisera vy-shape så router kan hantera vyer likadant.

VIKTIGT (för att undvika spret):
- Skapa vyer via createView() (inte handskrivna objekt).
- Registry bör använda createView() + validateViewShape() + freezeView().

POLICY: (ingen storage här) • XSS-safe (ingen innerHTML) • Inga sid-effekter
============================================================ */

/* =========================
BLOCK 1 — Typer (JSDoc)
========================= */

/**
 * @typedef {Object} FreezerView
 * @property {string} id                       - Stabilt id (unik i registry)
 * @property {string} label                    - Visningsnamn i meny
 * @property {string|null} requiredPerm        - Krävd permission, eller null för "öppen" i rollen
 * @property {(args: {root: HTMLElement, ctx: any, state?: any}) => void} mount   - Sätter upp DOM + listeners
 * @property {(args: {root: HTMLElement, ctx: any, state?: any}) => void} render  - Uppdaterar UI enligt ctx/state
 * @property {(args: {root: HTMLElement, ctx: any, state?: any}) => void} unmount - Städar listeners/timers, nollställer vy-state
 */

/* =========================
BLOCK 1.1 — Helpers
========================= */

function safeStr(v) {
  try { return String(v == null ? "" : v); } catch { return ""; }
}

function isFn(fn) { return typeof fn === "function"; }

/* =========================
BLOCK 2 — Skapare + defaults
========================= */

/**
 * Skapar en vy med säkra defaults.
 * Router kan alltid kalla mount/render/unmount utan att krascha.
 *
 * OBS:
 * - Vi är fail-closed: id måste bli en icke-tom sträng.
 * - label får defaulta till id om spec.label saknas (för att undvika onödiga krascher),
 *   men efter default måste label också vara icke-tom.
 *
 * @param {Partial<FreezerView> & { id: string, label?: string }} spec
 * @returns {FreezerView}
 */
export function createView(spec) {
  const s = spec && typeof spec === "object" ? spec : {};

  // GUARD: trimma så att "   " inte blir ett "giltigt" id/label
  const id = safeStr(s.id).trim();
  const label = safeStr((s.label == null || safeStr(s.label).trim() === "") ? id : s.label).trim();

  // GUARD: normalisera requiredPerm:
  // - null => null
  // - "" eller whitespace => null
  // - annars string (trim)
  let requiredPerm = null;
  if (s.requiredPerm === null) {
    requiredPerm = null;
  } else if (typeof s.requiredPerm === "string") {
    const p = s.requiredPerm.trim();
    requiredPerm = p.length > 0 ? p : null;
  } else {
    requiredPerm = null;
  }

  /** @type {FreezerView} */
  const view = {
    id,
    label,
    requiredPerm,
    mount: isFn(s.mount) ? s.mount : () => {},
    render: isFn(s.render) ? s.render : () => {},
    unmount: isFn(s.unmount) ? s.unmount : () => {}
  };

  // Fail-closed: id/label måste vara riktiga (inte tomma eller bara mellanslag)
  if (!view.id || !view.label) {
    throw new Error(
      "AO-01/15 view-interface: Ogiltig vy. Krav: id och label måste vara icke-tomma strängar."
    );
  }

  return view;
}

/* =========================
BLOCK 3 — Validering
========================= */

/**
 * Validerar en view-shape (för registry/router). Returnerar {ok, errors}.
 * Router kan välja att fail-closed om ok=false.
 *
 * OBS: Vi kräver även trim-längd > 0 så "   " inte slinker igenom.
 *
 * @param {any} v
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateViewShape(v) {
  /** @type {string[]} */
  const errors = [];

  if (!v || typeof v !== "object") {
    errors.push("view måste vara ett objekt");
    return { ok: false, errors };
  }

  const idOk = typeof v.id === "string" && safeStr(v.id).trim().length > 0;
  if (!idOk) errors.push("id måste vara en icke-tom string (inte bara mellanslag)");

  const labelOk = typeof v.label === "string" && safeStr(v.label).trim().length > 0;
  if (!labelOk) errors.push("label måste vara en icke-tom string (inte bara mellanslag)");

  const permOk =
    v.requiredPerm === null ||
    (typeof v.requiredPerm === "string" && safeStr(v.requiredPerm).trim().length > 0);
  if (!permOk) errors.push("requiredPerm måste vara null eller en icke-tom string");

  if (typeof v.mount !== "function") errors.push("mount måste vara function");
  if (typeof v.render !== "function") errors.push("render måste vara function");
  if (typeof v.unmount !== "function") errors.push("unmount måste vara function");

  return { ok: errors.length === 0, errors };
}

/* =========================
BLOCK 4 — Freeze
========================= */

/**
 * Fryser en vy (för att undvika oavsiktliga mutationer i registry).
 * @param {FreezerView} view
 * @returns {FreezerView}
 */
export function freezeView(view) {
  // DEBUG: Object.freeze gör det lättare att hitta fel tidigt (utan att ändra UX)
  try { Object.freeze(view); } catch (_) { /* ignore */ }
  return view;
}

/* ============================================================
ÄNDRINGSLOGG (≤8)
1) Behåller original-API (createView/validateViewShape/freezeView) exakt.
2) Förstärker guards (trim + safeStr) och label-default till id (utan sid-effekter).
3) JSDoc uppdaterad så mount/render/unmount kan ta {root,ctx,state} (bakåtkompatibelt).
============================================================ */
