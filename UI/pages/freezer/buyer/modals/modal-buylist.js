/* ============================================================
AO-XX/15 — Buyer Modal: Inköpslista | FIL-ID: UI/pages/freezer/buyer/modals/modal-buylist.js
Projekt: Freezer

Syfte:
- Visar rekommenderad inköpslista i modal.
- Egen fil (per ruta).
Policy:
- Ingen storage
- XSS-safe DOM
============================================================ */

import { openModal } from "../../00-modal-shell.js";

function el(tag) { return document.createElement(tag); }
function setText(n, t) { n.textContent = String(t == null ? "" : t); }

export function openBuyListModal(payload) {
  const list = (payload && Array.isArray(payload.list)) ? payload.list : [];

  openModal({
    title: "Rekommenderad inköpslista",
    size: "lg",
    render(contentEl) {
      const hint = el("div");
      hint.style.opacity = "0.75";
      hint.style.fontSize = "13px";
      setText(hint, "Bygger på qty < minLevel. Deficit = (minLevel - qty).");
      contentEl.appendChild(hint);

      if (!list.length) {
        const empty = el("div");
        empty.style.marginTop = "10px";
        empty.style.opacity = "0.75";
        empty.style.fontSize = "13px";
        setText(empty, "Inga inköpsbehov hittades (eller minLevel saknas).");
        contentEl.appendChild(empty);
        return;
      }

      const table = el("div");
      table.style.marginTop = "12px";
      table.style.display = "grid";
      table.style.gridTemplateColumns = "140px 1fr 120px 120px";
      table.style.gap = "8px";
      table.style.alignItems = "center";
      table.style.fontSize = "13px";

      function cell(txt, bold) {
        const d = el("div");
        if (bold) d.style.fontWeight = "700";
        setText(d, txt);
        return d;
      }

      table.appendChild(cell("Artikel", true));
      table.appendChild(cell("Leverantör / kategori", true));
      table.appendChild(cell("Qty", true));
      table.appendChild(cell("Köp", true));

      for (const r of list) {
        table.appendChild(cell(r.articleNo || "—", false));
        table.appendChild(cell(`${r.supplier || "—"} • ${r.category || "—"}`, false));
        table.appendChild(cell(String(r.qty ?? "—"), false));
        table.appendChild(cell(String(r.deficit ?? "—"), false));
      }

      contentEl.appendChild(table);
    }
  });
}

