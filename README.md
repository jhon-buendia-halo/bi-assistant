# Questions to Insights

Ask questions of your data in plain language and get answers, SQL, and interactive visuals back. It ships as a desktop app (Halo BI Assistant) and as an npm package that runs the same app in your browser.

## Run it with npx

Requirements: Node.js >= 22.13.0 and npm.

The package is published to GitHub Packages, and the repo is private. Create a GitHub personal access token (classic) with the `read:packages` scope, and authorize it for SSO if your organization requires it. Then add this to `~/.npmrc`:

```
@jhon-buendia-halo:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<GITHUB_TOKEN with read:packages>
```

Run it:

```bash
npx @jhon-buendia-halo/questions-to-insights
```

Or install it globally:

```bash
npm i -g @jhon-buendia-halo/questions-to-insights
questions-to-insights
```

The command prints the URL and the data directory, and opens your browser. Press Ctrl+C to stop.

| Flag | Default | Description |
| --- | --- | --- |
| `--port <n>` | `3000` | Port to listen on. If the default is busy it falls back to a free port. An explicit busy port exits with code 1. |
| `--host <h>` | `127.0.0.1` | Interface to bind. |
| `--data-dir <path>` | `$QTI_DATA_DIR`, then `$APP_DATA_DIR`, then `~/.questions-to-insights` | Where app data is stored. |
| `--no-open` | | Do not open the browser. |
| `-h`, `--help` | | Show help. |
| `-v`, `--version` | | Show the version. |

The native modules (`better-sqlite3`, DuckDB, libsql) ship prebuilt binaries for supported Node versions. If npm starts compiling them, your Node version is unsupported or a build toolchain is missing.

## Where data lives

The data directory holds:

- `app.sqlite`: settings and datasources (credentials are encrypted).
- `mastra.sqlite`: agent memory.
- `observability.duckdb`: agent observability data.
- `workspaces/`: one workspace per session.
- `.app-secret`: the key that encrypts stored API keys.

Back up `.app-secret` together with the rest of the directory. If you lose it, stored keys become unreadable.

Web mode deliberately uses a different data directory from the desktop app, so both can run at the same time without SQLite lock conflicts.

## First run

