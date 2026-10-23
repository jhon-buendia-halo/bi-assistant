# `.claude/tools/` — developer tools for Claude Code

Code that Claude Code (and developers) use while working on this repo. These are not part of the app or its releases. A skill in [.claude/skills/](../skills/) says when and how to use each tool; the tool does the work.

Each tool is one of two kinds:

- **MCP server.** For an external, authenticated service that Claude is the main user of, with structured inputs and shared writes that need approval per call. Registered in the repo's [.mcp.json](../../.mcp.json) and enabled in [.claude/settings.json](../settings.json). Its read tools are allowed there; its write tools ask every time.
- **Script.** For deterministic, repo-local work that people and CI also run (checks, generators). It's called from the shell; no server.

| Tool | Kind | Skill | What it does |
|---|---|---|---|
| [jira](jira/README.md) | MCP server | `jira` | Jira Cloud: read and search issues, create epics and stories or bugs under an epic, update, comment, transition |
| [eval-loop](eval-loop/README.md) | Script | `eval-loop` | The improvement loop's fixer isolation: a detached worktree without the held-out questions, a locked claude session, its change collected as a patch |

A new tool gets its own folder with a README (kind, files, how to test), a row here, and a line in [delivery.md](../../specs/system/delivery.md) section 11.
