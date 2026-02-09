/* ============================================================
AO-16/15 (EXTRA) — Modal Shell (JS, window-bridge) | FIL-ID: UI/pages/freezer/05-modal-shell.js
Projekt: Fryslager (UI-only / localStorage-first)
Syfte: Gemensam modal som kan användas av vy-moduler (varje ruta kan ha egen fil).
POLICY: Ingen storage • XSS-safe (bygger DOM) • Fail-soft • Ingen UX/redesign utanför modal

P0 TRACE/WRAP FIX (DENNA PATCH):
- Stäng/overlay/ESC ska anropa window.FreezerModal.close() dynamiskt
  så att en senare wrapper (close-tracer) alltid fångar anropet.

P0 BOOT-LOCK FIX (DENNA PATCH):
- Förhindra att modalen råkar öppnas under boot/login (race conditions).
- FreezerModal.open() ignoreras under kort “boot lock”-fönster.
- Efter boot fungerar open normalt (t.ex. klick på "Skapa användare").
============================================================ */

(function () {
  "use strict";

  if (window.FreezerModal) return;

  const STATE = {
    root: null,
    overlay: null,
    dialog: null,
    title: null,
    body: null,
    closeBtn: null,
    isOpen: false,
    onClose: null,

    // P0: boot lock
    bootLocked: true,
    bootLockUntil: 0
  };

  function el(tag) { return document.createElement(tag); }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function now() {
    try { return Date.now(); } catch { return 0; }
  }

  // P0: Boot lock – blockera open under initial init/route/login
  (function initBootLock() {
    // Lås direkt vid load och släpp efter kort tid.
    // (räcker för att stoppa "auto-open" som sker under boot)
    STATE.bootLocked = true;
    STATE.bootLockUntil = now() + 350;

    try {
      // Släpp efter nästa tick
      setTimeout(() => { STATE.bootLocked = false; }, 0);
    } catch {}

    try {
      // Extra släpp efter liten delay (race med sena scripts)
      setTimeout(() => { STATE.bootLocked = false; }, 350);
    } catch {}
  })();

  function isBootLocked() {
    if (!STATE.bootLocked) return false;
    const t = STATE.bootLockUntil || 0;
    if (!t) return true;
    if (now() > t) {
      STATE.bootLocked = false;
      return false;
    }
    return true;
  }

  function safeClose() {
    try {
      if (window.FreezerModal && typeof window.FreezerModal.close === "function") {
        window.FreezerModal.close();
      }
    } catch {}
  }

  function ensureRoot() {
    try {
      if (STATE.root && document.body.contains(STATE.root)) return STATE.root;

      const overlay = el("div");
      overlay.setAttribute("data-frz-modal", "overlay");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(0,0,0,0.35)";
      overlay.style.display = "none";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.zIndex = "9999";
      overlay.style.padding = "16px";

      const dialog = el("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.style.width = "min(900px, 96vw)";
      dialog.style.maxHeight = "90vh";
      dialog.style.overflow = "auto";
      dialog.style.background = "#fff";
      dialog.style.borderRadius = "14px";
      dialog.style.border = "1px solid #e6e6e6";
      dialog.style.boxShadow = "0 12px 40px rgba(0,0,0,0.25)";

      const head = el("div");
      head.style.display = "flex";
      head.style.gap = "10px";
      head.style.alignItems = "center";
      head.style.padding = "12px 12px";
      head.style.borderBottom = "1px solid #eee";

      const title = el("b");
      title.textContent = "—";

      const spacer = el("div");
      spacer.style.flex = "1";

      const closeBtn = el("button");
      closeBtn.type = "button";
      closeBtn.textContent = "Stäng";
      closeBtn.style.border = "1px solid #e6e6e6";
      closeBtn.style.background = "#fff";
      closeBtn.style.borderRadius = "10px";
      closeBtn.style.padding = "8px 10px";
      closeBtn.style.cursor = "pointer";

      const body = el("div");
      body.style.padding = "12px 12px";

      head.appendChild(title);
      head.appendChild(spacer);
      head.appendChild(closeBtn);

      dialog.appendChild(head);
      dialog.appendChild(body);
      overlay.appendChild(dialog);

      overlay.addEventListener("click", (ev) => {
        // klick utanför dialog stänger
        try {
          if (ev.target === overlay) safeClose();
        } catch {}
      });

      closeBtn.addEventListener("click", () => safeClose());

      document.addEventListener("keydown", (ev) => {
        try {
          if (!STATE.isOpen) return;
          if (ev.key === "Escape") safeClose();
        } catch {}
      });

      document.body.appendChild(overlay);

      STATE.root = overlay;
      STATE.overlay = overlay;
      STATE.dialog = dialog;
      STATE.title = title;
      STATE.body = body;
      STATE.closeBtn = closeBtn;

      return overlay;
    } catch {
      return null;
    }
  }

  const api = {
    ensureRoot,

    open: function (opts) {
      try {
        // P0: blockera auto-open under boot/login init
        // (tillåter normal öppning efter boot)
        if (!opts || opts.force !== true) {
          if (isBootLocked()) return;
        }

        ensureRoot();
        if (!STATE.overlay || !STATE.title || !STATE.body) return;

        const title = opts && opts.title ? String(opts.title) : "—";
        STATE.title.textContent = title;

        clear(STATE.body);

        // allow caller to render DOM safely
        if (opts && typeof opts.render === "function") {
          opts.render(STATE.body);
        } else if (opts && typeof opts.text === "string") {
          const p = el("div");
          p.textContent = opts.text;
          STATE.body.appendChild(p);
        }

        STATE.onClose = (opts && typeof opts.onClose === "function") ? opts.onClose : null;

        STATE.overlay.style.display = "flex";
        STATE.isOpen = true;

        // focus close for accessibility
        try { STATE.closeBtn && STATE.closeBtn.focus(); } catch {}
      } catch {
        /* fail-soft */
      }
    },

    close: function () {
      try {
        if (!STATE.overlay) return;
        STATE.overlay.style.display = "none";
        STATE.isOpen = false;

        try {
          if (typeof STATE.onClose === "function") STATE.onClose();
        } catch {}

        STATE.onClose = null;
      } catch {
        /* fail-soft */
      }
    },

    isOpen: function () { return !!STATE.isOpen; }
  };

  window.FreezerModal = api;
})();
