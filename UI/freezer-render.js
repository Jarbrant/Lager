/* ============================================================
AO-02/15 — Statuspanel + Read-only UX + felkoder | BLOCK 1/3
AUTOPATCH | FIL: UI/freezer-render.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte (AO-02):
- Statusbanner: OK / TOM / KORRUPT + felorsak + felkod
- Read-only UX: disable actions + “varför”
- Debug-ruta (valfri): storageKey + schemaVersion (+ rawWasEmpty/demoCreated)

OBS:
- XSS-safe: endast textContent, inga osäkra innerHTML
- Render använder FreezerStore.getStatus() (utökad i AO-02 store)
============================================================ */

const FreezerRender = {
  renderAll,
  renderStatus,
  renderMode,
  renderLockPanel,
  renderTabs,
  renderSaldo,
  renderHistory,
  renderDebug,
  setActiveTabUI
};

window.FreezerRender = FreezerRender;

/* -----------------------------
  DOM GETTERS (fail-soft)
----------------------------- */
function el(id) { return document.getElementById(id); }

/* -----------------------------
  MAIN
----------------------------- */
function renderAll(state) {
  const st = state || null;
  renderStatus(st);
  renderMode(st);
  renderLockPanel(st);
  renderDebug(st);
  renderTabs(st);
  renderSaldo(st);
  renderHistory(st);
}

/* -----------------------------
  STATUS / MODE / LOCK
----------------------------- */
function renderStatus(state) {
  const pill = el("frzStatusPill");
  const txt = el("frzStatusText");
  if (!pill || !txt) return;

  const status = getStatusSafe();

  // Label: OK / TOM / KORRUPT
  const label = status.status || (status.locked ? "KORRUPT" : "OK");
  txt.textContent = label;

  // Color hint (via class)
  pill.classList.remove("danger", "ok");
  if (label === "KORRUPT" || status.locked) pill.classList.add("danger");
  else pill.classList.add("ok");

  // aria label includes error code + reason (if any)
  const parts = [];
  parts.push(`Status: ${label}`);
  if (status.errorCode) parts.push(`Kod: ${status.errorCode}`);
  if (status.reason) parts.push(`Orsak: ${status.reason}`);
  pill.setAttribute("aria-label", parts.join(" • "));
}

function renderMode(state) {
  const mode = el("frzModeText");
  const userSelect = el("frzUserSelect");
  const resetBtn = el("frzResetDemoBtn");

  const status = getStatusSafe();

  if (mode) {
    const label = status.locked ? "Låst"
      : (status.readOnly ? "Read-only" : "Skrivbar");
    mode.textContent = label;
    mode.title = status.whyReadOnly ? status.whyReadOnly : "";
  }

  if (userSelect) {
    // Keep UI selection aligned
    if (status.role && userSelect.value !== status.role) {
      userSelect.value = status.role;
    }
    // Role select allowed even in locked; but give hint
    userSelect.disabled = false;
    userSelect.title = status.locked ? "Låst läge: roll kan ändras, men inget kan sparas." : "";
  }

  if (resetBtn) {
    // AO-02: disable with "why" text
    const disabled = !!status.locked || !!status.readOnly;
    resetBtn.disabled = disabled;

    if (status.locked) {
      resetBtn.title = `Spärrad: ${status.reason ? status.reason : "Låst läge"} (${status.errorCode || "kod saknas"})`;
    } else if (status.readOnly) {
      resetBtn.title = `Spärrad: ${status.whyReadOnly || "Read-only"}`;
    } else {
      resetBtn.title = "Återställ demo-data";
    }
  }
}

function renderLockPanel(state) {
  const panel = el("frzLockPanel");
  const reasonEl = el("frzLockReason");
  if (!panel || !reasonEl) return;

  const status = getStatusSafe();

  if (status.locked) {
    panel.hidden = false;

    // AO-02: include errorCode
    const code = status.errorCode ? ` (${status.errorCode})` : "";
    const reason = status.reason || "Okänd";
    reasonEl.textContent = `Orsak: ${reason}${code}`;
  } else {
    panel.hidden = true;
    reasonEl.textContent = "";
  }
}

