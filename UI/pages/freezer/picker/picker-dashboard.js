/* ============================================================
AO-15/15 — Picker dashboard (minsta) + robust
FIL: UI/pages/freezer/picker/picker-dashboard.js
Projekt: Freezer (UI-only / localStorage-first)

Kontrakt:
- Picker: fokus på plock/ut (översikt + senaste händelser)
- Inga nya datanycklar / inga storage-keys
- Robust mount/render/unmount
- XSS-safe: createElement + textContent

ESM:
- Laddas med <script type="module" ...>

============================================================ */

import { defineView } from "../01-view-registry.js";

const VIEW_ID = "picker-dashboard";
const VIEW_TITLE = "Plock • Dashboard";

function el(tag) { return document.createElement(tag); }
function setText(node, text) { node.textContent = String(text == null ? "" : text); }
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

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

function normalizeHistory(state) {
  // Fail-soft: hitta historik oavsett shape
  const rows = pickFirstArray(state, ["history", "events", "historyRows", "log", "timeline"]);
  const norm = [];

  for (const r of rows) {
    if (!r || typeof r !== "object") continue;

    const kind = String(r.kind || r.type || r.action || r.eventType || "").toLowerCase();
    const dir = String(r.dir || r.direction || "").toLowerCase();

    const articleNo = String(r.articleNo || r.article || r.sku || r.itemId || r.id || "").trim();
    const qty = toNum(r.qty) ?? toNum(r.quantity) ?? toNum(r.kg) ?? toNum(r.qtyKg) ?? null;

    const at =
      r.at || r.createdAt || r.timestamp || r.time || r.date || null;

    const who = String(r.by || r.user || r.actor || r.userName || "").trim();

    norm.push({
      raw: r,
      kind,
      dir,
      articleNo,
      qty,
      at,
      who
    });
  }

  return norm;
}

function isOutEvent(e) {
  // Heuristik: "out" / "withdraw" / "pick" / dir=out / action=remove
  const k = e.kind || "";
  const d = e.dir || "";
  if (d === "out") return true;
  if (k.includes("out") || k.includes("withdraw") || k.includes("pick") || k.includes("remove") || k.includes("utt")) return true;
  return false;
}

function computePickerMetrics(state) {
  const history = normalizeHistory(state);

  const outEvents = history.filter(isOutEvent);
  const lastOut = outEvents.length ? outEvents[outEvents.length - 1] : null;

  // “Senaste 8” out-events
  const recentOut = outEvents.slice(-8).reverse();

  // Top articles in recent out (count)
  const counts = new Map();
  for (const e of recentOut) {
    const a = e.articleNo || "—";
    counts.set(a, (counts.get(a) || 0) + 1);
  }
  const top = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([articleNo, c]) => ({ articleNo, c }));

  return { recentOut, lastOut, top, outCount: outEvents.length };
}

function formatCtxLine(ctx) {
  const role = ctx && ctx.role ? String(ctx.role) : "—";
  const ro = ctx && (ctx.readOnly === true || ctx.mode === "readOnly") ? "read-only" : "write";
  return `role=${role} • mode=${ro}`;
}

function resolveRoot(ctx) {
  const r = ctx && ctx.root ? ctx.root : document.getElementById("freezerViewRoot");
  return r || document.body;
}

