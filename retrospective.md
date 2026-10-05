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

## 2026-10-05 — 1.3.6 Hindsight memory spike behind a lever

### What went well
- One design brief, written before any agent started, carried the names, ids, block texts and rules for three parallel agents (backend, frontend + E2E, specs). The pieces fit on the first try: the frontend's lever key and values matched the backend's, and the specs matched the code except for one heading.
- Probing the real Docker image before writing the compose file settled two unknowns the docs left open (the `/health` path and that `rrf` is accepted on the slim image) and verified the user's key at start-up without running a single retain.
- Everything sits behind `memory: off`, so the E2E suite on the branch runs with memory off and the base behaviour is unchanged; the lever test is the only new E2E.
- The port and the no-op store mean the branch costs nothing for anyone without `HINDSIGHT_URL`.

### What went wrong
- The first `.env` the user wrote held a GitHub token instead of an OpenAI key. The check on name, length and prefix caught it before the container used it; a plain "is the file there" check would not have.
- Specs and code were written concurrently from the brief instead of specs first, so one block heading and the outbox details had to be reconciled afterwards. The brief did not spell out the mental-models heading or the backoff numbers, and both agents filled the gap differently.
- The base build on port 3000 collided with the E2E global setup, which refuses a busy port 3000, so the base instance had to be stopped and restarted around the E2E run.
- `scripts/check-answers.ts` goes through `streamMessage`, so a careful-mode run of it with Hindsight on would retain `xc:` signals as if a user had asked.
- The first smoke test failed on the first question with "Unsupported state or unable to authenticate data": the LLM key in the user's profile was encrypted under the crypto service's development default (`APP_SECRET` unset), and the `.app-secret` file that now sets `APP_SECRET` was only created today, when the merged build first opened that profile. Any install that saved its key before the `.app-secret` logic landed loses it on upgrade. The demo instances run with `APP_SECRET=insecure-dev-secret`; the bug needs a Jira entry next to BA-106 and a one-time re-encryption migration.

### What to do differently
- When the brief defines a prompt block, give its exact heading text and every numeric constant (timeouts, backoff, caps); agents reproduce text literally and invent numbers inconsistently.
- Verify any secret file by variable name, value length and prefix, never by existence alone, and never print the value.
- Keep port 3000 free for E2E: run side-by-side web instances on other ports, or stop the one on 3000 before `npm run test:e2e`.
- Before enabling memory for scripted runs, decide whether `check-answers.ts` should pass `memorySignals: false`, and add the memory lever to the eval arm matrix (`memory-recall` vs `baseline`) so the next eval run measures it.
- The pin-fingerprint recompute after a 👍 re-runs recall (and was the one call that hit the 800 ms timeout in the smoke test). Make it reuse the turn's recorded `source: 'memory'` items instead of recalling again, so the fingerprint cannot drift from the turn's. In the UI, memory items show a "global" scope chip because `KnowledgeUse.datasetId` is empty; decide whether to show the datasource instead.

## 2026-10-05 — 1.3.5 Integrate business expert, feedback learning and the eval loop

### What went well
- `git merge-tree --write-tree --name-only` previewed all 30 conflicts before any branch existed, so the scope question went to the user with real numbers.
- Splitting the resolution by file ownership worked: three parallel agents (sessions + knowledge core, eval tooling, specs) with disjoint file lists and no git writes. The core agent rebuilt `sessions.service.ts` from the engine version and ported every business hunk, then checked line coverage with a script.
- Cloning `node_modules` from the source worktrees (`cp -cR`, identical lockfiles) let the agents type-check and run Jest without an install.
- The user's real profile was backed up first, then opened read-only through Playwright. That gave screenshots of the existing data on the merged build without sending a question to the model.

### What went wrong
- The first E2E run failed every test in 30 ms with "bad option: --remote-debugging-port". The VS Code terminal exports `ELECTRON_RUN_AS_NODE=1`, so Playwright started Electron as plain Node.
- Neither source branch had a Jira story, a roadmap status change or a changelog entry. The Epic gate was waived for this branch instead of being met.
- One frontend unit test (`App should support keyboard resizing from the separator`) fails on all three source branches. Nobody had noticed, because the frontend tests were not run on them.
- Backend lint already had 330 to 412 errors on the source branches. Lint is not in CI, so the debt grew unseen.

### What to do differently
- Run E2E from a VS Code terminal as `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`, or unset that variable in the Electron fixture.
- Create the Jira story and roadmap entry when a feature branch is started, not when it is integrated. Three unregistered branches of 29 commits were hard to place in one epic.
- Before integrating long-lived branches, run `git merge-tree` between them and merge them early. Two branches touching `runTurn` and `streamMessage` for two weeks produced a structural conflict, not a textual one.
- Run `ng test --watch=false` (with `CHROME_BIN` pointed at Playwright's Chromium when Chrome is missing) on every branch, not only E2E.

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
