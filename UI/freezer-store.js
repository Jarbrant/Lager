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

  // Version-guard (stabil hook)
  if (window.FreezerStoreFacade && window.FreezerStoreFacade.version === "AO-REFAC-STORE-SPLIT-01:freezer-store@1") return;

  function buildFailClosed(reason) {
    return {
      version: "AO-REFAC-STORE-SPLIT-01:freezer-store@1",
      ok: false,
      reason: reason || "FreezerStore saknas (import-ordning fel).",

      // Minimal API så att sidan inte kraschar
      init: () => ({ ok: false, status: "KORRUPT", locked: true, readOnly: true, role: "ADMIN", reason: reason || "Ej initierad." }),
      getState: () => null,
      getStatus: () => ({ ok: false, status: "KORRUPT", locked: true, readOnly: true, role: "ADMIN", reason: reason || "Ej initierad." }),
      subscribe: () => () => {},
      setRole: () => ({ ok: false }),
      resetDemo: () => ({ ok: false }),
      trySave: () => ({ ok: false }),

      can: () => false,

      listUsers: () => [],
      createUser: () => ({ ok: false }),
      updateUser: () => ({ ok: false }),
      setUserActive: () => ({ ok: false }),

      listItems: () => [],
      queryItems: () => [],
      createItem: () => ({ ok: false }),
      updateItem: () => ({ ok: false }),
      archiveItem: () => ({ ok: false }),
      deleteItem: () => ({ ok: false })
    };
  }

  // Om 03-store redan laddats -> exponera samma instans under kompatibel path
  if (window.FreezerStore) {
    window.FreezerStoreFacade = window.FreezerStore;
    // Valfri alias (om äldre kod gjort window.FreezerStoreDirect)
    window.FreezerStoreDirect = window.FreezerStore;
    return;
  }

  // Annars: fail-closed facade (03-store måste laddas före denna fil)
  window.FreezerStoreFacade = buildFailClosed("FreezerStore saknas. Ladda UI/pages/freezer/03-store.js före UI/freezer-store.js.");
})();
