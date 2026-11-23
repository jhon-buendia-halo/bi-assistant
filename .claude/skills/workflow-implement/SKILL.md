---
name: workflow-implement
description: Use at workflow step 8 when writing production code in frontend/ or backend/ (the code rules that bite, and the lean lane a builder agent follows).
---

# Step 8 — Implement

Step 8 of [`workflow-strict`](../workflow-strict/SKILL.md) and step 3 of [`workflow-free-style`](../workflow-free-style/SKILL.md). Load this skill before the step starts.

## The step

8. **Implement changes** — production code, built against the Acceptance criteria and the step-5 Gherkin. It runs in the story lane, before steps 6 and 7.

   **Lean lane for a builder.** Start from the story pack (`node scripts/story-pack.mjs <id>`), not from exploring the repo. Write the code, its unit tests, for a UI story **one** Playwright scenario (`@demo @story-<id>`), and only the spec lines the change makes false. Run only `npx jest --findRelatedTests <files>` (backend), the touched frontend specs, and your own Playwright file (3 workers once 1.23.32 lands). No axe scans, no screenshots in two themes, no evidence, no demo and no `qa.mjs`, unless the brief asks; the lead's wave check does those. Keep output quiet (Jest `--silent`, Playwright `--reporter=dot`, builds to a log file; read back the summary or failure block). Read ranges, not whole files over 500 lines: `grep -n` or [specs/INDEX.md](../../../specs/INDEX.md) first.

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

Starting the app or the compose stack, for anyone: [`local-instance`](../local-instance/SKILL.md).
