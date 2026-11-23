---
name: local-instance
description: Use before starting the app or the Postgres compose stack, for the user or for a check (any local instance, from a worktree or not, including the isolated instance a check drives with Playwright). Ask the target, check the default ports, build in web mode with the brand, launch and capture the PID, make it ready to test with an LLM and the Testing Data fixtures, stop by PID.
---

# Local instance

Start the app so the user, or a check, can try a change. This skill is the one place that says how a local instance starts and stops. Every local instance is ready to test: it never runs without an LLM.

1. **Ask the target.** From a worktree, do not silently run against shared state: ask whether to run against the shared data dir and compose stack or an isolated one, unless the user named it this turn. A check you run yourself (a Playwright drive, screenshots) always uses an isolated instance with a throwaway data dir (copy a real data dir to test migrations on real data). What is shared: the Electron app and the `npx` CLI default to shared data dirs (`userData`, `~/.questions-to-insights`) and backend port 3000; the compose Postgres uses project name `questions-to-insights-world-cup` and port 55432, and its opt-in `observability` profile adds ports 6006, 3001, 4317 and 4318. Isolate with CLI `--data-dir` and `--port`, desktop `QUESTIONS_TO_INSIGHTS_USER_DATA_DIR`, and `docker compose -p <name>` with `WORLD_CUP_DB_PORT` and the observability port variables. A second *desktop* instance can't run on another port until roadmap 1.7.20 (BA-109) lands, so use the CLI for side-by-side runs. Details: [delivery.md](../../../specs/system/delivery.md).
2. **Check the default ports** (backend 3000, Postgres 55432, observability 6006, 3001, 4317 and 4318) with `lsof -iTCP:<port> -sTCP:LISTEN` (`netstat -ano` on Windows) and `docker ps`. The shared World Cup Postgres on 55432 is the database the app expects, so it is reused; for any other port in use, pick a free one through flags or environment variables only (`--port`, `--data-dir`, `PORT`, `WORLD_CUP_DB_PORT`, the observability port variables).
3. **Build in web mode** with the session's brand: `BRAND=<id> npm --prefix backend run build:all` (backend dist and web UI in `backend/public`), never a bare `ng serve` ([lessons.md](../../../lessons.md), *Builds and the running app*).
4. **Launch** `node backend/dist/cli.js --no-open --port <port> --data-dir <dir>` and capture its PID.
5. **Make it ready to test.** Default LLM: CLIProxyAPI (provider `custom`, Anthropic style, `http://127.0.0.1:8317`, model `claude-sonnet-5-5`), its key in `.env.llm.local` of the main checkout (gitignored; template `.env.llm.example`). Once the app answers, run `node scripts/setup-local.mjs <url>`: it saves that LLM and loads every Testing Data fixture, including the "World Cup PostgreSQL" datasource and "World Cup" dataset (Postgres on 55432) ([delivery.md](../../../specs/system/delivery.md) 2). If `.env.llm.local` is missing, ask the user for the endpoint rather than guessing.
6. **Hand over** the URL, port, data dir and PID. After a restart, tell the user to hard-reload the open tab (Ctrl+Shift+R / Cmd+Shift+R).
7. **Stop** it by that PID, never with `pkill -f`. If running it needed a change to a tracked file, keep that change out of every commit and revert it once the user is done testing. Tear down an isolated compose stack (`docker compose -p <name> down`) and a throwaway data dir.

**Reply:** the URL, port, data dir, PID and the LLM it uses.
