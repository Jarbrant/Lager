/* ============================================================
AO-REFAC-STORE-SPLIT-01 (PROD) | FIL: UI/freezer-store.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte (KRAV 2):
- Back-compat fasad: behåll gamla import-paths
- Re-exporterar window.FreezerStore från UI/pages/freezer/03-store.js
- Refactor-only: ingen funktionsförändring

Policy:
- Inga nya storage-keys
- Fail-closed om 03-store inte laddats

Taggar:
- GUARD / FLOW
============================================================ */

(function () {
  "use strict";

  // ------------------------------------------------------------
  // GUARD: stable init hook (avoid double init)
  // ------------------------------------------------------------
  const VERSION = "AO-REFAC-STORE-SPLIT-01:freezer-store@1";
  if (window.FreezerStoreFacade && window.FreezerStoreFacade.version === VERSION) return;

  // ------------------------------------------------------------
  // GUARD: build fail-closed facade (minimal API, no crash)
  // ------------------------------------------------------------
  function buildFailClosed(reason) {
    const msg = reason || "FreezerStore saknas (import-ordning fel).";

    return {
      version: VERSION,
      ok: false,
      reason: msg,

      // Minimal API så att sidan inte kraschar (fail-closed)
      init: () => ({ ok: false, status: "KORRUPT", locked: true, readOnly: true, role: "ADMIN", reason: msg }),
      getState: () => null,
      getStatus: () => ({ ok: false, status: "KORRUPT", locked: true, readOnly: true, role: "ADMIN", reason: msg }),
      subscribe: () => () => {},
      setRole: () => ({ ok: false, reason: msg }),
      resetDemo: () => ({ ok: false, reason: msg }),
      trySave: () => ({ ok: false, reason: msg }),

      // Perms
      can: () => false,
      hasPerm: () => false,

      // Users
      listUsers: () => [],
      createUser: () => ({ ok: false, reason: msg }),
      updateUser: () => ({ ok: false, reason: msg }),
      setUserActive: () => ({ ok: false, reason: msg }),

      // Items
      listItems: () => [],
      queryItems: () => [],
      createItem: () => ({ ok: false, reason: msg }),
      updateItem: () => ({ ok: false, reason: msg }),
      archiveItem: () => ({ ok: false, reason: msg }),
      deleteItem: () => ({ ok: false, reason: msg })
    };
  }

  // ------------------------------------------------------------
  // FLOW: prefer real store from 03-store.js if already loaded
  // ------------------------------------------------------------
  if (window.FreezerStore && typeof window.FreezerStore === "object") {
    // Back-compat: expose same instance under multiple legacy names
    window.FreezerStoreFacade = window.FreezerStore;
    window.FreezerStoreDirect = window.FreezerStore; // optional legacy alias
    return;
  }

  // ------------------------------------------------------------
  // FLOW: fail-closed until 03-store is loaded
  // NOTE: back-compat expects window.FreezerStore to exist for older code.
  // ------------------------------------------------------------
  const shim = buildFailClosed("FreezerStore saknas. Ladda UI/pages/freezer/03-store.js före UI/freezer-store.js.");

  window.FreezerStoreFacade = shim;

  // Back-compat: many callers use window.FreezerStore directly
  if (!window.FreezerStore) window.FreezerStore = shim;

  // Optional legacy alias
  if (!window.FreezerStoreDirect) window.FreezerStoreDirect = shim;

  /* ÄNDRINGSLOGG (≤8)
  1) Back-compat: säkerställer att window.FreezerStore alltid finns (shim) vid fel ordning.
  2) Fail-closed shim utökad med hasPerm + reason på actions (ingen funktionsändring i real store).
  3) GUARD/FLOW-kommentarer + stabil VERSION-guard kvar.
  */
})();
