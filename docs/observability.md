# Local observability for developers

How to see what the backend and the agents are doing on your machine: agent runs in **Arize Phoenix**, and HTTP and database traces, metrics and logs in **Grafana**.

It is off by default, and end-user installs never send anything. The behaviour is specified in [specs/capabilities/developer-settings/spec.md](../specs/capabilities/developer-settings/spec.md), and the decision behind it is ADR-0006 in [specs/system/architecture.md](../specs/system/architecture.md).

| What | Where it goes | Where to look |
|---|---|---|
| Agent runs: model calls, tool calls, tokens, memory, errors | Phoenix, and the local `observability.duckdb` as always | http://localhost:6006 → project **questions-to-insights** |
| HTTP requests, NestJS handlers, Postgres queries, outgoing calls | Grafana Tempo | http://localhost:3001 → Explore → **Tempo** |
| Request metrics (`http_server_request_duration_seconds_*`, `http_client_…`) | Grafana Prometheus | Explore → **Prometheus** |
| Backend and agent logs, linked to their traces | Grafana Loki | Explore → **Loki** |

## 1. Start the tools

From the repo root:

```bash
docker compose --profile observability up -d --wait phoenix otel-lgtm
```

Phoenix has no healthcheck, so give it a few seconds after the command returns. Ports, image tags and overrides are listed under *Observability profile* in [specs/system/delivery.md](../specs/system/delivery.md).

## 2. Turn on developer observability

In the app, open **Settings → Developer**.

1. Click **Test** next to both endpoints. With the default values (`http://localhost:6006` and `http://localhost:4318`), both should say **Reachable**.
2. Turn on **Developer observability** and click **Save**. A **Restart to apply** notice appears.
3. Restart the backend:
   - **Desktop app:** click **Restart backend**. The notice disappears when the backend is back.
   - **Browser (`npx` / `npm run start:web`):** stop the CLI and start it again with the same data dir.

The setting is saved in `developer-settings.json` in the data directory. Every backend reads that file once, when it starts. If you run the backend on its own (`npm run start:dev`), you can write the file into `backend/data/` instead:

```json
{ "observabilityEnabled": true, "phoenixEndpoint": "http://localhost:6006", "otlpEndpoint": "http://localhost:4318" }
```

## 3. Use the app, then find it

Ask a question in a session, or use any screen.

- **Phoenix:** go to **Projects → questions-to-insights**. Each chat turn is a trace rooted at `invoke_agent Questions to Insights Assistant`, with `model_step`, `model_inference`, `chat <model>`, memory and skill spans below it. Failed runs are there too, with their error.
- **Tempo:** in Grafana **Explore**, choose **Tempo**, then **Search** with *Service Name* = `questions-to-insights`, or run TraceQL:
  - `{resource.service.name="questions-to-insights"}` lists every request;
  - `{span.db.system.name="postgresql"}` finds requests that queried Postgres.

  A trace shows the chain `POST /datasources/test-connection` → `DatasourcesController.testConnection` → `pg.connect` → `pg.query`.
- **Loki:** in **Explore**, choose **Loki** and run `{service_name="questions-to-insights"}`. Add `|= "text"` to filter. A line logged during a request carries a `trace_id` label. Expand the line and click **Trace: <id>** to open that request in Tempo.
- **Prometheus:** query `http_server_request_duration_seconds_count`, for example rate by route.

## 4. Turn it off

Turn off **Developer observability**, click **Save**, and restart the backend as in step 2. Stop the tools without touching the sample database:

```bash
docker compose --profile observability stop phoenix otel-lgtm
```

Don't use `docker compose down` on the shared stack, because it also removes Postgres.

## Troubleshooting

- **Nothing shows up.** Check that the Developer section has no **Restart to apply** notice, because the setting only applies after a restart. Then click **Test** on both endpoints.
- **Tempo search is empty right after a request.** Traces are batched (about 5 s), and Tempo's search index lags behind that. Widen the time range to the last 15 minutes and wait up to a minute.
- **"Unreachable — connect ECONNREFUSED".** The tools aren't running, or they are on other ports. Run step 1, or point the endpoints at your ports.
- **Running from a worktree or next to another instance.** The tools join the shared compose project by default. For an isolated set, use `docker compose -p <name>` with `PHOENIX_PORT`, `GRAFANA_PORT`, `OTLP_GRPC_PORT` and `OTLP_HTTP_PORT`, and update the two endpoints in Settings to match. See section 7 of [specs/system/delivery.md](../specs/system/delivery.md).
- **The console looks the same with it on.** That's intentional: logs are exported without changing what the backend prints, so the desktop **System logs** panel keeps working.
