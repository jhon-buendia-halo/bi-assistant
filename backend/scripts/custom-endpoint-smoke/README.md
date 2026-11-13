# Custom endpoint live smoke (BA-281 / BA-299)

A live check of the **Custom endpoint** LLM provider (`custom`, llm-settings R44–R54) against a real OpenAI-compatible and/or Anthropic-compatible model server. No dependencies beyond Node 18+.

It starts an isolated app instance from the built backend, with a throwaway data dir and its own app secret:

```
node dist/cli.js --no-open --port $APP_PORT --data-dir <mktemp>
```

waits until `GET /llm/settings` answers, then for **each API style that has a base URL**:

1. `POST /llm/models`: prints how many models the endpoint lists; warns when `MODEL` is not among them.
2. `POST /llm/test-connection`: must pass and name the route `custom/<MODEL>` (R49).
3. `PUT /llm/settings`: saves the configuration.
4. `GET /llm/settings`: `configured: true`, provider `custom`, this `apiStyle` and model, the key only in masked form (none for a keyless setup, R47).
5. One data-free assistant turn: a placeholder dataset (`custom-endpoint-smoke`, on a closed port, removed afterwards), then `POST /workflows/agent%3Aassistant/runs/stream` with `Reply with exactly: pong`; the run must end with `done`, carry no `error` event, and its answer must contain `pong`.

Finally it stops the app by its PID and scans **every API response, every file in the data dir and the app log** for the raw `CUSTOM_API_KEY` (R54). It fails if the key appears anywhere. The temp dir is removed at the end.

## Run

Build the backend first (`npm run build` in `backend/`), then:

```
APP_PORT=3460 \
CUSTOM_BASE_URL_OPENAI=http://127.0.0.1:8317/v1 \
CUSTOM_BASE_URL_ANTHROPIC=http://127.0.0.1:8317 \
CUSTOM_API_KEY=... \
OUT_DIR=../evidence/<feature>/custom-endpoint-smoke \
backend/scripts/custom-endpoint-smoke/run.sh
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `APP_PORT` | yes | Port of the isolated app. Refused: 3000, 3100, 3200, 4200, 55432, 8317, and any port something already listens on (so the key is never sent to another running app). |
| `CUSTOM_BASE_URL_OPENAI` | one of the two | OpenAI-style base URL, with the version path (R45), e.g. `http://127.0.0.1:8317/v1`. |
| `CUSTOM_BASE_URL_ANTHROPIC` | one of the two | Anthropic-style server root (R46), e.g. `http://127.0.0.1:8317`. |
| `CUSTOM_API_KEY` | no | Sent with every request when set. Without it the key scan is skipped (warning). |
| `MODEL` | no | Model to test, default `claude-sonnet-4-6`. |
| `OUT_DIR` | no | Writes `report.json` (checks plus every response) and `app.log`, both with the key replaced by `[REDACTED-KEY]`. |
| `READY_TIMEOUT_MS`, `REQUEST_TIMEOUT_MS`, `STREAM_TIMEOUT_MS` | no | Defaults 120000, 60000, 180000. |

Exit code: `0` when nothing failed (warnings allowed), `1` when a check failed, `2` for a configuration error. The script itself never prints the raw key; output and `OUT_DIR` files are redacted.

Ctrl+C stops the app (by PID) and removes the temp dir.
