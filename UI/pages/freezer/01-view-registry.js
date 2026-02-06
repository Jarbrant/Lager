/* ============================================================
AO-05/15 — View Registry (ESM, self-contained) | FIL-ID: UI/pages/freezer/01-view-registry.js
Projekt: Fryslager (UI-only / localStorage-first)

PATCH v1.1 (AUTOPATCH):
- P0: Förhindrar auto-modal på load genom att landa i icke-modal vy (Sök Leverantör först i buyerViews).
- BUYER: Sök Leverantör listar suppliers + ✏️ edit per rad.
- BUYER: ✏️ öppnar formulär i modal (om FreezerModal finns) annars inline, förifyller och sparar via FreezerStore.updateSupplier().
- Tydlig DEMO-info: Store är in-memory (03-store.js seedDemo) → leverantörer sparas ej efter reload (utan nya storage-keys).

POLICY (LÅST):
- UI-only • inga nya storage-keys/datamodell
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

function getStoreFromCtx(ctx) {
  return (ctx && ctx.store) ? ctx.store : (window.FreezerStore || null);
}

function isDemoInMemoryStore(store) {
  // 03-store.js: seedDemo() nollställer history varje init -> efter reload finns inget kvar.
  // Vi kan inte “bevisa” localStorage här utan ny AO, men vi kan tydligt varna att detta är demo-läge.
  // (fail-soft)
  try {
    if (!store || typeof store.getState !== "function") return true;
    const st = store.getState();
    // Om historiken är array och startar tomt efter init -> i praktiken demo/in-memory.
    if (!st || !Array.isArray(st.history)) return true;
    return true;
  } catch {
    return true;
  }
}

/* =========================
BLOCK 1.1 — Modal helper (fail-soft)
- Stöd FreezerModal.open({ title, render, onClose })
- Fallback: rendera inline i root
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
BLOCK 1.2 — Supplier form (shared: create/edit)
========================= */

