---
name: workflow-gate
description: Use once the user has accepted a change by hand (the acceptance gate): step 6 E2E impact analysis, step 7 Playwright specs, then after step 9 is green, step 10 changelog, evidence, roadmap Done, the epic PR and post-merge cleanup, and step 11 retrospective and lessons. Also when choosing the E2E test target (web by default, desktop only on request) or publishing a demo artifact.
---

# Acceptance gate — steps 6, 7, 10, 11

Part of the workflow in [CLAUDE.md](../../../CLAUDE.md), which keeps the always-on core. Load this skill when the user accepts a change; step 9 between 7 and 10 is the `verify` skill. Scale to the change's size (**S / M / L**, defined in CLAUDE.md).

## 6. E2E impact analysis

For every component, page, service or backend module touched, enumerate the Gherkin scenarios that exercise it (and the shared E2E helpers they use) and decide per scenario: **add**, **update**, **delete** or **re-run**.

1. Draft the list: `node scripts/qa.mjs <roadmap-id> --draft-impact` writes `evidence/<roadmap-id>/e2e-impact.md` from the branch diff (every related spec as `re-run`, scenarios `TODO: review`). It never overwrites an existing file.
2. Review it: change the decisions, fill in the scenarios, add specs the diff mapping missed (helpers, shared fixtures), remove ones that don't apply.

Format: a Markdown table, first column the spec path in backticks (`` `frontend/e2e/<name>.spec.ts` ``), second the decision (`add`, `update`, `delete`, `re-run`), then the scenarios. `qa.mjs --gate` reads it and fails if a listed spec did not run.

- **S:** keep the drafted list as is unless the change adds or alters a user flow.

## 7. Write the E2E

Apply the step-6 decisions to [frontend/e2e/](../../../frontend/e2e/) (and backend `test/*.e2e-spec.ts` for API-level flows). Each added or updated scenario asserts the specific behaviour the change introduced, so it would fail on the base commit. A UI story's main scenario was already written in the story lane (tagged `@demo` and `@story-<roadmap-id>`, Given/When/Then lines as `scenarioStep` captions from `frontend/e2e/support/demo-captions.ts`); this step adds the rest.

### E2E test convention

