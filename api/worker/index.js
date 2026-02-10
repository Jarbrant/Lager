/**
 * ============================================================
 * AO-SEC-01A/01B/01C — API Worker baseline (Auth + RBAC + Audit)
 * FIL: api/worker/index.js
 * Projekt: Freezer (UI GitHub Pages -> API/Worker)
 *
 * Mål:
 * - Cookie-session (HttpOnly) + /auth/me
 * - RBAC på server (UI är bara presentation)
 * - CSRF-skydd för write (X-CSRF header)
 * - requestId på allt + standardiserade felkoder
 * - Rate limit (enkel demo via KV)
 * - Audit log (demo via KV)
 *
 * Policy:
 * - No PII i loggar/audit (använd userId, role, ids)
 * - Fail-closed: saknad/korrupt session => 401
 * ============================================================
 */

export default {
  async fetch(request, env, ctx) {
    const requestId = cryptoRandomId();
    const url = new URL(request.url);

    // ---- CORS (hard allowlist) ----
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = String(env.ALLOWED_ORIGIN || "").trim();

    // Always handle OPTIONS for preflight
    if (request.method === "OPTIONS") {
      return corsPreflightResponse(origin, allowedOrigin);
    }

    // Block cross-origin if origin exists and isn't allowed
    if (origin && allowedOrigin && origin !== allowedOrigin) {
      return jsonError(403, "CORS_DENY", "Origin not allowed.", requestId, origin, allowedOrigin);
    }

    // ---- Routing ----
    try {
      // Health (no auth)
      if (request.method === "GET" && url.pathname === "/health") {
        return withCors(jsonOk({ ok: true, service: "freezer-api", requestId }), origin, allowedOrigin);
      }

      // Auth routes (no existing auth required except logout/me)
      if (url.pathname === "/auth/login" && request.method === "POST") {
        return withCors(await handleLogin(request, env, requestId), origin, allowedOrigin);
      }
      if (url.pathname === "/auth/logout" && request.method === "POST") {
        return withCors(await handleLogout(env, requestId), origin, allowedOrigin);
      }
      if (url.pathname === "/auth/me" && request.method === "GET") {
        return withCors(await handleMe(request, env, requestId), origin, allowedOrigin);
      }

      // ---- Protected API ----
      const session = await requireSession(request, env, requestId);
      // session: { userId, role, perms[], csrf, exp }

      // Audit list (ADMIN)
      if (url.pathname === "/audit" && request.method === "GET") {
        requirePerm(session, "audit_read");
        const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);
        const events = await readAudit(env, limit);
        return withCors(jsonOk({ ok: true, requestId, events }), origin, allowedOrigin);
      }

      // Users (ADMIN)
      if (url.pathname === "/users" && request.method === "GET") {
        requirePerm(session, "users_manage");
        const users = await kvGetJson(env, "users:v1", defaultUsers());
        // No PII: users here are demo safe (id, role, active, name)
        return withCors(jsonOk({ ok: true, requestId, users }), origin, allowedOrigin);
      }
      if (url.pathname === "/users" && request.method === "POST") {
        await requireCsrf(request, session, requestId);
        await rateLimit(env, request, "users_write", requestId, 20, 60);
        requirePerm(session, "users_manage");

        const body = await readJson(request, requestId);
        const userId = safeId(body.userId);
        const role = safeRole(body.role);
        const name = safeShortText(body.name, 50);
        if (!userId || !role || !name) return jsonError(400, "VALIDATION_FAIL", "userId/role/name krävs.", requestId);

        const users = await kvGetJson(env, "users:v1", defaultUsers());
        if (users.some(u => u.id === userId)) return jsonError(409, "USER_EXISTS", "Användare finns redan.", requestId);

        users.push({ id: userId, role, name, active: true });
        await env.FREEZER_KV.put("users:v1", JSON.stringify(users));

        await writeAudit(env, {
          type: "USER_CREATE",
          actorUserId: session.userId,
          actorRole: session.role,
          targetId: userId,
          meta: { role }
        });

        return withCors(jsonOk({ ok: true, requestId, users }), origin, allowedOrigin);
      }
      if (url.pathname.startsWith("/users/") && request.method === "PATCH") {
        await requireCsrf(request, session, requestId);
        await rateLimit(env, request, "users_write", requestId, 30, 60);
        requirePerm(session, "users_manage");

        const targetId = safeId(url.pathname.split("/")[2] || "");
        if (!targetId) return jsonError(400, "VALIDATION_FAIL", "Bad user id.", requestId);

        const body = await readJson(request, requestId);
        const patchRole = body.role != null ? safeRole(body.role) : null;
        const patchActive = body.active != null ? !!body.active : null;
        const patchName = body.name != null ? safeShortText(body.name, 50) : null;

        const users = await kvGetJson(env, "users:v1", defaultUsers());
        const idx = users.findIndex(u => u.id === targetId);
        if (idx < 0) return jsonError(404, "NOT_FOUND", "User not found.", requestId);

        if (patchRole) users[idx].role = patchRole;
        if (patchName) users[idx].name = patchName;
        if (patchActive != null) users[idx].active = patchActive;

        await env.FREEZER_KV.put("users:v1", JSON.stringify(users));

        await writeAudit(env, {
          type: "USER_UPDATE",
          actorUserId: session.userId,
          actorRole: session.role,
          targetId,
          meta: { role: patchRole || undefined, active: patchActive != null ? patchActive : undefined }
        });

        return withCors(jsonOk({ ok: true, requestId, users }), origin, allowedOrigin);
      }

      // Items
      if (url.pathname === "/items" && request.method === "GET") {
        requirePerm(session, "items_read");
        const items = await kvGetJson(env, "items:v1", []);
        return withCors(jsonOk({ ok: true, requestId, items }), origin, allowedOrigin);
      }
      if (url.pathname === "/items" && request.method === "POST") {
        await requireCsrf(request, session, requestId);
        await rateLimit(env, request, "items_write", requestId, 60, 60);
        requirePerm(session, "items_write");

        const body = await readJson(request, requestId);
        const id = safeId(body.id);
        const label = safeShortText(body.label, 80);
        if (!id || !label) return jsonError(400, "VALIDATION_FAIL", "id/label krävs.", requestId);

        const items = await kvGetJson(env, "items:v1", []);
        if (items.some(it => it.id === id)) return jsonError(409, "ITEM_EXISTS", "Artikel finns redan.", requestId);

        items.push({ id, label, active: true });
        await env.FREEZER_KV.put("items:v1", JSON.stringify(items));

        await writeAudit(env, {
          type: "ITEM_CREATE",
          actorUserId: session.userId,
          actorRole: session.role,
          targetId: id
        });

        return withCors(jsonOk({ ok: true, requestId, items }), origin, allowedOrigin);
      }
      if (url.pathname.startsWith("/items/") && request.method === "PATCH") {
        await requireCsrf(request, session, requestId);
        await rateLimit(env, request, "items_write", requestId, 80, 60);
        requirePerm(session, "items_write");

        const id = safeId(url.pathname.split("/")[2] || "");
        if (!id) return jsonError(400, "VALIDATION_FAIL", "Bad item id.", requestId);

        const body = await readJson(request, requestId);
        const patchLabel = body.label != null ? safeShortText(body.label, 80) : null;
        const patchActive = body.active != null ? !!body.active : null;

        const items = await kvGetJson(env, "items:v1", []);
        const idx = items.findIndex(it => it.id === id);
        if (idx < 0) return jsonError(404, "NOT_FOUND", "Item not found.", requestId);

        if (patchLabel) items[idx].label = patchLabel;
        if (patchActive != null) items[idx].active = patchActive;

        await env.FREEZER_KV.put("items:v1", JSON.stringify(items));

        await writeAudit(env, {
          type: "ITEM_UPDATE",
          actorUserId: session.userId,
          actorRole: session.role,
          targetId: id
        });

        return withCors(jsonOk({ ok: true, requestId, items }), origin, allowedOrigin);
      }

      // Moves
      if (url.pathname === "/moves" && request.method === "GET") {
        requirePerm(session, "moves_read");
        const moves = await kvGetJson(env, "moves:v1", []);
        // Optional filters
        const type = (url.searchParams.get("type") || "").toUpperCase();
        const itemId = safeId(url.searchParams.get("itemId") || "");
        const from = parseDateMs(url.searchParams.get("from"));
        const to = parseDateMs(url.searchParams.get("to"));

        let out = moves;
        if (type === "IN" || type === "OUT") out = out.filter(m => String(m.type).toUpperCase() === type);
        if (itemId) out = out.filter(m => m.itemId === itemId);
        if (from) out = out.filter(m => Number(m.ts) >= from);
        if (to) out = out.filter(m => Number(m.ts) <= to);

        return withCors(jsonOk({ ok: true, requestId, moves: out }), origin, allowedOrigin);
      }
      if (url.pathname === "/moves" && request.method === "POST") {
        await requireCsrf(request, session, requestId);
        await rateLimit(env, request, "moves_write", requestId, 120, 60);
        requirePerm(session, "moves_write");

        const body = await readJson(request, requestId);
        const type = (String(body.type || "").toUpperCase().trim());
        const itemId = safeId(body.itemId);
        const qty = clampInt(body.qty, 1, 100000, null);

        if (!(type === "IN" || type === "OUT")) return jsonError(400, "VALIDATION_FAIL", "type måste vara IN/OUT.", requestId);
        if (!itemId || qty == null) return jsonError(400, "VALIDATION_FAIL", "itemId/qty krävs.", requestId);

        // Role intent (demo): BUYER should primarily do IN; PICKER primarily OUT
        if (session.role === "BUYER" && type === "OUT") return jsonError(403, "RBAC_DENY", "BUYER får inte registrera OUT.", requestId);
        if (session.role === "PICKER" && type === "IN") return jsonError(403, "RBAC_DENY", "PICKER får inte registrera IN.", requestId);

        const moves = await kvGetJson(env, "moves:v1", []);
        const id = cryptoRandomId();
        const ts = Date.now();

        moves.push({ id, ts, type, itemId, qty, actorUserId: session.userId });
        await env.FREEZER_KV.put("moves:v1", JSON.stringify(moves));

        await writeAudit(env, {
          type: "MOVE_CREATE",
          actorUserId: session.userId,
          actorRole: session.role,
          targetId: id,
          meta: { type, itemId, qty }
        });

        return withCors(jsonOk({ ok: true, requestId, id }), origin, allowedOrigin);
      }

      return withCors(jsonError(404, "NOT_FOUND", "No route.", requestId), origin, allowedOrigin);
    } catch (err) {
      const e = normalizeErr(err);
      // Operativ logg (utan PII)
      console.log(JSON.stringify({ lvl: "error", requestId, code: e.code, msg: e.message }));
      return withCors(jsonError(e.status, e.code, e.message, requestId), origin, allowedOrigin);
    }
  }
};

