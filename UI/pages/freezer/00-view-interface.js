/* ============================================================
AO-01/15 — View Interface (minsta baseline) | FIL-ID: UI/pages/freezer/00-view-interface.js
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
  // GUARD: trimma så att "   " inte blir ett "giltigt" id/label
  const id = String(spec?.id ?? "").trim();
  const label = String(spec?.label ?? "").trim();

  // GUARD: normalisera requiredPerm:
  // - null => null
  // - "" eller whitespace => null
  // - annars string (trim)
  let requiredPerm = null;
  if (spec?.requiredPerm === null) {
    requiredPerm = null;
  } else if (typeof spec?.requiredPerm === "string") {
    const p = spec.requiredPerm.trim();
    requiredPerm = p.length > 0 ? p : null;
  } else {
    requiredPerm = null;
  }

  /** @type {FreezerView} */
  const view = {
    id,
    label,
    requiredPerm,
    mount: typeof spec?.mount === "function" ? spec.mount : () => {},
    render: typeof spec?.render === "function" ? spec.render : () => {},
    unmount: typeof spec?.unmount === "function" ? spec.unmount : () => {}
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

  const idOk =
    typeof v.id === "string" && String(v.id).trim().length > 0;
  if (!idOk) errors.push("id måste vara en icke-tom string (inte bara mellanslag)");

  const labelOk =
    typeof v.label === "string" && String(v.label).trim().length > 0;
  if (!labelOk) errors.push("label måste vara en icke-tom string (inte bara mellanslag)");

  const permOk =
    v.requiredPerm === null ||
    (typeof v.requiredPerm === "string" && String(v.requiredPerm).trim().length > 0);
  if (!permOk) errors.push("requiredPerm måste vara null eller en icke-tom string");

  if (typeof v.mount !== "function") errors.push("mount måste vara function");
  if (typeof v.render !== "function") errors.push("render måste vara function");
  if (typeof v.unmount !== "function") errors.push("unmount måste vara function");

  return { ok: errors.length === 0, errors };
}

/**
 * Fryser en vy (för att undvika oavsiktliga mutationer i registry).
 * @param {FreezerView} view
 * @returns {FreezerView}
 */
export function freezeView(view) {
  // DEBUG: Object.freeze gör det lättare att hitta fel tidigt (utan att ändra UX)
  try {
    Object.freeze(view);
  } catch (_) {
    /* ignore */
  }
  return view;
}
