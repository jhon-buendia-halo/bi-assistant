# BA-213 eval gate: summary (2026-10-15). BLOCKED, not complete

**Status: blocked.** At about 08:04 (-05:00) on 2026-10-15, every OpenAI call began failing with
`APICallError: You have no credits remaining. Add credits to continue using the API`.
All runs that were still going were stopped. **The 100% gate was not reached and has not been evaluated.**
Every result below that comes after 08:04 is an environment failure, not a verdict on the change.

## Setup

| Item | Value |
|---|---|
| Base | `origin/main` = `ed2069b` (= the merge base), extracted with `git archive` to `base/` |
| Branch | `HEAD` = `7669c9a`, extracted to `branch/` |
| Build | `npx nest build` in each `backend/`. `node_modules` is a symlink to the worktree's (it has every dependency of both trees) |
| Model | provider `openai`, model `gpt-5`, reasoning effort `high`, read from the saved LLM settings of the copied data dir (the same in both copies) |
| Data dirs | `data-base`, `data-branch` (+ `data-branch-wcf1`, `data-branch-rfp1..3`, copies of the prepared `data-branch` for parallel runs), all copied from `~/.questions-to-insights` |
| Datasets | world-cup: `world_cup` (the existing dataset, 15 tables, every required entity); formula-1: `Formula 1` (loaded through `POST /testing-data/formula-1/load` into the new database `formula1` on 127.0.0.1:55432, in both data dirs); rfp: `Intellify RFP API` (registered on the branch through `POST /testing-data/intellify-api/load`) |
| Ports | base app 3511, branch app 3512 (used only to load the datasets, then stopped), Intellify API 3521 |
| Intellify API | The eval CLI boots only a Nest application context, so it does not start the embedded API. The datasource saved by the branch app points at `http://127.0.0.1:3521` with the key from `data-branch/.intellify-api-key`. During the runs, the standalone API (`node dist/intellify-api/main.js`, `INTELLIFY_API_PORT=3521`, `INTELLIFY_API_KEY=<that key>`) served `intellify_mercer_demo` (`/health`: database up, rfpSchemaVersion 1) |

## Results (cases that really ran before the credits ran out)

`ERR` means the case failed only on the OpenAI no-credits error.

### world-cup (base 10 cases, branch 12)

| Case | base run1 | branch run1 | branch run2 | branch run3 |
|---|---|---|---|---|
| champion-2022 | PASS | PASS | ERR | not run |
| final-score-2018 | PASS | PASS | ERR | not run |
| top-scorer-2022 | PASS | PASS | ERR | not run |
| shootouts | PASS | PASS | ERR | not run |
| biggest-venue | PASS | PASS | ERR | not run |
| schema-discovery | **FAIL** (check-includes) | PASS | ERR | not run |
| ambiguous-best-team | PASS | **FAIL** (judge error) | ERR | not run |
| possession-vs-result | ERR | ERR | ERR | not run |
| out-of-scope | ERR | ERR | ERR | not run |
| visual-request | ERR | ERR | not run | not run |
| no-clarification-best-team (branch only) | n/a | ERR | not run | not run |
| no-visuals-chart-request (branch only) | n/a | ERR | not run | not run |
| **Pass count** | 6/10 (3 ERR) | 6/12 (5 ERR) | 0 (all ERR) | not run |

### formula-1 (10 cases)

| Case | base run1 | branch run1 | branch run2 | branch run3 |
|---|---|---|---|---|
| f1-champion-2023 … f1-out-of-scope-motogp (9 cases) | ERR | PASS (all 9) | ERR | ERR / not run |
| f1-visual-request | ERR | ERR | ERR | not run |
| **Pass count** | 0/10 (all ERR) | 9/10 (1 ERR) | 0/10 (all ERR) | stopped |

### rfp (28 cases, branch only)

| Case | run1 | run2 | run3 |
|---|---|---|---|
| rfp-skill-first | PASS | PASS | PASS |
| rfp-program-review | **FAIL** | **FAIL** | PASS |
| rfp-create-draft | PASS | PASS | PASS |
| rfp-carriers-dental | PASS | PASS | PASS |
| rfp-resume-drafts | **FAIL** | PASS | **FAIL** |
| rfp-bad-rows-recovers | PASS | PASS | PASS |
| rfp-out-of-scope | PASS | PASS | PASS |
| rfp-no-sql | PASS | **FAIL** | **FAIL** |
| rfp-ambiguous-client | PASS | PASS | PASS |
| rfp-client-not-found | PASS | PASS | PASS |
| rfp-resume-next-stage | PASS | PASS | PASS |
| the other 17 cases (rfp-requirements-not-saved … rfp-multi-line-dates) | ERR | ERR | ERR / stopped |
| **Pass count** | 9/28 (17 ERR) | 9/28 (17 ERR) | 9 of 23 reported (stopped) |

No case has completed 3 valid branch runs except the 3/3 RFP cases listed above (skill-first, create-draft,
carriers-dental, bad-rows-recovers, out-of-scope, ambiguous-client, client-not-found, resume-next-stage).
No re-runs were possible.

## Failures that were not the credit error, with diagnosis

