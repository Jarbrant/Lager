/* ============================================================
AO-01/15 — NY-BASELINE | FIL: UI/freezer-render.js
+ AO-02/15 — Statuspanel + Read-only UX + felkoder
+ AO-03/15 — Users CRUD UI render (Admin)
+ AO-04/15 — Produktregister (Items) CRUD (Admin) — BLOCK 1/6

Syfte:
- XSS-safe rendering (textContent, aldrig osäker innerHTML)
- Render av status banner/pill + lockpanel + debug + mode
- Tab UI växling (dashboard/saldo/history)
- Users-panel: visa/dölj via RBAC (users_manage), rendera lista + count
- Items (AO-04): renderar produktregister i Saldo-vyn utan HTML-ändring:
  - Search + sort + kategori-filter + includeInactive
  - Lista + actions (edit / arkivera / radera guarded)
  - Editor (create/update) inline

Kontrakt:
- Förväntar window.FreezerStore.getStatus() och state-shape från store
- Får inte skapa nya storage-keys eller skriva till storage
============================================================ */
(function () {
  "use strict";

  const FreezerRender = {
    renderAll,
    setActiveTabUI,

    // granular helpers called from freezer.js
    renderStatus,
    renderMode,
    renderLockPanel,
    renderDebug
  };

  window.FreezerRender = FreezerRender;

  // -----------------------------
  // MAIN RENDER
  // -----------------------------
  function renderAll(state, ui = {}) {
    renderStatus(state);
    renderMode(state);
    renderLockPanel(state);
    renderDebug(state);

    renderUsersPanel(state);

    // AO-04: Saldo-vyn används som Produktregister (Items CRUD)
    renderItemsRegister(state, ui);

    renderHistory(state);
    renderDashboard(state);
  }

  // -----------------------------
  // STATUS (AO-02)
  // -----------------------------
  function renderStatus(state) {
    const pill = byId("frzStatusPill");
    const pillText = byId("frzStatusText");
    const lockPanel = byId("frzLockPanel");
    const lockReason = byId("frzLockReason");

    const st = safeStatus();

    if (pillText) pillText.textContent = st.status;

    if (pill) {
      pill.classList.remove("ok", "danger");
      if (st.status === "OK") pill.classList.add("ok");
      if (st.status !== "OK") pill.classList.add("danger");
      pill.title = st.status === "OK"
        ? "OK – lagring och state ser bra ut"
        : `Problem – ${st.errorCode || "okänd kod"}`;
    }

    if (lockPanel && lockReason) {
      if (st.locked) {
        lockPanel.hidden = false;
        lockReason.textContent = st.reason ? `Orsak: ${st.reason}` : `Orsak: ${st.errorCode || "okänt fel"}`;
      } else {
        lockPanel.hidden = true;
        lockReason.textContent = "Orsak: —";
      }
    }
  }

  // -----------------------------
  // MODE (read-only) (AO-02)
  // -----------------------------
  function renderMode(state) {
    const modeText = byId("frzModeText");
    const resetBtn = byId("frzResetDemoBtn");

    const st = safeStatus();

    const label = st.locked
      ? "LÅST"
      : (st.readOnly ? "READ-ONLY" : "FULL");

    if (modeText) modeText.textContent = label;

    if (resetBtn) resetBtn.disabled = !!(st.locked || st.readOnly);

    const canUsers = can("users_manage");
    const saveBtn = byId("frzUserSaveBtn");
    const cancelBtn = byId("frzUserCancelBtn");
    if (saveBtn) saveBtn.disabled = !!(st.locked || st.readOnly || !canUsers);
    if (cancelBtn) cancelBtn.disabled = !!(st.locked || st.readOnly || !canUsers);

    const fn = byId("frzUserFirstName");
    if (fn) fn.disabled = !!(st.locked || st.readOnly || !canUsers);
    ["perm_users_manage","perm_inventory_write","perm_history_write","perm_dashboard_view"].forEach(id => {
      const el = byId(id);
      if (el) el.disabled = !!(st.locked || st.readOnly || !canUsers);
    });
  }

  function renderLockPanel(state) {
    renderStatus(state);
  }

  function renderDebug(state) {
    const panel = byId("frzDebugPanel");
    const text = byId("frzDebugText");
    if (!panel || !text) return;

    const st = safeStatus();
    const shouldShow = (st.status !== "OK") || (st.debug && (st.debug.demoCreated || st.debug.rawWasEmpty));

    panel.hidden = !shouldShow;

    const parts = [];
    if (st.debug && st.debug.storageKey) parts.push(`key=${st.debug.storageKey}`);
    if (st.debug && typeof st.debug.schemaVersion !== "undefined") parts.push(`v=${st.debug.schemaVersion}`);
    if (st.errorCode) parts.push(`err=${st.errorCode}`);
    if (st.debug && st.debug.rawWasEmpty) parts.push("rawEmpty=1");
    if (st.debug && st.debug.demoCreated) parts.push("demo=1");

    text.textContent = parts.length ? parts.join(" • ") : "—";
  }

  // -----------------------------
  // TABS UI
  // -----------------------------
  function setActiveTabUI(activeTab) {
    const tabDashboard = byId("tabDashboard");
    const tabSaldo = byId("tabSaldo");
    const tabHistorik = byId("tabHistorik");

    const viewDashboard = byId("viewDashboard");
    const viewSaldo = byId("viewSaldo");
    const viewHistorik = byId("viewHistorik");

    const key = activeTab || "dashboard";

    setTab(tabDashboard, key === "dashboard");
    setTab(tabSaldo, key === "saldo");
    setTab(tabHistorik, key === "history");

    if (viewDashboard) viewDashboard.hidden = !(key === "dashboard");
    if (viewSaldo) viewSaldo.hidden = !(key === "saldo");
    if (viewHistorik) viewHistorik.hidden = !(key === "history");
  }

  function setTab(btn, selected) {
    if (!btn) return;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
  }

  // -----------------------------
  // USERS (AO-03)
  // -----------------------------
  function renderUsersPanel(state) {
    const panel = byId("frzUsersPanel");
    const list = byId("frzUsersList");
    const count = byId("frzUsersCount");
    if (!panel) return;

    const st = safeStatus();
    const canUsers = can("users_manage");

    panel.hidden = !!(st.locked || st.readOnly || !canUsers);
    if (panel.hidden) return;

    const users = safeUsers(state);

    if (count) count.textContent = String(users.length);
    if (!list) return;

    list.textContent = "";

    users.forEach(u => {
      const row = document.createElement("div");
      row.className = "userRow";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = safeText(u.firstName || "—");

      const meta = document.createElement("div");
      meta.className = "meta muted";
      meta.textContent = `${u.active ? "Aktiv" : "Inaktiv"} • ${permSummary(u.perms)}`;

      const spacer = document.createElement("div");
      spacer.className = "spacer";

      const badge = document.createElement("span");
      badge.className = "badge" + (u.active ? "" : " off");
      badge.textContent = u.active ? "ACTIVE" : "INACTIVE";

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn";
      btnEdit.type = "button";
      btnEdit.setAttribute("data-action", "user-edit");
      btnEdit.setAttribute("data-user-id", safeText(u.id || ""));
      btnEdit.textContent = "Redigera";

      const btnToggle = document.createElement("button");
      btnToggle.className = "btn";
      btnToggle.type = "button";
      btnToggle.setAttribute("data-action", "user-toggle-active");
      btnToggle.setAttribute("data-user-id", safeText(u.id || ""));
      btnToggle.textContent = u.active ? "Inaktivera" : "Aktivera";

      row.appendChild(name);
      row.appendChild(meta);
      row.appendChild(spacer);
      row.appendChild(badge);
      row.appendChild(btnEdit);
      row.appendChild(btnToggle);

      list.appendChild(row);
    });
  }

  function permSummary(perms) {
    const p = (perms && typeof perms === "object") ? perms : {};
    const on = [];
    if (p.users_manage) on.push("users");
    if (p.inventory_write) on.push("inv");
    if (p.history_write) on.push("hist");
    if (p.dashboard_view) on.push("dash");
    if (!on.length) return "inga perms";
    return on.join(", ");
  }

  // -----------------------------
  // AO-04: ITEMS REGISTER (render in Saldo view)
  // -----------------------------
  function renderItemsRegister(state, ui) {
    const wrap = byId("frzSaldoTableWrap");
    const count = byId("frzSaldoCount");
    if (!wrap || !count) return;

    const st = safeStatus();
    const canInv = can("inventory_write");
    const locked = !!(st.locked || st.readOnly || !canInv);

    const query = {
      q: safeText(ui && ui.itemsQ),
      category: safeText(ui && ui.itemsCategory),
      sortKey: safeText(ui && ui.itemsSortKey) || "articleNo",
      sortDir: safeText(ui && ui.itemsSortDir) || "asc",
      includeInactive: !!(ui && ui.itemsIncludeInactive)
    };

    const items = safeItemsForRegister(state, query);
    count.textContent = String(items.length);

    wrap.textContent = "";

    // Top controls
    const top = document.createElement("div");
    top.className = "row";
    top.style.marginBottom = "10px";

    const qLabel = pillInput("Sök", "frzItemsQ", query.q || "", "t.ex. FZ-001 / leverantör / kategori");
    const catLabel = pillSelect("Kategori", "frzItemsCategory", buildCategoryOptions(state), query.category || "");
    const sortLabel = pillSelect("Sort", "frzItemsSortKey", [
      { v: "articleNo", t: "articleNo" },
      { v: "category", t: "kategori" },
      { v: "supplier", t: "leverantör" },
      { v: "pricePerKg", t: "pris/kg" },
      { v: "minLevel", t: "min-nivå" },
      { v: "updatedAt", t: "uppdaterad" }
    ], query.sortKey);

    const dirLabel = pillSelect("Ordning", "frzItemsSortDir", [
      { v: "asc", t: "A→Ö / låg→hög" },
      { v: "desc", t: "Ö→A / hög→låg" }
    ], query.sortDir);

    const incLabel = document.createElement("label");
    incLabel.className = "pill";
    incLabel.title = "Visa även arkiverade (isActive=false)";
    const incMuted = document.createElement("span");
    incMuted.className = "muted";
    incMuted.textContent = "Visa arkiverade:";
    const incCb = document.createElement("input");
    incCb.type = "checkbox";
    incCb.id = "frzItemsIncludeInactive";
    incCb.checked = !!query.includeInactive;
    incCb.disabled = !!st.locked;
    incLabel.appendChild(incMuted);
    incLabel.appendChild(incCb);

    const spacer = document.createElement("div");
    spacer.className = "spacer";

    const btnNew = document.createElement("button");
    btnNew.className = "btn";
    btnNew.type = "button";
    btnNew.textContent = "Ny produkt";
    btnNew.setAttribute("data-action", "item-new");
    btnNew.disabled = locked;

    top.appendChild(qLabel);
    top.appendChild(catLabel);
    top.appendChild(sortLabel);
    top.appendChild(dirLabel);
    top.appendChild(incLabel);
    top.appendChild(spacer);
    top.appendChild(btnNew);

    wrap.appendChild(top);

    // Editor
    const editor = document.createElement("div");
    editor.className = "panel";
    editor.style.background = "#fafafa";
    editor.style.marginBottom = "10px";
    editor.setAttribute("data-section", "items-editor");

    const isEdit = !!(ui && ui.itemsEditingArticleNo);
    const title = document.createElement("b");
    title.textContent = isEdit ? `Redigera produkt: ${safeText(ui.itemsEditingArticleNo)}` : "Skapa produkt";

    const hint = document.createElement("div");
    hint.className = "muted";
    hint.style.marginTop = "6px";
    hint.textContent = isEdit
      ? "articleNo kan inte ändras (immutable)."
      : "articleNo måste vara unikt.";

    const hr = document.createElement("div");
    hr.className = "hr";

    const grid = document.createElement("div");
    grid.className = "row";
    grid.style.flexWrap = "wrap";

    // inputs (ids used by freezer.js controller)
    grid.appendChild(pillInput("articleNo", "frzItemArticleNo", safeText(ui && ui.formArticleNo), "t.ex. FZ-010", 32, isEdit || locked));
    grid.appendChild(pillInput("packSize", "frzItemPackSize", safeText(ui && ui.formPackSize), "t.ex. 2kg", 32, locked));
    grid.appendChild(pillInput("supplier", "frzItemSupplier", safeText(ui && ui.formSupplier), "t.ex. FoodSupplier AB", 48, locked));
    grid.appendChild(pillInput("category", "frzItemCategory", safeText(ui && ui.formCategory), "t.ex. Kyckling", 48, locked));
    grid.appendChild(pillInput("pricePerKg", "frzItemPricePerKg", safeText(ui && ui.formPricePerKg), "t.ex. 89", 16, locked, "number"));
    grid.appendChild(pillInput("minLevel", "frzItemMinLevel", safeText(ui && ui.formMinLevel), "t.ex. 10", 16, locked, "number"));
    grid.appendChild(pillInput("tempClass", "frzItemTempClass", safeText(ui && ui.formTempClass), "t.ex. FROZEN", 16, locked));
    grid.appendChild(pillSelect("requiresExpiry", "frzItemRequiresExpiry", [
      { v: "true", t: "Ja" },
      { v: "false", t: "Nej" }
    ], (String(!!(ui && ui.formRequiresExpiry)) === "true") ? "true" : "false", locked));
    grid.appendChild(pillSelect("isActive", "frzItemIsActive", [
      { v: "true", t: "Aktiv" },
      { v: "false", t: "Arkiverad" }
    ], (String(!!(ui && ui.formIsActive)) === "true") ? "true" : "false", locked));

    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.marginTop = "10px";

    const msg = document.createElement("div");
    msg.className = "muted";
    msg.id = "frzItemsMsg";
    msg.textContent = safeText(ui && ui.itemsMsg) || "—";

    const btnSave = document.createElement("button");
    btnSave.className = "btn";
    btnSave.type = "button";
    btnSave.textContent = "Spara";
    btnSave.setAttribute("data-action", "item-save");
    btnSave.disabled = locked;

    const btnCancel = document.createElement("button");
    btnCancel.className = "btn";
    btnCancel.type = "button";
    btnCancel.textContent = "Avbryt";
    btnCancel.setAttribute("data-action", "item-cancel");
    btnCancel.disabled = !!st.locked;

    actions.appendChild(msg);
    const sp2 = document.createElement("div");
    sp2.className = "spacer";
    actions.appendChild(sp2);
    actions.appendChild(btnSave);
    actions.appendChild(btnCancel);

    editor.appendChild(title);
    editor.appendChild(hint);
    editor.appendChild(hr);
    editor.appendChild(grid);
    editor.appendChild(actions);

    wrap.appendChild(editor);

    // List
    const listWrap = document.createElement("div");
    listWrap.className = "panel";
    listWrap.style.background = "#fff";

    if (!items.length) {
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = "Inga produkter matchar filtret.";
      listWrap.appendChild(d);
      wrap.appendChild(listWrap);
      return;
    }

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.fontSize = "13px";

    const thead = document.createElement("thead");
    const hr2 = document.createElement("tr");
    ["articleNo", "Leverantör", "Kategori", "pack", "pris/kg", "min", "saldo", "status", ""].forEach(h => {
      const th = document.createElement("th");
      th.textContent = h;
      th.style.textAlign = "left";
      th.style.padding = "8px";
      th.style.borderBottom = "1px solid #e6e6e6";
      hr2.appendChild(th);
    });
    thead.appendChild(hr2);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    items.forEach(it => {
      const tr = document.createElement("tr");

      addTd(tr, it.articleNo);
      addTd(tr, it.supplier);
      addTd(tr, it.category);
      addTd(tr, it.packSize);
      addTd(tr, it.pricePerKg);
      addTd(tr, it.minLevel);
      addTd(tr, String(it.onHand ?? 0));

      const statusCell = document.createElement("td");
      statusCell.style.padding = "8px";
      statusCell.style.borderBottom = "1px solid #f0f0f0";
      const badge = document.createElement("span");
      badge.className = "badge" + (it.isActive ? "" : " off");
      badge.textContent = it.isActive ? "ACTIVE" : "ARCHIVED";
      statusCell.appendChild(badge);
      tr.appendChild(statusCell);

      const actionsCell = document.createElement("td");
      actionsCell.style.padding = "8px";
      actionsCell.style.borderBottom = "1px solid #f0f0f0";

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn";
      btnEdit.type = "button";
      btnEdit.textContent = "Redigera";
      btnEdit.setAttribute("data-action", "item-edit");
      btnEdit.setAttribute("data-article-no", it.articleNo);
      btnEdit.disabled = !!st.locked;

      const btnArchive = document.createElement("button");
      btnArchive.className = "btn";
      btnArchive.type = "button";
      btnArchive.textContent = "Arkivera";
      btnArchive.setAttribute("data-action", "item-archive");
      btnArchive.setAttribute("data-article-no", it.articleNo);
      btnArchive.disabled = locked || !it.isActive;

      const btnDelete = document.createElement("button");
      btnDelete.className = "btn";
      btnDelete.type = "button";
      btnDelete.textContent = "Radera";
      btnDelete.setAttribute("data-action", "item-delete");
      btnDelete.setAttribute("data-article-no", it.articleNo);
      btnDelete.disabled = locked;

      actionsCell.appendChild(btnEdit);
      actionsCell.appendChild(document.createTextNode(" "));
      actionsCell.appendChild(btnArchive);
      actionsCell.appendChild(document.createTextNode(" "));
      actionsCell.appendChild(btnDelete);

      tr.appendChild(actionsCell);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    listWrap.appendChild(table);
    wrap.appendChild(listWrap);
  }

  function safeItemsForRegister(state, query) {
    try {
      if (!window.FreezerStore || typeof window.FreezerStore.queryItems !== "function") return [];
      const out = window.FreezerStore.queryItems(query || {});
      return Array.isArray(out) ? out.map(it => ({
        articleNo: safeText(it && it.articleNo),
        supplier: safeText(it && it.supplier),
        category: safeText(it && it.category),
        packSize: safeText(it && it.packSize),
        pricePerKg: safeText(it && it.pricePerKg),
        minLevel: safeText(it && it.minLevel),
        tempClass: safeText(it && it.tempClass),
        requiresExpiry: !!(it && it.requiresExpiry),
        isActive: !!(it && it.isActive),
        onHand: (it && typeof it.onHand !== "undefined") ? it.onHand : 0
      })) : [];
    } catch {
      return [];
    }
  }

  function buildCategoryOptions(state) {
    const set = new Set();
    try {
      const s = state && typeof state === "object" ? state : null;
      const arr = s && s.data && Array.isArray(s.data.items) ? s.data.items : [];
      arr.forEach(it => {
        const c = safeText(it && it.category);
        if (c) set.add(c);
      });
    } catch {}

    const out = [{ v: "", t: "Alla" }];
    Array.from(set).sort((a, b) => a.localeCompare(b, "sv-SE")).forEach(c => out.push({ v: c, t: c }));
    return out;
  }

  function pillInput(label, id, value, placeholder, maxLen, disabled, type = "text") {
    const wrap = document.createElement("label");
    wrap.className = "pill";
    wrap.setAttribute("for", id);

    const muted = document.createElement("span");
    muted.className = "muted";
    muted.textContent = `${label}:`;

    const inp = document.createElement("input");
    inp.id = id;
    inp.type = type;
    inp.value = safeText(value || "");
    inp.placeholder = safeText(placeholder || "");
    if (maxLen) inp.maxLength = maxLen;
    if (disabled) inp.disabled = true;

    wrap.appendChild(muted);
    wrap.appendChild(inp);
    return wrap;
  }

  function pillSelect(label, id, options, selected, disabled) {
    const wrap = document.createElement("label");
    wrap.className = "pill";
    wrap.setAttribute("for", id);

    const muted = document.createElement("span");
    muted.className = "muted";
    muted.textContent = `${label}:`;

    const sel = document.createElement("select");
    sel.id = id;
    if (disabled) sel.disabled = true;

    (options || []).forEach(o => {
      const opt = document.createElement("option");
      opt.value = safeText(o.v);
      opt.textContent = safeText(o.t);
      sel.appendChild(opt);
    });

    const sv = safeText(selected);
    if (sv !== null && typeof sv !== "undefined") sel.value = sv;

    wrap.appendChild(muted);
    wrap.appendChild(sel);
    return wrap;
  }

  function addTd(tr, text) {
    const td = document.createElement("td");
    td.textContent = safeText(text);
    td.style.padding = "8px";
    td.style.borderBottom = "1px solid #f0f0f0";
    tr.appendChild(td);
  }

  // -----------------------------
  // HISTORY / DASH
  // -----------------------------
  function renderHistory(state) {
    const list = byId("frzHistoryList");
    const count = byId("frzHistoryCount");
    if (!list || !count) return;

    const history = safeHistory(state);
    count.textContent = String(history.length);

    list.textContent = "";
    if (!history.length) {
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = "Ingen historik ännu.";
      list.appendChild(d);
      return;
    }

    const ul = document.createElement("div");
    ul.className = "list";

    history.slice().reverse().slice(0, 50).forEach(h => {
      const row = document.createElement("div");
      row.className = "userRow";

      const left = document.createElement("div");
      left.className = "meta";
      left.textContent = `${safeText(h.ts || "")} • ${safeText(h.type || "")}`;

      const note = document.createElement("div");
      note.className = "muted";
      note.textContent = safeText(h.note || "");

      const by = document.createElement("span");
      by.className = "badge";
      by.textContent = safeText(h.by || "—");

      row.appendChild(left);
      row.appendChild(note);
      row.appendChild(by);

      ul.appendChild(row);
    });

    list.appendChild(ul);
  }

  function renderDashboard(state) {
    const cards = byId("frzDashCards");
    const notes = byId("frzDashNotes");
    if (!cards || !notes) return;

    const st = safeStatus();

    let itemCount = 0;
    try {
      const s = state && typeof state === "object" ? state : null;
      const items = s && s.data && Array.isArray(s.data.items) ? s.data.items : [];
      itemCount = items.length;
    } catch {}

    cards.textContent = "";
    addCard(cards, "Produkter", String(itemCount));
    addCard(cards, "Status", st.status);
    addCard(cards, "Läge", st.locked ? "LÅST" : (st.readOnly ? "READ-ONLY" : "FULL"));

    const msg = [];
    if (st.debug && st.debug.rawWasEmpty) msg.push("Tom lagring vid start.");
    if (st.debug && st.debug.demoCreated) msg.push("Demo-data skapad.");
    if (st.locked) msg.push(`Låst: ${st.errorCode || "okänt fel"}`);
    notes.textContent = msg.length ? msg.join(" ") : "—";
  }

  function addCard(root, title, value) {
    const card = document.createElement("div");
    card.className = "panel";
    card.style.background = "#fafafa";

    const t = document.createElement("div");
    t.className = "muted";
    t.textContent = safeText(title);

    const v = document.createElement("div");
    v.style.fontSize = "20px";
    v.style.fontWeight = "800";
    v.style.marginTop = "6px";
    v.textContent = safeText(value);

    card.appendChild(t);
    card.appendChild(v);
    root.appendChild(card);
  }

  // -----------------------------
  // SAFE ACCESSORS
  // -----------------------------
  function safeStatus() {
    try {
      if (window.FreezerStore && typeof window.FreezerStore.getStatus === "function") {
        return window.FreezerStore.getStatus();
      }
    } catch {}
    return { status: "KORRUPT", locked: true, readOnly: true, errorCode: "FRZ_E_NOT_INIT", debug: {} };
  }

  function can(permKey) {
    try {
      return !!(window.FreezerStore && typeof window.FreezerStore.can === "function" && window.FreezerStore.can(permKey));
    } catch {
      return false;
    }
  }

  function safeHistory(state) {
    const s = state && typeof state === "object" ? state : null;
    const arr = s && s.data && Array.isArray(s.data.history) ? s.data.history : [];
    return arr.map(h => ({
      ts: safeText(h && h.ts),
      type: safeText(h && h.type),
      note: safeText(h && h.note),
      by: safeText(h && h.by)
    }));
  }

  function safeUsers(state) {
    const s = state && typeof state === "object" ? state : null;
    const arr = s && s.data && Array.isArray(s.data.users) ? s.data.users : [];
    return arr.map(u => ({
      id: safeText(u && u.id),
      firstName: safeText(u && u.firstName),
      active: !!(u && u.active),
      perms: (u && typeof u.perms === "object" && u.perms) ? u.perms : {}
    }));
  }

  function safeText(v) {
    if (v === null || typeof v === "undefined") return "";
    return String(v);
  }

  function byId(id) {
    return document.getElementById(id);
  }

})();
