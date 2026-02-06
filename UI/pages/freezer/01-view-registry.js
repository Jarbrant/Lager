/* ============================================================
AO-06/15 — View Registry (PROD) | FIL-ID: UI/pages/freezer/01-view-registry.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Central registry för vyer per roll (ADMIN / BUYER / PICKER).
- Exponerar window.FreezerViewRegistry (bridge) så non-ESM controllers kan använda registry.

P0 BUYER MENU FIX (DENNA FIL):
- BUYER-router ska visa exakt 4 inköpsrutor (inte shared saldo/historik).
- Etiketter: Ny Leverantör / Ny produkt / Lägga in produkter / Sök Leverantör
- Tre första öppnas i modal (fail-soft om window.FreezerModal saknas).
- Återanvänder befintliga buyer-vyer som “motor” där det är rimligt:
  - Lägga in produkter => buyer-in
  - Sök Leverantör => buyer-dashboard (tills riktig supplier-sök finns)

POLICY (LÅST):
- UI-only • Inga nya storage-keys/datamodell
- XSS-safe: bara createElement/textContent
- Fail-closed friendly: om modal/bridge saknas -> inline fallback
============================================================ */

/* ============================================================
IMPORTS
- Justera sökvägar om dina view-filer heter annorlunda.
- 00-view-interface.js är er gemensamma view-kontraktmodul.
============================================================ */
import { createView, freezeView, validateViewShape } from "./00-view-interface.js";

// Shared (alla roller i legacy / admin-sidan)
import { sharedSaldoView } from "./views/shared-saldo.js";
import { sharedHistoryView } from "./views/shared-history.js";

// Buyer “motor”-vyer (återanvänds som byggstenar)
import { buyerDashboardView } from "./views/buyer-dashboard.js";
import { buyerInView } from "./views/buyer-in.js";

/* ============================================================
BLOCK 1 — Core helpers
============================================================ */

function defineView(spec) {
  const v = createView(spec);
  validateViewShape(v);
  return freezeView(v);
}

function defineExistingView(view, name) {
  // Om en import saknas eller exporten är fel -> fail-closed med tydligt fel
  if (!view) throw new Error(`[FreezerRegistry] Missing view import: ${name}`);
  validateViewShape(view);
  return freezeView(view);
}

export function toMenuItems(views) {
  const arr = Array.isArray(views) ? views : [];
  return arr
    .filter(Boolean)
    .map((v) => ({
      id: String(v.id || "").trim(),
      label: String(v.label || v.id || "").trim(),
      requiredPerm: (v.requiredPerm == null) ? null : String(v.requiredPerm)
    }))
    .filter((x) => !!x.id);
}

export function findView(views, id) {
  const want = String(id || "").trim();
  if (!want) return null;
  const arr = Array.isArray(views) ? views : [];
  for (const v of arr) {
    if (v && String(v.id || "").trim() === want) return v;
  }
  return null;
}

/* ============================================================
BLOCK 1.1 — Modal helper (fail-soft)
============================================================ */

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

    const openFn =
      (typeof m.open === "function" && m.open) ||
      (typeof m.show === "function" && m.show) ||
      null;

    if (!openFn) return null;

    const res = openFn({
      title: String(opts.title || ""),
      contentRoot: opts.contentRoot,
      onClose: typeof opts.onClose === "function" ? opts.onClose : undefined
    });

    if (res && typeof res.close === "function") return res;
    if (typeof m.close === "function") return { close: () => { try { m.close(); } catch {} } };
    return { close: () => {} };
  } catch {
    return null;
  }
}

/**
 * Skapar en modal-vy.
 * Fail-soft: om modal inte går -> renderas inline i viewRoot.
 * @param {{
 *  id:string, label:string, requiredPerm:string|null,
 *  title:string, renderBody:(root:HTMLElement, args:{root:HTMLElement,state:any,ctx:any})=>void
 * }} spec
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
      const body = document.createElement("div");
      body.className = "panel";
      body.style.background = "#fff";
      body.style.border = "1px solid #e6e6e6";
      body.style.borderRadius = "12px";
      body.style.padding = "12px";

      const ctrl = tryOpenModal({
        title,
        contentRoot: body,
        onClose: () => {}
      });

      // Inline fallback om modal saknas
      if (!ctrl) {
        while (root.firstChild) root.removeChild(root.firstChild);
        root.appendChild(body);
      }

      try {
        root.__frzModalCtrl = ctrl;
        root.__frzModalBody = body;
      } catch {}

      try {
        spec.renderBody(body, { root, state: {}, ctx });
      } catch {}
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
      // Om modal-body finns -> rendera i den
      try {
        const body = root.__frzModalBody;
        if (body && body instanceof HTMLElement) {
          while (body.firstChild) body.removeChild(body.firstChild);
          spec.renderBody(body, { root, state, ctx });
          return;
        }
      } catch {}

      // Inline fallback
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
      } catch {}
    }
  });
}

/**
 * Wrapper-vy: nytt id/label men delegatar mount/render/unmount till base.
 * @param {{ id:string, label:string, requiredPerm:string|null, base:any }} spec
 */