/* ================================
   Auth / Session (Cookie)
================================ */

const COOKIE_NAME = "FRZ_SESS";

async function handleLogin(request, env, requestId) {
  await rateLimit(env, request, "login", requestId, 10, 60);

  const body = await readJson(request, requestId);
  const username = safeShortText(body.username, 50);
  const password = safeShortText(body.password, 200);

  const demoUser = String(env.DEMO_ADMIN_USER || "admin");
  const demoPass = String(env.DEMO_ADMIN_PASS || "change-me-now");

  // Demo auth: only one admin login
  if (username !== demoUser || password !== demoPass) {
    return jsonError(401, "AUTH_FAIL", "Fel användarnamn eller lösenord.", requestId);
  }

  // Create session (short-lived demo)
  const exp = Date.now() + 8 * 60 * 60 * 1000; // 8h
  const csrf = cryptoRandomId();
  const session = {
    userId: "admin",
    role: "ADMIN",
    perms: permsForRole("ADMIN"),
    csrf,
    exp
  };

  const token = await signSession(session, env.SESSION_SECRET);
  const cookie = buildSessionCookie(token);

  // Audit
  await writeAudit(env, { type: "LOGIN", actorUserId: "admin", actorRole: "ADMIN" });

  return new Response(JSON.stringify({
    ok: true,
    requestId,
    user: { userId: session.userId, role: session.role, perms: session.perms, csrfToken: csrf }
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
      "X-Request-Id": requestId
    }
  });
}

