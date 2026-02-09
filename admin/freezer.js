/* ============================================================
AO-02A/15 — Dashboard Top OUT/IN (7/30/90) | FIL: admin/freezer.js
AUTOPATCH (hel fil)
Projekt: Freezer (UI-only / localStorage-first)

Syfte (AO-02A):
- Visa Top 10 OUT/IN i Dashboard med periodknappar 7/30/90 dagar.
- Klick period -> rerender (utan storage-key).
- Rollstyrning: BUYER ser primärt IN, PICKER ser primärt OUT, ADMIN ser båda.
- Inga console errors.

Övrigt (befintligt):
- Session-guard (FRZ_SESSION_V1) -> ADMIN-only, fail-closed
- Stabil modal-hantering: får aldrig låsa sidan

Default (renare ansvar):
- Render = render (DOM only, tar VM + callbacks)
- Controller = logik/state/store (bygger VM, pratar med store, håller UI-state)
============================================================ */

(function () {
  "use strict";

  // ------------------------------------------------------------
  // AO-LOGIN-01: SESSION GUARD (fail-closed)
  // ------------------------------------------------------------
  const SESSION_KEY = "FRZ_SESSION_V1";

  function safeJsonParse(raw) { try { return JSON.parse(raw); } catch { return null; } }

  function readSession() {
    try {
      const sRaw = (window.sessionStorage && window.sessionStorage.getItem(SESSION_KEY)) || null;
      if (sRaw) return safeJsonParse(sRaw);
    } catch {}
    try {
      const lRaw = (window.localStorage && window.localStorage.getItem(SESSION_KEY)) || null;
      if (lRaw) return safeJsonParse(lRaw);
    } catch {}
    return null;
  }

  function clearSession() {
    try { window.sessionStorage && window.sessionStorage.removeItem(SESSION_KEY); } catch {}
    try { window.localStorage && window.localStorage.removeItem(SESSION_KEY); } catch {}
  }

  function isSessionValidAndAdmin(sess) {
    try {
      if (!sess || typeof sess !== "object") return { ok: false, reason: "NO_SESSION" };

      const role = String(sess.role || "").toUpperCase().trim();
      if (role !== "ADMIN") return { ok: false, reason: "NOT_ADMIN" };

      const exp = Number(sess.exp || 0);
      if (exp && Date.now() > exp) return { ok: false, reason: "EXPIRED" };

      const firstName = String(sess.firstName || "").trim();
      if (!firstName) return { ok: false, reason: "BAD_SESSION" };

      return { ok: true, role: role, firstName: firstName };
    } catch {
      return { ok: false, reason: "BAD_SESSION" };
    }
  }

  function redirectToLogin() {
    try { window.location.replace("../index.html"); } catch {
      try { window.location.href = "../index.html"; } catch {}
    }
  }

  // Guard direkt
  let sessionView = { ok: false, role: "ADMIN", firstName: "" };
  (function guardNow() {
    const sess = readSession();
    const v = isSessionValidAndAdmin(sess);
    if (!v.ok) {
      if (v.reason === "EXPIRED" || v.reason === "BAD_SESSION") clearSession();
      redirectToLogin();
      return;
    }
    sessionView = v;
  })();

  // ------------------------------------------------------------
  // INIT-GUARD (ingen dubbel init)
  // ------------------------------------------------------------
  if (window.__FRZ_ADMIN_PAGE_INIT__) {
    console.warn("[Freezer] admin/freezer.js redan initierad (guard).");
    return;
  }
  window.__FRZ_ADMIN_PAGE_INIT__ = true;

  function byId(id) { return document.getElementById(id); }
  function el(tag) { return document.createElement(tag); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function safeNum(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }

  // Topbar
  const roleText = byId("frzRoleText");
  const userNameText = byId("frzUserName");
  const viewHint = byId("frzViewHint");
  const resetBtn = byId("frzResetDemoBtn");
  const openCreateUserBtn = byId("frzOpenCreateUserBtn");

  // Dashboard DOM (AO-02A)
  const dashCards = byId("frzDashCards");

  // Legacy tabs
  const tabDashboard = byId("tabDashboard");
  const tabSaldo = byId("tabSaldo");
  const tabHistorik = byId("tabHistorik");

  // ------------------------------------------------------------
  // UI-STATE (controller) — ingen storage
  // ------------------------------------------------------------
  const ui = {
    activeTab: "dashboard",
    topPeriodDays: 30
  };

  // ------------------------------------------------------------
  // Store / Render guards
  // ------------------------------------------------------------
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
      return { role: "ADMIN", locked: false, readOnly: true, whyReadOnly: "Read-only: init-fel.", reason: "Storage error" };
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

  // ------------------------------------------------------------
  // Topbar sync
  // ------------------------------------------------------------
  function syncTopbarIdentity() {
    const sess = readSession();
    const v = isSessionValidAndAdmin(sess);
    if (!v.ok) {
      redirectToLogin();
      return false;
    }
    if (roleText) roleText.textContent = "ADMIN";
    if (userNameText) userNameText.textContent = String(v.firstName || "—");
    return true;
  }
  syncTopbarIdentity();

  // ------------------------------------------------------------
  // VIEW HINT
  // ------------------------------------------------------------
  function setViewHint(text) {
    if (!viewHint) return;
    viewHint.textContent = String(text || "—");
  }
  function setHintForTab(tabKey) {
    const map = { dashboard: "Vy: Dashboard", saldo: "Vy: Saldo", history: "Vy: Historik" };
    setViewHint(map[String(tabKey || "")] || "Vy: —");
  }

  // ------------------------------------------------------------
  // MODAL: Rebuild (robust, aldrig lås)
  // ------------------------------------------------------------
  function hardHide(node) {
    try {
      if (!node) return;
      node.hidden = true;
      node.setAttribute("aria-hidden", "true");
      node.style.display = "none";
      node.style.pointerEvents = "none";
    } catch {}
  }

  function killAllOverlays(reason) {
    void reason;

    // Legacy
    hardHide(byId("frzUserModalOverlay"));

    // Shell
    try {
      const shell = document.querySelector('[data-frz-modal="overlay"]');
      if (shell) hardHide(shell);
    } catch {}

    // Generic
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

  (function bootUnlock() {
    tryCloseShell();
    killAllOverlays("boot");

    let ticks = 0;
    const t = setInterval(() => {
      ticks++;
      tryCloseShell();
      killAllOverlays("watchdog");
      if (ticks > 50) clearInterval(t); // ~5s
    }, 100);

    document.addEventListener("keydown", (ev) => {
      if (!ev) return;
      if (ev.key === "Escape") {
        tryCloseShell();
        killAllOverlays("esc");
      }
    }, true);
  })();

  function closeAnyModal() {
    tryCloseShell();
    killAllOverlays("close");
  }

  function openCreateUser() {
    if (!syncTopbarIdentity()) return;

    const status = safeGetStatus();
    if (status.locked || status.readOnly) return;
    if (!safeCan("users_manage")) return;

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

  function syncCreateUserTopbarBtn() {
    if (!openCreateUserBtn) return;
    const status = safeGetStatus();
    const canUsers = safeCan("users_manage");
    const disabled = !!status.locked || !!status.readOnly || !canUsers;
    openCreateUserBtn.disabled = disabled;

    if (disabled) {
      if (status.locked) openCreateUserBtn.title = status.reason ? `Låst: ${status.reason}` : "Låst läge.";
      else if (status.readOnly) openCreateUserBtn.title = status.whyReadOnly || "Read-only.";
      else openCreateUserBtn.title = "Saknar behörighet (users_manage).";
    } else {
      openCreateUserBtn.title = "Skapa ny användare";
    }
  }

  if (openCreateUserBtn) {
    openCreateUserBtn.addEventListener("click", () => openCreateUser());
  }

  const legacyClose = byId("frzUserModalCloseBtn");
  const legacyCancel = byId("frzUserCancelBtn");
  const legacyOverlay = byId("frzUserModalOverlay");

  if (legacyClose) legacyClose.addEventListener("click", () => closeAnyModal());
  if (legacyCancel) legacyCancel.addEventListener("click", () => closeAnyModal());
  if (legacyOverlay) {
    legacyOverlay.addEventListener("click", (ev) => {
      try {
        if (ev.target === legacyOverlay) closeAnyModal();
      } catch {}
    });
  }

  // ------------------------------------------------------------
  // AO-02A: TOP IN/OUT — Controller (logik/state) + Render (DOM)
  // ------------------------------------------------------------

  // -------- Controller: derived role + gating
  function getEffectiveRole() {
    try {
      const st = safeGetStatus();
      const r = String((st && st.role) || sessionView.role || "ADMIN").toUpperCase().trim();
      return r || "ADMIN";
    } catch {
      return "ADMIN";
    }
  }

  function shouldShowIn(role) {
    const r = String(role || "").toUpperCase();
    if (r === "PICKER") return false;
    return true; // ADMIN + BUYER + okänt -> visa IN
  }

  function shouldShowOut(role) {
    const r = String(role || "").toUpperCase();
    if (r === "BUYER") return false;
    return true; // ADMIN + PICKER + okänt -> visa OUT
  }

  function computeTopInOutVM(state) {
    const role = getEffectiveRole();

    const dash = (window.FreezerDashboard && typeof window.FreezerDashboard.computeTopInOut === "function")
      ? window.FreezerDashboard
      : null;

    const base = {
      ok: true,
      role: role,
      days: ui.topPeriodDays,
      showIn: shouldShowIn(role),
      showOut: shouldShowOut(role),
      inRows: [],
      outRows: [],
      metaText: "",
      warningText: ""
    };

    if (!dash) {
      base.ok = false;
      base.warningText = "Top IN/OUT: FreezerDashboard saknas (ingen beräkning).";
      return base;
    }

    const res = dash.computeTopInOut(state || {}, ui.topPeriodDays) || {
      in: [],
      out: [],
      meta: { totalMoves: 0, usedMoves: 0, ignoredMoves: 0 },
      days: ui.topPeriodDays
    };

    const m = res.meta || {};
    base.inRows = Array.isArray(res.in) ? res.in : [];
    base.outRows = Array.isArray(res.out) ? res.out : [];
    base.metaText = `moves: total=${safeNum(m.totalMoves, 0)} • used=${safeNum(m.usedMoves, 0)} • ignored=${safeNum(m.ignoredMoves, 0)} • roll=${role}`;
    return base;
  }

  // -------- Render: DOM-only (tar VM + callbacks)
  const TopInOutView = (function () {
    let panelEl = null;

    function ensurePanel(mountEl) {
      try {
        if (!mountEl) return null;

        // panel ska vara först i dashCards
        if (!panelEl) {
          panelEl = byId("frzTopInOutPanel");
        }

        if (!panelEl) {
          panelEl = el("div");
          panelEl.id = "frzTopInOutPanel";
          panelEl.style.border = "1px solid #e6e6e6";
          panelEl.style.borderRadius = "12px";
          panelEl.style.padding = "12px";
          panelEl.style.background = "#fff";
          panelEl.style.marginBottom = "12px";
          mountEl.insertBefore(panelEl, mountEl.firstChild);
        } else {
          if (panelEl.parentNode !== mountEl) mountEl.insertBefore(panelEl, mountEl.firstChild);
          else if (mountEl.firstChild !== panelEl) mountEl.insertBefore(panelEl, mountEl.firstChild);
        }

        return panelEl;
      } catch {
        return null;
      }
    }

    function renderTable(titleText, rows) {
      const card = el("div");
      card.style.border = "1px solid #e6e6e6";
      card.style.borderRadius = "12px";
      card.style.padding = "10px";
      card.style.background = "#fafafa";

      const t = el("b");
      t.textContent = titleText;
      card.appendChild(t);

      const sub = el("div");
      sub.style.opacity = ".75";
      sub.style.fontSize = "12px";
      sub.style.marginTop = "4px";
      sub.textContent = `rader: ${Array.isArray(rows) ? rows.length : 0}`;
      card.appendChild(sub);

      const table = el("table");
      table.style.width = "100%";
      table.style.borderCollapse = "collapse";
      table.style.marginTop = "8px";
      table.setAttribute("aria-label", titleText);

      const thead = el("thead");
      const trh = el("tr");
      const th1 = el("th"); th1.textContent = "Artikel"; th1.style.textAlign = "left"; th1.style.padding = "6px";
      const th2 = el("th"); th2.textContent = "Qty"; th2.style.textAlign = "right"; th2.style.padding = "6px";
      const th3 = el("th"); th3.textContent = "Antal"; th3.style.textAlign = "right"; th3.style.padding = "6px";
      trh.appendChild(th1); trh.appendChild(th2); trh.appendChild(th3);
      thead.appendChild(trh);
      table.appendChild(thead);

      const tbody = el("tbody");

      const list = Array.isArray(rows) ? rows : [];
      if (list.length === 0) {
        const tr = el("tr");
        const td = el("td");
        td.colSpan = 3;
        td.style.padding = "10px 6px";
        td.style.opacity = ".75";
        td.textContent = "Inga träffar för perioden.";
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        for (const r of list) {
          const tr = el("tr");
          tr.style.borderTop = "1px solid #eee";

          const td1 = el("td");
          td1.style.padding = "8px 6px";
          td1.textContent = String((r && r.label) || "—");
          tr.appendChild(td1);

          const td2 = el("td");
          td2.style.padding = "8px 6px";
          td2.style.textAlign = "right";
          td2.textContent = String(safeNum(r && r.qty, 0));
          tr.appendChild(td2);

          const td3 = el("td");
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

    function mkPeriodBtn(days, isActive, onPickDays) {
      const b = el("button");
      b.type = "button";
      b.textContent = String(days);
      b.style.border = "1px solid #e6e6e6";
      b.style.background = "#fff";
      b.style.borderRadius = "999px";
      b.style.padding = "8px 12px";
      b.style.cursor = "pointer";
      b.style.fontSize = "14px";
      b.setAttribute("aria-pressed", isActive ? "true" : "false");
      if (isActive) b.style.fontWeight = "800";
      b.addEventListener("click", () => {
        if (typeof onPickDays === "function") onPickDays(days);
      });
      return b;
    }

    function render(panel, vm, handlers) {
      try {
        if (!panel || !vm) return;

        clear(panel);

        const headRow = el("div");
        headRow.style.display = "flex";
        headRow.style.gap = "10px";
        headRow.style.alignItems = "center";
        headRow.style.flexWrap = "wrap";

        const title = el("b");
        title.textContent = "Top 10 IN/OUT";
        headRow.appendChild(title);

        const hint = el("span");
        hint.style.opacity = ".75";
        hint.style.fontSize = "13px";
        hint.textContent = `Period: ${safeNum(vm.days, 30)} dagar`;
        headRow.appendChild(hint);

        const spacer = el("div");
        spacer.style.flex = "1";
        headRow.appendChild(spacer);

        const btnWrap = el("div");
        btnWrap.style.display = "inline-flex";
        btnWrap.style.gap = "8px";
        btnWrap.setAttribute("role", "group");
        btnWrap.setAttribute("aria-label", "Välj period för topplistor");

        const onPickDays = handlers && typeof handlers.onPickDays === "function" ? handlers.onPickDays : null;
        btnWrap.appendChild(mkPeriodBtn(7, vm.days === 7, onPickDays));
        btnWrap.appendChild(mkPeriodBtn(30, vm.days === 30, onPickDays));
        btnWrap.appendChild(mkPeriodBtn(90, vm.days === 90, onPickDays));

        headRow.appendChild(btnWrap);
        panel.appendChild(headRow);

        const hr = el("div");
        hr.style.height = "1px";
        hr.style.background = "#eee";
        hr.style.margin = "10px 0";
        panel.appendChild(hr);

        if (!vm.ok && vm.warningText) {
          const warn = el("div");
          warn.style.opacity = ".75";
          warn.textContent = String(vm.warningText);
          panel.appendChild(warn);
          return;
        }

        const showIn = !!vm.showIn;
        const showOut = !!vm.showOut;

        const grid = el("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "1fr";
        grid.style.gap = "12px";
        grid.style.marginTop = "8px";

        if (window.matchMedia && window.matchMedia("(min-width: 900px)").matches) {
          grid.style.gridTemplateColumns = (showIn && showOut) ? "1fr 1fr" : "1fr";
        } else {
          grid.style.gridTemplateColumns = "1fr";
        }

        if (showIn) grid.appendChild(renderTable("IN (Top 10)", vm.inRows || []));
        if (showOut) grid.appendChild(renderTable("OUT (Top 10)", vm.outRows || []));

        panel.appendChild(grid);

        const meta = el("div");
        meta.style.opacity = ".75";
        meta.style.fontSize = "12px";
        meta.style.marginTop = "10px";
        meta.textContent = String(vm.metaText || "");
        panel.appendChild(meta);
      } catch {
        // fail-soft
      }
    }

    return { ensurePanel, render };
  })();

  // -------- Controller: render adapter (bygger VM, kallar view)
  function renderTopInOutNow(stateOpt) {
    try {
      if (!dashCards) return;
      if (ui.activeTab !== "dashboard") return;

      const panel = TopInOutView.ensurePanel(dashCards);
      if (!panel) return;

      const state = stateOpt || safeGetState();
      const vm = computeTopInOutVM(state);

      TopInOutView.render(panel, vm, {
        onPickDays: function (days) {
          ui.topPeriodDays = days;
          renderTopInOutNow(safeGetState());
        }
      });
    } catch {
      // fail-soft
    }
  }

  // ------------------------------------------------------------
  // BOOT: init store + render
  // ------------------------------------------------------------
  const itemsUI = { itemsMsg: "—" };

  const initialRole = "ADMIN";
  if (!store || typeof store.init !== "function") {
    console.error("Freezer baseline saknar FreezerStore.");
    storeCorrupt = true;
  } else {
    try { store.init({ role: initialRole }); } catch (e) { markStoreCorrupt(e); }
  }

  try {
    const s = getStore();
    if (s && typeof s.subscribe === "function") {
      s.subscribe((state) => {
        syncTopbarIdentity();
        window.FreezerRender.renderAll(state || {}, itemsUI);
        window.FreezerRender.setActiveTabUI(ui.activeTab);
        syncCreateUserTopbarBtn();
        setHintForTab(ui.activeTab);

        // AO-02A: dashboard top panel (controller->VM->render)
        renderTopInOutNow(state || {});
      });
    }
  } catch (e) {
    markStoreCorrupt(e);
  }

  window.FreezerRender.renderAll(safeGetState(), itemsUI);
  window.FreezerRender.setActiveTabUI(ui.activeTab);
  syncCreateUserTopbarBtn();
  setHintForTab(ui.activeTab);

  // initial dashboard render
  renderTopInOutNow(safeGetState());

  // Legacy tabs
  function bindTab(btn, key) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      ui.activeTab = key;
      window.FreezerRender.setActiveTabUI(ui.activeTab);
      window.FreezerRender.renderAll(safeGetState(), itemsUI);
      syncCreateUserTopbarBtn();
      setHintForTab(ui.activeTab);

      renderTopInOutNow(safeGetState());
    });
  }

  bindTab(tabDashboard, "dashboard");
  bindTab(tabSaldo, "saldo");
  bindTab(tabHistorik, "history");

  // Reset demo
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const status = safeGetStatus();
      if (status.locked || status.readOnly) return;

      const s = getStore();
      try { if (s && typeof s.resetDemo === "function") s.resetDemo(); } catch (e) { markStoreCorrupt(e); }

      closeAnyModal();

      const st = safeGetState();
      window.FreezerRender.renderAll(st, itemsUI);
      syncCreateUserTopbarBtn();

      renderTopInOutNow(st);
    });
  }

  /* ÄNDRINGSLOGG (≤8)
  1) Renare ansvar: UI-state samlat i ui (activeTab, topPeriodDays) utan storage.
  2) AO-02A: Controller bygger VM via computeTopInOutVM(state) (ingen DOM).
  3) AO-02A: Render isolerad i TopInOutView (DOM-only, tar VM + callbacks).
  4) Klick 7/30/90 -> controller uppdaterar ui.topPeriodDays och rerender (ingen store-read i render).
  5) Panelen hålls först i #frzDashCards via ensurePanel (flytt vid rerender).
  6) Roll-gating (BUYER: IN, PICKER: OUT, ADMIN: båda) ligger i controller.
  7) Fail-soft bibehållen: om dashboard saknas visas varning, ingen krasch.
  */
})();
