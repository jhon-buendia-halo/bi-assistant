# M1-27 — Review a Website: measured visual QA of every page

- **Roadmap:** Milestone 1.27 · **Status:** Confirmed (2026-11-16, the user, after two wireframes and three approaches: "ok", then "implementa tu approach".)

## Goal

Bring the goal of the `site-mapping-agent` prototype into the app as a workflow: from one entry URL, map a website and find the visual and usability defects of every page on each screen size, signed-in pages included. After phase 1:

- **Review a Website** is in the workflow catalogue; its form takes the entry URL, the limits, the screens, an exclusion pattern for sign-out and delete links, and whether the site needs a sign-in.
- A site behind a sign-in opens a browser window for the user to sign in once; the run waits, then goes on; the sign-in is saved encrypted for the next reviews.
- Every page found is measured on every chosen screen in a real browser (Edge or Chrome): axe, sideways scrolling, cut-off text, controls covered by banners, small tap targets, broken images, HTTP and console errors, placeholder text.
- The run's visual is a report grouped by page pattern, where every finding shows the element, what was measured, the rule and a crop of the screenshot; the answer says what to fix first and what the review covered.

## Scope

- Phase 1 (1.27.1): the workflow, the browser work, the encrypted sign-ins, the report and the answer, the `site-reviewer` agent as the workflow's agent.
- Phase 2 (1.27.2) and phase 3 (1.27.3) are planned, not built here.

## Out of scope

- Any model call in phase 1.
- Listing or clearing saved sign-ins in the app; dismissing overlays before screenshots; design references; a PDF export.

## Stories

| Story | What | Status |
|---|---|---|
| 1.27.1 | Phase 1: crawl, measure and report, with the site's sign-in | In progress |
| 1.27.2 | Phase 2: page templates and Iris's vision review | Planned |
| 1.27.3 | Phase 3: compare with the last run | Planned |

## Specs touched

- [agents.md](../../system/agents.md) 1.1, 2.15, 5.12, 5.19.
- [data-model.md](../../system/data-model.md) 2.3, 3.19.
- [api.md](../../system/api.md) 34, 116.
- [workflows](../../capabilities/workflows/spec.md) R1, R2.
- [architecture.md](../../system/architecture.md) ADR-0049.

## Acceptance

- A run on a site with known defects reports each of them with its element, measured value and crop, grouped by page pattern, on each chosen screen; excluded links are never opened.
- A run on a site behind a sign-in waits for the user to sign in in the window it opened, then reviews the signed-in pages; a later run reuses the saved sign-in; a lost sign-in ends the run with nothing reviewed and an answer that says why.
- Unit tests for the rules, the collector, the report, the workflow on the stub and the browser work against a local fixture site.

## Dependencies, risks and open questions

- Plan: [docs/plans/m1-27-site-review.md](../../../docs/plans/m1-27-site-review.md). Wireframes in the session's `.context/wireframes/` (not in the repo).
- Risk: a machine with neither Edge nor Chrome cannot run it (the step says so).
- Risk: some sites block headless browsers or rate-limit crawls; the page limit and one page at a time per screen in the crawl keep the load low.
- Open: respect `robots.txt`? Not in phase 1 (the owner reviews their own site).
