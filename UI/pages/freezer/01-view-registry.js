/* ============================================================
AO-01/15 — View Registry (minsta baseline) | FIL-ID: UI/pages/freezer/01-view-registry.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Central export av vy-listor per roll.
POLICY: Inga nya storage-keys • Ingen UX/redesign • Fail-closed friendly

P0 BUYER MENU FIX (DENNA PATCH):
- BUYER-router ska visa 4 inköpsrutor (inte shared saldo/historik).
- Etiketter: Ny Leverantör / Ny produkt / Lägga in produkter / Sök Leverantör
- De tre första öppnas i modal (fail-soft om FreezerModal saknas).
- Återanvänder befintliga buyer-vyer (buyer-in/buyer-dashboard) som motor tills riktiga vyer finns.
============================================================ */

import { createView, freezeView, validateViewShape } from "./00-view-interface.js";

// AO-11/15: Shared views (Saldo/Historik)
import { sharedSaldoView } from "./shared/shared-saldo.js";
import { sharedHistoryView } from "./shared/shared-history.js";

// AO-07/15 + AO-14/15: Buyer views (router mount)
import { buyerInView } from "./buyer/buyer-in.js";
import { buyerDashboardView } from "./buyer/buyer-dashboard.js";

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
BLOCK 1.1 — Modal helper (fail-soft)
========================= */

/**
 * Fail-soft modal open: försöker använda window.FreezerModal om den finns.
 * Om modal saknas/okänt API -> return null och vi renderar inline istället.
 * @param {{ title: string, contentRoot: HTMLElement, onClose?: Function }} opts
 * @returns {{ close: Function }|null}
 */
function tryOpenModal(opts) {
  try {
    const m = window.FreezerModal;
    if (!m) return null;

    // Stöd flera möjliga API: open/show
    const openFn =
      (typeof m.open === "function" && m.open) ||
      (typeof m.show === "function" && m.show) ||
      null;

    if (!openFn) return null;

    // Vi skickar ett robust payload utan att anta för mycket
    const res = openFn({
      title: String(opts.title || ""),
      contentRoot: opts.contentRoot,
      onClose: typeof opts.onClose === "function" ? opts.onClose : undefined
    });

    // Res kan vara controller eller inget alls -> normalisera close
    if (res && typeof res.close === "function") return res;
    if (typeof m.close === "function") {
      return { close: () => { try { m.close(); } catch {} } };
    }
    return { close: () => {} };
  } catch {
    return null;
  }
}

/**
 * Skapar en modal-vy.
 * Fail-soft: om modal inte går -> renderas inline i viewRoot.
 * @param {{ id:string, label:string, requiredPerm:string|null, title:string, renderBody:(root:HTMLElement, args:any)=>void }} spec
 * @returns {import("./00-view-interface.js").FreezerView}
 */
