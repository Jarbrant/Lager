/* ============================================================
AO-05/15 — Picker Controller (router + menu) | FIL-ID: UI/pages/freezer/picker/freezer-picker.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Startar PICKER-sidan: väntar på ESM registry + views, bygger meny, router (mount/render/unmount).
- Fail-closed: om registry/store saknas -> visar tydlig status och inga actions.
- P0: init får inte ske innan FreezerViewRegistry är redo (pollar med timeout).

POLICY (LÅST):
- UI-only • inga nya storage-keys/datamodell
- XSS-safe: inga innerHTML, endast textContent + createElement
- Inga sid-effekter utanför DOM-uppdateringar
============================================================ */

(() => {
  "use strict";

  /* =========================
  BLOCK 0 — DOM hooks (måste matcha picker/freezer.html)
  ========================= */
  const elStatusText = /** @type {HTMLElement|null} */ (document.getElementById("frzStatusText"));
  const elModeText = /** @type {HTMLElement|null} */ (document.getElementById("frzModeText"));
  const elStatusPill = /** @type {HTMLElement|null} */ (document.getElementById("frzStatusPill"));
  const elMenu = /** @type {HTMLElement|null} */ (document.getElementById("freezerViewMenu"));
  const elRoot = /** @type {HTMLElement|null} */ (document.getElementById("freezerViewRoot"));
  const elFallback = /** @type {HTMLElement|null} */ (document.getElementById("frzPickerFallback"));
  const elLockPanel = /** @type {HTMLElement|null} */ (document.getElementById("frzLockPanel"));
  const elLockReason = /** @type {HTMLElement|null} */ (document.getElementById("frzLockReason"));
  const elDebugPanel = /** @type {HTMLElement|null} */ (document.getElementById("frzDebugPanel"));
  const elDebugText = /** @type {HTMLElement|null} */ (document.getElementById("frzDebugText"));
  const elResetDemoBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById("frzResetDemoBtn"));

  /* =========================
  BLOCK 1 — Helpers (XSS-safe)
  ========================= */
  function setText(node, text) {
    try { if (node) node.textContent = String(text == null ? "" : text); } catch {}
  }

  function clear(node) {
    try { while (node && node.firstChild) node.removeChild(node.firstChild); } catch {}
  }

  function show(node, yes) {
    try { if (!node) return; node.hidden = !yes; } catch {}
  }

  function pillState(kind) {
    // kind: "ok" | "warn" | "err" | null
    try {
      if (!elStatusPill) return;
      elStatusPill.classList.remove("danger", "ok");
      if (kind === "err") elStatusPill.classList.add("danger");
      if (kind === "ok") elStatusPill.classList.add("ok");
    } catch {}
  }

  function nowMs() {
    try { return Date.now(); } catch { return 0; }
  }

  function safeStr(v) {
    try { return String(v == null ? "" : v); } catch { return ""; }
  }

  /* =========================
  BLOCK 2 — ReadOnly policy (fail-closed friendly)
  - Om core har flaggor, respektera dem, annars default write.
  ========================= */
  function computeReadOnly() {
    try {
      const c = window.FreezerCore || window.FREEZER_CORE || null;
      if (c && typeof c.isReadOnly === "function") return !!c.isReadOnly();
      if (c && typeof c.readOnly === "boolean") return !!c.readOnly;
    } catch {}
    return false;
  }

  function buildCtx() {
    const readOnly = computeReadOnly();
    return {
      role: "picker",
      readOnly,
      isReadOnly: readOnly,
      store: window.FreezerStore || null
    };
  }

  /* =========================
  BLOCK 3 — Wait for Registry (P0)
  - Väntar på window.FreezerViewRegistry + getViewsForRole
  ========================= */
  function waitForRegistryReady(timeoutMs) {
    const start = nowMs();
    const limit = typeof timeoutMs === "number" ? timeoutMs : 4000;

    return new Promise((resolve) => {
      const tick = () => {
        try {
          const r = window.FreezerViewRegistry || null;
          if (r && typeof r.getViewsForRole === "function" && typeof r.findView === "function" && typeof r.toMenuItems === "function") {
            resolve({ ok: true, registry: r });
            return;
          }
        } catch {}

        if (nowMs() - start >= limit) {
          resolve({ ok: false, registry: null });
          return;
        }

        try { setTimeout(tick, 60); } catch { resolve({ ok: false, registry: null }); }
      };

      tick();
    });
  }

  /* =========================
  BLOCK 4 — Router state
  ========================= */
  const _router = {
    views: /** @type {any[]} */ ([]),
    menu: /** @type {{id:string,label:string,requiredPerm:any}[]} */ ([]),
    activeId: "",
    activeView: null,
    activeMounted: false,
    ctx: null
  };

  function getDefaultViewId(menuItems) {
    const list = Array.isArray(menuItems) ? menuItems : [];
    for (let i = 0; i < list.length; i++) {
      const id = safeStr(list[i] && list[i].id).trim();
      if (id) return id;
    }
    return "";
  }

  function readHashViewId() {
    try {
      const h = safeStr(location.hash || "");
      const v = h.startsWith("#") ? h.slice(1) : h;
      return safeStr(v).trim();
    } catch {
      return "";
    }
  }

  function writeHashViewId(id) {
    try {
      const vid = safeStr(id).trim();
      if (!vid) return;
      if (location.hash !== "#" + vid) location.hash = "#" + vid;
    } catch {}
  }

  function mountActive(view) {
    try {
      if (!view) return;
      if (!elRoot) return;

      // root innehåller fallback div också – städa allt, sen mount
      clear(elRoot);
      _router.activeMounted = false;

      if (typeof view.mount === "function") {
        view.mount({ root: elRoot, ctx: _router.ctx || {} });
      }
      _router.activeMounted = true;

      if (typeof view.render === "function") {
        view.render({ root: elRoot, ctx: _router.ctx || {}, state: {} });
      }
    } catch (e) {
      renderFatal("Mount/render misslyckades: " + safeStr(e && e.message ? e.message : "okänt fel"));
    }
  }

  function unmountActive() {
    try {
      if (_router.activeView && typeof _router.activeView.unmount === "function") {
        _router.activeView.unmount({ root: elRoot, ctx: _router.ctx || {}, state: {} });
      }
    } catch {}
    _router.activeView = null;
    _router.activeMounted = false;
    try {
      if (elRoot) {
        clear(elRoot);
        if (elFallback) elRoot.appendChild(elFallback);
      }
    } catch {}
  }

  function setActiveViewById(registry, id) {
    const vid = safeStr(id).trim();
    if (!vid) return;

    if (_router.activeId === vid && _router.activeMounted) {
      try {
        if (_router.activeView && typeof _router.activeView.render === "function") {
          _router.activeView.render({ root: elRoot, ctx: _router.ctx || {}, state: {} });
        }
      } catch {}
      return;
    }

    unmountActive();

    const v = registry.findView(_router.views, vid);
    if (!v) {
      renderFatal("Vyn finns inte: " + vid);
      return;
    }

    _router.activeId = vid;
    _router.activeView = v;
    mountActive(v);

    // markera meny
    try {
      const btns = elMenu ? elMenu.querySelectorAll("button[data-view-id]") : [];
      for (let i = 0; i < btns.length; i++) {
        const b = /** @type {HTMLButtonElement} */ (btns[i]);
        const bid = safeStr(b.getAttribute("data-view-id"));
        b.setAttribute("aria-selected", bid === vid ? "true" : "false");
      }
    } catch {}
  }

  /* =========================
  BLOCK 5 — Menu render
  ========================= */
  function renderMenu(registry) {
    if (!elMenu) return;

    clear(elMenu);

    const list = Array.isArray(_router.menu) ? _router.menu : [];
    if (!list.length) {
      const b = document.createElement("div");
      b.className = "muted";
      b.textContent = "Inga vyer registrerade än.";
      elMenu.appendChild(b);
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const it = list[i] || {};
      const id = safeStr(it.id).trim();
      const label = safeStr(it.label || id).trim() || id;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tabBtn";
      btn.textContent = label;
      btn.setAttribute("data-view-id", id);
      btn.setAttribute("aria-selected", "false");

      btn.addEventListener("click", () => {
        writeHashViewId(id);
        setActiveViewById(registry, id);
      });

      elMenu.appendChild(btn);
    }
  }

  /* =========================
  BLOCK 6 — Error/fallback UI
  ========================= */
  function renderFatal(reason) {
    pillState("err");
    setText(elStatusText, "Fel");
    setText(elLockReason, "Orsak: " + safeStr(reason || "okänd"));
    show(elLockPanel, true);
    show(elDebugPanel, true);
    setText(elDebugText, safeStr(reason || "—"));

    // disable reset
    try { if (elResetDemoBtn) elResetDemoBtn.disabled = true; } catch {}

    // root fallback
    try {
      if (elRoot) {
        clear(elRoot);
        const box = document.createElement("div");
        box.className = "fallbackBox";
        const b = document.createElement("b");
        b.textContent = "Sidan kunde inte starta";
        const d = document.createElement("div");
        d.className = "muted";
        d.style.marginTop = "6px";
        d.textContent = safeStr(reason || "Okänt fel");

        box.appendChild(b);
        box.appendChild(d);
        elRoot.appendChild(box);
      }
    } catch {}
  }

  function setOkStatus(text) {
    pillState("ok");
    setText(elStatusText, text || "OK");
    show(elLockPanel, false);
  }

  function setLoading(text) {
    pillState(null);
    setText(elStatusText, text || "Laddar…");
    show(elLockPanel, false);
  }

  /* =========================
  BLOCK 7 — Demo reset (fail-closed)
  - Bara om store har resetDemo och inte read-only
  ========================= */
  function wireResetDemo() {
    try {
      if (!elResetDemoBtn) return;
      const ctx = _router.ctx || buildCtx();

      const ro = !!(ctx.readOnly || ctx.isReadOnly);
      if (ro) {
        elResetDemoBtn.disabled = true;
        elResetDemoBtn.title = "Read-only: kan inte återställa demo.";
        return;
      }

      const store = ctx.store || window.FreezerStore || null;
      if (!store || typeof store.resetDemo !== "function") {
        // fail-soft: göm/disable
        elResetDemoBtn.disabled = true;
        elResetDemoBtn.title = "resetDemo() saknas i FreezerStore.";
        return;
      }

      elResetDemoBtn.disabled = false;

      elResetDemoBtn.addEventListener("click", () => {
        try {
          const res = store.resetDemo();
          if (!res || res.ok !== true) {
            show(elDebugPanel, true);
            setText(elDebugText, "resetDemo misslyckades: " + safeStr(res && res.reason ? res.reason : "okänt"));
            return;
          }
          show(elDebugPanel, true);
          setText(elDebugText, "Demo återställd.");
          // rerender aktiv vy
          try {
            if (_router.activeView && typeof _router.activeView.render === "function") {
              _router.activeView.render({ root: elRoot, ctx: _router.ctx || {}, state: {} });
            }
          } catch {}
        } catch (e) {
          show(elDebugPanel, true);
          setText(elDebugText, "resetDemo error: " + safeStr(e && e.message ? e.message : "okänt"));
        }
      });
    } catch {}
  }

  /* =========================
  BLOCK 8 — Boot
  ========================= */
  async function boot() {
    setLoading("Laddar registry…");

    // Mode text
    const ro = computeReadOnly();
    setText(elModeText, ro ? "read-only" : "write");

    const regRes = await waitForRegistryReady(4500);
    if (!regRes || regRes.ok !== true || !regRes.registry) {
      renderFatal("FreezerViewRegistry är inte redo. Kontrollera <script type=\"module\">-ordning och paths.");
      return;
    }

    const registry = regRes.registry;

    // Store check (fail-closed för actions, men sidan får starta)
    const ctx = buildCtx();
    _router.ctx = ctx;

    if (!ctx.store) {
      show(elDebugPanel, true);
      setText(elDebugText, "FreezerStore saknas (03-store.js). Vyer kan bli begränsade.");
    }

    // Hämta vyer för picker från registry
    try {
      _router.views = registry.getViewsForRole("picker") || [];
      _router.menu = registry.toMenuItems(_router.views) || [];
    } catch (e) {
      renderFatal("Kunde inte läsa vyer från registry: " + safeStr(e && e.message ? e.message : "okänt"));
      return;
    }

    // Om inga pickerViews ännu → visa tydligt
    if (!_router.menu.length) {
      setOkStatus("Redo (inga vyer ännu)");
      show(elDebugPanel, true);
      setText(elDebugText, "pickerViews är tom. Lägg till vyer i 01-view-registry.js (pickerViews.push(...)).");
      // visa fallback
      try {
        if (elRoot) {
          clear(elRoot);
          const box = document.createElement("div");
          box.className = "fallbackBox muted";
          box.textContent = "Inga vyer registrerade ännu.";
          elRoot.appendChild(box);
        }
      } catch {}
      wireResetDemo();
      return;
    }

    // Render meny
    renderMenu(registry);

    // Bestäm aktiv vy
    const fromHash = readHashViewId();
    const first = getDefaultViewId(_router.menu);
    const target = fromHash || first;

    // Mount
    setOkStatus("Redo");
    setActiveViewById(registry, target);

    // hash change
    window.addEventListener("hashchange", () => {
      const id = readHashViewId();
      if (id) setActiveViewById(registry, id);
    });

    // reset
    wireResetDemo();
  }

  // start
  try { boot(); } catch (e) { renderFatal("Boot error: " + safeStr(e && e.message ? e.message : "okänt")); }
})();
