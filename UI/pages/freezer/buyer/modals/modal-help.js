/* ============================================================
AO-XX/15 — Buyer Modal: Hjälp/Guide | FIL-ID: UI/pages/freezer/buyer/modals/modal-help.js
Projekt: Freezer
Policy: no storage, XSS-safe
============================================================ */

import { openModal } from "../../00-modal-shell.js";

function el(tag) { return document.createElement(tag); }
function setText(n, t) { n.textContent = String(t == null ? "" : t); }

export function openHelpModal() {
  openModal({
    title: "Inköp – guide",
    size: "md",
    render(contentEl) {
      const p = el("div");
      p.style.opacity = "0.85";
      p.style.fontSize = "13px";
      p.style.lineHeight = "1.5";
      setText(
        p,
        "Här kan du se inköpsförslag baserat på minLevel. När inköp/inleverans byggs klart kommer du kunna skapa leveranser, lägga till rader och uppdatera saldo/historik."
      );

      const ul = el("ul");
      ul.style.marginTop = "10px";
      ul.style.opacity = "0.85";
      ul.style.fontSize = "13px";

      const li1 = el("li"); setText(li1, "Förslag = qty < minLevel");
      const li2 = el("li"); setText(li2, "Köp = (minLevel - qty)");
      const li3 = el("li"); setText(li3, "Allt är UI-only i baseline (ingen server)");

      ul.appendChild(li1);
      ul.appendChild(li2);
      ul.appendChild(li3);

      contentEl.appendChild(p);
      contentEl.appendChild(ul);
    }
  });
}

