/* ============================================================
AO-05/15 — View Registry (ESM, self-contained) | FIL-ID: UI/pages/freezer/01-view-registry.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Central export av vy-listor per roll (shared/admin/buyer/picker).
- P0 FIX: inga externa view-imports som kan ge 404 och krascha ESM-modulen.
- BUYER: inköpsrutor + Lagersaldo-ruta:
  - Ny Leverantör (modal)
  - Ny produkt (modal FORM -> FreezerStore.createItem)
  - Lägga in produkter (placeholder)
  - Sök Leverantör (inline: lista + sök)
  - Lagersaldo (inline: sök + tabell)

POLICY (LÅST):
- UI-only • inga nya storage-keys/datamodell i UI
- XSS-safe: endast createElement + textContent
- Fail-closed friendly: registry skapas även om modal/store saknas
============================================================ */

import { createView, freezeView, validateViewShape } from "./00-view-interface.js";

/* =========================
BLOCK 1 — helpers
========================= */

function defineView(spec) {
  const v = createView(spec);
  validateViewShape(v);
  return freezeView(v);
}

function normalizeRole(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r === "inköpare" || r === "buyer") return "buyer";
  if (r === "admin") return "admin";
  if (r === "picker" || r === "plock" || r === "plockare") return "picker";
  return "shared";
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function clear(root) {
  try { while (root && root.firstChild) root.removeChild(root.firstChild); } catch {}
}

function safeStr(v) {
  try { return String(v == null ? "" : v); } catch { return ""; }
}

function inputRow(label, placeholder, type) {
  const wrap = el("div", null, null);
  wrap.style.display = "grid";
  wrap.style.gap = "6px";
  wrap.style.margin = "0 0 10px 0";

  const l = el("div", null, label);
  l.style.fontWeight = "600";
  l.style.fontSize = "13px";

  const i = document.createElement("input");
  i.type = type || "text";
  i.placeholder = placeholder || "";
  i.style.width = "100%";
  i.style.border = "1px solid #e6e6e6";
  i.style.borderRadius = "10px";
  i.style.padding = "10px";
  i.autocomplete = "off";

  wrap.appendChild(l);
  wrap.appendChild(i);

  return { wrap, input: i };
}

function checkboxRow(label) {
  const wrap = el("div", null, null);
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "10px";
  wrap.style.margin = "0 0 10px 0";

  const cb = document.createElement("input");
  cb.type = "checkbox";

  const l = el("div", null, label);
  l.style.fontWeight = "600";
  l.style.fontSize = "13px";

  wrap.appendChild(cb);
  wrap.appendChild(l);

  return { wrap, checkbox: cb };
}

function selectRow(label, options, placeholder) {
  const wrap = el("div", null, null);
  wrap.style.display = "grid";
  wrap.style.gap = "6px";
  wrap.style.margin = "0 0 10px 0";

  const l = el("div", null, label);
  l.style.fontWeight = "600";
  l.style.fontSize = "13px";

  const s = document.createElement("select");
  s.style.width = "100%";
  s.style.border = "1px solid #e6e6e6";
  s.style.borderRadius = "10px";
  s.style.padding = "10px";
  s.style.background = "#fff";

  const first = document.createElement("option");
  first.value = "";
  first.textContent = placeholder || "—";
  s.appendChild(first);

  const list = Array.isArray(options) ? options : [];
  for (let i = 0; i < list.length; i++) {
    const opt = list[i];
    if (!opt) continue;
    const o = document.createElement("option");
    o.value = safeStr(opt.value);
    o.textContent = safeStr(opt.label);
    s.appendChild(o);
  }

  wrap.appendChild(l);
  wrap.appendChild(s);

  return { wrap, select: s };
}

function textareaRow(label, placeholder) {
  const wrap = el("div", null, null);
  wrap.style.display = "grid";
  wrap.style.gap = "6px";
  wrap.style.margin = "0 0 10px 0";

  const l = el("div", null, label);
  l.style.fontWeight = "600";
  l.style.fontSize = "13px";

  const t = document.createElement("textarea");
  t.placeholder = placeholder || "";
  t.style.width = "100%";
  t.style.border = "1px solid #e6e6e6";
  t.style.borderRadius = "10px";
  t.style.padding = "10px";
  t.style.minHeight = "90px";

  wrap.appendChild(l);
  wrap.appendChild(t);

  return { wrap, textarea: t };
}

function pill(msg, kind) {
  const p = el("div", null, msg);
  p.style.padding = "10px";
  p.style.borderRadius = "10px";
  p.style.border = "1px solid #e6e6e6";
  p.style.background = "#fff";
  if (kind === "ok") {
    p.style.borderColor = "#bfe7c7";
    p.style.background = "#f3fff6";
  } else if (kind === "warn") {
    p.style.borderColor = "#ffe0a6";
    p.style.background = "#fffaf0";
  } else if (kind === "err") {
    p.style.borderColor = "#ffb3b3";
    p.style.background = "#fff5f5";
  }
  return p;
}

