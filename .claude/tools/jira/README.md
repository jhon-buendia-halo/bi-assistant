# `jira` — MCP server for Jira Cloud

A local MCP server (stdio) that gives Claude Code typed Jira tools for this repo's epics, stories and bugs. Registered in the repo's [.mcp.json](../../../.mcp.json) and enabled by the committed [.claude/settings.json](../../settings.json). How and when Claude uses it: the [`jira` skill](../../skills/jira/SKILL.md). Story [BA-237](https://halo-powered.atlassian.net/browse/BA-237), epic [BA-119](../../../specs/epics/BA-119/spec.md).

No dependencies: Node 22 or later (built-in `fetch`), nothing to install.

| File | |
|---|---|
| `server.mjs` | The MCP stdio transport: newline-delimited JSON-RPC 2.0 (`initialize`, `ping`, `tools/list`, `tools/call`). |
| `lib.mjs` | Config, Atlassian Document Format, the Jira client and the tools. |
| `setup.mjs` | Writes the `JIRA_*` credentials; run it in your own terminal so the token never passes through Claude. |
| `tests/` | `node --test '.claude/tools/jira/tests/*.test.mjs'` (from the repo root). Jira is faked; no network. |

## Tools

Read (allowed in `.claude/settings.json`): `whoami`, `get_project`, `search_issues`, `get_issue`, `list_statuses`, `list_transitions`.

Write (Claude Code asks every time): `create_epic`, `create_issue` (Story, Bug or Task; a Story or Bug must name an Epic, checked before creating), `update_issue`, `add_comment`, `transition_issue`.

A failure comes back as a tool error carrying Jira's own message (`HTTP 400 on POST /rest/api/3/issue: summary: …`), never as a protocol error.

## Credentials

The environment wins. Then `JIRA_CONFIG_FILE` if set, or else this checkout's `.env` and then the main checkout's `.env` (found with `git rev-parse --git-common-dir`, so a worktree needs no copy). They are read on every call, so setup needs no restart.

```bash
node .claude/tools/jira/setup.mjs https://<site>.atlassian.net <email> <PROJECT-KEY>
```

## Trying it by hand

```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}' | node .claude/tools/jira/server.mjs
```

In Claude Code, `/mcp` shows the server and its tools.