1. Open Settings in the UI and configure the LLM provider: an OpenAI or Anthropic key, a LenAI-compatible endpoint, or your own model server (see [Custom LLM endpoint](#custom-llm-endpoint)).
2. Add a datasource (PostgreSQL or Databricks).

If no LLM settings are saved, the backend falls back to `openai/gpt-4o-mini` using the `OPENAI_API_KEY` environment variable.

## Custom LLM endpoint

Besides OpenAI, Anthropic and LenAI, Settings → **LLM Configuration** offers the provider **Custom endpoint**. Use it for any model server that speaks the OpenAI chat-completions API or the Anthropic Messages API: a local server such as Ollama, LM Studio or vLLM, a proxy such as LiteLLM, or a hosted Anthropic-compatible relay. The full rules are R44 to R54 of [specs/capabilities/llm-settings/spec.md](specs/capabilities/llm-settings/spec.md).

### The fields

| Field | What to enter |
| --- | --- |
| **API style** | **OpenAI-compatible** (the default) or **Anthropic-compatible**: the API your server speaks. |
| **Base URL** | Required, an absolute `http` or `https` URL. Any host is accepted, including `localhost` and private addresses. Its form depends on the API style (below). |
| **API key (optional)** | Leave blank if the server needs none. A typed key is stored encrypted and only ever shown masked. |
| **Model** | The model name the server expects. Type it, or pick it after **Load models**. |
| **Reasoning effort** | The levels follow the model name, as for the other providers (see **Requirements and limits** below). |

Then click **Test connection**, and **Save connection** once the test passes. The new-session composer shows the saved model as `<model> · <endpoint host>`, and the agent catalogue and the agent page name the provider "Custom endpoint".

### Base URL rules

| API style | Base URL to enter | Requests go to | Key sent as |
| --- | --- | --- | --- |
| OpenAI-compatible | Include the version path, e.g. `http://127.0.0.1:8317/v1` | `<base URL>/chat/completions`, models from `<base URL>/models` | `Authorization: Bearer <key>` |
| Anthropic-compatible | The server root, e.g. `http://127.0.0.1:8317` | `<base URL>/v1/messages`, models from `<base URL>/v1/models` | `x-api-key: <key>`, plus `anthropic-version: 2023-06-01` |

- Trailing slashes are removed in both styles.
- In the OpenAI style the URL is used as given: `http://127.0.0.1:8317` without `/v1` is not corrected, and the server usually answers 404.
- In the Anthropic style the app appends `/v1`; a URL that already ends in `/v1` is accepted as is, so `http://127.0.0.1:8317/` and `http://127.0.0.1:8317/v1/` both call `http://127.0.0.1:8317/v1/messages`.

### The API key

The key is optional. When the field is blank:

- if the saved configuration is already a Custom endpoint with a key, that key is reused, even if you changed the base URL or the API style;
- otherwise the server is called with no credential header at all, and saving stores no key.

A key saved for OpenAI, Anthropic or LenAI is never sent to a custom endpoint, and a custom key is never sent to a public provider: switching back to OpenAI, Anthropic or LenAI asks for that provider's key again. To give a keyless configuration a key, type it and save.

### Load models

**Load models**, beside the Model box, asks the server for its model list before you save anything (`GET <models URL>` from the table above, with that style's headers; nothing is stored). It is enabled once a base URL is entered. On success the Model box offers the listed names as a dropdown and still accepts any typed name. An empty list shows "The endpoint listed no models — type the model name." The list is whatever the server returns, so it may include models that cannot chat (embeddings). The request gives up after 15 seconds. Servers without a model list, common among Anthropic-compatible relays, fail here; type the model name instead.

### Examples

These are typical defaults; check the port and model names on your own server.

**Ollama** (`ollama serve`, then `ollama pull llama3.1:8b`)

| Field | Value |
| --- | --- |
| API style | OpenAI-compatible |
| Base URL | `http://localhost:11434/v1` |
| API key | blank |
| Model | `llama3.1:8b` (or Load models) |

**LM Studio** (start the local server in the Developer tab)

| Field | Value |
| --- | --- |
| API style | OpenAI-compatible |
| Base URL | `http://localhost:1234/v1` |
| API key | blank |
| Model | the loaded model's identifier (Load models lists it) |

**vLLM** (`vllm serve <model>`)

| Field | Value |
| --- | --- |
| API style | OpenAI-compatible |
| Base URL | `http://localhost:8000/v1` |
| API key | blank, or the value of `--api-key` if the server was started with one |
| Model | the served model name, e.g. `Qwen/Qwen2.5-7B-Instruct` (Load models lists it) |

**LiteLLM proxy** (serves both APIs on one port)

| Field | OpenAI-compatible | Anthropic-compatible |
| --- | --- | --- |
| API style | OpenAI-compatible | Anthropic-compatible |
| Base URL | `http://localhost:4000/v1` | `http://localhost:4000` |
| API key | the proxy's master or virtual key, if it has one | the same key (sent as `x-api-key`) |
| Model | a `model_name` from the proxy's config | a `model_name` from the proxy's config |

**Anthropic-compatible relay** (any server exposing `/v1/messages`)

| Field | Value |
| --- | --- |
| API style | Anthropic-compatible |
| Base URL | the relay's root, e.g. `https://relay.example.com` (not `.../v1/messages`) |
| API key | the relay's key, sent as `x-api-key` |
| Model | the model name the relay expects, e.g. `claude-sonnet-5-5`; type it if Load models finds no list |

### Requirements and limits

- The agents need **tool calling**. A server that cannot call tools still passes Test connection, which uses no tools, but then fails or answers without querying your data.
- Test connection asks for a small JSON reply. In the OpenAI style, a server that rejects the strict JSON-schema request (HTTP 400 or 422) is retried with a plain JSON-object request and then with no response format; the reply must still be `{ "status": "..." }`.
- Reasoning effort follows the model name. A name the app does not recognise is offered `low`, `medium` and `high`, and in the OpenAI style is sent `reasoning_effort`; a server that rejects that parameter fails the turn. Pick a model with a recognised name or a server that ignores unknown parameters.
- Test connection times out after 30 seconds and Load models after 15; a chat turn has no timeout of its own and runs until the server answers or you stop it.
- Very short keys (four characters or fewer, such as `none`) are shown whole by the mask; prefer leaving the field blank when the server needs no key.

### Troubleshooting

| Message | Likely cause | What to do |
| --- | --- | --- |
| `apiStyle must be one of: openai, anthropic` | No API style was sent. | Pick an API style. |
| `baseUrl is required for custom` | The Base URL box is empty. | Enter the server's URL. |
| `baseUrl must be an http or https URL` | The URL is relative, misspelled or uses another scheme. | Enter a full URL such as `http://localhost:11434/v1`. |
| `Could not reach <host> — check the base URL and that the server is running` | Connection refused, unknown host or reset. | Start the server; check host and port. From the desktop app, `localhost` means your own machine. |
| `The endpoint answered 404 at <url> — check the base URL (OpenAI-compatible servers usually end in /v1)` | Wrong path: usually an OpenAI-style URL without `/v1`, a model list the server does not offer, or the wrong API style. | Add `/v1` in the OpenAI style; use the root in the Anthropic style; check the API style. |
| `The endpoint rejected the API key (401)` or `(403)` | Missing, wrong or unauthorised key. | Type the correct key. Remember a blank field reuses a stored custom key. |
| `The endpoint is rate limiting requests (429) — try again later` | The server or proxy is throttling. | Wait, or raise the proxy's limits. |
| `Provider request failed (<status>) — <body>` | Any other HTTP error, e.g. an unknown model, or a server that rejects tools or `reasoning_effort`. | Read the body text; check the model name and the limits above. |
| `LLM request timed out after 30s` | Test connection got no answer in time (often a large model still loading). | Wait for the model to load and test again, or use a smaller model. |
| `Model list request timed out after 15s` | Load models got no answer in time. | Retry, or type the model name. |
| `The endpoint did not return a model list — type the model name instead` | The models URL answered, but not with an OpenAI-style `data` list. | Type the model name. |
| `Model answered but could not produce structured JSON output, which every agent here requires — reply="..."` | The model cannot return JSON even after the fallbacks. | Use a stronger or instruction-tuned model. |

The same connection messages appear as a chat turn's error when a saved custom endpoint becomes unreachable, answers 404 or rejects the key. Error messages never include your key or request headers.

## Desktop app

The Electron desktop app (Halo BI Assistant) is built for macOS (arm64, x64) and Windows (x64). Installers are produced by the "Build desktop installers" GitHub Actions workflow (`.github/workflows/build-desktop.yml`) and attached to GitHub releases. See [specs/system/delivery.md](specs/system/delivery.md) for the packaging details.

## Development

The repo has two projects: `frontend/` (Angular app and Electron main process) and `backend/` (NestJS API).

Setup:

```bash
(cd backend && npm ci)
(cd frontend && npm ci)
```

Run:

```bash
# Backend only: API on :3000, data in backend/data
cd backend && npm run start:dev

# Frontend: ng serve on :4200
cd frontend && npm start

# Desktop shell pointed at ng serve (run npm start first)
cd frontend && npm run electron:dev

# Full web mode locally (builds the UI into the backend, then runs the CLI)
cd backend && npm run build:all && npm run start:web
```

Test:

```bash
cd backend && npm test        # jest
cd frontend && npm test       # karma
cd frontend && npm run test:e2e   # Playwright driving the web app (default target)
cd frontend && npm run test:e2e:desktop   # the real Electron app, only on request
```

To see traces, metrics and logs of your local runs in Phoenix and Grafana, follow [docs/observability.md](docs/observability.md). It is off by default.

The e2e suite needs the seeded World Cup Postgres. The suite starts it through Docker (`docker compose up -d postgres` at the repo root). Set `E2E_SKIP_DOCKER=1` only when an equivalent database is already running; the specs that need it still run.

### Claude Code mod: the workflow pane

Working on this repo in Claude Code? The `workflow-steps` mod in `.claude/mods/` opens a **Workflow** pane listing the eleven-step workflow from [CLAUDE.md](CLAUDE.md). The committed `.claude/settings.json` registers this repository as a plugin marketplace and enables the mod, so Claude Code offers to install it when you trust the folder. To install it by hand, or to load it for one session while changing it:

```bash
claude plugin marketplace add jhon-buendia-halo/bi-assistant && claude plugin install workflow-steps@bi-assistant
claude --plugin-dir .claude/mods/workflow-steps      # one session, hot-reloads on save
```

`/workflow` opens the pane at any terminal width. Details: [specs/system/delivery.md](specs/system/delivery.md) §9.

## Releasing

Versioning is automatic and building is manual.

- **Version bump**: on every push to the default branch, `.github/workflows/version-on-merge.yml` derives the bump from Conventional Commit subjects since the last `v*` tag (`BREAKING CHANGE` or `type!:` is major, `feat:` is minor, anything else is patch). It commits `chore(release): vX.Y.Z` and pushes the tag. It builds nothing.
- **Desktop installers**: run Actions, then "Build desktop installers", then Run workflow. Pick the platforms, set `ref` (usually the new `vX.Y.Z` tag), and choose whether to `publish` to the release.
- **npm package**: run Actions, then "Publish npm package" (`.github/workflows/publish-npm.yml`). Inputs are `ref` (usually the `vX.Y.Z` tag) and `dry_run`.

## Architecture

An Angular renderer (inside Electron, or served by the backend in web mode) talks to a NestJS API. The API uses a Mastra agent harness for the assistant and visual designer agents, and a SQLite document store for application data. The npm package is the backend with the built Angular app bundled in. The full specification (modules, data model, API, agents, UI, versioning and release) is in [`specs/`](specs/README.md).
