/* ============================================================
AO-05/15 — View Registry (ESM, self-contained) | FIL-ID: UI/pages/freezer/01-view-registry.js
Projekt: Fryslager (UI-only / localStorage-first)

Syfte:
- Central export av vy-listor per roll (shared/admin/buyer/picker).
- P0 FIX: inga externa view-imports som kan ge 404 och krascha ESM-modulen.
- P0 BUYER: visa 4 inköpsrutor:
  - Ny Leverantör (modal med formulär -> FreezerStore.createSupplier)
  - Ny produkt (placeholder)
  - Lägga in produkter (placeholder)
  - Sök Leverantör (inline: lista + sök i FreezerStore.listSuppliers)

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

/* =========================
BLOCK 1.1 — Modal helper (fail-soft)
- Stöd FreezerModal.open({ title, render, onClose })
- Fallback: rendera inline i root
========================= */

function tryOpenModalWithRender(title, renderFn, onClose) {
  try {
    const m = window.FreezerModal;
    if (!m) return { ok: false, ctrl: null, mode: "inline" };

    // Prefer open(), annars show()
    const openFn =
      (typeof m.open === "function" && m.open) ||
      (typeof m.show === "function" && m.show) ||
      null;

    if (!openFn) return { ok: false, ctrl: null, mode: "inline" };

    // Vår modal-shell (AO-16) accepterar { title, render, onClose }
    openFn({
      title: safeStr(title || "—"),
      render: typeof renderFn === "function" ? renderFn : undefined,
      onClose: typeof onClose === "function" ? onClose : undefined
    });

    // Normalisera controller
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
      // Render-target: antingen modal body eller inline box
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

      // Försök modal
      const res = tryOpenModalWithRender(title, (modalBody) => {
        // modalBody är vår body-root från modal-shell
        renderInto(modalBody);
        // spara body för rerender
        try { root.__frzModalBody = modalBody; } catch {}
      }, () => {});

      if (res && res.ok) {
        try { root.__frzModalCtrl = res.ctrl; } catch {}
        // OBS: vi renderar i modal via render-callback ovan.
        // Root lämnas tomt.
        clear(root);
        return;
      }

      // Inline fallback
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
      // Render i modal body om den finns, annars inline
      try {
        const body = root.__frzModalBody;
        if (body && body instanceof HTMLElement) {
          clear(body);
          spec.renderBody(body, { root, state: state || {}, ctx });
          return;
        }
      } catch {}

      // Sista fallback: inline i root
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
BLOCK 2.1 — BUYER: Ny Leverantör (MODAL FORM)
- Använder FreezerStore.createSupplier(data)
- XSS-safe, fail-soft om store saknas
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

    // Behörighet/hälsa (fail-soft)
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

        // Rensa form (fail-soft)
        try {
          rCompany.input.value = "";
          rOrg.input.value = "";
          rContact.input.value = "";
          rPhone.input.value = "";
          rEmail.input.value = "";
          rAddr.input.value = "";
          rNotes.textarea.value = "";
        } catch {}

        // Visa liten lista direkt (fail-soft)
        try {
          if (typeof store.listSuppliers === "function") {
            const list = store.listSuppliers({ includeInactive: false }) || [];
            const box = el("div", null, null);
            box.style.marginTop = "10px";
            box.appendChild(el("b", null, "Aktiva leverantörer (" + list.length + "):"));

            const ul = document.createElement("ul");
            ul.style.margin = "8px 0 0 18px";
            ul.style.padding = "0";

            for (let i = 0; i < Math.min(list.length, 8); i++) {
              const s = list[i] || {};
              const li = document.createElement("li");
              li.textContent = safeStr(s.companyName || "—") + (s.orgNo ? " • " + safeStr(s.orgNo) : "");
              ul.appendChild(li);
            }
            box.appendChild(ul);
            msgBox.appendChild(box);
          }
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

    // fail-soft hint om behörighet
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
- listSuppliers() + filter (fail-soft)
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
export const buyerViews = [buyerSupplierNew, buyerItemNew, buyerStockIn, buyerSupplierSearch];
export const pickerViews = [];  // fylls senare

export function getViewsForRole(role) {
  const nr = normalizeRole(role);

  // BUYER: visa endast buyerViews
  if (nr === "buyer") return [...buyerViews];

  // ADMIN/PICKER: shared + roll-specifika
  if (nr === "admin") return [...sharedViews, ...adminViews];
  if (nr === "picker") return [...sharedViews, ...pickerViews];

  // Default: shared
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
    // fail-soft uppdatering
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
