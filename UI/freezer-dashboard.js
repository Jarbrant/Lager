/* ============================================================
AO-01/15 — NY-BASELINE | FIL: UI/freezer-dashboard.js
+ AO-02A/15 — Dashboard Top OUT/IN (7/30/90)
+ AO-03A/15 — Artikeltrend (data + insikt) (30 dagar)

AUTOPATCH (hel fil)
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- Dashboard-beräkningar (stub-safe)
- Får aldrig kasta fel även om state är null/korrupt
- AO-02A: Topplistor IN/OUT för valbar period (7/30/90) utan ny storage-key
- AO-03A: Trendserie (30 dagar) per artikel: IN vs OUT per dag + deterministisk insiktstext

Policy:
- UI-only • inga nya storage-keys/datamodell
- Fail-soft i beräkningar (returnerar tomt läge hellre än fel)
- XSS-safe: denna fil renderar inget; endast data

P1/P0-policy (AO-02A):
- Moves utan timestamp (ts=0/okänd) ignoreras i period-topplistor.
- Aggregat-nyckel normaliseras (trim + lowercase) för att minska splittrade rader.
- inferDir() striktare (inga includes(IN/OUT)).

P0-policy (AO-03A):
- Trend kräver timestamp; moves utan timestamp ignoreras.
- Dag definieras som lokal dag (00:00–23:59 lokal tid), stabilt via dayKey().
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
    computeTrendInsight
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
        const min = safeNum(it && it.min, 0);
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

        const keyNorm = normalizeKey(info.key || info.label || "—");
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

      // key/label
      const key =
        safeStr(mv.itemId) ||
        safeStr(mv.productId) ||
        safeStr(mv.sku) ||
        safeStr(mv.id) ||
        safeStr(mv.itemKey) ||
        "";

      const label =
        safeStr(mv.itemName) ||
        safeStr(mv.productName) ||
        safeStr(mv.name) ||
        safeStr(mv.title) ||
        safeStr(mv.label) ||
        key ||
        "—";

      // stable key fallback (normaliseras senare)
      const stableKey = (key || label);

      return { dir, qty, key: stableKey, label, ts: ts || 0 };
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

  /* ============================================================
     AO-03A: ARTIKELTREND (30 dagar)
     - Serie med exakt 30 datapunkter (dag 0..29)
     - Saknade dagar = 0
     - Lokal dag-normalisering via dayKey()
     - POLICY: moves utan timestamp ignoreras
     ============================================================ */

  /**
   * Compute 30-day IN vs OUT series for one article.
   * articleKey kan vara articleNo/sku/itemId/label – vi matchar “best effort”
   * mot move.key/label (normaliserat).
   *
   * @param {any} state
   * @param {string} articleKey
   * @param {number} days default 30 (clamp 1..90), men AO kräver 30 i UI
   * @returns {{
   *   ok:boolean,
   *   articleKey:string,
   *   days:number,
   *   series:Array<{ dayKey:string, dayLabel:string, inQty:number, outQty:number }>,
   *   meta:{ totalMoves:number, usedMoves:number, ignoredMoves:number, matchedMoves:number }
   * }}
   */
  function computeArticleTrend30(state, articleKey, days) {
    try {
      const keyRaw = safeStr(articleKey);
      const keyNorm = normalizeKey(keyRaw);
      const d = clampRangeDays(days, 30);

      // skapa 30-dagars fönster: idag (lokal) bakåt
      const today = new Date();
      const todayKey = dayKey(today);

      const keys = buildDayKeysBackwards(today, d); // [oldest..today]
      /** @type {Record<string, {dayKey:string, dayLabel:string, inQty:number, outQty:number}>} */
      const map = Object.create(null);

      for (const k of keys) {
        map[k] = { dayKey: k, dayLabel: dayLabelFromKey(k), inQty: 0, outQty: 0 };
      }

      const moves = extractMoves(state);
      let used = 0, ignored = 0, matched = 0;

      for (const mv of moves) {
        const info = normalizeMove(mv);
        if (!info) { ignored++; continue; }
        if (!(info.ts > 0)) { ignored++; continue; } // policy

        const dk = dayKey(new Date(info.ts));
        // inom fönster?
        if (!map[dk]) { ignored++; continue; }

        // match artikel? (best effort)
        const mvKeyNorm = normalizeKey(info.key || "");
        const mvLabelNorm = normalizeKey(info.label || "");

        const isMatch =
          (keyNorm && (mvKeyNorm === keyNorm || mvLabelNorm === keyNorm)) ||
          (!keyNorm && false);

        if (!isMatch) { used++; continue; } // räknas som “analyserad men ej match”
        matched++;

        if (info.dir === "IN") map[dk].inQty += safeNum(info.qty, 0);
        else if (info.dir === "OUT") map[dk].outQty += safeNum(info.qty, 0);

        used++;
      }

      const series = keys.map(k => map[k]);

      // om användaren valt tom nyckel → ok=false men stabil serie (alla 0)
      const ok = !!keyNorm;

      return {
        ok,
        articleKey: keyRaw,
        days: d,
        series,
        meta: { totalMoves: moves.length, usedMoves: used, ignoredMoves: ignored, matchedMoves: matched }
      };
    } catch {
      return {
        ok: false,
        articleKey: safeStr(articleKey),
        days: clampRangeDays(days, 30),
        series: buildZeroSeries(30),
        meta: { totalMoves: 0, usedMoves: 0, ignoredMoves: 0, matchedMoves: 0 }
      };
    }
  }

  /**
   * Deterministisk insiktstext för trendserien.
   * @param {{ series?: Array<{dayKey:string, dayLabel:string, inQty:number, outQty:number }> }|any} trend
   * @returns {string}
   */
  function computeTrendInsight(trend) {
    try {
      const series = Array.isArray(trend && trend.series) ? trend.series : [];
      if (!series.length) return "Ingen data.";

      let totalIn = 0, totalOut = 0;
      let nonZeroDays = 0;

      let maxIn = 0, maxInDay = "";
      let maxOut = 0, maxOutDay = "";

      for (const p of series) {
        const inQ = safeNum(p && p.inQty, 0);
        const outQ = safeNum(p && p.outQty, 0);
        totalIn += inQ;
        totalOut += outQ;
        if ((inQ + outQ) > 0) nonZeroDays++;

        if (inQ > maxIn) { maxIn = inQ; maxInDay = safeStr(p && p.dayLabel); }
        if (outQ > maxOut) { maxOut = outQ; maxOutDay = safeStr(p && p.dayLabel); }
      }

      // Regel 1: mest 0
      if (nonZeroDays <= 1) return "Ingen eller nästan ingen aktivitet senaste 30 dagar.";

      // Regel 2: senaste 7 dagar OUT > IN
      const last7 = series.slice(-7);
      let in7 = 0, out7 = 0;
      for (const p of last7) { in7 += safeNum(p && p.inQty, 0); out7 += safeNum(p && p.outQty, 0); }
      if (out7 > in7 && (out7 + in7) > 0) return "Utflöde högre än inflöde senaste 7 dagar.";

      // Regel 3: IN-spike
      const avgIn = totalIn / series.length;
      if (maxIn > 0 && maxIn >= (avgIn * 3) && maxInDay) return `Stor inleverans ${maxInDay}.`;

      // Regel 4: OUT-spike
      const avgOut = totalOut / series.length;
      if (maxOut > 0 && maxOut >= (avgOut * 3) && maxOutDay) return `Stor utleverans ${maxOutDay}.`;

      // Regel 5: balans
      if (Math.abs(totalIn - totalOut) <= Math.max(1, (totalIn + totalOut) * 0.1)) {
        return "Inflöde och utflöde är ungefär i balans över 30 dagar.";
      }

      // Default
      return (totalOut > totalIn)
        ? "Utflöde dominerar över 30 dagar."
        : "Inflöde dominerar över 30 dagar.";
    } catch {
      return "Insikt kunde inte beräknas.";
    }
  }

  function clampRangeDays(days, fallback) {
    try {
      const n = Number(days);
      if (!Number.isFinite(n) || n <= 0) return fallback;
      if (n < 1) return 1;
      if (n > 90) return 90;
      return Math.round(n);
    } catch {
      return fallback;
    }
  }

  function buildDayKeysBackwards(nowDate, days) {
    try {
      const d = Math.max(1, safeNum(days, 30));
      const base = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()); // local midnight
      const out = [];
      for (let i = d - 1; i >= 0; i--) {
        const dt = new Date(base.getTime() - (i * 86400000));
        out.push(dayKey(dt));
      }
      return out;
    } catch {
      return buildZeroKeys(30);
    }
  }

  function buildZeroKeys(days) {
    const d = Math.max(1, safeNum(days, 30));
    const out = [];
    for (let i = 0; i < d; i++) out.push(`0000-00-00#${String(i).padStart(2, "0")}`);
    return out;
  }

  function buildZeroSeries(days) {
    const keys = buildZeroKeys(days);
    return keys.map((k, idx) => ({
      dayKey: k,
      dayLabel: `Dag ${idx + 1}`,
      inQty: 0,
      outQty: 0
    }));
  }

  /**
   * Local day key YYYY-MM-DD (stabil lokal dag).
   * @param {Date} dt
   * @returns {string}
   */
  function dayKey(dt) {
    try {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    } catch {
      return "0000-00-00";
    }
  }

  function dayLabelFromKey(k) {
    try {
      // Visa "MM-DD" (enkel, deterministisk). Render-lagret kan välja annat senare.
      const s = safeStr(k);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(5);
      return s || "—";
    } catch {
      return "—";
    }
  }

  // -----------------------------
  // common utils
  // -----------------------------
  function safeNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
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
  1) AO-03A: Added computeArticleTrend30(state, articleKey, days) -> stabil 30-dagars serie (saknade dagar=0).
  2) AO-03A: Added computeTrendInsight(trend) -> deterministiska regler (OUT>IN 7d, spikes, balans, etc.).
  3) AO-03A: Lokal dag-normalisering via dayKey() (stabil dag-bucketing).
  4) AO-03A: POLICY: moves utan timestamp ignoreras även i trend.
  5) Behöll AO-02A topplistor oförändrade (fail-soft, inga nya keys).
  */
})();
