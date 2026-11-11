# 1.22.4 — Profile and synthesize from the Data Readiness Agent

- **Demo artifact:** https://claude.ai/artifact/AD2MCYtcqHcHXjLLvPjgzF (private until shared from its Share menu).
- **Demo video:** [demo.webm](demo.webm), the scenario "Generate a synthetic script from the Data Readiness Agent" (`frontend/e2e/synthetic-data.spec.ts`, `describe('Chat')`, tags `@demo` `@story-1.22.4`), driven by the stub LLM making one `generate_synthetic_data` call.
- **Evals:** [evals/](evals/README.md): the `data-readiness` set 11/11 in each of 3 runs (100 %).
- **Fast loop (2026-11-11):** `node scripts/qa.mjs 1.22.4 --fast`: build, `check-specs`, `synthetic-data.spec.ts` and the demo passed; the related backend suites failed only in `panel-items`, `system-agents` and `rfp.agent`, which fail on `main` on this Windows checkout too (CRLF fixtures, symlink permission).
- **Gate results:** pending the user's acceptance (`node scripts/qa.mjs 1.22.4 --gate`).
