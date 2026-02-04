/* ============================================================
AO-REFAC-STORE-SPLIT-01 (PROD) | FIL: UI/pages/freezer/02-core.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- (KRAV 4) Core utils: id, time, safe parse, små helpers
- Refactor-only: ingen funktionsförändring
- Policy: store ska inte rendera (core är bara hjälpfunktioner)

Taggar:
- GUARD / STORAGE / RBAC / FLOW / DEBUG
============================================================ */

(function () {
  "use strict";

  // Version-guard (stabil hook)
  if (window.FreezerCore && window.FreezerCore.version === "AO-REFAC-STORE-SPLIT-01:02-core@1") return;

  /* -----------------------------
    BLOCK 1/8 — Time + basic helpers
  ----------------------------- */
  function nowIso() {
    return new Date().toISOString();
  }

  function safeStr(v) {
    // Behåller baseline-beteende: endast string -> trim, annars ""
    if (typeof v !== "string") return "";
    return v.trim();
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

  function deepClone(obj) {
    try { return JSON.parse(JSON.stringify(obj)); } catch { return null; }
  }

  /* -----------------------------
    BLOCK 2/8 — IDs (UI-only)
  ----------------------------- */
  function makeId(prefix) {
    // UI-only id: stable-enough (not crypto) — matchar baseline-stilen
    const a = Math.random().toString(16).slice(2);
    const b = Date.now().toString(16);
    return `${prefix}_${b}_${a}`;
  }

  /* -----------------------------
    BLOCK 3/8 — Safe JSON parse
  ----------------------------- */
  function safeJsonParse(raw) {
    try {
      const v = JSON.parse(raw);
      return { ok: true, value: v, error: null };
    } catch (e) {
      return { ok: false, value: null, error: String(e && e.message ? e.message : e) };
    }
  }

  /* -----------------------------
    BLOCK 4/8 — Normalizers (items/users)
  ----------------------------- */
  function normalizeArticleNo(v) {
    const s = safeStr(v);
    if (!s) return "";
    const cleaned = s.replace(/[^A-Za-z0-9\-_]/g, "").toUpperCase();
    if (!cleaned) return "";
    return cleaned.slice(0, 32);
  }

  function safeUserName(v) {
    const s = safeStr(v);
    if (!s) return "";
    // Keep simple (UI-only): allow letters, space, dash, apostrophe
    const cleaned = s.replace(/[^A-Za-zÀ-ÖØ-öø-ÿÅÄÖåäö '\-]/g, "").trim();
    if (!cleaned) return "";
    return cleaned.slice(0, 32);
  }

  function normNameKey(s) {
    return String(s || "").trim().toLocaleLowerCase("sv-SE");
  }

  function normKey(s) {
    return String(s || "").trim().toLocaleLowerCase("sv-SE");
  }

  /* -----------------------------
    BLOCK 5/8 — Locale helpers
  ----------------------------- */
  function toLowerSv(s) {
    return String(s || "").toLocaleLowerCase("sv-SE");
  }

  /* -----------------------------
    BLOCK 6/8 — Defensive object checks
  ----------------------------- */
  function isObj(x) { return !!x && typeof x === "object"; }
  function isArr(x) { return Array.isArray(x); }

  /* -----------------------------
    BLOCK 7/8 — No-op logger (debug hook)
  ----------------------------- */
  function noop() {}

  // (DEBUG) framtida: byt ut till riktig logger i page/controller om ni vill.
  const log = { info: noop, warn: noop, error: noop };

  /* -----------------------------
    BLOCK 8/8 — Export (stable global)
  ----------------------------- */
  window.FreezerCore = {
    version: "AO-REFAC-STORE-SPLIT-01:02-core@1",

    // time
    nowIso,

    // primitives
    safeStr,
    safeNum,
    safeInt,
    deepClone,

    // json
    safeJsonParse,

    // ids
    makeId,

    // normalizers
    normalizeArticleNo,
    safeUserName,
    normNameKey,
    normKey,
    toLowerSv,

    // guards
    isObj,
    isArr,

    // debug
    log
  };
})();
