# 1.8.8 — Align with the Insight Agent AI Figma design (BA-158)

Reference: Figma file `qW41gtAbnTcqoqpEKajqZX`, Chat frame `2154:31891` ([figma-chat-frame.png](figma-chat-frame.png), rendered by the Figma MCP). Web target, 2026-10-09, isolated compose project `qti-ba-141` on port 55433.

| Artifact | Shows |
|---|---|
| [side-by-side-figma-vs-app.png](side-by-side-figma-vs-app.png) | The Figma frame (left) and the running app (right) at the same height. The differences are intended: the name "Agentic Hub" (kept), the app's own rail items, the answer content (the E2E stub has no table), and the Careful / Deep analysis controls in the prompt. |
| `chat-{light,dark}.png` | The session chat with the drawer collapsed and the details panel closed. |
| `chat-drawer-open-{light,dark}.png` | The rail expanded into the 240 px drawer, with labels and the session list. |
| [e2e-results.txt](e2e-results.txt) | Full web suite: 45 passed, 2 skipped (desktop only). New `navigation.spec.ts` scenarios: "expands the rail into a drawer with labels and sessions" and "shows the details panel only on demand". Updated: the layout keyboard test (opens the panel first), the Appearance canvas colours, the `createWorldCupSession` helper (session name is now a heading), `agents.spec.ts` (the panel opens when a question is selected). The web visual baseline is regenerated. |
| [check-specs.txt](check-specs.txt) | `python3 scripts/check-specs.py` passing. |

Assets: the 19 Figma assets are saved in `frontend/public/brand/agentic-hub/`. The frame texture and banner photos are re-encoded from PNG to WebP at the same pixel size (8.4 MB → 0.5 MB). Generic UI icons stay `lucide-angular`.

Accessibility: Figma's `text/placeholder` (`rgba(0,0,0,.55)`) is 4.42:1 on the canvas and 4.00:1 on selected rows, so `fg-muted` uses `.6`. Placeholders keep `.55`.

Unit tests: frontend `ng test` 89/90. The failure (`App should support keyboard resizing`) also fails on unchanged `main`. Two app tests open the panel first, since it's closed on launch.

**Desktop not run:** `developer-settings.spec.ts` › the desktop app offers to restart the backend, and `diagnostics.spec.ts` › captures live renderer failures…. The Electron window colours (`THEME_CANVAS`) are only type-checked.
