/* ============================================================
AO-14/15 — Admin dashboard (riktig)
FIL: UI/pages/freezer/admin/admin-dashboard.js
Projekt: Freezer (UI-only / localStorage-first)

Kontrakt:
- Admin: visar mer (låga nivåer, totalvärde, alerts)
- Inga nya datanycklar / inga nya storage-keys
- Robust mount/render/unmount
- XSS-safe: bygger DOM via createElement + textContent
- ESM: laddas med <script type="module" ...>

KOMPAT:
- Följer defineView-kontraktet som används av era placeholders:
  defineView({ id,label,requiredPerm, mount(root,ctx), render(ctx), unmount() })

============================================================ */

import { defineView } from "../01-view-registry.js";

const VIEW_ID = "admin-dashboard";
const VIEW_LABEL = "Dashboard";

let _root = null;

// ---- helpers -------------------------------------------------
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
  // Fail-soft: hitta items + stock/saldo oavsett exakt shape.
  const items = pickFirstArray(state, ["items", "catalog", "products", "itemRegistry", "itemList"]);
  const stockRows = pickFirstArray(state, ["saldo", "stock", "inventory", "rows", "saldoRows", "inventoryRows"]);
  const historyRows = pickFirstArray(state, ["history", "events", "historyRows", "log"]);

  // Index items by articleNo (eller id)
  const byArticle = new Map();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const articleNo = String(it.articleNo || it.article || it.sku || it.id || "").trim();
    if (!articleNo) continue;
    byArticle.set(articleNo, it);
  }

  // Normalize stock rows: { articleNo, qty }
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

  return { items, byArticle, stock: normStock, history: historyRows };
}

function computeAdminMetrics(state) {
  const { items, byArticle, stock, history } = normalizeItemsAndStock(state);

  let skusTotal = 0;
  let inactiveCount = 0;
  let requiresExpiryCount = 0;

  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    skusTotal += 1;
    if ("isActive" in it && !it.isActive) inactiveCount += 1;
    if ("requiresExpiry" in it && !!it.requiresExpiry) requiresExpiryCount += 1;
  }

  let lowCount = 0;
  const lowList = [];

  let totalValue = 0;

  for (const row of stock) {
    const it = byArticle.get(row.articleNo);
    const minLevel = it ? (toNum(it.minLevel) ?? null) : null;

    if (minLevel !== null && row.qty < minLevel) {
      lowCount += 1;
      lowList.push({
        articleNo: row.articleNo,
        qty: row.qty,
        minLevel,
        supplier: it ? String(it.supplier || "") : "",
        category: it ? String(it.category || "") : ""
      });
    }

    const pricePerKg = it ? (toNum(it.pricePerKg) ?? null) : null;
    if (pricePerKg !== null) {
      totalValue += safeNum(row.qty) * safeNum(pricePerKg);
    }
  }

  lowList.sort((a, b) => safeNum((b.minLevel - b.qty)) - safeNum((a.minLevel - a.qty)));

  return {
    skusTotal,
    inactiveCount,
    requiresExpiryCount,
    lowCount,
    lowList: lowList.slice(0, 10),
    totalValue,
    historyCount: Array.isArray(history) ? history.length : 0
  };
}

function el(tag) {
  return document.createElement(tag);
}

function setText(node, text) {
  if (!node) return;
  node.textContent = String(text == null ? "" : text);
}

function clear(node) {
  if (!node) return;
  while (node.firstChild) node.removeChild(node.firstChild);
}

function fmtMoneySek(n) {
  const v = safeNum(n);
  const rounded = Math.round(v);
  return `${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} kr`;
}

function formatCtxLine(ctx) {
  const role = ctx && ctx.role ? String(ctx.role) : "—";
  const ro = ctx && (ctx.readOnly === true || ctx.mode === "readOnly") ? "read-only" : "write";
  return `role=${role} • mode=${ro}`;
}

function getStoreState() {
  try {
    const s = window.FreezerStore;
    if (s && typeof s.getState === "function") return s.getState();
  } catch {}
  return {};
}

// ---- DOM ids -------------------------------------------------
const IDS = {
  ctx: "frzAdminDashCtx",
  skus: "frzAdminDashSkus",
  low: "frzAdminDashLow",
  inactive: "frzAdminDashInactive",
  value: "frzAdminDashValue",
  hist: "frzAdminDashHist",
  alerts: "frzAdminDashAlerts",
  lowTable: "frzAdminDashLowTable"
};

