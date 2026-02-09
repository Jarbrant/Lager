/* ============================================================
AO-02A/15 — Dashboard Top OUT/IN (7/30/90) | FIL: UI/freezer-dashboard.js
AUTOPATCH (hel fil)
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- Dashboard-beräkningar (baseline: stub-safe)
- Får aldrig kasta fel även om state är null/korrupt
- Topplistor IN/OUT för valbar period (7/30/90) utan ny storage-key

Policy:
- UI-only • inga nya storage-keys/datamodell
- Fail-soft i beräkningar (returnerar tomt läge hellre än fel)

P1/P0-policy i denna patch:
- Moves utan timestamp (ts=0/okänd) ignoreras i period-topplistor (för att period ska vara meningsfull).
- Aggregat-nyckel normaliseras (trim + lowercase) för att minska splittrade rader.
- inferDir() görs striktare (tar bort “includes(IN/OUT)” för att undvika falska träffar).
============================================================ */
(function () {
  "use strict";

  const FreezerDashboard = {
    // Baseline exports (stub-safe)
    computeKpis,
    computeNotes,

    // AO-02A exports
    computeTopInOut
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
  1) P0: Säkrade sortTop() (safeNum används; ingen safeNum2/typo kan krascha sort).
  2) P1-policy: Moves utan timestamp ignoreras (ts=0) så 7/30/90-period blir korrekt.
  3) P2: inferDir() striktare (tar bort includes(IN/OUT) för att minska falska träffar).
  4) Aggregat-nyckel normaliseras (trim+lowercase) för mindre splittrade rader.
  */
})();
