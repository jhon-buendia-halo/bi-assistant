---
name: walkthrough-video
description: Use when a change is implemented and its checks are green, right after show-the-change: record a walkthrough video of the change running in the app, with subtitles that explain what was implemented, and publish it as a Conductor artifact shown in the chat.
---

# Walkthrough video

Every implemented change ends with a short **walkthrough video**: the change running in the real app, with subtitles in the user's language that say what was built and why it matters, published as one Conductor artifact. It comes after [`show-the-change`](../show-the-change/SKILL.md) (the screenshots) and before the reply that hands the change over. The lever is [`scripts/walkthrough.mjs`](../../../scripts/walkthrough.mjs): it records one Playwright scenario with `DEMO=1`, turns each `scenarioStep` into a subtitle cue, fits the video into an artifact and writes the page. Each step below fills the workflow step named in brackets.

1. **[Checks] Pick the scenario.** Use the change's own E2E test, the one that proves it. Its steps must call `scenarioStep(page, '<Gherkin line>', …)` ([demo-captions.ts](../../../frontend/e2e/support/demo-captions.ts)), one per thing the viewer should see; plain `test.step` lines give no subtitles. If the change has no such test, write it where its Feature's E2E file lives (the capability spec names it) and keep it green. Aim for 20–60 s of video: a longer one will not fit an artifact.
2. **[Checks] Write what it explains** under `.context/walkthrough/<slug>/` (`<slug>`: lowercase letters, digits, hyphens):
   - `summary.md`: what was implemented, in the user's chat language. A heading-free first line, then 3–6 bullets: what the user can do now, what changed underneath (named plainly), and what is left out.
   - `narration.json`: `{ "<exact step title>": "<subtitle>" }`, one subtitle per step in the user's language. Each says what is on screen and why it matters, in one sentence of at most about 110 characters. A step it does not name keeps its Gherkin line.
3. **[Checks] Build the app the test drives:** `BRAND=<brand from .context/brand> npm --prefix frontend run test:e2e:prepare` to a log file. Nothing else may build or test in the worktree while the recording runs.
4. **[Checks] Record:**
   ```
   node scripts/walkthrough.mjs --spec frontend/e2e/<file>.spec.ts --grep "<test title>" \
     --title "<what was implemented, short>" --lang <es|en> \
     --summary .context/walkthrough/<slug>/summary.md \
     --narration .context/walkthrough/<slug>/narration.json \
     --out .context/artifacts/walkthrough-<slug>
   ```
   It writes `.context/artifacts/walkthrough-<slug>/index.html` (at most 2 MB) and keeps `walkthrough.webm` and `walkthrough.vtt` in `.qa-reports/walkthrough/walkthrough-<slug>/`. Exit 1 says why: a failing scenario (read its `playwright.log`), no `scenarioStep`, or a video too large (shorten the scenario).
5. **[Checks] Look at it before showing it.** Pull three frames from the kept video with Playwright's ffmpeg: one near the start, one at the change, one at the end (`<ffmpeg> -ss <s> -i walkthrough.webm -frames:v 1 frame-<n>.png`; the binary is under `~/Library/Caches/ms-playwright/ffmpeg-*`). Read each frame. Check that the change is visible and that the subtitles in `walkthrough.vtt` match what each frame shows. Fix the scenario or the narration and record again if not.
6. **[Checks] Publish** the directory with `PublishArtifact` (`directory: "walkthrough-<slug>"`), fix every warning, and embed the returned artifact in the reply.
7. **[Checks] Clean up.** Restore anything the run rewrote that this change does not own: `git status -- evidence/ frontend/e2e/*-snapshots/`. Never commit `.context/` or `.qa-reports/`.

**Reply:** the artifact, then one line on what the video shows and how long it is, then the rest of the hand-over.
