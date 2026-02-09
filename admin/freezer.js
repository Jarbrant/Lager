/* ============================================================
AO-LOGIN-03 (REBUILD) | FIL: Lager/admin/freezer.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- Session-guard (FRZ_SESSION_V1) -> ADMIN-only, fail-closed
- Stabil modal-hantering: får aldrig låsa sidan
- Modal öppnas ENDAST via "Skapa användare"

Policy:
- UI-only (inte riktig säkerhet)
- Inga nya storage keys/datamodell här
- XSS-safe (render via textContent, ingen osäker innerHTML)
============================================================ */

(function () {
  "use strict";

  // ------------------------------------------------------------
  // AO-LOGIN-01: SESSION GUARD (fail-closed)
  // ------------------------------------------------------------
  const SESSION_KEY = "FRZ_SESSION_V1";

  function safeJsonParse(raw) { try { return JSON.parse(raw); } catch { return null; } }

  function readSession() {
    try {
      const sRaw = (window.sessionStorage && window.sessionStorage.getItem(SESSION_KEY)) || null;
      if (sRaw) return safeJsonParse(sRaw);
    } catch {}
    try {
      const lRaw = (window.localStorage && window.localStorage.getItem(SESSION_KEY)) || null;
      if (lRaw) return safeJsonParse(lRaw);
    } catch {}
    return null;
  }

  function clearSession() {
    try { window.sessionStorage && window.sessionStorage.removeItem(SESSION_KEY); } catch {}
    try { window.localStorage && window.localStorage.removeItem(SESSION_KEY); } catch {}
  }

  function isSessionValidAndAdmin(sess) {
    try {
      if (!sess || typeof sess !== "object") return { ok: false, reason: "NO_SESSION" };

      const role = String(sess.role || "").toUpperCase().trim();
      if (role !== "ADMIN") return { ok: false, reason: "NOT_ADMIN" };

      const exp = Number(sess.exp || 0);
      if (exp && Date.now() > exp) return { ok: false, reason: "EXPIRED" };

      const firstName = String(sess.firstName || "").trim();
      if (!firstName) return { ok: false, reason: "BAD_SESSION" };

      return { ok: true, role: role, firstName: firstName };
    } catch {
      return { ok: false, reason: "BAD_SESSION" };
    }
  }

  function redirectToLogin() {
    try { window.location.replace("../index.html"); } catch {
      try { window.location.href = "../index.html"; } catch {}
    }
  }

  // Guard direkt
  let sessionView = { ok: false, role: "ADMIN", firstName: "" };
  (function guardNow() {
    const sess = readSession();
    const v = isSessionValidAndAdmin(sess);
    if (!v.ok) {
      if (v.reason === "EXPIRED" || v.reason === "BAD_SESSION") clearSession();
      redirectToLogin();
      return;
    }
    sessionView = v;
  })();

  // ------------------------------------------------------------
  // INIT-GUARD (ingen dubbel init)
  // ------------------------------------------------------------
  if (window.__FRZ_ADMIN_PAGE_INIT__) {
    console.warn("[Freezer] admin/freezer.js redan initierad (guard).");
    return;
  }
  window.__FRZ_ADMIN_PAGE_INIT__ = true;

  function byId(id) { return document.getElementById(id); }

  // Topbar
  const roleText = byId("frzRoleText");
  const userNameText = byId("frzUserName");
  const viewHint = byId("frzViewHint");
  const resetBtn = byId("frzResetDemoBtn");
  const openCreateUserBtn = byId("frzOpenCreateUserBtn");

  // Legacy tabs
  const tabDashboard = byId("tabDashboard");
  const tabSaldo = byId("tabSaldo");
  const tabHistorik = byId("tabHistorik");

  let activeTab = "dashboard";

  // ------------------------------------------------------------
  // Store / Render guards
  // ------------------------------------------------------------
  if (!window.FreezerRender) {
    console.error("Freezer baseline saknar FreezerRender.");
    return;
  }

  let store = window.FreezerStore || null;
  let storeCorrupt = false;

  const storeShim = {
    init: function () { return { ok: false, reason: "Read-only: storage error." }; },
    setRole: function () {},
    subscribe: function () { return function () {}; },
    getState: function () { return {}; },
    getStatus: function () {
      return { role: "ADMIN", locked: false, readOnly: true, whyReadOnly: "Read-only: init-fel.", reason: "Storage error" };
    },
    can: function () { return false; },
    hasPerm: function () { return false; },

    resetDemo: function () { return { ok: false, reason: "Read-only: storage error." }; },

    listUsers: function () { return []; },
    createUser: function () { return { ok: false, reason: "Read-only: storage error." }; },
    updateUser: function () { return { ok: false, reason: "Read-only: storage error." }; },
    setUserActive: function () { return { ok: false, reason: "Read-only: storage error." }; },

    listItems: function () { return []; }
  };

  function getStore() { return storeCorrupt ? storeShim : store; }

  function markStoreCorrupt(err) {
    storeCorrupt = true;
    console.error("[Freezer] Store fel -> read-only shim aktiverad.", err);
  }

  function safeGetState() {
    try {
      const s = getStore();
      return (s && typeof s.getState === "function") ? s.getState() : {};
    } catch (e) {
      markStoreCorrupt(e);
      return {};
    }
  }

  function safeGetStatus() {
    try {
      const s = getStore();
      return (s && typeof s.getStatus === "function") ? s.getStatus() : storeShim.getStatus();
    } catch (e) {
      markStoreCorrupt(e);
      return storeShim.getStatus();
    }
  }

  function safeCan(perm) {
    const s = getStore();
    try {
      if (s && typeof s.hasPerm === "function") return !!s.hasPerm(perm);
      if (s && typeof s.can === "function") return !!s.can(perm);
      return false;
    } catch (e) {
      markStoreCorrupt(e);
      return false;
    }
  }

  // ------------------------------------------------------------
  // Topbar sync
  // ------------------------------------------------------------
  function syncTopbarIdentity() {
    const sess = readSession();
    const v = isSessionValidAndAdmin(sess);
    if (!v.ok) {
      redirectToLogin();
      return false;
    }
    if (roleText) roleText.textContent = "ADMIN";
    if (userNameText) userNameText.textContent = String(v.firstName || "—");
    return true;
  }
  syncTopbarIdentity();

  // ------------------------------------------------------------
  // VIEW HINT
  // ------------------------------------------------------------
  function setViewHint(text) {
    if (!viewHint) return;
    viewHint.textContent = String(text || "—");
  }
  function setHintForTab(tabKey) {
    const map = { dashboard: "Vy: Dashboard", saldo: "Vy: Saldo", history: "Vy: Historik" };
    setViewHint(map[String(tabKey || "")] || "Vy: —");
  }

  // ------------------------------------------------------------
  // MODAL: Rebuild (robust, aldrig lås)
  // Stöder både:
  // - Legacy overlay i HTML: #frzUserModalOverlay
  // - FreezerModal shell: [data-frz-modal="overlay"]
  // ------------------------------------------------------------
  function hardHide(el) {
    try {
      if (!el) return;
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
      el.style.display = "none";
      el.style.pointerEvents = "none";
    } catch {}
  }

  function killAllOverlays(reason) {
    void reason;

    // Legacy
    hardHide(byId("frzUserModalOverlay"));

    // Shell
    try {
      const shell = document.querySelector('[data-frz-modal="overlay"]');
      if (shell) hardHide(shell);
    } catch {}

    // Generic
    try {
      document.querySelectorAll(".modalOverlay").forEach(hardHide);
    } catch {}
  }

  function tryCloseShell() {
    try {
      if (window.FreezerModal && typeof window.FreezerModal.close === "function") {
        window.FreezerModal.close();
      }
    } catch {}
  }

  // Boot: alltid släck (detta löser "modal kvar och låser sidan")
  (function bootUnlock() {
    tryCloseShell();
    killAllOverlays("boot");
    // watchdog: om någon script råkar öppna igen direkt efter load
    let ticks = 0;
    const t = setInterval(() => {
      ticks++;
      tryCloseShell();
      killAllOverlays("watchdog");
      if (ticks > 50) clearInterval(t); // ~5s
    }, 100);

    document.addEventListener("keydown", (ev) => {
      if (!ev) return;
      if (ev.key === "Escape") {
        tryCloseShell();
        killAllOverlays("esc");
      }
    }, true);
  })();

  // Modal open: ENDAST via knapp
  function openCreateUser() {
    if (!syncTopbarIdentity()) return;

    const status = safeGetStatus();
    if (status.locked || status.readOnly) return;
    if (!safeCan("users_manage")) return;

    // Prioritera modal-shell om den finns
    if (window.FreezerModal && typeof window.FreezerModal.open === "function") {
      window.FreezerModal.open({
        title: "Skapa användare",
        text: "Modal-shell är aktiv. Koppla in formulär-render här i nästa steg."
      });
      return;
    }

    // Fallback: legacy overlay i HTML
    const legacy = byId("frzUserModalOverlay");
    if (!legacy) return;

    legacy.hidden = false;
    legacy.style.display = "flex";
    legacy.style.pointerEvents = "auto";
    legacy.setAttribute("aria-hidden", "false");
  }

  function closeAnyModal() {
    tryCloseShell();
    killAllOverlays("close");
  }

  // Wire “Skapa användare”
  function syncCreateUserTopbarBtn() {
    if (!openCreateUserBtn) return;
    const status = safeGetStatus();
    const canUsers = safeCan("users_manage");
    const disabled = !!status.locked || !!status.readOnly || !canUsers;
    openCreateUserBtn.disabled = disabled;

    if (disabled) {
      if (status.locked) openCreateUserBtn.title = status.reason ? `Låst: ${status.reason}` : "Låst läge.";
      else if (status.readOnly) openCreateUserBtn.title = status.whyReadOnly || "Read-only.";
      else openCreateUserBtn.title = "Saknar behörighet (users_manage).";
    } else {
      openCreateUserBtn.title = "Skapa ny användare";
    }
  }

  if (openCreateUserBtn) {
    openCreateUserBtn.addEventListener("click", () => openCreateUser());
  }

  // Wire legacy close buttons OM de finns i HTML (stänger alltid)
  const legacyClose = byId("frzUserModalCloseBtn");
  const legacyCancel = byId("frzUserCancelBtn");
  const legacyOverlay = byId("frzUserModalOverlay");

  if (legacyClose) legacyClose.addEventListener("click", () => closeAnyModal());
  if (legacyCancel) legacyCancel.addEventListener("click", () => closeAnyModal());
  if (legacyOverlay) {
    legacyOverlay.addEventListener("click", (ev) => {
      try {
        if (ev.target === legacyOverlay) closeAnyModal();
      } catch {}
    });
  }

  // ------------------------------------------------------------
  // BOOT: init store + render
  // ------------------------------------------------------------
  const itemsUI = { itemsMsg: "—" };

  const initialRole = "ADMIN";
  if (!store || typeof store.init !== "function") {
    console.error("Freezer baseline saknar FreezerStore.");
    storeCorrupt = true;
  } else {
    try { store.init({ role: initialRole }); } catch (e) { markStoreCorrupt(e); }
  }

  try {
    const s = getStore();
    if (s && typeof s.subscribe === "function") {
      s.subscribe((state) => {
        syncTopbarIdentity();
        window.FreezerRender.renderAll(state || {}, itemsUI);
        window.FreezerRender.setActiveTabUI(activeTab);
        syncCreateUserTopbarBtn();
        setHintForTab(activeTab);
      });
    }
  } catch (e) {
    markStoreCorrupt(e);
  }

  window.FreezerRender.renderAll(safeGetState(), itemsUI);
  window.FreezerRender.setActiveTabUI(activeTab);
  syncCreateUserTopbarBtn();

  // Legacy tabs
  function bindTab(btn, key) {
    if (!btn) return;
    btn.addEventListener("click", () => {
      activeTab = key;
      window.FreezerRender.setActiveTabUI(activeTab);
      window.FreezerRender.renderAll(safeGetState(), itemsUI);
      syncCreateUserTopbarBtn();
      setHintForTab(activeTab);
    });
  }

  bindTab(tabDashboard, "dashboard");
  bindTab(tabSaldo, "saldo");
  bindTab(tabHistorik, "history");
  setHintForTab(activeTab);

  // Reset demo
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const status = safeGetStatus();
      if (status.locked || status.readOnly) return;

      const s = getStore();
      try { if (s && typeof s.resetDemo === "function") s.resetDemo(); } catch (e) { markStoreCorrupt(e); }

      // efter reset: se till att ingen modal ligger kvar
      closeAnyModal();

      window.FreezerRender.renderAll(safeGetState(), itemsUI);
      syncCreateUserTopbarBtn();
    });
  }

})();