function defineWrappedView(spec) {
  const base = spec.base;
  return defineView({
    id: String(spec.id || "").trim(),
    label: String(spec.label || "").trim(),
    requiredPerm: spec.requiredPerm ?? (base && base.requiredPerm ? base.requiredPerm : null),

    mount: ({ root, ctx }) => { try { base && base.mount && base.mount({ root, ctx }); } catch {} },
    unmount: ({ root, ctx }) => { try { base && base.unmount && base.unmount({ root, ctx }); } catch {} },
    render: ({ root, state, ctx }) => { try { base && base.render && base.render({ root, state, ctx }); } catch {} }
  });
}

/* ============================================================
BLOCK 2 — Basvyer (freeze + validate)
============================================================ */

const _sharedSaldo = defineExistingView(sharedSaldoView, "sharedSaldoView");
const _sharedHistory = defineExistingView(sharedHistoryView, "sharedHistoryView");

const _buyerDashboardBase = defineExistingView(buyerDashboardView, "buyerDashboardView");
const _buyerInBase = defineExistingView(buyerInView, "buyerInView");

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const sharedViews = [_sharedSaldo, _sharedHistory];

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const adminViews = []; // fylls i senare AO

/** @type {import("./00-view-interface.js").FreezerView[]} */
export const pickerViews = []; // fylls i senare AO

/* ============================================================
BLOCK 2.1 — BUYER: 4 rutor (korrekt meny)
============================================================ */

// 1) Ny Leverantör (modal placeholder)
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
    p.textContent = "Placeholder: formulär för ny leverantör kommer i senare AO.";

    root.appendChild(h);
    root.appendChild(p);
  }
});

// 2) Ny produkt (modal placeholder)
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
    p.textContent = "Placeholder: produktformulär (artikelnummer, leverantör, kategori, pris) kommer i senare AO.";

    // Hint om behörighet
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

// 3) Lägga in produkter (modal) — återanvänder buyer-in som motor
const buyerStockInModal = defineModalView({
  id: "buyer-stock-in",
  label: "Lägga in produkter",
  title: "Lägga in produkter",
  requiredPerm: null,
  renderBody: (root, args) => {
    try {
      while (root.firstChild) root.removeChild(root.firstChild);

      // Stable inner root så base-vyn kan rendera “normalt”
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

// 4) Sök Leverantör (inline) — återanvänder buyer-dashboard tills riktig supplier-sök finns
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

/* ============================================================
BLOCK 3 — Role logic (VIKTIG)
============================================================ */

function normalizeRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r === "administrator") return "admin";
  if (r === "buy") return "buyer";
  if (r === "inköpare") return "buyer";
  if (r === "picking") return "picker";
  if (r === "plock") return "picker";
  return r;
}

/**
 * Returnerar vylista per roll.
 * OBS:
 * - BUYER ska INTE få sharedViews här (buyer/freezer.html har egen router med 4 rutor).
 * - ADMIN/PICKER kan få shared + rollspecifikt (beroende på era AOs).
 */
export function getViewsForRole(role) {
  const nr = normalizeRole(role);

  if (nr === "buyer") return [...buyerViews];

  if (nr === "admin") return [...sharedViews, ...adminViews];
  if (nr === "picker") return [...sharedViews, ...pickerViews];

  // Default: shared (fail-soft)
  return [...sharedViews];
}

/* ============================================================
BLOCK 4 — Bridge: window.FreezerViewRegistry
============================================================ */

try {
  const api = {
    defineView,
    getViewsForRole,
    findView,
    toMenuItems,
    sharedViews,
    adminViews,
    buyerViews,
    pickerViews
  };

  if (!window.FreezerViewRegistry) {
    window.FreezerViewRegistry = api;
  } else {
    // fail-soft: uppdatera funktioner/listor om registry redan finns
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
  // fail-soft: inget mer
}