Playwright specs hold the Gherkin steps of the Features in [specs/capabilities/](../../../specs/capabilities/) (Gherkin once: the capability spec lists only each scenario's title; existing Features keep their steps until edited): one spec file per `Feature:`. A Feature marked `E2E: none yet` gets its spec the first time a change touches it. Don't ship a flow change without its E2E change, or with an impacted spec red. Unit tests sit beside their source (`*.spec.ts`, Jest in backend, `ng test` in frontend) and are not governed by this rule. Visual baselines (`*-snapshots/`) change only with `npm run test:e2e:update` and only for an intended visual change.

### Test target convention — web by default, desktop on request

- **Web (default):** `npm run test:e2e` in `frontend/` builds the backend with the web UI and runs the Playwright `web` project. Each test starts the CLI on a free port with its own temp data dir, at 1440×900. It never touches port 3000 or your data.
- **Desktop (only when the user asks):** `npm run test:e2e:desktop`, the same specs against Electron; needs port 3000 free.
- **Desktop-only scenarios** call `desktopOnly()` and are skipped on web (`Desktop only`). List them as **"desktop not run"** in the changelog entry and PR description unless a desktop run was requested and passed.
- **Manual checks and screenshots:** the web mode (`npm --prefix backend run build:all`, then `node backend/dist/cli.js --no-open --port <free> --data-dir <tmp>`).

## 10. Changelog, evidence, roadmap, PR

Only after step 9 is green.

### Per story

- Mark the roadmap feature `✅ Done`.
- The story's evidence folder `evidence/<roadmap-id>/` holds what `qa.mjs` wrote: `tests.md`, `e2e-impact.md`, the demo (`demo.webm` or `demo.txt`). Its `README.md` is one line, `Demo: <artifact url>` (the gate checks it); add a screenshot or exported artifact only when it proves something `tests.md` and the demo don't. An S change run with `--no-demo` needs no README.
- Confirm the specs touched in step 5 describe what actually shipped; fix them on the branch if not.

### Per epic, when its PR opens

**One changelog entry per epic**, not per story, written when the epic's last accepted story has passed the gate:

- [changelog.md](../../../changelog.md): a dated section (`## YYYY-MM-DD`) with categorized subsections (`### Added`, `### Changed`, `### Removed`, `### Cut`, `### Fixed`). One bullet per story: what changed for the user, its roadmap ID, and links to `evidence/<roadmap-id>/` (`tests.md`, the demo) and its demo artifact URL. Never rewrite past entries; fix forward.
- **S changes** get a single changelog bullet in their own PR; evidence is `tests.md`, from `qa.mjs <roadmap-id> --gate --no-demo`.

### Demo artifact

A UI story's demo is shared as a Claude artifact so the video and the work description are one link ([delivery.md](../../../specs/system/delivery.md) 13). It is first published right after the wave check (`qa.mjs --wave … --demo <id>`) or the plain-session `qa.mjs --fast`, so the user can review it by hand:

1. `node scripts/demo-page.mjs <roadmap-id>` writes `evidence/<roadmap-id>/demo-page.html` from the roadmap entry, the changelog entry, `tests.md` and the demo.
2. Publish it with the Artifact tool: `file_path` = that `demo-page.html`, `files` = `{ "demo.webm": "evidence/<roadmap-id>/demo.webm" }` (omit `files` for `demo.txt`), an `icon` such as `video` on the first publish, a one-sentence `description`. Re-publishing the same story passes its `url`, so the link stays the same.
3. Record the artifact URL in `evidence/<roadmap-id>/README.md` (`Demo: <url>`), and later in the story's changelog bullet.
4. Tell the human to share the link from the page's Share menu; artifacts are private by default.

Re-publish at step 10 only when the demo changed after the wave check. Demos and evidence are recorded per wave; the acceptance gate stays per epic.

### Session handoff

One lead session per epic wave. Before starting a new session, write `.context/handoff.md` (git-ignored scratch; keep it under 30 lines) and start the new session from it:

```
# Handoff — <EPIC-ID>, <date>
Branch / worktree: <branch>, <path>
Done: <story ids merged, wave checks green>
In flight: <story ids, unit branches, who owns them>
Next: <the next wave or gate step, with the exact command>
Open questions for the user: <one line each, with the recommendation>
Traps: <anything the next session would rediscover>
```

### The epic PR

- Title names the epic: `feat(M1-22): …` or `feat: … (M1-22)`.
- Description: the epic spec link, every story and bug with its roadmap ID, the scenarios marked "desktop not run".
- Open it once every story of the epic has passed the acceptance gate; never one PR per story.
- A PR into `main` needs one approving review; only the repo owner can merge without one, through the ruleset bypass ([delivery.md](../../../specs/system/delivery.md), *Branch rulesets on `main`*).

### Cleanup — mandatory once the PR merges

From the main checkout:

```bash
git worktree remove .claude/worktrees/<EPIC-ID>-<short-description>
git worktree prune
git branch -d <type>/<EPIC-ID>-<short-description>
git push origin --delete <type>/<EPIC-ID>-<short-description>   # if GitHub didn't delete it on merge
```

Confirm with `git worktree list`. `git worktree remove` refuses when the folder holds uncommitted or untracked files: look at them first, and never discard work that isn't in the merged PR without asking. Copy git-ignored files you still need (such as `.env.llm.local`) first. Tear down the worktree's isolated resources too (a `docker compose -p` stack, a temp data dir). A worktree created by a host tool (Conductor) is removed through that tool.

## 11. Retrospective and lessons

**One retrospective entry per epic**, written when its PR opens, in [retrospective.md](../../../retrospective.md) (newest first): `## YYYY-MM-DD — <EPIC-ID> <title> (<roadmap ids>)` with **What went well**, **What went wrong** (an entry with nothing here means you didn't look hard enough) and **What to do differently** (concrete instructions, not "be more careful"). Never rewrite a past entry.

Then update [lessons.md](../../../lessons.md), the short file every task reads first:

- Add a lesson when a "What to do differently" item is likely to recur.
- Edit or remove a lesson that is stale, or that has been promoted into a skill, script or check (a lesson enforced by code doesn't need reading).
- Keep it under about 80 lines.

- **S changes:** no retrospective entry unless something went wrong; then add the lesson to `lessons.md` directly.
