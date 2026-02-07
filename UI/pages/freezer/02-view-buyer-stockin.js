/* ============================================================
AO-06/15 — BUYER View: Stock In (inleverans) | FIL-ID: UI/pages/freezer/02-view-buyer-stockin.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- BUYER ska kunna göra INLEVERANS (öka lagersaldo) på befintliga produkter.
- Stabil DOM: input-fält får INTE “försvinna” vid rerender/subscribe (P0).
- Använder endast FreezerStore API (adjustStock/listItems/getStock/listStock).
- UI-only • inga nya storage-keys/datamodell • XSS-safe.

P0-regel:
- Bygg DOM EN GÅNG i mount()
- Vid store-uppdatering: uppdatera endast text/listor – aldrig clear(root) + rebuild.

Export/registrering:
- ESM: export default + export const view
- Fail-soft: om FreezerViewRegistry har registerView/register -> registrera direkt.
============================================================ */

function safeStr(v) {
  try { return String(v == null ? "" : v); } catch { return ""; }
}
function norm(s) { return safeStr(s).trim(); }
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = safeStr(text);
  return n;
}
function setText(node, text) { try { if (node) node.textContent = safeStr(text); } catch {} }
function setHidden(node, hidden) { try { if (node) node.hidden = !!hidden; } catch {} }

function getStore(ctx) {
  try { return (ctx && ctx.store) ? ctx.store : (window.FreezerStore || null); } catch { return null; }
}

function formatItemLabel(it) {
  // "1008 • Falukorv • Korv • kg"
  const a = norm(it && it.articleNo);
  const name = norm(it && it.productName);
  const cat = norm(it && it.category);
  const unit = norm(it && it.unit);
  const parts = [];
  if (a) parts.push(a);
  if (name) parts.push(name);
  if (cat) parts.push(cat);
  if (unit) parts.push(unit);
  return parts.join(" • ") || "—";
}