function renderPickerDashboard(root, state, ctx) {
  clear(root);

  const title = el("h2");
  title.style.margin = "0 0 6px 0";
  setText(title, "Plockdashboard");

  const sub = el("div");
  sub.style.opacity = "0.75";
  sub.style.marginBottom = "12px";
  setText(sub, `Fokus: uttag/plock och senaste händelser. (${formatCtxLine(ctx)})`);

  const m = computePickerMetrics(state);

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

  grid.appendChild(card("Uttag (totalt)", String(m.outCount), "Heuristik från history/events"));
  grid.appendChild(card("Senaste uttag", m.lastOut ? (m.lastOut.articleNo || "—") : "—", m.lastOut ? `qty=${m.lastOut.qty ?? "—"}` : "Ingen data ännu"));
  grid.appendChild(card("Senaste 8", String(m.recentOut.length), "Senaste out-events"));

  const listBox = el("div");
  listBox.style.marginTop = "12px";
  listBox.style.border = "1px solid #e6e6e6";
  listBox.style.borderRadius = "12px";
  listBox.style.padding = "12px";
  listBox.style.background = "#fff";

  const bTitle = el("b");
  setText(bTitle, "Senaste uttag");
  listBox.appendChild(bTitle);

  const hint = el("div");
  hint.style.opacity = "0.75";
  hint.style.fontSize = "12px";
  hint.style.marginTop = "4px";
  setText(hint, "Visar upp till 8 senaste uttag (heuristik).");
  listBox.appendChild(hint);

  if (!m.recentOut.length) {
    const empty = el("div");
    empty.style.marginTop = "10px";
    empty.style.opacity = "0.75";
    empty.style.fontSize = "13px";
    setText(empty, "Ingen uttagshistorik hittades.");
    listBox.appendChild(empty);
  } else {
    const table = el("div");
    table.style.marginTop = "10px";
    table.style.display = "grid";
    table.style.gridTemplateColumns = "140px 120px 1fr";
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
    table.appendChild(cell("Qty", true));
    table.appendChild(cell("Meta", true));

    for (const e of m.recentOut) {
      const meta = [];
      if (e.at) meta.push(String(e.at));
      if (e.who) meta.push(`by=${e.who}`);
      table.appendChild(cell(e.articleNo || "—", false));
      table.appendChild(cell(String(e.qty ?? "—"), false));
      table.appendChild(cell(meta.length ? meta.join(" • ") : "—", false));
    }
    listBox.appendChild(table);
  }

  const topBox = el("div");
  topBox.style.marginTop = "12px";
  topBox.style.border = "1px solid #e6e6e6";
  topBox.style.borderRadius = "12px";
  topBox.style.padding = "12px";
  topBox.style.background = "#fff";

  const tTitle = el("b");
  setText(tTitle, "Topplista (senaste 8)");
  topBox.appendChild(tTitle);

  const tHint = el("div");
  tHint.style.opacity = "0.75";
  tHint.style.fontSize = "12px";
  tHint.style.marginTop = "4px";
  setText(tHint, "Räknar antal förekomster per artikel i senaste listan.");
  topBox.appendChild(tHint);

  if (!m.top.length) {
    const empty = el("div");
    empty.style.marginTop = "10px";
    empty.style.opacity = "0.75";
    empty.style.fontSize = "13px";
    setText(empty, "Ingen topplista ännu.");
    topBox.appendChild(empty);
  } else {
    const ul = el("div");
    ul.style.marginTop = "10px";
    ul.style.display = "flex";
    ul.style.flexDirection = "column";
    ul.style.gap = "6px";
    ul.style.fontSize = "13px";

    for (const r of m.top) {
      const row = el("div");
      setText(row, `${r.articleNo}: ${r.c} st`);
      ul.appendChild(row);
    }
    topBox.appendChild(ul);
  }

  root.appendChild(title);
  root.appendChild(sub);
  root.appendChild(grid);
  root.appendChild(listBox);
  root.appendChild(topBox);
}

defineView({
  id: VIEW_ID,
  title: VIEW_TITLE,
  requiredPerm: "dashboard_view",

  mount(ctx) {
    const root = resolveRoot(ctx);
    const store = window.FreezerStore || null;

    const state = store && typeof store.getState === "function" ? store.getState() : {};
    renderPickerDashboard(root, state, ctx);

    let unsub = null;
    if (store && typeof store.subscribe === "function") {
      try {
        unsub = store.subscribe((st) => {
          renderPickerDashboard(root, st, ctx);
        });
      } catch {}
    }

    return {
      render(nextCtx) {
        const s = store && typeof store.getState === "function" ? store.getState() : {};
        renderPickerDashboard(root, s, nextCtx || ctx);
      },
      unmount() {
        try { if (typeof unsub === "function") unsub(); } catch {}
        clear(root);
      }
    };
  }
});
