# Questions to Insights

Desktop application (Electron) with an Angular frontend and a NestJS backend.

```
frontend/   Angular app (Electron renderer) + Electron main process
backend/    NestJS API
```

## Model usage: plan vs. execute

For planning purposes, Fable creates the plan.

For execution, do not pin a fixed model. Once the execution plan is well defined, the session LLM picks whichever model version it judges best for the work at hand (capability vs. speed vs. cost for that plan) and runs the plan with it.

Execute by fanning out: split the plan into independent units of work and dispatch them to parallel subagents (all agent calls for independent units go out in a single message so they run concurrently). Keep sequential only what genuinely depends on a previous result. The session LLM chooses the model per subagent the same way — cheap/fast models for mechanical or narrow-scope units, stronger models for units needing design judgment or cross-file reasoning.

## Frontend — Angular (Electron desktop app)

This is a **desktop application**: Electron shell with the Angular app as renderer.

- Electron main process: `frontend/electron/main.cjs` (`titleBarStyle: 'hiddenInset'`, no nodeIntegration, contextIsolation on).
- **Single-app delivery**: the main process spawns the NestJS backend as a child process on startup (`ELECTRON_RUN_AS_NODE=1` + Electron's own binary, so packaged apps need no system Node) and kills it on quit. Backend listens on port 3000 (`BACKEND_PORT` env overrides); renderer reads `API_BASE_URL` from `src/app/core/config/api.config.ts`.
- `npm run electron` — production-style: builds backend + Angular (`--base-href ./` — required, absolute `/` base breaks asset loading over `file://`) and opens the app.
- `npm run electron:dev` — points the window at `ng serve` on http://localhost:4200 for live reload (run `npm start` first; backend spawns from `backend/dist` if built).
- `npm run electron:dist` — full package via electron-builder: stages backend (`scripts/stage-backend.sh` → `backend/release-staging` with dist + prod-only node_modules), bundles it as `extraResources`, output in `frontend/release/`. Note: `extraResources` needs the explicit second `node_modules` mapping in `package.json` — electron-builder silently drops node_modules otherwise.

### Versioning and releases

`frontend/package.json`'s `version` is the single source of truth (electron-builder reads it; `backend/package.json` is kept in lockstep). Installer filenames carry it via `build.artifactName`: `Questions-to-Insights-<version>-<os>-<arch>.<ext>` (e.g. `Questions-to-Insights-0.1.1-mac-arm64.dmg`, `…-win-x64.exe`).

**Versioning is automatic, building is manual.**

- `.github/workflows/version-on-merge.yml` runs on every push to the default branch (`implement-empty-layout`, plus `main`): it derives the bump from the Conventional Commit subjects since the last `v*` tag (`BREAKING CHANGE` or `type!:` → major, `feat:` → minor, otherwise patch), writes the new version into both `package.json` + lockfiles, commits `chore(release): vX.Y.Z` and pushes the tag. It builds nothing; the run summary tells you which tag to build. Its own bump commit is filtered out of the trigger (`if: !startsWith(head_commit.message, 'chore(release):')`) and a `version-on-merge` concurrency group serializes back-to-back merges.
- `.github/workflows/build-desktop.yml` builds installers on demand: **Actions → Build desktop installers → Run workflow**. Each platform is its own checkbox — `windows_x64`, `macos_arm64`, `macos_x64`, all defaulting to true — so any combination is buildable and a run costs one runner per ticked box. The other inputs are `ref` (the tag/branch/SHA to build, usually the `vX.Y.Z` the merge produced) and `publish` (attach the installers to that tag's GitHub release). A hand-pushed `v*` tag carries no inputs, which the `prepare` job reads as "build everything"; unticking every box fails the run with a clear message. `prepare` turns the ticked boxes into the job matrix (`{"include":[…]}`). Because publishing uploads with `--clobber`, separate per-platform runs accumulate on the same release instead of replacing each other.
- **Publishing does not need an existing tag.** `prepare` checks out the ref and resolves the tag itself: a `v*` ref publishes to that tag, anything else (branch, SHA, empty) takes the version committed at that ref (`frontend/package.json`) and walks the patch level up until it finds a tag no other commit owns — so building `main` twice gives `v0.13.0` then `v0.13.1` instead of clobbering a shipped release. `gh release create --target <sha>` creates the tag at the built commit, so no tag is pushed unless the build succeeded, and the `Stamp the resolved version` step writes the resolved version into both `package.json`s before building so the installer filename always matches the tag.
- The default branch must allow pushes from `github-actions[bot]` (version commit + tag). Protected-branch rules need a bypass for it, otherwise the version job fails at push.
- Tags pushed by `GITHUB_TOKEN` do not trigger other workflows — that is what keeps merge-time tagging from kicking off builds.

### Architecture: feature-based

All frontend code follows this feature-based structure. Every feature gets its own folder under `src/app/features/` containing everything that belongs to it (pages, components, services, models, store, routes).

```
frontend/src/
├── app/
│   ├── features/
│   │   ├── users/
│   │   │   ├── pages/
│   │   │   │   ├── user-list/
│   │   │   │   │   ├── user-list.ts
│   │   │   │   │   ├── user-list.html
│   │   │   │   │   └── user-list.scss
│   │   │   │   └── user-detail/
│   │   │   ├── components/
│   │   │   │   ├── user-card/
│   │   │   │   └── user-form/
│   │   │   ├── services/
│   │   │   │   └── users.service.ts
│   │   │   ├── models/
│   │   │   │   └── user.model.ts
│   │   │   ├── store/
│   │   │   │   └── users.store.ts
│   │   │   └── users.routes.ts
│   │   ├── orders/
│   │   │   ├── pages/
│   │   │   ├── components/
│   │   │   ├── services/
│   │   │   ├── models/
│   │   │   ├── store/
│   │   │   └── orders.routes.ts
│   │   └── payments/
│   │       └── ...
│   ├── core/
│   │   ├── auth/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   ├── api/
│   │   └── config/
│   ├── shared/
│   │   ├── components/
│   │   ├── directives/
│   │   ├── pipes/
│   │   └── utils/
│   ├── app.routes.ts
│   └── app.config.ts
└── main.ts
```

(`users/`, `orders/`, `payments/` above are examples — actual features are whatever this project needs.)

### Rules

- **New feature = new folder in `src/app/features/<feature>/`** with `pages/`, `components/`, `services/`, `models/`, `store/` as needed and a `<feature>.routes.ts` lazy-loaded from `app.routes.ts`.
- **Pages vs components**: `pages/` are routed views; `components/` are feature-internal building blocks. Each lives in its own folder with `.ts` / `.html` / `.scss` files.
- **`core/`**: app-wide singletons — auth, guards, interceptors, API clients, config. Loaded once, never imported by other features' templates.
- **`shared/`**: reusable presentational components, directives, pipes, utils. No feature logic, no services with state.
- Standalone components + signals (no NgModules). Styling with Tailwind CSS (v4 via `@tailwindcss/postcss`); icons via `lucide-angular`.

## Backend — NestJS

### Application datastore (SQLite)

Mirrored from data-readiness-agent (its ADR-0027 pattern): a small `DocStore<T>` interface (`src/infrastructure/database/doc-store.ts`) with a better-sqlite3 adapter (`sqlite-doc-store.ts`) — one table per collection, each row one JSON document, filters/sorts evaluated in-process. `DatabaseModule` (`database.module.ts`) is `@Global()` and exposes one injection token per collection (e.g. `CONNECTIONS_STORE`); repositories inject the token, never the db handle.

- SQLite file: `<APP_DATA_DIR>/app.sqlite`. The Electron main process sets `APP_DATA_DIR` to `app.getPath('userData')`; standalone backend runs fall back to `<cwd>/data`.
- New collection = add `{ token, table }` to `COLLECTIONS` in `database.module.ts` + a token in `doc-store.ts`.
- better-sqlite3 loads fine under `ELECTRON_RUN_AS_NODE` with the current Electron/Node pairing — if an ABI error ever appears after upgrades, rebuild it for Electron.
- **Renaming a collection needs a migration.** `SqliteDocStore` creates a table when it is missing, so a renamed collection silently starts empty on an existing install. `LEGACY_TABLE_NAMES` in `database.module.ts` renames the table before the stores are built — that is where the `projects` → `sessions` and `sandbox_selections` → `datasets` renames live. The same hazard applies to persisted *document fields*: `LEGACY_DOC_FIELDS` (also `database.module.ts`) rewrites session `sandboxes` → `datasets` in raw SQL — repository-side rewrites restamp `updatedAt` and would flatten the session list's recency ordering, so prefer this for fields on a sorted collection; `VerifiedQueriesRepository.onModuleInit` rewrites `sourceProjectId` → `sourceSessionId`, and `renameLegacyWorkspaceDirectories` in `mastra/session-workspaces.ts` renames `workspaces/project-<id>` → `workspaces/session-<id>`. Both migrations are covered by `database.module.spec.ts`.

### Agentic harness (Mastra)

`backend/src/mastra/` is the backbone (mirrored from data-readiness-agent's ADR-0007/0010 pattern): `index.ts` builds the standalone Mastra instance (agents registered there), `mastra.service.ts` is a thin DI wrapper (`MastraService.getAgent(id)`) that keeps the rest of the backend Mastra-agnostic, and `model-resolver.ts` bridges DI-less agents to persisted LLM settings — each agent's `model` is `async () => resolveAgentModel()`, and `LlmService.onModuleInit` installs the real resolver (decrypted key; LenAI → OpenAI-compatible config with `url`). No settings saved → falls back to `openai/gpt-4o-mini` via env `OPENAI_API_KEY`. New agent = file in `mastra/agents/` + registration in `index.ts`. Agent memory uses `@mastra/memory` with persistent LibSQL storage at `<APP_DATA_DIR>/mastra.sqlite` (falling back to `<cwd>/data/mastra.sqlite` outside Electron). Each session ID is an isolated memory thread/resource, and existing session transcripts are bootstrapped on their first post-migration turn. Every session also owns a contained, filesystem-backed Mastra workspace under `<APP_DATA_DIR>/workspaces/session-<session-id>`; workspaces are registered on creation and rediscovered when the backend or Mastra Studio restarts.

### Interactive visuals (tailoring loop)

Visuals are conversation participants, not side artifacts. `backend/src/modules/sessions/visualization.service.ts` owns create/update/revert/load/download; `SessionsService` orchestrates and persists metadata + chat events.

- **Tools on the assistant**: `create_visual` (from an answer, latest by default) and `update_visual` (tailor the visual open in the right panel, or a given `visualId`). Both run the `visualization` designer agent as a sub-call with the current bundle + the answer's captured `data` rows + the instruction, and return `{visualId, version, title}`. requestContext carries `session-id` and `active-visual-id`; the per-turn system block lists every visual (id, title, current version) and which one is open.
- **Versioning**: files live at `visuals/<id>/v<N>/` (`index.html`, `body.html`, `styles.css`, `script.js`, `manifest.json`). Visuals created before versioning keep v1 at `visuals/<id>/` — `resolveVersionDir` handles that. `SessionVisualization.currentVersion` + `versions[]`; revert only moves the pointer (`POST /sessions/:id/visualizations/:vid/revert`). `GET …/visualizations/:vid?version=N` loads any version.
- **Chat events**: turns that create/update/revert a visual persist an assistant message with a `visual` field (rendered as a card); the SSE stream emits `visual-updated` so the panel refreshes live.
- **Readable frame**: `visualization-document.ts` wraps the agent's visual in a fixed, `qti-`-namespaced frame — title → question → visual → takeaway (designer description) → analysis (assistant answer, markdown via `marked` + `sanitize-html`) → collapsible data provenance (SQL, row counts, first 10 rows) → footer (source entities, session, version, date). The context comes from the session transcript (`contextFor`), never from the designer model, so readability does not depend on LLM output. Panel iframe and exported `index.html` share the frame; exports also ship `answer.md` and `data.json`.
- **Validation**: generated JavaScript is parse-checked (`new Function`, compile only) and retried once with the error; the sandboxed iframe reports runtime errors to the host via `postMessage` (`visual-error`) and the panel shows a banner.
- **Model**: `VISUAL_MODEL` env forces the designer model; otherwise gpt-5/o-series configured models are swapped for `openai/gpt-4.1-mini` (LenAI deployments are kept).
- **Frontend gotcha**: `SessionChat` re-syncs from its `session` input only when the session **id** changes — same-id refreshes (visual metadata) must not abort an in-flight stream.

### Architecture: feature-based modules

All backend code follows this feature-based structure. Every new feature gets its own module folder under `src/modules/` containing everything that belongs to that feature (module, controller, service, DTOs, entities, repositories).

```
backend/src/
├── modules/
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.controller.ts
│   │   ├── users.service.ts
│   │   ├── dto/
│   │   │   ├── create-user.dto.ts
│   │   │   └── update-user.dto.ts
│   │   ├── entities/
│   │   │   └── user.entity.ts
│   │   └── repositories/
│   │       └── users.repository.ts
│   ├── orders/
│   │   ├── orders.module.ts
│   │   ├── orders.controller.ts
│   │   ├── orders.service.ts
│   │   ├── dto/
│   │   ├── entities/
│   │   └── repositories/
│   └── payments/
│       ├── payments.module.ts
│       ├── payments.controller.ts
│       ├── payments.service.ts
│       └── ...
├── common/
│   ├── decorators/
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   ├── pipes/
│   └── exceptions/
├── infrastructure/
│   ├── database/
│   ├── messaging/
│   ├── cache/
│   └── external-services/
├── config/
│   ├── app.config.ts
│   └── database.config.ts
├── app.module.ts
└── main.ts
```

(`users/`, `orders/`, `payments/` above are examples — actual modules are whatever features this project needs.)

### Rules

- **New feature = new folder in `src/modules/<feature>/`** with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, plus `dto/`, `entities/`, `repositories/` subfolders as needed.
- **`common/`**: cross-cutting NestJS building blocks only (decorators, guards, interceptors, filters, pipes, exceptions). No feature logic.
- **`infrastructure/`**: technical concerns — database, messaging, cache, external service clients. Feature modules depend on infrastructure, never the reverse.
- **`config/`**: typed configuration files (e.g. `app.config.ts`, `database.config.ts`).
- Feature modules are registered in `app.module.ts` imports.