/* -----------------------------
  DEBUG (optional UI)
  - If DOM ids exist, we render them. If not, we do nothing.
  - Expected ids (optional):
    - frzDebugPanel, frzDebugText
----------------------------- */
function renderDebug(state) {
  const panel = el("frzDebugPanel");
  const txt = el("frzDebugText");
  if (!panel || !txt) return;

  const status = getStatusSafe();
  const d = status.debug || {};

  // Keep debug hidden in locked? No: show it always if present
  panel.hidden = false;

  const lines = [];
  lines.push(`key: ${safeText(d.storageKey || "")}`);
  lines.push(`schema: ${safeText(String(d.schemaVersion ?? ""))}`);
  lines.push(`rawEmpty: ${safeText(String(d.rawWasEmpty ?? ""))}`);
  lines.push(`demo: ${safeText(String(d.demoCreated ?? ""))}`);
  if (status.errorCode) lines.push(`error: ${safeText(status.errorCode)}`);
  if (d.lastLoadError) lines.push(`lastLoadError: ${safeText(String(d.lastLoadError))}`);

  txt.textContent = lines.join(" • ");
}

/* -----------------------------
  TABS (just count + safety)
----------------------------- */
function renderTabs(state) {
  const saldoCount = el("frzSaldoCount");
  const histCount = el("frzHistoryCount");

  const items = (state && state.data && Array.isArray(state.data.items)) ? state.data.items : [];
  const hist = (state && state.data && Array.isArray(state.data.history)) ? state.data.history : [];

  if (saldoCount) saldoCount.textContent = String(items.length);
  if (histCount) histCount.textContent = String(hist.length);
}