function defineModalView(spec) {
  const viewId = String(spec.id || "").trim();
  const label = String(spec.label || spec.id || "").trim();
  const title = String(spec.title || spec.label || spec.id || "").trim();

  return defineView({
    id: viewId,
    label,
    requiredPerm: spec.requiredPerm ?? null,

    mount: ({ root, ctx }) => {
      // Skapa container för body
      const body = document.createElement("div");
      body.className = "panel";
      body.style.background = "#fff";
      body.style.border = "1px solid #e6e6e6";
      body.style.borderRadius = "12px";
      body.style.padding = "12px";

      // Försök öppna modal
      const ctrl = tryOpenModal({
        title,
        contentRoot: body,
        onClose: () => {}
      });

      // Om modal inte finns -> rendera inline i root istället (fail-soft)
      if (!ctrl) {
        // Rensa root
        while (root.firstChild) root.removeChild(root.firstChild);
        root.appendChild(body);
      }

      // Spara controller på root så vi kan stänga på unmount
      try {
        root.__frzModalCtrl = ctrl;
        root.__frzModalBody = body;
      } catch {}

      // Rendera första body
      try {
        spec.renderBody(body, { root, ctx });
      } catch {
        // fail-soft
      }
    },

    unmount: ({ root }) => {
      try {
        const ctrl = root.__frzModalCtrl;
        if (ctrl && typeof ctrl.close === "function") ctrl.close();
      } catch {}
      try {
        delete root.__frzModalCtrl;
        delete root.__frzModalBody;
      } catch {}
    },

    render: ({ root, state, ctx }) => {
      // Om vi kör i modal: rendera i body
      try {
        const body = root.__frzModalBody;
        if (body && body instanceof HTMLElement) {
          // Rensa body och rendera på nytt
          while (body.firstChild) body.removeChild(body.firstChild);
          spec.renderBody(body, { root, state, ctx });
          return;
        }
      } catch {}

      // Inline fallback: rendera i root
      try {
        while (root.firstChild) root.removeChild(root.firstChild);
        const box = document.createElement("div");
        box.className = "panel";
        box.style.background = "#fff";
        box.style.border = "1px solid #e6e6e6";
        box.style.borderRadius = "12px";
        box.style.padding = "12px";
        spec.renderBody(box, { root, state, ctx });
        root.appendChild(box);
      } catch {
        // fail-soft
      }
    }
  });
}

/**
 * Skapar en wrapper-vy med nytt id/label men som delegatar till en befintlig vy.
 * @param {{ id:string, label:string, requiredPerm:string|null, base: import("./00-view-interface.js").FreezerView }} spec
 * @returns {import("./00-view-interface.js").FreezerView}
 */
function defineWrappedView(spec) {
  const base = spec.base;
  return defineView({
    id: String(spec.id || "").trim(),
    label: String(spec.label || "").trim(),
    requiredPerm: spec.requiredPerm ?? (base.requiredPerm ?? null),

    mount: ({ root, ctx }) => {
      try {
        if (typeof base.mount === "function") base.mount({ root, ctx });
      } catch {
        // fail-soft
      }
    },

    unmount: ({ root, ctx }) => {
      try {
        if (typeof base.unmount === "function") base.unmount({ root, ctx });
      } catch {
        // fail-soft
      }
    },

    render: ({ root, state, ctx }) => {
      try {
        if (typeof base.render === "function") base.render({ root, state, ctx });
      } catch {
        // fail-soft
      }
    }
  });
}

/* =========================
BLOCK 2 — Listor per roll
========================= */

const _sharedSaldo = defineExistingView(sharedSaldoView, "sharedSaldoView");
const _sharedHistory = defineExistingView(sharedHistoryView, "sharedHistoryView");

const _buyerDashboardBase = defineExistingView(buyerDashboardView, "buyerDashboardView");
const _buyerInBase = defineExistingView(buyerInView, "buyerInView");

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const sharedViews = [_sharedSaldo, _sharedHistory];

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const adminViews = []; // fylls när admin-moduler finns

/* =========================
BLOCK 2.1 — BUYER: korrekta 4 rutor
- Ny Leverantör (modal) — placeholder
- Ny produkt (modal) — placeholder
- Lägga in produkter (modal) — wrap buyer-in
- Sök Leverantör (inline vy) — wrap buyer-dashboard
========================= */

const buyerSupplierNewModal = defineModalView({
  id: "buyer-supplier-new",
  label: "Ny Leverantör",
  title: "Ny Leverantör",
  requiredPerm: null,
  renderBody: (root) => {
    const h = document.createElement("h3");
    h.style.margin = "0 0 8px 0";
    h.textContent = "Ny Leverantör";

    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = "Placeholder: här byggs formulär för att registrera ny leverantör (kommer i AO).";

    root.appendChild(h);
    root.appendChild(p);
  }
});

