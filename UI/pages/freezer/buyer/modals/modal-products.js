/* ============================================================
AO-XX/15 — Buyer Modal: Produkter (sammanfattning) | FIL-ID: UI/pages/freezer/buyer/modals/modal-products.js
Projekt: Freezer
Policy: no storage, XSS-safe
============================================================ */

import { openModal } from "../../00-modal-shell.js";

function el(tag) { return document.createElement(tag); }
function setText(n, t) { n.textContent = String(t == null ? "" : t); }

export function openProductsModal(payload) {
  const count = Number(payload && payload.productCount);
  const supplierCount = Number(payload && payload.supplierCount);

  openModal({
    title: "Produkter",
    size: "md",
    render(contentEl) {
      const wrap = el("div");
      wrap.style.display = "grid";
      wrap.style.gridTemplateColumns = "1fr 1fr";
      wrap.style.gap = "10px";

      function card(title, value, hint) {
        const c = el("div");
        c.style.border = "1px solid #e6e6e6";
        c.style.borderRadius = "12px";
        c.style.padding = "12px";
        c.style.background = "#fff";

        const t = el("div");
        t.style.opacity = "0.75";
        t.style.fontSize = "13px";
        setText(t, title);

        const v = el("div");
        v.style.fontWeight = "800";
        v.style.fontSize = "22px";
        v.style.marginTop = "4px";
        setText(v, Number.isFinite(value) ? String(value) : "—");

        const h = el("div");
        h.style.opacity = "0.7";
        h.style.fontSize = "12px";
        h.style.marginTop = "6px";
        setText(h, hint || "");

        c.appendChild(t);
        c.appendChild(v);
        c.appendChild(h);
        return c;
      }

      wrap.appendChild(card("Antal produkter", count, "Baserat på items/catlog i state."));
      wrap.appendChild(card("Leverantörer (unik)", supplierCount, "Unik räknare på supplier."));

      contentEl.appendChild(wrap);
    }
  });
}