function parseIntStrict(v) {
  const s = norm(v);
  if (!s) return null;
  // fail-closed: endast heltal
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function buildNoteWithCartons(note, cartons) {
  const n = norm(note);
  const c = cartons == null ? null : cartons;
  if (c == null) return n;
  const line = `Kartonger/kolli: ${c}`;
  if (!n) return line;
  return `${n}\n${line}`;
}

/* =========================
View implementation
========================= */

const view = {
  id: "buyer-stock-in",
  label: "Lägga in produkter",
  requiredPerm: "inventory_write",

  mount({ root, ctx, state }) {
    // Stable nodes stored on root to survive render() calls
    const box = el("div", null, null);

    const h = el("h2", null, "Lägga in produkter (inleverans)");
    h.style.margin = "0 0 6px 0";

    const p = el("div", "muted", "Sök produkt, välj artikelnummer, ange antal kg (lagerpåverkan) och spara. Kartonger/kolli är valfritt och sparas som notering.");
    p.style.marginBottom = "10px";

    const msg = el("div", null, "");
    msg.style.margin = "10px 0";
    msg.style.padding = "10px";
    msg.style.borderRadius = "10px";
    msg.style.border = "1px solid #e6e6e6";
    msg.style.background = "#fff";
    msg.hidden = true;

    const grid = el("div", null, null);
    grid.style.display = "grid";
    grid.style.gap = "6px";

    // Search
    const lblSearch = el("div", null, "Sök produkt");
    lblSearch.style.fontWeight = "600";
    lblSearch.style.fontSize = "13px";

    const inpSearch = document.createElement("input");
    inpSearch.type = "text";
    inpSearch.placeholder = "Skriv t.ex. 1008 eller Falukorv…";
    inpSearch.autocomplete = "off";
    inpSearch.style.width = "100%";
    inpSearch.style.border = "1px solid rgb(230,230,230)";
    inpSearch.style.borderRadius = "10px";
    inpSearch.style.padding = "10px";

    // Select
    const lblPick = el("div", null, "Produkt (artikelnummer) *");
    lblPick.style.fontWeight = "600";
    lblPick.style.fontSize = "13px";
    lblPick.style.marginTop = "10px";

    const sel = document.createElement("select");
    sel.style.width = "100%";
    sel.style.border = "1px solid rgb(230,230,230)";
    sel.style.borderRadius = "10px";
    sel.style.padding = "10px";

    // Kg
    const lblKg = el("div", null, "Antal kg *");
    lblKg.style.fontWeight = "600";
    lblKg.style.fontSize = "13px";
    lblKg.style.marginTop = "10px";

    const inpKg = document.createElement("input");
    inpKg.type = "number";
    inpKg.placeholder = "Ex: 10";
    inpKg.autocomplete = "off";
    inpKg.step = "1"; // matchar store (heltal)
    inpKg.style.width = "100%";
    inpKg.style.border = "1px solid rgb(230,230,230)";
    inpKg.style.borderRadius = "10px";
    inpKg.style.padding = "10px";

    // Cartons
    const lblCart = el("div", null, "Antal kartonger/kolli (valfritt)");
    lblCart.style.fontWeight = "600";
    lblCart.style.fontSize = "13px";
    lblCart.style.marginTop = "10px";

    const inpCart = document.createElement("input");
    inpCart.type = "number";
    inpCart.placeholder = "Ex: 3";
    inpCart.autocomplete = "off";
    inpCart.step = "1";
    inpCart.style.width = "100%";
    inpCart.style.border = "1px solid rgb(230,230,230)";
    inpCart.style.borderRadius = "10px";
    inpCart.style.padding = "10px";

    // Reason code (fixed for this view)
    const lblReason = el("div", null, "Orsakskod");
    lblReason.style.fontWeight = "600";
    lblReason.style.fontSize = "13px";
    lblReason.style.marginTop = "10px";

    const inpReason = document.createElement("input");
    inpReason.type = "text";
    inpReason.value = "INLEVERANS";
    inpReason.readOnly = true;
    inpReason.style.width = "100%";
    inpReason.style.border = "1px solid rgb(230,230,230)";
    inpReason.style.borderRadius = "10px";
    inpReason.style.padding = "10px";
    inpReason.style.background = "#fafafa";

    // Ref
    const lblRef = el("div", null, "Referens (valfritt)");
    lblRef.style.fontWeight = "600";
    lblRef.style.fontSize = "13px";
    lblRef.style.marginTop = "10px";

    const inpRef = document.createElement("input");
    inpRef.type = "text";
    inpRef.placeholder = "Ex: Följesedel 123";
    inpRef.autocomplete = "off";
    inpRef.style.width = "100%";
    inpRef.style.border = "1px solid rgb(230,230,230)";
    inpRef.style.borderRadius = "10px";
    inpRef.style.padding = "10px";

    // Note
    const lblNote = el("div", null, "Notering (valfritt)");
    lblNote.style.fontWeight = "600";
    lblNote.style.fontSize = "13px";
    lblNote.style.marginTop = "10px";

    const taNote = document.createElement("textarea");
    taNote.placeholder = "Ex: Leverans tisdag, pall 2, temp ok…";
    taNote.rows = 4;
    taNote.style.width = "100%";
    taNote.style.border = "1px solid rgb(230,230,230)";
    taNote.style.borderRadius = "10px";
    taNote.style.padding = "10px";
    taNote.style.resize = "vertical";

    // Buttons
    const btnRow = el("div", null, null);
    btnRow.style.display = "flex";
    btnRow.style.gap = "10px";
    btnRow.style.flexWrap = "wrap";
    btnRow.style.marginTop = "12px";
    btnRow.style.alignItems = "center";

    const btnSave = document.createElement("button");
    btnSave.type = "button";
    btnSave.textContent = "Spara inleverans";
    btnSave.className = "tabBtn";
    btnSave.style.padding = "10px 14px";
    btnSave.style.borderRadius = "12px";
    btnSave.style.border = "1px solid #111";
    btnSave.style.background = "#111";
    btnSave.style.color = "#fff";

    const btnClear = document.createElement("button");
    btnClear.type = "button";
    btnClear.textContent = "Rensa";
    btnClear.className = "tabBtn";
    btnClear.style.padding = "10px 14px";
    btnClear.style.borderRadius = "12px";

    const miniInfo = el("div", "muted", "");
    miniInfo.style.fontSize = "13px";

    btnRow.appendChild(btnSave);
    btnRow.appendChild(btnClear);
    btnRow.appendChild(miniInfo);

    // Compose grid
    grid.appendChild(lblSearch);
    grid.appendChild(inpSearch);
    grid.appendChild(lblPick);
    grid.appendChild(sel);
    grid.appendChild(lblKg);
    grid.appendChild(inpKg);
    grid.appendChild(lblCart);
    grid.appendChild(inpCart);
    grid.appendChild(lblReason);
    grid.appendChild(inpReason);
    grid.appendChild(lblRef);
    grid.appendChild(inpRef);
    grid.appendChild(lblNote);
    grid.appendChild(taNote);
    grid.appendChild(btnRow);

    box.appendChild(h);
    box.appendChild(p);
    box.appendChild(msg);
    box.appendChild(grid);

    // Attach once
    root.appendChild(box);

    // Stable state on root
    root.__frz_stockin = {
      box,
      msg,
      inpSearch,
      sel,
      inpKg,
      inpCart,
      inpRef,
      taNote,
      miniInfo,
      btnSave,
      btnClear,
      lastItemsSig: "",
      unsub: null
    };

    // Events (no rerender)
    inpSearch.addEventListener("input", () => {
      try { this.__updateOptions(root, ctx); } catch {}
    });

    btnClear.addEventListener("click", () => {
      const st = root.__frz_stockin;
      if (!st) return;
      st.inpKg.value = "";
      st.inpCart.value = "";
      st.inpRef.value = "";
      st.taNote.value = "";
      st.inpKg.focus();
      this.__hideMsg(root attach = root);
    });

    btnSave.addEventListener("click", () => {
      try { this.__onSave(root, ctx); } catch (e) {
        try { this.__showMsg(root, "Kunde inte spara: " + safeStr(e && e.message ? e.message : "okänt fel"), "danger"); } catch {}
      }
    });

    // Subscribe store updates (update lists/info only)
    const store = getStore(ctx);
    if (store && typeof store.subscribe === "function") {
      root.__frz_stockin.unsub = store.subscribe(() => {
        try { this.__refresh(root, ctx); } catch {}
      });
    }

    // Initial paint
    this.__refresh(root, ctx);
  },

  render({ root, ctx, state }) {
    // IMPORTANT: do NOT rebuild DOM; just refresh dynamic parts
    this.__refresh(root, ctx);
  },

  unmount({ root, ctx, state }) {
    try {
      const st = root.__frz_stockin;
      if (st && typeof st.unsub === "function") st.unsub();
    } catch {}
    try { delete root.__frz_stockin; } catch {}
    // Buyer controller may clear root; we don't need to.
  },

  /* =========================
  Internal helpers
  ========================= */

  __refresh(root, ctx) {
    const st = root.__frz_stockin;
    if (!st) return;

    const store = getStore(ctx);
    const status = store && typeof store.getStatus === "function" ? (store.getStatus() || {}) : {};
    const locked = !!status.locked;
    const readOnly = !!status.readOnly;

    // Disable interactions if locked/readonly or missing store
    const disable = (!store) || locked || readOnly;
    st.inpSearch.disabled = !!disable;
    st.sel.disabled = !!disable;
    st.inpKg.disabled = !!disable;
    st.inpCart.disabled = !!disable;
    st.inpRef.disabled = !!disable;
    st.taNote.disabled = !!disable;
    st.btnSave.disabled = !!disable;
    st.btnClear.disabled = !!disable;

    if (!store) {
      this.__showMsg(root, "FreezerStore saknas. Kan inte läsa produkter eller spara lagersaldo.", "danger");
      return;
    }
    if (locked) {
      this.__showMsg(root, "Systemet är i låst läge: " + safeStr(status.reason || "FRZ_E_LOCKED"), "danger");
      return;
    }
    if (readOnly) {
      this.__showMsg(root, "Read-only: " + safeStr(status.whyReadOnly || "saknar skrivläge"), "danger");
      return;
    }

    // Update options (but do not reset user input unless needed)
    this.__updateOptions(root, ctx);

    // Update mini info (selected product + current saldo)
    const selArticle = norm(st.sel.value);
    if (selArticle) {
      let onHand = null;
      try {
        const snap = store.getStock ? store.getStock(selArticle) : null;
        onHand = snap && typeof snap.onHand === "number" ? snap.onHand : null;
      } catch {}
      setText(st.miniInfo, onHand == null ? "" : ("Nuvarande saldo: " + onHand));
    } else {
      setText(st.miniInfo, "");
    }

    // hide message if everything ok and message is old
    // (we keep visible if it contains an error)
  },

  __itemsSignature(items) {
    try {
      if (!Array.isArray(items)) return "";
      // lightweight signature so we avoid rebuilding select too often
      let s = "";
      const n = Math.min(items.length, 200);
      for (let i = 0; i < n; i++) {
        const it = items[i];
        s += "|" + norm(it && it.articleNo) + ":" + norm(it && it.productName);
      }
      return s;
    } catch { return ""; }
  },

  __updateOptions(root, ctx) {
    const st = root.__frz_stockin;
    if (!st) return;

    const store = getStore(ctx);
    if (!store || typeof store.listItems !== "function") return;

    const q = norm(st.inpSearch.value).toLowerCase();
    const items = store.listItems({ includeInactive: false }) || [];
    const sig = this.__itemsSignature(items) + "§" + q;

    // Build filtered list
    let filtered = items;
    if (q) {
      filtered = items.filter(it => {
        const a = norm(it && it.articleNo).toLowerCase();
        const n = norm(it && it.productName).toLowerCase();
        const c = norm(it && it.category).toLowerCase();
        return a.includes(q) || n.includes(q) || c.includes(q);
      });
    }

    // If nothing changed, do nothing
    if (st.lastItemsSig === sig) return;
    st.lastItemsSig = sig;

    const prev = norm(st.sel.value);

    // Rebuild select options (safe because select is stable, only options replaced)
    while (st.sel.firstChild) st.sel.removeChild(st.sel.firstChild);

    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = filtered.length ? "Välj produkt…" : "Inga produkter hittades";
    st.sel.appendChild(opt0);

    for (let i = 0; i < filtered.length; i++) {
      const it = filtered[i];
      const a = norm(it && it.articleNo);
      if (!a) continue;
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = formatItemLabel(it);
      st.sel.appendChild(opt);
    }

    // Restore selection if still present
    if (prev) {
      const exists = filtered.some(it => norm(it && it.articleNo) === prev);
      st.sel.value = exists ? prev : "";
    }
  },

  __showMsg(root, text, tone) {
    const st = root.__frz_stockin;
    if (!st || !st.msg) return;
    st.msg.hidden = false;
    setText(st.msg, text);

    // Tone styling (fail-soft)
    try {
      st.msg.style.border = "1px solid #e6e6e6";
      st.msg.style.background = "#fff";
      if (tone === "danger") { st.msg.style.border = "1px solid #f2b8b5"; st.msg.style.background = "#fff5f5"; }
      if (tone === "ok") { st.msg.style.border = "1px solid #cfe9cf"; st.msg.style.background = "#f4fff4"; }
    } catch {}
  },

  __hideMsg(root) {
    const st = root.__frz_stockin;
    if (!st || !st.msg) return;
    st.msg.hidden = true;
    setText(st.msg, "");
  },

  __onSave(root, ctx) {
    const st = root.__frz_stockin;
    if (!st) return;

    const store = getStore(ctx);
    if (!store) { this.__showMsg(root, "FreezerStore saknas.", "danger"); return; }

    const status = store.getStatus ? (store.getStatus() || {}) : {};
    if (status.locked) { this.__showMsg(root, "Låst läge: " + safeStr(status.reason || "FRZ_E_LOCKED"), "danger"); return; }
    if (status.readOnly) { this.__showMsg(root, "Read-only: " + safeStr(status.whyReadOnly || ""), "danger"); return; }
    if (store.can && !store.can("inventory_write")) { this.__showMsg(root, "Saknar behörighet (inventory_write).", "danger"); return; }

    const articleNo = norm(st.sel.value);
    if (!articleNo) { this.__showMsg(root, "Välj en produkt (artikelnummer).", "danger"); return; }

    const kg = parseIntStrict(st.inpKg.value);
    if (kg == null || kg <= 0) { this.__showMsg(root, "Antal kg måste vara ett heltal > 0.", "danger"); return; }

    const cartons = norm(st.inpCart.value);
    let cartonsInt = null;
    if (cartons) {
      const ci = parseIntStrict(cartons);
      if (ci == null || ci < 0) { this.__showMsg(root, "Kartonger/kolli måste vara ett heltal >= 0.", "danger"); return; }
      cartonsInt = ci;
    }

    const ref = norm(st.inpRef.value);
    const noteRaw = norm(st.taNote.value);
    const note = buildNoteWithCartons(noteRaw, cartonsInt);

    // Unit from items (fail-soft)
    let unit = "";
    try {
      const items = store.listItems ? (store.listItems({ includeInactive: false }) || []) : [];
      const it = items.find(x => x && norm(x.articleNo) === articleNo) || null;
      unit = norm(it && it.unit) || "";
    } catch {}

    // Before/after for user feedback (fail-soft)
    let before = null;
    try {
      const snap = store.getStock ? store.getStock(articleNo) : null;
      before = snap && typeof snap.onHand === "number" ? snap.onHand : null;
    } catch {}

    const fn = store.adjustStock;
    if (typeof fn !== "function") { this.__showMsg(root, "Store.adjustStock saknas.", "danger"); return; }

    const res = fn.call(store, {
      articleNo,
      delta: kg,
      unit,
      reasonCode: "INLEVERANS",
      ref,
      note
    });

    if (res && res.ok === false) {
      this.__showMsg(root, safeStr(res.reason || "Kunde inte spara inleverans."), "danger");
      return;
    }

    // After
    let after = null;
    try {
      const snap2 = store.getStock ? store.getStock(articleNo) : null;
      after = snap2 && typeof snap2.onHand === "number" ? snap2.onHand : null;
    } catch {}

    const msg = (before == null || after == null)
      ? "Inleverans sparad."
      : `Inleverans sparad. Saldo: ${before} → ${after}`;

    this.__showMsg(root, msg, "ok");

    // Clear only fields that should reset
    st.inpKg.value = "";
    st.inpCart.value = "";
    st.inpRef.value = "";
    st.taNote.value = "";
    st.inpKg.focus();
  }
};

/* =========================
Fail-soft registry registration
========================= */

try {
  const reg = window.FreezerViewRegistry;
  if (reg && typeof reg.registerView === "function") {
    reg.registerView("buyer", view);
  } else if (reg && typeof reg.register === "function") {
    reg.register("buyer", view);
  }
} catch {}

/* =========================
ESM exports
========================= */
export { view };
export default view;

/* ============================================================
ÄNDRINGSLOGG (≤8)
1) Ny BUYER-vy: buyer-stock-in (inleverans) med stabil DOM (P0).
2) Bygger DOM en gång i mount(); render()/subscribe uppdaterar endast options/info.
3) Spara → FreezerStore.adjustStock({ delta:+kg, reasonCode:"INLEVERANS", ref, note }).
4) Kartonger/kolli sparas som del av note (ingen ny datamodell/ny storage-key).
5) Fail-closed validering: produkt krävs, kg måste vara heltal > 0, cartons heltal >= 0.
============================================================ */