const buyerItemNewModal = defineModalView({
  id: "buyer-item-new",
  label: "Ny produkt",
  title: "Ny produkt",
  requiredPerm: "inventory_write",
  renderBody: (root, args) => {
    const h = document.createElement("h3");
    h.style.margin = "0 0 8px 0";
    h.textContent = "Ny produkt";

    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = "Placeholder: här byggs produktformulär (artikelnummer, leverantör, kategori, pris) i AO.";

    // Enkel hint om behörighet
    try {
      const canWrite = !!(args && args.ctx && typeof args.ctx.can === "function" && args.ctx.can("inventory_write"));
      if (!canWrite) {
        const w = document.createElement("div");
        w.className = "panel warn";
        w.style.marginTop = "10px";
        const b = document.createElement("b");
        b.textContent = "Skrivning spärrad";
        const m = document.createElement("div");
        m.className = "muted";
        m.textContent = "Du saknar inventory_write eller är i read-only läge.";
        w.appendChild(b);
        w.appendChild(m);
        root.appendChild(w);
      }
    } catch {}

    root.appendChild(h);
    root.appendChild(p);
  }
});

// Modal wrapper för "Lägga in produkter" -> använder buyer-in motorn
const buyerStockInModal = defineModalView({
  id: "buyer-stock-in",
  label: "Lägga in produkter",
  title: "Lägga in produkter",
  requiredPerm: null,
  renderBody: (root, args) => {
    // Vi renderar base-vyn inuti modal-body genom att låta base.render använda just "root" som container.
    // NOTE: base-vyn förväntar sig {root,state,ctx}, så vi emulerar det.
    try {
      // Rensa root och låt base rendera
      while (root.firstChild) root.removeChild(root.firstChild);

      // Skapa en intern container så base får en stabil yta
      const inner = document.createElement("div");
      root.appendChild(inner);

      if (typeof _buyerInBase.render === "function") {
        _buyerInBase.render({
          root: inner,
          state: (args && args.state) ? args.state : {},
          ctx: (args && args.ctx) ? args.ctx : {}
        });
      } else {
        const p = document.createElement("div");
        p.className = "muted";
        p.textContent = "buyer-in saknar render().";
        root.appendChild(p);
      }
    } catch {
      const p = document.createElement("div");
      p.className = "muted";
      p.textContent = "Kunde inte rendera Lägga in produkter (buyer-in).";
      root.appendChild(p);
    }
  }
});

// Inline view för "Sök Leverantör" -> använder buyer-dashboard motorn (tills riktig supplier-search finns)
const buyerSupplierSearchInline = defineWrappedView({
  id: "buyer-supplier-search",
  label: "Sök Leverantör",
  requiredPerm: _buyerDashboardBase.requiredPerm ?? null,
  base: _buyerDashboardBase
});

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const buyerViews = [
  buyerSupplierNewModal,
  buyerItemNewModal,
  buyerStockInModal,
  buyerSupplierSearchInline
];

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const pickerViews = [];

/* =========================
BLOCK 3 — Aggregat (praktiskt för router)
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
  if (up === "SYSTEM_ADMIN") return "";
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

  // ADMIN/PICKER: behåll shared + roll-specifika
  if (nr === "admin") return [...sharedViews, ...adminViews];
  if (nr === "picker") return [...sharedViews, ...pickerViews];

  // BUYER: VISA INTE shared i router-menyn (Saldo/Historik finns redan som legacy tabs)
  if (nr === "buyer") return [...buyerViews];

  // Default: shared
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
  } else {
    // fail-soft: uppdatera listor/funcs om registry redan finns (t.ex. vid hot reload)
    window.FreezerViewRegistry.defineView = defineView;
    window.FreezerViewRegistry.getViewsForRole = getViewsForRole;
    window.FreezerViewRegistry.findView = findView;
    window.FreezerViewRegistry.toMenuItems = toMenuItems;
    window.FreezerViewRegistry.sharedViews = sharedViews;
    window.FreezerViewRegistry.adminViews = adminViews;
    window.FreezerViewRegistry.buyerViews = buyerViews;
    window.FreezerViewRegistry.pickerViews = pickerViews;
  }
} catch {
  // fail-soft
}