function formatDateTime(ts) {
  try {
    if (!ts) return "";
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    // sv-SE, kort och läsbart
    return d.toLocaleString("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/* =========================
BLOCK 1.1 — Modal helper (fail-soft)
========================= */

function tryOpenModalWithRender(title, renderFn, onClose) {
  try {
    const m = window.FreezerModal;
    if (!m) return { ok: false, ctrl: null, mode: "inline" };

    const openFn =
      (typeof m.open === "function" && m.open) ||
      (typeof m.show === "function" && m.show) ||
      null;

    if (!openFn) return { ok: false, ctrl: null, mode: "inline" };

    openFn({
      title: safeStr(title || "—"),
      render: typeof renderFn === "function" ? renderFn : undefined,
      onClose: typeof onClose === "function" ? onClose : undefined
    });

    const ctrl = {
      close: () => {
        try {
          if (window.FreezerModal && typeof window.FreezerModal.close === "function") window.FreezerModal.close();
        } catch {}
      }
    };

    return { ok: true, ctrl, mode: "modal" };
  } catch {
    return { ok: false, ctrl: null, mode: "inline" };
  }
}

function defineModalOrInlineView(spec) {
  const id = String(spec.id || "").trim();
  const label = String(spec.label || id).trim();
  const title = String(spec.title || label).trim();

  return defineView({
    id,
    label,
    requiredPerm: spec.requiredPerm ?? null,

    mount: ({ root, ctx }) => {
      const inlineBox = el("div", "panel", null);
      inlineBox.style.background = "#fff";
      inlineBox.style.border = "1px solid #e6e6e6";
      inlineBox.style.borderRadius = "12px";
      inlineBox.style.padding = "12px";

      function renderInto(target) {
        try {
          clear(target);
          spec.renderBody(target, { root, ctx, state: {} });
        } catch {}
      }

      const res = tryOpenModalWithRender(title, (modalBody) => {
        renderInto(modalBody);
        try { root.__frzModalBody = modalBody; } catch {}
      }, () => {});

      if (res && res.ok) {
        try { root.__frzModalCtrl = res.ctrl; } catch {}
        clear(root);
        return;
      }

      clear(root);
      root.appendChild(inlineBox);
      renderInto(inlineBox);

      try {
        root.__frzModalCtrl = null;
        root.__frzModalBody = inlineBox;
      } catch {}
    },

    unmount: ({ root }) => {
      try {
        const ctrl = root.__frzModalCtrl;
        if (ctrl && typeof ctrl.close === "function") ctrl.close();
      } catch {}
      try {
        delete root.__frzModalCtrl;
        delete root.__frzModalBody;
      } catch {}
    },

    render: ({ root, state, ctx }) => {
      try {
        const body = root.__frzModalBody;
        if (body && body instanceof HTMLElement) {
          clear(body);
          spec.renderBody(body, { root, state: state || {}, ctx });
          return;
        }
      } catch {}

      clear(root);
      const box = el("div", "panel", null);
      box.style.background = "#fff";
      box.style.border = "1px solid #e6e6e6";
      box.style.borderRadius = "12px";
      box.style.padding = "12px";
      try { spec.renderBody(box, { root, state: state || {}, ctx }); } catch {}
      root.appendChild(box);
    }
  });
}

/* =========================
BLOCK 2 — Views
========================= */

// SHARED (placeholder)
const sharedSaldoView = defineView({
  id: "shared-saldo",
  label: "Saldo",
  requiredPerm: null,
  mount: ({ root }) => {
    clear(root);
    const b = el("div", "panel", null);
    b.appendChild(el("b", null, "Saldo (shared)"));
    b.appendChild(el("div", "muted", "Placeholder: shared saldo-vy kommer i senare AO."));
    root.appendChild(b);
  },
  render: () => {},
  unmount: () => {}
});

const sharedHistoryView = defineView({
  id: "shared-history",
  label: "Historik",
  requiredPerm: null,
  mount: ({ root }) => {
    clear(root);
    const b = el("div", "panel", null);
    b.appendChild(el("b", null, "Historik (shared)"));
    b.appendChild(el("div", "muted", "Placeholder: shared historik-vy kommer i senare AO."));
    root.appendChild(b);
  },
  render: () => {},
  unmount: () => {}
});

/* =========================
BLOCK 2.0 — BUYER: Lagersaldo (INLINE)
- Visar saldo direkt (så ny produkt kan bekräftas genom att den syns/inte syns)
- Fail-soft: försöker flera API-varianter:
  - store.listStock()
  - store.getStock()
  - state.stock / state.saldo / state.inventory (vanliga shapes)
========================= */

function extractStockRowsFromStoreOrState(store, state) {
  // Return: [{ articleNo, productName, supplierName, onHand, unit, updatedAt }]
  const rows = [];

  function pushRow(r) {
    if (!r) return;
    const articleNo = safeStr(r.articleNo || r.sku || r.itemId).trim();
    if (!articleNo) return;
    rows.push({
      articleNo,
      productName: safeStr(r.productName || r.name || r.title).trim(),
      supplierName: safeStr(r.supplierName || r.supplier || r.companyName).trim(),
      onHand: r.onHand,
      unit: safeStr(r.unit || r.uom).trim(),
      updatedAt: r.updatedAt || r.ts || r.timestamp || ""
    });
  }

  // 1) listStock()
  try {
    if (store && typeof store.listStock === "function") {
      const list = store.listStock({}) || store.listStock() || [];
      if (Array.isArray(list)) {
        for (const it of list) pushRow(it);
        if (rows.length) return rows;
      }
    }
  } catch {}

  // 2) getStock()
  try {
    if (store && typeof store.getStock === "function") {
      const list = store.getStock({}) || store.getStock() || [];
      if (Array.isArray(list)) {
        for (const it of list) pushRow(it);
        if (rows.length) return rows;
      }
    }
  } catch {}

  // 3) state heuristics
  const s = state && typeof state === "object" ? state : {};

  const candidates = [
    s.stock,
    s.saldo,
    s.inventory,
    s.stockRows,
    s.saldoRows,
    s.stockSnapshot,
    (s.stock && s.stock.rows) ? s.stock.rows : null,
    (s.saldo && s.saldo.rows) ? s.saldo.rows : null
  ];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c) continue;
    if (Array.isArray(c)) {
      for (const it of c) pushRow(it);
      if (rows.length) return rows;
    }
  }

  return rows;
}

function buildItemIndex(store) {
  // articleNo -> { productName, unit, supplierId/supplier, supplierName }
  const map = new Map();
  try {
    if (!store || typeof store.listItems !== "function") return map;
    const list = store.listItems({ includeInactive: true }) || store.listItems() || [];
    if (!Array.isArray(list)) return map;

    for (const it of list) {
      if (!it) continue;
      const a = safeStr(it.articleNo || it.sku || it.itemId).trim();
      if (!a) continue;
      map.set(a, {
        productName: safeStr(it.productName || it.name || it.title).trim(),
        unit: safeStr(it.unit || it.uom).trim(),
        supplierId: safeStr(it.supplierId || it.supplier || it.supplier_id).trim()
      });
    }
  } catch {}
  return map;
}

function buildSupplierIndex(store) {
  // supplierId -> companyName
  const map = new Map();
  try {
    if (!store || typeof store.listSuppliers !== "function") return map;
    const list = store.listSuppliers({ includeInactive: true }) || store.listSuppliers() || [];
    if (!Array.isArray(list)) return map;

    for (const s of list) {
      if (!s) continue;
      const id = safeStr(s.id).trim();
      if (!id) continue;
      map.set(id, safeStr(s.companyName || s.name).trim());
    }
  } catch {}
  return map;
}

const buyerSaldo = defineView({
  id: "buyer-saldo",
  label: "Lagersaldo",
  requiredPerm: null,

  mount: ({ root }) => {
    clear(root);

    const wrap = el("div", "panel", null);
    wrap.style.background = "#fff";
    wrap.style.border = "1px solid #e6e6e6";
    wrap.style.borderRadius = "12px";
    wrap.style.padding = "12px";

    const head = el("div", null, null);
    head.style.display = "flex";
    head.style.alignItems = "center";
    head.style.gap = "10px";
    head.style.marginBottom = "10px";

    const h = el("h3", null, "Lagersaldo");
    h.style.margin = "0";
    h.style.flex = "1";

    const countPill = el("div", null, null);
    countPill.style.display = "inline-flex";
    countPill.style.gap = "8px";
    countPill.style.alignItems = "center";
    countPill.style.padding = "6px 10px";
    countPill.style.borderRadius = "999px";
    countPill.style.border = "1px solid #e6e6e6";
    countPill.style.background = "#fafafa";
    countPill.style.fontSize = "13px";

    const countLabel = el("span", null, "Artiklar:");
    countLabel.style.opacity = "0.75";
    const countVal = el("b", null, "0");
    countVal.style.fontWeight = "700";

    countPill.appendChild(countLabel);
    countPill.appendChild(countVal);

    head.appendChild(h);
    head.appendChild(countPill);

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Sök artikelnummer, produkt eller leverantör…";
    search.style.width = "100%";
    search.style.border = "1px solid #e6e6e6";
    search.style.borderRadius = "10px";
    search.style.padding = "10px";
    search.autocomplete = "off";

    const msgBox = el("div", null, null);
    msgBox.style.marginTop = "10px";

    const tableWrap = el("div", null, null);
    tableWrap.style.marginTop = "10px";
    tableWrap.style.border = "1px solid #e6e6e6";
    tableWrap.style.borderRadius = "12px";
    tableWrap.style.overflow = "hidden";

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.fontSize = "14px";

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    const cols = ["Artikel", "Produkt", "Leverantör", "Saldo", "Enhet", "Uppdaterad"];
    for (const c of cols) {
      const th = document.createElement("th");
      th.textContent = c;
      th.style.textAlign = "left";
      th.style.padding = "10px";
      th.style.borderBottom = "1px solid #eee";
      th.style.background = "#fafafa";
      th.style.fontWeight = "700";
      trh.appendChild(th);
    }
    thead.appendChild(trh);

    const tbody = document.createElement("tbody");

    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    wrap.appendChild(head);
    wrap.appendChild(search);
    wrap.appendChild(msgBox);
    wrap.appendChild(tableWrap);

    root.appendChild(wrap);

    try {
      root.__buyerSaldo = { search, tbody, countVal, msgBox };
    } catch {}

    search.addEventListener("input", () => {
      try {
        // render triggas av routerRerender, men vi stödjer även direkt render via senaste state-cachen
        if (root.__buyerSaldoLast) {
          buyerSaldo.render({ root, state: root.__buyerSaldoLast.state || {}, ctx: root.__buyerSaldoLast.ctx || {} });
        }
      } catch {}
    });
  },

  render: ({ root, state, ctx }) => {
    const ui = root && root.__buyerSaldo ? root.__buyerSaldo : null;
    if (!ui) return;

    // cache för snabb input-render
    try { root.__buyerSaldoLast = { state: state || {}, ctx: ctx || {} }; } catch {}

    const store = (ctx && ctx.store) ? ctx.store : (window.FreezerStore || null);

    // Rensa
    try { clear(ui.msgBox); } catch {}
    try { while (ui.tbody.firstChild) ui.tbody.removeChild(ui.tbody.firstChild); } catch {}

    if (!store) {
      try { ui.msgBox.appendChild(pill("FreezerStore saknas. Kan inte läsa saldo.", "err")); } catch {}
      try { ui.countVal.textContent = "0"; } catch {}
      return;
    }

    // Hämta råa rader
    const rawRows = extractStockRowsFromStoreOrState(store, state || {});
    const itemIdx = buildItemIndex(store);
    const supIdx = buildSupplierIndex(store);

    // Förädla (mappa namn/enhet/leverantör)
    const rows = rawRows.map(r => {
      const a = safeStr(r.articleNo).trim();
      const it = itemIdx.get(a) || {};
      const supplierName =
        safeStr(r.supplierName).trim() ||
        (it.supplierId ? (supIdx.get(it.supplierId) || "") : "");
      const productName =
        safeStr(r.productName).trim() ||
        safeStr(it.productName).trim();

      const unit =
        safeStr(r.unit).trim() ||
        safeStr(it.unit).trim();

      let onHand = r.onHand;
      if (onHand == null || onHand === "") onHand = r.qty;
      // Visa som text (ingen toFixed tvång)
      const onHandText = (onHand == null || onHand === "") ? "—" : safeStr(onHand);

      return {
        articleNo: a,
        productName: productName || "—",
        supplierName: supplierName || "—",
        onHandText,
        unit: unit || "—",
        updatedAt: formatDateTime(r.updatedAt) || ""
      };
    });

    // Filter
    const q = safeStr(ui.search.value).trim().toLowerCase();
    const filtered = !q ? rows : rows.filter(r => {
      return (
        safeStr(r.articleNo).toLowerCase().includes(q) ||
        safeStr(r.productName).toLowerCase().includes(q) ||
        safeStr(r.supplierName).toLowerCase().includes(q)
      );
    });

    // Sort: artikel
    filtered.sort((a, b) => safeStr(a.articleNo).localeCompare(safeStr(b.articleNo), "sv-SE"));

    try { ui.countVal.textContent = String(filtered.length); } catch {}

    if (!rawRows.length) {
      try {
        ui.msgBox.appendChild(
          pill("Inget saldo hittades än. (Om du precis skapade en produkt: saldo skapas ofta först när man gör en in-/ut-leverans i historik.)", "warn")
        );
      } catch {}
    }

    if (!filtered.length) {
      try { ui.msgBox.appendChild(pill("Inga matchningar.", "warn")); } catch {}
      return;
    }

    for (const r of filtered) {
      const tr = document.createElement("tr");

      function td(text) {
        const cell = document.createElement("td");
        cell.textContent = safeStr(text);
        cell.style.padding = "10px";
        cell.style.borderBottom = "1px solid #f2f2f2";
        cell.style.verticalAlign = "top";
        return cell;
      }

      tr.appendChild(td(r.articleNo));
      tr.appendChild(td(r.productName));
      tr.appendChild(td(r.supplierName));
      tr.appendChild(td(r.onHandText));
      tr.appendChild(td(r.unit));
      tr.appendChild(td(r.updatedAt || "—"));

      ui.tbody.appendChild(tr);
    }
  },

  unmount: ({ root }) => {
    try { delete root.__buyerSaldo; } catch {}
    try { delete root.__buyerSaldoLast; } catch {}
  }
});

/* =========================
BLOCK 2.1 — BUYER: Ny Leverantör (MODAL FORM)
========================= */

const buyerSupplierNew = defineModalOrInlineView({
  id: "buyer-supplier-new",
  label: "Ny Leverantör",
  title: "Ny Leverantör",
  requiredPerm: null,

  renderBody: (root, args) => {
    const ctx = (args && args.ctx) ? args.ctx : {};
    const store = ctx && ctx.store ? ctx.store : (window.FreezerStore || null);

    const head = el("div", null, null);
    head.style.display = "flex";
    head.style.alignItems = "center";
    head.style.gap = "10px";
    head.style.marginBottom = "10px";

    const h = el("h3", null, "Registrera ny leverantör");
    h.style.margin = "0";
    h.style.flex = "1";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Stäng";
    closeBtn.style.border = "1px solid #e6e6e6";
    closeBtn.style.background = "#fff";
    closeBtn.style.borderRadius = "10px";
    closeBtn.style.padding = "8px 10px";
    closeBtn.style.cursor = "pointer";
    closeBtn.addEventListener("click", () => {
      try {
        if (window.FreezerModal && typeof window.FreezerModal.close === "function") window.FreezerModal.close();
      } catch {}
    });

    head.appendChild(h);
    head.appendChild(closeBtn);

    const note = el("div", "muted", "Företagsnamn krävs. Övriga fält är valfria.");
    note.style.margin = "0 0 12px 0";

    const form = document.createElement("form");
    form.autocomplete = "off";

    const rCompany = inputRow("Företagsnamn *", "Ex: Fisk & Fry AB", "text");
    const rOrg = inputRow("Org-nr (valfritt)", "Ex: 556123-4567", "text");
    const rContact = inputRow("Kontaktperson (valfritt)", "Ex: Anna Andersson", "text");
    const rPhone = inputRow("Telefon (valfritt)", "Ex: 070-123 45 67", "text");
    const rEmail = inputRow("E-post (valfritt)", "Ex: inkop@leverantor.se", "email");
    const rAddr = inputRow("Adress (valfritt)", "Gata, postnr, ort", "text");
    const rNotes = textareaRow("Notering (valfritt)", "Ex: Levererar tisdagar/torsdagar...");

    const msgBox = el("div", null, null);
    msgBox.style.marginTop = "10px";

    const actions = el("div", null, null);
    actions.style.display = "flex";
    actions.style.gap = "10px";
    actions.style.marginTop = "12px";
    actions.style.alignItems = "center";

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Spara leverantör";
    saveBtn.style.border = "1px solid #e6e6e6";
    saveBtn.style.background = "#111";
    saveBtn.style.color = "#fff";
    saveBtn.style.borderRadius = "10px";
    saveBtn.style.padding = "10px 12px";
    saveBtn.style.cursor = "pointer";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = "Rensa";
    resetBtn.style.border = "1px solid #e6e6e6";
    resetBtn.style.background = "#fff";
    resetBtn.style.borderRadius = "10px";
    resetBtn.style.padding = "10px 12px";
    resetBtn.style.cursor = "pointer";

    resetBtn.addEventListener("click", () => {
      try {
        rCompany.input.value = "";
        rOrg.input.value = "";
        rContact.input.value = "";
        rPhone.input.value = "";
        rEmail.input.value = "";
        rAddr.input.value = "";
        rNotes.textarea.value = "";
        clear(msgBox);
        rCompany.input.focus();
      } catch {}
    });

    actions.appendChild(saveBtn);
    actions.appendChild(resetBtn);

    if (!store || typeof store.createSupplier !== "function") {
      msgBox.appendChild(pill("FreezerStore saknas eller stöd för createSupplier() finns inte. Kontrollera att 03-store.js laddas före registry/controller.", "err"));
    } else {
      try {
        const st = typeof store.getStatus === "function" ? store.getStatus() : null;
        if (st && st.locked) msgBox.appendChild(pill("Låst läge: " + safeStr(st.reason || "FRZ_E_LOCKED"), "err"));
        else if (st && st.readOnly) msgBox.appendChild(pill("Read-only: " + safeStr(st.whyReadOnly || "read-only"), "warn"));
      } catch {}
    }

    function setBusy(isBusy) {
      try {
        saveBtn.disabled = !!isBusy;
        resetBtn.disabled = !!isBusy;
        saveBtn.style.opacity = isBusy ? "0.6" : "1";
      } catch {}
    }

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      clear(msgBox);

      const companyName = safeStr(rCompany.input.value).trim();
      if (!companyName) {
        msgBox.appendChild(pill("Företagsnamn krävs.", "err"));
        try { rCompany.input.focus(); } catch {}
        return;
      }

      if (!store || typeof store.createSupplier !== "function") {
        msgBox.appendChild(pill("Kan inte spara: FreezerStore.createSupplier() saknas.", "err"));
        return;
      }

      setBusy(true);

      try {
        const payload = {
          companyName,
          orgNo: safeStr(rOrg.input.value).trim(),
          contactPerson: safeStr(rContact.input.value).trim(),
          phone: safeStr(rPhone.input.value).trim(),
          email: safeStr(rEmail.input.value).trim(),
          address: safeStr(rAddr.input.value).trim(),
          notes: safeStr(rNotes.textarea.value).trim()
        };

        const res = store.createSupplier(payload);

        if (!res || res.ok !== true) {
          msgBox.appendChild(pill("Kunde inte spara: " + safeStr(res && res.reason ? res.reason : "okänt fel"), "err"));
          setBusy(false);
          return;
        }

        msgBox.appendChild(pill("Leverantör sparad.", "ok"));

        try {
          rCompany.input.value = "";
          rOrg.input.value = "";
          rContact.input.value = "";
          rPhone.input.value = "";
          rEmail.input.value = "";
          rAddr.input.value = "";
          rNotes.textarea.value = "";
        } catch {}

        setBusy(false);
        try { rCompany.input.focus(); } catch {}
      } catch (e) {
        msgBox.appendChild(pill("Fel vid sparande: " + safeStr(e && e.message ? e.message : "okänt"), "err"));
        setBusy(false);
      }
    });

    form.appendChild(rCompany.wrap);
    form.appendChild(rOrg.wrap);
    form.appendChild(rContact.wrap);
    form.appendChild(rPhone.wrap);
    form.appendChild(rEmail.wrap);
    form.appendChild(rAddr.wrap);
    form.appendChild(rNotes.wrap);
    form.appendChild(actions);

    root.appendChild(head);
    root.appendChild(note);
    root.appendChild(form);
    root.appendChild(msgBox);
  }
});

