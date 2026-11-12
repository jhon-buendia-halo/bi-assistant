# 1.7.21 — E2E impact (step 6)

Reviewed 2026-11-11. The diff touches the Electron main process (`frontend/electron/`), the backend entry (`backend/src/main.ts`), `createApp` (`backend/src/app-bootstrap.ts`, a response header only when `instanceId` is given) and the Windows installer script. The web target starts the backend through the CLI, which passes no `instanceId`, so no web flow changes; one app-shell spec is re-run as a smoke test of the `createApp` change.

| Spec | Decision | Scenarios |
|---|---|---|
| `frontend/e2e/navigation.spec.ts` | re-run | Feature: Navigation rail (all scenarios), as a smoke test of `createApp` |

Other tests:

- **Added, API level:** `backend/test/desktop-shell.e2e-spec.ts`: the backend echoes `BACKEND_INSTANCE_ID` as `X-Backend-Instance`, sends no header without it, and exits once its `DESKTOP_PARENT_PID` process is gone. Fails on the base commit.
- **Added, unit:** `backend/src/infrastructure/process/parent-watchdog.spec.ts` (Jest) and `frontend/electron/stale-backend.test.cjs` (`node --test`).
- **Desktop not run (Playwright):** the new app-shell scenario "Focuses the running app instead of opening a second one" stays under `E2E: none yet`. The desktop target needs port 3000, which another worktree holds. It is covered instead by `desktop-lifecycle.mjs` in this folder, run against the real Electron app (`desktop-lifecycle.txt`, 11/11).