function buildUI(root) {
  clear(root);

  const wrap = el("section");
  wrap.setAttribute("data-view", VIEW_ID);

  const title = el("h2");
  title.style.margin = "0 0 6px 0";
  setText(title, "Admin Dashboard");

  const sub = el("div");
  sub.id = IDS.ctx;
  sub.style.opacity = "0.75";
  sub.style.marginBottom = "12px";
  setText(sub, `Översikt och alerts. (${formatCtxLine({})})`);

  // Grid cards
  const grid = el("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(220px, 1fr))";
  grid.style.gap = "10px";

  function card(label, valueId, hint) {
    const c = el("div");
    c.style.border = "1px solid #e6e6e6";
    c.style.borderRadius = "12px";
    c.style.padding = "12px";
    c.style.background = "#fff";

    const l = el("div");
    l.style.opacity = "0.75";
    l.style.fontSize = "13px";
    setText(l, label);

    const v = el("div");
    v.id = valueId;
    v.style.fontWeight = "800";
    v.style.fontSize = "20px";
    v.style.marginTop = "4px";
    setText(v, "—");

    const h = el("div");
    h.style.opacity = "0.7";
    h.style.fontSize = "12px";
    h.style.marginTop = "6px";
    setText(h, hint || "—");

    c.appendChild(l);
    c.appendChild(v);
    c.appendChild(h);
    return c;
  }

  grid.appendChild(card("Artiklar (SKU)", IDS.skus, "Totalt i produktregister"));
  grid.appendChild(card("Under min-nivå", IDS.low, "Prioritera åtgärd/inköp"));
  grid.appendChild(card("Arkiverade", IDS.inactive, "Inaktiva produkter"));
  grid.appendChild(card("Totalvärde (est.)", IDS.value, "qty * pricePerKg (heuristik)"));
  grid.appendChild(card("Historikposter", IDS.hist, "Event/log-count (heuristik)"));

  // Alerts
  const alertsBox = el("div");
  alertsBox.style.marginTop = "12px";
  alertsBox.style.border = "1px solid #e6e6e6";
  alertsBox.style.borderRadius = "12px";
  alertsBox.style.padding = "12px";
  alertsBox.style.background = "#fff";

  const aTitle = el("b");
  setText(aTitle, "Alerts");
  alertsBox.appendChild(aTitle);

  const aList = el("div");
  aList.id = IDS.alerts;
  aList.style.marginTop = "8px";
  aList.style.display = "flex";
  aList.style.flexDirection = "column";
  aList.style.gap = "6px";
  alertsBox.appendChild(aList);

  // Low list
  const lowBox = el("div");
  lowBox.style.marginTop = "12px";
  lowBox.style.border = "1px solid #e6e6e6";
  lowBox.style.borderRadius = "12px";
  lowBox.style.padding = "12px";
  lowBox.style.background = "#fff";

  const lowTitle = el("b");
  setText(lowTitle, "Topplista: Låga nivåer");
  lowBox.appendChild(lowTitle);

  const lowHint = el("div");
  lowHint.style.opacity = "0.75";
  lowHint.style.fontSize = "12px";
  lowHint.style.marginTop = "4px";
  setText(lowHint, "Visar upp till 10 artiklar där qty < minLevel (om minLevel finns).");
  lowBox.appendChild(lowHint);

  const lowTable = el("div");
  lowTable.id = IDS.lowTable;
  lowTable.style.marginTop = "10px";
  lowBox.appendChild(lowTable);

  wrap.appendChild(title);
  wrap.appendChild(sub);
  wrap.appendChild(grid);
  wrap.appendChild(alertsBox);
  wrap.appendChild(lowBox);

  root.appendChild(wrap);
}

function renderIntoExisting(ctx) {
  try {
    const state = getStoreState();
    const m = computeAdminMetrics(state);

    const ctxEl = document.getElementById(IDS.ctx);
    if (ctxEl) setText(ctxEl, `Översikt och alerts. (${formatCtxLine(ctx)})`);

    const skusEl = document.getElementById(IDS.skus);
    if (skusEl) setText(skusEl, String(m.skusTotal));

    const lowEl = document.getElementById(IDS.low);
    if (lowEl) setText(lowEl, String(m.lowCount));

    const inactiveEl = document.getElementById(IDS.inactive);
    if (inactiveEl) setText(inactiveEl, String(m.inactiveCount));

    const valueEl = document.getElementById(IDS.value);
    if (valueEl) setText(valueEl, fmtMoneySek(m.totalValue));

    const histEl = document.getElementById(IDS.hist);
    if (histEl) setText(histEl, String(m.historyCount));

    // Alerts list
    const aList = document.getElementById(IDS.alerts);
    if (aList) {
      clear(aList);
      const alerts = [];
      if (m.lowCount > 0) alerts.push({ kind: "warn", text: `${m.lowCount} artikel/ar under min-nivå.` });
      if (m.inactiveCount > 0) alerts.push({ kind: "muted", text: `${m.inactiveCount} arkiverad(e)/inaktiv(a) artikel(ar).` });
      if (m.historyCount === 0) alerts.push({ kind: "muted", text: "Ingen historik ännu (demo/nytt läge)." });
      if (alerts.length === 0) alerts.push({ kind: "ok", text: "Inga alerts just nu." });

      for (const a of alerts) {
        const row = el("div");
        row.style.fontSize = "13px";
        row.style.opacity = a.kind === "muted" ? "0.75" : "1";
        setText(row, a.text);
        aList.appendChild(row);
      }
    }

    // Low table
    const t = document.getElementById(IDS.lowTable);
    if (t) {
      clear(t);

      if (!m.lowList || m.lowList.length === 0) {
        const empty = el("div");
        empty.style.opacity = "0.75";
        empty.style.fontSize = "13px";
        setText(empty, "Inga låga nivåer hittades (eller minLevel saknas).");
        t.appendChild(empty);
      } else {
        const grid = el("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "120px 1fr 120px 120px";
        grid.style.gap = "6px";
        grid.style.alignItems = "center";
        grid.style.fontSize = "13px";

        function cell(txt, bold) {
          const d = el("div");
          if (bold) d.style.fontWeight = "700";
          setText(d, txt);
          return d;
        }

        grid.appendChild(cell("Artikel", true));
        grid.appendChild(cell("Leverantör / kategori", true));
        grid.appendChild(cell("Qty", true));
        grid.appendChild(cell("Min", true));

        for (const r of m.lowList) {
          grid.appendChild(cell(r.articleNo, false));
          grid.appendChild(cell(`${r.supplier || "—"} • ${r.category || "—"}`, false));
          grid.appendChild(cell(String(r.qty), false));
          grid.appendChild(cell(String(r.minLevel), false));
        }

        t.appendChild(grid);
      }
    }
  } catch {
    /* fail-soft */
  }
}

// ---- register view -------------------------------------------
export const adminDashboardView = defineView({
  id: VIEW_ID,
  label: VIEW_LABEL,
  requiredPerm: "dashboard_view",

  mount(root, ctx) {
    try {
      if (!root || !(root instanceof HTMLElement)) return;
      _root = root;
      buildUI(_root);
      renderIntoExisting(ctx);

      // Fail-soft: om store kan subscribe, uppdatera live (utan att skapa sid-effekter)
      const s = window.FreezerStore;
      if (s && typeof s.subscribe === "function") {
        try {
          // s.subscribe returnerar ofta unsub; om inte, ignorera
          const unsub = s.subscribe(() => {
            // re-render baserat på aktuellt ctx (senaste render-ctx)
            renderIntoExisting(ctx);
          });
          // spara unsub på root dataset (så unmount kan försöka plocka upp)
          if (typeof unsub === "function") {
            root.__frzAdminDashUnsub = unsub;
          }
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* fail-soft */
    }
  },

  render(ctx) {
    // robust: om DOM inte finns gör inget
    try {
      if (!_root || !(_root instanceof HTMLElement)) return;
      renderIntoExisting(ctx);
    } catch {
      /* fail-soft */
    }
  },

  unmount() {
    try {
      if (_root && _root.__frzAdminDashUnsub && typeof _root.__frzAdminDashUnsub === "function") {
        try { _root.__frzAdminDashUnsub(); } catch {}
      }
      if (_root && _root instanceof HTMLElement) clear(_root);
    } catch {
      /* fail-soft */
    } finally {
      _root = null;
    }
  }
});
