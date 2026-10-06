# Evidence 0.3.3: Docker Compose observability profile (BA-114)

What was verified, on 2026-10-05, against the real images on a local Docker 29.3.1, using the shared compose project `questions-to-insights-world-cup`:

- `docker compose config --services` lists only `postgres`. With `--profile observability` it lists `otel-lgtm`, `phoenix` and `postgres`.
- `docker compose --profile observability up -d --wait phoenix otel-lgtm` starts both. Phoenix UI returns 200, Grafana `/api/health` reports `database: ok`, port 4317 accepts TCP.
- `POST /v1/traces` returns 200 on `localhost:4318` (otel-lgtm) with JSON or protobuf. On `localhost:6006` (Phoenix) it returns 200 for `application/x-protobuf` and 415 for `application/json`: Phoenix takes protobuf only.
- Only the two new services were then stopped and removed; the Postgres container was not touched and `docker compose down` was not run.
- `frontend/e2e/global-setup.ts` runs `docker compose up -d --wait postgres`, naming the service, so profile services cannot start in the E2E run. The Playwright suite was not run for this change (no app code changed, and port 3000 was in use by another session).
- `python3 scripts/check-specs.py` passes.

Raw output: [compose-verification.txt](compose-verification.txt).
