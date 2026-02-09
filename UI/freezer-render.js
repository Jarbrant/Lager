/* ============================================================
AO-REF-RENDER-01 | FIL: UI/freezer-render.js
Projekt: Freezer (UI-only / localStorage-first)

Mål:
- RENDER = endast render (DOM)
- CONTROLLER = all logik/state/store (admin/freezer.js)
- Render-filen får INTE läsa FreezerStore/FreezerDashboard och får INTE ha egen UI-state.

Kontrakt:
- window.FreezerRender.renderApp(vm)
  - vm innehåller ALL data + ALL callbacks som behövs.
- window.FreezerRender.setActiveTabUI(activeTab)

Policy:
- XSS-safe: textContent (ingen osäker innerHTML)
- Fail-soft i render: tomt läge hellre än crash
- Inga nya storage-keys/datamodell
============================================================ */
(function () {
  "use strict";

  const FreezerRender = {
    renderApp,
    setActiveTabUI
  };

  window.FreezerRender = FreezerRender;

  // ------------------------------------------------------------
  // PUBLIC
  // ------------------------------------------------------------
  function renderApp(vm) {
    try {
      const v = (vm && typeof vm === "object") ? vm : {};

      // Tabs + views
      setActiveTabUI(v.activeTab || "dashboard");

      // Status / mode / lock / debug
      renderStatus(v.status);
      renderMode(v.mode);
      renderLockPanel(v.lock);
      renderDebug(v.debug);

      // Dashboard cards (standard cards)
      renderDashboard(v.dashboard);

      // AO-02A: Top IN/OUT panel (dashboard)
      renderTopInOut(v.topInOut);

      // Users panel
      renderUsersPanel(v.users);

      // Items register (saldo view)
      renderItemsRegister(v.items);

      // History (historik view)
      renderHistory(v.history);
    } catch {
      // fail-soft
    }
  }

  function setActiveTabUI(activeTab) {
    const tabDashboard = byId("tabDashboard");
    const tabSaldo = byId("tabSaldo");
    const tabHistorik = byId("tabHistorik");

    const viewDashboard = byId("viewDashboard");
    const viewSaldo = byId("viewSaldo");
    const viewHistorik = byId("viewHistorik");

    const key = String(activeTab || "dashboard");

    setTab(tabDashboard, key === "dashboard");
    setTab(tabSaldo, key === "saldo");
    setTab(tabHistorik, key === "history");

    if (viewDashboard) viewDashboard.hidden = !(key === "dashboard");
    if (viewSaldo) viewSaldo.hidden = !(key === "saldo");
    if (viewHistorik) viewHistorik.hidden = !(key === "history");
  }

  // ------------------------------------------------------------
  // STATUS / MODE / LOCK / DEBUG
  // ------------------------------------------------------------
  function renderStatus(st) {
    const pill = byId("frzStatusPill");
    const pillText = byId("frzStatusText");

    const v = (st && typeof st === "object") ? st : {};
    const label = safeText(v.label || "—");
    const cls = safeText(v.className || "ok"); // "ok" | "danger"
    const title = safeText(v.title || "");

    if (pillText) pillText.textContent = label;

    if (pill) {
      pill.classList.remove("ok", "danger");
      pill.classList.add(cls === "danger" ? "danger" : "ok");
      pill.title = title || "";
    }
  }

  function renderMode(mode) {
    const modeText = byId("frzModeText");
    const resetBtn = byId("frzResetDemoBtn");

    const v = (mode && typeof mode === "object") ? mode : {};
    const label = safeText(v.label || "—");

    if (modeText) modeText.textContent = label;
    if (resetBtn) resetBtn.disabled = !!v.disableReset;

    // (valfritt) disable user modal controls om controller skickar det
    const saveBtn = byId("frzUserSaveBtn");
    const cancelBtn = byId("frzUserCancelBtn");
    if (saveBtn) saveBtn.disabled = !!v.disableUserActions;
    if (cancelBtn) cancelBtn.disabled = !!v.disableUserActions;

    const fn = byId("frzUserFirstName");
    if (fn) fn.disabled = !!v.disableUserActions;

    ["perm_users_manage", "perm_inventory_write", "perm_history_write", "perm_dashboard_view"].forEach((id) => {
      const el = byId(id);
      if (el) el.disabled = !!v.disableUserActions;
    });
  }

  function renderLockPanel(lock) {
    const lockPanel = byId("frzLockPanel");
    const lockReason = byId("frzLockReason");

    const v = (lock && typeof lock === "object") ? lock : {};
    const locked = !!v.locked;

    if (!lockPanel || !lockReason) return;

    if (locked) {
      lockPanel.hidden = false;
      lockReason.textContent = safeText(v.reason || "Orsak: —");
    } else {
      lockPanel.hidden = true;
      lockReason.textContent = "Orsak: —";
    }
  }

  function renderDebug(debug) {
    const panel = byId("frzDebugPanel");
    const text = byId("frzDebugText");
    if (!panel || !text) return;

    const v = (debug && typeof debug === "object") ? debug : {};
    const show = !!v.show;

    panel.hidden = !show;
    text.textContent = safeText(v.text || "—");
  }

  // ------------------------------------------------------------
  // DASHBOARD (standard cards)
  // ------------------------------------------------------------
  function renderDashboard(dash) {
    const cards = byId("frzDashCards");
    const notes = byId("frzDashNotes");
    if (!cards || !notes) return;

    const v = (dash && typeof dash === "object") ? dash : {};
    const list = Array.isArray(v.cards) ? v.cards : [];

    // OBS: Dashboard kan innehålla andra paneler (t.ex TopInOut) som controller vill behålla.
    // För att inte radera dem, renderar vi bara om controller uttryckligen säger "replace".
    const replace = ("replace" in v) ? !!v.replace : true;

    if (replace) cards.textContent = "";

    // Render cards efter ev. befintliga paneler
    // (Controller kan sätta replace=false om den vill styra ordningen.)
    if (list.length) {
      list.forEach((c) => {
        cards.appendChild(renderCard(c));
      });
    }

    notes.textContent = safeText(v.notes || "—");
  }

  function renderCard(c) {
    const card = document.createElement("div");
    card.className = "panel";
    card.style.background = "#fafafa";

    const t = document.createElement("div");
    t.className = "muted";
    t.textContent = safeText(c && c.title);

    const v = document.createElement("div");
    v.style.fontSize = "20px";
    v.style.fontWeight = "800";
    v.style.marginTop = "6px";
    v.textContent = safeText(c && c.value);

    card.appendChild(t);
    card.appendChild(v);
    return card;
  }

  // ------------------------------------------------------------
  // AO-02A: TOP IN/OUT PANEL (render-only)
  // ------------------------------------------------------------
  function renderTopInOut(top) {
    const dashCards = byId("frzDashCards");
    if (!dashCards) return;

    const v = (top && typeof top === "object") ? top : {};
    if (!v.visible) {
      // om panelen finns sedan tidigare, göm den
      const existing = byId("frzTopInOutPanel");
      if (existing) existing.hidden = true;
      return;
    }

    let panel = byId("frzTopInOutPanel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "frzTopInOutPanel";
      panel.style.border = "1px solid #e6e6e6";
      panel.style.borderRadius = "12px";
      panel.style.padding = "12px";
      panel.style.background = "#fff";
      panel.style.marginBottom = "12px";
      dashCards.insertBefore(panel, dashCards.firstChild);
    } else {
      panel.hidden = false;
      if (panel.parentNode !== dashCards) dashCards.insertBefore(panel, dashCards.firstChild);
      else if (dashCards.firstChild !== panel) dashCards.insertBefore(panel, dashCards.firstChild);
    }

    panel.textContent = "";

    const headRow = document.createElement("div");
    headRow.style.display = "flex";
    headRow.style.gap = "10px";
    headRow.style.alignItems = "center";
    headRow.style.flexWrap = "wrap";

    const title = document.createElement("b");
    title.textContent = safeText(v.title || "Top 10 IN/OUT");
    headRow.appendChild(title);

    const hint = document.createElement("span");
    hint.style.opacity = ".75";
    hint.style.fontSize = "13px";
    hint.textContent = safeText(v.hint || "");
    headRow.appendChild(hint);

    const spacer = document.createElement("div");
    spacer.style.flex = "1";
    headRow.appendChild(spacer);

    const btnWrap = document.createElement("div");
    btnWrap.style.display = "inline-flex";
    btnWrap.style.gap = "8px";
    btnWrap.setAttribute("role", "group");
    btnWrap.setAttribute("aria-label", "Välj period för topplistor");

    const buttons = Array.isArray(v.periodButtons) ? v.periodButtons : [7, 30, 90];
    buttons.forEach((days) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn"; // använder din befintliga knappstil om den finns
      b.textContent = String(days);
      b.style.borderRadius = "999px";
      b.setAttribute("aria-pressed", String(days) === String(v.periodDays) ? "true" : "false");
      b.disabled = !!v.locked;
      b.addEventListener("click", () => {
        try {
          if (v.handlers && typeof v.handlers.onPeriodChange === "function") {
            v.handlers.onPeriodChange(days);
          }
        } catch {}
      });
      btnWrap.appendChild(b);
    });

    headRow.appendChild(btnWrap);
    panel.appendChild(headRow);

    const hr = document.createElement("div");
    hr.style.height = "1px";
    hr.style.background = "#eee";
    hr.style.margin = "10px 0";
    panel.appendChild(hr);

    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "1fr";
    grid.style.gap = "12px";
    grid.style.marginTop = "8px";

    try {
      if (window.matchMedia && window.matchMedia("(min-width: 900px)").matches) {
        const two = !!v.showIn && !!v.showOut;
        grid.style.gridTemplateColumns = two ? "1fr 1fr" : "1fr";
      }
    } catch {}

    if (v.showIn) grid.appendChild(renderTopTable("IN (Top 10)", v.inRows));
    if (v.showOut) grid.appendChild(renderTopTable("OUT (Top 10)", v.outRows));

    panel.appendChild(grid);

    if (v.metaText) {
      const meta = document.createElement("div");
      meta.style.opacity = ".75";
      meta.style.fontSize = "12px";
      meta.style.marginTop = "10px";
      meta.textContent = safeText(v.metaText);
      panel.appendChild(meta);
    }
  }

  function renderTopTable(titleText, rows) {
    const card = document.createElement("div");
    card.style.border = "1px solid #e6e6e6";
    card.style.borderRadius = "12px";
    card.style.padding = "10px";
    card.style.background = "#fafafa";

    const t = document.createElement("b");
    t.textContent = safeText(titleText);
    card.appendChild(t);

    const list = Array.isArray(rows) ? rows : [];

    const sub = document.createElement("div");
    sub.style.opacity = ".75";
    sub.style.fontSize = "12px";
    sub.style.marginTop = "4px";
    sub.textContent = `rader: ${list.length}`;
    card.appendChild(sub);

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.marginTop = "8px";
    table.setAttribute("aria-label", safeText(titleText));

    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    const th1 = document.createElement("th"); th1.textContent = "Artikel"; th1.style.textAlign = "left"; th1.style.padding = "6px";
    const th2 = document.createElement("th"); th2.textContent = "Qty"; th2.style.textAlign = "right"; th2.style.padding = "6px";
    const th3 = document.createElement("th"); th3.textContent = "Antal"; th3.style.textAlign = "right"; th3.style.padding = "6px";
    trh.appendChild(th1); trh.appendChild(th2); trh.appendChild(th3);
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    if (!list.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.style.padding = "10px 6px";
      td.style.opacity = ".75";
      td.textContent = "Inga träffar för perioden.";
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      list.forEach((r) => {
        const tr = document.createElement("tr");
        tr.style.borderTop = "1px solid #eee";

        const td1 = document.createElement("td");
        td1.style.padding = "8px 6px";
        td1.textContent = safeText(r && r.label);
        tr.appendChild(td1);

        const td2 = document.createElement("td");
        td2.style.padding = "8px 6px";
        td2.style.textAlign = "right";
        td2.textContent = safeText(r && r.qty);
        tr.appendChild(td2);

        const td3 = document.createElement("td");
        td3.style.padding = "8px 6px";
        td3.style.textAlign = "right";
        td3.textContent = safeText(r && r.count);
        tr.appendChild(td3);

        tbody.appendChild(tr);
      });
    }

    table.appendChild(tbody);
    card.appendChild(table);
    return card;
  }

  // ------------------------------------------------------------
  // USERS PANEL (render-only)
  // ------------------------------------------------------------
  function renderUsersPanel(usersVm) {
    const panel = byId("frzUsersPanel");
    const list = byId("frzUsersList");
    const count = byId("frzUsersCount");
    if (!panel) return;

    const v = (usersVm && typeof usersVm === "object") ? usersVm : {};
    panel.hidden = !v.visible;
    if (panel.hidden) return;

    const rows = Array.isArray(v.rows) ? v.rows : [];

    if (count) count.textContent = String(rows.length);
    if (!list) return;

    list.textContent = "";

    rows.forEach((u) => {
      const row = document.createElement("div");
      row.className = "userRow";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = safeText(u && u.firstName);

      const meta = document.createElement("div");
      meta.className = "meta muted";
      meta.textContent = safeText(u && u.meta);

      const spacer = document.createElement("div");
      spacer.className = "spacer";

      const badge = document.createElement("span");
      badge.className = "badge" + ((u && u.active) ? "" : " off");
      badge.textContent = (u && u.active) ? "ACTIVE" : "INACTIVE";

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn";
      btnEdit.type = "button";
      btnEdit.textContent = "Redigera";
      btnEdit.disabled = !!v.locked;
      btnEdit.addEventListener("click", () => {
        try {
          v.handlers && v.handlers.onEdit && v.handlers.onEdit(safeText(u && u.id));
        } catch {}
      });

      const btnToggle = document.createElement("button");
      btnToggle.className = "btn";
      btnToggle.type = "button";
      btnToggle.textContent = (u && u.active) ? "Inaktivera" : "Aktivera";
      btnToggle.disabled = !!v.locked;
      btnToggle.addEventListener("click", () => {
        try {
          v.handlers && v.handlers.onToggleActive && v.handlers.onToggleActive(safeText(u && u.id));
        } catch {}
      });

      row.appendChild(name);
      row.appendChild(meta);
      row.appendChild(spacer);
      row.appendChild(badge);
      row.appendChild(btnEdit);
      row.appendChild(btnToggle);

      list.appendChild(row);
    });
  }

  // ------------------------------------------------------------
  // ITEMS REGISTER (render-only, all state + actions via vm)
  // ------------------------------------------------------------
  function renderItemsRegister(itemsVm) {
    const wrap = byId("frzSaldoTableWrap");
    const count = byId("frzSaldoCount");
    if (!wrap || !count) return;

    const v = (itemsVm && typeof itemsVm === "object") ? itemsVm : {};
    wrap.textContent = "";
    count.textContent = String(v.count || 0);

    if (!v.visible) {
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = "Saldo/Produkter är inte tillgängligt i denna roll eller i låst läge.";
      wrap.appendChild(d);
      return;
    }

    // Controller kan välja att rendera exakt UI senare.
    // Här lämnar vi en minimal “placeholder” så sidan inte kraschar.
    if (v.placeholderText) {
      const p = document.createElement("div");
      p.className = "muted";
      p.textContent = safeText(v.placeholderText);
      wrap.appendChild(p);
      return;
    }

    // Om controller skickar en färdig DOM-bygg-VM kan ni fylla på här senare.
    // (För att hålla leveransen ren och stabil: inget mer utan att controller är uppdaterad.)
  }

  // ------------------------------------------------------------
  // HISTORY (render-only)
  // ------------------------------------------------------------
  function renderHistory(histVm) {
    const root = byId("frzHistoryList");
    const count = byId("frzHistoryCount");
    if (!root || !count) return;

    const v = (histVm && typeof histVm === "object") ? histVm : {};
    root.textContent = "";

    if (!v.visible) {
      count.textContent = "0";
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = "Historik är inte tillgänglig.";
      root.appendChild(d);
      return;
    }

    const locked = !!v.locked;
    const filter = (v.filter && typeof v.filter === "object") ? v.filter : { from: "", to: "", type: "ALL", q: "" };
    const rows = Array.isArray(v.rows) ? v.rows : [];

    count.textContent = String(v.count != null ? v.count : rows.length);

    const wrap = document.createElement("div");
    wrap.className = "list";

    wrap.appendChild(renderHistoryFilterBar(filter, locked, v.handlers));
    wrap.appendChild(renderHistoryList(rows));

    root.appendChild(wrap);
  }

  function renderHistoryFilterBar(filter, locked, handlers) {
    const bar = document.createElement("div");
    bar.className = "row";
    bar.style.marginBottom = "10px";

    const fromLabel = pillDate("Från", "frzHistFrom", filter.from, locked, (val) => {
      safeCall(handlers, "onFilterChange", Object.assign({}, filter, { from: val }));
    });

    const toLabel = pillDate("Till", "frzHistTo", filter.to, locked, (val) => {
      safeCall(handlers, "onFilterChange", Object.assign({}, filter, { to: val }));
    });

    const typeLabel = pillSelect("Typ", "frzHistType", [
      { v: "ALL", t: "Alla" },
      { v: "IN", t: "IN" },
      { v: "OUT", t: "OUT" }
    ], filter.type, locked, (val) => {
      safeCall(handlers, "onFilterChange", Object.assign({}, filter, { type: val || "ALL" }));
    });

    const qLabel = pillText("Artikel", "frzHistQ", filter.q, "t.ex. FZ-010 / kyckling", locked, (val) => {
      safeCall(handlers, "onFilterChange", Object.assign({}, filter, { q: val }));
    });

    const spacer = document.createElement("div");
    spacer.className = "spacer";

    const btnClear = document.createElement("button");
    btnClear.className = "btn";
    btnClear.type = "button";
    btnClear.textContent = "Rensa";
    btnClear.disabled = locked;
    btnClear.addEventListener("click", () => {
      safeCall(handlers, "onClear");
    });

    const hint = document.createElement("span");
    hint.className = "muted";
    hint.style.fontSize = "13px";
    hint.textContent = safeText((handlers && handlers.hintText) || "Filter: datum (inklusive), typ och artikel (case-insensitiv).");

    bar.appendChild(fromLabel);
    bar.appendChild(toLabel);
    bar.appendChild(typeLabel);
    bar.appendChild(qLabel);
    bar.appendChild(spacer);
    bar.appendChild(btnClear);
    bar.appendChild(hint);

    return bar;
  }

  function renderHistoryList(rows) {
    if (!rows.length) {
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = "Ingen historik ännu (eller inga träffar).";
      return d;
    }

    const list = document.createElement("div");
    list.className = "list";

    rows.forEach((h) => {
      const row = document.createElement("div");
      row.className = "userRow";

      const left = document.createElement("div");
      left.className = "meta";
      left.textContent = safeText(h && h.left);

      const note = document.createElement("div");
      note.className = "muted";
      note.textContent = safeText(h && h.note);

      const by = document.createElement("span");
      by.className = "badge";
      by.textContent = safeText(h && h.badge);

      row.appendChild(left);
      row.appendChild(note);
      row.appendChild(by);

      list.appendChild(row);
    });

    return list;
  }

  // ------------------------------------------------------------
  // SMALL UI CONTROLS (render-only)
  // ------------------------------------------------------------
  function pillDate(label, id, value, disabled, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "pill";
    wrap.setAttribute("for", id);

    const muted = document.createElement("span");
    muted.className = "muted";
    muted.textContent = `${label}:`;

    const inp = document.createElement("input");
    inp.id = id;
    inp.type = "date";
    inp.value = safeText(value || "");
    inp.disabled = !!disabled;
    inp.addEventListener("change", () => {
      try { onChange && onChange(inp.value || ""); } catch {}
    });

    wrap.appendChild(muted);
    wrap.appendChild(inp);
    return wrap;
  }

  function pillText(label, id, value, placeholder, disabled, onInput) {
    const wrap = document.createElement("label");
    wrap.className = "pill";
    wrap.setAttribute("for", id);

    const muted = document.createElement("span");
    muted.className = "muted";
    muted.textContent = `${label}:`;

    const inp = document.createElement("input");
    inp.id = id;
    inp.type = "text";
    inp.value = safeText(value || "");
    inp.placeholder = safeText(placeholder || "");
    inp.maxLength = 64;
    inp.disabled = !!disabled;
    inp.addEventListener("input", () => {
      try { onInput && onInput(inp.value || ""); } catch {}
    });

    wrap.appendChild(muted);
    wrap.appendChild(inp);
    return wrap;
  }

  function pillSelect(label, id, options, selected, disabled, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "pill";
    wrap.setAttribute("for", id);

    const muted = document.createElement("span");
    muted.className = "muted";
    muted.textContent = `${label}:`;

    const sel = document.createElement("select");
    sel.id = id;
    sel.disabled = !!disabled;

    (options || []).forEach((o) => {
      const opt = document.createElement("option");
      opt.value = safeText(o && o.v);
      opt.textContent = safeText(o && o.t);
      sel.appendChild(opt);
    });

    sel.value = safeText(selected || "");
    sel.addEventListener("change", () => {
      try { onChange && onChange(sel.value || ""); } catch {}
    });

    wrap.appendChild(muted);
    wrap.appendChild(sel);
    return wrap;
  }

  function setTab(btn, selected) {
    if (!btn) return;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
  }

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(v) {
    if (v === null || typeof v === "undefined") return "";
    return String(v);
  }

  function safeCall(obj, fnName /*, ...args */) {
    try {
      if (!obj) return;
      const fn = obj[fnName];
      if (typeof fn !== "function") return;
      const args = Array.prototype.slice.call(arguments, 2);
      fn.apply(null, args);
    } catch {
      // fail-soft
    }
  }

  /* ============================================================
  ÄNDRINGSLOGG (≤8)
  1) Refactor: Render-filen är nu render-only (ingen store/dashboard/state).
  2) Ny API: renderApp(vm) tar all data + callbacks från controller.
  3) Top IN/OUT panel renderas via vm.topInOut + handler onPeriodChange.
  4) History filter renderas via vm.history + callbacks onFilterChange/onClear.
  5) XSS-safe: textContent överallt, fail-soft render.
  ============================================================ */
})();
