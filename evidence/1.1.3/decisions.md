# Decisions taken for BA-9 on 2026-10-13

**Who decided:** Claude, on Sergio's delegation in the session of 2026-10-13. He asked, about the decisions due this week: "Couldn't you do it too? but maybe considering 2 extra databases for other domains like: finance or marketing analytics? and of course should work not only for databricks but for postgresql, rest". Both decisions can still be reversed when Sergio confirms the epic spec.

## 1. How the branch work comes over

- **Options:** merge `feat/engine-eval-loop`; copy the data by path and rebuild the wiring; rebuild everything.
- **Decision:** copy the data by path (`git checkout feat/engine-eval-loop -- <path>`, never `-- .`) and rebuild the runner, report and UI on `main`'s code, with the branch as reference.
- **Why:** a simulated merge (`git merge-tree`, read-only) conflicts in 39 files, all in wiring `main` rewrote since (agents, sessions, LLM modules, Agent Hub UI, specs); the data files (generators, init SQL, suites, check library, failure labels, the Databricks loader) are new files with no conflict. Re-checked on 2026-10-12 against `f3ef18e`: `evidence/1.1.2/claim-check.md`.

## 2. Databricks fixture, widened to three families on all three kinds

- **Options in the plan:** A, the World Cup loaded into a Unity Catalog schema; B, the `samples` catalog only.
- **Decision:** A, with `samples.tpch` as a smoke set, plus two domain databases, **finance** (the branch's banking domain extended to finance and wealth) and **marketing analytics** (new, the marketing-insight product of the 2026-10-07 notes), each on PostgreSQL, Databricks and REST.
- **How the rows stay identical:** each fixture's seeded PostgreSQL generator is the source of truth; a dump script exports it to JSON; the local REST server and the Databricks loader both read that dump. Recorded in ADR-0015 (still Proposed).
- **What it displaces:** health insurance was the first domain (to Databricks and to 100 questions before the beta). It now comes over on PostgreSQL as it is (42 questions) and goes to Databricks after the beta.
- **Cost:** Step 1d grows from 1 to 2 days to 5 to 6; Steps 2 and 3 by about a day each. The minimum by the beta becomes about 19 to 24 days of work against 14 working days, so it fits only with the domain work run in parallel. If time runs short: depth first (banks stay at about 30 questions), then the three other branch domains, then marketing analytics on Databricks and REST.

## 3. Databricks validated in the VDI (Sergio, 2026-10-13)

- **Decision:** "I have a databricks access but in other place in a VDI ... I want just build the evals, then when we connected in the VDI (though copy the repo there and executing it there) we will be able to test it." Step 2 is built here without a warehouse; the full runs on a real warehouse happen later in the VDI.
- **Effect:** Step 2's done-when splits into "here" (code, references, unit tests) and "in the VDI" (runs). Until then, Databricks references are written but not executed.

## 4. Synthetic domains with no business review (Sergio, 2026-10-13)

- **Decision:** "just create the database and question related, should be synthetic". Claude writes the finance and marketing-analytics briefs, schemas, generators and questions; Sergio skims them. The check on each question is that its reference query runs and returns the planted facts.

## Where the decisions are applied

- `docs/plans/BA-9.md`: 3.0 (decisions table, "Decisions taken", calendar, minimum), 3.4 (domain order, the beta level), Steps 1d, 2, 3 and 4, the story map, the have / need table.
- `specs/epics/BA-9/spec.md`: scope, acceptance, dependencies.
- `roadmap.md`: features 1.1.7 to 1.1.10.
- `specs/system/architecture.md`: ADR-0015, the fixture-data bullet.

## Still open

- Shipping (one PR or an early PR after Step 1c), the beta thresholds, who labels the judge validation set.
