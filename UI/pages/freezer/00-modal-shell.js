/* ============================================================
AO-XX/15 — Modal Shell (JS-root, no HTML dependency) | FIL-ID: UI/pages/freezer/00-modal-shell.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- Gemensamt modal-system som kan användas av alla vyer.
- Root skapas via JS och läggs i <body> vid första open().
- XSS-safe: createElement + textContent (ingen innerHTML).
- Fail-soft: om något går fel stängs modalen och UI kraschar inte.

Policy:
- Inga storage-keys
- Ingen UX/redesign utanför modal-overlay
============================================================ */

let _root = null;
let _overlay = null;
let _dialog = null;
let _titleEl = null;
let _contentEl = null;
let _closeBtn = null;

let _isOpen = false;
let _cleanup = null;
let _lastActiveEl = null;

function el(tag) { return document.createElement(tag); }
function setText(node, txt) { node.textContent = String(txt == null ? "" : txt); }
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

function ensureRoot() {
  if (_root && _overlay && _dialog && _contentEl) return;

  _root = el("div");
  _root.id = "freezerModalRoot";
  _root.setAttribute("data-freezer-modal-root", "1");

  // Overlay
  _overlay = el("div");
  _overlay.setAttribute("data-freezer-modal-overlay", "1");
  _overlay.style.position = "fixed";
  _overlay.style.inset = "0";
  _overlay.style.display = "none";
  _overlay.style.alignItems = "center";
  _overlay.style.justifyContent = "center";
  _overlay.style.background = "rgba(0,0,0,0.35)";
  _overlay.style.zIndex = "9999";
  _overlay.style.padding = "18px";

  // Dialog
  _dialog = el("div");
  _dialog.setAttribute("role", "dialog");
  _dialog.setAttribute("aria-modal", "true");
  _dialog.style.width = "min(920px, 96vw)";
  _dialog.style.maxHeight = "85vh";
  _dialog.style.overflow = "auto";
  _dialog.style.borderRadius = "14px";
  _dialog.style.border = "1px solid #e6e6e6";
  _dialog.style.background = "#fff";
  _dialog.style.boxShadow = "0 10px 40px rgba(0,0,0,0.25)";

  // Header row
  const head = el("div");
  head.style.display = "flex";
  head.style.gap = "10px";
  head.style.alignItems = "center";
  head.style.padding = "12px 14px";
  head.style.borderBottom = "1px solid #eee";

  _titleEl = el("b");
  _titleEl.style.fontSize = "14px";

  const spacer = el("div");
  spacer.style.flex = "1";

  _closeBtn = el("button");
  _closeBtn.type = "button";
  _closeBtn.setAttribute("aria-label", "Stäng");
  _closeBtn.style.border = "1px solid #e6e6e6";
  _closeBtn.style.background = "#fff";
  _closeBtn.style.borderRadius = "10px";
  _closeBtn.style.padding = "8px 10px";
  _closeBtn.style.cursor = "pointer";
  setText(_closeBtn, "Stäng");

  head.appendChild(_titleEl);
  head.appendChild(spacer);
  head.appendChild(_closeBtn);

  // Content
  _contentEl = el("div");
  _contentEl.style.padding = "14px";

  _dialog.appendChild(head);
  _dialog.appendChild(_contentEl);
  _overlay.appendChild(_dialog);
  _root.appendChild(_overlay);
  document.body.appendChild(_root);

  // Backdrop click -> close
  _overlay.addEventListener("click", (ev) => {
    try {
      if (ev.target === _overlay) closeModal();
    } catch { /* fail-soft */ }
  });

  // Close btn
  _closeBtn.addEventListener("click", () => {
    closeModal();
  });

  // ESC key
  document.addEventListener("keydown", (ev) => {
    try {
      if (!_isOpen) return;
      if (ev.key === "Escape") closeModal();
    } catch { /* fail-soft */ }
  });

  // Bridge för non-module script (valfritt men bra)
  try {
    if (!window.FreezerModalShell) {
      window.FreezerModalShell = { openModal, closeModal, isOpen };
    }
  } catch { /* ignore */ }
}

export function isOpen() {
  return !!_isOpen;
}

/**
 * Öppna modal.
 * @param {{ title?: string, render?: Function, size?: "sm"|"md"|"lg" }} opts
 */
export function openModal(opts) {
  try {
    ensureRoot();

    // cleanup ev gammal modal (fail-safe)
    try { if (typeof _cleanup === "function") _cleanup(); } catch {}
    _cleanup = null;

    _lastActiveEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const title = (opts && opts.title) ? String(opts.title) : "Detaljer";
    setText(_titleEl, title);

    // size
    const size = (opts && opts.size) ? String(opts.size) : "md";
    if (size === "sm") _dialog.style.width = "min(560px, 96vw)";
    else if (size === "lg") _dialog.style.width = "min(1100px, 96vw)";
    else _dialog.style.width = "min(920px, 96vw)";

    clear(_contentEl);

    _overlay.style.display = "flex";
    _isOpen = true;

    // render content
    const api = {
      close: closeModal,
      contentEl: _contentEl
    };

    if (opts && typeof opts.render === "function") {
      try {
        const maybeCleanup = opts.render(_contentEl, api);
        if (typeof maybeCleanup === "function") _cleanup = maybeCleanup;
      } catch (e) {
        // fallback message
        clear(_contentEl);
        const msg = el("div");
        msg.style.opacity = "0.75";
        msg.style.fontSize = "13px";
        setText(msg, "Kunde inte rendera innehållet. Se Console.");
        _contentEl.appendChild(msg);
        console.error("[FreezerModal] render error", e);
      }
    }

    // focus close
    try { _closeBtn && _closeBtn.focus(); } catch {}
  } catch (e) {
    console.error("[FreezerModal] openModal failed", e);
  }
}

export function closeModal() {
  try {
    if (!_isOpen) return;

    try { if (typeof _cleanup === "function") _cleanup(); } catch {}
    _cleanup = null;

    if (_contentEl) clear(_contentEl);
    if (_overlay) _overlay.style.display = "none";

    _isOpen = false;

    // restore focus
    try { if (_lastActiveEl) _lastActiveEl.focus(); } catch {}
    _lastActiveEl = null;
  } catch {
    // fail-soft
  }
}

