---
name: verify
description: How to verify a change in the running web app (build, launch an isolated CLI instance, drive it in Chromium with Playwright).
---

# Verify in the running web app

1. Build: `npm --prefix backend run build:all` (backend dist + web UI in `backend/public`).
2. Launch an isolated instance on free ports with a throwaway data dir (copy a real data dir to test migrations on real data):
   `node backend/dist/cli.js --no-open --port 3400 --data-dir <tmp>/verify-data --intellify-api-port 3420`
   Never use 3000 or a port another app/session runs; stop it by its task/PID afterwards.
   RFP Builder / Intellify API flows need its database loaded and the app restarted first: see the `intellify-api` skill.
3. Drive it with Playwright from Node, resolving the package from the frontend:
   `const { chromium } = require(require.resolve('playwright', { paths: ['<worktree>/frontend'] }))`.
   No sign-in exists (ADR-0030): `page.goto(url)` lands on the welcome page.
   - Rail buttons: scope to `getByRole('complementary', { name: 'Navigation rail' })` (the welcome page also has "Agents"/"Datasets" buttons).
   - Sessions list: `getByRole('navigation', { name: 'Sessions', exact: true })`; rows `li[data-testid^="session-"]`.
   - New conversation: `header` → "Start New Conversation"; agent picker `data-testid="new-session-agent"`.
   - Workflow bar `data-testid="workflow-bar"`, Details `workflow-details-toggle` (opens on the current step; there is no separate note link).
   - Right panel: `getByRole('complementary', { name: 'Details panel' })`, history menu `button[title="Shown in this session"]`, items `.menu-item`.
   - Visual frame: `page.frames()` gives the sandboxed iframe; `frame.evaluate` reads its `data-theme`.
   - Theme: switch through Settings → Appearance radios; the saved preference wins over `emulateMedia`.
4. A real agent turn uses the data dir's saved LLM settings (live model calls). Poll `data-testid="skill-step"` and the Thinking block while it streams.
5. Gotchas: `addInitScript` also runs inside the sandboxed visual iframe (localStorage SecurityError there is the script, not the app); the worktree sandbox refuses compound shell commands — write scripts to files and run them plainly.