/* =========================
BLOCK 2.2 — BUYER: Ny produkt (MODAL FORM)
Ordning (KRAV): Leverantör → Kategori → Produkt → Förpackningsstorlek → kg/pris
Allt frivilligt UTOM articleNo (krav i store)
========================= */

const buyerItemNew = defineModalOrInlineView({
  id: "buyer-item-new",
  label: "Ny produkt",
  title: "Ny produkt",
  requiredPerm: "inventory_write",

  renderBody: (root, args) => {
    const ctx = (args && args.ctx) ? args.ctx : {};
    const store = ctx && ctx.store ? ctx.store : (window.FreezerStore || null);

    const head = el("div", null, null);
    head.style.display = "flex";
    head.style.alignItems = "center";
    head.style.gap = "10px";
    head.style.marginBottom = "10px";

    const h = el("h3", null, "Registrera ny produkt");
    h.style.margin = "0";
    h.style.flex = "1";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "Stäng";
    closeBtn.style.border = "1px solid #e6e6e6";
    closeBtn.style.background = "#fff";
    closeBtn.style.borderRadius = "10px";
    closeBtn.style.padding = "8px 10px";
    closeBtn.style.cursor = "pointer";
    closeBtn.addEventListener("click", () => {
      try {
        if (window.FreezerModal && typeof window.FreezerModal.close === "function") window.FreezerModal.close();
      } catch {}
    });

    head.appendChild(h);
    head.appendChild(closeBtn);

    const note = el("div", "muted",
      "Artikelnummer krävs. Allt annat är frivilligt. Leverantör kan lämnas tom."
    );
    note.style.margin = "0 0 12px 0";

    const form = document.createElement("form");
    form.autocomplete = "off";

    // --- Leverantörer dropdown (frivillig)
    let supplierOptions = [];
    try {
      if (store && typeof store.listSuppliers === "function") {
        const list = store.listSuppliers({ includeInactive: false }) || [];
        supplierOptions = list.map(s => ({
          value: safeStr(s && s.id),
          label: safeStr(s && s.companyName) + (s && s.orgNo ? " • " + safeStr(s.orgNo) : "")
        }));
      }
    } catch { supplierOptions = []; }

    const rSupplier = selectRow("Leverantör (valfritt)", supplierOptions, supplierOptions.length ? "Välj leverantör…" : "Inga leverantörer ännu");
    const rCategory = inputRow("Kategori (valfritt)", "Ex: Fisk, Grönsaker, Glass", "text");
    const rProductName = inputRow("Produktnamn (valfritt)", "Ex: Torskfilé", "text");
    const rPack = inputRow("Förpackningsstorlek (valfritt)", "Ex: 2x2,5 kg eller 10 kg", "text");
    const rPrice = inputRow("kg/pris (valfritt)", "Ex: 79.90", "number");

    // --- Övrigt (frivilligt)
    const hr = el("div", null, null);
    hr.style.height = "1px";
    hr.style.background = "#eee";
    hr.style.margin = "12px 0";

    const rArticle = inputRow("Artikelnummer *", "Ex: 100200", "text");
    const rUnit = inputRow("Enhet (valfritt)", "Ex: kg, st, förp", "text");
    const rTemp = inputRow("Tempklass (valfritt)", "Ex: FRYS", "text");
    const rMin = inputRow("Min-nivå (valfritt)", "Ex: 10", "number");
    const rEAN = inputRow("Streckkod / EAN (valfritt)", "Ex: 7312345678901", "text");
    const rLoc = inputRow("Lagringsplats (valfritt)", "Ex: Frys A / Hylla 3", "text");
    const rNotes = textareaRow("Notering (valfritt)", "Ex: Intern info, hantering, leveransdag…");
    const rExpiry = checkboxRow("Kräver bäst-före / batch (valfritt)");

    // Defaults som känns rimliga men är frivilliga
    try { rUnit.input.value = "kg"; } catch {}
    try { rTemp.input.value = "FRYS"; } catch {}

    const msgBox = el("div", null, null);
    msgBox.style.marginTop = "10px";

    const actions = el("div", null, null);
    actions.style.display = "flex";
    actions.style.gap = "10px";
    actions.style.marginTop = "12px";
    actions.style.alignItems = "center";

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.textContent = "Spara produkt";
    saveBtn.style.border = "1px solid #e6e6e6";
    saveBtn.style.background = "#111";
    saveBtn.style.color = "#fff";
    saveBtn.style.borderRadius = "10px";
    saveBtn.style.padding = "10px 12px";
    saveBtn.style.cursor = "pointer";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.textContent = "Rensa";
    resetBtn.style.border = "1px solid #e6e6e6";
    resetBtn.style.background = "#fff";
    resetBtn.style.borderRadius = "10px";
    resetBtn.style.padding = "10px 12px";
    resetBtn.style.cursor = "pointer";

    actions.appendChild(saveBtn);
    actions.appendChild(resetBtn);

    function setBusy(isBusy) {
      try {
        saveBtn.disabled = !!isBusy;
        resetBtn.disabled = !!isBusy;
        saveBtn.style.opacity = isBusy ? "0.6" : "1";
      } catch {}
    }

    resetBtn.addEventListener("click", () => {
      try {
        rSupplier.select.value = "";
        rCategory.input.value = "";
        rProductName.input.value = "";
        rPack.input.value = "";
        rPrice.input.value = "";

        rArticle.input.value = "";
        rUnit.input.value = "kg";
        rTemp.input.value = "FRYS";
        rMin.input.value = "";
        rEAN.input.value = "";
        rLoc.input.value = "";
        rNotes.textarea.value = "";
        rExpiry.checkbox.checked = false;

        clear(msgBox);
        rSupplier.select.focus();
      } catch {}
    });

    // Behörighet/hälsa (fail-soft)
    if (!store || typeof store.createItem !== "function") {
      msgBox.appendChild(pill("FreezerStore saknas eller stöd för createItem() finns inte. Kontrollera att 03-store.js laddas före registry/controller.", "err"));
    } else {
      try {
        const st = typeof store.getStatus === "function" ? store.getStatus() : null;
        if (st && st.locked) msgBox.appendChild(pill("Låst läge: " + safeStr(st.reason || "FRZ_E_LOCKED"), "err"));
        else if (st && st.readOnly) msgBox.appendChild(pill("Read-only: " + safeStr(st.whyReadOnly || "read-only"), "warn"));
      } catch {}
    }

    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      clear(msgBox);

      const articleNo = safeStr(rArticle.input.value).trim();
      if (!articleNo) {
        msgBox.appendChild(pill("Artikelnummer krävs.", "err"));
        try { rArticle.input.focus(); } catch {}
        return;
      }

      if (!store || typeof store.createItem !== "function") {
        msgBox.appendChild(pill("Kan inte spara: FreezerStore.createItem() saknas.", "err"));
        return;
      }

      setBusy(true);

      try {
        const payload = {
          // KRAV-ordning i UI (men payload kan skickas samtidigt)
          supplierId: safeStr(rSupplier.select.value).trim(),
          category: safeStr(rCategory.input.value).trim(),
          productName: safeStr(rProductName.input.value).trim(),
          packSize: safeStr(rPack.input.value).trim(),
          pricePerKg: safeStr(rPrice.input.value).trim(), // store accepterar sträng -> validerar nummer

          // P0
          articleNo,

          // Övrigt (frivilligt)
          unit: safeStr(rUnit.input.value).trim(),
          tempClass: safeStr(rTemp.input.value).trim(),
          minLevel: safeStr(rMin.input.value).trim(),
          requiresExpiry: !!rExpiry.checkbox.checked,
          ean: safeStr(rEAN.input.value).trim(),
          location: safeStr(rLoc.input.value).trim(),
          notes: safeStr(rNotes.textarea.value).trim()
        };

        const res = store.createItem(payload);

        if (!res || res.ok !== true) {
          msgBox.appendChild(pill("Kunde inte spara: " + safeStr(res && res.reason ? res.reason : "okänt fel"), "err"));
          setBusy(false);
          return;
        }

        msgBox.appendChild(pill("Produkt sparad.", "ok"));

        // Rensa (behåll ev. defaults)
        try {
          rArticle.input.value = "";
          rSupplier.select.value = "";
          rCategory.input.value = "";
          rProductName.input.value = "";
          rPack.input.value = "";
          rPrice.input.value = "";
          rMin.input.value = "";
          rEAN.input.value = "";
          rLoc.input.value = "";
          rNotes.textarea.value = "";
          rExpiry.checkbox.checked = false;
          rArticle.input.focus();
        } catch {}

        setBusy(false);
      } catch (e) {
        msgBox.appendChild(pill("Fel vid sparande: " + safeStr(e && e.message ? e.message : "okänt"), "err"));
        setBusy(false);
      }
    });

    // Bygg form
    root.appendChild(head);
    root.appendChild(note);

    // KRAV: ordning
    form.appendChild(rSupplier.wrap);
    form.appendChild(rCategory.wrap);
    form.appendChild(rProductName.wrap);
    form.appendChild(rPack.wrap);
    form.appendChild(rPrice.wrap);

    form.appendChild(hr);

    form.appendChild(rArticle.wrap);
    form.appendChild(rUnit.wrap);
    form.appendChild(rTemp.wrap);
    form.appendChild(rMin.wrap);
    form.appendChild(rEAN.wrap);
    form.appendChild(rLoc.wrap);
    form.appendChild(rExpiry.wrap);
    form.appendChild(rNotes.wrap);

    form.appendChild(actions);

    root.appendChild(form);
    root.appendChild(msgBox);
  }
});

