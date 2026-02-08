/* ============================================================
AO-05/15 — PICKER Controller (router + fail-closed) | FIL-ID: UI/pages/freezer/picker/freezer-picker.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Init för Plockare-sidan (picker/freezer.html)
- Väntar/pollar tills ESM registry är redo (P0)
- Renderar router-meny + mount/render/unmount av vyer
- Fail-closed: om registry/store saknas -> lås-panel + minimal fallback

POLICY (LÅST):
- UI-only • inga nya storage-keys/datamodell
- XSS-safe: ingen innerHTML (textContent + createElement)
- Inga sid-effekter utanför denna sida
============================================================ */

(function () {
  "use strict";

  /* =========================
  BLOCK 0 — Dom refs
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
  BLOCK 1 — Safe helpers
  ========================= */
  function safeStr(v) {
    try { return String(v == null ? "" : v); } catch { return ""; }
  }

  function clear(node) {
    try { while (node && node.firstChild) node.removeChild(node.firstChild); } catch {}
  }

  function setHidden(node, hidden) {
    try { if (node) node.hidden = !!hidden; } catch {}
  }

  function setText(node, text) {
    try { if (node) node.textContent = safeStr(text); } catch {}
  }

  function showLock(reason) {
    setHidden(elLockPanel, false);
    setText(elLockReason, reason || "Orsak: okänd");
  }

  function hideLock() {
    setHidden(elLockPanel, true);
    setText(elLockReason, "");
  }

  function showDebug(text) {
    if (!elDebugPanel || !elDebugText) return;
    setHidden(elDebugPanel, false);
    setText(elDebugText, text || "—");
  }

  function hideDebug() {
    if (!elDebugPanel || !elDebugText) return;
    setHidden(elDebugPanel, true);
    setText(elDebugText, "—");
  }

  function setStatus(text) {
    setText(elStatusText, text || "—");
  }

  function detectReadOnly() {
    // Fail-soft: default false. Om contract/core exponerar flagga -> respektera.
    try {
      if (window.FreezerContract) {
        const c = window.FreezerContract;
        if (typeof c.isReadOnly === "function") return !!c.isReadOnly();
        if (typeof c.getRuntime === "function") {
          const rt = c.getRuntime();
          if (rt && typeof rt === "object") {
            if (rt.readOnly != null) return !!rt.readOnly;
            if (rt.isReadOnly != null) return !!rt.isReadOnly;
          }
        }
        if (c.readOnly != null) return !!c.readOnly;
      }
    } catch {}
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("readonly") === "1") return true;
      if (url.searchParams.get("ro") === "1") return true;
    } catch {}
    return false;
  }

  function getStore() {
    try { return window.FreezerStore || null; } catch { return null; }
  }

  function getRegistry() {
    try { return window.FreezerViewRegistry || null; } catch { return null; }
  }

  /* =========================
  BLOCK 2 — Registry ready poll (P0)
  ========================= */
  function waitForRegistryReady(opts) {
    const maxMs = (opts && opts.maxMs) ? opts.maxMs : 5000;
    const tickMs = (opts && opts.tickMs) ? opts.tickMs : 50;

    const started = Date.now();

    return new Promise((resolve, reject) => {
      (function poll() {
        const reg = getRegistry();
        const ok =
          !!reg &&
          typeof reg.getViewsForRole === "function" &&
          typeof reg.defineView === "function" &&
          Array.isArray(reg.pickerViews);

        if (ok) return resolve(reg);

        if (Date.now() - started > maxMs) {
          return reject(new Error("Registry inte redo inom tidsgräns"));
        }
        setTimeout(poll, tickMs);
      })();
    });
  }

  /* =========================
  BLOCK 3 — Default picker views (placeholders)
  - Vi definierar dem här för att vara produktionsklar även om externa filer saknas.
  - Om externa picker-vyer registreras senare: vi dubblar inte.
  ========================= */
  function ensureDefaultPickerViews(reg) {
    try {
      if (!reg || typeof reg.defineView !== "function" || !Array.isArray(reg.pickerViews)) return;

      function exists(id) {
        const list = reg.pickerViews || [];
        for (let i = 0; i < list.length; i++) {
          if (list[i] && String(list[i].id || "") === id) return true;
        }
        return false;
      }

      if (!exists("picker-out")) {
        const vOut = reg.defineView({
          id: "picker-out",
          label: "Uttag",
          requiredPerm: null,
          mount: ({ root, ctx }) => {
            try {
              if (!root || !(root instanceof HTMLElement)) return;
              clear(root);

              const wrap = document.createElement("section");
              wrap.setAttribute("data-view", "picker-out");

              const h = document.createElement("h2");
              h.textContent = "Plock – Uttag";

              const p = document.createElement("p");
              p.textContent = "Kommer snart.";

              const hint = document.createElement("div");
              hint.style.opacity = "0.75";
              hint.style.fontSize = "13px";
              hint.textContent = "Placeholder-vy (AO-05/15).";

              const status = document.createElement("div");
              status.style.marginTop = "10px";
              status.style.opacity = "0.75";
              status.style.fontSize = "13px";
              status.textContent = formatCtxLine(ctx);

              const box = document.createElement("div");
              box.style.marginTop = "12px";
              box.style.border = "1px dashed #ddd";
              box.style.borderRadius = "10px";
              box.style.padding = "10px";
              box.style.background = "#fafafa";

              const boxTitle = document.createElement("b");
              boxTitle.textContent = "Här kommer uttags-flödet att monteras";

              const boxText = document.createElement("div");
              boxText.style.opacity = "0.75";
              boxText.style.fontSize = "13px";
              boxText.style.marginTop = "6px";
              boxText.textContent = "Exempel: välj produkt, ange antal, uppdatera saldo, logga historik.";

              box.appendChild(boxTitle);
              box.appendChild(boxText);

              wrap.appendChild(h);
              wrap.appendChild(p);
              wrap.appendChild(hint);
              wrap.appendChild(status);
              wrap.appendChild(box);

              root.appendChild(wrap);

              try { root.__frzPickerOutStatusEl = status; } catch {}
            } catch {}
          },
          render: ({ root, ctx }) => {
            try {
              const s = root && root.__frzPickerOutStatusEl;
              if (s && s instanceof HTMLElement) s.textContent = formatCtxLine(ctx);
            } catch {}
          },
          unmount: ({ root }) => {
            try { delete root.__frzPickerOutStatusEl; } catch {}
          }
        });

        reg.pickerViews.push(vOut);
      }

      if (!exists("picker-dashboard")) {
        const vDash = reg.defineView({
          id: "picker-dashboard",
          label: "Översikt",
          requiredPerm: null,
          mount: ({ root, ctx }) => {
            try {
              if (!root || !(root instanceof HTMLElement)) return;
              clear(root);

              const wrap = document.createElement("section");
              wrap.setAttribute("data-view", "picker-dashboard");

              const h = document.createElement("h2");
              h.textContent = "Plock – Översikt";

              const p = document.createElement("p");
              p.textContent = "Kommer snart.";

              const hint = document.createElement("div");
              hint.style.opacity = "0.75";
              hint.style.fontSize = "13px";
              hint.textContent = "Placeholder-vy (AO-05/15).";

              const status = document.createElement("div");
              status.style.marginTop = "10px";
              status.style.opacity = "0.75";
              status.style.fontSize = "13px";
              status.textContent = formatCtxLine(ctx);

              const box = document.createElement("div");
              box.style.marginTop = "12px";
              box.style.border = "1px dashed #ddd";
              box.style.borderRadius = "10px";
              box.style.padding = "10px";
              box.style.background = "#fafafa";

              const boxTitle = document.createElement("b");
              boxTitle.textContent = "Här kommer översikten att monteras";

              const boxText = document.createElement("div");
              boxText.style.opacity = "0.75";
              boxText.style.fontSize = "13px";
              boxText.style.marginTop = "6px";
              boxText.textContent = "Exempel: dagens plock, varningar, min-nivåer, snabbgenvägar.";

              box.appendChild(boxTitle);
              box.appendChild(boxText);

              wrap.appendChild(h);
              wrap.appendChild(p);
              wrap.appendChild(hint);
              wrap.appendChild(status);
              wrap.appendChild(box);

              root.appendChild(wrap);

              try { root.__frzPickerDashStatusEl = status; } catch {}
            } catch {}
          },
          render: ({ root, ctx }) => {
            try {
              const s = root && root.__frzPickerDashStatusEl;
              if (s && s instanceof HTMLElement) s.textContent = formatCtxLine(ctx);
            } catch {}
          },
          unmount: ({ root }) => {
            try { delete root.__frzPickerDashStatusEl; } catch {}
          }
        });

        reg.pickerViews.unshift(vDash); // Översikt först
      }
    } catch {}
  }

  function formatCtxLine(ctx) {
    try {
      const role = ctx && ctx.role ? safeStr(ctx.role) : "—";
      const ro = !!(ctx && (ctx.readOnly || ctx.isReadOnly));
      const mode = ro ? "read-only" : "write";
      return `Ctx: role=${role} • mode=${mode}`;
    } catch {
      return "Ctx: —";
    }
  }

  /* =========================
  BLOCK 4 — Router (mount/render/unmount)
  ========================= */
  const Router = {
    views: [],
    activeId: "",
    activeView: null,
    activeRoot: null,
    ctx: { role: "picker", readOnly: true, store: null },

    init(views, ctx) {
      this.views = Array.isArray(views) ? views : [];
      this.ctx = ctx || this.ctx;
    },

    setActive(id) {
      const vid = safeStr(id).trim();
      const v = findViewById(this.views, vid);

      if (!v) return;

      // unmount previous
      try {
        if (this.activeView && typeof this.activeView.unmount === "function") {
          this.activeView.unmount({ root: this.activeRoot, ctx: this.ctx, state: {} });
        }
      } catch {}

      this.activeId = vid;
      this.activeView = v;
      this.activeRoot = elRoot;

      // mount new
      try {
        if (this.activeView && typeof this.activeView.mount === "function") {
          this.activeView.mount({ root: elRoot, ctx: this.ctx, state: {} });
        }
      } catch (e) {
        showDebug("Mount-fel: " + safeStr(e && e.message ? e.message : "okänt"));
      }

      // render menu selected
      renderMenu(this.views, this.activeId);

      // render pass
      this.render();
    },

    render() {
      try {
        if (!this.activeView || typeof this.activeView.render !== "function") return;
        this.activeView.render({ root: this.activeRoot, ctx: this.ctx, state: {} });
      } catch {}
    }
  };

  function findViewById(views, id) {
    const list = Array.isArray(views) ? views : [];
    const target = safeStr(id).trim();
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v && safeStr(v.id) === target) return v;
    }
    return null;
  }

  function renderMenu(views, activeId) {
    if (!elMenu) return;
    clear(elMenu);

    const list = Array.isArray(views) ? views : [];
    if (!list.length) {
      const span = document.createElement("div");
      span.className = "muted";
      span.textContent = "Inga vyer ännu.";
      elMenu.appendChild(span);
      return;
    }

    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v) continue;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tabBtn";
      btn.textContent = safeStr(v.label || v.id || "—");
      btn.setAttribute("aria-selected", String(safeStr(v.id) === safeStr(activeId)));

      btn.addEventListener("click", () => {
        try { Router.setActive(v.id); } catch {}
      });

      elMenu.appendChild(btn);
    }
  }

  /* =========================
  BLOCK 5 — Reset demo (fail-soft)
  ========================= */
  function wireResetDemo(ctx) {
    if (!btnResetDemo) return;

    const ro = !!(ctx && (ctx.readOnly || ctx.isReadOnly));
    btnResetDemo.disabled = ro;

    btnResetDemo.addEventListener("click", () => {
      try {
        hideDebug();

        if (ro) {
          showDebug("Read-only: demo kan inte återställas.");
          return;
        }

        const store = getStore();
        if (!store) {
          showDebug("FreezerStore saknas.");
          return;
        }

        const fn =
          (typeof store.resetDemo === "function" && store.resetDemo) ||
          (typeof store.resetDemoData === "function" && store.resetDemoData) ||
          (typeof store.reset === "function" && store.reset) ||
          null;

        if (!fn) {
          showDebug("Reset-funktion saknas i FreezerStore.");
          return;
        }

        const res = fn.call(store);

        if (res && res.ok === false) {
          showDebug("Reset misslyckades: " + safeStr(res.reason || "okänt"));
          return;
        }

        setStatus("Demo återställd");
        Router.render();
      } catch (e) {
        showDebug("Reset-fel: " + safeStr(e && e.message ? e.message : "okänt"));
      }
    });
  }

  /* =========================
  BLOCK 6 — Bootstrap
  ========================= */
  function bootstrap(reg) {
    try {
      hideLock();
      hideDebug();

      const store = getStore();
      if (!store) {
        showLock("FreezerStore saknas. Kontrollera script-ordning: 03-store.js före controller.");
        setStatus("Stoppad");
        return;
      }

      // ctx
      const readOnly = detectReadOnly();
      const ctx = {
        role: "picker",
        readOnly,
        isReadOnly: readOnly,
        store
      };

      setText(elModeText, readOnly ? "read-only" : "write");

      // säkerställ minimum-vyer
      ensureDefaultPickerViews(reg);

      const views = reg.getViewsForRole ? reg.getViewsForRole("picker") : [];
      if (!views || !views.length) {
        showLock("Inga vyer registrerade för Plockare.");
        setStatus("Stoppad");
        return;
      }

      // router init
      Router.init(views, ctx);
      renderMenu(views, "");

      // välj default
      const first = views[0];
      Router.setActive(first && first.id ? first.id : "");

      // reset demo
      wireResetDemo(ctx);

      setStatus("Redo");
    } catch (e) {
      showLock("Init-fel: " + safeStr(e && e.message ? e.message : "okänt"));
      setStatus("Stoppad");
    }
  }

  // Start
  setStatus("Init…");
  waitForRegistryReady({ maxMs: 7000, tickMs: 60 })
    .then((reg) => {
      bootstrap(reg);
    })
    .catch((e) => {
      // fail-closed: registry saknas -> lås
      showLock("Registry saknas/inte redo. Kontrollera att 01-view-registry.js laddas som type=\"module\".");
      showDebug("Registry-timeout: " + safeStr(e && e.message ? e.message : "okänt"));
      setStatus("Stoppad");
    });

  // Best-effort: re-render vid fokus tillbaka
  window.addEventListener("focus", () => {
    try { Router.render(); } catch {}
  });
})();
