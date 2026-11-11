# Retrospective

Lessons from each completed epic, newest first. This is the full history: the rules still in force are distilled into [lessons.md](lessons.md), which every task reads first. See step 11 of the `workflow-gate` skill.

Entry template:

```
## YYYY-MM-DD — <roadmap feature ID> <short title>

### What went well
### What went wrong
### What to do differently
```

---

## 2026-11-11 — BA-11 Desktop leftover processes and slow Windows install (1.7.21, 1.7.22)

### What went well
- Reading electron-builder's NSIS templates first showed the installer already uninstalls the previous version, which turned "add uninstall" into the real question (a leftover backend process) before any code was written.
- A scripted check against the real Electron app (stale backend, second launch, hard kill, foreign server on the port) proved all four guards in one run, and the same script is kept with the evidence.
- Counting the installed files by extension found the cause of the slow install in minutes: over half of the 46,955 files were declarations, source maps, sources and docs.

### What went wrong
- The first `installer.nsh` did not compile: defining `customCheckAppRunning` makes electron-builder skip `getProcessInfo.nsh` and `Var pid`, which its own `_CHECK_APP_RUNNING` (reused inside the hook) needs. It was caught only because the installer was built locally before CI.
- Spec edits were made with a Python heredoc against the lessons rule; asserted anchor counts kept it safe, but it was the wrong tool.
- The gate's demo-link check needs the Artifact tool, which this session did not have, so both stories ran the gate with `--no-demo`.
- Nothing was run on Windows: the `tasklist`/`taskkill` paths and the install time saving are unmeasured there.

### What to do differently
- Before pushing a change to `frontend/build/installer.nsh` or the `build` config, compile the Windows installer locally: `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis --x64 -c.win.signAndEditExecutable=false -c.directories.output=<scratch>` runs on macOS without Wine.
- When an override hook replaces an electron-builder macro, read the template's `!ifmacrondef` guards and include what they skip.

## 2026-11-11 — M0-5 Faster workflow, repo-only planning (0.5.1–0.5.5)

### What went well
- Starting from evidence, not a guess: the retrospective's own complaints (five eval rounds, a merge that waited a day, the whole workflow re-run per request) and today's failed fresh build pointed at the slow steps before any change was proposed.
- Two subagents ran the independent pieces (the `qa.mjs` changes, distilling `lessons.md`) while the docs, skills and Jira removal were done in the main session; neither touched the other's files.
- Keeping the `<n>. **<title>** — …` step format meant the `workflow-steps` mod parsed the new `CLAUDE.md` unchanged; only its first-action file and labels moved to `lessons.md`.
- Testing `bootstrap.mjs` on an rsync'd copy without `node_modules` proved the dependency fix with CI's own install flags without disturbing the running app.
- The first real gate run of the parallel `qa.mjs` caught a regression the unit tests of the script could not: Karma under load.

### What went wrong
- The parallel checks made the frontend suite fail in 3 of 5 gate runs. The subagent had only tested the runner on dummy commands. It took two rounds to separate the two causes: CPU contention made it worse, and two order-dependent tests (shared `localStorage`, document focus) were flaky even alone (1 of 12).
- My first install used `--legacy-peer-deps` as documented, which silently dropped `@floating-ui/dom`; the user had to say "try again".
- `docker compose up -d` from this worktree recreated the shared Postgres container (an existing lesson) — the data survived on the volume, but I should have checked first.
- `setup-local.mjs` printed a failure for the Intellify RFP API on a fresh machine, and fixing it by hand needed the `intellify-api` runbook and an app restart.

### What to do differently
- When a change makes test steps run concurrently, run the real gate several times before calling it done, and compare with the same suite run alone.
- Before blaming a change for a failing test, count its flake rate on unchanged code (run it alone 5–10 times).
- Reset shared browser state a unit test reads (`localStorage`, focus) in its own `beforeEach`; Jasmine shuffles the order on every run.

---

## 2026-11-10 — 1.21.13–1.21.16 Monitoring: LLM calls, context window, session flow (BA-320)

### What went well
- Probing the real trace store first (an isolated instance, one real chat turn, the `span_events` rows exported to a fixture) pinned the reader to Mastra's actual shape; the context boxes summed to the real 18,040 input tokens on the first check.
- Reading the store in-process through Mastra's own DuckDB connection avoided the file lock the running app holds.
- The options page (waterfall, trajectory, graph) before building let the user pick the design in one answer.
- The demo was recorded and published in the fast loop for every story, so each hand-over came with its video.

### What went wrong
- The session answer first showed the first request's commentary ("I'll start by checking…"): a model call's output joins the text of every request. A unit test had pinned the wrong value, so it passed; only reading the real session in the running app found it.
- The user did not see the changes after the rebuild: the open browser tab still ran the old bundle. The hand-over did not say to reload.
- The first E2E draft asserted the caption text where the "Context window" label is a separate heading.
- Some Gherkin scenarios (a failed call, two agents, more than 25 calls) need data the LLM stub cannot produce, so they are covered only by component unit tests.

### What to do differently
- Check what a unit test pins against the real data before trusting it, especially derived text such as an answer.
- When handing over a restarted instance, tell the user to hard-reload the open tab (Ctrl+Shift+R).
- Give the LLM stub an error reply, so failed-call scenarios can run end to end.

---

## 2026-11-10 — 1.10.3 GitHub Copilot as an LLM provider (BA-159)

### What went well
- A spike against the real Copilot SDK came before the epic spec. It settled the hard facts first: a Free seat auto-routes and lists no models, built-in tools must be overridden, and declaration-only tools let Mastra keep the tool loop. The design held through implementation.
- The E2E stub of the Copilot runtime was written from a recorded trace of the real runtime, captured through a logging proxy that the SDK's own `COPILOT_CLI_PATH` launches. Production code needed no test hook, and the stub matched the protocol on the first smoke run.
- The assistant evals on the real seat found a defect that no unit or E2E test would have: the model sometimes writes a tool call's arguments as its answer. A second proxy trace located the cause (in-session model behaviour, not the adapter's history replay, which was my first guess) before any code changed. The fix (R66) has unit tests and an E2E scenario.
- Running the full unit suites on a detached `main` checkout (junctioned `node_modules`) made "pre-existing" provable: the same 10 suites and 43 tests fail on both.

### What went wrong
- The first E2E run failed every test at teardown with EPERM. The tests listed `{ launchApp, appDataDir }`, and `launchApp` does not depend on `appDataDir`, so Playwright deleted the data dir before stopping the app. About 20 minutes went to the wrong suspects (the stub log, Windows Defender) before reading the fixture order.
- A "custom endpoint" regression eval ran on Copilot. The user had saved Copilot in the scratch copy while testing, which removed the endpoint key (R55), and I did not check the copy's saved provider before starting. It wasted Copilot credits, and the stray loop survived `TaskStop`: two node children kept running until killed by PID.
- I guessed the raw-JSON cause (transcript replay) before tracing it, and the guess was wrong.
- The demo recording failed once: under `DEMO=1` the caption itself contains the asserted text ("Configuration saved"), so `getByText` matched two elements.
- `sed` edits mangled two shell scripts (a command substitution inside an env-prefix line, an `if` inside a line continuation), against an earlier retrospective lesson.
- The Copilot evals do not reach 100%. On a Free seat, Copilot also judges its own answers, so the remaining failures mix model and judge quality. The user chose to ship with them documented.

### What to do differently
- In a Playwright test that uses `launchApp`, destructure `appDataDir` first (`{ appDataDir, launchApp }`), so the app stops before its data dir is removed.
- Before an eval run, print the data copy's saved provider and model (`scratchpad/read-llm-settings.js` pattern), and use `EVAL_LLM_*` for any target other than the saved one.
- After `TaskStop` on a looping script, list `run-assistant-evals` node processes and kill leftovers by PID.
- Trace before theorising: for a provider-side misbehaviour, record the runtime traffic (logging proxy) on one failing case first.
- In a `@demo` test, assert texts the captions also contain with `{ exact: true }`.
- Write multi-line shell helpers with the Write tool, never with `sed` edits.

---

## 2026-11-11 — 1.22.1–1.22.6 Sampled profiling and synthetic data (M1-22)

### What went well
- Timing the sampling statements live before integration (1.20 lesson) found what the plan could not: a cold `TABLESAMPLE` on a 6-billion-row Databricks table took 52 s, over the 15 s timeout, and never-analysed PostgreSQL tables (`reltuples = -1`) would have been labelled "sampling not supported". Both became plan changes before any unit started.
- A lead-written contract file (`generator/contract.ts`: types, function signatures, error class) let eight units across two waves build the generator, both writers, the exports, the API, the UI, the E2E and the specs in parallel; every merge was clean and the API and E2E units met on the first run.
- Asking before reversing a privacy decision. "Export the sample" was ambiguous; asking turned up a real choice (statistics vs. real rows) that reversed ADR-0039's "raw rows never leave the server", and the answer shaped a narrow, confirmed, logged-nowhere path instead of a general one.
- Looking at the running app before hand-off caught two candidate issues; reading computed styles instead of trusting a screenshot showed the dark-theme "faded" buttons were a transient toast state, not a bug.
- Evals ran three times in parallel on fresh data-dir copies: 11/11 each, in under 3 minutes.

### What went wrong
- Two sessions worked the same epic in one worktree. The user said "keep going" to this session while another (`bi-assistant-ff`) was building 1.22.1; only spotting a file changing under a read prevented duplicate units. The takeover needed the other session stopped by hand.
- Merging `main` at the start of the gate surfaced three things the fast loop never saw: an ADR number collision (main had taken 0037 and 0038; ours became 0039, 33 references renamed by context), a lockfile conflict, and an initial bundle 196 bytes over the 1 MB budget. The failed build then left a stale `backend/public`, which made two navigation tests fail for a reason unrelated to them.
- `npm run lint` is `eslint --fix`: it rewrote line endings in nine unrelated `backend/test` files, and `npm ci` was interrupted midway because the app I had started held the native SQLite module open (Windows file lock), leaving `node_modules` half-deleted.
- Mechanical lint fixes made by string replacement broke parentheses twice (turning `async () => ({…})` into `() => Promise.resolve({…})` needs a closing paren only when the body was a bare array).
- E2E runs again overwrote committed evidence screenshots (1.14.17–1.14.19) and wrote an unreviewed Windows visual baseline that would have made the screenshot test pass against itself.
- The 1.22.4 builder raised the bundle budget locally to get a build, an unrequested config change it reverted only because it was told not to commit outside its scope.

### What to do differently
- At the start of a "keep going" with no context, run `ListAgents` and check for commits in the last minutes on the epic branch before touching anything; if another session is live on it, ask which one owns the work.
- Merge `origin/main` into the epic branch **before the fast loop of the last story**, not only at the gate, and run `build:all` right after: ADR numbers, lockfiles and bundle budgets drift while an epic is open. Pick ADR numbers by reading `main`'s architecture.md at that moment.
- When a build fails in the gate, fix it before reading any Playwright failure: `backend/public` is then stale and every UI result is suspect.
- Run backend lint as `npx eslint <files>` on the changed files, not `npm run lint` (`--fix` on the whole tree); then `git status` and restore anything outside scope.
- Stop any app you started from a worktree (by PID) before `npm ci`/`npm install` there.
- After every Playwright run: `git status -- evidence/ frontend/e2e/*-snapshots/`, restore changed evidence and delete new snapshot files unless a visual change was intended (they are written when a baseline is missing).
- Brief builders: "If a build or budget blocks you, report it; do not change build config, even locally."

---

## 2026-11-10 — 1.21.12 Visuals library on the Context page (BA-320)

### What went well
- One written contract (data shape, API, test ids, UX rules) let three parallel units build the backend, the frontend and the specs with no conflicts; the frontend matched the backend on the first run.
- Looking at the running page before the hand-off caught a search icon over the placeholder text; the dark-theme check went through Settings → Appearance, since the saved preference wins over the browser's colour scheme.
- The past lesson "the editor opens where you clicked" went into the contract and shipped right the first time.

### What went wrong
- The app was handed to the user without the demo video. CLAUDE.md's fast-loop list did not mention `qa.mjs --fast` or the demo artifact, the demo test was only due in step 7 (after acceptance), and nothing checked for it, so the user had to ask.
- The first `check-specs` failed because the new spec's E2E reference was a Markdown link; the check needs `` E2E: `<path>` ``.
- A scripted (Python) edit collapsed `[\\/]` into `[\/]` in the new hook's regexes, so it matched only `/` on Windows; found by pipe-testing with a Windows path. The same mistake as the 0.4.5 `sed` lesson.
- The reminder hook first fired for old roadmap stories still marked In progress (1.14.x); it now reads only the branch's roadmap diff.

### What to do differently
- Record and publish the demo in the fast loop, before the hand-off, and give the user the link with the app (now in CLAUDE.md, enforced by the gate and reminded by a hook).
- Write the story's demo scenario with the code, not after acceptance.
- Never edit regexes through a script, in any language: use the Edit tool, then pipe-test with real Windows and POSIX inputs.

---

## 2026-11-10 — 0.4.5 Deterministic QA, demo videos and demo artifacts (BA-119)

### What went well
- Keeping the 0.4.3 dry-run prototype (the `DEMO=1` switch and the `scenarioStep` caption helper) paid off: the demo recording started from working code instead of from scratch.
- The gate caught a real regression on `main`: 6 Prettier errors merged by BA-320 (`assistant.evals.spec.ts`, `narrowDatasets`) that nobody had run lint to find.
- Running the new tool on the real showcase story (1.21.6) found its bugs before anyone depended on it; the `tests.md` counts were checked against the JSON reports.
- Unit tests of the selection and rendering logic (`missingSpecs`, "Listed in step 6 but not run") made "removing an impacted spec fails the gate" provable without a live run.
- The lane lock worked on its first real collision: a second run waited and ran after the first.

### What went wrong
- The first gate run lost its logs: the report folder sat under `frontend/test-results`, which Playwright empties at the start of every run. The waiting run crashed for the same reason, because it set up its folder before taking the lane.
- `demo.txt` kept terminal colour codes, and Playwright's webm has no duration metadata, so seeking needs a player workaround.
- A `sed` replacement with `\u` uppercased the next character and corrupted a regex.
- A `--only-changed` selection exploded when a shared fixture changed, which would have run most of the suite for a small change.
- 43 backend unit tests fail on this Windows checkout (CRLF fixtures, file mode) on `main` too, so the gate cannot be fully green here.

