/* ============================================================
AO-05/15 — BUYER Controller (router + menu + mount) | FIL-ID: UI/pages/freezer/buyer/freezer-buyer.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Gör buyer/freezer.html fungerande:
  - Bygger router-meny (EXAKT 4 BUYER-rutor) via FreezerViewRegistry
  - Mountar aktiv vy i #freezerViewRoot
  - Fail-closed: om registry/router/store saknas -> visa fallback + lås-panel

POLICY (LÅST):
- UI-only • inga nya storage-keys/datamodell
- XSS-safe: textContent + createElement
- P0: får INTE init före ESM registry är redo -> väntar/pollar (defer + guard)
============================================================ */

(function () {
  "use strict";

  /* =========================
  BLOCK 0 — Kontrakt: EXAKT 4 BUYER-rutor i menyn (AO-05/15)
  ========================= */

  const BUYER_MENU_ALLOWLIST = [
    "buyer-supplier-new",     // Ny Leverantör
    "buyer-item-new",         // Ny produkt
    "buyer-stock-in",         // Lägga in produkter
    "buyer-supplier-search"   // Sök Leverantör
    // OBS: buyer-saldo finns i registry men ska INTE synas i buyer-menyn i AO-05/15
  ];

  /* =========================
  BLOCK 1 — DOM helpers + safe utils
  ========================= */

  function $(id) { return document.getElementById(id); }

  function safeStr(v) {
    try { return String(v == null ? "" : v); } catch { return ""; }
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = safeStr(text);
    return n;
  }

  function clear(root) {
    try { while (root && root.firstChild) root.removeChild(root.firstChild); } catch {}
  }

  function setHidden(node, hidden) {
    try { if (!node) return; node.hidden = !!hidden; } catch {}
  }

  function setText(node, text) {
    try { if (node) node.textContent = safeStr(text); } catch {}
  }

  /* =========================
  BLOCK 2 — Guards (fail-closed)
  ========================= */

  function getRegistry() {
    try { return window.FreezerViewRegistry || null; } catch { return null; }
  }

  function getStore() {
    try { return window.FreezerStore || null; } catch { return null; }
  }

  function getRender() {
    // optional helper (fail-soft)
    try { return window.FreezerRender || null; } catch { return null; }
  }

  function computeStatus(store) {
    // Return { ok:boolean, locked:boolean, readOnly:boolean, reason?:string, modeLabel:string }
    try {
      if (!store) return { ok: false, locked: true, readOnly: true, reason: "FreezerStore saknas", modeLabel: "LÅST" };
      if (typeof store.getStatus === "function") {
        const st = store.getStatus() || {};
        const locked = !!st.locked;
        const readOnly = !!st.readOnly;
        const modeLabel = locked ? "LÅST" : (readOnly ? "READ-ONLY" : "AKTIV");
        return { ok: true, locked, readOnly, reason: safeStr(st.reason || st.whyReadOnly || ""), modeLabel };
      }
      // fallback: store finns men saknar status-API
      return { ok: true, locked: false, readOnly: false, reason: "", modeLabel: "AKTIV" };
    } catch (e) {
      return { ok: false, locked: true, readOnly: true, reason: safeStr(e && e.message ? e.message : "status-fel"), modeLabel: "LÅST" };
    }
  }

  /* =========================
  BLOCK 3 — Router state (no storage)
  ========================= */

  function getDefaultViewId(menuItems) {
    if (!Array.isArray(menuItems) || !menuItems.length) return "";
    return safeStr(menuItems[0].id);
  }

  function parseRouteFromHash() {
    // hash formats:
    //   #v=buyer-item-new
    //   #view=buyer-supplier-search
    try {
      const h = safeStr(window.location.hash || "");
      const m = h.match(/(?:#|&)(?:v|view)=([^&]+)/i);
      if (!m || !m[1]) return "";
      return decodeURIComponent(m[1]).trim();
    } catch {
      return "";
    }
  }

  function setRouteHash(viewId) {
    try {
      const vid = encodeURIComponent(safeStr(viewId).trim());
      window.location.hash = "#view=" + vid;
    } catch {}
  }

  function isAllowedBuyerMenuId(id) {
    const vid = safeStr(id).trim();
    if (!vid) return false;
    return BUYER_MENU_ALLOWLIST.indexOf(vid) !== -1;
  }

  /* =========================
  BLOCK 4 — View mount/unmount pipeline
  ========================= */

  function makeCtx() {
    // ctx skickas till views (ESM view-interface spec)
    // Inga nya keys. Bara referenser.
    return {
      role: "buyer",
      store: getStore(),
      render: getRender()
    };
  }

  function safeUnmount(active) {
    try {
      if (active && active.view && typeof active.view.unmount === "function") {
        active.view.unmount({ root: active.root, ctx: active.ctx, state: active.state || {} });
      }
    } catch {}
  }

  function safeMount(view, root, ctx) {
    try {
      if (view && typeof view.mount === "function") {
        view.mount({ root, ctx, state: {} });
      }
    } catch (e) {
      // fail-soft: render error box
      try {
        clear(root);
        const box = el("div", null, null);
        box.style.padding = "12px";
        box.style.borderRadius = "12px";
        box.style.border = "1px dashed #ddd";
        box.style.background = "#fff";
        box.appendChild(el("b", null, "Kunde inte mounta vy"));
        box.appendChild(el("div", null, safeStr(e && e.message ? e.message : "okänt fel")));
        root.appendChild(box);
      } catch {}
    }
  }

  function safeRender(view, root, ctx, state) {
    try {
      if (view && typeof view.render === "function") {
        view.render({ root, ctx, state: state || {} });
      }
    } catch {}
  }

  /* =========================
  BLOCK 5 — Menu render (BUYER: exakt 4)
  ========================= */

  function renderMenu(menuRoot, menuItems, activeId, onPick) {
    clear(menuRoot);

    const list = Array.isArray(menuItems) ? menuItems : [];

    for (let i = 0; i < list.length; i++) {
      const it = list[i] || {};
      const id = safeStr(it.id);
      const label = safeStr(it.label || it.id || "—");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tabBtn";
      btn.textContent = label;
      btn.setAttribute("data-view-id", id);
      btn.setAttribute("aria-selected", String(id === activeId));
      btn.addEventListener("click", () => {
        try { onPick(id); } catch {}
      });

      menuRoot.appendChild(btn);
    }

    if (!list.length) {
      menuRoot.appendChild(el("div", "muted", "Inga BUYER-vyer definierade ännu."));
    }
  }

  /* =========================
  BLOCK 6 — UI status/lock/debug/demo reset
  ========================= */

  function updateTopStatus() {
    const pillText = $("frzStatusText");
    const modeText = $("frzModeText");
    const lockPanel = $("frzLockPanel");
    const lockReason = $("frzLockReason");

    const store = getStore();
    const st = computeStatus(store);

    // status pill
    setText(pillText, st.ok ? "Redo" : "Fel");

    // mode pill
    setText(modeText, st.modeLabel || "—");

    // lock panel
    if (!st.ok || st.locked) {
      setHidden(lockPanel, false);
      setText(lockReason, "Orsak: " + safeStr(st.reason || "FRZ_E_LOCKED"));
    } else {
      setHidden(lockPanel, true);
      setText(lockReason, "Orsak: —");
    }

    // Debug panel (visas bara vid avvikelse)
    const dbgPanel = $("frzDebugPanel");
    const dbgText = $("frzDebugText");
    const needsDbg = (!st.ok) || (!store) || (store && typeof store.getStatus !== "function");
    if (needsDbg) {
      setHidden(dbgPanel, false);
      const msg = !store ? "FreezerStore saknas" : (typeof store.getStatus !== "function" ? "FreezerStore.getStatus() saknas" : "—");
      setText(dbgText, msg);
    } else {
      setHidden(dbgPanel, true);
      setText(dbgText, "—");
    }
  }

  function wireResetDemo() {
    const btn = $("frzResetDemoBtn");
    if (!btn) return;

    btn.addEventListener("click", () => {
      const store = getStore();
      const st = computeStatus(store);

      if (!store) {
        try { alert("Kan inte återställa: FreezerStore saknas."); } catch {}
        return;
      }

      if (st.locked) {
        try { alert("Kan inte återställa: låst läge.\n" + safeStr(st.reason || "")); } catch {}
        return;
      }
      if (st.readOnly) {
        try { alert("Kan inte återställa: read-only."); } catch {}
        return;
      }

      // fail-soft: stöd flera namn utan att skapa nya keys
      const fn =
        (typeof store.resetDemo === "function" && store.resetDemo) ||
        (typeof store.seedDemo === "function" && store.seedDemo) ||
        (typeof store.reset === "function" && store.reset) ||
        null;

      if (!fn) {
        try { alert("Återställning stöds inte ännu (resetDemo/seedDemo/reset saknas)."); } catch {}
        return;
      }

      try {
        const res = fn.call(store);
        if (res && res.ok === false) {
          try { alert("Återställning misslyckades: " + safeStr(res.reason || "okänt")); } catch {}
          return;
        }
        updateTopStatus();
        try { alert("Demo-data återställd."); } catch {}
      } catch (e) {
        try { alert("Fel vid återställning: " + safeStr(e && e.message ? e.message : "okänt")); } catch {}
      }
    });
  }

  /* =========================
  BLOCK 7 — App init (wait for ESM registry)
  ========================= */

  function showFailClosed(root, msg) {
    clear(root);
    const box = el("div", "fallbackBox muted", null);
    box.appendChild(el("b", null, "Kan inte starta buyer-sidan"));
    box.appendChild(el("div", null, msg));
    root.appendChild(box);
  }

  function buildBuyerMenuItems(reg, views) {
    // Bygg menyitems i samma ordning som allowlist, men med labels från registry (view.label)
    const items = [];
    for (let i = 0; i < BUYER_MENU_ALLOWLIST.length; i++) {
      const id = BUYER_MENU_ALLOWLIST[i];
      const v = reg.findView(views, id);
      if (!v) continue;
      items.push({
        id: safeStr(v.id),
        label: safeStr(v.label || v.id),
        requiredPerm: (v.requiredPerm == null ? null : safeStr(v.requiredPerm))
      });
    }
    return items;
  }

  function initWhenReady() {
    const menuRoot = $("freezerViewMenu");
    const viewRoot = $("freezerViewRoot");
    const fallback = $("frzBuyerFallback");

    if (!menuRoot || !viewRoot) return; // fail-soft

    // P0: vänta på registry (ESM) + interface
    const reg = getRegistry();
    if (!reg || typeof reg.getViewsForRole !== "function" || typeof reg.findView !== "function") {
      return false;
    }

    // klart: göm "Laddar vyer…"
    try { if (fallback) fallback.hidden = true; } catch {}

    // status/lock/demo
    updateTopStatus();
    wireResetDemo();

    // Views (buyer)
    const views = reg.getViewsForRole("buyer") || [];

    // Menyitems: EXAKT 4 enligt allowlist
    const menuItems = buildBuyerMenuItems(reg, views);

    // ROUTE
    let activeId = parseRouteFromHash();
    if (!isAllowedBuyerMenuId(activeId)) activeId = "";
    if (!activeId) activeId = getDefaultViewId(menuItems);

    // Validate route id exists; annars default
    if (activeId && !reg.findView(views, activeId)) activeId = getDefaultViewId(menuItems);

    // Active view holder
    let active = { id: "", view: null, root: viewRoot, ctx: makeCtx(), state: {} };

    function pick(id) {
      const nextId = safeStr(id).trim();
      if (!nextId) return;
      if (!isAllowedBuyerMenuId(nextId)) return; // fail-closed: endast 4 vyer
      setRouteHash(nextId);
    }

    function applyRoute(nextId) {
      const vid = safeStr(nextId).trim();
      if (!isAllowedBuyerMenuId(vid)) {
        // fail-closed: tvinga default
        const def = getDefaultViewId(menuItems);
        if (def && def !== vid) {
          setRouteHash(def);
          return;
        }
      }

      const view = reg.findView(views, vid);
      if (!view) {
        showFailClosed(viewRoot, "Okänd vy: " + vid);
        return;
      }

      // unmount prev
      safeUnmount(active);

      // mount new
      active = { id: vid, view, root: viewRoot, ctx: makeCtx(), state: {} };
      safeMount(view, viewRoot, active.ctx);

      // render (initial)
      safeRender(view, viewRoot, active.ctx, active.state);

      // menu aria-selected
      renderMenu(menuRoot, menuItems, vid, pick);
    }

    // Initial render menu + mount
    renderMenu(menuRoot, menuItems, activeId, pick);
    applyRoute(activeId);

    // hash change => route
    window.addEventListener("hashchange", () => {
      try {
        const id = parseRouteFromHash();
        const useId = isAllowedBuyerMenuId(id) ? id : getDefaultViewId(menuItems);
        applyRoute(useId);
      } catch {}
    });

    // periodic status refresh (fail-soft, låg frekvens)
    try {
      window.setInterval(() => {
        try { updateTopStatus(); } catch {}
      }, 1500);
    } catch {}

    return true;
  }

  function boot() {
    const viewRoot = $("freezerViewRoot");

    // initial fallback stays until ready
    let tries = 0;
    const maxTries = 80; // ~4s @ 50ms
    const t = window.setInterval(() => {
      tries++;

      const ok = initWhenReady();
      if (ok) {
        try { window.clearInterval(t); } catch {}
        return;
      }

      if (tries >= maxTries) {
        try { window.clearInterval(t); } catch {}
        if (viewRoot) {
          showFailClosed(
            viewRoot,
            "View registry är inte redo. Kontrollera att 00-view-interface.js och 01-view-registry.js laddas som type=\"module\" före buyer-controller."
          );
        }
      }
    }, 50);
  }

  // P0: defer-script kör efter parse; vi bootar direkt men väntar på registry
  boot();

})();

/* ============================================================
ÄNDRINGSLOGG (≤8)
1) Låser BUYER-menyn till EXAKT 4 rutor via allowlist (AO-05/15).
2) Fail-closed: blockerar hash-route till vyer utanför allowlist.
3) Menylabels hämtas från registry (view.label) men ordningen styrs av allowlist.
============================================================ */

/* ============================================================
TESTNOTERINGAR (klicktest)
- Ladda buyer/freezer.html: ska först visa “Laddar vyer…” och sen 4 knappar.
- Klicka knappar: URL hash ska ändras (#view=...) och vyn ska bytas utan refresh.
- Försök manuellt sätta hash till #view=buyer-saldo: ska fail-closed och hoppa tillbaka till default.
- Om du sabbar sökväg till 01-view-registry.js: efter ~4s ska tydligt fallback-fel visas (ej blank sida).
- Tryck “Återställ demo”: ska faila tydligt om store saknas/locked/read-only.
============================================================ */
