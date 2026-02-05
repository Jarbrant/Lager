/* ============================================================
AO-01/15 — View Interface (minsta baseline) | FIL-ID: UI/pages/freezer/00-view-interface.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Standardisera vy-shape så router kan hantera vyer likadant.
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
 * @property {(root: HTMLElement, ctx: any) => void} mount   - Sätter upp DOM + event listeners
 * @property {(ctx: any) => void} render       - Uppdaterar UI enligt ctx/state
 * @property {() => void} unmount              - Städar listeners/timers, nollställer vy-state
 */

/* =========================
BLOCK 2 — Skapare + defaults
========================= */

/**
 * Skapar en vy med säkra defaults.
 * Router kan alltid kalla mount/render/unmount utan att krascha.
 *
 * @param {Partial<FreezerView> & { id: string, label: string }} spec
 * @returns {FreezerView}
 */
export function createView(spec) {
  // GUARD: minimal fail-closed för att undvika att registry råkar exportera trasiga vyer
  const id = String(spec.id || "").trim();
  const label = String(spec.label || "").trim();

  const requiredPerm =
    spec.requiredPerm === null || typeof spec.requiredPerm === "string"
      ? spec.requiredPerm
      : null;

  /** @type {FreezerView} */
  const view = {
    id,
    label,
    requiredPerm,
    mount: typeof spec.mount === "function" ? spec.mount : () => {},
    render: typeof spec.render === "function" ? spec.render : () => {},
    unmount: typeof spec.unmount === "function" ? spec.unmount : () => {}
  };

  // GUARD: säkerställ att id/label finns – annars fail-closed genom tydligt fel
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
 * @param {any} v
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateViewShape(v) {
  /** @type {string[]} */
  const errors = [];

  if (!v || typeof v !== "object") errors.push("view måste vara ett objekt");
  if (!v?.id || typeof v.id !== "string") errors.push("id måste vara string");
  if (!v?.label || typeof v.label !== "string") errors.push("label måste vara string");

  const permOk = v?.requiredPerm === null || typeof v?.requiredPerm === "string";
  if (!permOk) errors.push("requiredPerm måste vara string eller null");

  if (typeof v?.mount !== "function") errors.push("mount måste vara function");
  if (typeof v?.render !== "function") errors.push("render måste vara function");
  if (typeof v?.unmount !== "function") errors.push("unmount måste vara function");

  return { ok: errors.length === 0, errors };
}

/**
 * Fryser en vy (för att undvika oavsiktliga mutationer i registry).
 * @param {FreezerView} view
 * @returns {FreezerView}
 */
export function freezeView(view) {
  // DEBUG: Object.freeze gör det lättare att hitta buggar tidigt (utan att ändra UX)
  try {
    Object.freeze(view);
  } catch (_) {
    /* ignore */
  }
  return view;
}

