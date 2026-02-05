/* ============================================================
AO-XX/15 — Buyer Modal: Status | FIL-ID: UI/pages/freezer/buyer/modals/modal-status.js
Projekt: Freezer
Policy: no storage, XSS-safe
============================================================ */

import { openModal } from "../../00-modal-shell.js";

function el(tag) { return document.createElement(tag); }
function setText(n, t) { n.textContent = String(t == null ? "" : t); }

export function openStatusModal(payload) {
  const status = payload && payload.status ? payload.status : null;

  openModal({
    title: "Status",
    size: "sm",
    render(contentEl) {
      const box = el("div");
      box.style.border = "1px solid #e6e6e6";
      box.style.borderRadius = "12px";
      box.style.padding = "12px";
      box.style.background = "#fafafa";

      const line1 = el("div");
      line1.style.fontWeight = "700";
      setText(line1, status && status.locked ? "Låst läge" : "OK / Aktiv");

      const line2 = el("div");
      line2.style.marginTop = "6px";
      line2.style.opacity = "0.75";
      line2.style.fontSize = "13px";
      setText(line2, status ? (status.whyReadOnly || status.reason || "—") : "—");

      box.appendChild(line1);
      box.appendChild(line2);
      contentEl.appendChild(box);
    }
  });
}

