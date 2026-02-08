/* ============================================================

AO-05/15 — BUYER Controller (router + menu + mount) | FIL-ID: UI/pages/freezer/buyer/freezer-buyer.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Gör buyer/freezer.html fungerande:
  - Bygger router-meny (EXAKT 5 BUYER-rutor) via FreezerViewRegistry
  - Mountar aktiv vy i #freezerViewRoot
  - Fail-closed: om registry/router/store saknas -> visa fallback + lås-panel

POLICY (LÅST):
- UI-only • inga nya storage-keys/datamodell
- XSS-safe: textContent + createElement
- P0: får INTE init före ESM registry är redo -> väntar/pollar (defer + guard)

AUTOPATCH:
- Store.init ska få role="BUYER" (store normaliserar ADMIN/BUYER/PICKER/SYSTEM_ADMIN).
- Registry kan vara case-känslig -> prova buyer/BUYER fail-soft.

P0 FIX (denna patch):
- Singleton-guard: förhindrar dubbel boot (t.ex. script laddas 2 ggr).
- Same-view guard: om route pekar på samma vy -> render-only (ingen unmount/mount).
- Debounce hashchange: minskar risk för remount-loop.
============================================================ */

(function () {
  "use strict";

  /* =========================
  BLOCK 0 — P0: Singleton guard (förhindrar dubbel boot)
  ========================= */
  try {
    if (window.__FRZ_BUYER_CONTROLLER_BOOTED__) return;
    window.__FRZ_BUYER_CONTROLLER_BOOTED__ = true;
  } catch {}

  /* =========================
  BLOCK 0.1 — Kontrakt: EXAKT 5 BUYER-rutor i menyn (AO-05/15)
  ========================= */

  const BUYER_MENU_ALLOWLIST = [
    "buyer-supplier-new",     // Ny Leverantör
    "buyer-item-new",         // Ny produkt
    "buyer-stock-in",         // Lägga in produkter
    "buyer-supplier-search",  // Sök Leverantör
    "buyer-saldo"             // Lagersaldo
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
  BLOCK 2.1 — P0: Store init/hydrate (NO NEW STORAGE KEYS)
  - Målet: efter reload ska getState().items INTE vara [] om LS redan har items.
  - Policy: initas först när registry är redo (AO-05/15).
  ========================= */

  let __frzStoreInitAttempted = false;

  function tryInitStoreOnce(registryIsReady) {
    if (!registryIsReady) return { ok: false, why: "registry-not-ready" };
    if (__frzStoreInitAttempted) return { ok: true, why: "already-attempted" };

    __frzStoreInitAttempted = true;

    const store = getStore();
    if (!store) return { ok: false, why: "store-missing" };

    // Om store redan verkar initad/hydrerad, gör inget.
    try {
      if (typeof store.getStatus === "function") {
        const st = store.getStatus() || {};
        if (!st.locked) return { ok: true, why: "already-inited" };
      }
      if (typeof store.getState === "function") {
        const s = store.getState() || {};
        if (s && (s.hydrated === true || (Array.isArray(s.items) && s.items.length > 0))) {
          return { ok: true, why: "already-hydrated" };
        }
      }
    } catch {}

    const initFn =
      (typeof store.init === "function" && store.init) ||
      (typeof store.bootstrap === "function" && store.bootstrap) ||
      (typeof store.start === "function" && store.start) ||
      null;

    if (!initFn) return { ok: false, why: "no-init-fn" };

    try {
      const res = initFn.call(store, { role: "BUYER" });
      if (res && typeof res === "object" && res.ok === false) {
        return { ok: false, why: "init-returned-fail", reason: safeStr(res.reason || res.error || "") };
      }
      return { ok: true, why: "init-called" };
    } catch (e) {
      return { ok: false, why: "init-threw", reason: safeStr(e && e.message ? e.message : "init-fel") };
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
      const next = "#view=" + vid;
      // P0: skriv inte samma hash om det redan är samma => minskar onödiga hashchange/remount
      if (safeStr(window.location.hash || "") === next) return;
      window.location.hash = next;
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
    return {
      role: "BUYER",
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
  BLOCK 5 — Menu render (BUYER: exakt 5)
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

  function updateTopStatus(extraDebugMsg) {
    const pillText = $("frzStatusText");
    const modeText = $("frzModeText");
    const lockPanel = $("frzLockPanel");
    const lockReason = $("frzLockReason");

    const store = getStore();
    const st = computeStatus(store);

    setText(pillText, st.ok ? "Redo" : "Fel");
    // OBS: vi skriver bara text — rör inte viewRoot här (P0)
    setText(modeText, st.modeLabel || "—");

    if (!st.ok || st.locked) {
      setHidden(lockPanel, false);
      setText(lockReason, "Orsak: " + safeStr(st.reason || "FRZ_E_LOCKED"));
    } else {
      setHidden(lockPanel, true);
      setText(lockReason, "Orsak: —");
    }

    const dbgPanel = $("frzDebugPanel");
    const dbgText = $("frzDebugText");
    const needsDbg = (!!extraDebugMsg) || (!st.ok) || (!store) || (store && typeof store.getStatus !== "function");
    if (needsDbg) {
      setHidden(dbgPanel, false);
      const base = !store ? "FreezerStore saknas"
        : (typeof store.getStatus !== "function" ? "FreezerStore.getStatus() saknas" : "—");
      const msg = extraDebugMsg ? (base + " • " + safeStr(extraDebugMsg)) : base;
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

      if (!store) { try { alert("Kan inte återställa: FreezerStore saknas."); } catch {} return; }
      if (st.locked) { try { alert("Kan inte återställa: låst läge.\n" + safeStr(st.reason || "")); } catch {} return; }
      if (st.readOnly) { try { alert("Kan inte återställa: read-only."); } catch {} return; }

      const fn =
        (typeof store.resetDemo === "function" && store.resetDemo) ||
        (typeof store.seedDemo === "function" && store.seedDemo) ||
        (typeof store.reset === "function" && store.reset) ||
        null;

      if (!fn) { try { alert("Återställning stöds inte ännu (resetDemo/seedDemo/reset saknas)."); } catch {} return; }

      try {
        const res = fn.call(store);
        if (res && res.ok === false) { try { alert("Återställning misslyckades: " + safeStr(res.reason || "okänt")); } catch {} return; }
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

  function getBuyerViewsForRegistry(reg) {
    try { const a = reg.getViewsForRole && reg.getViewsForRole("buyer"); if (Array.isArray(a) && a.length) return a; } catch {}
    try { const b = reg.getViewsForRole && reg.getViewsForRole("BUYER"); if (Array.isArray(b) && b.length) return b; } catch {}
    try { const c = reg.getViewsForRole && reg.getViewsForRole("Buyer"); if (Array.isArray(c) && c.length) return c; } catch {}
    return [];
  }

  function initWhenReady() {
    const menuRoot = $("freezerViewMenu");
    const viewRoot = $("freezerViewRoot");
    const fallback = $("frzBuyerFallback");
    if (!menuRoot || !viewRoot) return false;

    const reg = getRegistry();
    if (!reg || typeof reg.getViewsForRole !== "function" || typeof reg.findView !== "function") return false;

    // P0: init store först när registry är redo
    const initRes = tryInitStoreOnce(true);
    if (!initRes.ok) {
      updateTopStatus("Store init: " + safeStr(initRes.why || "fail") + (initRes.reason ? " (" + initRes.reason + ")" : ""));
    } else {
      updateTopStatus(initRes.why ? ("Store init: " + initRes.why) : "");
    }

    try { if (fallback) fallback.hidden = true; } catch {}
    wireResetDemo();

    const views = getBuyerViewsForRegistry(reg);
    const menuItems = buildBuyerMenuItems(reg, views);

    let activeId = parseRouteFromHash();
    if (!isAllowedBuyerMenuId(activeId)) activeId = "";
    if (!activeId) activeId = getDefaultViewId(menuItems);
    if (activeId && !reg.findView(views, activeId)) activeId = getDefaultViewId(menuItems);

    let active = { id: "", view: null, root: viewRoot, ctx: makeCtx(), state: {} };
    let __applyTimer = null;

    function pick(id) {
      const nextId = safeStr(id).trim();
      if (!nextId) return;
      if (!isAllowedBuyerMenuId(nextId)) return;
      setRouteHash(nextId);
    }

    function applyRouteNow(nextId) {
      const vid = safeStr(nextId).trim();
      if (!isAllowedBuyerMenuId(vid)) {
        const def = getDefaultViewId(menuItems);
        if (def && def !== vid) { setRouteHash(def); return; }
      }

      const view = reg.findView(views, vid);
      if (!view) { showFailClosed(viewRoot, "Okänd vy: " + vid); return; }

      // P0: Same-view guard => RENDER ONLY (ingen unmount/mount)
      if (active && active.id === vid && active.view) {
        active.ctx = makeCtx(); // uppdatera ev store/render-referenser
        safeRender(active.view, viewRoot, active.ctx, active.state);
        renderMenu(menuRoot, menuItems, vid, pick);
        return;
      }

      safeUnmount(active);

      active = { id: vid, view, root: viewRoot, ctx: makeCtx(), state: {} };
      safeMount(view, viewRoot, active.ctx);
      safeRender(view, viewRoot, active.ctx, active.state);
      renderMenu(menuRoot, menuItems, vid, pick);
    }

    function applyRoute(nextId) {
      // Debounce för hashchange-fladder
      try { if (__applyTimer) window.clearTimeout(__applyTimer); } catch {}
      __applyTimer = window.setTimeout(() => {
        __applyTimer = null;
        try { applyRouteNow(nextId); } catch {}
      }, 0);
    }

    renderMenu(menuRoot, menuItems, activeId, pick);
    applyRouteNow(activeId);

    window.addEventListener("hashchange", () => {
      try {
        const id = parseRouteFromHash();
        const useId = isAllowedBuyerMenuId(id) ? id : getDefaultViewId(menuItems);
        applyRoute(useId);
      } catch {}
    });

    try {
      window.setInterval(() => {
        try { updateTopStatus(); } catch {}
      }, 1500);
    } catch {}

    return true;
  }

  function boot() {
    const viewRoot = $("freezerViewRoot");

    let tries = 0;
    const maxTries = 80; // ~4s @ 50ms
    const t = window.setInterval(() => {
      tries++;

      const ok = initWhenReady();
      if (ok) { try { window.clearInterval(t); } catch {} return; }

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

  boot();

})();

/* ============================================================
ÄNDRINGSLOGG (≤8)
1) P0: Singleton-guard stoppar dubbel boot om filen laddas två gånger.
2) P0: Same-view guard => render-only när route redan är aktiv (ingen unmount/mount).
3) P0: setRouteHash skriver inte samma hash igen (minskar hashchange/remount).
4) Hashchange debounced (0ms) för stabilare view-livscykel.
5) I övrigt: samma AO-05/15 beteende (exakt 5 BUYER-rutor, init efter registry).
============================================================ */

/* ============================================================
TESTNOTERINGAR
- Öppna buyer/freezer.html#view=buyer-stock-in
  - Skriv i "Antal kg" och vänta 5–10 sek:
    - input får INTE försvinna, cursor kvar, value kvar.
- Klicka mellan flikar och tillbaka:
  - vy mountas vid byte, men render-only om man “landar” på samma vy igen.
- Om du råkat inkludera buyer-controller två gånger:
  - ska nu inte kunna dubbelstarta (P0 fix).
============================================================ */
