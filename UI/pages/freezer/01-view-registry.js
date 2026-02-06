/* ============================================================
AO-05/15 — View Registry (ESM, self-contained) | FIL-ID: UI/pages/freezer/01-view-registry.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Central export av vy-listor per roll (shared/admin/buyer/picker).
- P0 FIX: inga externa view-imports som kan ge 404 och krascha ESM-modulen.
- P0 BUYER: visa 4 inköpsrutor:
  - Ny Leverantör
  - Ny produkt
  - Lägga in produkter
  - Sök Leverantör

POLICY (LÅST):
- UI-only • inga nya storage-keys/datamodell
- XSS-safe: endast createElement + textContent
- Fail-closed friendly: registry skapas även om modal/render saknas
============================================================ */

import { createView, freezeView, validateViewShape } from "./00-view-interface.js";

/* =========================
BLOCK 1 — helpers
========================= */

function defineView(spec) {
  const v = createView(spec);
  validateViewShape(v);
  return freezeView(v);
}

function normalizeRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r === "inköpare" || r === "buyer") return "buyer";
  if (r === "admin") return "admin";
  if (r === "picker" || r === "plock" || r === "plockare") return "picker";
  return "shared";
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function clear(root) {
  try { while (root && root.firstChild) root.removeChild(root.firstChild); } catch {}
}

/* =========================
BLOCK 1.1 — Modal helper (fail-soft)
- Om FreezerModal saknas/okänt API -> rendera inline i root.
========================= */

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

function defineModalOrInlineView(spec) {
  const id = String(spec.id || "").trim();
  const label = String(spec.label || id).trim();
  const title = String(spec.title || label).trim();

  return defineView({
    id,
    label,
    requiredPerm: spec.requiredPerm ?? null,

    mount: ({ root, ctx }) => {
      const body = el("div", "panel", null);
      // Minimal styling utan att kräva CSS
      body.style.background = "#fff";
      body.style.border = "1px solid #e6e6e6";
      body.style.borderRadius = "12px";
      body.style.padding = "12px";

      const ctrl = tryOpenModal({ title, contentRoot: body, onClose: () => {} });

      if (!ctrl) {
        clear(root);
        root.appendChild(body);
      }

      // spara referenser för render/unmount
      try {
        root.__frzModalCtrl = ctrl;
        root.__frzModalBody = body;
      } catch {}

      // första render
      try { spec.renderBody(body, { root, ctx, state: {} }); } catch {}
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
      // render i modal body om den finns
      try {
        const body = root.__frzModalBody;
        if (body && body instanceof HTMLElement) {
          clear(body);
          spec.renderBody(body, { root, state: state || {}, ctx });
          return;
        }
      } catch {}

      // inline fallback
      clear(root);
      const box = el("div", "panel", null);
      box.style.background = "#fff";
      box.style.border = "1px solid #e6e6e6";
      box.style.borderRadius = "12px";
      box.style.padding = "12px";
      try { spec.renderBody(box, { root, state: state || {}, ctx }); } catch {}
      root.appendChild(box);
    }
  });
}

/* =========================
BLOCK 2 — Views
========================= */

// SHARED (placeholder: används av admin/picker senare)
const sharedSaldoView = defineView({
  id: "shared-saldo",
  label: "Saldo",
  requiredPerm: null,
  mount: ({ root }) => {
    clear(root);
    const b = el("div", "panel", null);
    b.appendChild(el("b", null, "Saldo (shared)"));
    b.appendChild(el("div", "muted", "Placeholder: shared saldo-vy kommer i senare AO."));
    root.appendChild(b);
  },
  render: () => {},
  unmount: () => {}
});

const sharedHistoryView = defineView({
  id: "shared-history",
  label: "Historik",
  requiredPerm: null,
  mount: ({ root }) => {
    clear(root);
    const b = el("div", "panel", null);
    b.appendChild(el("b", null, "Historik (shared)"));
    b.appendChild(el("div", "muted", "Placeholder: shared historik-vy kommer i senare AO."));
    root.appendChild(b);
  },
  render: () => {},
  unmount: () => {}
});

