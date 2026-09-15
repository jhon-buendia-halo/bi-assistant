# Questions to Insights

Desktop application (Electron) with an Angular frontend and a NestJS backend.

```
frontend/   Angular app (Electron renderer) + Electron main process
backend/    NestJS API
```

## Frontend — Angular (Electron desktop app)

This is a **desktop application**: Electron shell with the Angular app as renderer.

- Electron main process: `frontend/electron/main.cjs` (`titleBarStyle: 'hiddenInset'`, no nodeIntegration, contextIsolation on).
- **Single-app delivery**: the main process spawns the NestJS backend as a child process on startup (`ELECTRON_RUN_AS_NODE=1` + Electron's own binary, so packaged apps need no system Node) and kills it on quit. Backend listens on port 3000 (`BACKEND_PORT` env overrides); renderer reads `API_BASE_URL` from `src/app/core/config/api.config.ts`.
- `npm run electron` — production-style: builds backend + Angular (`--base-href ./` — required, absolute `/` base breaks asset loading over `file://`) and opens the app.
- `npm run electron:dev` — points the window at `ng serve` on http://localhost:4200 for live reload (run `npm start` first; backend spawns from `backend/dist` if built).
- `npm run electron:dist` — full package via electron-builder: stages backend (`scripts/stage-backend.sh` → `backend/release-staging` with dist + prod-only node_modules), bundles it as `extraResources`, output in `frontend/release/`. Note: `extraResources` needs the explicit second `node_modules` mapping in `package.json` — electron-builder silently drops node_modules otherwise.

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

### Agentic harness (Mastra)

`backend/src/mastra/` is the backbone (mirrored from data-readiness-agent's ADR-0007/0010 pattern): `index.ts` builds the standalone Mastra instance (agents registered there), `mastra.service.ts` is a thin DI wrapper (`MastraService.getAgent(id)`) that keeps the rest of the backend Mastra-agnostic, and `model-resolver.ts` bridges DI-less agents to persisted LLM settings — each agent's `model` is `async () => resolveAgentModel()`, and `LlmService.onModuleInit` installs the real resolver (decrypted key; LenAI → OpenAI-compatible config with `url`). No settings saved → falls back to `openai/gpt-4o-mini` via env `OPENAI_API_KEY`. New agent = file in `mastra/agents/` + registration in `index.ts`. Agent memory uses `@mastra/memory` with persistent LibSQL storage at `<APP_DATA_DIR>/mastra.sqlite` (falling back to `<cwd>/data/mastra.sqlite` outside Electron). Each project ID is an isolated memory thread/resource, and existing project transcripts are bootstrapped on their first post-migration turn. Every project also owns a contained, filesystem-backed Mastra workspace under `<APP_DATA_DIR>/workspaces/project-<project-id>`; workspaces are registered on creation and rediscovered when the backend or Mastra Studio restarts.

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