### What to do differently
- Never put your own files under `frontend/test-results`; Playwright empties it. Use a git-ignored folder of your own (`.qa-reports/`).
- Set up shared folders only after taking the lock, never before.
- Edit regexes with the Edit tool, not `sed`.
- For the fast loop use `--base HEAD` (the story's own changes), not `--only-changed`, which explodes when a shared fixture changes.
- Run a new tool on a real story before calling it done, and compare its counts with the raw reports.

---

## 2026-11-10 — 1.21.1–1.21.11 Questions to Insights v2, Data Readiness drill-down, User personas and the dataset ontology (BA-320)

### What went well
- The ontology design was approved from a review page before any code, and its contract was written in [docs/plans/ba-320-dataset-ontology.md](docs/plans/ba-320-dataset-ontology.md). Four parallel units then built the backend core, the bootstrap, the frontend and the specs against that one contract, with few conflicts.
- A context-equality unit test proved the assistant's context block byte-identical for migrated data, so replacing Knowledge with the ontology changed nothing the assistant is told.
- Live smoke runs caught real issues the unit tests missed: Data Readiness fanning queries across all datasources of a session and the SQL fixer rewriting the strays into unrelated queries (Block D1 now carries `datasourceId`); the bootstrap failing with the structured-output "Too big" error because the schema capped drafts at 15; the graph layout piling unconnected nodes into the corners.
- The per-story fast loop, with the user testing each story by hand before the slow steps, kept the later requests (graph, Ontologies card, default persona) small and fast.

### What went wrong
- The first "run the app" used plain `ng serve`. Its relative API base URL cannot reach the backend in a browser (there is no dev proxy), so the app showed "Could not load configured datasources".
- The CRLF working copies on Windows make about 10 backend suites and `check-specs`' Playwright-mirror check fail on `main` too. That hid one real regression (the built-in skills list missing `readiness-drilldown`) until a full-suite baseline comparison.
- An Angular template used `picker()?.index === null`, which is true when the signal itself is null (safe navigation yields null), and that hid the Add mapping button.
- Edit forms opened at the top of a long list, and the three unlabeled mapping boxes confused the user. That UX was inherited from the old Knowledge form and should have been designed.
- The dataset editor header is hidden on the Ontology tab, which broke heading order (axe) and left the tab without context.
- A subagent edited a template with `sed` despite the brief.
- The stale `backend/public` bundle made Playwright fail until it was rebuilt: the web target serves the built bundle.

- The 1.21.3 workflow bar shipped through the fast loop with a chat bug the user never hit by hand: a failed step's `workflow` event re-synced the transcript over the question and the error. Only the acceptance-gate E2E (stub dropping the connection) found it.
- The Data Readiness eval harness bound every PostgreSQL dataset to agent sessions and ignored `EVAL_DATASETS`; 1.21.2's setup script loads all four samples, so the agent rightly asked which dataset and cases failed. The harness now narrows agent sessions to the run's datasets.
- The new drill-down eval caught the agent describing rows its query never returned; the skill now forbids conclusions about unreturned records.
### What to do differently
- For browser checks, run web mode (`build:all` plus `cli.js`), never bare `ng serve`.
- Compare the full unit suites against `main` before calling a failure "pre-existing".
- In Angular templates compare a signal's value against null explicitly, not through `?.`.
- Review list and editor UX at design time: where the editor opens, and labelled controls.
- Rebuild `backend/public` before running Playwright.
- Structured-output schemas must not cap array lengths the service already caps; cap after post-processing.
- Merge `origin/main` into the epic branch at the start of the acceptance gate, not at the end: `main` gained the BA-119 agent org (and its planned demo-video evidence) while this epic was in its fast loop.
- Give the eval harness the datasets a run names for agent-bound sessions, and run new eval cases several times before calling a prompt done: one rule ("state only facts a tool result shows") took the drill-down case from 2 failures in 9 runs to none.

---

## 2026-11-09 — 0.4.3 Agent roles for the token-minimal agent org (BA-119)

### What went well
- The design was settled on the roadmap before any code. The user's three decisions, the token-minimal rework and the video placement were all written into the stories and the epic spec, so the build itself had no rework.
- A docs check before writing the agents found that `isolation: worktree` starts from `main`, not the epic branch, and that subagents cannot call `Workflow`. Both shaped the definitions: the builder cuts its unit branch first, and nothing depends on an agent starting the pipeline.
- Each headless session's `init` message lists the tools and agents it actually has. That proved the manager cannot edit, which a permission denial alone would not.
- The dry run surfaced facts that no plan would have: the fixture's own browser context ignores Playwright's `video` setting, the frontend has no lint config, the builder's allowed commands lacked Python, and linking `node_modules` from the main checkout makes a unit worktree ready instantly.

### What went wrong
- A stray `git checkout origin/main -- .`, tacked onto a spec-check command, reset my uncommitted roadmap and epic-spec edits. They had to be re-applied.
- The first demo story was backend-only, so it produced no video, the very thing the user wanted to see. I didn't say so before running it.
- A `sed` that set the epic spec's status dropped the "Confirmed (0.4.1–0.4.2)" part, and a follow-up commit had to restore it.
- Every agent still loads the full CLAUDE.md, although its brief replaces it. The UI builder took 28 turns and $0.68.
- Heredoc-written helper scripts were mangled twice (a regex lost its backslash, `python3` is missing on Windows). Writing them with the Write tool worked first time.

### What to do differently
- Never append a `git checkout … -- .` or another destructive command to a check command. Run destructive git commands alone, after `git status`.
- When a demo or dry run is meant to show a specific artifact (a video, a screenshot), pick a story that produces it, and say up front what the run will and won't show.
- Edit a status line with the Edit tool and show the result, not a `sed` that rewrites the whole value.
- Add `omitClaudeMd: true` to agents that work from a brief, and measure the builder's turns and cost before and after.
- On Windows, use `py -3` for Python, and write any script longer than a line with the Write tool, not a heredoc.

## 2026-11-09 — 1.20.1–1.20.5 Schema notes, readiness speed and progress, text selection (BA-318)

### What went well
- Measuring before designing. The Fable analysis read the user's stored run (296 s, model only 13 s) and timed variants live (new session per statement 0.8 s vs 0.19 s reused; approximate counts slower), so the speed work targeted transport, not the engine, and rejected sampling with numbers.
- A score-equality harness built from `main`'s dist before any change (fixed `now`, sorted findings) proved the World Cup and US Health results byte-identical after every round of changes.
- Live runs against the user's real warehouse caught what unit tests and the small PostgreSQL samples could not: the BA-322 `https://https//` host, and a folded statement that made `tpch.lineitem` 12× slower and pushed 15 small tables into `timed-out`.
- An independent review after integration found a silent score inflation (not-profiled tables kept their row count, so completeness counted missing nulls as zero) and an abort turned into a 502, before the user saw either.
- Shared contracts written by the lead before fan-out (types, member names, chunk shapes) let 10 parallel units land with few conflicts.

### What went wrong
- I misread the first request: "layer and description" were meant for the schemas in the dataset tree (the user was on Edit dataset), and I built them on datasources. The clarifying questions never named the screen. A whole 12-unit round was reverted.
- The unit tests for the folded statement used a fake profiler with no cost model, so "fold everything into one statement" looked free; only the live Databricks run showed the cost.
- Subagents' shared `/tmp` scripts clobbered each other twice; one unit's edits silently failed to apply until it switched to the Edit tool.
- A diagnosis unit force-closed Playwright Chromium processes that may have belonged to another session.
- The progress line the user reported missing could not be reproduced; the root cause stayed open until the gate's E2E surfaced the missing SSE charset (a different symptom), so the user's report may have had another cause.
- Checks were run against the user's live data dir early on (the Databricks datasource) before scratch copies became the rule for evals.

### What to do differently
- When a request names a UI concept ("layer for …"), ask which screen and which object it attaches to, quoting the user's screenshot, before planning; put the object in the first clarifying question.
- For any change to profiling or SQL shape, time it live on one small and one large real table before integration, not only through fakes.
- Brief every subagent: Edit/Write tools or a private scratch subfolder, never shared `/tmp` names; never kill processes it did not start (record PIDs).
- Send `charset=utf-8` with every text response (SSE included) and assert non-ASCII text in an E2E that reads the raw body.
- Run evals only on a fresh copy of the data dir per run; never on `~/.questions-to-insights`.

## 2026-11-04 — 1.18.2 Product page offers only the Windows installer (BA-302)

### What went well
- Checking `/api/latest` on the live page before proposing a change showed both that downloads update themselves (no deploy needed for a release) and which release really carries the macOS installers.
- The deploy-labs-site skill's verification list (route headers, first bytes of the file, a bogus target, a browser pass for console errors) proved the deploy beyond a 200 on the homepage.

### What went wrong
- In 1.18.1 I wrote "v0.16.1" as the last macOS release into N1, the epic spec, the roadmap and the changelog without checking a single release's assets; it was v0.13.1. The error merged to `main` and needed a fix-forward.
- The product page was put out of scope in 1.18.1 and came back as a second story an hour later, after its branch had merged and been deleted, so the epic needed a second branch and PR.
- I did not ask whether "the page" mattered when dropping a platform; N1 changed but the public page still advertised macOS.

### What to do differently
- Before writing a version number into a spec, check it: `gh release view <tag> --json assets` (or `/api/latest` for the page).
- When a change removes a platform or product surface, list every public surface that names it (README, specs, the product page, `site/README.md`) in the first clarifying question, so the epic's scope is set once.

## 2026-11-04 — 1.19.1 US Health sample as a Testing Data fixture (BA-305)

### What went well
- Publishing the data model as a review page before anything else had three effects. It turned "research Mercer US Health and create a testing data model" into an approved contract: 41 tables, sample rows, planted signals and defects, with four decisions and their defaults. That page then served as the epic spec's scope and every subagent's brief. Nothing was reworked after approval.
- I sequenced the five units around the one shared file. Unit 1 alone owned the generator and ran first in the epic worktree. Units 2–5 never edited it and reported generator faults back. All three merges were clean, and the only generator fix (missing `carriers` rows) was found once, by the unit that ran it.
- The replay used the app's own `splitSqlStatements`, in batches of 50 inside one transaction, against the real sample server. That proved the seed loads the way the loader loads it before any app build. It took 5.5 s; the later app load took 7.4 s.
- Unit 2 kept the trend tests strict. It changed the measure (full years at the generator's calibration basis) rather than the tolerances, so "the 2025→2026 trend looks flat" turned out to be my rough measure, not a generator defect.

### What went wrong
- The first generator agent was briefed to write the generator, its tests and the seed in one go. It was stopped before its first run, leaving 2,305 untested lines. The work had to be re-planned into five units.
- The /batch template asks for one PR per unit, which contradicts the repo's one-PR-per-epic rule. I adapted it to local `unit/BA-305-*` branches.
- The Playwright global setup (`docker compose up -d --wait postgres`) started a Docker Postgres on `*:55432`, alongside the user's embedded Postgres on 127.0.0.1:55432. Nobody asked for it, and unit 4's brief didn't say to set `E2E_SKIP_DOCKER=1`.
- I briefly started the unit tests and the E2E run in parallel. Both rebuild `backend/dist`, so I had to stop one.
- Unit 1's code review read only the first ~2 KB of the 2.3k-line generator, so a reviewer pass on a large generated script proved nothing.
- `registry.spec.ts`'s "qualifies every statement" check only matched double-quoted identifiers. It could never fail for an unquoted seed until unit 3 spotted it.
- The frontend `npm ci --legacy-peer-deps` drops `@tiptap/suggestion`'s peer `@floating-ui/dom`, so the web build fails in a fresh worktree until it is installed with `--no-save`.

### What to do differently
- Brief a large generator as "run it first, then extend": one unit owns the file and must run it within its first few steps. Tests and other consumers start only from a committed, green seed.
- When a sample server is already listening on 55432, run E2E with `E2E_SKIP_DOCKER=1`, and put that flag in every E2E brief. Check `docker ps` before and after any Playwright run.
- Never run `npm test`/`build` and `test:e2e` in the same worktree at once; run the E2E first, then the rest.
- For a fixture whose seed writes unquoted identifiers, check schema qualification by parsing the name after the keyword, not by matching a quote.
- In a fresh worktree, after `npm ci --legacy-peer-deps` in `frontend/`, run `npm install --no-save --no-package-lock --legacy-peer-deps @floating-ui/dom` before `build:all`. Better, fix the lock file in its own change.

## 2026-11-04 — 1.18.1 Build only the Windows installer (BA-302)

### What went well
- Downloading the finished Windows artifact from the stalled run and publishing it the way the publish job does (`gh release create --target <sha> --generate-notes`, then upload with retries) shipped v0.38.0 the same day, without waiting out the outage.
- Grepping the specs for platform claims before drafting the epic spec found N1 ("SHALL ship … macOS"), so the requirement change was confirmed by the user instead of contradicting the workflow silently.
- Running `prepare`'s script locally (extracted from the YAML) proved the matrix and tag resolution before any push; the branch test run with `publish=false` then exercised the whole workflow without releasing anything.

### What went wrong
- The first status check misread GitHub's stale job states as "still building"; only `githubstatus.com` explained that the run was stuck in an Actions outage. The publish job is gated on every build, so one queued platform blocked the whole release.
- `check-specs` failed on the first run because a new epic spec must also be listed in `specs/README.md`.
- actionlint could not be fetched in this session (download blocked), so the workflow went out without it.

### What to do differently
- When a build run looks stuck, check `https://www.githubstatus.com/api/v2/summary.json` (Actions component) before reading job states, and say so to the user.
- When creating an epic spec, add its row to the epic table in `specs/README.md` in the same edit.
- Install actionlint once with `brew install actionlint` rather than fetching the binary per session; ask the user if it is missing.

## 2026-11-03 — 1.17.1 to 1.17.20 acceptance gate of epic BA-281 (custom LLM endpoint)

### What went well
- Seeding one eval data dir through `POST /testing-data/world-cup/load` on the `main` build, then copying it for the branch, gave both builds the same dataset with no hand-written SQL, and forward migration made the copy safe.
- Reading the base's Mastra bundle before running settled how to point `main` at the relay: the router's `createAnthropic` reads `ANTHROPIC_BASE_URL`, and it needs the `/v1` suffix. One-case probes on both builds proved the wiring before the 36-question runs.
- Running the base alongside the branch, same model and data, turned "ambiguous-best-team fails on the branch" into "the judge fails identical answers on both builds", which pointed at the rubric, not at the custom route.
- The live smoke script did in two minutes what the unit tests cannot: both API styles end to end against a real relay, plus a key scan of responses, data dir and log.

### What went wrong
- Units 15 and 17 both created `llm-custom-endpoint.spec.ts`; the add/add conflict had to be stitched by hand, and unit 15's top-level `beforeEach` would have started an OpenAI stub for the Anthropic tests too.
- Two verified unit branches (05, 12) got a commit after they were merged into the epic. The brief named only the three unmerged branches, so this was found only by checking every `*-verified` branch with `git merge-base --is-ancestor`, after the evals and smoke had run.
- The first Playwright run failed all 55 tests: the Chromium build Playwright expected was not installed.
- I committed a placeholder "wip" commit before merging the late fixes and had to reset and redo the merges to keep the history clean.
- The `ambiguous-best-team` judge rubric said "ambiguous on both" and then "a metric … or a year"; it failed about 1 run in 4 on `main` as well, and nobody had noticed because 3-run rounds rarely hit it.

### What to do differently
- At the start of a gate, list every `unit/<epic>-*-verified` branch and run `git merge-base --is-ancestor <branch> HEAD` on each; merge anything missing before running E2E, evals or the smoke.
- When two parallel units add scenarios to one Feature, give one of them the file and the other a describe block to fill in, with hooks scoped to each describe.
- Before the first Playwright run in a session, run `npx playwright install chromium chromium-headless-shell` from `frontend/`.
- For a judge failure, compare the failing answer with a passing one from the base; if they are the same, fix the rubric so it states one pass condition, not two that disagree.
- Never commit a placeholder message; set work aside with a properly named commit, or not at all.

## 2026-11-03 — 1.16.1 to 1.16.12 acceptance gate of the Data Readiness Agent (BA-251)

### What went well
- Drafting the Playwright spec early, in its own unit, with its UI guesses written as a numbered "assumptions to confirm" list made integration cheap: all 11 held and all five scenarios passed on the first integrated run.
- Reading each failed eval case's answer and tool calls before changing anything (the 1.13.9 lesson) split the failures cleanly: four rounds produced five check or rubric faults and one real agent fault (Completeness called the worst dimension over a lower Timeliness). Each fix was made once and covered by a unit test.
- Querying the stored report in the eval data dir's `app.sqlite` proved the model's "6 of them high" was true before I loosened the numbers check.
- Hashing the assistant's and RFP Builder's compiled instructions and tool lists on a `git archive` build of `main` settled in a minute that their eval sets did not need to run.
- Configuring the eval LLM through a throwaway CLI instance (`PUT /llm/settings`, `POST /testing-data/world-cup/load`, `POST /llm/test-connection`) with `ANTHROPIC_BASE_URL=…/v1` worked on the first try, and the key never touched the repo: it stayed in a mode-600 scratch file.

### What went wrong
- The eval unit's checks were written against a tool result shape (bare summary) that the merged tool no longer returned (`{ summary, report }`), and the judge was handed the raw result with the full report first, although `readiness.tools.ts` said the judge used `readinessModelOutput`. The documented projection had never been wired.
- My first move from the lazy `require` to a static import broke two Jest suites on Mastra's ESM; the fix was the `jest.mock` every other eval spec already has for its agent.
- The first eval rubric and numbers check were stricter than the rules they enforce (D2, D9): counts derived from a complete findings list, ages in years and clock times all failed as "invented scores". It took four 3-run rounds to reach 100 %.
- `rfp-builder.spec.ts` failed 9 tests because `intellify_mercer_demo` did not exist on the shared embedded Postgres; an environment prerequisite that nothing checks up front.
- The session-management test that read the Agent dropdown with `allInnerTexts()` raced the listbox and got `[]`; it had been passing by timing.
- The evidence screenshot shows a header layout bug (agent chip empty, datasource overlapping the ID with the panel open). It was not caught in the fast loop and is left as a follow-up.

### What to do differently
- When a tool has `toModelOutput`, write the eval checks and the judge input against the model-facing projection, and add a unit test that feeds the raw tool result through the check.
- Before running an eval round, write each custom check against the exact wording of the rule it enforces (D2 names scores, bands, findings and counts), and unit-test it on one real answer from a dry run.
- Before running `rfp-builder.spec.ts` on a non-Docker Postgres, load the `intellify` fixture into `intellify_mercer_demo` (intellify-api skill, step 2).
- Never read a list with `allInnerTexts()` until a known last item is visible.
- When an agent-bound session is new, screenshot its header with the right panel open as part of the fast loop.

## 2026-10-16 — 0.4.2 Jira MCP tool in `.claude/tools` (BA-237)

### What went well
- Building the server with no dependencies (Node's `fetch`, a 40-line stdio JSON-RPC loop) meant nothing to install in `.claude/`. `claude mcp get jira` showed it `✔ Connected` on the first try.
- Finding the main checkout's `.env` through `git rev-parse --git-common-dir` removed a whole class of retrospective lessons (`JIRA_CONFIG_FILE` in worktrees, `jq` missing, `$'…'` quoting, `raw` to set a parent). The stdio smoke run proved it from a worktree with no `.env`.
- A fresh headless `claude -p` session checked what no unit test can: the 11 `mcp__jira__` tools load, and a read tool runs with no permission prompt (`permission_denials: []`).

### What went wrong
- I wrote `server.mjs` to the main checkout instead of the worktree: one absolute path written without the worktree segment. It was caught by listing the folder, and moved.
- The tests were written after the code. Their first failure was a bug in my own fake (a 204 `Response` built with a body), not in the tool.
- The branch was created as `docs/` for a docs-only first story. When this story's `feat` commit landed, the branch had to be renamed to `feat/` (cheap only because it was never pushed).
- The write tools were never called against the real Jira. They are proven only against a faked Jira, to avoid filing test issues.

### What to do differently
- In a worktree session, write every new file under the worktree root, and run `git -C <main checkout> status --short` after a batch of new files to catch strays.
- For a harness epic that may add tooling, name the branch `feat/` from the first story, rather than after the first `feat` commit.
- For a new tool, write the faked-API test first and see it fail on the missing handler before writing the handler.
- The first real use of `create_issue` or `create_epic` after merge doubles as its live check: read the issue back with `get_issue` and confirm `parentType`.

## 2026-10-16 — 0.4.1 Split CLAUDE.md into workflow-stage skills (BA-236)

### What went well
- Moving the text by line range with a script, not retyping it, made "nothing lost" checkable. A line check found 129 of 140 lines verbatim in one place, and the rest are explained one by one in [evidence/0.4.1/section-map.md](evidence/0.4.1/section-map.md).
- Keeping the `<n>. **<title>** — …` step format, and running the `workflow-steps` mod's own `parseWorkflow` on the new file, proved the Workflow pane still works without touching the mod.
- Copying the RFP Builder's shape (a core list naming one skill per stage, plus "load a stage's skill before you start that stage") gave the user a concrete preview to choose from in one question.

### What went wrong
- I offered "New story, I name the epic" without listing the epics. The user picked it without naming one, which cost a second question.
- The epic spec said the conventions move "unchanged in substance". Two rule changes then landed on the same branch (the planning model, and the Epic-gate check through `get_issue`), so the line check had to explain 3 more lines.
- The user's `/verify` ran the main checkout's copy of `verify` (the base directory names the main checkout), not the branch's extended one. This branch has no web-app surface, so I verified it with a fresh headless session instead.

### What to do differently
- When a question offers "I'll name X", put the candidates (here, the open epics from `search_issues`) in the same question.
- When a "move, don't change" story is followed by rule changes on the same branch, record each change in the roadmap notes as it lands, and keep the line check re-runnable against `main`, so the map stays honest.
- For a harness-only change, verify with a fresh `claude -p` session in the worktree (skills listed, tools loaded, no permission denials), not with the web-app `verify` recipe.

## 2026-10-15 — 1.15.1 and 1.15.2 US Health demo: banner and showcase agents (BA-233)

### What went well
- Reusing the existing "blocked Official agent" path (`chatRequirement`, as the RFP Builder uses while its dataset is missing) made the showcase agents a catalogue flag plus four small UI rules, with no new architecture and no eval gate.
- Checking the running app with a short Playwright script before handing it over caught three things the unit tests could not: the Assistant's Chat Box text on a showcase page, the showcase cards hidden behind "Show more", and a stray Show more on an always-expanded section.

### What went wrong
- I placed the showcase constants in the same file as the Mastra `Agent`s; importing it from the services broke four Jest suites (ESM). The RFP Builder already showed the pattern: keep plain data in a separate module.
- A code comment (`// Showcase agents: …`) inside `agents: { … }` in `mastra/index.ts` made `check-specs.py` count an agent called `agents`.
- The user had to point out that the Survey Agent was "missing": it existed but sat behind the Official section's Show more. I had judged the hub from the API list, not from what the first screen shows.
- Running existing Playwright specs in the fast loop rewrote shipped evidence screenshots of 1.14.17 and 1.14.19 (those specs save screenshots on every run); they had to be restored with `git checkout -- evidence/`.

### What to do differently
- Keep an agent's catalogue data (keys, prompts, reasons) in a module without framework imports, and build the framework objects in a second file, as `rfp.agent.ts` and `showcase-catalog.ts` do.
- Never write `<word>:` in a comment inside the `agents: { … }` registry block.
- For a demo change, check the first screen a viewer sees (cards above the fold, nothing behind Show more), not only that the data is there.
- After any Playwright run, check `git status -- evidence/` and restore screenshots that belong to other features before committing.

## 2026-10-15 — 1.14.2 to 1.14.19 acceptance gate and merge of epic BA-213

### What went well
- Splitting the gate across four E2E agents by spec-file ownership, each running Playwright on the one shared build with its own `--output` folder, finished 18 stories' E2E in about 25 minutes with no build clash. The final full suite (164 passed) proved the fixes broke nothing.
- Telling the agents not to touch production code made every app bug come back with a diagnosis: three package-card bugs, R75 and two prompt gaps were fixed once, centrally, then re-run.
- A frontend unit test caught my first R75 fix, which filtered the built-in skills at the source and hid the RFP Builder's own stage skills from its Graph.

### What went wrong
- About 330 files sat uncommitted across four stories before anyone asked; the per-story commits had to be split by whole file, so a file touched by several stories sits in one of their commits.
- The eval gate ran on a saved model whose OpenAI credits ran out mid-run, and parallel RFP eval runs shared one database and saw each other's drafts (a false failure). The epic merged with the evals deferred.
- Two agents created the same new spec file (`session-management.spec.ts`) at the same time, and two shared one scratch file name; one overwrote the other's first version.
- `gh` was active on the personal account, so the first PR creation failed; Karma had no Chrome until `CHROME_BIN` pointed at Playwright's Chromium.

### What to do differently
- Commit each story when its fast loop is green; never let a second story start on top of uncommitted work.
- Before an eval gate, check the provider has credit for about 3 × (cases) × 2 turns and run the RFP set's runs one after another (they share `intellify_mercer_demo`).
- When fanning out E2E agents, assign every new Feature's spec file to exactly one agent up front (a Feature shared by two stories goes to one of them) and give each agent its own scratch subfolder.
- Create PRs with `GH_TOKEN=$(gh auth token --user jhon-buendia-halo)` and run frontend unit tests with `CHROME_BIN` set to Playwright's Chromium (both recorded in memory).

## 2026-10-14 — 1.14.1 ADR, epic spec and roadmap for agent tools and skills (BA-214)

### What went well
- Searching Jira for open issues on skills before creating the epic found BA-211 (remove the user and project skill folders), which contradicted the plan's "pick existing folder skills". One question settled it before any issue was created, and the stories were reordered around it.
- Measuring the prompt from the compiled agent (`assistantAgent.getInstructions()`), not from the spec text, gave exact numbers per section. It showed the `## Skills` section is already sent on every call, which made the cost of assigning skills small and easy to argue.

### What went wrong
- My first suggestion said the first user skill would add about 1,045 characters to every turn. I took that from agents.md 7.4 ("No built-in skill is on demand"), which is stale: `curated-knowledge` has been on demand since ADR-0020, so the section was already there.
- I proposed reusing folder skills without first checking Jira for open work on skills. BA-211, created the same morning, removed them.
- Jira from the worktree took three tries: no `.env` there, a blocked attempt to copy the credentials, and a create refused over `$'…'` quoting. `JIRA_CONFIG_FILE` was in the script all along.

### What to do differently
- Before proposing a design for a subsystem, search Jira for open issues about it (`project = BA AND summary ~ "<area>" AND statusCategory != Done`) and read any created in the last two weeks.
- Take prompt sizes from the compiled agent, never from spec prose. Keep `evidence/1.14.1/measure-prompt.cjs` as the way to do it.
- In a worktree, run `jira.sh` with `JIRA_CONFIG_FILE=<main checkout>/.env`, pass plain double-quoted one-line descriptions, and never copy the `.env`.

## 2026-10-14 — 1.1.2 Intellify sample as a Testing Data fixture (BA-212)

### What went well
- Building the database by hand first (generator in the scratchpad, loaded and registered through the API) settled the model conversion before any repo change. Turning it into a fixture then took one catalogue entry plus the generator moved into `scripts/`.
- The generator is deterministic (seeded RNG, gzip with `mtime=0`), so "recreate it later" holds both through Load in the app and by regenerating the file. Evidence shows the same hash twice.
- The new catalogue test checks every bundled seed against its required tables, which covers World Cup and Formula 1 too. Before, a seed missing a table only showed up on a real load.
- The E2E loads into its own database name and drops it afterwards, so it exercises "created the database" without touching the shared `intellify` database.

### What went wrong
- The first request ("create a data source") was done outside the repo; the follow-up ("add it as seed") then needed the epic gate, a Jira story and a branch. Asking up front where the result should live would have saved a round trip.
- The dataset I registered by hand carried column descriptions; the fixture's dataset doesn't, because the Postgres connector ignores column comments. That gap surfaced only when the descriptions moved into the seed.
- A wait loop used `pgrep -f "npm --prefix backend ci"` and matched its own command line, so it never ended (10-minute timeout). That's the same trap as the `pkill -f` lesson.
- `npm ci` in `frontend/` fails on `main`: `package-lock.json` is out of sync with `package.json` (electron-builder packages). I worked around it with `npm install --package-lock=false`.
- The Jira script couldn't run from the worktree until the gitignored `.env` was available there.

### What to do differently
- When a request could become a repo change, ask whether the result should live in the repo (a fixture or seed) or only on this machine before building it.
- Never wait on a process with `pgrep -f "<its own command>"`. Wait on the background task's notification, or on a file the process writes.
- For worktree sessions, set the Jira config from the main checkout's `.env` before the first `jira.sh` call, instead of discovering the gap at the epic gate.

## 2026-10-14 — 1.13.13 Built-in skills only: remove user and project skill levels (BA-211)

### What went well
- Fixing the API shape and the UI removals in the prompt let the specs agent and the code agent work in parallel; the specs matched the code on the first `check-specs.py` run.
- Hashing `assistantAgent.getInstructions()` before and after proved the prompt byte-identical, which settled that the evals didn't need to run.
- The E2E agent ran the updated specs against a base-commit build, so the three BA-211 scenarios are shown to fail on base for the intended reasons.
- Running the one failing frontend unit test on a `git archive` copy of the base proved it fails on `main` too, without stashing or touching another worktree.

### What went wrong
- The frontend lock file is out of sync with `package.json` (electron-builder's Windows deps), so `npm ci` fails in a fresh worktree; I had to install with `--no-package-lock` to keep tracked files clean.
- My brief to the specs agent named the file endpoint `…/files`; it is `…/file`. The agent caught it, but a contract in a brief should be copied from api.md, not from memory.
- The first E2E run showed "an agent without skills says so" failing in a scenario planned as re-run-as-is: a shared helper waited on copy the change removed. Step 6 looked at scenarios, not at helpers.
- The updated read_file scenario passes on base too: it only dropped its dependency on user skills, so it does not prove BA-211.
- Several compound shell commands (`git` after `cd &&`, `$(…)` around `jira.sh`) were refused in the isolated worktree and had to be split.

### What to do differently
- In step 6, grep the impacted spec files' helpers for the copy and test ids the change removes, and list those helpers with the scenarios.
- When a brief states an endpoint or shape, copy it from api.md.
- Run `npm install` in `frontend/` and commit the lock file in a separate change, so `npm ci` works in new worktrees.
- In an isolated worktree, run `git` and `jira.sh` as plain commands from the worktree root, and pass JSON bodies inline in single quotes.

## 2026-10-14 — 1.13.9 to 1.13.12: sectioned assistant prompt, own skill catalog, lint clean, eval checks, assistant reliability (BA-207 to BA-210)

### What went well
- Generating Appendix A from the code (`assistantAgent.getInstructions()`) after every prompt change kept the spec byte-identical to what the model receives, and caught nothing drifting.
- Reading each failed eval case's tool calls before changing anything split the failures cleanly: four were the result-set check rejecting correct answers, the rest were real assistant defects (no clarification on an undefined measure, `create_visual({})`, malformed clarification options, names looked up in a second query, the designer losing the chart's data).
- The malformed-clarification investigation found a user-facing bug the evals only hinted at: a malformed first call became a card with no options.
- Lint went to zero in a parallel subagent in its own worktree while the prompt work went on; the cherry-pick had no conflicts.

### What went wrong
- I described "curated-knowledge on demand" to the user before checking which built-ins could be on demand; the clarification that followed (deep-analysis' phase templates, the designer without tools) should have been in the first question.
- The 100% bar took five rounds of 3 eval runs (9b4e0c2, 306f361, 9c29efa, c948702, f30bca2), each before the last surfacing a new rare failure; two rounds were stopped half-way once a run had failed.
- Two E2E tests failed on my own test code (`.card` matched `<main class="card">`; a turn matcher that looked at the whole history) before they tested anything.
- A plain `nest build` in the worktree wiped the web UI the running app served (`deleteOutDir`).
- I first answered an out-of-band workflow question with a status report on another topic.
- The gate took five rounds of 3 eval runs; the fourth (c948702) ended the night at 9, 10, 10 and the merge waited a day. The fifth (f30bca2, rule A12) passed 10, 10, 10.

### What to do differently
- For an eval failure, read `toolCalls[].input/output` and decide model fault vs check fault before touching code; stop a 3-run round as soon as one run fails and fix first.
- Give model-facing tool parameters scalar types (a string with one item per line) instead of arrays of objects: models serialize arrays wrongly now and then, and every validation error fails `check-no-tool-errors`.
- In E2E stubs, decide "which turn" from the request's last user message, never from any user message in the history.
- After `npm run build` in a worktree that serves an app, run `npm run build:web` and check an asset returns 200.

## 2026-10-14 — Workflow: fast loop, then acceptance gate (CLAUDE.md)

### What went well
- The user's manual test now comes right after the code, so a change he rejects no longer costs an impact analysis, E2E edits, a full suite, evidence and a retrospective.

### What went wrong
- For every change he requested, the whole eleven-step workflow ran from scratch, including two full E2E suites (web and org, about 10 minutes) and evidence, before he could try it. Several of those changes were then reworked, and the evidence was redone.
- The first answer to his question about the workflow went unanswered behind a status report on an unrelated check.

### What to do differently
- After step 8 and the quick checks, hand over the running app and stop. Start steps 6, 7, 9, 10 and 11 only once the user says the change is accepted.
- In step 9, run the spec files step 6 lists, not the suite. When an agent's prompt, skills, tools, context or model routing changed, run its evals on the base commit and on the branch, and re-run any flipped case until each build has 3+ runs.
- Answer an out-of-band question in the very next reply, before any status update.

## 2026-10-14 — 1.13.8 Agent page Skills tab (BA-206)

### What went well
- Writing api.md 34a/34b before any code let the frontend worker and the backend run in parallel against one contract. The two halves met on the first integrated run, with no shape mismatch.
- The screenshot with the Details panel open caught the side-by-side file view collapsing to about 200 px of content, a defect no E2E assertion could see. A container query (`@2xl:flex-row`, as admin-overview uses) fixed it.

### What went wrong
- My own E2E helper raced the hub render: `if (await showMore.isVisible())` read "not yet rendered" as "not needed", so one scenario failed in the full suite. Earlier it had passed by luck.
- The spec named a `danger` text colour that has no token, and said the skills load "when the tab is first opened". The tab label needs the count first, so both were corrected after review.

### What to do differently
- Never branch on `isVisible()` in an E2E helper to decide whether to click: it doesn't wait. Click the control the flow needs unconditionally, or `await expect(...).toBeVisible()` first.
- Before writing UI copy and colours into ui.md, grep `tokens.css` for each token named, and check where any count in a label comes from.

## 2026-10-14 — 1.13.7 Skill levels: built-in, user and project skills (BA-205)

### What went well
- Overrides are checked generically against the built-in's own files: every `phases/` and `reference/` file, with the same `{{placeholders}}`. There's no per-skill table to keep in sync, and an override that would break deep analysis's placeholder fill is skipped at startup instead of failing in a background job.
- The red-first E2E reused the recording stub, so "a user skill reaches the catalog" and "an override reaches the turn" are proved on the real request, not inferred from the loader.
- `resolveSkills(builtIn, roots, warn)` is pure apart from reading files, so every precedence and skip rule has a temp-dir unit test without the process-wide cache.

### What went wrong
- The Kanban tracking cards were created `ready`, the state the dispatcher picks up. A worker it auto-assigned pushed the branch and opened PR #74 without approval, and it had to be closed.
- The first design draft let any agent be named in `agents:`. Only reading `visualization.agent.ts` showed the designer has no tools, so it could never load an on-demand skill.

### What to do differently
- Create Kanban tracking cards blocked or done, never ready, and confirm the state with `hermes kanban list` straight after creating them.
- Before letting configuration name an agent for on-demand skills, check that the agent runs with tools and passes `skills:`. Keep that list in code (`ON_DEMAND_AGENTS`).

## 2026-10-13 — 1.13.6 Fix: `npm run evals:assistant` always refuses (BA-204)

### What went well
- I looked for the root cause of the second suspect, `result-set-match` rejecting correct answers, before fixing it. It behaves as specified: the model's `stage LIKE '%final%'` returned 4 to 11 rows where the reference has 1. Loosening the check would have let "list every team" pass "who won", so it stayed as it is.
- The selection is a pure function checked before the backend boots, so a bad selection costs nothing. The unit test needs no Nest, Mastra or ESM mocks.
- The real CLI run was built in a scratch checkout, so the app Jhon was testing from this worktree's `dist/` never changed under him.

### What went wrong
- The bug shipped because nothing ever ran the CLI. The in-app runner passes case ids, so its tests stayed green while the documented script couldn't run at all.
- "Fix all the issues in this PR" was ambiguous: there was no PR yet, and two of the issues I'd listed weren't defects. It took an interruption to settle it.

### What to do differently
- For every documented npm script that wraps app code, keep one cheap test that runs the real entry point's refusal path (no model call).
- When a report lists "issues", tag each one *bug*, *behaves as specified* or *decision for you*, so "fix all the issues" has one meaning.

## 2026-10-13 — 1.13.5 Split interactive-visuals into spec-mode and freeform references (BA-203)

### What went well
- The references were cut verbatim from line ranges of the old file, and a diff against `f3ef18e` proved it. So the visual rules that are a contract (agents.md §7.2) cannot have drifted, and the only change the model sees is which half arrives.
- The recording-stub E2E drives the real designer pipeline end to end. Every earlier visual E2E mocked the designer route, so the designer's request had never been asserted.

### What went wrong
- Both this story and 1.13.2 added an `appSkillBody` to `app-skills.ts` in parallel worktrees, with different trimming. The brief warned about the name but not the semantics. The cherry-pick conflicted, and one test had to change to the trimmed form.
- The after-epic eval run flipped `champion-2022`, and it took six extra runs to show the case is flaky on both builds (2/4 before, 1/4 after). A single run before and a single run after can't tell a 50% case from a 25% one.

### What to do differently
- When two parallel briefs might add the same helper, specify its exact behaviour in both briefs (signature *and* output, e.g. "trimmed at both ends"), or have one unit own it and the other import it after the merge.
- For a behaviour-preserving prompt change, run each eval case at least 3 times per build before comparing. A single run is a sample of one from a flaky distribution.

## 2026-10-13 — 1.13.4 Phased deep-analysis skill (BA-202)

### What went well
- The golden tests were captured from the code *before* the refactor and kept unchanged after it. That proves the model receives byte-identical prompts, which is stronger and cheaper than a stub E2E of a multi-call background job.
- Placeholder filling is one-pass and never re-scans inserted text, so a user question containing `{{…}}` reaches the model unchanged. It fails loudly on an unfilled or missing placeholder.

### What went wrong
- Nothing user-visible. The subagent's report needed the agents.md text rewritten: it lives in a protected file I edit myself, and the proposal text wasn't in the part of the transcript I could read.

### What to do differently
- Ask subagents to write their spec-text proposals to a file in their worktree (`proposals/agents-md.md`), not only in the final report, so the text survives a truncated transcript.

## 2026-10-13 — 1.13.2 Slim assistant core prompt: curated-knowledge skill, harness-loaded (BA-200)

### What went well
- One helper, `knowledgeContext(block)`, is the only way to send Block 3, so the chat turn, the grounding pass, deep analysis and the eval suite cannot drift apart.
- Checking agents.md Appendix A against the prompt the code builds, and Appendix B against the skill body, gave an exact equality check instead of a read-through.

### What went wrong
- The re-scope (cut `visual-tailoring`, merge BA-201) came after the epic spec was confirmed. That is already recorded under 1.13.1, and it is the same lesson.
- Jira has no "Won't do" transition in project BA, so BA-201 stays "To Do" with an explanatory comment. It shows as open work on the board.

### What to do differently
- When a story is cut, ask the user how to close it in Jira (which transition, or delete) at the moment of the cut, instead of leaving it open with a comment.

## 2026-10-13 — 1.13.1 ADR, epic spec and skill loader for app-owned skills (BA-199)

### What went well
- Reading Mastra 1.66's own code (the skills processor, `createSkillTools`, the agent-level `skills` option) before writing the spec gave a design that uses the framework rather than working around it. Each agent declares its skills, and workspaces carry none.
- A throwaway probe spec recorded what the assistant's request really carried before any change: the designer's skill in its catalog, three skill tools and seven workspace file tools. That turned a guess into the story's failing E2E, and it closed an open question in agents.md.
- Measuring the prompt section by section (curated knowledge 1,683 chars; visuals 427; catalog plus usage note 1,045) settled the scope with numbers. Two confirmed skills were cut before any code was written for them.
- The startup check was proven on the built CLI with a broken skill in `dist/`, and the upgrade path with a session created by the previous build.

### What went wrong
- The first eval baseline used the `gpt-4o-mini` fallback and scored 0/10. The model passes `limit: 1`, so every result-set check fails, and that cost a run before a real model was chosen. The shipped `npm run evals:assistant` can't run at all: it passes no case ids, so the one-fixture preflight always refuses.
- The epic spec was confirmed with `visual-tailoring` and `sql-dialects` in it. Neither survived contact with the code: the first costs more tokens than it saves, and the second had no existing text to move. I measured after confirmation instead of before.
- The first old-session check proved nothing: the old build looks its skill up relative to `cwd`, my spawn didn't set it, and no copy was seeded. I caught it only because the script reported `workspaceSkillCopyExistedBeforeUpgrade: false`.
- The designer unit test was written after the service change, not before it.

### What to do differently
- Before proposing a skill split, measure every prompt section and the framework's per-turn catalog overhead, and grep for the content each skill would hold. Put the numbers in the epic spec, so a skill with nothing to move or a net token cost never reaches confirmation.
- Pick the eval model with the user before the first eval run, and check that its key is set (`awk -F= '/^[A-Z_]+=/{print $1, length($2)}' .env.llm.local`). Never use the env fallback model as a regression baseline.
- When a check script compares an old build with a new one, make it assert its own preconditions (the state the old build should leave) and fail when they don't hold. Start each build with the `cwd` the real launcher uses.

## 2026-10-12 — 1.11.3 Task details in the workflow pane (BA-174)

### What went well
- Three clickable mockups on one page, with the parts common to all three spelled out (what completion means, where the summary comes from), let the user pick option A in one answer and kept the build to what the page showed.
- Checking the engine's declarations before writing the spec changed the design twice for the better: a `plain` Button with Text children draws as an ordinary row, and a subagent's run ends in its own `turn.complete` with its `agentId`, so per-agent tokens needed no streaming `turn.step` hook (which would have double counted).
- The per-agent cost question went to the user before any code: the session reports one cost, and 1.11.2 had ruled out a price table, so it was their call, not a detail to settle quietly.

### What went wrong
- The tests passed at 96 and 130 columns, but the first live session drew the pane as a 72-column sidebar and every row wrapped onto two lines: inside a `Button`, `wrap="truncate"` does not cut the row as it did in 1.11.2. My first fix (widen the test pane) hid the problem instead of testing the real width.
- The same live session showed #1 at 0% with the header saying the retrospective was read: Claude read it through a shell command, a step-11 signal under the 1.11.2 rules, so the fact landed on a tentative task that was dropped. I had attached step 1's checks to the task without asking where its calls actually go.
- The step-9 result word could still overflow a narrow row after the column fix; it took a second pass to give it a place (the %'s color).
- The first commit went out without this entry: the edit's anchor named the entry that topped `retrospective.md` on an older `main`, the edit failed, and the commit script ran anyway.

### What to do differently
- For any change to a mod's row or pane layout, add a test at the width the pane really has (the right-hand sidebar is about 72 columns in a 180-column terminal), and run one live session before writing the evidence, not after.
- When a check is about the session (the first action, anything read before the first write), compute it from session state, never from the facts of whichever task a call happened to land in.
- Inside a `Button`, build rows that fit the given width yourself; don't rely on `wrap="truncate"` there.
- Read the first lines of `changelog.md` and `retrospective.md` on the branch right before adding an entry, and make the commit script refuse to run when either file is unchanged.

## 2026-10-11 — 2.1.7 Local mode: sign in as a seeded persona (BA-161)

### What went well
- The plan read the code before deciding: it found that local mode stored no `ownerId` at all, so "Demo User keeps the old data" became a fixed id `local` plus a raw-SQL backfill (M13) instead of a guess.
- The same plan found three ways around the new sign-in before any code: the backend's `LOCAL_USER` fallback outside a request, the frontend's `LOCAL_ME` fallback when `/me` is unreachable, and the Electron probe that waits for `GET /sessions` 200. All three were removed or changed, with tests.
- One transport (a bearer token) for web and desktop means the web E2E covers the desktop's path, even though desktop E2E only runs on request.
- Specs and tests were written first by two parallel agents, then backend and frontend by two more against a written contract (exact routes, bodies, copy, selectors); the full web and org suites passed on the first full run.

### What went wrong
- I asked the user three questions at once and they dismissed the picker; the work stalled until they said "figure everything by yourself". Two of the three had sensible defaults I could have stated and used.
- Creating the Jira story was refused by the permission check, so the work is scoped to the epic with the story key pending.
- The homelab Postgres I deployed and seeded became unreachable after a container restart (no route to 192.168.0.x from WSL), so the backend agent skipped `answer-guards`; it cost a second database setup.
- The E2E agent had to rename the fixture option to `autoSignInAs` because `org.fixture.ts` already defines `signInAs` with another type; the plan didn't check for the name clash.

### What to do differently
- Ask only the questions with no safe default; state the defaults for the rest and proceed, and say which ones the user can override.
- Before relying on a LAN service for E2E, check it again right before the run (`bash -c 'echo > /dev/tcp/<host>/<port>'`). Without Docker, `embedded-postgres` from npm in the scratchpad gives a real Postgres on 55432 in a minute.
- When a plan names a new fixture option, grep every fixture that extends the base test for the same name first.

## 2026-10-11 — 2.1.3 Admin overview (BA-164)

### What went well
- Building P1 last, as the epic spec suggested, meant every figure it shows (users, roles, agents, activity) already had an endpoint and tests behind it.
- The user settled "agent error" with a one-line definition before any code, so `agent.turn-failed` was recorded once, in `SessionsService`, for both the streamed and the plain turn.

### What went wrong
- The org E2E seeds agent errors by writing an `agent.turn-failed` event straight into SQLite, so the Playwright run doesn't prove the recording itself; only the backend API test does.
- The frontend agent built the screens before the backend was merged, so no screenshots could be taken until a separate pass.

### What to do differently
- When an E2E seeds a derived record directly, name the backend test that proves the record is written, in the Feature's E2E line.
- Plan the evidence screenshots as their own step after the last merge, not inside the frontend step.

## 2026-10-11 — 2.1.4 Users & groups (BA-165)

### What went well
- The backend (endpoints 81–90) and the four screens were built in parallel, against the endpoint shapes in api.md 2.15. The org suite then passed 46/46 on its first run after the merge.
- Sending the frontend agent the API as actually built, mid-task, closed the gaps between spec and code before they became test failures.

### What went wrong
- The confirmed epic scope listed three user statuses; a SCIM-deactivated user would have shown as Active. It came out only while writing the screen specs (decision D1).
- I killed my own shell with `pkill -f "ng test"`: the pattern matched the command line that ran it. That's exactly what the 0.2.7 rule forbids, written the day before.
- `npm test` in `frontend/` runs Karma in watch mode and never exits, which cost a 10-minute timeout.

### What to do differently
- Stop processes by PID only (`ps -eo pid,args | grep`, then `kill <pid>`), never with `pkill -f`. No exceptions for "just a test runner".
- Run frontend unit tests as `npx ng test --watch=false` with `CHROME_BIN` set; don't run `npm test` there from a script.
- When a spec lists the states of an entity, check each state the directory or provider can put it in (SCIM deactivate, delete) before confirming.

## 2026-10-11 — 2.1.5 Edit a user (BA-166)

### What went well
- "All or nothing" for Save changes was taken literally. The backend agent added a small `DocStoreTransactions` seam instead of faking atomicity, and tested the rollback.
- Its report listed spec-vs-code mismatches it hadn't been asked about: a dangling Data owner still granting permissions, and streams answering 201. Both were fixed with tests on the same branch.

### What went wrong
- data-model 3.13 said a dangling Data owner grants nothing, but BA-163's resolver granted it. The spec rule had no test, so the mismatch shipped in BA-163 and was caught only by a later story.
- The open panel overflowed the card by 38 px at the 1440 px desktop width. The spec's widths (table at least 560 + gap 24 + panel 520) never fit the real content area (about 1066), and neither the E2E nor the axe scan checks layout. It was found only by looking at the evidence screenshot.

### What to do differently
- For every SHALL-NOT rule about permissions (a role that grants nothing, a route that refuses), write the negative test in the same story that writes the rule.
- When a spec fixes widths for elements placed side by side, add up the widths against the real content width at 1440 px before confirming it, and assert the layout in the E2E with `boundingBox()`.
- Look at every evidence screenshot before closing a story; that review is what found this bug.

## 2026-10-11 — 2.1.6 Roles & permissions (BA-167)

### What went well
- The matrix in the UI and the guard's matrix come from one table (admin R21). The P4 scenario checks the UI against it, and the backend unit test checks the guard row by row.
- Mappings were tested end to end: add a mapping, see the member gain the role on their next request, remove it, see it go.

### What went wrong
- The board's sample mapping "All-Employees → User" can't exist, because User is implicit. That was spotted while writing the spec, not when the epic was confirmed.

### What to do differently
- When confirming an epic from a design board, read each sample row against the model's rules (implicit roles, fixed sets) and list the ones that can't exist.


## 2026-10-10 — 2.1.2 Org server mode: sign-in, directory, roles and enforcement (BA-163)

### What went well
- Building in slices (S1 guard, S2 owner scoping, S3 org backend, S4 frontend), each committed green before the next, kept the local-mode suite green at every step. Local mode was the safety net for a change that touched every route and every private repository.
- The startup self-check (every route must carry a requirement) turns a forgotten decorator into a boot failure instead of an open route.
- Work that would collide ran in separate scratch worktrees with their own `dist/`: the admin screen specs, the UPN fix and the admin API. That kept builds away from the epic worktree while its Playwright suite ran (the BA-160 lesson), and each merged back cleanly.
- An agent flagged that matching users and bootstrap admins by the `email` claim is open to the "nOAuth" takeover. A failing API test proved it (a spoofed email landed on the bootstrap admin's account) before the fix, and the user chose subject + UPN.

### What went wrong
- Merging `main` into the epic branch collided on ADR-0009: BA-168 had shipped its own ADR-0009 while this epic's ADRs were still unmerged. Renumbering by script double-shifted a few lines (changelog, roadmap and the BA-162 retrospective heading said ADR-0011 for the org decision), and S1 found an "ADR-0011 and ADR-0011" typo. Both were caught only by later reads.
- The worktree's E2E database question had to be asked twice: the user picked the shared Docker Postgres, but Docker Desktop wasn't running and the WSL distro had no Docker integration.
- The specs (R13, R18) asked for matching by email; the security problem was found during implementation, not when the spec was written.
- `app.e2e-spec.ts` still fails on an ESM import and the `llm.service.spec.ts` type errors from `main` remain; every gate report has to explain them.

### What to do differently
- Before writing an ADR number on an epic branch, check `main` and every open branch for the next free number again at merge time, and renumber with a reviewed list of (file, line) pairs, then grep the result for every ADR id before committing.
- Before offering "the shared Postgres" for E2E, check it is reachable (`ss -ltn | grep 55432`, `docker ps`) and say so in the question.
- When a spec says how to identify a person from an identity token, name the claim and check the provider's guidance on whether it is verified before confirming the spec.

## 2026-10-10 — 2.1.1 Admin Panel: multi-user vision, ADR-0010 and epic spec (BA-162)

### What went well
- I checked the board against `vision.md` before drafting and found that "Not multi-user" was a direct conflict. Three rounds of multiple-choice questions then settled reality (real multi-user), deployment (self-hosted), local mode (kept), sharing (datasources, datasets and the LLM configuration), storage (SQLite), sync, and datasource governance before any spec text was final.
- I read the FigJam section as plain node names (`grep` over the saved result) instead of images. That gave every label, column and permission row exactly, cheaply.
- Before choosing numbers, I checked every remote branch for claimed ADR and milestone numbers. BA-159 holds Milestone 1.10, so this epic went to Release 2 / 2.1 instead of colliding.
- Turning board items that don't fit the decisions (the Sync button, the request tiles, the sharing permissions) into explicit open questions let the user settle them in one picker.

### What went wrong
- I added two stories (spec and foundation) beyond the "one story per screen" the user had picked, and only said so after creating them in Jira. That was the right call, but it was a scope change made before telling the user.
- The first round's option text said users reach the org server "from the browser or the desktop app". The ADR then scoped desktop-as-client out, so the option text implied more than the plan delivers.
- `check-specs.py` failed once on the roadmap's link to `evidence/2.1.1/`, because I linked it before creating the folder.

### What to do differently
- When a requirement forces stories the user didn't list, propose them in the confirmation question before creating Jira issues, not after.
- Keep option descriptions in clarifying questions to what the plan will deliver. If an option implies a sub-feature, say whether it is in or out.
- Create `evidence/<id>/` before adding the roadmap's or changelog's link to it.

## 2026-10-10 — 1.11.2 Inferred task queue in the workflow pane (BA-171)

### What went well
- Designing on a page first (five mockups with the data source of every number) made the implementation a transcription: the rule table, the tentative threshold and the row format were all decided before any code.
- Splitting the inference into a pure `rules.ts` gave five fast tests with no engine stubs, and the hooks module only orchestrates. The first red run failed on "cannot find module", exactly as intended.
- Checking the event shapes in the engine-written declarations (`turn.complete` has `usage?`, `agent.spawn`'s result has `model` and `agentId`, `$.session.usage().cost.usd`) before writing the hooks meant no API surprises; `tsc` over the hooks against those declarations passed first time.
- The test kit's `mock.clock` made durations and the cost delta exact assertions (`1:05`, `$0.22`).

### What went wrong
- Two test expectations were wrong about my own numbering (which parity a repeated step lands on, and which number a queued step gets while a tentative task holds); I corrected the tests after reading the output, which is acceptable only because the spec text, not the test, defined the behaviour.
- A `cd <worktree> && python3 …` edit ran against the main checkout: the delivery spec edit failed on a missing anchor and the evidence folder was created in the wrong place. The harness resets the shell's working directory between calls and the script's `cd` was not where I thought it was.
- Nine queue tests failed on `no implementation for clock.now` because only one test registered the mock clock; the fix was to register it in the shared stub helper.
- The first live capture didn't submit the prompt (`send-keys 'text' Enter` in one call); a literal send, a pause, then Enter worked.
- The pane's elapsed time only refreshes on events; a ticking clock (`$.clock.every`) was left out to keep the change small, and the roadmap says so.
- The third live run ran `cd <worktree> && printf … > evidence/…`, and the worktree's absolute path under `.claude/worktrees/` matched rule 8 before the redirect target matched rule 10. Paths now drop the worktree prefix and a redirect target is matched first. Each live run found one more shape of real call.
- The second live run wrote a file with `printf > …` in a shell command, and the pane saw only `Bash ×2`: the rules knew the write tools but not shell writes, which this project's auto mode uses for most edits. Paths named in a shell command now count for their step, strongly when the command writes.
- The first live run showed task #1 at 0% confidence: Claude explored with a shell search, which the rules counted as unmatched because only `Read`, `Grep` and `Glob` were step 1 before the first write. One real session found what fifteen tests had not; the rule now counts any unmatched call before the first write as exploration.

### What to do differently
- Use absolute paths in every scripted edit of a worktree file and never rely on the shell's working directory.
- Put `mock.clock(on)` in the shared stub helper of any mod test file whose hooks call `$.clock`.
- When a test expectation disagrees with the implementation, re-derive the expected value from the spec text before touching either.
- For tmux-driven captures of Claude Code, send the prompt with `-l`, wait, then send Enter in a separate call.
- Drive one real session through the mod before calling an inference rule done; the test fixtures only contain the calls I imagined.

## 2026-10-10 — 1.11.1 Claude Code workflow mod in the repository (BA-170)

### What went well
- Stopping to ask where the "mod" should live caught a wrong premise before any file changed: I had read "right panel" as the app's details panel and drafted an app feature, and the user meant a Claude Code mod. The Jira writes were held until the text matched.
- An existing mod in `~/.claude/dev-mods/` plus the engine-written `.claude-plugin/types/index.d.ts` gave the exact API (`$.ui.open`, `ui.render` on `Pane`, `$.fs.read`, `atom/read/update`) faster than the docs alone; the docs then supplied the rules static validation enforces.
- Writing the mod's tests with the test kit first and running them red found a real formatting defect (lowercase, doubled full stop) through a debug mount that printed the drawn tree.
- Evidence beyond the unit level: a marketplace install from the branch path, and a real session in tmux at 170 columns captured with the pane open, both at start and after `/workflow`.

### What went wrong
- Three Bash chains in zsh died on an `echo ====` separator (`=` prefix is a glob), losing a test-evidence file and the plugin cleanup step, which had to be re-run.
- The first type-check of the test file against the engine declarations reported four errors in the stubs' types that the test kit tolerates; I left them rather than find the exact result shapes.
- I committed the mod's `tsconfig.json`, which extends a file the engine writes only after it loads the mod; a fresh clone's editor sees a missing extends until the first load.
- The GitHub-sourced marketplace in `.claude/settings.json` cannot be verified on the branch, only once it is on `main`, so the install path developers will actually use is unproven until merge.

### What to do differently
- In zsh, never start an echoed separator with `=`; use `echo '-----'`.
- When a request names a UI region ("right panel", "left bar"), ask which surface before classifying it as an app feature.
- For a repo-hosted marketplace, add a post-merge check to the PR description: `claude plugin marketplace add <owner>/<repo>` then `claude plugin install` from a clean machine.
- Type-check a mod's tests against the engine declarations and fix the stub shapes, or drop the test file from `tsconfig`'s include, so `tsc` is a clean signal.

## 2026-10-10 — 1.10.2 Light theme and open drawer by default, remembered in the database (BA-168)

### What went well
- Four questions up front (epic, keep System, database plus first-paint cache, which "left bar") settled every design choice before the specs; nothing was reworked.
- Testing persistence with `launchApp(appDataDir)` (a fresh browser profile on the same data dir) proves the database remembers, not the browser copy.
- Checking the failed visual baseline image before regenerating it confirmed the only change was the expanded drawer.

### What went wrong
- A scripted multi-file edit failed on a non-unique anchor in `app.ts` (`this.loadSessions();` appears twice), after earlier files in the same script had been written. Same lesson as BA-155's retrospective, again.
- `npm run test:e2e:update -- <spec> -g …` doesn't scope: the extra arguments land after `--update-snapshots` and are rejected. I scoped the update with `npx playwright test --update-snapshots=changed <spec> -g …` on the already-prepared build.
- Three axe-scan tests silently depended on the System default (they switch themes through the emulated OS setting). Changing a default needs a grep for every test that relies on it.

### What to do differently
- In multi-file edit scripts, check every anchor's count before writing any file.
- To regenerate one visual baseline, run `npm run test:e2e:prepare`, then `npx playwright test --project=web --update-snapshots=changed <spec> -g "<title>"`, and look at the actual image first.
- Before changing a default, grep the E2E for what produces the old default (here `emulateMedia({ colorScheme`) and decide each case in the step-6 list.

## 2026-10-10 — 1.10.1 Per-model reasoning effort in LLM Settings (BA-160)

### What went well
- Reading the probe code before proposing a fix showed the real cause: the 30 s limit applies to Test *and* Save, and the reasoning endpoint refuses until something is saved. That turned a "just raise the timeout" idea into the user's actual ask: pick from the levels each model accepts.
- Checking the level table against the provider docs (Anthropic's Effort page, OpenAI's model pages) and the bundled Mastra provider schemas (which accept `none` to `max`) before writing it. It also surfaced a latent bug: the old Claude regex dropped effort for Haiku 5.5.
- Extending the recording stub with `reasoning_effort` let the E2E prove both halves end to end: the probe sends `minimal`, the next chat turn sends `medium`.

### What went wrong
- I gave the user a curl workaround ("save directly, skip the test") without reading `save()`, which runs the same probe. I had to retract it a turn later.
- I filed the story under BA-119 because the user picked it, before reading the epic's description; it covers the dev harness, not app features, so I had to ask again and create a new epic.
- I ran `npm run build` in `backend/` while the full E2E suite was running in the background. `nest build` clears `dist/`, and 13 scenarios failed in a few milliseconds before I stopped the run and started over.
- `npm run lint` in `backend/` runs `--fix` and reformatted ~30 unrelated files (and stripped two casts from a spec I touched). I had to revert them by hand.
- The background web server from the start of the session hit the 2-hour limit and was killed; the user lost the running app mid-conversation.

### What to do differently
- Before suggesting a workaround through an endpoint, read that endpoint's service method end to end.
- Before accepting an epic for a story, read the epic's Jira description and confirm it covers the kind of change; say so if it doesn't.
- Never run `build` or `build:all` in `backend/` while Playwright is running; wait for the suite, or lint and unit-test only.
- Lint the backend with `npx eslint <touched files>` (no `--fix`) to check a change, and run `git status` after any repo-wide lint.
- When the user needs an app running for longer than the session's work, start it with the 2-hour maximum and tell them when it will stop.

**Follow-up (always-visible select):** I specified the select as hidden for models without levels and the user found the setting undiscoverable: the first thing they saw was a form with no effort option, because the empty model field also hid it. Making it a wrapping `<label>` then gave it the accessible name "Reasoning effort Default — enter a model first", which a script's `getByLabel('Model')` matched.
- For a new setting, keep its control visible and disabled with a reason instead of hiding it, so users can find it.
- Label `select` elements with `<label for>`, not a wrapping label, and assert `toHaveAccessibleName` in the E2E.

## 2026-10-09 — 1.9.5 Agent editor with a preview chat (BA-155)

### What went well
- Making the preview an in-memory session that the sessions service resolves by id gave it streaming, memory, visuals and the chat component for free. It also kept ADR-0008's "not stored as a session", with no new ADR. Routing every document write through one `updateDoc` was the only intrusive change.
- The user's database choice became a reusable harness rather than a one-off: `E2E_WORLD_CUP_DB_*` in `.env.e2e.local`, seeded through the app's own testing-data loader. The full suite was green on the MCP database before any story code, which separated harness failures from feature failures.
- Writing the sweep test as a real backend restart (create a preview, stop, boot, check the directory) proved the crash path, not just the discard path.
- The frontend agent reported its spec conflicts (rail Agents vs app-shell R3, a label that collides with `getByLabel`, what the panel shows when opened without Preview) instead of silently picking. All three became spec text.

### What went wrong
- My first database edit used a `this.repository.update(id, {` pattern that was a prefix of two other lines, so the assertion stopped the script. The third time this session a non-unique anchor bit me.
- I sourced `.env.e2e.local` and started the backend in one `&&` chain ending in `&`. The whole chain ran in the background subshell, and the seed request went out with empty variables.
- ui.md specified `aria-label="Remove starter question <n>"`, which Playwright's non-exact `getByLabel('Starter question 1')` would also match. I wrote the label and the test without checking them against each other.
- The editor rules first landed above R53, out of numeric order, because I anchored the insertion on R53 itself.

### What to do differently
- For code edits by script, anchor on whole lines and assert the count. Use a line-number-scoped replace when the same call appears many times.
- Start background processes on their own line, after sourcing env files in the current shell.
- When a spec names an accessible label, grep the E2E for `getByLabel` calls using a substring of it, and use visually hidden text or `exact` locators where they collide.
- Insert new numbered rules after the last existing rule, not before the next one.

## 2026-10-09 — 1.9.3 Start a session from an agent (BA-153)

### What went well
- Four multiple-choice questions settled the behaviour before any spec was written: create the session at once; Start chat on the card and in the detail; republish changes instructions and model but not datasets; a deleted agent's sessions show its name. The rules, Gherkin and tests then followed without rework.
- A local OpenAI-compatible stub that records requests turned "the answer follows the agent's instructions" into an exact check: which system messages the model got, in what order, and which deployment it was called as. It also scripted the `DELETE` tool call for the read-only guard scenario.
- Splitting the frontend to a parallel agent, against a contract fixed in the specs and the E2E file, let both halves land in one pass. The agent found a real stale-copy bug (reopening a session showed it as before that visit's turns) by running the deletion scenario.
- Moving the backend process harness into `test/backend-process.ts` kept the second API test from copying 60 lines. Re-running `user-agents.e2e-spec.ts` confirmed the refactor.

### What went wrong
- The first version of the instructions scenario asserted that the agent block was the *last* system message. Mastra appends its own workspace and skills messages after the app's context, so the assertion was wrong, not the code. I had not looked at a real request before writing it.
- The guard scenario's error-text locator matched twice (the summary line and the detail), a strict-mode failure that `{ exact: true }` fixed.
- The agent's description ran straight into "Connected to …" with no full stop. Only the screenshot showed it; the unit test checked `toContain(description)`.
- I repeated the `### Fixed` multiple-match mistake from the BA-141 merge, an hour after writing the lesson down. The assertion caught it, but one edit had already been applied.

### What to do differently
- Before asserting the order or position of anything sent to the model, dump one real request from the stub (as `model-request-system-messages.json` now does) and write the assertion against it. Assert relative order against the app's own blocks, never "last".
- For changelog edits, insert under the date with a first-occurrence search bounded by the next `## ` date heading, not a unique-match replace on `### Fixed` / `### Added`.
- When welcome or summary copy concatenates user-written text with fixed text, add a unit test on the exact rendered string, not `toContain`.
- In a subagent brief for UI work, ask it to screenshot the changed screens in both themes, so copy and spacing issues surface before the evidence step.

## 2026-10-09 — 1.9.4 follow-up: merging BA-141's restyle into the Agent Hub branch (BA-154)

### What went well
- The axe scan over every screen in both themes caught the one regression the merge introduced. The dark active filter pill was at 4.34:1, because the hub was the first screen to use a shared class whose active state had never been rendered.
- Every check ran before the merge commit, so the merge and its fix land together and the branch never holds a red state.

### What went wrong
- I re-ran the targeted specs with `npx playwright test` after the CSS fix. That reused the stale `backend/dist` web UI, and the fix looked like it had failed. `test:e2e:prepare` rebuilds it; plain `playwright test` doesn't.
- `ng test` failed at first because there is no Chrome binary in WSL. With Playwright's Chromium, one test still failed: headless Chrome opens about 765 px wide, which clamps the right panel below what `app.spec.ts` expects. That cost a diagnosis round.
- The earlier session left the merge staged but uncommitted, with no note of what was still to be checked.

### What to do differently
- After any frontend change, run `npm run test:e2e:prepare` before a targeted `npx playwright test`, or use `npm run test:e2e -- <spec>`.
- Run frontend unit tests in WSL with `CHROME_BIN` pointing to a wrapper script around Playwright's Chromium that adds `--window-size=1440,900`, using `--browsers=ChromeHeadless`.
- When a shared component class gains its first user of a state (active, disabled, selected), add that screen to the axe scan in both themes in the same change.

## 2026-10-09 — 1.9.4 Agent Hub screen (BA-154)

### What went well
- Comparing the spec draft against the mockup before writing any tests caught a design slip. The draft moved pinned agents into a Pinned section under All, while the mockup keeps them in place and treats Pinned as a filter. The fix cost one spec revision, not a rework of tests and code.
- Moving the hub ahead of 1.9.3 when the user wanted to see it was cheap. Story boundaries were clear (Start chat and Edit hidden, New agent disabled), and one epic PR means the interim state never reaches `main`.
- Running axe on the new screen found contrast failures (`zinc-500` on the card background, 3.25:1) that had never been seen, because axe only ever scanned the home shell.
- Looking at the evidence screenshots before committing caught the clipped search placeholder. Moving the search to the mockup's full-width row fixed it.

### What went wrong
- The plan's card layout (name beside the icon) truncated names to one letter at 1440×900 with the right panel open. That was only discovered in implementation, so ui.md had to be corrected afterwards.
- The user stopped the implementing agent twice, mid-step, to ask for status. Each time it resumed from the user's message, so its report reached the orchestrator later than the user's question. One old agent also reported a stale status ("the CLAUDE.md rule is gone") after the rule had moved to its own BA-89 branch.
- Karma has no Chrome configured in this WSL environment. The frontend unit tests needed `CHROME_BIN` pointed at Playwright's Chromium and a scratch config. At the default 800×600 size, the existing `app.spec.ts` keyboard-resize test fails (548 expected, 525), unrelated to this change.

### What to do differently
- Before writing UI specs from a mockup, list each mockup element and say whether it is a section, a filter or a state, then check the spec draft against that list.
- Size card layouts against the narrowest real main column (1440 wide minus the sidebar and the 572 px right panel ≈ 572 px) before fixing them in ui.md.
- Run the axe scan on every new screen, not only the home shell. Treat `zinc-500` text on raised surfaces as suspect.
- When the user asks a running subagent for status, give the orchestrator's view of the whole epic, not the subagent's slice, because a subagent can't see later work.

## 2026-10-09 — 1.9.2 Agent definitions: storage and API (BA-152)

### What went well
- A Fable plan written from the code before any edit caught the `AgentsModule` → `SessionsModule` import cycle. It also caught that `agentContext()` is the single insertion point, which shapes 1.9.3. The user-agent module was built as a shared leaf from the start.
- Specs came first (step 5) in their own pass, so the tests had a fixed contract. Where the plan and api.md disagreed (sort order, the duplicate-name message), the implementer followed the spec.
- The unit tests caught a real bug before any UI existed: re-pinning a pinned built-in moved it to the end of the pin list.
- Spawning the built `dist/main.js` in the backend e2e makes "survives a restart" a real process restart, not a module reload.
- A test-only `E2E_BACKEND_PORT` with a renderer route let Playwright run beside the user's app without touching product code (BA-109 stays its own bug). It was proven with nothing on 3000, where a broken redirect would show "Backend unreachable".

### What went wrong
- `npm ci` failed in the fresh worktree: `main`'s lockfiles are out of sync with `package.json` for npm 11.19 (`Missing: @hono/node-server`). I used `npm install` and restored the lockfiles so the churn stays out of the epic.
- Jest can't boot `AppModule`, because ESM-only packages (`@sindresorhus/slugify`, `uuid` through `thrift`) sit under Mastra and the Databricks driver. The plan's in-process e2e pattern didn't work and the e2e had to spawn the built server.
- The implementing subagent ran `pkill -f "dist/main.js"`, which also matched its own shell. It hit nothing else only because port 3000 was already free.
- `docker compose up` from the worktree recreated the shared Postgres container, because the compose file path differs from the main checkout's. The named volume kept the data (15 tables checked afterwards).
- The user stopped the implementing agent mid-task and its unverified state was reported as partial. It then resumed and finished, so its report had to be re-verified gate by gate.
- `agents.service.ts` and `agents.controller.ts` weren't prettier-clean or eslint-clean at base (eight pre-existing errors, six still on unchanged lines). This hides real issues in the touched files.

### What to do differently
- Run backend e2e tests that need the full app against `node dist/main.js` started on a free port with a temp `APP_DATA_DIR`, after `npm run build`. Don't try `Test.createTestingModule({ imports: [AppModule] })`.
- Stop a process you started by the PID you captured (`$!`), never with `pkill -f <path>`.
- In a new worktree, run `npm install` and then `git checkout -- */package-lock.json` instead of `npm ci`, until the lockfile drift on `main` is fixed in its own change.
- Expect `docker compose up` from a worktree to recreate the shared container. Check `docker ps` and run a `psql` table count afterwards rather than assuming the data survived.
- When a stopped subagent resumes and reports, re-run its gates before committing (build, unit tests for the touched modules, the story's e2e, `check-specs.py`).

## 2026-10-09 — 1.9.1 Agent Hub: ADR, epic spec and roadmap (BA-151)

### What went well
- Searching Jira for existing epics before proposing one found BA-141 ("Agentic Hub look and feel"). Its spec rules out new features, which confirmed the hub needed its own epic and showed which components to build on.
- Checking the mockup against `vision.md` before drafting surfaced a conflict: "My team", "Whole org" and owners need people, and the app is "not multi-user". Two rounds of multiple-choice questions settled the agent model, sharing, lifecycle and placement before anything was written. That applied the BA-112 lesson of asking how a feature is scoped before drafting the epic.
- Reading agents.md §4.1 (per-turn system context blocks) before writing ADR-0008 gave a concrete seam for user instructions that keeps the prompt's identity line and the code-level guards intact.

### What went wrong
- `jq` was missing again, as recorded in the 0.2.5 entry, and had to be fetched into the scratchpad.
- In the new worktree, `jira.sh` failed: `.env` lives only in the main checkout. Evidence capture needed a second run with the main checkout's script.
- The first spec check failed: the epic spec linked to `../BA-141/spec.md`, which exists only on BA-141's unmerged branch.
- `git worktree add -b … origin/main` set the epic branch to track `origin/main`, so a bare `git push` could have targeted main. I had to unset it.

### What to do differently
- From a worktree, call Jira through the main checkout's script (`/home/jhonbuendia/projects/bi-assistant/.claude/skills/jira/scripts/jira.sh`), or symlink `.env` into the worktree first.
- Link a sibling epic's spec only once it is on `main`. Until then, link its Jira issue.
- Create epic worktrees from the local `main` ref (`git worktree add … -b <branch> main`), as the convention shows, or run `git branch --unset-upstream` right after creating from `origin/main`.

## 2026-10-09 — 1.8.8 Align with the Insight Agent AI Figma design (BA-158)

### What went well
- The Figma MCP returned exact variables (colours, type, radii, shadows) and the assets. Tokens came straight from the design team's names, with the variable name in a comment next to each value.
- The decisions that contradicted earlier answers (name, LenAI, layout) were settled in one four-question picker before any code, and the epic spec went back to Draft for re-confirmation, as the Epic gate requires.
- A side-by-side image of the Figma frame and the running app made the review concrete. It caught the stretched sparks icon, the centred 860 px column and the all-blue rail icons, none of which a test would have flagged.
- Contrast was checked with alpha compositing before shipping. It caught that Figma's own placeholder colour fails AA on the canvas and on selected rows.

### What went wrong
- The 1.8.1–1.8.7 work was built against a single image while the Figma file existed. A lot of the palette and layout work was then redone.
- The Figma background photos were 8.4 MB of PNG. Without re-encoding they would have shipped in every installer and in the npm package.
- My throwaway evidence script stalled twice for minutes, both times straight after a full suite run, while the same steps in the real suite passed. I never found the cause, because it passed on the reruns.
- Moving the details panel to on demand broke an agents E2E and two unit tests that assumed it was open on launch. The step-6 impact analysis missed them, because I searched specs for shell selectors, not for the panel's default state.

### What to do differently
- At the start of any look-and-feel epic, ask whether a Figma file exists, and implement from its variables, not from screenshots.
- Re-encode any raster asset over 500 KB (WebP at the same pixel size) before committing it under `public/`.
- When changing a default state (open/closed, selected), grep the tests for the element's selectors (`Details panel`, `right-panel-resize-handle`), not just the specs, during the impact analysis.
- Give evidence scripts a short `--timeout` (60 s) so a stall fails fast, and capture the error context before deleting the temp spec.

## 2026-10-09 — 1.8.5–1.8.7 Sessions pane and full restyle (BA-146, BA-147, BA-148)

### What went well
- Three subagents restyled about 1,600 colour usages in parallel. Each had a disjoint file list, one shared mapping table, and a rule not to build, so no two agents fought over `dist/` or the same file.
- I didn't trust the agents' self-reports. A script stripped every class attribute and diffed each template against HEAD: 0 non-class changes across 18 files. That is a cheap, strong check for any mechanical restyle.
- The new axe scan of every screen in both themes found real, existing accessibility bugs: unnamed icon buttons, and toasts outside any landmark.
- Reviewing the screenshots by eye caught layout regressions that the tests didn't: `field`'s `width: 100%` squeezing a header, and an input that lost its icon padding.

### What went wrong
- Moving the shared classes to `@layer components` broke every button and field. Angular inlines critical CSS ahead of the main stylesheet, and that inlined subset declared `components` before `base`. It took a probe in the browser, listing the matched rules and their layers, to find it.
- My first decision to make the shared classes `@utility` caused the problem the agents patched with `!` overrides. The cascade design should have been settled in 1.8.4.
- The agents' swap of classes for `field` silently changed widths and padding. "Classes only" doesn't mean "layout only".
- Shared files (ui.md, the app-shell spec, the roadmap, the changelog) collected changes from three stories at once. Without interactive staging, they went into the last story's commit instead of each story's own.
- Two unit tests and one E2E spec asserted colour class names, so they had to change with the restyle.

### What to do differently
- Put shared CSS component classes in `@layer components`, and declare the layer order in `index.html` before any style, whenever Angular's `inlineCritical` is on.
- After a mechanical class swap, screenshot every screen in both themes and review them before running the suite. Check `width`, `padding` and `display` as well as colour.
- Assert semantics in tests (role, `aria-pressed`, the result text), not colour class names.
- When several stories land on one branch, commit each story as soon as it is green, before starting the next, so the shared spec files can be committed per story.

## 2026-10-09 — 1.8.3 Agentic Hub shell (BA-144)

### What went well
- Keeping the accessible names the tests already used ("Datasets", "Agents", "Settings", "New conversation", `session-<id>`) on the rail limited the E2E churn to removing "Back" and opening Sessions first.
- The axe scan of the initial shell found three real problems: content outside landmarks, multiple `h1`s, and colours read mid-transition. Each is now a rule or a fix rather than a lucky pass.
- Generating the new template from line ranges of the old one kept every view block byte-identical, so only the shell changed.
- When port 3000 turned out to belong to another worktree's app, I identified the owner from `/proc/<pid>/cwd` and moved this epic's app to 3141, instead of killing a process that wasn't mine.

### What went wrong
- My first template generator used a line range that was off by one. It failed an assertion, luckily before writing anything.
- I wrote the first rail test against "All agents", which is the back link inside an agent's detail, not text on the list.
- `requestAnimationFrame` was called unbound ("Illegal invocation"). The E2E passed anyway because the attribute was set before the throw. I only caught it on review.
- `main` changed the E2E target in the middle of the story (BA-156). I had to stash, merge, port the spec and re-apply the work.

### What to do differently
- Before asserting on page text in a new test, grep the component templates for the string to see which view renders it.
- Never pass DOM methods around detached (`const f = window.requestAnimationFrame`). Call them on `window`, and unit-test the code path that uses them.
- At the start of each story on a long-lived epic branch, run `git fetch && git log HEAD..origin/main --oneline`, and merge `main` before writing code, not halfway through.
- Before starting any app on a fixed port, check who owns it (`ss -ltnp`, `/proc/<pid>/cwd`) and pick a free port if it's another worktree's.

## 2026-10-09 — 1.8.4 Shared component classes (BA-145)

### What went well
- Building the classes before the shell meant the screen stories only need to swap class names, which makes the parallel restyle in 1.8.6 and 1.8.7 practical.
- Checking which classes landed in the built CSS caught that `chip`, `field` and `menu` were emitted without being used. That led to checking for name collisions before shipping, rather than finding them in a restyled screen.

### What went wrong
- I first read "present in the CSS" as proof that the classes were in use. Tailwind v4 emits any candidate name it finds in source text, including comments, so the check only proves the class compiles.
- The full E2E suite needs port 3000, so testing meant stopping the user's running app again.

### What to do differently
- Give shared utility classes names that can't appear as plain words in comments, or search the templates for the bare class name before relying on the CSS output.
- Batch the stories' E2E runs so the user's app is stopped as few times as possible, and say up front when it will be down.

## 2026-10-09 — 1.8.2 Design tokens and light/dark theme switch (BA-143)

### What went well
- Checking contrast with a script before writing any CSS meant the token table went into `ui.md` already AA-clean, and the axe scan of the new section passed on the first green run.
- A static preview of the mockup's layout using the real `tokens.css` let the user judge the derived dark palette in context, before any screen was restyled. The Appearance section alone would have shown only four tokens.
- Running the failing unit test on a throwaway worktree of `main` proved that the 525/548 failure was there before this branch, instead of assuming it.

### What went wrong
- I didn't expect `emulateMedia` to be needed. Electron's `nativeTheme.themeSource` doesn't change `prefers-color-scheme` on Linux, which cost a probe run.
- The radio inputs were `sr-only`, so Playwright couldn't check them. I had to rework them into invisible overlays.
- The first screenshots were taken mid-way through the `transition-colors` animation and showed the wrong pill as selected. I almost reported a bug that wasn't there.
- `npm run lint` in the backend runs `eslint --fix` and silently rewrote 29 untouched files. I only noticed because a later `git diff --stat main -- backend` was unexpectedly non-empty.
- The environment had several gaps (`make`, `g++`, `libnss3`, `libasound2`, no Chromium for Karma), and each needed a separate round with the user.
- The E2E helper hardcoded port 55432, so the isolated stack the user asked for couldn't work without a test-infrastructure change.

### What to do differently
- To simulate the OS theme in Electron E2E, use `page.emulateMedia({ colorScheme })`, not `nativeTheme.themeSource`.
- For visually hidden form controls that tests drive, use a transparent overlay (`absolute inset-0 opacity-0`), not `sr-only`.
- Before an evidence screenshot after a state change, move the pointer away and wait for transitions to finish (about 500 ms).
- Run the backend lint as `npx eslint "{src,apps,libs,test}/**/*.ts"` (without `--fix`) when checking, and check `git status --short backend` afterwards.
- On a fresh WSL machine, check the whole toolchain in one go before the first build: `make`, `g++`, `jq`, `ldd node_modules/electron/dist/electron | grep 'not found'`, and a Chromium for Karma. Then ask for one combined `apt install`.

## 2026-10-09 — 1.8.1 Agentic Hub look and feel: ADR, epic spec and roadmap (BA-142)

### What went well
- Reading `ui.md` §6 before drafting showed the renderer has no tokens or CSS variables, only hardcoded greys. That made the theme switch an architectural decision (ADR-0007), not just restyling.
- Checking `delivery.md` before writing up the rename found that `productName` also sets the Electron data directory. It went to the user as a decision instead of turning into a silent data move.
- The epic was the first one started under the new one-branch-per-epic rule, so its branch and worktree were created once, for BA-142.

### What went wrong
- Jira took several rounds to unblock. The `.env` token had expired, `jq` was missing, `sudo` failed under the `!` prompt, and the Atlassian connector can only be authenticated from `/mcp`. Only the user's screenshot of the token page showed every token had expired.
- The user's answers about the dark theme contradicted each other ("Keep current dark" in the picker, then "2. yes" to a derived dark theme typed during the same turn), which cost an extra round.
- I asked several open questions in plain text and others in the picker, so answers arrived out of order and by number.

### What to do differently
- When Jira returns 401, have the user open https://id.atlassian.com/manage-profile/security/api-tokens straight away and check the token's expiry before any other diagnosis.
- Ask every open question for one decision through a single picker call, not mixed with numbered questions in the text, so answers can't conflict.
- For any rename, check `productName`, the data dir and the installer names in `delivery.md` first, and state which of them the rename covers.
## 2026-10-09 — 0.2.7 Local test deploys check the default ports first (BA-157)

### What went well
- The rule came straight from an incident in the same session: a subagent's `pkill -f "dist/main.js"` also matched its own shell. It was written while the details were fresh.
- The rule was set aside as a patch file, not left as an edit on the Agent Hub epic branch. So it ships under its own epic (BA-89), as the branching convention requires, and the epic branch could merge `main` on a clean tree.

### What went wrong
- The rule was first written straight into the BA-150 worktree's CLAUDE.md, on the wrong epic's branch. Its own Jira story only came afterwards.
- The BA-89 epic branch had been merged and deleted, so a second branch with the same name was opened for one small story.
- The commit was pushed to the branch after its PR (#62) had merged, and no new PR was opened, so it sat off `main` for a day until a worktree audit on 2026-10-10 found it and it was replayed onto a fresh branch from `main`.

### What to do differently
- When the user asks for a CLAUDE.md or process rule in the middle of another epic, create the BA-89 story and its branch before editing CLAUDE.md, rather than editing on the current epic's branch.
- Before starting any local server for the user, follow the new rule: check the default ports and record the PID you'll stop.
- After pushing to a branch, check `gh pr list --head <branch> --state all`; if its PR is already merged, restart the branch from `main` and open a new PR in the same turn.

## 2026-10-09 — 0.2.6 E2E and testing run against the web app; desktop only on request (BA-156)

### What went well
- Before asking questions, I read the fixture and the specs. That showed the suite was Electron-only, so the questions offered "rule + web harness" rather than a rule nobody could follow.
- The web harness reuses the npm CLI, which has the same app-secret and data-dir semantics as the Electron main process. The LLM-settings secret-migration tests passed on web unchanged, apart from how they launch the app.
- Branching per target inside the fixture (`app.target`, `restartCli()`, `desktopOnly()`) kept the Gherkin target-neutral where the user's action is the same ("reload the application") and split it only where the UI differs (the restart notice).
- The full web suite takes about 2 minutes and needs no free port 3000, so it never collided with the other worktrees' running apps.

### What went wrong
- The worktree had no `node_modules`, so my first `npx prettier` and `npx tsc` pulled packages from the registry. `tsc` resolved to an unrelated package. I had to re-run prettier with the repo's own version.
- `npm ci` refused both lockfiles under npm 11.19 ("Missing: … from lock file"). I used `npm install` and restored the lockfiles. The installed tree may differ slightly from the lockfile, and npm 11 blocked install scripts (including Electron's binary download), so a desktop run from this worktree may need `npm rebuild electron` first.
- I changed desktop code paths (the fixture's Electron launch, the port check, the `file://` reload) without running them. The user asked for that, but those paths are now only type-checked.
- `world-cup-workflow.spec.ts` hid a desktop-only step (navigating to the `file://` entry) inside a target-neutral scenario. The first web run found it, not the code reading.

### What to do differently
- In a fresh worktree, install dependencies before running any `npx` tool. If `npm ci` fails on lockfile sync, use `npm install` and then `git checkout -- */package-lock.json`, and say so in the evidence.
- When adding a second Playwright target, grep the specs for target-specific navigation (`file://`, `pathToFileURL`, `electronApp`, `window.desktop`) before the first run.
- For any change to desktop-target E2E code, ask whether to do one desktop run before shipping. Otherwise list exactly which desktop paths are only type-checked.

## 2026-10-09 — 0.2.5 One branch and one PR per epic (BA-149)

### What went well
- Reading `version-on-merge.yml` before asking the questions showed the bump reads every commit since the last tag. So one epic PR with mixed commit types needed no workflow change, only a naming rule for the branch type.
- Four multiple-choice questions settled naming, traceability, bugs and Jira tracking in one round, before any file was touched.
- This change was itself made on the BA-89 epic branch, so the new rule was used from its first commit.

### What went wrong
- `jq` isn't installed in this WSL environment, so `jira.sh` failed on the first call. A static `jq` binary had to be fetched into the session scratchpad.
- The request said "design epic". I read it as "any epic" (probably a dictation slip) and never confirmed it. None of the four questions asked about it, so the rule assumes it covers every epic.

### What to do differently
- At the start of a Jira task, run `command -v jq` along with `jira.sh whoami`. If `jq` is missing, put the static jq-1.7.1 binary on `PATH` for the session before any Jira call.
- Before starting any story, look for its epic's open branch (`git branch -a --list '*/<EPIC-ID>-*'`, `git worktree list`) and continue there. Only create a branch for the epic's first story.

## 2026-10-05 — 1.7.9 Fixed default APP_SECRET fallback (BA-106)

### What went well
- The root cause came from the diagnostics alone. Boots with and without the `APP_SECRET not set` warning, plus the `.app-secret` file time, showed the secret had changed under existing data. No reproduction was needed to explain it.
- A local LenAI stub (an OpenAI-compatible `/chat/completions` returning `{"status":"ok"}`) made the real save flow testable in E2E with no provider key. It also lets the test assert which key the backend actually sent.
- Relaunching the app on the same `appDataDir` with a different `APP_SECRET` reproduced the bug exactly. The red run showed the same `Unsupported state or unable to authenticate data` as the user's report.
- Extending BA-106, rather than filing a separate bug, kept removing the dev default and migrating data sealed with it in one change. Shipping the first without the second would have broken old installs again.

### What went wrong
- The Jira script needs `JIRA_*` in this workspace's `.env`, which a fresh Conductor workspace doesn't have. I had to read them from a sibling workspace's `.env` for the command.
- Running prettier on the whole template reformatted unrelated lines, because the file was not prettier-clean at base. I had to revert and reapply the change by hand.
- An earlier `sed` on `llm.service.spec.ts` also matched a pre-existing line (`expect(repository.save)`). It was harmless (one lint error fewer) but outside the intended edit.
- The real-data check couldn't prove the migration: the user had already re-entered the key, so the stored ciphertext was under the new secret. Only the E2E and unit tests prove the legacy path.
- Port 3000 was held by the user's running dev app, which had to be stopped before the E2E run.

### What to do differently
- Before using prettier on a file you're editing, check whether the base version is already prettier-clean (`git show HEAD:<f> | npx prettier --stdin-filepath <f> | diff - <(git show HEAD:<f>)`). If it isn't, only hand-format the lines you add.
- Anchor `sed` replacements to unique text, or use a Python replacement that asserts exactly one match.
- Before a real-data check on a copy of a data dir, first find out which secret opens the stored ciphertext. That shows whether the check can prove the path you care about.
- Any change that alters how a stored secret is derived must ship with a migration for values sealed under the old derivation, plus an E2E that relaunches on the same data dir with the new derivation.

## 2026-10-05 — 0.3.7 Developer docs for the local observability stack (BA-118)

### What went well
- Following the guide literally through the **npm CLI** path covered `cli.ts`'s telemetry start, which no earlier story had run against the real tools: save, restart the CLI, and see Loki and Tempo data.
- Before writing that Loki's `trace_id` opens Tempo, I read the Grafana Loki datasource's `derivedFields`, so the docs name the actual "Trace: <id>" link.
- The guide links to `delivery.md` for ports, tags and isolation instead of copying them, so the facts stay in one file.

### What went wrong
- The BA-114 compose profile was on a sibling branch, not in the 113→117 chain, so the docs branch needed a merge. That produced conflicts in changelog.md and retrospective.md, because every story inserts at the top of the same sections.
- The first Tempo check of the CLI run came back empty 15 s after the requests and looked like a CLI bug. The traces appeared 30–50 s later. That's the same ingest-lag lesson as BA-115, applied too impatiently.

### What to do differently
- For an epic delivered as stacked PRs, chain *every* story linearly (including independent ones like a compose profile), so the last branch holds the full stack without a merge.
- When a shared file takes one entry per story (changelog, retrospective), expect top-of-section conflicts on every stacked merge. Resolve by keeping both sides in story order, then run `python3 scripts/check-specs.py`.
- Wait at least 45 s and search a 5-minute window before concluding that traces are missing from Tempo.

## 2026-10-05 — 0.3.6 Backend logs exported with trace ids (BA-117)

### What went well
- Before building, I checked the planned `nestjs-pino` approach against the epic's "off changes nothing" rule. It would have changed Nest's console output to JSON for every user and broken the system-logs panel's parsing. I recorded the change of approach in the roadmap and changelog instead of following the plan silently.
- A normalized diff of the console output with the setting off and on caught a real regression. The first custom logger dropped Nest's `+Nms` suffix, because Nest adds it only through its own per-context logger instances. Wrapping the shared `ConsoleLogger` prototype fixed it.
- The Loki → Tempo check followed one real trace id from the log line back to its root span, which proves correlation rather than assuming it.

### What went wrong
- I wrote the first version (a `ConsoleLogger` subclass passed to `NestFactory.create`) before reading how Nest prints `+Nms`. It cost one build-and-diff round.
- I ran a probe script under `timeout`, which macOS doesn't have (exit 127), and its output was swallowed by a `grep`. That cost two silent runs.
- A Loki match on "Mastra" looked like a Pino log but was really a Nest line ("MastraModule dependencies initialized"). I needed a separate probe to verify Pino export.

### What to do differently
- Before replacing or wrapping a framework logger, diff its console output with the change and without it (normalize timestamps and PIDs). Treat any difference as a regression wherever stdout is parsed (the Electron system-logs panel parses it).
- On macOS, don't use `timeout`. Let the script `process.exit()` itself, and capture its full output to a file before grepping.
- When checking that a specific producer's logs were exported, emit a unique probe string from that producer and search for exactly that string.

## 2026-10-05 — 0.3.5 Agent trace export to Arize Phoenix gated by the developer setting (BA-116)

### What went well
- Before installing, I mapped `@mastra/arize` → `@mastra/otel-exporter` → `@mastra/observability` versions. That showed the latest arize (1.3.21) would bring in observability 1.18.3 next to the pinned 1.17.8, and that 1.3.16 matches exactly (`npm ls` shows it deduped).
- A failing agent run (no model configured, `OPENAI_API_KEY` removed) gave a deterministic, cost-free real agent trace for both the E2E and the real-Phoenix check.
- Comparing `require.cache` for the built `dist/mastra/index.js` with the setting off and on proved the off-path loads nothing. That is stronger than the unit test alone.
- Screenshots of the real Phoenix UI were taken by navigating the Electron window to `http://localhost:6006`, with no extra browser install.

### What went wrong
- `mastra/index.ts` builds the `Mastra` instance at import time, so a lazy `await import()` was impossible there. It needed a guarded synchronous `require` with an eslint disable, which is easy to "tidy" back into a static import by mistake.
- The E2E's `delete process.env.OPENAI_API_KEY` affects the shared Playwright worker. It has to be restored in `afterEach`, or later spec files would silently lose a developer's key.

### What to do differently
- Before adding any `@mastra/*` package, run `npm view <pkg>@<v> dependencies` down to `@mastra/observability` and `@mastra/core`, and pick the version that dedupes against the repo's pins.
- Keep the comment above the `require('@mastra/arize')`. If a static import ever comes back, the `require.cache` check (setting off → no `@opentelemetry`) catches it. Re-run it after any change to `mastra/index.ts`.
- Any E2E that changes `process.env` must restore it in `afterEach`, because workers are shared across spec files.

## 2026-10-05 — 0.3.4 OpenTelemetry bootstrap gated by the developer setting (BA-115)

### What went well
- Writing the "off" scenario first, as a guard that already passed, made the off-by-default promise testable. The real proof (nothing on the wire for 12 s) sits next to the unit test (no `@opentelemetry` module in `require.cache`).
- The E2E uses a local stub OTLP receiver rather than Docker, so it is fast and deterministic. The real-tool check against `otel-lgtm` was a separate step with its own evidence.
- All OpenTelemetry versions were pinned to the set that `@mastra/arize` already depends on (0.222 / 2.11), ahead of BA-116.

### What went wrong
- The first Tempo search returned no traces. Without `start`/`end`, the search API only covers a short recent window, and ingest lags by a few seconds. I nearly suspected the exporter.
- `npx tsc --noEmit -p tsconfig.json` reports a pre-existing error in `test/app.e2e-spec.ts`. It is noise that hides real type errors. `nest build` uses `tsconfig.build.json` and is the check to trust.
- npm 11 blocked `protobufjs`'s postinstall script with an "install-scripts" warning. It's harmless here, but it went unexplained until I checked.

### What to do differently
- To query Tempo through Grafana, always pass `start` and `end` (epoch seconds) and wait at least 15 s after the request. Use TraceQL `q={span.db.system.name="postgresql"}` to find database spans.
- Type-check the backend with `npm run build` (or `npx tsc -p tsconfig.build.json --noEmit`), not the root tsconfig.
- Verify developer-observability stories against real tools with a backend on another port (`APP_DATA_DIR=<tmp> PORT=3123 node dist/main.js`). Port 3000 stays free for the E2E suite.

## 2026-10-05 — 0.3.2 Developer settings panel with observability toggle (BA-113)

### What went well
- The E2E spec was written before the code and failed for the right reason (no "Developer" row). It then drove the whole UI contract: labels, `role="switch"`, test ids and the restart notice.
- The "Test" probe used an empty OTLP protobuf body. The BA-114 subagent independently found that Phoenix returns 415 to JSON and 200 to protobuf, which confirmed the choice before any real tool was wired up.
- The probe uses `node:http` instead of `fetch`, because the global fetch carries model-call retries (`retry-fetch.ts`). Without that, a 503 from an endpoint would have been retried for about 7 s.
- The restart-done check waits for the status to leave `ready` and come back. This avoids reloading against the old, dying backend.

### What went wrong
- `npm run lint` is `eslint --fix`. Running it as a check rewrote 29 unrelated backend files, which I then had to revert.
- `getByLabel('Phoenix endpoint')` also matched the "Test Phoenix endpoint" button through its aria-label substring. That cost one E2E round.
- The first full E2E run had 2 `agents.spec.ts` failures. The shared Postgres had been stopped, and global setup's `--wait` returned before Postgres accepted TCP logins. That cost a diagnosis and a rerun.
- The probe result first rendered with a leading space, because `whitespace-pre-wrap` kept the template indentation. The screenshots caught it, not the tests.

### What to do differently
- To check lint without side effects, run `npx eslint "{src,apps,libs,test}/**/*.ts"`, never `npm run lint`. Check changed files with `npx eslint <paths>`. Compare against the pre-existing count (234 problems on this base).
- Use `{ exact: true }` on `getByLabel` whenever a nearby control's aria-label contains the field's label.
- Before a full E2E run, make sure the compose Postgres is warm, by running `docker compose up -d --wait postgres` and then one `psql`/TCP check. If the first spec fails at "Connection successful", rerun that spec alone before suspecting the change.
- Don't use `whitespace-pre-wrap` on elements whose text comes from a multi-line interpolation, unless the message really has line breaks.
## 2026-10-05 — 0.3.3 Docker Compose observability profile (BA-114)

### What went well
- I checked the real Docker Hub tags before pinning. `arizephoenix/phoenix` has no plain `0.x` tags (they are `version-N.M.P`), so a guessed tag would have failed to pull.
- I ran every claimed behaviour against the real images: both profile listings, startup, UI, Grafana health and both OTLP endpoints. That is where the protobuf-only finding came from.
- On the shared stack I stopped and removed only the two new services and never ran `down`, so the user's Postgres container was untouched.

### What went wrong
- The brief's OTLP check (`-d '{"resourceSpans":[]}'` as JSON) returned 415 from Phoenix. I would have logged a failure or silently dropped the check if I had treated the brief's command as the definition of "works". Phoenix accepts only protobuf on `/v1/traces`.
- The project already had an unrelated orphan container (`postgres-f1-1`), so compose printed an orphan warning on every command. Running with `--remove-orphans` would have deleted another session's container.
- I assumed Phoenix would need a healthcheck and did not look for one in the image first. It has none, so `--wait` only waits for "running".

### What to do differently
- When a brief gives a verification command, run it, and if it fails, find out whether the command or the service is wrong before recording a result. Record the real protocol requirement in the spec for the next story.
- Never pass `--remove-orphans` on the shared compose project; other worktrees and sessions create containers in it.
- For 0.3.5, build the Phoenix exporter with the protobuf OTLP exporter, not the JSON one.

## 2026-10-05 — 0.3.1 Plan local development observability (BA-112)

### What went well
- Before planning, I read the existing setup (`mastra/index.ts`, `storage.ts`, the entry points). It showed that Mastra already exports to DuckDB, so the plan adds Phoenix next to it rather than replacing it.
- Four short multiple-choice questions settled visibility, restart, endpoints and DuckDB in one round, before the epic spec was written.
- The OpenTelemetry load-order constraint shaped the ADR: the setting goes in a file, read before the app is imported. It wasn't left as a surprise for BA-115.

### What went wrong
- The first epic draft gated observability on an env var. The user wanted a Developer toggle in Settings, so the epic was rewritten after it was created. I hadn't asked how a developer would switch it on.
- The workspace had no `.env`, so the first Jira call failed. The user had to create a token mid-task.
- `jira.sh` has no command to update a description or set `parent`. I re-sourced its `adf()` helper and used `raw`.

### What to do differently
- For any "developer-only" or opt-in feature, ask how it is switched on (setting, env var, build flag) and who can see it, before drafting the epic.
- At the start of a Jira task in a new Conductor workspace, run `jira.sh whoami` first. If it fails, offer to create `.env` from `.env.example` straight away.
- To set a parent or edit a description, build the body with `source <(sed -n '/^adf() {/,/^}/p' jira.sh)`, then `jira.sh raw POST|PUT … "$body"`.

## 2026-10-05 — 0.2.4 follow-up: release tag started an installer build (BA-110)

### What went well
- Watching the first release run, and listing every run on the bump commit, caught the unwanted build within a minute. It was cancelled before it published a release.

### What went wrong
- The 0.2.4 spec said "no workflow listens for tags". I wrote that from a 4-line `grep -A4 '^on:'` that cut off `build-desktop.yml`'s `push: tags: v*` trigger. The deploy key changed who pushes the tag, and so whether workflows start, and I checked that change against a truncated view.

### What to do differently
- When a change alters which credential pushes refs (`GITHUB_TOKEN`, deploy key, PAT), read every workflow's full `on:` block and list the push, tag and `workflow_run` triggers it could start. Do it before writing the *Chaining* spec, not after the first run.
- After any release-workflow change, run `gh run list -c <bump sha>` and `gh run list -w build-desktop.yml -L 3` right after the release run, and treat any unexpected run as a regression.

## 2026-10-05 — 0.2.4 Require PR approval on main (BA-110)

### What went well
- Before writing anything, I spotted that a "require PR" rule would also block the release workflow's direct push to `main`. The deploy-key design then came from the 0.2.3 lesson that GitHub Actions can't be a bypass actor in a personal-account repo.
- The throwaway-branch probe from 0.2.3 was reused, and it proved all four behaviours before `main` was touched: the admin's direct push is rejected, a deploy-key push is accepted, an unapproved PR is blocked, and the admin can merge it with `--admin`.
- The new rule is a separate ruleset, so the admin bypass doesn't weaken the spec check.

### What went wrong
- The Conductor `GH_TOKEN` is an integration token without admin rights, so creating the deploy key and the ruleset failed with HTTP 403. The user had to log `gh` in as the owner mid-task.
- The first deploy-key push looked like a failed bypass. ssh had offered the user's own key from `~/.ssh/config` and authenticated as the user ("Hi jhon-buendia-halo!"), not as the deploy key.
- Shell slips in zsh cost three retries:
  - `"$c1:refs/..."` was rewritten by zsh's `:r` modifier.
  - `G="env -u GH_TOKEN gh"; $G ...` doesn't word-split in zsh.
  - `jira.sh raw` was given a JSON file path when it expects the JSON inline.
- The CLAUDE.md change asked for earlier in the session needed no edit, because the rule already existed. Reading the current text before planning settled that in one question.

### What to do differently
- For any repo-admin action (rulesets, deploy keys, secrets), run `unset GH_TOKEN` first and check `gh api repos/<r> -q .permissions.admin` is `true` before starting.
- To test a deploy key, use `ssh -F /dev/null -i <key> -o IdentitiesOnly=yes -T git@github.com` and confirm the greeting names the repo, not a user, before trusting a push result.
- In zsh, always brace variables next to a colon (`"${sha}:refs/heads/x"`).
- Pass JSON to `jira.sh raw` inline: `jira.sh raw POST /rest/api/3/issue "$(cat body.json)"`.
- Turn on a ruleset that changes how the release pushes only right before merging the PR that changes the release workflow, so no other merge runs the old workflow against the new rule.

## 2026-10-04 — 0.2.3 Require the spec check on main (BA-108)

### What went well
- Testing the ruleset on a throwaway branch before touching `main` paid off. A temporary ruleset on `ruleset-test` confirmed both behaviours in two pushes: a push without the status is rejected, and a staged push with a reported status is accepted. The release workflow was designed around that confirmed behaviour, not a guess from the docs.
- actionlint caught nothing, but it ran on both workflows before the PR, using the release binary instead of a stalled Docker pull.

### What went wrong
- The obvious design failed: adding GitHub Actions as a ruleset bypass actor is rejected for personal-account repos with "Actor GitHub Actions integration must be part of the ruleset source or owner organization". That cost a round trip.
- I ran `git checkout origin/main -- .` to read a file. It overwrote the working tree with `main`'s version files. Nothing was lost only because the tree was clean and the diff was just the release bump.
- The release path with the ruleset active can only be proven by a real merge. The probe covers the push semantics but not the workflow itself.

### What to do differently
- To read a file from another ref, use `git show <ref>:<path>`, never `git checkout <ref> -- .`.
- Before designing around a GitHub bypass list, check the repo owner type (`gh api repos/<r> -q .owner.type`). Personal-account repos can't add GitHub Actions or other apps to bypass lists, so plan for the "stage, report status, push" pattern.
- After merging a change to a release workflow, watch the next release run to completion and record it in the evidence.

## 2026-10-04 — 0.2.2 Rebuildable system specs (BA-90)

### What went well
- Agreeing the format before any backfill paid off. `specs/README.md`, with its templates and stack-neutrality rule, was written first, so 11 parallel agents produced 33 consistent files.
- A scripted acceptance check (`evidence/0.2.2/spec-checks.py`) verified the claims mechanically:
  - every link resolves;
  - every Gherkin Feature moved verbatim into exactly one capability spec;
  - every route, collection and agent is covered.
- Reading the code to write specs worked as an audit. It surfaced a token-redaction leak, a visual version collision after revert, plaintext datasource secrets and an unauthenticated all-interfaces bind. All are logged in `evidence/0.2.2/findings.md` instead of being silently "specified".

### What went wrong
- The first Epic gate edits were made on the Conductor branch `jhon-buendia-halo/new-chat`, before any Jira issue existed. That broke the rule being written. The branch was renamed only once BA-90 existed.
- BA-84 had no parent epic, so the previous harness change would have failed its own new gate.
- Agent prompts said "move the Feature from gherkin.md" and also "don't touch gherkin.md". One agent edited it and the others didn't, so the move had to be finished by hand.
- An unrequested extra Feature ("Chat answers and reliability signals") was added by an agent. It is useful, but it was not asked for.
- The first version of the CI check was too weak in one place and too strict in another. Its route check matched substrings, so `/sessions` passed for any sessions route. Its E2E check treated cross-references as ownership. A drift test with injected faults exposed and fixed both.
- No E2E run: the change touches no code or tests, so the suite was not re-run. The stale `application-shell` baseline found by the UI agent is unverified.

### What to do differently
- Before the first file edit of any task, create the Jira issue and rename the branch. That applies even to "just a docs tweak", because the Epic gate has no docs exemption.
- When fanning out a move across agents, give exactly one owner the delete of the source file: either the orchestrator or one named agent. Tell all other agents "copy only".
- Every new CI check gets a drift test before it ships: inject one fault per check, confirm each check fails, then revert. A check that has never failed proves nothing.
- When a spec backfill finds a bug, record it as an Open question in the spec and in the evidence findings, then ask the user before filing Jira bugs. Never fix code inside a spec-only change.

## 2026-10-01 — Adopt delivery workflow harness

### What went well
- The harness was ported from another project and adapted to this repo's real layout (Playwright-on-Electron in `frontend/e2e/`, Jest in `backend/`, phase plans in `docs/plans/`) instead of copied verbatim.

### What went wrong
- `gherkin.md` was seeded from existing E2E test titles only; the Given/When/Then steps are not written yet, so it is not yet a full spec.
- The phase plans in `docs/plans/` have unknown completion status, so they were parked in the roadmap Backlog rather than sequenced.

### What to do differently
- The first time a change touches a seeded Gherkin feature, write that feature's full Given/When/Then steps as part of step 5.
- Before starting work from a `docs/plans/` phase, confirm with the user which items already shipped, then promote the remainder into a milestone.