/* =========================
BLOCK 2.3 — BUYER placeholders
========================= */

const buyerStockIn = defineModalOrInlineView({
  id: "buyer-stock-in",
  label: "Lägga in produkter",
  title: "Lägga in produkter",
  requiredPerm: null,
  renderBody: (root) => {
    root.appendChild(el("h3", null, "Lägga in produkter"));
    root.appendChild(el("div", "muted", "Placeholder: lagerinlägg / registrera inleverans byggs i kommande AO."));
  }
});

/* =========================
BLOCK 2.4 — BUYER: Sök Leverantör (INLINE)
========================= */

const buyerSupplierSearch = defineView({
  id: "buyer-supplier-search",
  label: "Sök Leverantör",
  requiredPerm: null,

  mount: ({ root, ctx }) => {
    clear(root);

    const wrap = el("div", "panel", null);

    const h = el("h3", null, "Sök Leverantör");
    h.style.margin = "0 0 10px 0";

    const store = (ctx && ctx.store) ? ctx.store : (window.FreezerStore || null);

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Sök på företagsnamn eller org-nr...";
    search.style.width = "100%";
    search.style.border = "1px solid #e6e6e6";
    search.style.borderRadius = "10px";
    search.style.padding = "10px";
    search.autocomplete = "off";

    const listBox = el("div", null, null);
    listBox.style.marginTop = "10px";

    function renderList() {
      clear(listBox);

      if (!store || typeof store.listSuppliers !== "function") {
        listBox.appendChild(pill("FreezerStore.listSuppliers() saknas. Kontrollera 03-store.js.", "err"));
        return;
      }

      const q = safeStr(search.value).trim().toLowerCase();
      let list = [];
      try { list = store.listSuppliers({ includeInactive: false }) || []; } catch { list = []; }

      const filtered = list.filter(s => {
        const name = safeStr(s && s.companyName).toLowerCase();
        const org = safeStr(s && s.orgNo).toLowerCase();
        if (!q) return true;
        return name.includes(q) || org.includes(q);
      });

      if (!filtered.length) {
        listBox.appendChild(pill("Inga matchningar.", "warn"));
        return;
      }

      const ul = document.createElement("ul");
      ul.style.margin = "0 0 0 18px";
      ul.style.padding = "0";

      for (let i = 0; i < filtered.length; i++) {
        const s = filtered[i] || {};
        const li = document.createElement("li");
        li.textContent = safeStr(s.companyName || "—") + (s.orgNo ? " • " + safeStr(s.orgNo) : "");
        ul.appendChild(li);
      }

      listBox.appendChild(ul);
    }

    search.addEventListener("input", () => renderList());

    wrap.appendChild(h);
    wrap.appendChild(search);
    wrap.appendChild(listBox);
    root.appendChild(wrap);

    renderList();
  },

  render: () => {},
  unmount: () => {}
});

