# Lessons

Read this before every task. It holds the distilled, still-valid rules from [retrospective.md](retrospective.md); that file is the full append-only history, to read only when a lesson needs its context. Step 11 of the `workflow-gate` skill keeps this file current: add a lesson when a retrospective's "What to do differently" item is likely to recur, edit or remove one that is stale or has been promoted into a skill or script, and keep the file under about 80 lines.

## Process and hand-over
- When a request names a UI concept or region ("layer for…", "right panel"), ask which screen and which object it attaches to in the first clarifying question, quoting the user's screenshot.
- Ask only the questions with no safe default, all in one picker call; state the defaults for the rest and proceed.
- When a request could become a repo change, ask whether the result lives in the repo (fixture, seed) or only on this machine before building it.
- Answer an out-of-band question in the very next reply, before any status update.
- Hand over the running app after the wave check (`node scripts/qa.mjs --wave <ids> --base <ref>`; add `--demo <id>` and `node scripts/demo-page.mjs <id>` for the wave's user-visible milestone), and after a restart tell the user to hard-reload the open tab (Ctrl+Shift+R / Cmd+Shift+R).
- Before an L epic or an unclear M feature, show a cheap prototype, then ask one batched confirmation per epic (spec, ADR, questions with recommendations, branch); re-plan a direction change once, not story by story.
- Never read a file over 500 lines whole (`grep -n` or `specs/INDEX.md`, then the range); run tests quietly (Playwright `--reporter=dot`, Jest `--silent`, a log file) and read back only the summary or failure block.
- Before hand-over, look at the first screen a viewer sees, in both themes and with the right panel open (nothing behind Show more, no overlap), and look at every evidence screenshot.
- Commit each story as soon as its related tests are green; never start a second story on top of uncommitted work.
- Measure before designing: prompt sizes from the compiled agent (`getInstructions()`, `evidence/1.14.1/measure-prompt.cjs`), SQL or profiling changes timed live on one small and one large real table.
- Trace before theorising: capture one failing case's real request or traffic (stub dump, logging proxy) before guessing a cause.
- Before blaming a change for a failing test, count its flake rate on unchanged code (run it alone 5–10 times); after making test steps concurrent, run the real gate several times.

## Subagents and parallel units
- Give parallel units one written contract first (types, routes copied from `specs/system/api.md`, test ids, copy); a helper or Feature file two units might both add belongs to exactly one of them.
- Brief every subagent: Edit/Write tools only, a private scratch subfolder (never shared `/tmp` names), never kill a process it did not start, and "if a build or budget blocks you, report it; do not change build config".
- Do not trust a subagent's report: the lead's wave check (`qa.mjs --wave`) re-runs the gates (build, related unit tests, the Features' E2E, `check-specs`) once over the merged wave, especially after a builder was stopped and resumed.
- On "keep going" with no context, check for another live session on the epic (commits in the last minutes, files changing under you) and ask who owns the work.
- At the gate, run `git merge-base --is-ancestor <branch> HEAD` for every `unit/<EPIC-ID>-*` branch and merge anything missing before E2E or evals.

## Shell and tooling
- Write multi-line scripts and every regex edit with the Write/Edit tools, never `sed`, a heredoc or a scripted replace; pipe-test regexes with real Windows (`\`) and POSIX paths; if a multi-file edit must be scripted, assert every anchor's count before writing any file.
- Use absolute worktree paths in every command and scripted edit; the shell's cwd resets between calls.
- Stop processes only by the PID you captured (`$!`, `ps -eo pid,args`); never `pkill -f` or `pgrep -f` with a pattern that matches your own command line; after `TaskStop` on a looping script (e.g. `run-assistant-evals`), kill its leftover node children by PID.
- zsh: brace variables before a colon (`"${sha}:refs/…"`), never start an echoed separator with `=`, and don't word-split a command held in a variable.
- macOS has no `timeout`: let the script exit itself and write output to a file before grepping it. On Windows, run Python as `py -3`.

## Builds and the running app
- Backend `npm run lint` is `eslint --fix` over the whole tree: check with `npx eslint <changed files>`, then `git status` and restore anything outside scope.
- For browser checks run web mode (`npm --prefix backend run build:all`, then `node backend/dist/cli.js`), never bare `ng serve`.
- The web target serves `backend/public`: rebuild it (`npm run test:e2e:prepare` or `npm run test:e2e -- <spec>`) before a targeted `npx playwright test`; a bare `nest build` wipes it, so follow with `npm run build:web`. If a build fails, fix it before reading any Playwright failure.
- Never run a backend build or unit tests while Playwright runs in the same worktree; run the E2E first, then the rest.
- Before starting an app, check who owns the port (`lsof -iTCP:<port> -sTCP:LISTEN`, `netstat -ano` on Windows) and use a free port if another worktree holds it.
- Stop any app you started from a worktree before `npm ci`/`npm install` there (Windows locks the native SQLite module).
- Run frontend unit tests as `npx ng test --watch=false --browsers=ChromeHeadless` (`npm test` watches forever), with `CHROME_BIN` set to Playwright's Chromium if no Chrome is installed.
- A unit test resets the shared browser state it reads (`localStorage`, document focus) in its own `beforeEach`: Jasmine shuffles spec order on every run.

## E2E and Playwright
- Before the first Playwright run of a session: `npx playwright install chromium chromium-headless-shell` in `frontend/`, `docker ps`, and `E2E_SKIP_DOCKER=1` if a Postgres already listens on 55432.
- After every Playwright run: `git status -- evidence/ frontend/e2e/*-snapshots/`; restore evidence other stories own and delete new baselines unless a visual change was intended.
- Never put your own files under `frontend/test-results` (Playwright empties it); use `.qa-reports/`.
- In a wave check, pass `--base <ref>` (the epic branch before the wave, or `HEAD` when a shared fixture changed on the epic); the default base makes `--only-changed` select most of the suite.
- With `launchApp`, destructure `appDataDir` first (`{ appDataDir, launchApp }`) so the app stops before its data dir is removed.
- Use `{ exact: true }` on `getByText`/`getByLabel` when a `DEMO=1` caption or a nearby aria-label contains the same text; assert `toHaveAccessibleName`.
- Never branch on `isVisible()` or read a list with `allInnerTexts()` before an `await expect(...).toBeVisible()` on a known element.
- Before asserting what reaches the model, dump one real request from the stub; pick "which turn" from the last user message only, and assert relative order, never "last".
- In step 6, grep the impacted specs, their helpers and unit tests for every selector, copy or default the change removes or alters (e.g. `emulateMedia({ colorScheme`).
- Assert semantics (role, `aria-pressed`, text), not colour classes; assert side-by-side layout with `boundingBox()`; wait ~500 ms for transitions before a screenshot.
- Run the axe scan on every new screen, and on a shared class's first use of a state, in both themes; the lead does it at the wave check, not each builder.

## Evals and agents
- Run evals only on a fresh copy of the data dir per run, never on `~/.questions-to-insights` or the user's live data; run RFP eval runs one after another (shared `intellify_mercer_demo`).
- Before an eval run, print the copy's saved provider and model, agree the model with the user, check its key and credit (about 3 × cases × 2 turns), and use `EVAL_LLM_*` for any other target; never baseline on the env fallback model.
- For a failed case, read `toolCalls[].input/output` and decide model fault vs check or rubric fault before touching code; stop a 3-run round at the first failed run.
- Decide whether an agent's evals must run by hashing `getInstructions()` and its tool list on base and branch; when they run, compare with at least 3 runs per case per build; for a judge failure, compare with base's answer and make the rubric state one pass condition.
- Write custom checks and the judge input against the model-facing projection (`toModelOutput`) and the rule's exact wording; unit-test each check on one real answer.
- Keep agent catalogue data in a module with no framework imports and build the Mastra objects in a second file (Jest cannot load Mastra's ESM).
- Check what a unit test pins against real data (a real session, a real request) before trusting it, especially derived text.

## Specs and data
- For `check-specs`: a Feature's E2E line is `` E2E: `<path>` `` (no Markdown link), a new epic spec gets its row in `specs/README.md`, and `evidence/<id>/` exists before anything links to it.
- Copy endpoints and shapes into specs and briefs from `specs/system/api.md`, never from memory or older spec prose.
- Before naming a token in `ui.md`, grep `frontend/src/styles/tokens.css` for it; add up side-by-side widths against the real content width at 1440 px with the right panel open.
- Write the negative test for every SHALL-NOT permission rule in the same story as the rule.
- In Angular templates compare a signal's value with null explicitly, not through `?.`; never call DOM methods detached from `window`.

## Git and worktrees
- Merge `origin/main` into the epic branch at the start of each story and before the last story's fast loop, then run `build:all`; take ADR numbers from `main`'s architecture.md at that moment and grep every ADR id after renumbering.
- Write every new file under the worktree root; run `git -C <main checkout> status --short` after creating files.
- Run destructive git commands alone after `git status`; read another ref with `git show <ref>:<path>`, never `git checkout <ref> -- .`.
- Call a failure "pre-existing" only after the same suite fails on a `git archive` or detached `main` copy (on Windows, CRLF makes ~10 backend suites fail on `main` too).
- Create PRs with `GH_TOKEN=$(gh auth token --user jhon-buendia-halo)`; after a push, `gh pr list --head <branch> --state all` and start a new branch from `main` if its PR already merged.
- `docker compose up` from a worktree recreates the shared Postgres container: never `down` or `--remove-orphans` on it, and check `docker ps` and the data afterwards.
