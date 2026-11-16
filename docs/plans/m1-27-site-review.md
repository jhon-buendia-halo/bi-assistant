# M1-27 — Review a Website: plan (phase 1)

Requested 2026-11-16: bring what [site-mapping-agent](https://github.com/jhon-buendia-halo/site-mapping-agent) does into the app as a workflow. Same goal: **map a website and find its visual and UX defects on each screen size, signed-in pages included**. Different design (agreed in chat, wireframe v2):

- **Measure first.** Most defects the original asks a vision model to spot are measurable in the browser, with exact evidence: axe, horizontal overflow, clipped text, covered elements, tap targets, broken images, HTTP and console errors, placeholder text. Every page and screen gets these checks; each finding carries the element, the value measured against its rule, and a crop.
- **Review by template** (phase 2). The vision model looks at one page per template, desktop and mobile side by side, with numbered marks so it names elements instead of guessing coordinates.
- **Compare with the last run** (phase 3) instead of hand-uploaded design references per page.

Phase 1 makes **no model call**. It is useful alone (a measured, evidenced site report) and gives phase 2 reliable inputs.

## 1. Scope

| Phase | Ships | LLM | Size |
|---|---|---|---|
| **1 (this plan)** | Sign-in, one crawl, capture and measured checks on every page × screen, grouping by URL pattern, report visual + findings file, deterministic answer | none | M |
| 2 | Group templates by DOM fingerprint, the cost check (suspend), Iris (`site-reviewer` agent, set-of-marks, desktop + mobile per call), its evals | 1 call per template | M |
| 3 | Compare with last: findings matched by template + rule + selector, pixel diff per page | none | S–M |

Out of all phases for now: design references (Scrub), PDF export, findings as a dataset for Answer a Business Question (datasources are Postgres, Databricks and REST only).

## 2. The workflow (phase 1)

Id `review-website`, name **Review a Website**, `trigger: 'run'`, files `review-website.{steps,schemas,workflow,runtime}.ts` in `backend/src/mastra/workflows/`, the `recreate-dashboard` split. Only `.then`, `suspend` and `bail`: the stub already runs them.

```
start → prepare-session → discover-pages → capture-and-check → save-report → end
```

| Step | Kind | Does | Output (sketch) |
|---|---|---|---|
| `prepare-session` | code | Public site: passes through. Sign-in needed: loads the saved sign-in for the origin and checks it (entry URL does not land on a login page); missing or expired → opens a headful browser on the login URL and **suspends**; on resume saves the sign-in and checks again (still on login → suspends again with that message). | `{ origin, signedIn: boolean }` |
| `discover-pages` | code | BFS from the entry URL at the widest chosen screen, same origin only, `maxDepth`, `maxPages`, never following the exclusion patterns; per page: URL, final URL, status, title, depth, parent, links. Records which links each chosen screen's visible navigation shows. Session lost (a page lands on the login URL) → **bail** with `sessionLost`. | `{ pages[], skippedLinks[], sessionLost? }` |
| `capture-and-check` | code | For every page × screen: full-page screenshot to the run's workspace, then the checks of section 4, in a pool of 2 pages at a time. Progress through the step's `writer`. Groups pages by URL pattern (`/claims/123` → `/claims/:id`). | `{ captures[], findings[], groups[], coverage }` |
| `save-report` | code | Builds the report visual (self-contained HTML), stores it as a visual of the run and the findings as `site-review/findings.json` in the run's workspace (no artifact: artifacts hold dashboards only), and writes the answer from the numbers (no model). | `{ visualId, artifactId, summary }` |

Snapshots: none while running (the runtime is on the `RequestContext`); written only while `prepare-session` is suspended (`shouldPersistSnapshot` as `answer-business-question` does). The browser handle is never in the snapshot: a `SiteBrowserService` holds it by run id (30 min TTL, the R28 window); after an app restart the run is expired, as R28 already says.

`turn-engine.ts` gets the `review-website` branch that puts `ReviewWebsiteRuntime` on the `RequestContext`, as it does for the other code workflows.

### Input (catalogue `input`, existing field types only)

| Field | Type | Default | Rule |
|---|---|---|---|
| `entryUrl` | text | — | required, `http(s)://`, max 2 000 chars |
| `maxPages` | number | 50 | 1–250 |
| `maxDepth` | number | 3 | 0–6 |
| `mobile` / `tablet` / `laptop` / `desktop` | boolean | true / false / true / false | at least one true (390, 768, 1440, 1920 px) |
| `exclude` | text | `logout\|signout\|sign-out\|delete\|unsubscribe` | regex, validated |
| `needsSignIn` | boolean | false | |
| `loginUrl` | text | — | optional; else the entry URL |

No new input type: four booleans instead of a multi-select (revisit if phase 2 needs one).

## 3. Browser (ADR-0049, proposed)

- `playwright-core` (pure JS, no browser download) in `backend/`, launched with `channel: 'msedge'`, then `'chrome'`; neither found → the step fails with `Review a Website needs Microsoft Edge or Google Chrome`. Edge ships with Windows, the only installer; the npm package uses the user's browser. Bundling Chromium (~150 MB) and an Electron `BrowserWindow` (desktop only) were rejected.
- Tests and CI set `SITE_REVIEW_BROWSER_PATH` to Playwright's Chromium from `frontend/node_modules`.
- Crops and thumbnails come from `page.screenshot({ clip, type: 'jpeg', quality })`: **no `sharp`** (a native module in the installer).
- `axe-core` (already a frontend dev dependency) injected with `page.addScriptTag({ path })`.
- Safety: GET navigation only, no form is submitted, no click except the dismiss step of overlays (phase 1: none), same origin only, the exclusion patterns, a 30 s page timeout, a run cap of 20 minutes.

## 4. Measured checks (phase 1)

One `page.evaluate` collects a **DOM snapshot** (visible elements: rect, computed styles that matter, text, tag, a stable selector); the rules are **pure functions over that snapshot**, so Jest tests them with JSON fixtures. axe runs separately.

| Rule id | Finding | Default severity |
|---|---|---|
| `axe:<id>` | axe violations (contrast, names, alt, labels…), axe impact mapped to severity | critical/serious → major, moderate/minor → minor |
| `overflow-x` | content wider than the screen; names the widest element | major on mobile/tablet, minor otherwise |
| `clipped-text` | text cut by `overflow: hidden` / ellipsis (`scrollWidth > clientWidth`) | minor |
| `covered-element` | a button, link or field more than 50 % under a `fixed`/`sticky` element at load | critical if it is a primary action (`type=submit`, the largest button), else major |
| `tap-target` | interactive element under 24 × 24 px on mobile/tablet (WCAG 2.5.8) | minor |
| `broken-image` | `img` loaded with `naturalWidth === 0` | major |
| `http-error` | page status ≥ 400, or a same-origin request for it failing | major |
| `console-error` | uncaught errors on load | minor |
| `placeholder-text` | `lorem ipsum`, `{{`, `undefined`, `NaN`, `Forename` in visible text | major |

A finding: `{ rule, severity, screen, page, selector, measured, expected, rect, cropFile, pages[] }`. The same rule + selector on several pages of one URL group is one finding with its `pages[]`.

## 5. Report and answer

- **Report visual**: the run's visual (a sandboxed `srcdoc` iframe cannot fetch the backend, so images are embedded): groups on the left with their worst severity, findings with their crop, rule and measured value, a screen toggle, and a sitemap tree. Budget: viewport thumbnails as JPEG (quality 50) and at most 3 crops per finding; above 15 MB the visual drops thumbnails and keeps crops.
- **Artifact** `site-review`: the findings JSON (phase 3 reads it).
- **Files**: the full-page screenshots in the run's workspace, downloadable as the run's files.
- **Answer**, built from the numbers: the totals by severity, "Fix first" (the highest severity × pages), and a **Coverage** paragraph: pages found vs the cap, links skipped by the exclusion rule, pages that failed to load, pages reachable on one screen only.
- **Query inspector rule (CLAUDE.md)**: the workflow answers from pages, not datasets; the spec says so, and each finding shows its evidence (selector, measured value, crop) in the same spirit.

## 6. Sign-ins

- Collection `site_signins`: `{ origin, storageStateCiphertext, capturedAt }`, encrypted with `CryptoService` (data-model.md 2.3 changes: a second encrypted value). Never in logs, snapshots, run input or output.
- Capture happens only inside a run (`prepare-session`). **As built:** no endpoints and no composer row in phase 1; a saved sign-in that no longer works opens the sign-in window again. Listing and clearing sign-ins is a follow-up.

## 7. Stories

**As built (2026-11-16):** the six units below shipped as roadmap story 1.27.1, one Free style change; phases 2 and 3 are 1.27.2 and 1.27.3. The workflow's agent is `site-reviewer` (Iris): the catalogue needs a `primaryFor`, and she answers follow-ups about a report; no step calls her in phase 1. `nav-unreachable` was dropped: a collapsed mobile menu would flag every link.

| Id | Story | Depends on | Model |
|---|---|---|---|
| 1.27.1 | ADR-0049, specs (workflows R1/R2/R27 rows, agents.md 5.x, api.md, data-model), `playwright-core` dependency and the browser launcher with its error | — | Opus |
| 1.27.2 | Workflow skeleton: catalogue entry, input, steps, runtime branch in `turn-engine.ts`, `discover-pages` with exclusions and URL grouping (public sites) | 1.27.1 | Opus |
| 1.27.3 | `capture-and-check`: DOM snapshot, the pure rules, axe, the pool and progress | 1.27.2 | Sonnet |
| 1.27.4 | `save-report`: visual, artifact, files, deterministic answer | 1.27.3 | Sonnet |
| 1.27.5 | Sign-in: `prepare-session` suspend/resume, `SiteBrowserService`, `site_signins` encrypted, composer row | 1.27.2 | Opus |
| 1.27.6 | E2E: a local fixture site with known defects (overflow, low contrast, covered submit, broken image, a logout link, a login-gated page) → the run's findings and coverage | 1.27.4, 1.27.5 | Sonnet |

1.27.3 and 1.27.5 can run in parallel after 1.27.2.

## 7b. Phase 2 as built (2026-11-16)

Approach A: `group-templates` → `.branch` to `confirm-review` (more than ten templates) → `.map` (`review-choice`) → `capture-and-check` (also the review shots) → `review-templates` (Iris, two at a time) → `save-report`. Templates join pages that share a URL pattern or a structure fingerprint (`structureSkeleton`, repeats collapsed). Iris gets, per template, the narrowest and widest screen's top of page, clean then marked (up to 30 marks), the legend and the template's measured findings; her findings point at a mark (exact selector, box and crop from the DOM). New input `visualReview` (on). Spec: agents.md 5.19.

## 8. Tests

- Jest: the rules over snapshot fixtures, URL grouping, exclusion matching, finding merge, the answer text, the workflow with the stub (`.then`, suspend/resume, bail on session lost), `workflow-contracts` snapshot updated on purpose.
- E2E (`frontend/e2e/`): the fixture site served locally, run from the workflow page; the sign-in path with a fake login page on the fixture server.
- No evals in phase 1 (no agent). Phase 2 brings the `site-reviewer` eval set.

## 9. Open questions

1. Respect `robots.txt`? Default proposal: no (an owner reviewing their own site), stated in the form's help.
2. Run cap of 20 minutes and 250 pages: right for the first sites you will review?
3. Overlay dismissal (cookie banners) before screenshots, as the original's `dismissSelectors`: phase 1 records the banner as a `covered-element` finding instead; add an optional selector field in phase 2?