/* -----------------------------
  SALDO TABLE (XSS-safe)
----------------------------- */
function renderSaldo(state) {
  const wrap = el("frzSaldoTableWrap");
  if (!wrap) return;

  clear(wrap);

  const items = (state && state.data && Array.isArray(state.data.items)) ? state.data.items : [];
  if (items.length === 0) {
    // AO-02: show TOM hint if status says TOM
    const status = getStatusSafe();
    if (status.status === "TOM") {
      wrap.appendChild(pMuted("Tomt läge: inga artiklar i lagringen ännu."));
    } else {
      wrap.appendChild(pMuted("Inga artiklar ännu."));
    }
    return;
  }

  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  table.setAttribute("aria-label", "Lagersaldo tabell");

  const thead = document.createElement("thead");
  const trh = document.createElement("tr");
  ["SKU", "Artikel", "I lager", "Min", "Enhet", "Uppdaterad"].forEach(h => {
    const th = document.createElement("th");
    th.textContent = h;
    th.style.textAlign = "left";
    th.style.padding = "8px";
    th.style.borderBottom = "1px solid #e6e6e6";
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  items
    .slice()
    .sort((a,b) => String(a.sku).localeCompare(String(b.sku), "sv"))
    .forEach(it => {
      const tr = document.createElement("tr");
      tr.appendChild(td(String(it.sku)));
      tr.appendChild(td(String(it.name)));
      tr.appendChild(td(String(num(it.onHand))));
      tr.appendChild(td(String(num(it.min))));
      tr.appendChild(td(String(it.unit || "")));
      tr.appendChild(td(fmtDate(it.updatedAt)));
      tbody.appendChild(tr);
    });

  table.appendChild(tbody);
  wrap.appendChild(table);
}

/* -----------------------------
  HISTORY LIST (XSS-safe)
----------------------------- */
function renderHistory(state) {
  const wrap = el("frzHistoryList");
  if (!wrap) return;

  clear(wrap);

  const hist = (state && state.data && Array.isArray(state.data.history)) ? state.data.history : [];
  if (hist.length === 0) {
    wrap.appendChild(pMuted("Ingen historik ännu."));
    return;
  }

  const ul = document.createElement("ul");
  ul.style.listStyle = "none";
  ul.style.padding = "0";
  ul.style.margin = "0";

  hist
    .slice()
    .sort((a,b) => String(b.ts).localeCompare(String(a.ts)))
    .forEach(h => {
      const li = document.createElement("li");
      li.style.padding = "10px 8px";
      li.style.borderBottom = "1px solid #e6e6e6";

      const top = document.createElement("div");
      top.style.display = "flex";
      top.style.gap = "10px";
      top.style.flexWrap = "wrap";
      top.style.alignItems = "baseline";

      const ts = document.createElement("b");
      ts.textContent = fmtDateTime(h.ts);

      const type = document.createElement("span");
      type.textContent = `• ${String(h.type || "note")}`;

      const who = document.createElement("span");
      who.className = "muted";
      who.textContent = h.by ? `• ${String(h.by)}` : "";

      top.appendChild(ts);
      top.appendChild(type);
      if (who.textContent) top.appendChild(who);

      const msg = document.createElement("div");
      msg.className = "muted";
      msg.style.marginTop = "4px";
      msg.textContent = buildHistoryLine(h);

      li.appendChild(top);
      li.appendChild(msg);

      ul.appendChild(li);
    });

  wrap.appendChild(ul);
}

function buildHistoryLine(h) {
  const sku = h.sku ? `SKU ${h.sku}` : "";
  const qty = (typeof h.qty === "number" && isFinite(h.qty) && h.qty !== 0) ? `qty ${h.qty}` : "";
  const note = h.note ? String(h.note) : "";
  return [sku, qty, note].filter(Boolean).join(" • ") || "—";
}

/* -----------------------------
  TAB UI (controller will call)
----------------------------- */
function setActiveTabUI(tabKey) {
  const tabs = [
    { key: "dashboard", btn: el("tabDashboard"), view: el("viewDashboard") },
    { key: "saldo", btn: el("tabSaldo"), view: el("viewSaldo") },
    { key: "history", btn: el("tabHistorik"), view: el("viewHistorik") }
  ];

  tabs.forEach(t => {
    const active = t.key === tabKey;
    if (t.btn) t.btn.setAttribute("aria-selected", active ? "true" : "false");
    if (t.view) t.view.hidden = !active;
  });
}

/* -----------------------------
  HELPERS
----------------------------- */
function getStatusSafe() {
  try {
    if (!window.FreezerStore || typeof window.FreezerStore.getStatus !== "function") {
      return { status: "KORRUPT", errorCode: "FRZ_E_NOT_INIT", locked: true, readOnly: true, role: "ADMIN", reason: "Store saknas." };
    }
    return window.FreezerStore.getStatus();
  } catch {
    return { status: "KORRUPT", errorCode: "FRZ_E_NOT_INIT", locked: true, readOnly: true, role: "ADMIN", reason: "Store-status kunde inte läsas." };
  }
}

function safeText(s) {
  // Only used to normalize debug strings; rendering is still textContent.
  return String(s || "").replace(/\s+/g, " ").trim();
}

/* -----------------------------
  SMALL DOM HELPERS
----------------------------- */
function td(text) {
  const cell = document.createElement("td");
  cell.textContent = text;
  cell.style.padding = "8px";
  cell.style.borderBottom = "1px solid #f0f0f0";
  return cell;
}

function pMuted(text) {
  const p = document.createElement("div");
  p.className = "muted";
  p.textContent = text;
  return p;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(iso) {
  if (!iso || typeof iso !== "string") return "—";
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("sv-SE");
}

function fmtDateTime(iso) {
  if (!iso || typeof iso !== "string") return "—";
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return "—";
  return d.toLocaleString("sv-SE", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
}