// BUYER: 4 rutor (3 modal, 1 inline) – stabil baseline utan externa imports
const buyerSupplierNew = defineModalOrInlineView({
  id: "buyer-supplier-new",
  label: "Ny Leverantör",
  title: "Ny Leverantör",
  requiredPerm: null,
  renderBody: (root) => {
    root.appendChild(el("h3", null, "Ny Leverantör"));
    root.appendChild(el("div", "muted", "Placeholder: formulär för ny leverantör byggs i kommande AO."));
  }
});

const buyerItemNew = defineModalOrInlineView({
  id: "buyer-item-new",
  label: "Ny produkt",
  title: "Ny produkt",
  requiredPerm: "inventory_write",
  renderBody: (root, args) => {
    root.appendChild(el("h3", null, "Ny produkt"));
    root.appendChild(el("div", "muted", "Placeholder: produktformulär byggs i kommande AO (artikelnummer, leverantör, kategori, pris)."));

    // fail-soft hint om behörighet
    try {
      const can = !!(args && args.ctx && typeof args.ctx.can === "function" && args.ctx.can("inventory_write"));
      if (!can) {
        const w = el("div", "panel warn", null);
        w.style.marginTop = "10px";
        w.appendChild(el("b", null, "Skrivning spärrad"));
        w.appendChild(el("div", "muted", "Saknar inventory_write eller sidan är read-only."));
        root.appendChild(w);
      }
    } catch {}
  }
});

const buyerStockIn = defineModalOrInlineView({
  id: "buyer-stock-in",
  label: "Lägga in produkter",
  title: "Lägga in produkter",
  requiredPerm: null,
  renderBody: (root) => {
    root.appendChild(el("h3", null, "Lägga in produkter"));
    root.appendChild(el("div", "muted", "Placeholder: lagerinlägg / registrera inleverans byggs i kommande AO."));
  }
});

const buyerSupplierSearch = defineView({
  id: "buyer-supplier-search",
  label: "Sök Leverantör",
  requiredPerm: null,
  mount: ({ root }) => {
    clear(root);
    const b = el("div", "panel", null);
    b.appendChild(el("h3", null, "Sök Leverantör"));
    b.appendChild(el("div", "muted", "Placeholder: sök leverantör byggs i kommande AO."));
    root.appendChild(b);
  },
  render: () => {},
  unmount: () => {}
});

/* =========================
BLOCK 3 — Listor per roll
========================= */

export const sharedViews = [sharedSaldoView, sharedHistoryView];
export const adminViews = [];   // fylls senare
export const buyerViews = [buyerSupplierNew, buyerItemNew, buyerStockIn, buyerSupplierSearch];
export const pickerViews = [];  // fylls senare

export function getViewsForRole(role) {
  const nr = normalizeRole(role);

  // BUYER: visa endast buyerViews (egna sidan har inga legacy tabs som ska dubbleras)
  if (nr === "buyer") return [...buyerViews];

  // ADMIN/PICKER: shared + roll-specifika
  if (nr === "admin") return [...sharedViews, ...adminViews];
  if (nr === "picker") return [...sharedViews, ...pickerViews];

  // Default: shared
  return [...sharedViews];
}

export function findView(views, id) {
  const vid = String(id || "").trim();
  const list = Array.isArray(views) ? views : [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v && String(v.id || "") === vid) return v;
  }
  return null;
}

export function toMenuItems(views) {
  const list = Array.isArray(views) ? views : [];
  return list.map(v => ({
    id: String(v.id || ""),
    label: String(v.label || v.id || ""),
    requiredPerm: v.requiredPerm ?? null
  }));
}

/* =========================
BLOCK 4 — Bridge till window.FreezerViewRegistry
========================= */

try {
  if (!window.FreezerViewRegistry) {
    window.FreezerViewRegistry = {
      defineView,
      getViewsForRole,
      findView,
      toMenuItems,
      sharedViews,
      adminViews,
      buyerViews,
      pickerViews
    };
  } else {
    // fail-soft uppdatering
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
