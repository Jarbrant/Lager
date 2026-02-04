/* ============================================================
AO-REFAC-STORE-SPLIT-01 (PROD) | FIL: UI/pages/freezer/04-contract.js
Projekt: Freezer (UI-only / localStorage-first)
Syfte:
- (KRAV 4) Contract: schema + validate/normalize + constants (actions/status/roles/perms/errors)
- Refactor-only: ingen funktionsförändring
- Store ska inte rendera; kontraktet är pure-ish (ingen DOM, ingen localStorage)

Policy-taggar:
- GUARD / STORAGE / RBAC / FLOW / DEBUG
============================================================ */

/* -----------------------------
  BLOCK 1/6 — Bootstrap + deps
----------------------------- */
(function () {
  "use strict";

  if (window.FreezerContract && window.FreezerContract.version === "AO-REFAC-STORE-SPLIT-01:04-contract@1") return;

  const Core = window.FreezerCore || null;

  // GUARD: minimala fallbacks om script-ordning är fel (ska inte hända, men fail-closed)
  const safeStr = Core && Core.safeStr ? Core.safeStr : (v) => (typeof v === "string" ? v.trim() : "");
  const safeNum = Core && Core.safeNum ? Core.safeNum : (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);
  const safeInt = Core && Core.safeInt ? Core.safeInt : (v, fb) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fb);
  const normKey = Core && Core.normKey ? Core.normKey : (s) => String(s || "").trim().toLocaleLowerCase("sv-SE");
  const normNameKey = Core && Core.normNameKey ? Core.normNameKey : (s) => String(s || "").trim().toLocaleLowerCase("sv-SE");
  const nowIso = Core && Core.nowIso ? Core.nowIso : () => new Date().toISOString();

  const safeUserName = Core && Core.safeUserName ? Core.safeUserName : (v) => safeStr(v).slice(0, 32);
  const normalizeArticleNo = Core && Core.normalizeArticleNo
    ? Core.normalizeArticleNo
    : (v) => safeStr(v).replace(/[^A-Za-z0-9\-_]/g, "").toUpperCase().slice(0, 32);

  /* -----------------------------
    BLOCK 2/6 — Constants (AO-01..04)
  ----------------------------- */
  // STORAGE (global key hålls stabil)
  const FRZ_STORAGE_KEY = "AO-FREEZER_V1";
  const FRZ_SCHEMA_VERSION = 1;

  // RBAC
  const FRZ_ROLES = /** @type {const} */ (["ADMIN", "BUYER", "PICKER", "SYSTEM_ADMIN"]);
  function isValidRole(v) { return FRZ_ROLES.includes(v); }

  const FRZ_PERMS = /** @type {const} */ ([
    "users_manage",
    "inventory_write",
    "history_write",
    "dashboard_view"
  ]);
  function isValidPermKey(k) { return FRZ_PERMS.includes(k); }

  // STATUS + ERROR CODES (AO-02)
  const FRZ_STATUS = /** @type {const} */ (["OK", "TOM", "KORRUPT"]);
  const FRZ_ERR = /** @type {const} */ ({
    NONE: "FRZ_E_NONE",
    NOT_INIT: "FRZ_E_NOT_INIT",
    CORRUPT_JSON: "FRZ_E_CORRUPT_JSON",
    INVALID_ROOT: "FRZ_E_INVALID_ROOT",
    INVALID_SCHEMA: "FRZ_E_INVALID_SCHEMA",
    INVALID_ROLE: "FRZ_E_INVALID_ROLE",
    INVALID_SHAPE: "FRZ_E_INVALID_SHAPE",
    STORAGE_WRITE_BLOCKED: "FRZ_E_STORAGE_WRITE_BLOCKED",

    // AO-03 (users)
    USER_NAME_NOT_UNIQUE: "FRZ_E_USER_NAME_NOT_UNIQUE",
    USER_INVALID: "FRZ_E_USER_INVALID",
    USER_INACTIVE: "FRZ_E_USER_INACTIVE",
    FORBIDDEN: "FRZ_E_FORBIDDEN",

    // AO-04 (items)
    ITEM_INVALID: "FRZ_E_ITEM_INVALID",
    ITEM_ARTICLE_NO_NOT_UNIQUE: "FRZ_E_ITEM_ARTICLE_NO_NOT_UNIQUE",
    ITEM_ARTICLE_NO_IMMUTABLE: "FRZ_E_ITEM_ARTICLE_NO_IMMUTABLE",
    ITEM_DELETE_GUARDED: "FRZ_E_ITEM_DELETE_GUARDED"
  });

  // AO-04: contract constants
  const FRZ_TEMP_CLASSES = /** @type {const} */ (["FROZEN", "CHILLED", "AMBIENT"]);

  function normalizeTempClass(v) {
    const s = safeStr(v).toUpperCase();
    if (FRZ_TEMP_CLASSES.includes(s)) return s;
    // fail-soft för legacy
    if (!s) return "FROZEN";
    return "";
  }

  /* -----------------------------
    BLOCK 3/6 — Normalizers (Users / History)
  ----------------------------- */
  function normalizePerms(perms) {
    // RBAC: default dashboard_view=true för att kunna se dashboard även utan explicit flagga
    const out = { users_manage: false, inventory_write: false, history_write: false, dashboard_view: true };
    const p = perms && typeof perms === "object" ? perms : {};
    FRZ_PERMS.forEach(k => {
      if (k === "dashboard_view") out[k] = ("dashboard_view" in p) ? !!p[k] : true;
      else out[k] = !!p[k];
    });
    return out;
  }

  function normalizeUser(u) {
    if (!u || typeof u !== "object") return null;

    const id = safeStr(u.id) || ""; // store kan fylla id vid behov (refactor-only)
    const firstName = safeUserName(u.firstName);
    if (!firstName) return null;

    const active = ("active" in u) ? !!u.active : true;

    const auditIn = u.audit && typeof u.audit === "object" ? u.audit : {};
    const now = nowIso();

    // Optional role mapping (intern hjälp, påverkar inte UI direkt)
    const roleKey = isValidRole(u.roleKey) ? u.roleKey : (isValidRole(u.role) ? u.role : safeStr(u.roleKey));

    return {
      id: id || "", // store kan auto-fylla om tomt
      firstName,
      active,
      roleKey: roleKey || "",
      perms: normalizePerms(u.perms),
      audit: {
        createdAt: typeof auditIn.createdAt === "string" ? auditIn.createdAt : now,
        updatedAt: typeof auditIn.updatedAt === "string" ? auditIn.updatedAt : now,
        createdBy: safeStr(auditIn.createdBy) || "",
        updatedBy: safeStr(auditIn.updatedBy) || ""
      }
    };
  }

  function normalizeHistory(h) {
    if (!h || typeof h !== "object") return null;
    const ts = typeof h.ts === "string" ? h.ts : nowIso();
    const type = safeStr(h.type) || "note";
    const sku = safeStr(h.sku) || "";
    const qty = safeNum(h.qty, 0);
    const by = safeStr(h.by) || "";
    const note = safeStr(h.note) || "";
    return { ts, type, sku, qty, by, note };
  }

  function createDefaultUsers(makeIdFn) {
    // makeIdFn injectas från store/core för att undvika cyclic deps
    const makeId = typeof makeIdFn === "function" ? makeIdFn : (() => "");
    const now = nowIso();
    return [
      {
        id: makeId("u"),
        firstName: "Admin",
        active: true,
        roleKey: "ADMIN",
        perms: { users_manage: true, inventory_write: true, history_write: true, dashboard_view: true },
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
      },
      {
        id: makeId("u"),
        firstName: "Inköp",
        active: true,
        roleKey: "BUYER",
        perms: { users_manage: false, inventory_write: true, history_write: false, dashboard_view: true },
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
      },
      {
        id: makeId("u"),
        firstName: "Plock",
        active: true,
        roleKey: "PICKER",
        perms: { users_manage: false, inventory_write: true, history_write: true, dashboard_view: true },
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
      },
      {
        id: makeId("u"),
        firstName: "System",
        active: true,
        roleKey: "SYSTEM_ADMIN",
        perms: { users_manage: false, inventory_write: false, history_write: false, dashboard_view: true },
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
      }
    ];
  }

  /* -----------------------------
    BLOCK 4/6 — Normalizers (Items) + validators
  ----------------------------- */
  function deriveLegacyName(it) {
    const sup = safeStr(it && it.supplier);
    const cat = safeStr(it && it.category);
    const ps = safeStr(it && it.packSize);
    const parts = [];
    if (sup) parts.push(sup);
    if (cat) parts.push(cat);
    if (ps) parts.push(ps);
    return parts.length ? parts.join(" • ") : "—";
  }

  function deriveLegacyUnit(it) {
    const ps = safeStr(it && it.packSize);
    if (!ps) return "—";
    return "fp";
  }

  function normalizeItemNew(it) {
    if (!it || typeof it !== "object") return null;

    const articleNo = normalizeArticleNo(it.articleNo);
    if (!articleNo) return null;

    const packSize = safeStr(it.packSize);
    const supplier = safeStr(it.supplier);
    const category = safeStr(it.category);

    const pricePerKg = safeNum(it.pricePerKg, 0);
    const minLevel = safeInt(it.minLevel, 0);

    const tempClass = normalizeTempClass(it.tempClass);
    const requiresExpiry = !!it.requiresExpiry;
    const isActive = ("isActive" in it) ? !!it.isActive : true;

    const auditIn = it.audit && typeof it.audit === "object" ? it.audit : {};
    const now = nowIso();

    const audit = {
      createdAt: typeof auditIn.createdAt === "string" ? auditIn.createdAt : now,
      updatedAt: typeof auditIn.updatedAt === "string" ? auditIn.updatedAt : now,
      createdBy: safeStr(auditIn.createdBy) || "",
      updatedBy: safeStr(auditIn.updatedBy) || ""
    };

    // Back-compat extras (om finns -> behåll, annars derive)
    const legacyName = safeStr(it.name) || deriveLegacyName({ supplier, category, packSize });
    const legacyUnit = safeStr(it.unit) || deriveLegacyUnit({ packSize });

    const updatedAt = safeStr(it.updatedAt) || audit.updatedAt || now;

    return {
      articleNo,
      packSize,
      supplier,
      category,
      pricePerKg,
      minLevel,
      tempClass,
      requiresExpiry,
      isActive,
      audit,

      // legacy extras used by baseline render/dashboard
      sku: articleNo,
      name: legacyName,
      unit: legacyUnit,
      onHand: safeNum(it.onHand, 0),
      min: minLevel,
      updatedAt
    };
  }

  function normalizeItemAny(it) {
    if (!it || typeof it !== "object") return null;

    // New shape first
    const aNo = safeStr(it.articleNo);
    if (aNo) return normalizeItemNew(it);

    // Legacy shape
    const sku = safeStr(it.sku);
    const name = safeStr(it.name);
    if (!sku || !name) return null;

    const now = nowIso();
    const actor = "migrate";

    const mapped = {
      articleNo: sku,
      packSize: "",
      supplier: "",
      category: "",
      pricePerKg: 0,
      minLevel: safeInt(it.min, 0),
      tempClass: "FROZEN",
      requiresExpiry: false,
      isActive: true,
      audit: {
        createdAt: now,
        updatedAt: now,
        createdBy: actor,
        updatedBy: actor
      },

      // keep legacy extras
      sku,
      name,
      unit: safeStr(it.unit) || "—",
      onHand: safeNum(it.onHand, 0),
      min: safeInt(it.min, 0),
      updatedAt: typeof it.updatedAt === "string" ? it.updatedAt : now
    };

    return normalizeItemNew(mapped);
  }

  function validateNewItem(input) {
    const x = input && typeof input === "object" ? input : null;
    if (!x) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "Ogiltigt input." };

    const articleNo = normalizeArticleNo(x.articleNo);
    if (!articleNo) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "articleNo krävs (A–Z 0–9 - _)." };

    const packSize = safeStr(x.packSize);
    const supplier = safeStr(x.supplier);
    const category = safeStr(x.category);

    // Fail-closed enligt baseline: supplier + category krävs
    if (!supplier) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "supplier krävs." };
    if (!category) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "category krävs." };

    const pricePerKg = safeNum(x.pricePerKg, NaN);
    if (!Number.isFinite(pricePerKg) || pricePerKg < 0) {
      return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "pricePerKg måste vara ett tal ≥ 0." };
    }

    const minLevel = safeInt(x.minLevel, NaN);
    if (!Number.isFinite(minLevel) || minLevel < 0) {
      return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "minLevel måste vara ett heltal ≥ 0." };
    }

    const tempClass = normalizeTempClass(x.tempClass);
    if (!tempClass) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "tempClass måste vara FROZEN/CHILLED/AMBIENT." };

    const requiresExpiry = !!x.requiresExpiry;
    const isActive = ("isActive" in x) ? !!x.isActive : true;

    return {
      ok: true,
      item: { articleNo, packSize, supplier, category, pricePerKg, minLevel, tempClass, requiresExpiry, isActive }
    };
  }

  /* -----------------------------
    BLOCK 5/6 — Root validate + normalize (storage shape)
  ----------------------------- */
  function validateAndNormalize(obj, deps) {
    // deps: { makeId(prefix) } injected från store
    const makeId = deps && typeof deps.makeId === "function" ? deps.makeId : (() => "");

    if (!obj || typeof obj !== "object") {
      return { ok: false, reason: "Ogiltig root.", errorCode: FRZ_ERR.INVALID_ROOT };
    }

    const meta = obj.meta;
    const user = obj.user;
    const data = obj.data;
    const flags = obj.flags;

    if (!meta || typeof meta !== "object") return { ok: false, reason: "Saknar meta.", errorCode: FRZ_ERR.INVALID_SHAPE };
    if (meta.schemaVersion !== FRZ_SCHEMA_VERSION) return { ok: false, reason: "Fel schemaVersion.", errorCode: FRZ_ERR.INVALID_SCHEMA };

    if (!user || typeof user !== "object") return { ok: false, reason: "Saknar user.", errorCode: FRZ_ERR.INVALID_SHAPE };
    const role = user.role;
    if (!isValidRole(role)) return { ok: false, reason: "Ogiltig roll i lagring.", errorCode: FRZ_ERR.INVALID_ROLE };

    if (!data || typeof data !== "object") return { ok: false, reason: "Saknar data.", errorCode: FRZ_ERR.INVALID_SHAPE };
    if (!Array.isArray(data.items)) return { ok: false, reason: "items måste vara array.", errorCode: FRZ_ERR.INVALID_SHAPE };
    if (!Array.isArray(data.history)) return { ok: false, reason: "history måste vara array.", errorCode: FRZ_ERR.INVALID_SHAPE };

    const norm = {
      meta: {
        schemaVersion: FRZ_SCHEMA_VERSION,
        createdAt: typeof meta.createdAt === "string" ? meta.createdAt : nowIso(),
        updatedAt: typeof meta.updatedAt === "string" ? meta.updatedAt : nowIso()
      },
      user: {
        role,
        activeUserId: (user && typeof user.activeUserId === "string") ? user.activeUserId : ""
      },
      flags: {
        locked: !!(flags && flags.locked),
        lockReason: (flags && typeof flags.lockReason === "string") ? flags.lockReason : "",
        lockCode: (flags && typeof flags.lockCode === "string") ? flags.lockCode : "",
        // computeReadOnly i store; här bara normaliserar vi boolean om den finns
        readOnly: !!(flags && flags.readOnly)
      },
      data: {
        items: data.items.map(normalizeItemAny).filter(Boolean),
        history: data.history.map(normalizeHistory).filter(Boolean),
        users: Array.isArray(data.users) ? data.users.map(normalizeUser).filter(Boolean) : []
      }
    };

    // Fill missing ids for users if empty (refactor-only, men bättre att vara stabil)
    if (Array.isArray(norm.data.users)) {
      norm.data.users = norm.data.users.map(u => {
        if (!u) return null;
        if (!safeStr(u.id)) u.id = makeId("u");
        return u;
      }).filter(Boolean);
    }

    // Ensure users exist (back-compat)
    if (!Array.isArray(norm.data.users) || norm.data.users.length === 0) {
      norm.data.users = createDefaultUsers(makeId);
    }

    // Locked => readOnly true + lockCode fallback
    if (norm.flags.locked) {
      norm.flags.readOnly = true;
      if (!norm.flags.lockCode) norm.flags.lockCode = FRZ_ERR.INVALID_SHAPE;
    }

    // Ensure items array exists even if all invalid
    if (!Array.isArray(norm.data.items)) norm.data.items = [];

    // Ensure at least one active user
    if (!norm.data.users.some(u => u && u.active)) {
      norm.data.users[0].active = true;
    }

    // Ensure activeUserId points to an active user (store har logik för roll-match; här gör vi minimal)
    const active = norm.data.users.find(u => u && u.active) || null;
    norm.user.activeUserId = active && active.id ? active.id : "";

    return { ok: true, state: norm, errorCode: FRZ_ERR.NONE };
  }

  /* -----------------------------
    BLOCK 6/6 — Export
  ----------------------------- */
  window.FreezerContract = {
    version: "AO-REFAC-STORE-SPLIT-01:04-contract@1",

    // constants
    FRZ_STORAGE_KEY,
    FRZ_SCHEMA_VERSION,
    FRZ_ROLES,
    FRZ_PERMS,
    FRZ_STATUS,
    FRZ_ERR,
    FRZ_TEMP_CLASSES,

    // guards
    isValidRole,
    isValidPermKey,
    normalizeTempClass,

    // users/history
    normNameKey,
    normalizePerms,
    normalizeUser,
    normalizeHistory,
    createDefaultUsers,

    // items
    normalizeItemAny,
    normalizeItemNew,
    validateNewItem,
    normalizeArticleNo,
    deriveLegacyName,
    deriveLegacyUnit,
    normKey,

    // root validate/normalize
    validateAndNormalize
  };
})();