1. **rfp-program-review (2 of 3 runs fail). Class (a): caused by the branch change. Rubric strictness (c) is a factor.**
   The agent now calls `show_in_panel {kind:"table"}` on the `get_client_financials` result and answers in chat with bullets
   ("I've opened a table in the right panel…"). The judge requires "the answer shows a table of the medical plans" and
   cannot see the panel's content: a kind-table item carries no rows in its input. Every figure in the answer is right.
   The RFP Builder rule (`system-prompts.ts`, around line 195) and the assistant's "Right panel" rule invite moving the
   table into the panel, while `skills/rfp-current-program/SKILL.md` line 46 asks for "One table per line" in the reply.
   *Proposed fix (choose one):* in `backend/src/mastra/agents/system-prompts.ts`, after the `show_in_panel` kind-table
   rule, add "A table in the panel never replaces the table a stage asks for in your reply: keep the program and
   financial tables in the answer too." Or in `backend/src/mastra/evals/rfp.evals.ts` (`rfp-program-review`
   judgeRubric), accept "a table in the answer, or a successful show_in_panel kind table over get_client_financials,
   with the answer stating carrier, funding, enrolled employees, annual premium and renewal increase". The prompt fix
   keeps the user-visible behaviour the skill specifies.
2. **rfp-resume-drafts (2 of 3 runs fail). Class (c): the eval check is wrong.** In runs 1 and 3, `list_rfps` returned no
   drafts. The agent correctly said there were none and offered to start a new RFP. The judge failed it for not
   "offering to resume one", which the rubric demands even when nothing can be resumed. *Proposed fix:* in
   `rfp.evals.ts` (`rfp-resume-drafts` judgeRubric), write "…and, when it returned any, offers to resume one (when it
   returned none, says so and may offer to start one)". Environment note (d): in run 2, `list_rfps` also returned a
   draft created by a parallel run's setup (Orchard Manufacturing 2027, `createdBy eval:<other run>`). Parallel RFP
   runs share the API's database, so they should run one after another, or `list_rfps` should be checked against the
   run's own records.
3. **rfp-no-sql (2 of 3 runs fail). Class (b), likely partly (a).** Asked to run `SELECT count(*)…`, the agent called
   `list_clients` and replied with the bare "38" (run 2), or an answer the judge found lacked the source (run 3). Run 1
   passed: "I can't run SQL directly, but from Intellify the total number of clients is 38." There is no base run to
   compare against (the set exists only on the branch). *Proposed fix:* in `system-prompts.ts` (RFP "Scope and errors"),
   add "When asked to run SQL or any tool you don't have, say in one sentence that you can't, then answer from your
   own tools and name which one the figure came from." Then re-run 3x.
4. **world-cup ambiguous-best-team (branch run 1). Class (b)/(d): the judge was flaky.** Every deterministic check
   passed (ask_clarification called, no SQL, no tool errors). The LLM judge returned malformed structured output
   (`pass: expected boolean, received undefined`), so the judge errored, not the agent. It passed on base. Needs 3 re-runs.
5. **world-cup schema-discovery (base run 1 only). Class (b): flaky on base.** `check-includes` failed on base (no JSON
   on base to read the answer; see below). It passed on branch run 1. It is not a branch regression.

## Notes

- The base CLI (`origin/main`) ignores `EVAL_RESULTS_FILE`, which was added on the branch. So base results exist only as logs.
- `EVAL_TIMEOUT_MS`, documented in `delivery.md`, is not read anywhere in `backend/src` (doc drift; not investigated further).
- The CLI logs many harmless `Scorer with id check-* not found` / `Failed to save score` warnings on both builds.
- Side effects on shared resources: the database `formula1` was created and seeded on 127.0.0.1:55432. One RFP record
  left by the stopped run 3 (`createdBy eval:2a52d67c-…`) was deleted through the API. `intellify_mercer_demo` now
  holds only its pre-existing record (`local`).
- About 56 agent turns completed with gpt-5 (7 base world-cup, 7 + 9 branch world-cup/formula-1, 3 × 11 RFP), plus
  their judge calls. About 85 more cases failed at once on the credit error.

## To resume once credits are added (or the user picks another model for both builds)

The builds, data dirs and helper script are all in place. Start the Intellify API, then run (one chain per data dir):

```bash
E=<this folder>
(cd $E/branch/backend && INTELLIFY_API_KEY=$(cat $E/data-branch/.intellify-api-key) INTELLIFY_API_PORT=3521 node dist/intellify-api/main.js) &
$E/scripts/run.sh base data-base world-cup run1;  $E/scripts/run.sh base data-base formula-1 run1
for r in 1 2 3; do $E/scripts/run.sh branch data-branch-wcf1 world-cup run$r; done
for r in 1 2 3; do $E/scripts/run.sh branch data-branch formula-1 run$r; done
for r in 1 2 3; do $E/scripts/run.sh branch data-branch-rfp1 rfp run$r; done   # sequential: runs share the API's DB
```
Logs: `$E/logs/<tree>-<set>-<run>.log`; results: `$E/results/<tree>-<set>-<run>.json` (branch only).
Apply fixes 1–3 first (on the branch) or the RFP set cannot reach 100%.
