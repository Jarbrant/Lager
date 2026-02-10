/* ============================================================
AO-SEC-01B (HYBRID) — UI koppling mot API (auth/me + CSRF + felkoder)
+ Fallback: UI-demo-session (FRZ_SESSION_V1) om API_BASE saknas
+ Renare ansvar: controller = logik/state, view(render) = DOM/render
FIL: admin/freezer.js  (HEL FIL)
Projekt: Freezer (UI GitHub Pages -> API Worker)

Syfte:
- Primärt: API-auth via /auth/me (cookie-session), CSRF i minne
- Fallback: UI-only auth via FRZ_SESSION_V1 (sessionStorage/localStorage)
- Fail-closed: om varken API-auth eller UI-session är OK -> INGEN redirect-loop.
  Visa istället låst läge med tydlig “Logga in”-länk.

Fix (P0 crash):
- Om FreezerStore eller FreezerRender saknas (pga 404/syntax/module mismatch) → INGEN redirect-loop.
  Visa istället fail-closed “Tekniskt fel” i UI (read-only) så sidan inte “blinkar och dör”.

Kontrakt:
- Inga nya storage keys i UI
- Inga console errors (ingen obligatorisk logging)
- Render ska inte innehålla businesslogik (controller styr)
============================================================ */

(function () {
  "use strict";

  // -----------------------------
  // CONFIG
  // -----------------------------
  const API_BASE =
    (window.HR_CONFIG && window.HR_CONFIG.API_BASE) ||
    (window.FREEZER_CONFIG && window.FREEZER_CONFIG.API_BASE) ||
    "";

  const PATH_LOGIN = "../index.html";
  const UI_SESSION_KEY = "FRZ_SESSION_V1";

  // -----------------------------
  // INIT-GUARD
  // -----------------------------
  if (window.__FRZ_ADMIN_PAGE_INIT__) return;
  window.__FRZ_ADMIN_PAGE_INIT__ = true;

  // -----------------------------
  // TINY HELPERS (no console)
  // -----------------------------
  function byId(id) { return document.getElementById(id); }
  function safeNum(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
  function safeJsonParse(raw) { try { return JSON.parse(raw); } catch { return null; } }

  function readUiSession() {
    try {
      const sRaw = (window.sessionStorage && window.sessionStorage.getItem(UI_SESSION_KEY)) || null;
      if (sRaw) return safeJsonParse(sRaw);
    } catch {}
    try {
      const lRaw = (window.localStorage && window.localStorage.getItem(UI_SESSION_KEY)) || null;
      if (lRaw) return safeJsonParse(lRaw);
    } catch {}
    return null;
  }

  function isUiSessionValid(sess) {
    try {
      if (!sess || typeof sess !== "object") return { ok: false, reason: "NO_SESSION" };
      const role = String(sess.role || "").toUpperCase().trim();
      if (!role) return { ok: false, reason: "BAD_SESSION" };

      const exp = Number(sess.exp || 0);
      if (exp && Date.now() > exp) return { ok: false, reason: "EXPIRED" };

      const firstName = String(sess.firstName || "").trim();
      if (!firstName) return { ok: false, reason: "BAD_SESSION" };

      return { ok: true, role, firstName };
    } catch {
      return { ok: false, reason: "BAD_SESSION" };
    }
  }

  // -----------------------------
  // VIEW (render-only)
  // -----------------------------
  const View = (function () {
    const els = {
      roleText: byId("frzRoleText"),
      userNameText: byId("frzUserName"),
      viewHint: byId("frzViewHint"),

      statusPill: byId("frzStatusPill"),
      statusText: byId("frzStatusText"),

      lockPanel: byId("frzLockPanel"),
      lockReason: byId("frzLockReason"),

      resetBtn: byId("frzResetDemoBtn"),
      openCreateUserBtn: byId("frzOpenCreateUserBtn"),

      dashCards: byId("frzDashCards"),

      tabDashboard: byId("tabDashboard"),
      tabSaldo: byId("tabSaldo"),
      tabHistorik: byId("tabHistorik"),

      viewDashboard: byId("viewDashboard"),
      viewSaldo: byId("viewSaldo"),
      viewHistorik: byId("viewHistorik"),

      legacyClose: byId("frzUserModalCloseBtn"),
      legacyCancel: byId("frzUserCancelBtn"),
      legacyOverlay: byId("frzUserModalOverlay")
    };

    function setTopbarIdentity(role, name) {
      if (els.roleText) els.roleText.textContent = String(role || "—");
      if (els.userNameText) els.userNameText.textContent = String(name || "—");
    }

    function setStatus(text, isOk) {
      if (els.statusText) els.statusText.textContent = String(text || "—");
      if (els.statusPill) {
        els.statusPill.classList.remove("ok");
        els.statusPill.classList.remove("danger");
        els.statusPill.classList.add(isOk ? "ok" : "danger");
      }
    }

    function setLockPanel(visible, reasonText) {
      if (!els.lockPanel) return;
      els.lockPanel.hidden = !visible;
      if (els.lockReason) els.lockReason.textContent = String(reasonText || "Orsak: okänd");
    }

    function setViewHint(text) {
      if (!els.viewHint) return;
      els.viewHint.textContent = String(text || "—");
    }

    function setHintForTab(tabKey) {
      const map = { dashboard: "Vy: Dashboard", saldo: "Vy: Saldo", history: "Vy: Historik" };
      setViewHint(map[String(tabKey || "")] || "Vy: —");
    }

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
      hardHide(els.legacyOverlay);
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

    function bootUnlock() {
      tryCloseShell();
      killAllOverlays();

      let ticks = 0;
      const t = setInterval(() => {
        ticks++;
        tryCloseShell();
        killAllOverlays();
        if (ticks > 50) clearInterval(t);
      }, 100);

      document.addEventListener(
        "keydown",
        (ev) => {
          if (ev && ev.key === "Escape") {
            tryCloseShell();
            killAllOverlays();
          }
        },
        true
      );
    }

    function wireModalClose() {
      if (els.legacyClose) els.legacyClose.addEventListener("click", closeAnyModal);
      if (els.legacyCancel) els.legacyCancel.addEventListener("click", closeAnyModal);
      if (els.legacyOverlay) {
        els.legacyOverlay.addEventListener("click", (ev) => {
          try { if (ev.target === els.legacyOverlay) closeAnyModal(); } catch {}
        });
      }
    }

    function wireTabs(onTab) {
      function bind(btn, key) {
        if (!btn) return;
        btn.addEventListener("click", () => onTab(key));
      }
      bind(els.tabDashboard, "dashboard");
      bind(els.tabSaldo, "saldo");
      bind(els.tabHistorik, "history");
    }

    function wireButtons(handlers) {
      if (els.openCreateUserBtn && handlers && handlers.onOpenCreateUser) {
        els.openCreateUserBtn.addEventListener("click", handlers.onOpenCreateUser);
      }
      if (els.resetBtn && handlers && handlers.onResetDemo) {
        els.resetBtn.addEventListener("click", handlers.onResetDemo);
      }
    }

    function setCreateUserDisabled(disabled, title) {
      if (!els.openCreateUserBtn) return;
      els.openCreateUserBtn.disabled = !!disabled;
      if (typeof title === "string") els.openCreateUserBtn.title = title;
    }

    function setResetDisabled(disabled, title) {
      if (!els.resetBtn) return;
      els.resetBtn.disabled = !!disabled;
      if (typeof title === "string") els.resetBtn.title = title;
    }

    // AO-02A panel render (pure DOM render)
    function renderTopInOutPanel(args) {
      try {
        const dashCards = els.dashCards;
        if (!dashCards) return;

        const state = args.state || {};
        const role = String(args.role || "ADMIN").toUpperCase().trim() || "ADMIN";
        const topPeriodDays = safeNum(args.topPeriodDays, 30);
        const onPickPeriod = typeof args.onPickPeriod === "function" ? args.onPickPeriod : function () {};

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
          b.addEventListener("click", () => onPickPeriod(days));
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

        const dash =
          window.FreezerDashboard && typeof window.FreezerDashboard.computeTopInOut === "function"
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
        const showIn = role !== "PICKER";
        const showOut = role !== "BUYER";

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "1fr";
        grid.style.gap = "12px";
        grid.style.marginTop = "8px";
        if (window.matchMedia && window.matchMedia("(min-width: 900px)").matches) {
          grid.style.gridTemplateColumns = showIn && showOut ? "1fr 1fr" : "1fr";
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
          const th1 = document.createElement("th");
          th1.textContent = "Artikel";
          th1.style.textAlign = "left";
          th1.style.padding = "6px";
          const th2 = document.createElement("th");
          th2.textContent = "Qty";
          th2.style.textAlign = "right";
          th2.style.padding = "6px";
          const th3 = document.createElement("th");
          th3.textContent = "Antal";
          th3.style.textAlign = "right";
          th3.style.padding = "6px";
          trh.appendChild(th1);
          trh.appendChild(th2);
          trh.appendChild(th3);
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
        meta.textContent = `moves: total=${safeNum(m.totalMoves, 0)} • used=${safeNum(m.usedMoves, 0)} • ignored=${safeNum(
          m.ignoredMoves,
          0
        )} • roll=${role}`;
        panel.appendChild(meta);
      } catch {
        // fail-soft
      }
    }

    function showBootError(code, detail) {
      const msg = code === "MISSING_RENDER"
        ? "Tekniskt fel: FreezerRender saknas (script laddades ej / fel typ)."
        : "Tekniskt fel: FreezerStore saknas (script laddades ej / fel typ).";

      setStatus("Tekniskt fel", false);
      setLockPanel(true, msg + (detail ? ` (${detail})` : ""));
      setViewHint("Read-only: kan inte starta UI.");
      setCreateUserDisabled(true, "Read-only: tekniskt fel.");
      setResetDisabled(true, "Read-only: tekniskt fel.");

      try {
        if (els.viewDashboard) els.viewDashboard.hidden = false;
        if (els.viewSaldo) els.viewSaldo.hidden = true;
        if (els.viewHistorik) els.viewHistorik.hidden = true;
      } catch {}
    }

    function showAuthFail(reasonCode) {
      const r = String(reasonCode || "AUTH_REQUIRED");
      setTopbarIdentity("—", "—");
      setStatus("Ej inloggad", false);
      setViewHint("Read-only: inloggning krävs.");
      setCreateUserDisabled(true, "Inloggning krävs.");
      setResetDisabled(true, "Inloggning krävs.");

      const lockText =
        `Inloggning krävs (${r}). Öppna Logga in: ${PATH_LOGIN}`;

      setLockPanel(true, lockText);

      try {
        if (els.viewDashboard) els.viewDashboard.hidden = false;
        if (els.viewSaldo) els.viewSaldo.hidden = true;
        if (els.viewHistorik) els.viewHistorik.hidden = true;
      } catch {}
    }

    return {
      els,
      setTopbarIdentity,
      setStatus,
      setLockPanel,
      setViewHint,
      setHintForTab,
      bootUnlock,
      closeAnyModal,
      wireModalClose,
      wireTabs,
      wireButtons,
      setCreateUserDisabled,
      setResetDisabled,
      showBootError,
      showAuthFail,
      renderTopInOutPanel
    };
  })();

  // -----------------------------
  // CONTROLLER STATE
  // -----------------------------
  let activeTab = "dashboard";
  let topPeriodDays = 30;

  const auth = {
    ok: false,
    userId: "",
    role: "",
    perms: [],
    csrfToken: "",
    mode: "none" // "api" | "ui"
  };

  function hasPerm(perm) {
    const list = Array.isArray(auth.perms) ? auth.perms : [];
    return list.includes(perm);
  }

  // -----------------------------
  // API CLIENT (controller)
  // -----------------------------
  async function apiFetch(path, opts) {
    const base = (API_BASE || "").replace(/\/+$/, "");
    const url = base + String(path || "");
    const o = opts || {};
    const headers = new Headers(o.headers || {});
    headers.set("Accept", "application/json");

    const method = String(o.method || "GET").toUpperCase();
    const isWrite = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";

    if (isWrite) {
      if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json; charset=utf-8");
      if (auth.csrfToken) headers.set("X-CSRF", auth.csrfToken);
    }

    const res = await fetch(url, {
      method,
      headers,
      body: o.body,
      credentials: "include"
    });

    const requestId = res.headers.get("X-Request-Id") || "";
    let data = null;

    try {
      const txt = await res.text();
      data = txt ? safeJsonParse(txt) : null;
    } catch {}

    if (!res.ok) {
      throw {
        status: res.status,
        errorCode: (data && data.errorCode) || "API_ERROR",
        message: (data && (data.message || data.error)) || "API error",
        requestId: (data && data.requestId) || requestId || ""
      };
    }

    return { data: data || {}, requestId };
  }

  function apiMe() { return apiFetch("/auth/me", { method: "GET" }); }

  // -----------------------------
  // STORE GUARDS (controller)
  // -----------------------------
  let store = window.FreezerStore || null;
  let storeCorrupt = false;
  let renderMissing = false;
  let storeMissing = false;

  const storeShim = {
    init: function () { return { ok: false, reason: "Read-only: storage error." }; },
    setRole: function () {},
    subscribe: function () { return function () {}; },
    getState: function () { return {}; },
    getStatus: function () {
      return {
        role: auth.role || "—",
        locked: true,
        readOnly: true,
        whyReadOnly: "Read-only: init-fel.",
        reason: "Storage error"
      };
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

  function getStore() { return storeCorrupt || storeMissing ? storeShim : store; }

  function markStoreCorrupt() {
    storeCorrupt = true;
    View.setViewHint("Read-only: storage fel.");
    View.setLockPanel(true, "Orsak: storage fel (read-only).");
    View.setStatus("Read-only", false);
    View.setCreateUserDisabled(true, "Read-only: storage fel.");
    View.setResetDisabled(true, "Read-only: storage fel.");
  }

  function markBootMissing(which) {
    if (which === "render") {
      renderMissing = true;
      View.showBootError("MISSING_RENDER");
      View.closeAnyModal();
      return;
    }
    storeMissing = true;
    View.showBootError("MISSING_STORE");
    View.closeAnyModal();
  }

  function safeGetState() {
    try {
      const s = getStore();
      return s && typeof s.getState === "function" ? s.getState() : {};
    } catch {
      markStoreCorrupt();
      return {};
    }
  }

  function safeGetStatus() {
    try {
      const s = getStore();
      return s && typeof s.getStatus === "function" ? s.getStatus() : storeShim.getStatus();
    } catch {
      markStoreCorrupt();
      return storeShim.getStatus();
    }
  }

  // -----------------------------
  // CONTROLLER -> VIEW
  // -----------------------------
  function syncCreateUserTopbarBtn() {
    const status = safeGetStatus();

    const hasUsersManage = hasPerm("users_manage");
    const blockedByStore = auth.mode === "api" ? !!status.locked || !!status.readOnly : false;

    const disabled = !hasUsersManage || storeCorrupt || storeMissing || renderMissing || blockedByStore;

    let title = "Skapa ny användare";
    if (disabled) {
      if (renderMissing) title = "Tekniskt fel: render saknas.";
      else if (storeMissing) title = "Tekniskt fel: store saknas.";
      else if (!hasUsersManage) title = "Saknar behörighet (users_manage).";
      else if (storeCorrupt) title = "Read-only: storage fel.";
      else if (blockedByStore) {
        if (status.locked) title = status.reason ? `Låst: ${status.reason}` : "Låst läge.";
        else title = status.whyReadOnly || "Read-only.";
      }
    }

    View.setCreateUserDisabled(disabled, title);
  }

  function syncResetBtn() {
    const status = safeGetStatus();
    const disabled = !!status.locked || !!status.readOnly || storeCorrupt || storeMissing || renderMissing;
    let title = "Återställ demo-data";
    if (disabled) {
      if (renderMissing) title = "Tekniskt fel: render saknas.";
      else if (storeMissing) title = "Tekniskt fel: store saknas.";
      else if (storeCorrupt) title = "Read-only: storage fel.";
      else if (status.locked) title = status.reason ? `Låst: ${status.reason}` : "Låst läge.";
      else title = status.whyReadOnly || "Read-only.";
    }
    View.setResetDisabled(disabled, title);
  }

  function effectiveRoleForDashboard() {
    const st = safeGetStatus();
    const r = String((st && st.role) || auth.role || "ADMIN").toUpperCase().trim();
    return r || "ADMIN";
  }

  function renderTopInOutIfDashboard(state) {
    if (activeTab !== "dashboard") return;
    View.renderTopInOutPanel({
      state: state || {},
      role: effectiveRoleForDashboard(),
      topPeriodDays,
      onPickPeriod: (days) => {
        topPeriodDays = days;
        renderNow();
      }
    });
  }

  function renderNow() {
    if (!window.FreezerRender) {
      markBootMissing("render");
      return;
    }

    const st = safeGetState();

    try {
      window.FreezerRender.renderAll(st, { itemsMsg: "—" });
      window.FreezerRender.setActiveTabUI(activeTab);
    } catch {
      markBootMissing("render");
      return;
    }

    syncCreateUserTopbarBtn();
    syncResetBtn();
    View.setHintForTab(activeTab);
    renderTopInOutIfDashboard(st);

    const status = safeGetStatus();
    if (storeMissing) View.setStatus("Tekniskt fel", false);
    else if (status && (status.locked || status.readOnly)) View.setStatus("Read-only", false);
    else View.setStatus("OK", true);

    if (status && (status.locked || status.readOnly)) {
      const why = status.locked ? (status.reason || "Låst läge.") : (status.whyReadOnly || "Read-only.");
      View.setLockPanel(true, `Orsak: ${why}`);
    } else {
      View.setLockPanel(false, "");
    }
  }

  // -----------------------------
  // MODAL OPEN (controller)
  // -----------------------------
  function openCreateUser() {
    if (!hasPerm("users_manage")) return;
    if (renderMissing || storeMissing || storeCorrupt) return;

    if (auth.mode === "api") {
      const status = safeGetStatus();
      if (status.locked || status.readOnly) return;
    }

    if (window.FreezerModal && typeof window.FreezerModal.open === "function") {
      window.FreezerModal.open({
        title: "Skapa användare",
        text: "Modal-shell är aktiv. Koppla in formulär-render här i nästa steg."
      });
      return;
    }

    const legacy = View.els.legacyOverlay;
    if (!legacy) return;

    legacy.hidden = false;
    legacy.style.display = "flex";
    legacy.style.pointerEvents = "auto";
    legacy.setAttribute("aria-hidden", "false");
  }

  // -----------------------------
  // AUTH BOOT (API first, fallback UI-session)
  // -----------------------------
  async function bootAuth() {
    if (API_BASE) {
      try {
        const { data } = await apiMe();
        if (data && data.ok && data.user) {
          const u = data.user || {};
          auth.ok = true;
          auth.mode = "api";
          auth.userId = String(u.userId || "");
          auth.role = String(u.role || "");
          auth.perms = Array.isArray(u.perms) ? u.perms : [];
          auth.csrfToken = String(u.csrfToken || u.csrf || "");

          View.setTopbarIdentity(auth.role || "—", auth.userId || "—");
          return true;
        }
      } catch {
        // fall through to UI mode
      }
    }

    const sess = readUiSession();
    const v = isUiSessionValid(sess);
    if (!v.ok) {
      View.showAuthFail(v.reason || "AUTH_REQUIRED");
      return false;
    }

    auth.ok = true;
    auth.mode = "ui";
    auth.userId = String(v.firstName || "—");
    auth.role = String(v.role || "—");

    auth.perms = String(v.role).toUpperCase() === "ADMIN"
      ? ["users_manage", "items_manage", "moves_manage", "view_dashboard"]
      : ["view_dashboard"];

    auth.csrfToken = "";

    View.setTopbarIdentity(auth.role || "—", auth.userId || "—");
    return true;
  }

  // -----------------------------
  // STORE INIT/SUBSCRIBE
  // -----------------------------
  function initStore() {
    store = window.FreezerStore || null;
    if (!store || typeof store.init !== "function") {
      markBootMissing("store");
      return true;
    }

    try {
      store.init({ role: auth.role || "ADMIN" });
      if (typeof store.setRole === "function") store.setRole(auth.role || "ADMIN");
      return true;
    } catch {
      markStoreCorrupt();
      return true;
    }
  }

  function subscribeStore() {
    try {
      const s = getStore();
      if (s && typeof s.subscribe === "function") {
        s.subscribe((state) => {
          if (!window.FreezerRender) {
            markBootMissing("render");
            return;
          }
          try {
            window.FreezerRender.renderAll(state || {}, { itemsMsg: "—" });
            window.FreezerRender.setActiveTabUI(activeTab);
          } catch {
            markBootMissing("render");
            return;
          }

          syncCreateUserTopbarBtn();
          syncResetBtn();
          View.setHintForTab(activeTab);
          renderTopInOutIfDashboard(state || {});
        });
      }
    } catch {
      markStoreCorrupt();
    }
  }

  // -----------------------------
  // EVENTS (controller)
  // -----------------------------
  function onTabChange(key) {
    activeTab = key;
    renderNow();
  }

  function onResetDemo() {
    if (renderMissing || storeMissing || storeCorrupt) return;

    const status = safeGetStatus();
    if (status.locked || status.readOnly) return;

    const s = getStore();
    try { if (s && typeof s.resetDemo === "function") s.resetDemo(); } catch { markStoreCorrupt(); }

    View.closeAnyModal();
    renderNow();
  }

  // -----------------------------
  // MAIN BOOT
  // -----------------------------
  (async function main() {
    View.bootUnlock();
    View.wireModalClose();

    View.wireTabs(onTabChange);
    View.wireButtons({
      onOpenCreateUser: openCreateUser,
      onResetDemo: onResetDemo
    });

    const ok = await bootAuth();
    if (!ok) return;

    View.setStatus("Laddar…", true);

    initStore();
    subscribeStore();
    renderNow();

    syncCreateUserTopbarBtn();
    syncResetBtn();
  })();

  /* ÄNDRINGSLOGG (≤8)
  1) P0: Tar bort auto-redirect vid auth-fail → fail-closed på sidan (lockpanel + “Logga in”-hint).
  2) P0: Behåller ingen redirect-loop vid saknad Store/Render → “Tekniskt fel” read-only.
  3) Övrigt beteende oförändrat i normal drift: auth + store + render + tabs + dashboard panel.
  */
})();
