/* ============================================================
AO-LOGIN-02 — Session-guard + BUYER controller | FIL: UI/pages/freezer/buyer/freezer-buyer.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- BUYER-sidan ska vara skyddad via session (förnamn + roll + expiry).
- Fail-closed: saknad/ogiltig session => rensa session + redirect till ../index.html
- Laddar FreezerStore efter registry-ready och renderar router-vyer via FreezerViewRegistry.

Policy:
- UI-only
- XSS-safe (textContent)
- Fail-closed
============================================================ */
(function () {
  "use strict";

  // INIT-GUARD
  if (window.__FRZ_BUYER_PAGE_INIT__) return;
  window.__FRZ_BUYER_PAGE_INIT__ = true;

  const SESSION_KEY = "FRZ_SESSION_V1"; // (AO-LOGIN) sessionStorage key
  const REQUIRED_ROLE = "BUYER";
  const LOGIN_URL = "../index.html";

  // DOM
  const elStatusText = byId("frzStatusText");
  const elModeText = byId("frzModeText");

  const lockPanel = byId("frzLockPanel");
  const lockReason = byId("frzLockReason");

  const debugPanel = byId("frzDebugPanel");
  const debugText = byId("frzDebugText");

  const viewMenu = byId("freezerViewMenu");
  const viewRoot = byId("freezerViewRoot");

  const fallback = byId("frzBuyerFallback");
  const resetBtn = byId("frzResetDemoBtn");

  // Router state
  let routerActiveViewId = "";
  let routerMountedView = null;

  // -----------------------------
  // Session (fail-closed)
  // -----------------------------
  function readSession() {
    try {
      const raw = window.sessionStorage ? window.sessionStorage.getItem(SESSION_KEY) : null;
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;

      const firstName = String(obj.firstName || "").trim();
      const role = String(obj.role || "").toUpperCase().trim();
      const exp = Number(obj.exp || 0);

      if (!firstName || !role || !Number.isFinite(exp)) return null;
      return { firstName, role, exp };
    } catch {
      return null;
    }
  }

  function clearSession() {
    try { window.sessionStorage && window.sessionStorage.removeItem(SESSION_KEY); } catch {}
  }

  function isExpired(expMs) {
    try { return Date.now() > Number(expMs || 0); } catch { return true; }
  }

  function hardRedirectToLogin() {
    try { window.location.replace(LOGIN_URL); } catch { window.location.href = LOGIN_URL; }
  }

  function enforceSessionOrRedirect() {
    const s = readSession();
    if (!s) { clearSession(); hardRedirectToLogin(); return null; }
    if (isExpired(s.exp)) { clearSession(); hardRedirectToLogin(); return null; }
    if (String(s.role) !== REQUIRED_ROLE) { hardRedirectToLogin(); return null; }
    return s;
  }

  // -----------------------------
  // Helpers
  // -----------------------------
  function byId(id) { return document.getElementById(id); }

  function setStatus(text) {
    if (elStatusText) elStatusText.textContent = String(text || "—");
  }

  function showLock(reason) {
    if (lockPanel) lockPanel.hidden = false;
    if (lockReason) lockReason.textContent = String(reason || "Orsak: okänd");
  }

  function hideLock() {
    if (lockPanel) lockPanel.hidden = true;
  }

  function showDebug(msg) {
    if (!debugPanel || !debugText) return;
    debugPanel.hidden = false;
    debugText.textContent = String(msg || "—");
  }

  function hideDebug() {
    if (!debugPanel) return;
    debugPanel.hidden = true;
  }

  function getRegistry() {
    try { return window.FreezerViewRegistry || null; } catch { return null; }
  }

  function getStore() {
    try { return window.FreezerStore || null; } catch { return null; }
  }

  function hasRender() {
    try { return !!window.FreezerRender; } catch { return false; }
  }

  function renderStatusAndMode() {
    try {
      const store = getStore();
      if (!store || typeof store.getStatus !== "function") return;
      const st = store.getStatus();

      // Status-pill
      setStatus(st.locked ? "LÅST" : "OK");

      // Mode-pill
      if (elModeText) {
        if (st.locked) elModeText.textContent = "LÅST";
        else if (st.readOnly) elModeText.textContent = "READ-ONLY";
        else elModeText.textContent = "FULL";
      }

      // Lock panel
      if (st.locked) showLock(st.reason || "Låst läge.");
      else hideLock();
    } catch {}
  }

  function buildViewCtx() {
    const store = getStore();
    const st = store && typeof store.getStatus === "function"
      ? store.getStatus()
      : { role: REQUIRED_ROLE, locked: true, readOnly: true, whyReadOnly: "Store saknas" };

    return {
      role: REQUIRED_ROLE,
      locked: !!st.locked,
      readOnly: !!st.readOnly,
      whyReadOnly: String(st.whyReadOnly || ""),
      can: function (perm) {
        // BUYER-sidan: permissions avgörs av store role-perms
        try {
          const s = getStore();
          if (!s) return false;
          if (typeof s.hasPerm === "function") return !!s.hasPerm(String(perm || ""));
          if (typeof s.can === "function") return !!s.can(String(perm || ""));
          return false;
        } catch { return false; }
      }
    };
  }

  // -----------------------------
  // Router
  // -----------------------------
  function initRouterMenu() {
    const reg = getRegistry();
    if (!viewMenu || !viewRoot || !reg || typeof reg.getViewsForRole !== "function") {
      showDebug("Router/Registry saknas. Kontrollera att 01-view-registry.js + buyer-vyer är laddade.");
      return;
    }

    hideDebug();

    const ctx = buildViewCtx();
    let views = [];
    try { views = reg.getViewsForRole(ctx.role) || []; } catch { views = []; }

    const menuItems = (typeof reg.toMenuItems === "function") ? reg.toMenuItems(views) : [];
    const visible = menuItems.filter((mi) => {
      if (!mi) return false;
      if (!mi.requiredPerm) return true;
      return !!ctx.can(mi.requiredPerm);
    });

    // Render menu (XSS-safe)
    viewMenu.textContent = "";
    for (const mi of visible) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tabBtn";
      b.setAttribute("data-view-id", mi.id);
      b.setAttribute("aria-selected", mi.id === routerActiveViewId ? "true" : "false");
      b.textContent = String(mi.label || mi.id);
      b.addEventListener("click", () => routerActivateView(mi.id));
      viewMenu.appendChild(b);
    }

    if (!routerActiveViewId && visible.length) routerActiveViewId = visible[0].id;
    if (routerActiveViewId && visible.length && !visible.some(x => x.id === routerActiveViewId)) {
      routerActiveViewId = visible[0].id;
    }

    if (visible.length) routerActivateView(routerActiveViewId || visible[0].id);
    else {
      // inga views -> tomt
      while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild);
      const box = document.createElement("div");
      box.className = "fallbackBox muted";
      box.textContent = "Inga vyer tillgängliga för rollen.";
      viewRoot.appendChild(box);
    }
  }

  function routerActivateView(viewId) {
    const reg = getRegistry();
    if (!viewRoot || !reg || typeof reg.getViewsForRole !== "function") return;

    const ctx = buildViewCtx();
    let views = [];
    try { views = reg.getViewsForRole(ctx.role) || []; } catch { views = []; }

    const id = String(viewId || "").trim();
    if (!id) return;

    const view = (typeof reg.findView === "function") ? reg.findView(views, id) : null;
    if (!view) return;

    // Unmount prev
    try {
      if (routerMountedView && typeof routerMountedView.unmount === "function") {
        routerMountedView.unmount({ root: viewRoot, ctx });
      }
    } catch {}

    while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild);

    routerMountedView = view;
    routerActiveViewId = id;

    // aria-selected
    try {
      const btns = viewMenu ? viewMenu.querySelectorAll("button[data-view-id]") : [];
      btns.forEach((b) => {
        const bid = b.getAttribute("data-view-id") || "";
        b.setAttribute("aria-selected", bid === routerActiveViewId ? "true" : "false");
      });
    } catch {}

    // Remove fallback if present
    try { if (fallback && fallback.parentNode) fallback.parentNode.removeChild(fallback); } catch {}

    // Mount + render
    try { if (typeof view.mount === "function") view.mount({ root: viewRoot, ctx }); } catch {}
    routerRerender();
  }

  function routerRerender() {
    const view = routerMountedView;
    if (!view || !viewRoot) return;

    const ctx = buildViewCtx();
    const store = getStore();
    const state = store && typeof store.getState === "function" ? store.getState() : {};

    try {
      if (typeof view.render === "function") view.render({ root: viewRoot, state, ctx });
    } catch (e) {
      const box = document.createElement("div");
      box.className = "panel danger";
      const b = document.createElement("b");
      b.textContent = "Vyn kunde inte renderas";
      const m = document.createElement("div");
      m.className = "muted";
      m.textContent = "Kontrollera Console för fel.";
      box.appendChild(b);
      box.appendChild(m);

      while (viewRoot.firstChild) viewRoot.removeChild(viewRoot.firstChild);
      viewRoot.appendChild(box);
      showDebug(String((e && e.message) ? e.message : "render-fel"));
    }
  }

  // -----------------------------
  // Boot (poll registry-ready)
  // -----------------------------
  const session = enforceSessionOrRedirect();
  if (!session) return;

  setStatus("Laddar…");
  hideLock();

  let pollTries = 0;
  const POLL_MAX = 60;       // ~3s
  const POLL_MS = 50;

  function pollReady() {
    pollTries++;

    const store = getStore();
    const reg = getRegistry();

    const storeOk = !!(store && typeof store.init === "function" && typeof store.subscribe === "function");
    const regOk = !!(reg && typeof reg.getViewsForRole === "function");

    if (storeOk && regOk) {
      try {
        // Init store as BUYER (role låst här)
        store.init({ role: REQUIRED_ROLE });

        // Subscribe -> rerender router + status/mode
        store.subscribe(() => {
          renderStatusAndMode();
          if (hasRender() && window.FreezerRender.renderDebug) {
            // valfritt
            try { window.FreezerRender.renderDebug(store.getState()); } catch {}
          }
          routerRerender();
        });

        renderStatusAndMode();
        initRouterMenu();
        routerRerender();

        // Reset demo (om ej read-only/locked)
        if (resetBtn) {
          resetBtn.addEventListener("click", () => {
            try {
              const st = store.getStatus();
              if (st.locked || st.readOnly) return;

              const r = store.resetDemo();
              if (!r || !r.ok) {
                showDebug("Reset misslyckades: " + String((r && r.reason) ? r.reason : "okänt fel"));
              } else {
                hideDebug();
                initRouterMenu();
                routerRerender();
              }
            } catch (e) {
              showDebug("Reset-fel: " + String((e && e.message) ? e.message : "okänt fel"));
            }
          });
        }

        setStatus("OK");
        return;
      } catch (e) {
        showLock("Init-fel: " + String((e && e.message) ? e.message : "okänt fel"));
        setStatus("LÅST");
        return;
      }
    }

    if (pollTries >= POLL_MAX) {
      showLock("Kunde inte initiera: Store/Registry saknas eller laddades inte.");
      setStatus("LÅST");
      showDebug("Kontrollera script paths + att buyer-vyerna finns.");
      return;
    }

    window.setTimeout(pollReady, POLL_MS);
  }

  window.setTimeout(pollReady, POLL_MS);

})();