/* =========================
BLOCK 3 — Listor per roll
========================= */

export const sharedViews = [sharedSaldoView, sharedHistoryView];
export const adminViews = [];   // fylls senare

// BUYER: Lagersaldo är med här som egen “ruta”
export const buyerViews = [buyerSupplierNew, buyerItemNew, buyerStockIn, buyerSupplierSearch, buyerSaldo];

export const pickerViews = [];  // fylls senare

export function getViewsForRole(role) {
  const nr = normalizeRole(role);

  if (nr === "buyer") return [...buyerViews];
  if (nr === "admin") return [...sharedViews, ...adminViews];
  if (nr === "picker") return [...sharedViews, ...pickerViews];
  return [...sharedViews];
}

export function findView(views, id) {
  const vid = String(id || "").trim();
  const list = Array.isArray(views) ? views : [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v && String(v.id || "") === vid) return v;
  }
  return null;
}

export function toMenuItems(views) {
  const list = Array.isArray(views) ? views : [];
  return list.map(v => ({
    id: String(v.id || ""),
    label: String(v.label || v.id || ""),
    requiredPerm: v.requiredPerm ?? null
  }));
}

/* =========================
BLOCK 4 — Bridge till window.FreezerViewRegistry
========================= */

try {
  if (!window.FreezerViewRegistry) {
    window.FreezerViewRegistry = {
      defineView,
      getViewsForRole,
      findView,
      toMenuItems,
      sharedViews,
      adminViews,
      buyerViews,
      pickerViews
    };
  } else {
    window.FreezerViewRegistry.defineView = defineView;
    window.FreezerViewRegistry.getViewsForRole = getViewsForRole;
    window.FreezerViewRegistry.findView = findView;
    window.FreezerViewRegistry.toMenuItems = toMenuItems;
    window.FreezerViewRegistry.sharedViews = sharedViews;
    window.FreezerViewRegistry.adminViews = adminViews;
    window.FreezerViewRegistry.buyerViews = buyerViews;
    window.FreezerViewRegistry.pickerViews = pickerViews;
  }
} catch {
  // fail-soft
}
