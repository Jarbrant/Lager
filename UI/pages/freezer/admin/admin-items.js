
/* ============================================================
AO-P0-ADMIN-MODULES-01 — Admin items placeholder (för att undvika 404)
FIL: UI/pages/freezer/admin/admin-items.js
Projekt: Freezer (UI-only / localStorage-first)

Syfte:
- P0: Eliminera 404 från admin/freezer.html (module-load)
- Exponera window.FreezerAdminItems.createController (för AO-12-koppling)
- Ingen storage • Ingen UX • XSS-safe

ESM:
- Laddas via <script type="module" ...>

============================================================ */

(function () {
  "use strict";

  try {
    if (!window.FreezerAdminItems) {
      window.FreezerAdminItems = {
        /**
         * Placeholder: används av admin/freezer.js när Items CRUD flyttas hit.
         * Returnerar ett minimal kontrakt så caller kan unmounta säkert.
         */
        createController: function createController() {
          return {
            mount: function () {},
            render: function () {},
            unmount: function () {}
          };
        }
      };
    }
  } catch {
    // fail-soft
  }
})();

