/* ============================================================
AO-01/15 — NY-BASELINE | FIL: UI/freezer-render.js
+ AO-02/15 — Statuspanel + Read-only UX + felkoder
+ AO-03/15 — Users CRUD UI render (Admin)

Syfte:
- XSS-safe rendering (textContent, aldrig osäker innerHTML)
- Render av status banner/pill + lockpanel + debug + mode
- Tab UI växling (dashboard/saldo/history)
- Users-panel: visa/dölj via RBAC (users_manage), rendera lista + count

Kontrakt:
- Förväntar window.FreezerStore.getStatus() och state-shape från freezer-store.js
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
  function renderAll(state) {
    // Fail-closed: om state saknas, visa låst
    renderStatus(state);
    renderMode(state);
    renderLockPanel(state);
    renderDebug(state);

    renderUsersPanel(state);
    renderSaldo(state);
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

    // pill text
    if (pillText) pillText.textContent = st.status;

    // pill styling
    if (pill) {
      pill.classList.remove("ok", "danger");
      if (st.status === "OK") pill.classList.add("ok");
      if (st.status !== "OK") pill.classList.add("danger");
      pill.title = st.status === "OK"
        ? "OK – lagring och state ser bra ut"
        : `Problem – ${st.errorCode || "okänd kod"}`;
    }

    // lock panel
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

    // disable critical actions when read-only or locked
    if (resetBtn) resetBtn.disabled = !!(st.locked || st.readOnly);

    // Disable users CRUD buttons if no permission
    const canUsers = can("users_manage");
    const saveBtn = byId("frzUserSaveBtn");
    const cancelBtn = byId("frzUserCancelBtn");
    if (saveBtn) saveBtn.disabled = !!(st.locked || st.readOnly || !canUsers);
    if (cancelBtn) cancelBtn.disabled = !!(st.locked || st.readOnly || !canUsers);

    // Also disable form inputs
    const fn = byId("frzUserFirstName");
    if (fn) fn.disabled = !!(st.locked || st.readOnly || !canUsers);
    ["perm_users_manage","perm_inventory_write","perm_history_write","perm_dashboard_view"].forEach(id => {
      const el = byId(id);
      if (el) el.disabled = !!(st.locked || st.readOnly || !canUsers);
    });
  }

  // -----------------------------
  // LOCK PANEL (AO-02)
  // -----------------------------
  function renderLockPanel(state) {
    // renderStatus already handles show/hide; keep for API completeness
    renderStatus(state);
  }

  // -----------------------------
  // DEBUG (AO-02 optional)
  // -----------------------------
  function renderDebug(state) {
    const panel = byId("frzDebugPanel");
    const text = byId("frzDebugText");

    // debug är "valfri" men vi gör den alltid tillgänglig om panel finns
    if (!panel || !text) return;

    const st = safeStatus();
    // Visa bara när något är fel eller om demo skapats/tomt (nyttigt i baseline)
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

    // RBAC: panel syns bara om ADMIN får users_manage (fail-closed)
    panel.hidden = !!(st.locked || st.readOnly || !canUsers);

    // Count/list renderas även om panel är hidden? Nej, onödigt.
    if (panel.hidden) return;

    const users = safeUsers(state);

    if (count) count.textContent = String(users.length);

    if (!list) return;

    // Clear list
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
  // SALDO / HISTORY / DASH (baseline)
  // -----------------------------
  function renderSaldo(state) {
    const wrap = byId("frzSaldoTableWrap");
    const count = byId("frzSaldoCount");
    if (!wrap || !count) return;

    const items = safeItems(state);
    count.textContent = String(items.length);

    // Minimal baseline render (safe)
    wrap.textContent = "";
    if (!items.length) {
      const d = document.createElement("div");
      d.className = "muted";
      d.textContent = "Inga artiklar ännu.";
      wrap.appendChild(d);
      return;
    }

    const table = document.createElement("table");
    table.style.width = "100%";
    table.style.borderCollapse = "collapse";
    table.style.fontSize = "13px";

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    ["SKU", "Namn", "Enhet", "Saldo", "Min"].forEach(h => {
      const th = document.createElement("th");
      th.textContent = h;
      th.style.textAlign = "left";
      th.style.padding = "8px";
      th.style.borderBottom = "1px solid #e6e6e6";
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    items.forEach(it => {
      const tr = document.createElement("tr");
      [it.sku, it.name, it.unit, String(it.onHand ?? 0), String(it.min ?? 0)].forEach(v => {
        const td = document.createElement("td");
        td.textContent = safeText(v);
        td.style.padding = "8px";
        td.style.borderBottom = "1px solid #f0f0f0";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

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

    const items = safeItems(state);
    const st = safeStatus();

    cards.textContent = "";

    // Minimal baseline cards (stub-safe)
    addCard(cards, "Artiklar", String(items.length));
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

  function safeItems(state) {
    const s = state && typeof state === "object" ? state : null;
    const items = s && s.data && Array.isArray(s.data.items) ? s.data.items : [];
    return items.map(it => ({
      sku: safeText(it && it.sku),
      name: safeText(it && it.name),
      unit: safeText(it && it.unit),
      onHand: (it && typeof it.onHand !== "undefined") ? it.onHand : 0,
      min: (it && typeof it.min !== "undefined") ? it.min : 0
    }));
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
