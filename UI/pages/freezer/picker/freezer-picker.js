/* ============================================================
AO-05/15 — PICKER Controller (PROD) | FIL-ID: UI/pages/freezer/picker/freezer-picker.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Robust controller för picker/freezer.html:
  - Väntar/pollar tills ESM-registry (window.FreezerViewRegistry) är redo.
  - Fail-closed: om registry/store saknas -> visa tydlig fallback, inga actions.
  - Router: bygger meny, mount/render/unmount vyer säkert.
  - (Valfritt) försöker lazy-importa picker-vyer om de finns (utan att krascha om 404).

POLICY (LÅST):
- UI-only • inga nya storage-keys/datamodell
- XSS-safe: ingen innerHTML (endast textContent/createElement)
- Inga sid-effekter före registry-ready
============================================================ */

(() => {
  "use strict";

  /* =========================
  BLOCK 0 — DOM hooks
  ========================= */
  const $ = (id) => document.getElementById(id);

  const elStatusText = $("frzStatusText");
  const elModeText = $("frzModeText");
  const elLockPanel = $("frzLockPanel");
  const elLockReason = $("frzLockReason");
  const elDebugPanel = $("frzDebugPanel");
  const elDebugText = $("frzDebugText");
  const elMenu = $("freezerViewMenu");
  const elRoot = $("freezerViewRoot");
  const elFallback = $("frzPickerFallback");
  const btnResetDemo = $("frzResetDemoBtn");

  /* =========================
  BLOCK 1 — Minimal UI helpers (XSS-safe)
  ========================= */
  function setText(node, text) {
    try {
      if (!node) return;
      node.textContent = String(text == null ? "" : text);
    } catch {}
  }

  function show(node, on) {
    try {
      if (!node) return;
      node.hidden = !on;
    } catch {}
  }

  function clear(node) {
    try {
      if (!node) return;
      while (node.firstChild) node.removeChild(node.firstChild);
    } catch {}
  }

  function pillMsg(text, kind) {
    const d = document.createElement("div");
    d.style.padding = "10px";
    d.style.borderRadius = "10px";
    d.style.border = "1px solid #e6e6e6";
    d.style.background = "#fff";
    d.style.fontSize = "14px";
    d.style.marginTop = "8px";
    d.textContent = String(text || "");

    if (kind === "ok") {
      d.style.borderColor = "#cfe9cf";
      d.style.background = "#f4fff4";
    } else if (kind === "warn") {
      d.style.borderColor = "#ffe0a6";
      d.style.background = "#fffaf0";
    } else if (kind === "err") {
      d.style.borderColor = "#f2b8b5";
      d.style.background = "#fff5f5";
    }
    return d;
  }

  function debug(msg) {
    try {
      if (!elDebugPanel || !elDebugText) return;
      show(elDebugPanel, true);
      setText(elDebugText, msg || "—");
    } catch {}
  }

  function lock(reason) {
    try {
      show(elLockPanel, true);
      setText(elLockReason, reason || "Orsak: okänd");
    } catch {}
  }

  function unlock() {
    try {
      show(elLockPanel, false);
      setText(elLockReason, "");
    } catch {}
  }

  function setStatus(text) {
    setText(elStatusText, text || "—");
  }

  function setMode(readOnly) {
    setText(elModeText, readOnly ? "read-only" : "write");
  }

  /* =========================
  BLOCK 2 — Registry/store readiness (poll)
  ========================= */
  const READY_TIMEOUT_MS = 6000;
  const POLL_MS = 60;

  function isRegistryReady() {
    try {
      const r = window.FreezerViewRegistry;
      return !!(
        r &&
        typeof r.getViewsForRole === "function" &&
        typeof r.findView === "function" &&
        typeof r.toMenuItems === "function"
      );
    } catch {
      return false;
    }
  }

  function isStoreReady() {
    try {
      return !!window.FreezerStore;
    } catch {
      return false;
    }
  }

  function waitForReady() {
    return new Promise((resolve) => {
      const t0 = Date.now();

      const tick = () => {
        const okReg = isRegistryReady();
        const okStore = isStoreReady();
        if (okReg && okStore) return resolve({ ok: true, why: "" });

        if (Date.now() - t0 > READY_TIMEOUT_MS) {
          const why = !okReg
            ? "FreezerViewRegistry saknas/är inte redo (ESM registry)."
            : "FreezerStore saknas (03-store.js).";
          return resolve({ ok: false, why });
        }

        setTimeout(tick, POLL_MS);
      };

      tick();
    });
  }

  /* =========================
  BLOCK 3 — Optional lazy imports of picker views (fail-soft)
  (Om filerna inte finns -> ignoreras)
  ========================= */
  async function tryImportPickerViews() {
    // OBS: dessa imports kraschar inte appen om de saknas
    // (det blir catch + debug-notis).
    const paths = [
      // din placeholder-vy:
      "../UI/pages/freezer/picker/picker-out.js",
      // valfritt om den finns:
      "../UI/pages/freezer/picker/picker-dashboard.js"
    ];

    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      try {
        // @vite-ignore / bundler-agnostic
        await import(p);
      } catch (e) {
        // fail-soft: inga 404 ska krascha sidan
        // Visa inte debug om allt fungerar i övrigt.
        // Men om du vill se det: slå på debug.
        // debug("Valfri vy saknas: " + p);
        void e;
      }
    }
  }

  /* =========================
  BLOCK 4 — Controller state
  ========================= */
  const STATE = {
    role: "picker",
    readOnly: true,
    store: null,
    registry: null,
    views: [],
    menuItems: [],
    activeViewId: "",
    activeView: null
  };

  function computeReadOnly() {
    // Fail-closed default = read-only om vi är osäkra
    try {
      const c = window.FreezerContract;
      if (c && typeof c.isReadOnly === "function") return !!c.isReadOnly();
      if (window.__FREEZER_READ_ONLY === true) return true;
      // Om inget kontrakt: anta write för demo, men bara om store finns.
      return false;
    } catch {
      return true;
    }
  }

  function buildCtx() {
    return {
      role: STATE.role,
      store: STATE.store,
      readOnly: STATE.readOnly,
      isReadOnly: STATE.readOnly
    };
  }

  /* =========================
  BLOCK 5 — Router: safe call adapters (mount/render/unmount)
  Stödjer både:
    view.mount(root, ctx)
    view.mount({root, ctx, state})
  ========================= */
  function safeMount(view, root, ctx) {
    try {
      if (!view || typeof view.mount !== "function") return;
      // försöker båda signaturer
      try {
        view.mount({ root, ctx, state: {} });
        return;
      } catch {}
      try {
        view.mount(root, ctx);
      } catch {}
    } catch {}
  }

  function safeRender(view, root, ctx) {
    try {
      if (!view || typeof view.render !== "function") return;
      try {
        view.render({ root, ctx, state: {} });
        return;
      } catch {}
      try {
        view.render(root, ctx);
      } catch {}
    } catch {}
  }

  function safeUnmount(view, root, ctx) {
    try {
      if (!view || typeof view.unmount !== "function") return;
      try {
        view.unmount({ root, ctx, state: {} });
        return;
      } catch {}
      try {
        view.unmount(root, ctx);
      } catch {}
    } catch {}
  }

  /* =========================
  BLOCK 6 — Menu + navigation (no storage)
  ========================= */
  function getRouteViewId() {
    try {
      const h = String(location.hash || "");
      // stöd: #picker-out eller #view=picker-out
      if (h.startsWith("#view=")) return decodeURIComponent(h.slice(6));
      if (h.startsWith("#")) return decodeURIComponent(h.slice(1));
      return "";
    } catch {
      return "";
    }
  }

  function setRouteViewId(id) {
    try {
      const vid = String(id || "");
      if (!vid) return;
      // enkel hash: #picker-out
      location.hash = "#" + encodeURIComponent(vid);
    } catch {}
  }

  function renderMenu() {
    clear(elMenu);

    const items = Array.isArray(STATE.menuItems) ? STATE.menuItems : [];
    if (!items.length) {
      if (elMenu) elMenu.appendChild(pillMsg("Inga vyer registrerade för Plockare ännu.", "warn"));
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tabBtn";
      btn.setAttribute("data-view-id", String(it.id || ""));
      btn.setAttribute("aria-selected", "false");
      btn.textContent = String(it.label || it.id || "—");

      btn.addEventListener("click", () => {
        const vid = String(it.id || "");
        if (!vid) return;
        navigateTo(vid);
      });

      elMenu && elMenu.appendChild(btn);
    }

    syncMenuSelected();
  }

  function syncMenuSelected() {
    try {
      const vid = String(STATE.activeViewId || "");
      const buttons = elMenu ? elMenu.querySelectorAll("button[data-view-id]") : [];
      for (let i = 0; i < buttons.length; i++) {
        const b = buttons[i];
        const id = b.getAttribute("data-view-id") || "";
        b.setAttribute("aria-selected", id === vid ? "true" : "false");
      }
    } catch {}
  }

  function showFallback(text, kind) {
    try {
      // använd befintlig fallback-div om den finns
      if (elFallback) {
        elFallback.hidden = false;
        setText(elFallback, text || "—");
        return;
      }
    } catch {}

    try {
      // annars rendera i root
      clear(elRoot);
      elRoot && elRoot.appendChild(pillMsg(text || "—", kind || "warn"));
    } catch {}
  }

  function hideFallback() {
    try {
      if (elFallback) elFallback.hidden = true;
    } catch {}
  }

  function navigateTo(viewId) {
    const vid = String(viewId || "").trim();
    if (!vid) return;

    const ctx = buildCtx();

    // hitta vy
    const v = STATE.registry.findView(STATE.views, vid);
    if (!v) {
      STATE.activeViewId = vid;
      syncMenuSelected();
      setRouteViewId(vid);
      showFallback("Vyn finns inte (id=" + vid + ").", "err");
      return;
    }

    // unmount föregående
    try {
      if (STATE.activeView && STATE.activeViewId && elRoot) {
        safeUnmount(STATE.activeView, elRoot, ctx);
      }
    } catch {}

    // mount ny
    STATE.activeViewId = vid;
    STATE.activeView = v;
    syncMenuSelected();
    setRouteViewId(vid);

    try {
      hideFallback();
      // försök rensa root innan mount
      clear(elRoot);
      safeMount(v, elRoot, ctx);
      safeRender(v, elRoot, ctx);
      setStatus("Redo");
    } catch {
      showFallback("Kunde inte montera vyn (id=" + vid + ").", "err");
    }
  }

  function handleHashChange() {
    const vid = getRouteViewId();
    if (!vid) return;
    if (vid === STATE.activeViewId) return;
    navigateTo(vid);
  }

  /* =========================
  BLOCK 7 — Reset demo (fail-closed)
  ========================= */
  function wireResetDemo() {
    if (!btnResetDemo) return;

    btnResetDemo.addEventListener("click", () => {
      try {
        if (STATE.readOnly) {
          debug("Read-only: Demo-reset är avstängt.");
          return;
        }
        const s = STATE.store;
        if (!s || typeof s.resetDemo !== "function") {
          debug("FreezerStore.resetDemo() saknas.");
          return;
        }
        const res = s.resetDemo();
        if (res && res.ok === false) {
          debug("Demo-reset misslyckades: " + String(res.reason || "okänt"));
          return;
        }
        setStatus("Demo återställd");
        // re-render aktiv vy
        if (STATE.activeView && elRoot) safeRender(STATE.activeView, elRoot, buildCtx());
      } catch {
        debug("Demo-reset: fel (catch).");
      }
    });
  }

  /* =========================
  BLOCK 8 — Boot
  ========================= */
  async function boot() {
    setStatus("Laddar…");
    setMode(true);
    unlock();
    show(elDebugPanel, false);

    // baseline: visa fallback text
    showFallback("Laddar vyer…", "warn");

    // vänta tills registry + store är redo
    const ready = await waitForReady();
    if (!ready.ok) {
      lock(ready.why);
      setStatus("Stoppad");
      setMode(true);
      showFallback("Kan inte starta: " + ready.why, "err");
      return;
    }

    // optional lazy-import av picker-vyer (om de finns)
    await tryImportPickerViews();

    // state init
    STATE.store = window.FreezerStore || null;
    STATE.registry = window.FreezerViewRegistry;
    STATE.readOnly = computeReadOnly();

    setMode(STATE.readOnly);
    setStatus("Init…");
    unlock();
    wireResetDemo();

    // views
    const views = STATE.registry.getViewsForRole(STATE.role);
    STATE.views = Array.isArray(views) ? views : [];
    STATE.menuItems = STATE.registry.toMenuItems(STATE.views);

    renderMenu();

    if (!STATE.menuItems.length) {
      setStatus("Redo");
      showFallback("Inga plock-vyer är registrerade ännu. (Lägg till pickerViews/picker-out senare.)", "warn");
      return;
    }

    // route/default
    const fromHash = getRouteViewId();
    const first = STATE.menuItems[0] ? String(STATE.menuItems[0].id || "") : "";
    const target = fromHash || first;

    // lyssna hash
    window.addEventListener("hashchange", handleHashChange);

    // navigera
    navigateTo(target);
  }

  // Start
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  } catch {
    // fail-soft
  }
})();