async function handleLogout(env, requestId) {
  const cookie = clearSessionCookie();
  return new Response(JSON.stringify({ ok: true, requestId }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Set-Cookie": cookie,
      "X-Request-Id": requestId
    }
  });
}

async function handleMe(request, env, requestId) {
  const session = await requireSession(request, env, requestId);
  return jsonOk({
    ok: true,
    requestId,
    user: {
      userId: session.userId,
      role: session.role,
      perms: session.perms,
      csrfToken: session.csrf,
      exp: session.exp
    }
  });
}

async function requireSession(request, env, requestId) {
  const cookie = request.headers.get("Cookie") || "";
  const token = readCookie(cookie, COOKIE_NAME);
  if (!token) throw httpErr(401, "NO_SESSION", "Ingen session. Logga in igen.");

  const session = await verifySession(token, env.SESSION_SECRET);
  if (!session) throw httpErr(401, "BAD_SESSION", "Ogiltig session. Logga in igen.");
  if (session.exp && Date.now() > session.exp) throw httpErr(401, "AUTH_EXPIRED", "Sessionen har gått ut. Logga in igen.");

  // Ensure role/perms canonical
  session.role = safeRole(session.role) || "EMPLOYEE";
  session.perms = Array.isArray(session.perms) ? session.perms : permsForRole(session.role);

  return session;
}

