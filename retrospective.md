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
