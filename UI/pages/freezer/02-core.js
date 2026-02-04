/* ============================================================
AO-REFAC-STORE-SPLIT-01 (PROD) | FIL: UI/pages/freezer/02-core.js
Projekt: Freezer (UI-only / localStorage-first)
Syfte:
- (KRAV 4) Core utils: id, time, safe parse, små helpers
- Refactor-only: ingen funktionsförändring
- Inga storage-keys här (STORE äger lagring)

Taggar:
- GUARD / STORAGE / RBAC / FLOW / DEBUG
============================================================ */

(function () {
  "use strict";

  if (window.FreezerCore && window.FreezerCore.version === "AO-REFAC-STORE-SPLIT-01:02-core@1") return;

  /* -----------------------------
    BLOCK 1/6 — Time + ids
  ----------------------------- */
  function nowIso() {
    return new Date().toISOString();
  }

  function makeId(prefix) {
    // UI-only id: "stable-enough" (inte crypto). Refactor-only => behåll beteendet.
    const a = Math.random().toString(16).slice(2);
    const b = Date.now().toString(16);
    return `${prefix}_${b}_${a}`;
  }

  /* -----------------------------
    BLOCK 2/6 — Safe primitives
  ----------------------------- */
  function safeStr(v) {
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

  function safeBool(v, fallback) {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "1" || s === "yes") return true;
      if (s === "false" || s === "0" || s === "no") return false;
    }
    return fallback;
  }

  /* -----------------------------
    BLOCK 3/6 — Key / name normalization
  ----------------------------- */
  function normKey(s) {
    return String(s || "")
      .trim()
      .toLocaleLowerCase("sv-SE");
  }

  function normNameKey(s) {
    return String(s || "")
      .trim()
      .toLocaleLowerCase("sv-SE");
  }

  function safeUserName(v) {
    const s = safeStr(v);
    if (!s) return "";

    // Keep simple: allow letters, space, dash, apostrophe (samma som baseline)
    const cleaned = s.replace(/[^A-Za-zÀ-ÖØ-öø-ÿÅÄÖåäö '\-]/g, "").trim();
    if (!cleaned) return "";
    return cleaned.slice(0, 32);
  }

  function normalizeArticleNo(v) {
    const s = safeStr(v);
    if (!s) return "";
    const cleaned = s.replace(/[^A-Za-z0-9\-_]/g, "").toUpperCase();
    if (!cleaned) return "";
    return cleaned.slice(0, 32);
  }

  /* -----------------------------
    BLOCK 4/6 — Safe JSON + cloning
  ----------------------------- */
  function safeJsonParse(raw) {
    // GUARD: return {ok, value, error}
    try {
      if (typeof raw !== "string" || raw.trim() === "") return { ok: false, value: null, error: "EMPTY" };
      return { ok: true, value: JSON.parse(raw), error: null };
    } catch (e) {
      return { ok: false, value: null, error: String(e && e.message ? e.message : e) };
    }
  }

  function safeJsonStringify(obj) {
    try {
      return { ok: true, raw: JSON.stringify(obj), error: null };
    } catch (e) {
      return { ok: false, raw: "", error: String(e && e.message ? e.message : e) };
    }
  }

  function deepClone(obj) {
    // FLOW/DEBUG: används för “safe snapshots” i store
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return null;
    }
  }

  /* -----------------------------
    BLOCK 5/6 — Small helpers
  ----------------------------- */
  function isPlainObject(x) {
    return !!x && typeof x === "object" && !Array.isArray(x);
  }

  function pick(obj, keys) {
    const out = {};
    if (!isPlainObject(obj) || !Array.isArray(keys)) return out;
    keys.forEach(k => { if (k in obj) out[k] = obj[k]; });
    return out;
  }

  function clamp(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.min(max, Math.max(min, x));
  }

  /* -----------------------------
    BLOCK 6/6 — Export
  ----------------------------- */
  window.FreezerCore = {
    version: "AO-REFAC-STORE-SPLIT-01:02-core@1",

    // time/id
    nowIso,
    makeId,

    // safe primitives
    safeStr,
    safeNum,
    safeInt,
    safeBool,

    // normalization
    normKey,
    normNameKey,
    safeUserName,
    normalizeArticleNo,

    // json/clone
    safeJsonParse,
    safeJsonStringify,
    deepClone,

    // misc
    isPlainObject,
    pick,
    clamp
  };
})();
