/* ============================================================
AO-REFAC-STORE-SPLIT-01 (PROD) | FIL: UI/pages/freezer/02-core.js
Projekt: Freezer (UI-only / localStorage-first)
Syfte:
- (KRAV 4) Core utils: id, time, safe parse, small helpers
- Refactor-only: ingen funktionsförändring

Policy-taggar:
- GUARD / STORAGE / RBAC / FLOW / DEBUG
============================================================ */

/* -----------------------------
  BLOCK 1/4 — Namespace + version
----------------------------- */
(function () {
  "use strict";

  // GUARD: gör inget om redan definierad (för att undvika dubbel-init vid felaktig script-ordning)
  if (window.FreezerCore && window.FreezerCore.version === "AO-REFAC-STORE-SPLIT-01:02-core@1") return;

  /* -----------------------------
    BLOCK 2/4 — Small helpers (pure)
  ----------------------------- */
  function nowIso() {
    return new Date().toISOString();
  }

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

  function normKey(s) {
    return String(s || "").trim().toLocaleLowerCase("sv-SE");
  }

  function normNameKey(s) {
    return String(s || "").trim().toLocaleLowerCase("sv-SE");
  }

  // GUARD: UI-only id (inte crypto) — matchar tidigare makeId()
  function makeId(prefix) {
    const a = Math.random().toString(16).slice(2);
    const b = Date.now().toString(16);
    return `${prefix}_${b}_${a}`;
  }

  // GUARD: "best effort" JSON parse (fail-closed i caller)
  function tryJsonParse(raw) {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
  }

  // GUARD: defensiv deep-clone för state snapshots (som tidigare JSON roundtrip)
  function deepClone(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return null;
    }
  }

  /* -----------------------------
    BLOCK 3/4 — Domain helpers (shared)
  ----------------------------- */
  function safeUserName(v) {
    const s = safeStr(v);
    if (!s) return "";
    // Tillåt: bokstäver (inkl ÅÄÖ), mellanslag, apostrof, bindestreck
    const cleaned = s.replace(/[^A-Za-zÀ-ÖØ-öø-ÿÅÄÖåäö '\-]/g, "").trim();
    if (!cleaned) return "";
    return cleaned.slice(0, 32);
  }

  // AO-04: artikelnummer-normalisering (A–Z 0–9 - _), uppercase, max 32
  function normalizeArticleNo(v) {
    const s = safeStr(v);
    if (!s) return "";
    const cleaned = s.replace(/[^A-Za-z0-9\-_]/g, "").toUpperCase();
    if (!cleaned) return "";
    return cleaned.slice(0, 32);
  }

  /* -----------------------------
    BLOCK 4/4 — Export (global)
  ----------------------------- */
  window.FreezerCore = {
    version: "AO-REFAC-STORE-SPLIT-01:02-core@1",

    // time
    nowIso,

    // primitives
    safeStr,
    safeNum,
    safeInt,

    // keys
    normKey,
    normNameKey,

    // ids
    makeId,

    // json/state helpers
    tryJsonParse,
    deepClone,

    // domain helpers
    safeUserName,
    normalizeArticleNo
  };
})();

