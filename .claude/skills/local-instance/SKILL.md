---
name: local-instance
description: Use before starting the app for the user or for a check (any local instance, from a worktree or not). Ask the target, check the default ports, build in web mode with the brand, launch and capture the PID, make it ready to test with an LLM and the Testing Data fixtures, stop by PID.
---

# Local instance

Start the app so the user, or a check, can try a change. Every local instance is ready to test: it never runs without an LLM.

1. **Ask the target.** From a worktree, ask whether to run against the shared data dir and compose stack or an isolated one, unless the user named it this turn ([`workflow-implement`](../workflow-implement/SKILL.md), *Worktree deploy convention*).
2. **Check the default ports** (backend 3000, Postgres 55432, observability 6006, 3001, 4317 and 4318) with `lsof -iTCP:<port> -sTCP:LISTEN` (`netstat -ano` on Windows) and `docker ps`. The shared World Cup Postgres on 55432 is reused; for any other port in use, pick a free one through flags or environment variables only.
3. **Build in web mode** with the session's brand: `BRAND=<id> npm --prefix backend run build:all`, never a bare `ng serve` ([lessons.md](../../../lessons.md), *Builds and the running app*).
4. **Launch** `node backend/dist/cli.js --no-open --port <port> --data-dir <dir>` and capture its PID.
5. **Make it ready to test.** Default LLM: CLIProxyAPI (provider `custom`, Anthropic style, `http://127.0.0.1:8317`, model `claude-sonnet-5-5`), its key in `.env.llm.local` of the main checkout (gitignored; template `.env.llm.example`). Once the app answers, run `node scripts/setup-local.mjs <url>`: it saves that LLM and loads the Testing Data fixtures, including the "World Cup PostgreSQL" datasource and "World Cup" dataset (Postgres on 55432). If `.env.llm.local` is missing, ask the user for the endpoint.
6. **Hand over** the URL, port, data dir and PID. After a restart, tell the user to hard-reload the open tab (Ctrl+Shift+R / Cmd+Shift+R).
7. **Stop** it by that PID, never with `pkill -f`, and revert any tracked file you changed to run it.

**Reply:** the URL, port, data dir, PID and the LLM it uses.
