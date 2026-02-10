/* ============================================================
AO-SEC-01B — UI koppling mot API (auth/me + CSRF + felkoder) 
+ Renare ansvar: controller = logik/state, render = render
FIL: admin/freezer.js  (HEL FIL)
Projekt: Freezer (UI GitHub Pages -> API Worker)

Syfte:
- Init: hämta session via API (/auth/me) istället för local demo-session i UI
- Spara csrfToken i minne (ingen storage-key)
- Alla write-requests skickar credentials + X-CSRF
- Standardiserad API-error hantering: errorCode + requestId
- Fail-closed: om inte /auth/me ok -> redirect till ../index.html
- Behåll befintlig UI-koppling: FreezerStore + FreezerRender + FreezerDashboard (om finns)

Kontrakt:
- Inga nya storage keys i UI
- Inga console errors
- Render ska inte innehålla businesslogik (bara anropas härifrån)
============================================================ */

(function () {
  "use strict";

  // -----------------------------
  // Config
  // -----------------------------
  const API_BASE =
    (window.HR_CONFIG && window.HR_CONFIG.API_BASE) ||
    (window.FREEZER_CONFIG && window.FREEZER_CONFIG.API_BASE) ||
    ""; // t.ex. "https://<worker-subdomain>.workers.dev"

  const PATH_LOGIN = "../index.html";

  // -----------------------------
  // Tiny helpers
  // -----------------------------
  function byId(id) { return document.getElementById(id); }
  function safeNum(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

  function redirectToLogin() {
    try { window.location.replace(PATH_LOGIN); } catch {
      try { window.location.href = PATH_LOGIN; } catch {}
    }
  }

  function safeJsonParse(raw) { try { return JSON.parse(raw); } catch { return null; } }

  // -----------------------------
  // INIT-GUARD (ingen dubbel init)
  // -----------------------------
  if (window.__FRZ_ADMIN_PAGE_INIT__) return;
  window.__FRZ_ADMIN_PAGE_INIT__ = true;

  // -----------------------------
  // DOM: Topbar + Tabs
  // -----------------------------
  const roleText = byId("frzRoleText");
  const userNameText = byId("frzUserName");
  const viewHint = byId("frzViewHint");
  const resetBtn = byId("frzResetDemoBtn");
  const openCreateUserBtn = byId("frzOpenCreateUserBtn");

  const dashCards = byId("frzDashCards");

  const tabDashboard = byId("tabDashboard");
  const tabSaldo = byId("tabSaldo");
  const tabHistorik = byId("tabHistorik");

  let activeTab = "dashboard";

  // AO-02A: dashboard UI-state (ingen storage)
  let topPeriodDays = 30;

  // -----------------------------
  // Runtime auth-state (in-memory)
  // -----------------------------
  const auth = {
    ok: false,
    userId: "",
    role: "",
    perms: [],
    csrfToken: ""
  };

  function setTopbarIdentity(role, name) {
    if (roleText) roleText.textContent = String(role || "—");
    if (userNameText) userNameText.textContent = String(name || "—");
  }

  function setViewHint(text) {
    if (!viewHint) return;
    viewHint.textContent = String(text || "—");
  }

  function setHintForTab(tabKey) {
    const map = { dashboard: "Vy: Dashboard", saldo: "Vy: Saldo", history: "Vy: Historik" };
    setViewHint(map[String(tabKey || "")] || "Vy: —");
  }

  // -----------------------------
  // API client (controller-responsibility)
  // -----------------------------
  async function apiFetch(path, opts) {
    const url = (API_BASE || "").replace(/\/+$/, "") + String(path || "");
    const o = opts || {};
    const headers = new Headers(o.headers || {});
    headers.set("Accept", "application/json");

    // Write requests: add JSON + CSRF
    const method = String(o.method || "GET").toUpperCase();
    const isWrite = (method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE");

    if (isWrite) {
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
      if (auth.csrfToken) headers.set("X-CSRF", auth.csrfToken);
    }

    const res = await fetch(url, {
      method,
      headers,
      body: o.body,
      credentials: "include" // cookie-session från worker
    });

    const requestId = res.headers.get("X-Request-Id") || "";
    let data = null;

    // Try parse JSON (fail-soft)
    try {
      const txt = await res.text();
      data = txt ? safeJsonParse(txt) : null;
    } catch {}

    if (!res.ok) {
      const err = {
        status: res.status,
        errorCode: (data && data.errorCode) || "API_ERROR",
        message: (data && data.message) || "API error",
        requestId: (data && data.requestId) || requestId || ""
      };
      throw err;
    }

    return { data: data || {}, requestId };
  }

  async function apiMe() {
    return apiFetch("/auth/me", { method: "GET" });
  }

  async function apiLogout() {
    return apiFetch("/auth/logout", { method: "POST", body: "{}" });
  }

  // -----------------------------
  // Store / Render guards
  // -----------------------------
  if (!window.FreezerRender) {
    console.error("Freezer baseline saknar FreezerRender.");
    return;
  }

  let store = window.FreezerStore || null;
  let storeCorrupt = false;

  const storeShim = {
    init: function () { return { ok: false, reason: "Read-only: storage error." }; },
    setRole: function () {},
    subscribe: function () { return function () {}; },
    getState: function () { return {}; },
    getStatus: function () {
      return { role: auth.role || "—", locked: false, readOnly: true, whyReadOnly: "Read-only: init-fel.", reason: "Storage error" };
    },
    can: function () { return false; },
    hasPerm: function () { return false; },

    resetDemo: function () { return { ok: false, reason: "Read-only: storage error." }; },

    listUsers: function () { return []; },
    createUser: function () { return { ok: false, reason: "Read-only: storage error." }; },
    updateUser: function () { return { ok: false, reason: "Read-only: storage error." }; },
    setUserActive: function () { return { ok: false, reason: "Read-only: storage error." }; },

    listItems: function () { return []; }
  };

  function getStore() { return storeCorrupt ? storeShim : store; }

  function markStoreCorrupt(err) {
    storeCorrupt = true;
    console.error("[Freezer] Store fel -> read-only shim aktiverad.", err);
  }

  function safeGetState() {
    try {
      const s = getStore();
      return (s && typeof s.getState === "function") ? s.getState() : {};
    } catch (e) {
      markStoreCorrupt(e);
      return {};
    }
  }

  function safeGetStatus() {
    try {
      const s = getStore();
      return (s && typeof s.getStatus === "function") ? s.getStatus() : storeShim.getStatus();
    } catch (e) {
      markStoreCorrupt(e);
      return storeShim.getStatus();
    }
  }

  function safeCan(perm) {
    const s = getStore();
    try {
      if (s && typeof s.hasPerm === "function") return !!s.hasPerm(perm);
      if (s && typeof s.can === "function") return !!s.can(perm);
      return false;
    } catch (e) {
      markStoreCorrupt(e);
      return false;
    }
  }

  // -----------------------------
  // Modal unlock (robust)
  // -----------------------------
  function hardHide(node) {
    try {
      if (!node) return;
      node.hidden = true;
      node.setAttribute("aria-hidden", "true");
      node.style.display = "none";
      node.style.pointerEvents = "none";
    } catch {}
  }

  function killAllOverlays() {
    hardHide(byId("frzUserModalOverlay"));
    try {
      const shell = document.querySelector('[data-frz-modal="overlay"]');
      if (shell) hardHide(shell);
    } catch {}
    try {
      document.querySelectorAll(".modalOverlay").forEach(hardHide);
    } catch {}
  }

  function tryCloseShell() {
    try {
      if (window.FreezerModal && typeof window.FreezerModal.close === "function") {
        window.FreezerModal.close();
      }
    } catch {}
  }

  function closeAnyModal() {
    tryCloseShell();
    killAllOverlays();
  }

  (function bootUnlock() {
    tryCloseShell();
    killAllOverlays();

    let ticks = 0;
    const t = setInterval(() => {
      ticks++;
      tryCloseShell();
      killAllOverlays();
      if (ticks > 50) clearInterval(t);
    }, 100);

    document.addEventListener("keydown", (ev) => {
      if (ev && ev.key === "Escape") {
        tryCloseShell();
        killAllOverlays();
      }
    }, true);
  })();

  // -----------------------------
  // AO-02A: Top IN/OUT panel (controller-driven render)
  // -----------------------------
  function getEffectiveRole() {
    const st = safeGetStatus();
    const r = String((st && st.role) || auth.role || "ADMIN").toUpperCase().trim();
    return r || "ADMIN";
  }

  function shouldShowIn(role) {
    const r = String(role || "").toUpperCase();
    if (r === "PICKER") return false;
    return true;
  }

  function shouldShowOut(role) {
    const r = String(role || "").toUpperCase();
    if (r === "BUYER") return false;
    return true;
  }

  function renderTopInOut(state) {
    try {
      if (!dashCards) return;

      const role = getEffectiveRole();

      let panel = byId("frzTopInOutPanel");
      if (!panel) {
        panel = document.createElement("div");
        panel.id = "frzTopInOutPanel";
        panel.style.border = "1px solid #e6e6e6";
        panel.style.borderRadius = "12px";
        panel.style.padding = "12px";
        panel.style.background = "#fff";
        panel.style.marginBottom = "12px";
        dashCards.insertBefore(panel, dashCards.firstChild);
      } else {
        if (panel.parentNode !== dashCards) dashCards.insertBefore(panel, dashCards.firstChild);
        else if (dashCards.firstChild !== panel) dashCards.insertBefore(panel, dashCards.firstChild);
      }

      while (panel.firstChild) panel.removeChild(panel.firstChild);

      const headRow = document.createElement("div");
      headRow.style.display = "flex";
      headRow.style.gap = "10px";
      headRow.style.alignItems = "center";
      headRow.style.flexWrap = "wrap";

      const title = document.createElement("b");
      title.textContent = "Top 10 IN/OUT";
      headRow.appendChild(title);

      const hint = document.createElement("span");
      hint.style.opacity = ".75";
      hint.style.fontSize = "13px";
      hint.textContent = `Period: ${topPeriodDays} dagar`;
      headRow.appendChild(hint);

      const spacer = document.createElement("div");
      spacer.style.flex = "1";
      headRow.appendChild(spacer);

      const btnWrap = document.createElement("div");
      btnWrap.style.display = "inline-flex";
      btnWrap.style.gap = "8px";
      btnWrap.setAttribute("role", "group");
      btnWrap.setAttribute("aria-label", "Välj period för topplistor");

      function mkBtn(days) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = String(days);
        b.style.border = "1px solid #e6e6e6";
        b.style.background = "#fff";
        b.style.borderRadius = "999px";
        b.style.padding = "8px 12px";
        b.style.cursor = "pointer";
        b.style.fontSize = "14px";
        b.setAttribute("aria-pressed", days === topPeriodDays ? "true" : "false");
        if (days === topPeriodDays) b.style.fontWeight = "800";
        b.addEventListener("click", () => {
          topPeriodDays = days;
          renderTopInOut(safeGetState());
        });
        return b;
      }

      btnWrap.appendChild(mkBtn(7));
      btnWrap.appendChild(mkBtn(30));
      btnWrap.appendChild(mkBtn(90));
      headRow.appendChild(btnWrap);
      panel.appendChild(headRow);

      const hr = document.createElement("div");
      hr.style.height = "1px";
      hr.style.background = "#eee";
      hr.style.margin = "10px 0";
      panel.appendChild(hr);

      const dash = (window.FreezerDashboard && typeof window.FreezerDashboard.computeTopInOut === "function")
        ? window.FreezerDashboard
        : null;

      if (!dash) {
        const warn = document.createElement("div");
        warn.style.opacity = ".75";
        warn.textContent = "Top IN/OUT: FreezerDashboard saknas (ingen beräkning).";
        panel.appendChild(warn);
        return;
      }

      const res = dash.computeTopInOut(state, topPeriodDays) || { in: [], out: [], meta: {}, days: topPeriodDays };
      const showIn = shouldShowIn(role);
      const showOut = shouldShowOut(role);

      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "1fr";
      grid.style.gap = "12px";
      grid.style.marginTop = "8px";
      if (window.matchMedia && window.matchMedia("(min-width: 900px)").matches) {
        grid.style.gridTemplateColumns = (showIn && showOut) ? "1fr 1fr" : "1fr";
      } else {
        grid.style.gridTemplateColumns = "1fr";
      }

      function renderTable(titleText, rows) {
        const card = document.createElement("div");
        card.style.border = "1px solid #e6e6e6";
        card.style.borderRadius = "12px";
        card.style.padding = "10px";
        card.style.background = "#fafafa";

        const t = document.createElement("b");
        t.textContent = titleText;
        card.appendChild(t);

        const sub = document.createElement("div");
        sub.style.opacity = ".75";
        sub.style.fontSize = "12px";
        sub.style.marginTop = "4px";
        sub.textContent = `rader: ${Array.isArray(rows) ? rows.length : 0}`;
        card.appendChild(sub);

        const table = document.createElement("table");
        table.style.width = "100%";
        table.style.borderCollapse = "collapse";
        table.style.marginTop = "8px";
        table.setAttribute("aria-label", titleText);

        const thead = document.createElement("thead");
        const trh = document.createElement("tr");
        const th1 = document.createElement("th"); th1.textContent = "Artikel"; th1.style.textAlign = "left"; th1.style.padding = "6px";
        const th2 = document.createElement("th"); th2.textContent = "Qty"; th2.style.textAlign = "right"; th2.style.padding = "6px";
        const th3 = document.createElement("th"); th3.textContent = "Antal"; th3.style.textAlign = "right"; th3.style.padding = "6px";
        trh.appendChild(th1); trh.appendChild(th2); trh.appendChild(th3);
        thead.appendChild(trh);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        const list = Array.isArray(rows) ? rows : [];

        if (list.length === 0) {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = 3;
          td.style.padding = "10px 6px";
          td.style.opacity = ".75";
          td.textContent = "Inga träffar för perioden.";
          tr.appendChild(td);
          tbody.appendChild(tr);
        } else {
          for (const r of list) {
            const tr = document.createElement("tr");
            tr.style.borderTop = "1px solid #eee";

            const td1 = document.createElement("td");
            td1.style.padding = "8px 6px";
            td1.textContent = String((r && r.label) || "—");
            tr.appendChild(td1);

            const td2 = document.createElement("td");
            td2.style.padding = "8px 6px";
            td2.style.textAlign = "right";
            td2.textContent = String(safeNum(r && r.qty, 0));
            tr.appendChild(td2);

            const td3 = document.createElement("td");
            td3.style.padding = "8px 6px";
            td3.style.textAlign = "right";
            td3.textContent = String(safeNum(r && r.count, 0));
            tr.appendChild(td3);

            tbody.appendChild(tr);
          }
        }

        table.appendChild(tbody);
        card.appendChild(table);
        return card;
      }

      if (showIn) grid.appendChild(renderTable("IN (Top 10)", res.in || []));
      if (showOut) grid.appendChild(renderTable("OUT (Top 10)", res.out || []));

      panel.appendChild(grid);

      const meta = document.createElement("div");
      meta.style.opacity = ".75";
      meta.style.fontSize = "12px";
      meta.style.marginTop = "10px";
      const m = res.meta || {};
      meta.textContent = `moves: total=${safeNum(m.totalMoves, 0)} • used=${safeNum(m.usedMoves, 0)} • ignored=${safeNum(m.ignoredMoves, 0)} • roll=${role}`;
      panel.appendChild(meta);
    } catch {
      // fail-soft
    }
  }

  // -----------------------------
  // Permissions helper (controller)
  // -----------------------------
  function hasPerm(perm) {
    const list = Array.isArray(auth.perms) ? auth.perms : [];
    return list.includes(perm);
  }

  function syncCreateUserTopbarBtn() {
    if (!openCreateUserBtn) return;
    const status = safeGetStatus();
    const disabled = !!status.locked || !!status.readOnly || !hasPerm("users_manage");
    openCreateUserBtn.disabled = disabled;

    if (disabled) {
      if (status.locked) openCreateUserBtn.title = status.reason ? `Låst: ${status.reason}` : "Låst läge.";
      else if (status.readOnly) openCreateUserBtn.title = status.whyReadOnly || "Read-only.";
      else openCreateUserBtn.title = "Saknar behörighet (users_manage).";
    } else {
      openCreateUserBtn.title = "Skapa ny användare";
    }
  }

  // -----------------------------
  // Modal open (placeholder)
  // -----------------------------
  function openCreateUser() {
    const status = safeGetStatus();
    if (status.locked || status.readOnly) return;
    if (!hasPerm("users_manage")) return;

    if (window.FreezerModal && typeof window.FreezerModal.open === "function") {
      window.FreezerModal.open({
        title: "Skapa användare",
        text: "Modal-shell är aktiv. Koppla in formulär-render här i nästa steg."
      });
      return;
    }

    const legacy = byId("frzUserModalOverlay");
    if (!legacy) return;

    legacy.hidden = false;
    legacy.style.display = "flex";
    legacy.style.pointerEvents = "auto";
    legacy.setAttribute("aria-hidden", "false");
  }

  if (openCreateUserBtn) openCreateUserBtn.addEventListener("click", () => openCreateUser());

  const legacyClose = byId("frzUserModalCloseBtn");
  const legacyCancel = byId("frzUserCancelBtn");
  const legacyOverlay = byId("frzUserModalOverlay");

  if (legacyClose) legacyClose.addEventListener("click", () => closeAnyModal());
  if (legacyCancel) legacyCancel.addEventListener("click", () => closeAnyModal());
  if (legacyOverlay) {
    legacyOverlay.addEventListener("click", (ev) => {
      try { if (ev.target === legacyOverlay) closeAnyModal(); } catch {}
    });
  }

  // -----------------------------
  // Boot: Auth guard via API (/auth/me)
  // -----------------------------
  async function bootAuth() {
    try {
      if (!API_BASE) {
        // Fail-closed by default (security): if missing API, redirect
        redirectToLogin();
        return false;
      }

      const { data } = await apiMe();
      if (!data || !data.ok || !data.user) {
        redirectToLogin();
        return false;
      }

      const u = data.user || {};
      auth.ok = true;
      auth.userId = String(u.userId || "");
      auth.role = String(u.role || "");
      auth.perms = Array.isArray(u.perms) ? u.perms : [];
      auth.csrfToken = String(u.csrfToken || u.csrf || "");

      // Topbar: use userId as fallback "name"
      setTopbarIdentity(auth.role || "—", auth.userId || "—");
      return true;
    } catch (e) {
      // If session missing/expired -> login
      redirectToLogin();
      return false;
    }
  }

  // -----------------------------
  // Store init + subscribe render
  // -----------------------------
  const itemsUI = { itemsMsg: "—" };

  function initStore() {
    if (!store || typeof store.init !== "function") {
      console.error("Freezer baseline saknar FreezerStore.");
      storeCorrupt = true;
      return;
    }
    try {
      // Store gets role as hint; real RBAC is in API
      store.init({ role: auth.role || "ADMIN" });
      if (typeof store.setRole === "function") store.setRole(auth.role || "ADMIN");
    } catch (e) {
      markStoreCorrupt(e);
    }
  }

  function subscribeStore() {
    try {
      const s = getStore();
      if (s && typeof s.subscribe === "function") {
        s.subscribe((state) => {
          // Controller triggers render
          window.FreezerRender.renderAll(state || {}, itemsUI);
          window.FreezerRender.setActiveTabUI(activeTab);
          syncCreateUserTopbarBtn();
          setHintForTab(activeTab);

          if (activeTab === "dashboard") renderTopInOut(state || {});
        });
      }
    } catch (e) {
      markStoreCorrupt(e);
    }
  }

  function renderNow() {
    const st = safeGetState();
    window.FreezerRender.renderAll(st, itemsUI);
    window.FreezerRender.setActiveTabUI(activeTab);
    syncCreateUserTopbarBtn();
    setHintForTab(activeTab);
    if (activeTab === "dashboard") renderTopInOut(st);
  }

  // -----------------------------
  // Tabs
  // -----------------------------
  function bindTab(btn, key) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      activeTab = key;
      window.FreezerRender.setActiveTabUI(activeTab);
      window.FreezerRender.renderAll(safeGetState(), itemsUI);
      syncCreateUserTopbarBtn();
      setHintForTab(activeTab);
      if (activeTab === "dashboard") renderTopInOut(safeGetState());
    });
  }

  bindTab(tabDashboard, "dashboard");
  bindTab(tabSaldo, "saldo");
  bindTab(tabHistorik, "history");

  // -----------------------------
  // Reset demo (lokal store) — lämnas som-is
  // -----------------------------
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const status = safeGetStatus();
      if (status.locked || status.readOnly) return;

      const s = getStore();
      try { if (s && typeof s.resetDemo === "function") s.resetDemo(); } catch (e) { markStoreCorrupt(e); }

      closeAnyModal();
      renderNow();
    });
  }

  // -----------------------------
  // Optional: logout hook if you have a button
  // (no DOM id assumed here; kept minimal)
  // -----------------------------
  // Example if you later add:
  // const logoutBtn = byId("frzLogoutBtn");
  // if (logoutBtn) logoutBtn.addEventListener("click", async () => { try{ await apiLogout(); } finally { redirectToLogin(); } });

  // -----------------------------
  // MAIN BOOT
  // -----------------------------
  (async function main() {
    const ok = await bootAuth();
    if (!ok) return;

    initStore();
    subscribeStore();
    renderNow();
  })();

  /* ÄNDRINGSLOGG (≤8)
  1) AO-SEC-01B: Bytte UI-auth från localStorage-session -> API /auth/me (cookie-session).
  2) AO-SEC-01B: In-memory csrfToken + credentials:include på alla API-anrop.
  3) AO-SEC-01B: Fail-closed: saknad API_BASE eller /me fail -> redirect ../index.html.
  4) Behöll FreezerStore/Render-flöde: controller triggar render, render innehåller ingen logik.
  5) Behöll AO-02A top IN/OUT panel med period state (7/30/90) utan storage.
  */
})();
