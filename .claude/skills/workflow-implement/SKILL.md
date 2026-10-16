---
name: workflow-implement
description: Use at workflow step 8 when writing production code in frontend/ or backend/ (the code rules that bite), and before starting the app or the Postgres compose stack for anyone, especially from a worktree (ask the target, check ports, stop by PID).
---

# Step 8 — Implement, and run the app locally

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core (the mandatory first action, the step list, the fast loop and acceptance gate, the hard gates). Load this skill before the step starts.

## The step

8. **Implement changes** — production code, built against the Acceptance criteria and the step-5 Gherkin. It runs in the fast loop, before steps 6 and 7.

## Code rules — the short list to keep in mind while coding

How the app is built and works is in [specs/system/](../../../specs/system/): [tech-stack.md](../../../specs/system/tech-stack.md) (frameworks, versions, folder layout), [delivery.md](../../../specs/system/delivery.md) (scripts, packaging, npm package, versioning, release), [data-model.md](../../../specs/system/data-model.md), [api.md](../../../specs/system/api.md), [agents.md](../../../specs/system/agents.md), [ui.md](../../../specs/system/ui.md). The rules below are the ones that bite when ignored.

### Frontend (Angular renderer + Electron main)

- **Feature-based folders.** New feature = `src/app/features/<feature>/` with `components/`, `services/`, `models/` (and `pages/`, `store/`, a lazy `<feature>.routes.ts` once routing exists). `core/` holds app-wide singletons, `shared/` presentational pieces with no feature logic. Full tree and current state: [tech-stack.md](../../../specs/system/tech-stack.md).
- Standalone components + signals, no NgModules. Tailwind CSS v4, `lucide-angular` icons.
- Electron builds use `--base-href ./`. An absolute `/` base breaks asset loading over `file://`.
- Electron IPC goes only through `frontend/electron/preload.cjs` (`contextBridge`); keep `contextIsolation` on and `nodeIntegration` off.
- `SessionChat` re-syncs from its `session` input only when the session **id** changes. Same-id refreshes (visual metadata) must not abort an in-flight stream.
- **Known gap:** under `file://` the renderer hardcodes `http://localhost:3000`, so a non-default `BACKEND_PORT` breaks the desktop renderer. Tracked as roadmap 1.7.20 ([BA-109](https://halo-powered.atlassian.net/browse/BA-109)).

### Backend (NestJS)

- **Feature-based modules.** New feature = `src/modules/<feature>/` with `<feature>.module.ts`, controller, service and `dto/`, `entities/`, `repositories/` as needed, registered in `app.module.ts`. Technical concerns go in `infrastructure/`; feature modules depend on it, never the reverse.
- **New collection** = add `{ token, table }` to `COLLECTIONS` in `database.module.ts` and a token in `doc-store.ts`. Repositories inject the token, never the db handle.
- **Renaming a collection or a persisted field needs a migration**, or existing installs silently start empty: `LEGACY_TABLE_NAMES` for tables, `LEGACY_DOC_FIELDS` for fields on sorted collections (raw SQL, so `updatedAt` is not restamped), covered by `database.module.spec.ts`. Record it in [data-model.md](../../../specs/system/data-model.md).
- **New agent** = a file in `src/mastra/agents/` plus registration in `src/mastra/index.ts`, and an entry in [agents.md](../../../specs/system/agents.md). Its `model` is `async () => resolveAgentModel()`; never hardcode a provider.
- `APP_DATA_DIR` is read at import time by `database.module.ts` and `mastra/storage.ts`, so it must be set before the app module is imported (the CLI does this).

## Worktree deploy convention — always ask which target

**When work happens in a git worktree (any path under `.claude/worktrees/`), do not silently run against shared state.** Before starting the app or the Postgres compose stack from a worktree, ask: *run against the shared data dir / main compose stack, or an isolated one for this worktree?* The Electron app and the `npx` CLI default to shared data dirs (`userData`, `~/.questions-to-insights`) and backend port 3000; the compose Postgres uses project name `questions-to-insights-world-cup` and port 55432, and its opt-in `observability` profile adds ports 6006, 3001, 4317 and 4318 — a second instance collides unless isolated (CLI `--data-dir` and `--port`; desktop `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR`; `docker compose -p <name>` with `WORLD_CUP_DB_PORT` and the observability port variables). A second *desktop* instance can't run on another port until roadmap 1.7.20 (BA-109) lands, so use the CLI for side-by-side runs. Details: [specs/system/delivery.md](../../../specs/system/delivery.md). Skip the question only when the user has already named the target in the same turn. Merging the worktree back goes through `sync_with_base_branch` / a PR, never a silent push.

**Local test deploys: check the default ports first, and never commit deploy tweaks.** Before starting the app for the user to try, list what is already listening (`ss -ltnp`, `docker ps`) on the default ports: backend 3000, Postgres 55432, observability 6006, 3001, 4317 and 4318. The shared World Cup Postgres on 55432 is the database the app expects, so it is reused, not a conflict. For any other default port in use, start the app on a free port through flags or environment variables only (CLI `--port` and `--data-dir`, `PORT`, `WORLD_CUP_DB_PORT`, the observability port variables). If running locally needs a change to a tracked file, keep that change out of every commit and revert it once the user is done testing. Report the URL, port, data dir and PID, and stop the process by that PID, never with `pkill -f`.
