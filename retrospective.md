# Retrospective

Lessons from each completed change, newest first. **Read this file before starting any task.** See *Retrospective convention* in [CLAUDE.md](CLAUDE.md).

Entry template:

```
## YYYY-MM-DD — <roadmap feature ID> <short title>

### What went well
### What went wrong
### What to do differently
```

---

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