function renderSupplierForm(container, opts) {
  const mode = opts && opts.mode ? String(opts.mode) : "create"; // "create" | "edit"
  const title = opts && opts.title ? String(opts.title) : (mode === "edit" ? "Redigera leverantör" : "Ny Leverantör");
  const initial = (opts && opts.initial && typeof opts.initial === "object") ? opts.initial : {};
  const store = opts && opts.store ? opts.store : null;
  const onDone = (opts && typeof opts.onDone === "function") ? opts.onDone : null;

  const head = el("div", null, null);
  head.style.display = "flex";
  head.style.alignItems = "center";
  head.style.gap = "10px";
  head.style.marginBottom = "10px";

  const h = el("h3", null, title);
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
    try { if (onDone) onDone({ ok: false, closed: true }); } catch {}
  });

  head.appendChild(h);
  head.appendChild(closeBtn);

  const note = el("div", "muted", "Företagsnamn krävs. Övriga fält är valfria.");
  note.style.margin = "0 0 10px 0";

  const demoWarn = pill("DEMO: Leverantörer sparas i minne och finns inte kvar efter reload (ingen storage-key i 03-store.js).", "warn");
  demoWarn.style.margin = "0 0 12px 0";

  const form = document.createElement("form");
  form.autocomplete = "off";

  const rCompany = inputRow("Företagsnamn *", "Ex: Fisk & Fry AB", "text");
  const rOrg = inputRow("Org-nr (valfritt)", "Ex: 556123-4567", "text");
  const rContact = inputRow("Kontaktperson (valfritt)", "Ex: Anna Andersson", "text");
  const rPhone = inputRow("Telefon (valfritt)", "Ex: 070-123 45 67", "text");
  const rEmail = inputRow("E-post (valfritt)", "Ex: inkop@leverantor.se", "email");
  const rAddr = inputRow("Adress (valfritt)", "Gata, postnr, ort", "text");
  const rNotes = textareaRow("Notering (valfritt)", "Ex: Levererar tisdagar/torsdagar...");

  // Prefill vid edit
  try {
    rCompany.input.value = safeStr(initial.companyName || "");
    rOrg.input.value = safeStr(initial.orgNo || "");
    rContact.input.value = safeStr(initial.contactPerson || "");
    rPhone.input.value = safeStr(initial.phone || "");
    rEmail.input.value = safeStr(initial.email || "");
    rAddr.input.value = safeStr(initial.address || "");
    rNotes.textarea.value = safeStr(initial.notes || "");
  } catch {}

  const msgBox = el("div", null, null);
  msgBox.style.marginTop = "10px";

  const actions = el("div", null, null);
  actions.style.display = "flex";
  actions.style.gap = "10px";
  actions.style.marginTop = "12px";
  actions.style.alignItems = "center";

  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.textContent = (mode === "edit") ? "Spara ändringar" : "Spara leverantör";
  saveBtn.style.border = "1px solid #e6e6e6";
  saveBtn.style.background = "#111";
  saveBtn.style.color = "#fff";
  saveBtn.style.borderRadius = "10px";
  saveBtn.style.padding = "10px 12px";
  saveBtn.style.cursor = "pointer";

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = (mode === "edit") ? "Återställ" : "Rensa";
  resetBtn.style.border = "1px solid #e6e6e6";
  resetBtn.style.background = "#fff";
  resetBtn.style.borderRadius = "10px";
  resetBtn.style.padding = "10px 12px";
  resetBtn.style.cursor = "pointer";

  resetBtn.addEventListener("click", () => {
    try {
      if (mode === "edit") {
        rCompany.input.value = safeStr(initial.companyName || "");
        rOrg.input.value = safeStr(initial.orgNo || "");
        rContact.input.value = safeStr(initial.contactPerson || "");
        rPhone.input.value = safeStr(initial.phone || "");
        rEmail.input.value = safeStr(initial.email || "");
        rAddr.input.value = safeStr(initial.address || "");
        rNotes.textarea.value = safeStr(initial.notes || "");
      } else {
        rCompany.input.value = "";
        rOrg.input.value = "";
        rContact.input.value = "";
        rPhone.input.value = "";
        rEmail.input.value = "";
        rAddr.input.value = "";
        rNotes.textarea.value = "";
      }
      clear(msgBox);
      rCompany.input.focus();
    } catch {}
  });

  actions.appendChild(saveBtn);
  actions.appendChild(resetBtn);

  // Fail-soft health
  if (!store) {
    msgBox.appendChild(pill("FreezerStore saknas. Kontrollera att 03-store.js laddas före registry/controller.", "err"));
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

    if (!store) {
      msgBox.appendChild(pill("Kan inte spara: FreezerStore saknas.", "err"));
      return;
    }

    const payload = {
      companyName,
      orgNo: safeStr(rOrg.input.value).trim(),
      contactPerson: safeStr(rContact.input.value).trim(),
      phone: safeStr(rPhone.input.value).trim(),
      email: safeStr(rEmail.input.value).trim(),
      address: safeStr(rAddr.input.value).trim(),
      notes: safeStr(rNotes.textarea.value).trim()
    };

    setBusy(true);

    try {
      let res = null;

      if (mode === "edit") {
        const id = safeStr(initial.id).trim();
        if (!id) {
          msgBox.appendChild(pill("Kan inte uppdatera: supplierId saknas.", "err"));
          setBusy(false);
          return;
        }
        if (typeof store.updateSupplier !== "function") {
          msgBox.appendChild(pill("Kan inte uppdatera: FreezerStore.updateSupplier() saknas.", "err"));
          setBusy(false);
          return;
        }
        res = store.updateSupplier(id, payload);
      } else {
        if (typeof store.createSupplier !== "function") {
          msgBox.appendChild(pill("Kan inte spara: FreezerStore.createSupplier() saknas.", "err"));
          setBusy(false);
          return;
        }
        res = store.createSupplier(payload);
      }

      if (!res || res.ok !== true) {
        msgBox.appendChild(pill("Kunde inte spara: " + safeStr(res && res.reason ? res.reason : "okänt fel"), "err"));
        setBusy(false);
        return;
      }

      msgBox.appendChild(pill((mode === "edit") ? "Leverantör uppdaterad." : "Leverantör sparad.", "ok"));
      setBusy(false);

      try { if (onDone) onDone({ ok: true }); } catch {}
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

  container.appendChild(head);
  container.appendChild(note);
  container.appendChild(demoWarn);
  container.appendChild(form);
  container.appendChild(msgBox);

  try { rCompany.input.focus(); } catch {}
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
BLOCK 2.1 — BUYER: Ny Leverantör (MODAL/INLINE)
========================= */

const buyerSupplierNew = defineModalOrInlineView({
  id: "buyer-supplier-new",
  label: "Ny Leverantör",
  title: "Ny Leverantör",
  requiredPerm: null,

  renderBody: (root, args) => {
    const ctx = (args && args.ctx) ? args.ctx : {};
    const store = getStoreFromCtx(ctx);

    // Form i create-läge
    renderSupplierForm(root, {
      mode: "create",
      title: "Registrera ny leverantör",
      initial: {},
      store
    });
  }
});

/* =========================
BLOCK 2.2 — BUYER placeholders
========================= */

const buyerItemNew = defineModalOrInlineView({
  id: "buyer-item-new",
  label: "Ny produkt",
  title: "Ny produkt",
  requiredPerm: "inventory_write",
  renderBody: (root, args) => {
    root.appendChild(el("h3", null, "Ny produkt"));
    root.appendChild(el("div", "muted", "Placeholder: produktformulär byggs i kommande AO (artikelnummer, leverantör, kategori, pris)."));

    try {
      const can = !!(args && args.ctx && typeof args.ctx.can === "function" && args.ctx.can("inventory_write"));
      if (!can) {
        const w = el("div", "panel warn", null);
        w.style.marginTop = "10px";
        w.appendChild(el("b", null, "Skrivning spärrad"));
        w.appendChild(el("div", "muted", "Saknar inventory_write eller sidan är read-only."));
        root.appendChild(w);
      }
    } catch {}
  }
});

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
BLOCK 2.3 — BUYER: Sök Leverantör (INLINE)
- listSuppliers() + filter + ✏️ edit
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

    const store = getStoreFromCtx(ctx);

    const demoInfo = pill("DEMO: Leverantörer sparas i minne och finns inte kvar efter reload (ingen storage-key i 03-store.js).", "warn");
    demoInfo.style.margin = "0 0 10px 0";

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

    function openEditSupplier(supplierObj) {
      const s = (supplierObj && typeof supplierObj === "object") ? supplierObj : {};
      const store2 = store;

      const title = "Redigera leverantör";

      const res = tryOpenModalWithRender(title, (modalBody) => {
        renderSupplierForm(modalBody, {
          mode: "edit",
          title,
          initial: s,
          store: store2,
          onDone: () => {
            try { if (window.FreezerModal && typeof window.FreezerModal.close === "function") window.FreezerModal.close(); } catch {}
            try { renderList(); } catch {}
          }
        });
      }, () => {});

      if (res && res.ok) return;

      // Inline fallback om modal saknas
      clear(listBox);
      const inline = el("div", null, null);
      inline.style.marginTop = "10px";
      inline.appendChild(pill("Modal saknas – visar edit inline.", "warn"));
      renderSupplierForm(inline, {
        mode: "edit",
        title,
        initial: s,
        store: store2,
        onDone: () => { try { renderList(); } catch {} }
      });
      listBox.appendChild(inline);
    }

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

      // Enkel “tabell” via list + action
      const ul = document.createElement("ul");
      ul.style.margin = "0";
      ul.style.padding = "0";
      ul.style.listStyle = "none";
      ul.style.display = "grid";
      ul.style.gap = "8px";

      for (let i = 0; i < filtered.length; i++) {
        const s = filtered[i] || {};

        const row = document.createElement("li");
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "10px";
        row.style.border = "1px solid #e6e6e6";
        row.style.borderRadius = "10px";
        row.style.padding = "10px";
        row.style.background = "#fff";

        const left = el("div", null, null);
        left.style.flex = "1";
        left.style.minWidth = "0";

        const name = el("div", null, safeStr(s.companyName || "—"));
        name.style.fontWeight = "700";

        const meta = el("div", "muted", (s.orgNo ? ("Org: " + safeStr(s.orgNo)) : "Org: —"));
        meta.style.fontSize = "13px";
        meta.style.marginTop = "2px";

        left.appendChild(name);
        left.appendChild(meta);

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.textContent = "✏️";
        editBtn.title = "Redigera";
        editBtn.style.border = "1px solid #e6e6e6";
        editBtn.style.background = "#fff";
        editBtn.style.borderRadius = "10px";
        editBtn.style.padding = "8px 10px";
        editBtn.style.cursor = "pointer";

        editBtn.addEventListener("click", () => openEditSupplier(s));

        row.appendChild(left);
        row.appendChild(editBtn);
        ul.appendChild(row);
      }

      listBox.appendChild(ul);
    }

    search.addEventListener("input", () => renderList());

    wrap.appendChild(h);
    wrap.appendChild(demoInfo);
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

// P0: buyerSupplierSearch först -> ingen auto-modal på load om controller auto-väljer första view.
export const buyerViews = [buyerSupplierSearch, buyerSupplierNew, buyerItemNew, buyerStockIn];

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
