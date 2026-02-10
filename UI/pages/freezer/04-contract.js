/* ============================================================
AO-REFAC-STORE-SPLIT-01 (PROD) | FIL: UI/pages/freezer/04-contract.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte (KRAV 4):
- Contract/schema + validate/normalize
- Constants: roles/perms/status/err/tempClass/schemaVersion
- Refactor-only: ingen funktionsförändring

Policy:
- Inga storage-keys här (store äger STORAGE)
- Store ska inte rendera (contract renderar inte heller)

Taggar:
- GUARD / STORAGE / RBAC / FLOW / DEBUG
============================================================ */

(function () {
  "use strict";

  if (!window.FreezerCore) {
    // Fail-closed: Contract kräver core först (KRAV 5 import-ordning)
    window.FreezerContract = window.FreezerContract || {
      version: "AO-REFAC-STORE-SPLIT-01:04-contract@1",
      ok: false,
      reason: "FreezerCore saknas (import-ordning fel)."
    };
    return;
  }

  // Version-guard (stabil hook)
  if (window.FreezerContract && window.FreezerContract.version === "AO-REFAC-STORE-SPLIT-01:04-contract@1") return;

  const C = window.FreezerCore;

  /* -----------------------------
    BLOCK 1/10 — Constants (schema + enums)
  ----------------------------- */
  const FRZ_SCHEMA_VERSION = 1;

  const FRZ_ROLES = /** @type {const} */ (["ADMIN", "BUYER", "PICKER", "SYSTEM_ADMIN"]);
  function isValidRole(v) { return FRZ_ROLES.includes(v); }

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

  const FRZ_PERMS = /** @type {const} */ ([
    "users_manage",
    "inventory_write",
    "history_write",
    "dashboard_view"
  ]);
  function isValidPermKey(k) { return FRZ_PERMS.includes(k); }

  const FRZ_TEMP_CLASSES = /** @type {const} */ (["FROZEN", "CHILLED", "AMBIENT"]);

  /* -----------------------------
    BLOCK 2/10 — ReadOnly policy
  ----------------------------- */
  function computeReadOnly(role) {
    return role === "SYSTEM_ADMIN";
  }

  /* -----------------------------
    BLOCK 3/10 — Permissions normalize
  ----------------------------- */
  function normalizePerms(perms) {
    // Match baseline: dashboard_view default true, others default false
    const out = { users_manage: false, inventory_write: false, history_write: false, dashboard_view: true };
    const p = (perms && typeof perms === "object") ? perms : {};
    FRZ_PERMS.forEach(k => {
      if (k === "dashboard_view") out[k] = ("dashboard_view" in p) ? !!p[k] : true;
      else out[k] = !!p[k];
    });
    return out;
  }

  /* -----------------------------
    BLOCK 4/10 — Users normalize + defaults
  ----------------------------- */
  function normalizeUser(u) {
    if (!u || typeof u !== "object") return null;

    const id = C.safeStr(u.id) || C.makeId("u");
    const firstName = C.safeUserName(u.firstName);
    if (!firstName) return null;

    const active = ("active" in u) ? !!u.active : true;

    const auditIn = (u.audit && typeof u.audit === "object") ? u.audit : {};
    const now = C.nowIso();

    // Optional internal mapping helper
    const roleKey = isValidRole(u.roleKey) ? u.roleKey
      : (isValidRole(u.role) ? u.role : (C.safeStr(u.roleKey) || ""));

    return {
      id,
      firstName,
      active,
      roleKey,
      perms: normalizePerms(u.perms),
      audit: {
        createdAt: (typeof auditIn.createdAt === "string") ? auditIn.createdAt : now,
        updatedAt: (typeof auditIn.updatedAt === "string") ? auditIn.updatedAt : now,
        createdBy: C.safeStr(auditIn.createdBy) || "",
        updatedBy: C.safeStr(auditIn.updatedBy) || ""
      }
    };
  }

  function createDefaultUsers() {
    const now = C.nowIso();
    return [
      {
        id: C.makeId("u"),
        firstName: "Admin",
        active: true,
        roleKey: "ADMIN",
        perms: { users_manage: true, inventory_write: true, history_write: true, dashboard_view: true },
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
      },
      {
        id: C.makeId("u"),
        firstName: "Inköp",
        active: true,
        roleKey: "BUYER",
        perms: { users_manage: false, inventory_write: true, history_write: false, dashboard_view: true },
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
      },
      {
        id: C.makeId("u"),
        firstName: "Plock",
        active: true,
        roleKey: "PICKER",
        // AUTOPATCH: synk mot store (PICKER = history_write, inte inventory_write)
        perms: { users_manage: false, inventory_write: false, history_write: true, dashboard_view: true },
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
      },
      {
        id: C.makeId("u"),
        firstName: "System",
        active: true,
        roleKey: "SYSTEM_ADMIN",
        perms: { users_manage: false, inventory_write: false, history_write: false, dashboard_view: true },
        audit: { createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }
      }
    ];
  }

  /* -----------------------------
    BLOCK 5/10 — Items normalize (legacy + new)
  ----------------------------- */

  // NOTE (GUARD): Core har normKey/safeStr, men normalizeArticleNo kan saknas.
  // Vi håller detta helt lokalt för att inte krascha vid refactor-split.
  function normalizeArticleNo(v) {
    const raw = C.safeStr(v).trim();
    if (!raw) return "";
    // Tillåt A–Z 0–9 - _ (uppercase)
    const up = raw.toUpperCase();
    if (!/^[A-Z0-9\-_]+$/.test(up)) return "";
    return up;
  }

  function normalizeTempClass(v) {
    const s = C.safeStr(v).toUpperCase();
    if (FRZ_TEMP_CLASSES.includes(s)) return s;
    // default (fail-soft) for legacy
    if (!s) return "FROZEN";
    return "";
  }

  function deriveLegacyName(it) {
    const sup = C.safeStr(it && it.supplier);
    const cat = C.safeStr(it && it.category);
    const ps = C.safeStr(it && it.packSize);
    const parts = [];
    if (sup) parts.push(sup);
    if (cat) parts.push(cat);
    if (ps) parts.push(ps);
    return parts.length ? parts.join(" • ") : "—";
  }

  function deriveLegacyUnit(it) {
    const ps = C.safeStr(it && it.packSize);
    if (!ps) return "—";
    return "fp";
  }

  function normalizeItemNew(it) {
    const articleNo = normalizeArticleNo(it && it.articleNo);
    if (!articleNo) return null;

    const packSize = C.safeStr(it.packSize);
    const supplier = C.safeStr(it.supplier);
    const category = C.safeStr(it.category);

    const pricePerKg = C.safeNum(it.pricePerKg, 0);
    const minLevel = C.safeInt(it.minLevel, 0);

    const tempClass = normalizeTempClass(it.tempClass);
    const requiresExpiry = !!it.requiresExpiry;
    const isActive = ("isActive" in it) ? !!it.isActive : true;

    const auditIn = (it.audit && typeof it.audit === "object") ? it.audit : {};
    const now = C.nowIso();

    const audit = {
      createdAt: (typeof auditIn.createdAt === "string") ? auditIn.createdAt : now,
      updatedAt: (typeof auditIn.updatedAt === "string") ? auditIn.updatedAt : now,
      createdBy: C.safeStr(auditIn.createdBy) || "",
      updatedBy: C.safeStr(auditIn.updatedBy) || ""
    };

    // Back-compat extras (if already present, keep; else derive)
    const legacyName = C.safeStr(it.name) || deriveLegacyName({ supplier, category, packSize });
    const legacyUnit = C.safeStr(it.unit) || deriveLegacyUnit({ packSize });
    const updatedAt = C.safeStr(it.updatedAt) || audit.updatedAt || now;

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
      onHand: C.safeNum(it.onHand, 0),
      min: minLevel,
      updatedAt
    };
  }

  function normalizeItemAny(it) {
    // Accept legacy: { sku,name,unit,onHand,min,updatedAt }
    // Accept new: { articleNo, packSize, supplier, category, pricePerKg, minLevel, tempClass, requiresExpiry, isActive, audit }
    if (!it || typeof it !== "object") return null;

    // New shape first
    const aNo = normalizeArticleNo(it.articleNo);
    if (aNo) return normalizeItemNew(Object.assign({}, it, { articleNo: aNo }));

    // Legacy shape
    const sku = normalizeArticleNo(it.sku);
    const name = C.safeStr(it.name);
    if (!sku || !name) return null;

    const now = C.nowIso();
    const actor = "migrate";

    // Map minimal legacy -> contract fields
    const mapped = {
      articleNo: sku,
      packSize: "",
      supplier: "",
      category: "",
      pricePerKg: 0,
      minLevel: C.safeInt(it.min, 0),
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
      unit: C.safeStr(it.unit) || "—",
      onHand: C.safeNum(it.onHand, 0),
      min: C.safeInt(it.min, 0),
      updatedAt: (typeof it.updatedAt === "string") ? it.updatedAt : now
    };

    return normalizeItemNew(mapped);
  }

  /* -----------------------------
    BLOCK 6/10 — Item validator (create/update)
  ----------------------------- */
  function validateNewItem(input) {
    const x = (input && typeof input === "object") ? input : null;
    if (!x) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "Ogiltigt input." };

    const articleNo = normalizeArticleNo(x.articleNo);
    if (!articleNo) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "articleNo krävs (A–Z 0–9 - _)." };

    const packSize = C.safeStr(x.packSize);
    const supplier = C.safeStr(x.supplier);
    const category = C.safeStr(x.category);

    // Fail-closed: kräver minst supplier+category (packSize får vara tomt)
    if (!supplier) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "supplier krävs." };
    if (!category) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "category krävs." };

    const pricePerKg = C.safeNum(x.pricePerKg, NaN);
    if (!Number.isFinite(pricePerKg) || pricePerKg < 0) {
      return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "pricePerKg måste vara ett tal ≥ 0." };
    }

    const minLevel = C.safeInt(x.minLevel, NaN);
    if (!Number.isFinite(minLevel) || minLevel < 0) {
      return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "minLevel måste vara ett heltal ≥ 0." };
    }

    const tempClass = normalizeTempClass(x.tempClass);
    if (!tempClass) return { ok: false, errorCode: FRZ_ERR.ITEM_INVALID, reason: "tempClass måste vara FROZEN/CHILLED/AMBIENT." };

    const requiresExpiry = !!x.requiresExpiry;
    const isActive = ("isActive" in x) ? !!x.isActive : true;

    return {
      ok: true,
      item: {
        articleNo,
        packSize,
        supplier,
        category,
        pricePerKg,
        minLevel,
        tempClass,
        requiresExpiry,
        isActive
      }
    };
  }

  /* -----------------------------
    BLOCK 7/10 — History normalize
  ----------------------------- */
  function normalizeHistory(h) {
    if (!h || typeof h !== "object") return null;
    const ts = (typeof h.ts === "string") ? h.ts : C.nowIso();
    const type = C.safeStr(h.type) || "note";
    const sku = C.safeStr(h.sku) || "";
    const qty = C.safeNum(h.qty, 0);
    const by = C.safeStr(h.by) || "";
    const note = C.safeStr(h.note) || "";
    return { ts, type, sku, qty, by, note };
  }

  /* -----------------------------
    BLOCK 8/10 — validate + normalize whole state
  ----------------------------- */
  function pickActiveUserForRole(role, users) {
    const list = Array.isArray(users) ? users : [];

    // Preferred mapping by roleKey on user (if present)
    const byRole = list.find(u => u && u.active && u.roleKey === role);
    if (byRole && byRole.id) return byRole.id;

    // Fallback: admin-named user for ADMIN
    if (role === "ADMIN") {
      const admin = list.find(u => u && u.active && (u.roleKey === "ADMIN" || String(u.firstName || "").toLowerCase() === "admin"));
      if (admin && admin.id) return admin.id;
    }

    // Fallback: any active user
    const any = list.find(u => u && u.active);
    return any && any.id ? any.id : "";
  }

  function validateAndNormalize(obj) {
    // Strict-ish validation to detect corruption
    if (!obj || typeof obj !== "object") return { ok: false, reason: "Ogiltig root.", errorCode: FRZ_ERR.INVALID_ROOT };

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

    const now = C.nowIso();

    // flags may be missing -> normalize (back-compat + AO-02 lockCode)
    const norm = {
      meta: {
        schemaVersion: FRZ_SCHEMA_VERSION,
        createdAt: (typeof meta.createdAt === "string") ? meta.createdAt : now,
        updatedAt: (typeof meta.updatedAt === "string") ? meta.updatedAt : now
      },
      user: {
        role,
        activeUserId: (user && typeof user.activeUserId === "string") ? user.activeUserId : ""
      },
      flags: {
        locked: !!(flags && flags.locked),
        lockReason: (flags && typeof flags.lockReason === "string") ? flags.lockReason : "",
        lockCode: (flags && typeof flags.lockCode === "string") ? flags.lockCode : "",
        readOnly: computeReadOnly(role)
      },
      data: {
        items: data.items.map(normalizeItemAny).filter(Boolean),
        history: data.history.map(normalizeHistory).filter(Boolean),
        users: Array.isArray(data.users) ? data.users.map(normalizeUser).filter(Boolean) : []
      }
    };

    // If storage says locked, keep it locked
    if (norm.flags.locked) {
      norm.flags.readOnly = true;
      if (!norm.flags.lockCode) norm.flags.lockCode = FRZ_ERR.INVALID_SHAPE;
    }

    // Ensure users exist even for older saves
    if (!Array.isArray(norm.data.users) || norm.data.users.length === 0) {
      norm.data.users = createDefaultUsers();
    }

    // Ensure items array exists
    if (!Array.isArray(norm.data.items)) norm.data.items = [];

    // Ensure there is at least one active user
    if (!norm.data.users.some(u => u && u.active)) {
      norm.data.users[0].active = true;
    }

    // Ensure activeUserId points to active user
    norm.user.activeUserId = pickActiveUserForRole(norm.user.role, norm.data.users);

    return { ok: true, state: norm, errorCode: FRZ_ERR.NONE };
  }

  /* -----------------------------
    BLOCK 9/10 — Misc helpers for store
  ----------------------------- */
  function isUserNameUnique(firstName, excludeId, users) {
    const nameKey = C.normNameKey(firstName);
    const list = Array.isArray(users) ? users : [];
    return !list.some(u => {
      if (!u || !u.firstName) return false;
      if (excludeId && u.id === excludeId) return false;
      return C.normNameKey(u.firstName) === nameKey;
    });
  }

  function isArticleNoUnique(articleNo, excludeArticleNo, items) {
    const key = C.normKey(articleNo);
    const list = Array.isArray(items) ? items : [];
    return !list.some(it => {
      if (!it) return false;
      const a = C.normKey(it.articleNo || it.sku);
      if (!a) return false;
      if (excludeArticleNo && C.normKey(excludeArticleNo) === a) return false;
      return a === key;
    });
  }

  /* -----------------------------
    BLOCK 10/10 — Export
  ----------------------------- */
  window.FreezerContract = {
    version: "AO-REFAC-STORE-SPLIT-01:04-contract@1",
    ok: true,

    // schema/const
    FRZ_SCHEMA_VERSION,
    FRZ_ROLES,
    FRZ_STATUS,
    FRZ_ERR,
    FRZ_PERMS,
    FRZ_TEMP_CLASSES,

    // validators / policy
    computeReadOnly,
    isValidRole,
    isValidPermKey,

    // users
    normalizePerms,
    normalizeUser,
    createDefaultUsers,
    pickActiveUserForRole,
    isUserNameUnique,

    // items
    normalizeTempClass,
    deriveLegacyName,
    deriveLegacyUnit,
    normalizeItemAny,
    normalizeItemNew,
    validateNewItem,
    isArticleNoUnique,

    // history
    normalizeHistory,

    // state validation
    validateAndNormalize
  };
})();
