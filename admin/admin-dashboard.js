/* ============================================================
AO-14/15 — Admin dashboard (riktig)
FIL: UI/pages/freezer/admin/admin-dashboard.js
Projekt: Freezer (UI-only / localStorage-first)

Kontrakt:
- Admin: visar mer (låga nivåer, totalvärde, alerts)
- Inga nya datanycklar / inga nya storage-keys
- Robust mount/render/unmount
- XSS-safe: bygger DOM via createElement + textContent

ESM:
- Laddas med <script type="module" ...>

============================================================ */

import { defineView } from "../01-view-registry.js";

const VIEW_ID = "admin-dashboard";
const VIEW_TITLE = "Admin • Dashboard";

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

  // Normalize stock rows: { articleNo, qty, qtyKg? }
  const normStock = [];
  for (const r of stockRows) {
    if (!r || typeof r !== "object") continue;
    const articleNo = String(r.articleNo || r.article || r.sku || r.id || "").trim();
    if (!articleNo) continue;

    // Quantity heuristics: qty, quantity, qtyKg, kg, onHand
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

  // low stock: qty < minLevel (om minLevel finns)
  let lowCount = 0;
  const lowList = [];

  // total value (heuristic):
  // if we can find pricePerKg and qty is kg-ish -> value += qty * pricePerKg
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

  // Alerts (heuristic)
  const alerts = [];
  if (lowCount > 0) alerts.push({ kind: "warn", text: `${lowCount} artikel/ar under min-nivå.` });
  if (inactiveCount > 0) alerts.push({ kind: "muted", text: `${inactiveCount} arkiverad(e)/inaktiv(a) artikel(ar).` });
  if (history && history.length === 0) alerts.push({ kind: "muted", text: "Ingen historik ännu (demo/nytt läge)." });

  // sort low list: biggest deficit first
  lowList.sort((a, b) => (safeNum((b.minLevel - b.qty)) - safeNum((a.minLevel - a.qty))));

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

function el(tag, className) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  return n;
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
  // Enkel formattering utan Intl beroende (fail-soft)
  const rounded = Math.round(v);
  return `${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")} kr`;
}

function formatCtxLine(ctx) {
  const role = ctx && ctx.role ? String(ctx.role) : "—";
  const ro = ctx && (ctx.readOnly === true || ctx.mode === "readOnly") ? "read-only" : "write";
  return `role=${role} • mode=${ro}`;
}

function renderAdminDashboard(root, state, ctx) {
  clear(root);

  const h = el("div");
  const title = el("h2");
  title.style.margin = "0 0 6px 0";
  setText(title, "Admin Dashboard");

  const sub = el("div");
  sub.style.opacity = "0.75";
  sub.style.marginBottom = "12px";
  setText(sub, `Översikt och alerts. (${formatCtxLine(ctx)})`);

  h.appendChild(title);
  h.appendChild(sub);

  const m = computeAdminMetrics(state);

  const grid = el("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(220px, 1fr))";
  grid.style.gap = "10px";

  function card(label, value, hint) {
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
    v.style.fontWeight = "800";
    v.style.fontSize = "20px";
    v.style.marginTop = "4px";
    setText(v, value);

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

  grid.appendChild(card("Artiklar (SKU)", m.skusTotal, "Totalt i produktregister"));
  grid.appendChild(card("Under min-nivå", m.lowCount, "Prioritera åtgärd/inköp"));
  grid.appendChild(card("Arkiverade", m.inactiveCount, "Inaktiva produkter"));
  grid.appendChild(card("Totalvärde (est.)", fmtMoneySek(m.totalValue), "qty * pricePerKg (heuristik)"));
  grid.appendChild(card("Historikposter", m.historyCount, "Event/log-count (heuristik)"));

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
  aList.style.marginTop = "8px";
  aList.style.display = "flex";
  aList.style.flexDirection = "column";
  aList.style.gap = "6px";

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

  alertsBox.appendChild(aList);

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
  table.appendChild(cell("Min", true));

  if (m.lowList.length === 0) {
    const empty = el("div");
    empty.style.marginTop = "8px";
    empty.style.opacity = "0.75";
    empty.style.fontSize = "13px";
    setText(empty, "Inga låga nivåer hittades (eller minLevel saknas).");
    lowBox.appendChild(empty);
  } else {
    for (const r of m.lowList) {
      table.appendChild(cell(r.articleNo, false));
      table.appendChild(cell(`${r.supplier || "—"} • ${r.category || "—"}`, false));
      table.appendChild(cell(String(r.qty), false));
      table.appendChild(cell(String(r.minLevel), false));
    }
    lowBox.appendChild(table);
  }

  root.appendChild(h);
  root.appendChild(grid);
  root.appendChild(alertsBox);
  root.appendChild(lowBox);
}

function resolveRoot(ctx) {
  // Router kan ge ctx.root, annars fallback till freezerViewRoot.
  const r = ctx && ctx.root ? ctx.root : document.getElementById("freezerViewRoot");
  return r || document.body;
}

defineView({
  id: VIEW_ID,
  title: VIEW_TITLE,
  // Admin-dashboard visas normalt i admin-meny; perm kan justeras senare.
  requiredPerm: "dashboard_view",

  mount(ctx) {
    const root = resolveRoot(ctx);
    const store = (window.FreezerStore) ? window.FreezerStore : null;

    const state = store && typeof store.getState === "function" ? store.getState() : {};
    renderAdminDashboard(root, state, ctx);

    // subscribe om möjligt
    let unsub = null;
    if (store && typeof store.subscribe === "function") {
      try {
        unsub = store.subscribe((st) => {
          renderAdminDashboard(root, st, ctx);
        });
      } catch {}
    }

    return {
      render(nextCtx) {
        const s = store && typeof store.getState === "function" ? store.getState() : {};
        renderAdminDashboard(root, s, nextCtx || ctx);
      },
      unmount() {
        try { if (typeof unsub === "function") unsub(); } catch {}
        clear(root);
      }
    };
  }
});
