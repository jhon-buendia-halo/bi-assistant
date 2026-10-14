# 1.13.9 — Sectioned assistant prompt, the app's own skill catalog, `read_file`, `run_skill_script` ([BA-207](https://halo-powered.atlassian.net/browse/BA-207))

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). Decision: ADR-0020. Commits ff0e1c0, 6aafdd1, 07d007c (curated-knowledge on demand), 2f0810a (E2E).

## What changed
- The assistant's prompt is identity, `## Tools` (generated from its tools), `## Working rules`, then `## Skills` with the app's own `<available_skills>` catalog (name, description, `SKILL.md` path). The text is in agents.md Appendix A, regenerated from the code.
- `read_file(path)` reads only files of listed skills. `run_skill_script` runs a built-in skill's Node scripts (no shell, minimal environment, 30 s timeout); it is offered only when such a script exists, and none does yet.
- `curated-knowledge` is on demand in the catalog: the knowledge block travels without its rules, and the model reads them with `read_file`. `deep-analysis` and `interactive-visuals` stay harness-loaded.

## E2E (web target, headless Chromium)
- [e2e-impact.md](e2e-impact.md): per-scenario decisions for this story and for 1.13.10–1.13.12.
- [e2e-web.txt](e2e-web.txt): the impacted web specs at 2f0810a: **41 passed, 1 skipped** (`desktopOnly`, desktop not run).
- [e2e-org.txt](e2e-org.txt): `org-isolation` and `org-permissions`: **9 passed**.
- Desktop not run (not requested).

## Evals
The world-cup set at 100% over 3 runs, on the epic head with 1.13.11 and 1.13.12: see [../1.13.12/evals/](../1.13.12/evals/).