async function requireCsrf(request, session, requestId) {
  const hdr = request.headers.get("X-CSRF") || "";
  if (!hdr || hdr !== session.csrf) {
    throw httpErr(403, "CSRF_FAIL", "Saknar eller fel X-CSRF-token.");
  }
}

/* ================================
   RBAC
================================ */

function permsForRole(role) {
  const r = String(role || "").toUpperCase();
  if (r === "ADMIN") return ["audit_read", "users_manage", "items_read", "items_write", "moves_read", "moves_write"];
  if (r === "BUYER") return ["items_read", "moves_read", "moves_write"]; // IN via move check
  if (r === "PICKER") return ["items_read", "moves_read", "moves_write"]; // OUT via move check
  return ["items_read", "moves_read"];
}

function requirePerm(session, perm) {
  const list = Array.isArray(session.perms) ? session.perms : [];
  if (!list.includes(perm)) throw httpErr(403, "RBAC_DENY", "Saknar behörighet.");
}

/* ================================
   Audit log (KV)
================================ */

async function writeAudit(env, evt) {
  try {
    const now = Date.now();
    const item = {
      id: cryptoRandomId(),
      ts: now,
      type: String(evt.type || "EVENT"),
      actorUserId: String(evt.actorUserId || "—"),
      actorRole: String(evt.actorRole || "—"),
      targetId: evt.targetId ? String(evt.targetId) : undefined,
      meta: evt.meta ? sanitizeMeta(evt.meta) : undefined
    };

    // store as rolling list
    const key = "audit:v1";
    const existing = await kvGetJson(env, key, []);
    existing.unshift(item);
    const capped = existing.slice(0, 500);
    await env.FREEZER_KV.put(key, JSON.stringify(capped));
  } catch {
    // fail-soft: audit får inte krascha API
  }
}

async function readAudit(env, limit) {
  const list = await kvGetJson(env, "audit:v1", []);
  return list.slice(0, limit);
}

function sanitizeMeta(meta) {
  // no PII: keep only primitives + short strings
  const out = {};
  for (const [k, v] of Object.entries(meta || {})) {
    if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "string") out[k] = safeShortText(v, 120);
  }
  return out;
}

/* ================================
   Rate limit (KV demo)
================================ */

async function rateLimit(env, request, bucket, requestId, maxHits, windowSec) {
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "0.0.0.0";
  const key = `rl:${bucket}:${ip}`;
  const now = Date.now();
  const windowMs = windowSec * 1000;

  const obj = await kvGetJson(env, key, { ts: now, n: 0 });
  if (typeof obj.ts !== "number" || typeof obj.n !== "number") {
    await env.FREEZER_KV.put(key, JSON.stringify({ ts: now, n: 1 }), { expirationTtl: windowSec });
    return;
  }

  // reset if window passed
  if (now - obj.ts > windowMs) {
    await env.FREEZER_KV.put(key, JSON.stringify({ ts: now, n: 1 }), { expirationTtl: windowSec });
    return;
  }

  if (obj.n >= maxHits) {
    throw httpErr(429, "RATE_LIMIT", `För många försök. Vänta ${windowSec}s.`);
  }

  obj.n += 1;
  await env.FREEZER_KV.put(key, JSON.stringify(obj), { expirationTtl: windowSec });
}

/* ================================
   Helpers: JSON, CORS, cookies
================================ */

function jsonOk(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Request-Id": obj.requestId || "" }
  });
}

function jsonError(status, code, message, requestId, origin, allowedOrigin) {
  const body = { ok: false, errorCode: code, message, requestId };
  const res = new Response(JSON.stringify(body), {
    status: status,
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Request-Id": requestId }
  });
  // Optionally add debug cors headers if provided
  if (origin != null || allowedOrigin != null) {
    return withCors(res, origin || "", allowedOrigin || "");
  }
  return res;
}

