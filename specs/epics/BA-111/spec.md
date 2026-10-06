# BA-111 — Local Development Observability

- **Jira:** [BA-111](https://halo-powered.atlassian.net/browse/BA-111) · **Roadmap:** Milestone 0.3 · **Status:** Draft

## Goal

A developer can see what the backend and the agents are doing in one local view: agent and LLM traces, HTTP and database traces, metrics, and logs linked to their traces. They switch it on with a Developer toggle in Settings. With the toggle off, which is the default, the app behaves exactly as it does today for end users.

## Scope

- **Developer settings section.** A fourth Settings row, "Developer", after Datasources, LLM and Testing data, visible in every build. It holds:
  - a "Developer observability" toggle, off by default;
  - an editable Phoenix endpoint (default `http://localhost:6006`) and OTLP endpoint (default `http://localhost:4318`), each with a "Test connection" status;
  - a "Restart to apply" notice when the saved values differ from the ones the backend started with, with a Restart button in the desktop app.
- **Restart to apply.** The setting is saved at once and takes effect the next time the backend starts. It is stored where the backend can read it before any app module loads, because the instrumentation has to start before the modules it instruments.
- **Toggle off.** Nothing changes: traces go to `observability.duckdb`, app data to `app.sqlite`, agent memory to `mastra.sqlite`, and logs to the console. No telemetry exporter or OpenTelemetry SDK is loaded and nothing is sent anywhere.
- **Toggle on.**
  - Agent traces are also exported to Arize Phoenix. `observability.duckdb` keeps receiving them.
  - HTTP, NestJS, Postgres and outbound connector calls are traced with OpenTelemetry and exported over OTLP to Grafana `otel-lgtm` (Tempo, Loki, Prometheus), along with metrics.
  - Nest and agent logs share one structured stream with trace ids, and are also exported to Loki.
- **Local tools.** An opt-in `observability` Docker Compose profile runs Phoenix and `otel-lgtm`. The default compose stack and the E2E setup stay unchanged.
- **Developer docs** for starting the tools, turning the toggle on and finding a trace.

## Out of scope

- Production or shared-team telemetry, and any export from end-user installs.
- Electron renderer tracing and crash reporting.
- Hosted or heavier stacks (Langfuse, SigNoz).
- Switching live, without a restart.

## Stories

| Story | Summary | Roadmap feature |
|---|---|---|
| [BA-112](https://halo-powered.atlassian.net/browse/BA-112) | ADR, epic spec and roadmap | 0.3.1 |
| [BA-113](https://halo-powered.atlassian.net/browse/BA-113) | Developer settings panel with observability toggle | 0.3.2 |
| [BA-114](https://halo-powered.atlassian.net/browse/BA-114) | Docker Compose observability profile (Phoenix + Grafana `otel-lgtm`) | 0.3.3 |
| [BA-115](https://halo-powered.atlassian.net/browse/BA-115) | OpenTelemetry bootstrap gated by the developer setting | 0.3.4 |
| [BA-116](https://halo-powered.atlassian.net/browse/BA-116) | Agent trace export to Arize Phoenix gated by the developer setting | 0.3.5 |
| [BA-117](https://halo-powered.atlassian.net/browse/BA-117) | Unified pino logging with trace ids | 0.3.6 |
| [BA-118](https://halo-powered.atlassian.net/browse/BA-118) | Developer docs for the local observability stack | 0.3.7 |

## Specs touched

- [system/architecture.md](../../system/architecture.md): ADR-0006, and the container diagram once the exporters ship.
- [capabilities/app-shell/spec.md](../../capabilities/app-shell/spec.md) or a new `developer-settings` capability: the Developer section's rules and Gherkin flows (BA-113).
- [system/ui.md](../../system/ui.md): the fourth Settings row and its form (BA-113).
- [system/api.md](../../system/api.md): the developer-settings endpoints and the connection test (BA-113).
- [system/data-model.md](../../system/data-model.md): the developer-settings file under `APP_DATA_DIR` (BA-113).
- [system/agents.md](../../system/agents.md) §1.7: the Phoenix exporter next to the storage exporter (BA-116).
- [system/tech-stack.md](../../system/tech-stack.md): the OpenTelemetry, Phoenix exporter and pino packages (BA-115, BA-116, BA-117).
- [system/delivery.md](../../system/delivery.md): the `observability` compose profile and its ports (BA-114).

## Acceptance

- With the toggle off, no exporter or OpenTelemetry module is loaded, nothing is sent to either endpoint, and every existing E2E spec passes unchanged.
- With the toggle on, the backend restarted and `docker compose --profile observability up` running, one chat question shows:
  - the agent run in Phoenix;
  - its HTTP and Postgres spans in Grafana Tempo;
  - logs in Loki that link to that trace;
  - the same trace in `observability.duckdb`.
- With the toggle on and the tools down, the app still works and the Developer section shows both endpoints as unreachable.

## Dependencies, risks and open questions

- **Load order.** OpenTelemetry auto-instrumentation only patches modules loaded after it starts. The backend entry points (`main.ts`, `cli.ts`) must read the setting and start the SDK before importing the app. See ADR-0006.
- **Restart in the browser delivery.** Electron can respawn the backend from the Restart button. The npm CLI runs the backend in-process, so there the notice tells the developer to restart the CLI.
- **Port clashes.** Grafana's default port 3000 is the backend's, so the compose profile maps Grafana to another host port. Worktrees running side by side need distinct compose project names and ports (see the *Worktree deploy convention* in [CLAUDE.md](../../../CLAUDE.md)).
- **Package versions.** The Phoenix exporter must match the installed `@mastra/observability` version.
- **Depends on** nothing outside this epic.
