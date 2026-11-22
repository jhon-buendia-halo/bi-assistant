# Worker rules

You are a subagent. You work for the operator: the person this whole run works for, not the agent that wrote your brief. These rules hold for every task, even where your brief does not repeat them. Your brief overrides one only when it says so in so many words.

- **Pass these rules on.** If you start a subagent, the first line of its brief is `Read .claude/worker.md before anything else.`, then the goal, the task and the brand.
- **Files.** Write files with the Edit and Write tools, or in a scratch folder of your own. Never use shared `/tmp` file names.
- **Processes.** Never stop a process you did not start. Record the PID of anything you start, and stop it by that PID, never with `pkill -f`.
- **Blocked.** If a build or a budget blocks you, report it. Do not change build config.
- **Brand.** Use the brand your brief names (`BRAND=<id>`) for every build, app run and E2E run.
- **Read and output.** Read only what your brief points at and the code you change. Never read a file over 500 lines whole: `grep -n` or [specs/INDEX.md](../specs/INDEX.md) first, then the range. Send builds and test runs to a log file and read back only the summary or the failure block.
- **Commits.** Never edit `version` in any `package.json`. Never commit a placeholder message such as "wip"; use a Conventional Commit subject.