function withCors(response, origin, allowedOrigin) {
  const h = new Headers(response.headers);
  if (origin && allowedOrigin && origin === allowedOrigin) {
    h.set("Access-Control-Allow-Origin", origin);
    h.set("Vary", "Origin");
    h.set("Access-Control-Allow-Credentials", "true");
    h.set("Access-Control-Expose-Headers", "X-Request-Id");
  }
  return new Response(response.body, { status: response.status, headers: h });
}

function corsPreflightResponse(origin, allowedOrigin) {
  const headers = new Headers();
  if (origin && allowedOrigin && origin === allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type,X-CSRF");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return new Response(null, { status: 204, headers });
}

async function readJson(request, requestId) {
  const ct = request.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) {
    throw httpErr(400, "BAD_CONTENT_TYPE", "Content-Type måste vara application/json.");
  }
  let raw = "";
  try { raw = await request.text(); } catch {}
  try {
    const obj = JSON.parse(raw || "{}");
    if (!obj || typeof obj !== "object") throw new Error("bad json");
    return obj;
  } catch {
    throw httpErr(400, "BAD_JSON", "Kunde inte läsa JSON body.");
  }
}

async function kvGetJson(env, key, fallback) {
  try {
    const raw = await env.FREEZER_KV.get(key);
    if (!raw) return fallback;
    const obj = JSON.parse(raw);
    return obj ?? fallback;
  } catch {
    return fallback;
  }
}

function defaultUsers() {
  return [
    { id: "admin", role: "ADMIN", name: "Admin", active: true },
    { id: "buyer1", role: "BUYER", name: "Inköpare", active: true },
    { id: "picker1", role: "PICKER", name: "Plockare", active: true }
  ];
}

function safeId(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  if (!/^[a-zA-Z0-9_\-]{2,40}$/.test(s)) return "";
  return s;
}

function safeRole(v) {
  const r = String(v || "").toUpperCase().trim();
  if (r === "ADMIN" || r === "BUYER" || r === "PICKER" || r === "EMPLOYEE") return r;
  return "";
}

function safeShortText(v, maxLen) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.trunc(n);
  if (i < min || i > max) return fallback;
  return i;
}

function parseDateMs(v) {
  const s = String(v || "").trim();
  if (!s) return 0;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : 0;
}

/* ================================
   Signed session token (HMAC)
================================ */

async function signSession(payload, secret) {
  const secretStr = String(secret || "");
  if (!secretStr) throw httpErr(500, "SERVER_MISCONFIG", "SESSION_SECRET saknas.");

  const data = utf8ToBytes(JSON.stringify(payload));
  const sig = await hmacSha256(data, utf8ToBytes(secretStr));
  return base64urlEncode(data) + "." + base64urlEncode(sig);
}

async function verifySession(token, secret) {
  try {
    const secretStr = String(secret || "");
    if (!secretStr) return null;

    const parts = String(token || "").split(".");
    if (parts.length !== 2) return null;

    const data = base64urlDecode(parts[0]);
    const sig = base64urlDecode(parts[1]);

    const expected = await hmacSha256(data, utf8ToBytes(secretStr));
    if (!timingSafeEqual(sig, expected)) return null;

    const obj = JSON.parse(bytesToUtf8(data));
    if (!obj || typeof obj !== "object") return null;
    return obj;
  } catch {
    return null;
  }
}

async function hmacSha256(dataBytes, keyBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes);
  return new Uint8Array(sig);
}

function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= (a[i] ^ b[i]);
  return out === 0;
}

/* ================================
   Cookies
================================ */

function buildSessionCookie(token) {
  // Secure: requires https (GitHub Pages is https)
  // SameSite=Lax is fine for same-site + top-level navigation; with CORS fetch we also send credentials.
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${8 * 60 * 60}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(cookieHeader, name) {
  const c = String(cookieHeader || "");
  const parts = c.split(";").map(s => s.trim());
  for (const p of parts) {
    if (p.startsWith(name + "=")) return p.slice((name + "=").length);
  }
  return "";
}

/* ================================
   Errors
================================ */

function httpErr(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

function normalizeErr(err) {
  const status = Number(err && err.status) || 500;
  const code = String(err && err.code) || "SERVER_ERROR";
  const message = String(err && err.message) || "Server error.";
  return { status, code, message };
}

/* ================================
   Small utils
================================ */

function cryptoRandomId() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  let s = "";
  for (const b of a) s += b.toString(16).padStart(2, "0");
  return s;
}

function utf8ToBytes(str) {
  return new TextEncoder().encode(String(str || ""));
}

function bytesToUtf8(bytes) {
  return new TextDecoder().decode(bytes);
}

function base64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(s) {
  const b64 = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

