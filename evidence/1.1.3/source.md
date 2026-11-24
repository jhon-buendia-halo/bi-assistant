# 1.1.3 — Source of the BA-9 execution plan

- **Artifact:** "Golden Dataset and Evals Plan", <https://claude.ai/artifact/B5Fvcjq5kyw1U445pDkdGX>
- **Version:** 7, dated 2026-10-12, written against `main` at `ee558d2` (v0.30.0)
- **Converted:** 2026-10-12, on branch `feat/BA-9-golden-dataset-evals` at `f3ef18e` (v0.31.0)
- **Stories:** [BA-128](https://halo-powered.atlassian.net/browse/BA-128) (execution plan, this feature) and [BA-127](https://halo-powered.atlassian.net/browse/BA-127) (research, roadmap 1.1.2), epic [BA-9](https://halo-powered.atlassian.net/browse/BA-9)

## Which section went where

| Artifact section | File |
|---|---|
| Header (Jira, roadmap, baseline, priority, method, status), table of contents, Summary (findings, recommendation, "Start with 3.0" callout) | [docs/research/BA-9.md](../../docs/research/BA-9.md) |
| Part 1 (1.1 to 1.4) | [docs/research/BA-9.md](../../docs/research/BA-9.md) |
| Part 2 (2.1 to 2.8) | [docs/research/BA-9.md](../../docs/research/BA-9.md) |
| Part 3 (intro, 3.0 to 3.9) | [docs/plans/BA-9.md](../../docs/plans/BA-9.md) |
| Part 4 intro and 4.0 (the verdict) | [docs/research/BA-9.md](../../docs/research/BA-9.md); the plan links to it |
| Part 4.1 to 4.6 | [docs/plans/BA-9.md](../../docs/plans/BA-9.md) |
| Sources | [docs/research/BA-9.md](../../docs/research/BA-9.md) |
| Have, need, done, not now | [docs/plans/BA-9.md](../../docs/plans/BA-9.md), last section |
| *(new)* Story map | [docs/plans/BA-9.md](../../docs/plans/BA-9.md), built from the artifact's own steps, estimates and calendar |

## What changed in the conversion of the plan

- **Diagrams.** The 3.0 Gantt became a Mermaid `gantt` (weekends excluded; "if time allows" bars labelled and drawn as `active`; decisions as milestones; the credentials dependency, a dashed line in the SVG, is stated in the caption). The SVGs in 3.1 (sources and checks), 3.3 (the three harnesses merged), 3.6 (the loop) and 4.1 (the trust ladder) became Mermaid flowcharts, with the original captions in italics. No diagram became a table.
- **Tables and cards.** HTML tables became Markdown tables, pills became bold words, callouts became block quotes. Step cards became `####` headings with a bold-labelled list (Why, Takes in, Gives you, Example, Done when, Needs; Create, After this, Done when, Needs for Steps 9 to 12), and each "Technical checklist" fold became a `<details>` block.
- **Added columns.** 3.0's decisions table gained a **Status** column (`open` on every row). 3.8's table gained **Last check (2026-10-12, `f3ef18e`)**, from [status-check.txt](status-check.txt).
- **Wording adapted to the new file.** "This document" (meaning the artifact) became "the source artifact" in action 5 of 3.0, in Step 0's card and checklist, and in the "steps at a glance" table. The Part 3 intro's "one rule" sentence moved to the plan's header; the rest of the intro stayed. Part 4 opens with one line linking to the research doc's Part 4 intro and 4.0 instead of repeating them.
- **Links.** References to sections 1.x, 2.x, 4.0 and "Example 5/8 in 2.8" link into `docs/research/BA-9.md`; references to 3.x and 4.x link inside the plan; repo paths that exist on the branch are relative links, paths a step will create stay as code. Link check: [link-check.txt](link-check.txt).
- **Kept as the artifact has it,** although it reads oddly against the new layout (flagged to the reviewer, not changed): the "Have, need, done, not now" table says "Part 2.4 in the spec" for the criteria list and "Part 2.5 on every case" for the categories, which are sections 2.5 and 2.6; Step 0's example names "1.1.3 Databricks fixture and set", while the Story map gives 1.1.3 to this plan and 1.1.8 to Step 2.
- **Story map numbering** was given by the coordinator: Step 0 research 1.1.2 (BA-127), Step 0 plan 1.1.3 (BA-128), Steps 1a to 8 as 1.1.4 to 1.1.14, Steps 9 to 12 as 1.1.15 to 1.1.18, all under BA-9. Jira cells for Steps 1a to 12 read "(Jira story pending)": the stories are created only after confirmation.

## Corrections made after the conversion (2026-10-12)

The artifact's text was corrected in five places where it contradicted the repository or the story map:

- Step 0's example named "1.1.3 Databricks fixture and set"; in the story map 1.1.3 is this plan and Step 2 is 1.1.8.
- Step 2 placed "preflight rule R20" next to `testing-data/spec.md`; the preflight rule is R20 of `agents-evals/spec.md` (testing-data R20 is about permissions).
- Step 9 said "R10 no longer limits evals to built-in sets"; agents-evals R10 says "Only the assistant SHALL have eval sets". Step 9's user sets belong to the assistant, so R10 changes only in Step 12 (evals for user agents).
- The have / need table cited "Part 2.4" for the criteria list and "Part 2.5" for categories; they are research sections 2.5 and 2.6, now linked.
- Action 2 of 3.0 (open the epic branch, assign the stories, move BA-127 to In Progress) was done on 2026-10-12 and is marked so; the Jira row of 3.8 records the change.

The status-check command for the question count (`grep -c "id: '"`) prints 23, not 30, on both `ee558d2` and `f3ef18e`: the 10 REST questions are generated by `restVariants` and have no `id: '` line. The count of 30 holds; the command does not measure it. See `status-check.txt`.
- Step 3's example and checklist said the players endpoint is "larger than one page". It holds 50 rows; the server's default page is 100 and the REST datasource asks for 200, and no endpoint has more than 79 rows. Both now say the case bites once the paging switch serves pages smaller than the endpoint (research correction 6, `evidence/1.1.2/claim-check.md`).
- 4.3 cited admin R21 and R25 for approval; R25 is about hiding controls. The Data owner role per datasource is R22, now cited with R21.
