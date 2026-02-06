/* ============================================================
AO-06/15 — BUYER Controller (router + init) | FIL-ID: UI/pages/freezer/buyer/freezer-buyer.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Driver BUYER-sidan (buyer/freezer.html):
  - init: FreezerStore.init({ role:"BUYER" })
  - bygger meny från FreezerViewRegistry.getViewsForRole("BUYER")
  - mount/render/unmount av aktiv vy i #freezerViewRoot
  - status/mode/lock/reset demo (fail-closed friendly)

POLICY (LÅST):
- Ingen storage-ändring här (store sköter state)
- XSS-safe (DOM via createElement/textContent)
- Fail-closed: om registry/store saknas -> visa fallback och stoppa

Förväntade DOM-id i buyer/freezer.html:
- frzStatusText, frzStatusPill
- frzModeText
- frzLockPanel, frzLockReason
- frzDebugPanel, frzDebugText (valfritt)
- frzResetDemoBtn
- freezerViewMenu, freezerViewRoot, frzBuyerFallback (valfritt)

Kritisk koppling:
- UI/pages/freezer/01-view-registry.js (ESM) exponerar window.FreezerViewRegistry (bridge)
- UI/pages/freezer/03-store.js exponerar window.FreezerStore
============================================================ */

(function () {
  "use strict";

  /* =========================
  BLOCK 1 — DOM helpers
  ========================= */

  function $(id) {
    try { return document.getElementById(id); } catch { return null; }
  }

  function setText(el, txt) {
    try { if (el) el.textContent = String(txt == null ? "" : txt); } catch {}
  }

  function setHidden(el, hidden) {
    try { if (el) el.hidden = !!hidden; } catch {}
  }

  function clear(node) {
    try { while (node && node.firstChild) node.removeChild(node.firstChild); } catch {}
  }

  function mkBtn(label) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tabBtn";
    b.textContent = String(label || "—");
    return b;
  }

  /* =========================
  BLOCK 2 — State & ctx
  ========================= */

  var DOM = {
    statusText: $("frzStatusText"),
    statusPill: $("frzStatusPill"),
    modeText: $("frzModeText"),
    lockPanel: $("frzLockPanel"),
    lockReason: $("frzLockReason"),
    debugPanel: $("frzDebugPanel"),
    debugText: $("frzDebugText"),
    resetBtn: $("frzResetDemoBtn"),
    menu: $("freezerViewMenu"),
    root: $("freezerViewRoot"),
    fallback: $("frzBuyerFallback")
  };

  var active = {
    viewId: "",
    view: null,
    list: [],
    unsub: null,
    lastState: null,
    mounted: false
  };

  function buildCtx() {
    var s = window.FreezerStore;
    return {
      role: "BUYER",
      store: s || null,
      can: function (perm) {
        try {
          if (!s || typeof s.can !== "function") return false;
          return !!s.can(perm);
        } catch {
          return false;
        }
      }
    };
  }

  /* =========================
  BLOCK 3 — Status/lock UI
  ========================= */

  function renderStatus() {
    var s = window.FreezerStore;
    if (!s || typeof s.getStatus !== "function") {
      setText(DOM.statusText, "ERROR");
      try { DOM.statusPill && DOM.statusPill.classList && DOM.statusPill.classList.add("danger"); } catch {}
      return;
    }

    var st = null;
    try { st = s.getStatus(); } catch { st = null; }

    var locked = !!(st && st.locked);
    var readOnly = !!(st && st.readOnly);

    setText(DOM.statusText, locked ? "LÅST" : "OK");
    setText(DOM.modeText, readOnly ? "READ-ONLY" : "FULL");

    setHidden(DOM.lockPanel, !locked);
    if (locked) setText(DOM.lockReason, (st && st.reason) ? st.reason : "FRZ_E_LOCKED");

    // Reset-knapp
    try {
      if (DOM.resetBtn) DOM.resetBtn.disabled = locked || readOnly;
    } catch {}

    // pill klass (fail-soft)
    try {
      if (!DOM.statusPill || !DOM.statusPill.classList) return;
      DOM.statusPill.classList.remove("danger");
      DOM.statusPill.classList.remove("ok");
      DOM.statusPill.classList.add(locked ? "danger" : "ok");
    } catch {}
  }

  function renderDebug(msg) {
    // Valfri debug: visas bara om msg finns
    try {
      if (!DOM.debugPanel || !DOM.debugText) return;
      if (!msg) {
        DOM.debugPanel.hidden = true;
        return;
      }
      DOM.debugPanel.hidden = false;
      DOM.debugText.textContent = String(msg);
    } catch {}
  }

  /* =========================
  BLOCK 4 — Router: mount/render/unmount
  ========================= */

  function safeCall(fn, args) {
    try { return fn && typeof fn === "function" ? fn(args) : undefined; } catch { return undefined; }
  }

  function unmountActive() {
    try {
      if (!active.view) return;
      var ctx = buildCtx();
      safeCall(active.view.unmount, { root: DOM.root, ctx: ctx });
    } catch {}
    active.view = null;
    active.viewId = "";
    active.mounted = false;
    try { if (DOM.root) clear(DOM.root); } catch {}
  }

  function mountView(view) {
    if (!view) return false;
    if (!DOM.root) return false;

    var ctx = buildCtx();

    // Clear root before mount (stable)
    clear(DOM.root);

    // mount
    safeCall(view.mount, { root: DOM.root, ctx: ctx });

    // initial render (if supported)
    safeCall(view.render, { root: DOM.root, state: (active.lastState || {}), ctx: ctx });

    active.mounted = true;
    return true;
  }

  function renderActive() {
    try {
      if (!active.view || !active.mounted) return;
      var ctx = buildCtx();
      safeCall(active.view.render, { root: DOM.root, state: (active.lastState || {}), ctx: ctx });
    } catch {}
  }

  function setActiveViewById(id) {
    var reg = window.FreezerViewRegistry;
    if (!reg) return;

    var list = active.list || [];
    var v = null;
    try { v = reg.findView(list, id); } catch { v = null; }
    if (!v) return;

    // Lock/readOnly -> vi tillåter ändå navigation (read-only är ok), men om locked: stoppa
    var st = null;
    try { st = window.FreezerStore && window.FreezerStore.getStatus ? window.FreezerStore.getStatus() : null; } catch {}
    if (st && st.locked) {
      renderStatus();
      renderDebug("Låst läge: navigation stoppad.");
      return;
    }

    // unmount previous
    unmountActive();

    active.viewId = String(id || "");
    active.view = v;

    // mount new
    mountView(v);

    // update buttons aria-selected
    try {
      if (!DOM.menu) return;
      var btns = DOM.menu.querySelectorAll("button[data-view-id]");
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var isOn = (String(b.getAttribute("data-view-id") || "") === active.viewId);
        b.setAttribute("aria-selected", isOn ? "true" : "false");
      }
    } catch {}
  }

  function buildMenuForBuyer() {
    var reg = window.FreezerViewRegistry;
    if (!reg || !DOM.menu) return { ok: false, reason: "registry/menu saknas" };

    var list = [];
    try { list = reg.getViewsForRole("BUYER"); } catch { list = []; }
    active.list = Array.isArray(list) ? list : [];

    var items = [];
    try { items = reg.toMenuItems(active.list); } catch { items = []; }

    clear(DOM.menu);

    if (!items || !items.length) {
      var t = document.createElement("div");
      t.className = "muted";
      t.textContent = "Inga vyer hittades för inköpare.";
      DOM.menu.appendChild(t);
      return { ok: false, reason: "no-items" };
    }

    for (var i = 0; i < items.length; i++) {
      var it = items[i] || {};
      var btn = mkBtn(it.label || it.id || "—");
      btn.setAttribute("data-view-id", String(it.id || ""));
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", "false");

      // permission hint (fail-soft): disable knapp om saknar perm
      try {
        var req = it.requiredPerm;
        if (req && window.FreezerStore && typeof window.FreezerStore.can === "function") {
          var can = !!window.FreezerStore.can(req);
          if (!can) {
            btn.disabled = true;
            btn.title = "Saknar behörighet: " + String(req);
            btn.className = "tabBtn muted";
          }
        }
      } catch {}

      (function (viewId) {
        btn.addEventListener("click", function () {
          setActiveViewById(viewId);
        });
      })(String(it.id || ""));

      DOM.menu.appendChild(btn);
    }

    return { ok: true };
  }

  /* =========================
  BLOCK 5 — Init: store + subscribe + registry-wait
  ========================= */

  function initStoreBuyer() {
    var s = window.FreezerStore;
    if (!s || typeof s.init !== "function") return { ok: false, reason: "FreezerStore saknas" };

    try { s.init({ role: "BUYER" }); } catch (e) { return { ok: false, reason: (e && e.message) ? e.message : "init-fail" }; }

    // bind reset demo
    try {
      if (DOM.resetBtn) {
        DOM.resetBtn.addEventListener("click", function () {
          try {
            var st = s.getStatus ? s.getStatus() : null;
            if (st && (st.locked || st.readOnly)) return;
            if (typeof s.resetDemo === "function") s.resetDemo();
          } catch {}
        });
      }
    } catch {}

    // subscribe
    try {
      if (typeof s.subscribe === "function") {
        active.unsub = s.subscribe(function (stateSnap) {
          active.lastState = stateSnap || {};
          renderStatus();
          // render active view on every state change
          renderActive();
        });
      }
    } catch {}

    renderStatus();
    return { ok: true };
  }

  function waitForRegistryThenStart() {
    var tries = 0;
    var maxTries = 80; // ~4s @ 50ms
    var timer = null;

    function tick() {
      tries++;

      var reg = window.FreezerViewRegistry;
      if (reg && typeof reg.getViewsForRole === "function" && typeof reg.findView === "function") {
        try {
          if (DOM.fallback) DOM.fallback.hidden = true;
        } catch {}

        var m = buildMenuForBuyer();
        if (!m.ok) {
          renderDebug("Kunde inte bygga meny: " + (m.reason || "okänt"));
          return;
        }

        // Auto-activate första vyn
        try {
          var first = DOM.menu && DOM.menu.querySelector("button[data-view-id]");
          if (first) {
            var vid = String(first.getAttribute("data-view-id") || "");
            if (vid) setActiveViewById(vid);
          }
        } catch {}

        if (timer) clearInterval(timer);
        return;
      }

      if (tries >= maxTries) {
        // Fail-closed friendly: visa fallback och stoppa
        try {
          if (DOM.fallback) {
            DOM.fallback.hidden = false;
            DOM.fallback.textContent = "Kunde inte ladda vy-registret (FreezerViewRegistry). Kontrollera att 01-view-registry.js laddas utan fel.";
          }
        } catch {}
        renderDebug("Registry saknas efter timeout.");
        if (timer) clearInterval(timer);
      }
    }

    timer = setInterval(tick, 50);
    tick();
  }

  /* =========================
  BLOCK 6 — Boot
  ========================= */

  (function boot() {
    // Basic fail-soft: om root/menu saknas -> inget att göra
    if (!DOM.menu || !DOM.root) {
      renderDebug("DOM saknas (freezerViewMenu/freezerViewRoot).");
      return;
    }

    // init store
    var initRes = initStoreBuyer();
    if (!initRes.ok) {
      renderStatus();
      try {
        if (DOM.fallback) {
          DOM.fallback.hidden = false;
          DOM.fallback.textContent = "Start misslyckades: " + String(initRes.reason || "FreezerStore.init()");
        }
      } catch {}
      renderDebug("Store init fail: " + String(initRes.reason || "okänt"));
      return;
    }

    // wait for registry (ESM)
    waitForRegistryThenStart();
  })();

})();

