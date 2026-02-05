/* ============================================================
AO-14/15 — Buyer dashboard (minsta)
FIL: UI/pages/freezer/buyer/buyer-dashboard.js
Projekt: Freezer (UI-only / localStorage-first)

Kontrakt:
- Buyer: fokus på inköp (låga nivåer, rekommenderad inköpslista)
- Inga nya datanycklar / inga nya storage-keys
- Robust mount/render/unmount (router-kompatibelt)
- XSS-safe: bygger DOM via createElement + textContent

ESM:
- Laddas med <script type="module" ...>

P0-FIX i denna patch:
- defineView-spec måste använda label (inte title) för att matcha view-interface/registry.
- exportera vyn (buyerDashboardView) så registry kan importera den senare.
- mount/render/unmount måste följa router: mount({root,ctx}), render({root,state,ctx}), unmount({root,ctx})
============================================================ */

import { defineView } from "../01-view-registry.js";

const VIEW_ID = "buyer-dashboard";
const VIEW_LABEL = "Inköp • Dashboard";

/* =========================
BLOCK 1 — Lokal vy-state (ingen storage)
========================= */
const _viewState = {
  root: /** @type {HTMLElement|null} */ (null),
  unsub: /** @type {null|Function} */ (null)
};

function safeNum(n) {
  return Number.isFinite(n) ? n : 0;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickFirstArray(state, keys) {
  for (const k of keys) {
    const v = state && state[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function normalizeItemsAndStock(state) {
  const items = pickFirstArray(state, ["items", "catalog", "products", "itemRegistry", "itemList"]);
  const stockRows = pickFirstArray(state, ["saldo", "stock", "inventory", "rows", "saldoRows", "inventoryRows"]);

  const byArticle = new Map();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const articleNo = String(it.articleNo || it.article || it.sku || it.id || "").trim();
    if (!articleNo) continue;
    byArticle.set(articleNo, it);
  }

  const normStock = [];
  for (const r of stockRows) {
    if (!r || typeof r !== "object") continue;
    const articleNo = String(r.articleNo || r.article || r.sku || r.id || "").trim();
    if (!articleNo) continue;

    const qty =
      toNum(r.qty) ??
      toNum(r.quantity) ??
      toNum(r.onHand) ??
      toNum(r.balance) ??
      toNum(r.kg) ??
      toNum(r.qtyKg) ??
      0;

    normStock.push({ articleNo, qty });
  }

  return { byArticle, stock: normStock };
}

function computeBuyerList(state) {
  const { byArticle, stock } = normalizeItemsAndStock(state);
  const needs = [];

  for (const row of stock) {
    const it = byArticle.get(row.articleNo);
    if (!it) continue;

    // skip inactive if available
    if ("isActive" in it && !it.isActive) continue;

    const minLevel = toNum(it.minLevel);
    if (minLevel == null) continue;

    if (row.qty < minLevel) {
      const deficit = safeNum(minLevel) - safeNum(row.qty);
      const supplier = String(it.supplier || "");
      const category = String(it.category || "");
      needs.push({
        articleNo: row.articleNo,
        supplier,
        category,
        qty: row.qty,
        minLevel,
        deficit
      });
    }
  }

  needs.sort((a, b) => safeNum(b.deficit) - safeNum(a.deficit));
  return needs.slice(0, 12);
}

function el(tag) { return document.createElement(tag); }
function setText(node, text) { node.textContent = String(text == null ? "" : text); }
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function formatCtxLine(ctx) {
  const role = ctx && ctx.role ? String(ctx.role) : "—";
  const ro = ctx && (ctx.readOnly === true || ctx.mode === "readOnly" || ctx.isReadOnly === true) ? "read-only" : "write";
  return `role=${role} • mode=${ro}`;
}

function resolveRootFromArgs(a, b) {
  // Router: mount({root,ctx}) / render({root,state,ctx})
  if (a && typeof a === "object" && a.root) return a.root;

  // Legacy: mount(ctx) där ctx.root finns
  if (a && typeof a === "object" && a.root) return a.root;

  // Fallback
  const fromDom = document.getElementById("freezerViewRoot");
  return fromDom || document.body;
}

function resolveCtxFromArgs(a, b) {
  // Router shape
  if (a && typeof a === "object" && ("ctx" in a)) return a.ctx || null;

  // Legacy: mount(ctx)
  if (a && typeof a === "object" && !("root" in a)) return a;

  return b || null;
}

function resolveStateFromArgs(a) {
  // Router: render({root,state,ctx})
  if (a && typeof a === "object" && ("state" in a)) return a.state || {};
  return {};
}

function renderBuyerDashboard(root, state, ctx) {
  if (!root || !(root instanceof HTMLElement)) return;
  clear(root);

  const title = el("h2");
  title.style.margin = "0 0 6px 0";
  setText(title, "Inköpsdashboard");

  const sub = el("div");
  sub.style.opacity = "0.75";
  sub.style.marginBottom = "12px";
  setText(sub, `Fokus: låga nivåer och inköpslista. (${formatCtxLine(ctx)})`);

  const list = computeBuyerList(state);

  const cards = el("div");
  cards.style.display = "grid";
  cards.style.gridTemplateColumns = "repeat(auto-fit, minmax(220px, 1fr))";
  cards.style.gap = "10px";

  const c1 = el("div");
  c1.style.border = "1px solid #e6e6e6";
  c1.style.borderRadius = "12px";
  c1.style.padding = "12px";
  c1.style.background = "#fff";

  const l1 = el("div");
  l1.style.opacity = "0.75";
  l1.style.fontSize = "13px";
  setText(l1, "Under min-nivå");

  const v1 = el("div");
  v1.style.fontWeight = "800";
  v1.style.fontSize = "20px";
  v1.style.marginTop = "4px";
  setText(v1, String(list.length));

  const h1 = el("div");
  h1.style.opacity = "0.7";
  h1.style.fontSize = "12px";
  h1.style.marginTop = "6px";
  setText(h1, "Visar upp till 12 förslag.");

  c1.appendChild(l1);
  c1.appendChild(v1);
  c1.appendChild(h1);

  cards.appendChild(c1);

  const box = el("div");
  box.style.marginTop = "12px";
  box.style.border = "1px solid #e6e6e6";
  box.style.borderRadius = "12px";
  box.style.padding = "12px";
  box.style.background = "#fff";

  const bTitle = el("b");
  setText(bTitle, "Rekommenderad inköpslista");
  box.appendChild(bTitle);

  const hint = el("div");
  hint.style.opacity = "0.75";
  hint.style.fontSize = "12px";
  hint.style.marginTop = "4px";
  setText(hint, "Bygger på qty < minLevel. Deficit = (minLevel - qty).");
  box.appendChild(hint);

  if (list.length === 0) {
    const empty = el("div");
    empty.style.marginTop = "10px";
    empty.style.opacity = "0.75";
    empty.style.fontSize = "13px";
    setText(empty, "Inga inköpsbehov hittades (eller minLevel saknas).");
    box.appendChild(empty);
  } else {
    const table = el("div");
    table.style.marginTop = "10px";
    table.style.display = "grid";
    table.style.gridTemplateColumns = "120px 1fr 120px 120px";
    table.style.gap = "6px";
    table.style.alignItems = "center";
    table.style.fontSize = "13px";

    function cell(txt, bold) {
      const d = el("div");
      if (bold) d.style.fontWeight = "700";
      setText(d, txt);
      return d;
    }

    table.appendChild(cell("Artikel", true));
    table.appendChild(cell("Leverantör / kategori", true));
    table.appendChild(cell("Qty", true));
    table.appendChild(cell("Köp", true));

    for (const r of list) {
      table.appendChild(cell(r.articleNo, false));
      table.appendChild(cell(`${r.supplier || "—"} • ${r.category || "—"}`, false));
      table.appendChild(cell(String(r.qty), false));
      table.appendChild(cell(String(r.deficit), false));
    }

    box.appendChild(table);
  }

  root.appendChild(title);
  root.appendChild(sub);
  root.appendChild(cards);
  root.appendChild(box);
}

/* =========================
BLOCK 2 — View definition (P0: router-kompatibel + exporterad)
========================= */
export const buyerDashboardView = defineView({
  id: VIEW_ID,
  label: VIEW_LABEL,
  requiredPerm: "dashboard_view",

  mount(a, b) {
    try {
      // Router: mount({root,ctx})
      const root = resolveRootFromArgs(a, b);
      const ctx = resolveCtxFromArgs(a, b);

      _viewState.root = (root instanceof HTMLElement) ? root : null;

      // säkerställ att vi inte läcker gamla subscriptions
      try { if (typeof _viewState.unsub === "function") _viewState.unsub(); } catch {}
      _viewState.unsub = null;

      const store = window.FreezerStore || null;
      const state = store && typeof store.getState === "function" ? store.getState() : {};
      renderBuyerDashboard(_viewState.root || root, state, ctx);

      if (store && typeof store.subscribe === "function") {
        try {
          _viewState.unsub = store.subscribe((st) => {
            // använd senast känd root
            const r = _viewState.root || root;
            renderBuyerDashboard(r, st || {}, ctx);
          });
        } catch {
          _viewState.unsub = null;
        }
      }
    } catch {
      /* fail-soft */
    }
  },

  render(a, b) {
    try {
      // Router: render({root,state,ctx})
      const root = (a && typeof a === "object" && a.root) ? a.root : (_viewState.root || resolveRootFromArgs(a, b));
      const ctx = resolveCtxFromArgs(a, b);
      const state = resolveStateFromArgs(a);

      _viewState.root = (root instanceof HTMLElement) ? root : _viewState.root;

      renderBuyerDashboard(root, state, ctx);
    } catch {
      /* fail-soft */
    }
  },

  unmount() {
    try { if (typeof _viewState.unsub === "function") _viewState.unsub(); } catch {}
    _viewState.unsub = null;

    try {
      if (_viewState.root) clear(_viewState.root);
    } catch {}

    _viewState.root = null;
  }
});
