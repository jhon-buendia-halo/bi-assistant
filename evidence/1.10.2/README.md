# 1.10.2 — Light theme and open navigation drawer by default, remembered in the database (BA-168)

Tested on the web target (BA-156). **Desktop not run.** Two desktop-only scenarios were skipped on web (developer-settings "the desktop app offers to restart the backend…", diagnostics "captures live renderer failures…"), and the darwin desktop visual baseline was not regenerated.

| Artifact | Shows |
|---|---|
| [e2e-impact.md](e2e-impact.md) | Step 6: 4 new scenarios, 5 updated, 1 replaced, the web visual baseline regenerated on purpose. |
| [red-run.txt](red-run.txt) | The new and changed navigation and appearance scenarios failing first, for the right reasons (System default, collapsed drawer, no `/ui-preferences`). |
| [e2e-results.txt](e2e-results.txt) | Full web suite on the final code: 76 passed, 2 skipped (desktop only). |
| [backend-and-unit.txt](backend-and-unit.txt) | Backend 808/808 (4 new for the preferences service), frontend 145/145 (new preferences service tests). |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing, including the two new routes. |
| [application-shell-drawer-expanded-light.png](application-shell-drawer-expanded-light.png) | The new web baseline: a fresh install opens Light with the drawer expanded. |
