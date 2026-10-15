# Evidence — 1.13.6 Fix: `npm run evals:assistant` always refuses (BA-204)

Bug [BA-204](https://halo-powered.atlassian.net/browse/BA-204), epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). No UI change and no Playwright impact: the script isn't part of the app, so no Gherkin scenario exercises it.

**Root cause.** `run-assistant-evals.ts` called `runAssistantEvals(datasets, cb, undefined, …)`. No case ids selects every set, and the one-fixture preflight (agents.md 8.2) always refuses that: `The selected questions span several samples (world-cup, world-cup-rest, formula-1) — run one sample at a time.`

**Fix.** `selectCliEvalCases(env, sets)` (`mastra/evals/eval-cli-selection.ts`, pure) reads `EVAL_SET` or `EVAL_CASES` before the backend boots. With neither, both or an unknown id, it exits 1 without any model call.

| File | What it shows |
|---|---|
| [cli-refusals.txt](cli-refusals.txt) | The built CLI with no selection, with an unknown set and with both variables set: each prints its message and exits 1 at once, before the backend boots. |
| [cli-real-run.txt](cli-real-run.txt) | `EVAL_DATASETS="World Cup Core" EVAL_CASES=shootouts npm run evals:assistant` with `claude-sonnet-5`: `PASS  shootouts`, `1/1 questions passed`, exit 0. Mastra's existing `Scorer with id … not found` warnings (it doesn't register the check scorers before saving scores) were filtered out of the log, apart from one left in. |

Gates:

- `eval-cli-selection.spec.ts`: 6 tests. It failed first because the module was missing.
- Backend `npx jest`: **66 suites, 1097 tests passed**.
- `tsc`: only the 4 known errors.
- ESLint on the changed files: 0 errors. Prettier: clean.
- `check-specs.py`: passes.

The CLI was built and run in a scratch checkout of the branch, because the app being tested runs from this worktree's `dist/`.
