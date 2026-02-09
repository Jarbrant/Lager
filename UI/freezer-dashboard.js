/* ============================================================
AO-02A/15 — Dashboard Top OUT/IN (7/30/90) | FIL: UI/freezer-dashboard.js
+ AO-03A/15 — Artikeltrend (30 dagar) (data + insight)
+ AO-04A/15 — Under minLevel (beräkning + lista)  [DENNA PATCH]
AUTOPATCH (hel fil)
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- Dashboard-beräkningar (baseline: stub-safe)
- Får aldrig kasta fel även om state är null/korrupt
- Topplistor IN/OUT för valbar period (7/30/90) utan ny storage-key
- Artikeltrend: välj artikel → visa IN/OUT per dag (30 dagar) + regelbaserad insikt
- Under-min: lista produkter där currentStock < minLevel + underBy

Policy:
- UI-only • inga nya storage-keys/datamodell
- Fail-soft i beräkningar (returnerar tomt läge hellre än fel)

P1/P0-policy:
- Moves utan timestamp (ts=0/okänd) ignoreras i period-topplistor + trend (för att period ska vara meningsfull).
- Aggregat-nyckel normaliseras (trim + lowercase) för att minska splittrade rader.
- inferDir() görs striktare (tar bort “includes(IN/OUT)” för att undvika falska träffar).

AO-04A policy:
- Ingen ny datamodell/keys
- Saknad/korrupt data => tom lista (ingen crash)
============================================================ */
(function () {
  "use strict";

  const FreezerDashboard = {
    // Baseline exports (stub-safe)
    computeKpis,
    computeNotes,

    // AO-02A exports
    computeTopInOut,

    // AO-03A exports
    computeArticleTrend30,
    computeTrendInsight,

    // AO-04A exports
    computeUnderMin
  };

  window.FreezerDashboard = FreezerDashboard;

  /**
   * Return minimal KPI object without throwing.
   * @param {any} state
   * @returns {{ itemCount:number, lowStockCount:number }}
   */
  function computeKpis(state) {
    try {
      const items = (state && state.data && Array.isArray(state.data.items)) ? state.data.items : [];
      const itemCount = items.length;

      let lowStockCount = 0;
      for (const it of items) {
        const onHand = safeNum(it && it.onHand, 0);
        const min = safeNum((it && (it.minLevel ?? it.min)), 0);
        if (onHand < min) lowStockCount++;
      }

      return { itemCount, lowStockCount };
    } catch {
      return { itemCount: 0, lowStockCount: 0 };
    }
  }

  /**
   * Return a short human note array without throwing.
   * @param {any} statusObj output from FreezerStore.getStatus()
   * @returns {string[]}
   */
  function computeNotes(statusObj) {
    try {
      const st = statusObj && typeof statusObj === "object" ? statusObj : {};
      const notes = [];

      if (st.debug && st.debug.rawWasEmpty) notes.push("Tom lagring vid start.");
      if (st.debug && st.debug.demoCreated) notes.push("Demo-data skapad.");
      if (st.locked) notes.push(`Låst läge: ${st.errorCode || "okänt fel"}`);
      if (st.readOnly && !st.locked) notes.push("Read-only: vissa knappar är spärrade.");

      return notes;
    } catch {
      return [];
    }
  }

  /* ============================================================
     AO-04A: UNDER MIN-NIVÅ (BERÄKNING)
     - Returnerar lista över items där currentStock < minLevel
     - Sort: mest kritiska först (störst underBy, tie-break: label)
     - Fail-soft: saknad/korrupt data => []
     ============================================================ */

  /**
   * Compute items under minLevel.
   * @param {any} state
   * @returns {{
   *   underMin: Array<{ key:string, articleNo:string, label:string, currentStock:number, minLevel:number, underBy:number }>,
   *   meta: { itemCount:number, usedCount:number }
   * }}
   */
  function computeUnderMin(state) {
    try {
      const items = extractItems(state);
      const stockMap = extractStockMap(state);

      /** @type {Array<{ key:string, articleNo:string, label:string, currentStock:number, minLevel:number, underBy:number }>} */
      const out = [];

      for (const it of items) {
        const articleNo = safeStr(it && (it.articleNo ?? it.sku ?? it.id ?? it.itemId ?? it.productId));
        const label = safeStr(it && (it.name ?? it.title ?? it.label ?? it.itemName ?? it.productName)) || articleNo || "—";

        const minLevel = safeInt(it && (it.minLevel ?? it.min), 0);
        if (!(minLevel > 0)) continue;

        // current stock: prefer explicit onHand; else lookup in stockMap by articleNo
        let currentStock = safeInt(it && it.onHand, NaN);
        if (!Number.isFinite(currentStock)) currentStock = safeInt(stockMap[articleNo], 0);

        const underBy = minLevel - currentStock;
        if (underBy >= 1) {
          const key = normalizeKey(articleNo || label || "—");
          out.push({ key, articleNo, label, currentStock, minLevel, underBy });
        }
      }

      out.sort((a, b) => {
        const au = safeNum(a && a.underBy, 0);
        const bu = safeNum(b && b.underBy, 0);
        if (bu !== au) return bu - au;
        // tie-break: lägre currentStock först (mer kritiskt)
        const ac = safeNum(a && a.currentStock, 0);
        const bc = safeNum(b && b.currentStock, 0);
        if (ac !== bc) return ac - bc;
        return String(a && a.label || "").localeCompare(String(b && b.label || ""), "sv-SE");
      });

      return { underMin: out, meta: { itemCount: items.length, usedCount: out.length } };
    } catch {
      return { underMin: [], meta: { itemCount: 0, usedCount: 0 } };
    }
  }

  function extractItems(state) {
    try {
      const s = state && typeof state === "object" ? state : {};
      const d = s.data && typeof s.data === "object" ? s.data : {};
      if (Array.isArray(d.items)) return d.items;
      if (Array.isArray(s.items)) return s.items;
      return [];
    } catch {
      return [];
    }
  }

  function extractStockMap(state) {
    try {
      const s = state && typeof state === "object" ? state : {};
      const d = s.data && typeof s.data === "object" ? s.data : {};
      const stock = d.stock ?? s.stock ?? null;

      // accept: object map {articleNo: qty}
      if (stock && typeof stock === "object" && !Array.isArray(stock)) return stock;

      // accept: array [{articleNo, qty}] => map
      if (Array.isArray(stock)) {
        const map = Object.create(null);
        for (const r of stock) {
          const k = safeStr(r && (r.articleNo ?? r.sku ?? r.id));
          if (!k) continue;
          map[k] = safeInt(r && (r.onHand ?? r.qty ?? r.quantity ?? r.count ?? r.units), 0);
        }
        return map;
      }

      return Object.create(null);
    } catch {
      return Object.create(null);
    }
  }

  /* ============================================================
     AO-02A: TOPPLISTOR IN/OUT (7/30/90)
     - Läser moves “best effort” från state (ingen ny datamodell)
     - Fail-soft: okänd move-shape => ignoreras
     - POLICY: moves utan timestamp ignoreras (ts=0)
     ============================================================ */

  /**
   * Compute Top 10 IN/OUT for given period days.
   * @param {any} state
   * @param {number} days allowed: 7/30/90 (annars clampas)
   * @returns {{
   *   days:number,
   *   in: Array<{ key:string, label:string, qty:number, count:number }>,
   *   out: Array<{ key:string, label:string, qty:number, count:number }>,
   *   meta: { totalMoves:number, usedMoves:number, ignoredMoves:number }
   * }}
   */
  function computeTopInOut(state, days) {
    try {
      const d = clampDays(days);
      const moves = extractMoves(state);

      const now = Date.now();
      const cutoff = now - (d * 86400000);

      /** @type {Record<string, {key:string,label:string,qty:number,count:number}>} */
      const inAgg = Object.create(null);
      /** @type {Record<string, {key:string,label:string,qty:number,count:number}>} */
      const outAgg = Object.create(null);

      let used = 0;
      let ignored = 0;

      for (const mv of moves) {
        const info = normalizeMove(mv);
        if (!info) { ignored++; continue; }

        // POLICY: utan timestamp -> ignorera (så period blir korrekt)
        if (!(info.ts > 0)) { ignored++; continue; }

        // tidfilter
        if (info.ts < cutoff) { ignored++; continue; }

        // qty måste vara > 0
        if (!(info.qty > 0)) { ignored++; continue; }

        const bucket = (info.dir === "IN") ? inAgg : (info.dir === "OUT") ? outAgg : null;
        if (!bucket) { ignored++; continue; }

        // Topplista: om key saknas faller vi tillbaka till label (best effort)
        const rawKey = (info.key || info.label || "—");
        const keyNorm = normalizeKey(rawKey);
        const label = info.label || info.key || "—";

        if (!bucket[keyNorm]) bucket[keyNorm] = { key: keyNorm, label, qty: 0, count: 0 };
        bucket[keyNorm].qty += info.qty;
        bucket[keyNorm].count += 1;

        used++;
      }

      const topIn = sortTop(bucketToArray(inAgg)).slice(0, 10);
      const topOut = sortTop(bucketToArray(outAgg)).slice(0, 10);

      return {
        days: d,
        in: topIn,
        out: topOut,
        meta: { totalMoves: moves.length, usedMoves: used, ignoredMoves: ignored }
      };
    } catch {
      return { days: clampDays(days), in: [], out: [], meta: { totalMoves: 0, usedMoves: 0, ignoredMoves: 0 } };
    }
  }

  function clampDays(days) {
    const n = Number(days);
    if (n === 7 || n === 30 || n === 90) return n;
    if (n > 0 && n < 30) return 7;
    if (n >= 30 && n < 90) return 30;
    if (n >= 90) return 90;
    return 30; // default
  }

  /* ============================================================
     AO-03A: ARTIKELTREND (30 dagar)
     - Stabil serie med exakt 30 datapunkter (lokal dag)
     - Saknade dagar = 0
     - POLICY: moves utan timestamp ignoreras (ts=0)
     ============================================================ */

  /**
   * Compute 30-day trend for a selected article (IN vs OUT per local day).
   * @param {any} state
   * @param {string} articleKey e.g. articleNo (recommended)
   * @returns {{
   *   key:string,
   *   days:number,
   *   series:Array<{ dayStart:number, day:string, inQty:number, outQty:number }>,
   *   meta:{ totalMoves:number, usedMoves:number, ignoredMoves:number }
   * }}
   */
  function computeArticleTrend30(state, articleKey) {
    try {
      const keyRaw = safeStr(articleKey);
      const keyNorm = normalizeKey(keyRaw);
      const moves = extractMoves(state);

      const days = 30;
      const now = Date.now();
      const todayStart = startOfLocalDay(now);

      // build day index (oldest -> newest)
      const series = [];
      /** @type {Record<number, {idx:number,dayStart:number,day:string}>} */
      const byDay = Object.create(null);

      for (let i = days - 1; i >= 0; i--) {
        const ds = startOfLocalDay(todayStart - (i * 86400000));
        const day = formatYmd(ds);
        series.push({ dayStart: ds, day, inQty: 0, outQty: 0 });
        byDay[ds] = { idx: series.length - 1, dayStart: ds, day };
      }

      const firstStart = series.length ? series[0].dayStart : (todayStart - (29 * 86400000));
      const lastStart = series.length ? series[series.length - 1].dayStart : todayStart;

      // QA-fix: om ingen selection -> stabilt tomläge + korrekt meta (vi filtrerar inte moves här)
      if (!keyNorm || keyNorm === "—") {
        return {
          key: keyRaw,
          days,
          series,
          meta: { totalMoves: moves.length, usedMoves: 0, ignoredMoves: 0 }
        };
      }

      let used = 0;
      let ignored = 0;

      for (const mv of moves) {
        const info = normalizeMove(mv);
        if (!info) { ignored++; continue; }

        // POLICY: without timestamp ignore
        if (!(info.ts > 0)) { ignored++; continue; }

        // range clamp: we bucket by local day start
        const ds = startOfLocalDay(info.ts);
        if (ds < firstStart || ds > lastStart) { ignored++; continue; }

        // qty must be > 0
        if (!(info.qty > 0)) { ignored++; continue; }

        // match article (primärt stabil key; fallback label om key saknas)
        const mvKeyNorm = normalizeKey(info.key || "");
        const mvLabelNorm = normalizeKey(info.label || "");
        const match = (mvKeyNorm && mvKeyNorm === keyNorm) || (!mvKeyNorm && mvLabelNorm === keyNorm);
        if (!match) { ignored++; continue; }

        const slot = byDay[ds];
        if (!slot) { ignored++; continue; }

        if (info.dir === "IN") series[slot.idx].inQty += info.qty;
        else if (info.dir === "OUT") series[slot.idx].outQty += info.qty;
        else { ignored++; continue; }

        used++;
      }

      return {
        key: keyRaw,
        days,
        series,
        meta: { totalMoves: moves.length, usedMoves: used, ignoredMoves: ignored }
      };
    } catch {
      return { key: safeStr(articleKey), days: 30, series: buildEmptyTrend30(), meta: { totalMoves: 0, usedMoves: 0, ignoredMoves: 0 } };
    }
  }

  function buildEmptyTrend30() {
    try {
      const days = 30;
      const now = Date.now();
      const todayStart = startOfLocalDay(now);
      const out = [];
      for (let i = days - 1; i >= 0; i--) {
        const ds = startOfLocalDay(todayStart - (i * 86400000));
        out.push({ dayStart: ds, day: formatYmd(ds), inQty: 0, outQty: 0 });
      }
      return out;
    } catch {
      return [];
    }
  }

  /**
   * Deterministic, rule-based insight text for a 30-day series.
   * @param {{series:Array<{day:string,inQty:number,outQty:number}>}} trend
   * @returns {string}
   */
  function computeTrendInsight(trend) {
    try {
      const s = trend && Array.isArray(trend.series) ? trend.series : [];
      if (!s.length) return "Ingen trenddata.";

      let total = 0;
      let totalIn = 0;
      let totalOut = 0;
      let zeroDays = 0;

      let maxIn = 0;
      let maxInDay = "";
      let sumIn = 0;

      for (const d of s) {
        const inQ = safeNum(d && d.inQty, 0);
        const outQ = safeNum(d && d.outQty, 0);
        totalIn += inQ;
        totalOut += outQ;
        total += (inQ + outQ);
        if ((inQ + outQ) === 0) zeroDays++;
        if (inQ > maxIn) { maxIn = inQ; maxInDay = safeStr(d && d.day); }
        sumIn += inQ;
      }

      if (total === 0 || zeroDays >= 28) return "Ingen aktivitet senaste 30 dagarna.";

      // last 7 days
      const last7 = s.slice(-7);
      let in7 = 0, out7 = 0;
      for (const d of last7) {
        in7 += safeNum(d && d.inQty, 0);
        out7 += safeNum(d && d.outQty, 0);
      }

      if (out7 > in7 && (out7 - in7) >= 1) {
        return "Utflöde högre än inflöde senaste 7 dagarna.";
      }

      // IN spike rule (deterministic): day >= 3x avgIn AND >= 5 units
      const avgIn = sumIn / Math.max(1, s.length);
      if (maxInDay && maxIn >= Math.max(5, avgIn * 3)) {
        return `Stor inleverans den ${maxInDay}.`;
      }

      // fallback: balance text
      if (totalOut > totalIn) return "Totalt utflöde är högre än inflöde över 30 dagar.";
      if (totalIn > totalOut) return "Totalt inflöde är högre än utflöde över 30 dagar.";
      return "Inflöde och utflöde är ungefär i balans över 30 dagar.";
    } catch {
      return "Ingen insikt (fel i analys).";
    }
  }

  /**
   * Try find moves array in common locations. Return [] if missing.
   * @param {any} state
   * @returns {any[]}
   */
  function extractMoves(state) {
    try {
      const s = state && typeof state === "object" ? state : {};
      const d = s.data && typeof s.data === "object" ? s.data : {};

      const candidates = [
        d.moves,
        d.history,
        d.events,
        s.moves,
        s.history,
        s.events
      ];

      for (const c of candidates) {
        if (Array.isArray(c)) return c;
      }
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Normalize a move into {dir, qty, key, label, ts}. Return null if cannot.
   * Supports multiple common shapes (type/kind/direction/delta/qty, etc.).
   * @param {any} mv
   * @returns {{ dir:"IN"|"OUT", qty:number, key:string, label:string, ts:number } | null}
   */
  function normalizeMove(mv) {
    try {
      if (!mv || typeof mv !== "object") return null;

      // timestamp
      const ts = parseTs(
        mv.ts ?? mv.time ?? mv.createdAt ?? mv.date ?? mv.at ?? mv.timestamp
      );

      // quantity (prefer explicit qty/quantity; else delta abs)
      const qtyRaw =
        mv.qty ?? mv.quantity ?? mv.amount ?? mv.count ?? mv.units ?? null;

      const deltaRaw =
        mv.delta ?? mv.diff ?? mv.change ?? mv.deltaQty ?? mv.deltaUnits ?? null;

      let qty = 0;
      if (qtyRaw != null) qty = Math.abs(safeNum(qtyRaw, 0));
      else if (deltaRaw != null) qty = Math.abs(safeNum(deltaRaw, 0));

      // direction
      const dir = inferDir(mv, deltaRaw);
      if (!dir) return null;

      // key = stabil identifierare (label får inte styra key om den kan ändras)
      const key =
        safeStr(mv.articleNo) ||
        safeStr(mv.articleNumber) ||
        safeStr(mv.article) ||
        safeStr(mv.itemId) ||
        safeStr(mv.productId) ||
        safeStr(mv.sku) ||
        safeStr(mv.id) ||
        safeStr(mv.itemKey) ||
        "";

      // label = mänskligt namn (kan ändras över tid)
      const label =
        safeStr(mv.itemName) ||
        safeStr(mv.productName) ||
        safeStr(mv.name) ||
        safeStr(mv.title) ||
        safeStr(mv.label) ||
        safeStr(mv.articleNo) ||
        key ||
        "—";

      return { dir, qty, key: key, label, ts: ts || 0 };
    } catch {
      return null;
    }
  }

  /**
   * Infer IN/OUT based on type fields or delta sign.
   * Striktare än tidigare (inga includes("IN")/includes("OUT")).
   * @param {any} mv
   * @param {any} deltaRaw
   * @returns {"IN"|"OUT"|null}
   */
  function inferDir(mv, deltaRaw) {
    try {
      const t = safeStr(mv.type) || safeStr(mv.kind) || safeStr(mv.action) || safeStr(mv.direction) || "";
      const up = t.toUpperCase().trim();

      // explicit tokens
      if (up === "IN" || up === "ADD" || up === "RESTOCK" || up === "PUT" || up === "RECEIVE") return "IN";
      if (up === "OUT" || up === "REMOVE" || up === "PICK" || up === "WITHDRAW" || up === "SHIP") return "OUT";

      // common words (exakta, inte substring)
      if (up === "RECEIVED" || up === "RECEIVING") return "IN";
      if (up === "SHIPPED" || up === "SHIPPING") return "OUT";

      // delta sign fallback
      const d = safeNum(deltaRaw, 0);
      if (d > 0) return "IN";
      if (d < 0) return "OUT";

      return null;
    } catch {
      return null;
    }
  }

  function parseTs(v) {
    try {
      if (v == null) return 0;
      if (typeof v === "number" && Number.isFinite(v)) {
        // assume ms; if seconds-ish, scale
        if (v > 0 && v < 2000000000) return v * 1000;
        return v;
      }
      const s = String(v).trim();
      if (!s) return 0;

      // YYYY-MM-DD → local midnight
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const parts = s.split("-");
        const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
        const dt = new Date(y, (m - 1), d);
        const ms = dt.getTime();
        return Number.isFinite(ms) ? ms : 0;
      }

      const ms = Date.parse(s);
      return Number.isFinite(ms) ? ms : 0;
    } catch {
      return 0;
    }
  }

  function startOfLocalDay(ts) {
    try {
      const d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      const ms = d.getTime();
      return Number.isFinite(ms) ? ms : 0;
    } catch {
      return 0;
    }
  }

  function formatYmd(dayStartMs) {
    try {
      const d = new Date(dayStartMs);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const da = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${da}`;
    } catch {
      return "—";
    }
  }

  function normalizeKey(v) {
    try {
      const s = String(v == null ? "" : v).trim();
      if (!s) return "—";
      return s.toLowerCase();
    } catch {
      return "—";
    }
  }

  function bucketToArray(map) {
    try {
      return Object.keys(map).map(k => map[k]);
    } catch {
      return [];
    }
  }

  function sortTop(arr) {
    try {
      return (Array.isArray(arr) ? arr : [])
        .slice()
        .sort((a, b) => {
          const aq = safeNum(a && a.qty, 0);
          const bq = safeNum(b && b.qty, 0);
          if (bq !== aq) return bq - aq;
          const ac = safeNum(a && a.count, 0);
          const bc = safeNum(b && b.count, 0);
          if (bc !== ac) return bc - ac;
          return String(a && a.label || "").localeCompare(String(b && b.label || ""));
        });
    } catch {
      return [];
    }
  }

  function safeNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function safeInt(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.trunc(n);
  }

  function safeStr(v) {
    try {
      const s = String(v == null ? "" : v).trim();
      return s;
    } catch {
      return "";
    }
  }

  /* ÄNDRINGSLOGG (≤8)
  1) AO-04A: lagt till computeUnderMin(state) -> underMin lista + deterministisk sort.
  2) AO-04A: robust item/stock-join (onHand först, fallback stockMap), fail-soft => [].
  3) AO-04A: minLevel stöder både minLevel och legacy min.
  4) Inga nya storage-keys/datamodell.
  5) Ingen påverkan på AO-02A/AO-03A flöden.
  */
})();
