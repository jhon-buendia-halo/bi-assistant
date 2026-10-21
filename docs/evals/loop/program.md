# The supervised improvement loop: runbook

The loop of [the BA-9 plan, section 3.6](../../plans/BA-9.md#36-the-improvement-loop), as it runs from a worktree of this repository: a person picks one weak slice and one lever, a fixer session proposes one change, the eval suite measures it on the dev and held-out splits, and the user accepts it or the lead reverts it. Nothing here is part of the app.

- What the tools do: [agents-evals](../../../specs/capabilities/agents-evals/spec.md) R222 to R230. Where they sit, with the fixer's isolation: [delivery.md](../../../specs/system/delivery.md) section 2, *Improvement loop*.
- How to walk a round, step by step: the project skill [eval-loop](../../../.claude/skills/eval-loop/SKILL.md).
- The fixer's locks: the tool [eval-loop](../../../.claude/tools/eval-loop/README.md).
- The log of rounds: [results.tsv](results.tsv). The leak check's allowlist: [leak-allowlist.txt](leak-allowlist.txt).

Added 2026-10-20 (BA-242, roadmap 1.1.20). The accept rule was confirmed by the user on 2026-10-20; the stop rule and the budget below are defaults the user may change. On 2026-10-21 the user decided that the lead runs every round and reverts on its own a round that fails, so the user decides only the rounds that meet the accept rule (*Roles*). A second decision the same day, after round 1: one cause fixed rarely makes a whole question pass all its attempts on gpt-4o-mini, since most questions fail for several causes, so a round whose target slice is not `up` still gets its full run, and the user may keep its change as the new baseline (decision `kept`) when conditions 2 to 5 of the accept rule hold, though condition 1 does not. A third decision the same day, after a probe of four models on 31 dev questions: the loop runs on gpt-5.6-luna at low reasoning effort from round 3, which re-baselines it, and the three sets run at once, each from its own data dir.

## Roles

| Role | Who | Does | Never |
|---|---|---|---|
| Supervisor | The user and the lead Claude Code session | Picks the slice, the lever and the hypothesis; reads the full runs, dev and held-out; reviews the fixer's patch; the user accepts, the lead reverts; updates the specs and tests an accepted change affects. Since 2026-10-21 the lead walks the whole round, reverts on its own a round that fails any of conditions 2 to 5 of the accept rule, and asks the user about a round that meets the accept rule, or that meets conditions 2 to 5 (`kept`) | Tells the fixer anything about a held-out question |
| Fixer | A Claude Code session started by `.claude/tools/eval-loop/start-fixer.sh`: headless (`--headless`), by the lead, since 2026-10-21; or interactively by the user | Reads the round's failure export, proposes one change, edits only lever files | Reads a held-out question, runs a command (it has no Bash), touches tests or specs |
| CLI runner | `node .eval-loop/build/<round>/backend/dist/mastra/evals/run-assistant-evals.js` | Runs a set from the round's build snapshot and saves the run in the loop's data dir | Runs two sets at once on one data dir |

## The split rule

Every question is `dev` or `held-out`. Tuning reads dev failures only, and only through the failure export (`eval:export-failures`), which holds nothing of the held-out questions but their counts. The fixer works in a temporary worktree from which every file that names a held-out case is deleted, under deny rules that also refuse those paths anywhere on the disk. The held-out split measures the change: if dev climbs and held-out does not, the change taught the assistant the questions, not the job, and it is reverted.

The supervisor sees held-out results in `eval:diff` and the run reports. Those stay with the supervisor: they never go into the fixer's prompt, a lever file, `results.tsv` (which holds held-out counts only) or the allowlist's reasons. An accepted change is committed with its `eval:diff` output in the commit message; the fixer cannot read commit messages (it has no Bash).

## Levers: one per round

| Lever | Lever files | Usually moves |
|---|---|---|
| The prompt | `backend/src/mastra/agents/` (the assistant's prompt) and its skills, `backend/src/mastra/skills/` | clarification, discovery, ids instead of names, coverage statements, format |
| Tool descriptions and error messages | `backend/src/mastra/tools/`, `backend/src/mastra/tool-section.ts` | first-try SQL, wrong table, wrong filter |
| Context blocks | `backend/src/mastra/context-blocks.ts`, `backend/src/modules/sessions/sessions.service.ts` | what the turn is told about the datasets and the session, and how much curated knowledge it carries: the knowledge block's budget, `KNOWLEDGE_BLOCK_CHARS`, moved into `context-blocks.ts` on 2026-10-21 (the user's decision, after finding that 2,000 characters carry 3 of the Finance sample's 12 entries) |
| A domain sample's knowledge seed | `backend/src/modules/testing-data/fixtures/knowledge/` | business-term, default-filter, value vocabulary |

These are the lever files of R229: the only files a round may change, and the only files the leak check reads. One lever per round, because two cannot be attributed.

The knowledge lever, decision D7: only the domain samples' seeds. The World Cup sample stays unseeded (its sets are the team's gate and keep the same context), and Marketing Analytics has no seed, so of this loop's three sets only Finance can take it. Adding a seed for another sample means registering it in `registry.ts`, which is not a lever file: that is the supervisor's change, in its own story. A changed seed reaches the loop only when the sample is loaded again, and a reload never overwrites an entry that has the same kind and title (testing-data R26): delete the changed entries in the loop's app first (Knowledge screen), then load the sample again. A knowledge seed also has its own unit test, which refuses an entry that names a question's id or repeats its wording (testing-data R27).

## Forbidden in every round

The question bank files, the checks and their thresholds, the eval harness, the model and the reasoning effort, the step budget, the sample fixtures and their planted facts, the specs and the tests. When a change is accepted, the supervisor updates the specs and tests it affects in the same commit: the prompt in [agents.md](../../../specs/system/agents.md) Appendix A, the prompt fixtures in `backend/src/mastra/agents/__fixtures__/`, and any unit test that pins the changed text.

## The working folder

`.eval-loop/` at the worktree root, gitignored and regenerated from runs (decision D8):

| Path | Holds |
|---|---|
| `.eval-loop/data/<set>/` | The loop's data dirs, one per set since 2026-10-21 so the sets run at once (`APP_DATA_DIR` of that set's runs): its sample, its LLM settings (gpt-5.6-luna, low effort), its saved runs. `data/gpt-4o-mini/` keeps the first model's one data dir, with rounds 0 to 2 |
| `.eval-loop/build/<round>/backend/` | The round's build snapshot: `dist/`, `public/` and `package.json` copied, `node_modules` linked. Every eval of the round runs from it, so a later `nest build` (which clears `dist/`) never changes a running round |
| `.eval-loop/runs/<round>-<set>.json` | Each run's record (`EVAL_RUN_FILE`), and its console output beside it as `.log` |
| `.eval-loop/exports/<round>/` | The round's failure export (`eval:export-failures`) |
| `.eval-loop/fixer/<round>/` | The fixer's worktree (`tree/`, removed when collected), its copy of the export (`export/`) and its change (`change.patch`) |

## One round

The skill [eval-loop](../../../.claude/skills/eval-loop/SKILL.md) has the full commands. In short, for round `r<N>` against the baseline round `r<B>` (the last accepted round, `r0` at first):

0. **Baseline** (round `r0`, and again after every accepted change or question bank change): build, snapshot, then run the three sets at once, each from its own data dir, repeat 3, judge off: `world-cup`, `finance`, `marketing-analytics`. Record the run ids in `results.tsv`.
1. **Pick the worst slice**: the category with the lowest dev pass rate, weighted by the priority of the plan's [section 3.9](../../plans/BA-9.md#39-thresholds-to-react-to-a-proposal-not-a-decision) (lookup, aggregate, join, ranking and ratio first; out-of-scope and non-existent must be at 100%).
2. **Read the failures**: `npm --prefix backend run eval:export-failures -- --run <run> --out .eval-loop/exports/r<N>`, one per set that holds the slice; group the failures, one sentence each; the largest group is the hypothesis.
3. **One lever, one change**: `.claude/tools/eval-loop/start-fixer.sh r<N> --headless --lever "<lever>" --target <category>`; when the fixer is done, `.claude/tools/eval-loop/collect-fixer.sh r<N>`, then `npm --prefix backend run eval:leak-check -- --diff-file .eval-loop/fixer/r<N>/change.patch`. A rejection goes back to a new fixer with the `--fixer` report (it names no held-out case), or the lead allowlists a false positive with its reason. The lead reviews the patch and applies it: `git apply .eval-loop/fixer/r<N>/change.patch`.
4. **Target slice**: rebuild, snapshot as `r<N>`, run the slice on dev only, repeat 3 (`EVAL_SPLIT=dev EVAL_CATEGORY=<category>`), in each set that holds it; compare with `eval:diff` against the baseline run of that set. The slice shows whether the change moved its target at all: until 2026-10-21 a round with no `up` on the dev row of the category was reverted here and recorded as `tried`; since then the full run follows either way, and the slice's per-attempt numbers (passing attempts, attempts with a repaired SQL) go into the round's reason.
5. **Full run**: every set again, dev and held-out, repeat 3, judge off.
6. **Accept rule**: `npm --prefix backend run eval:diff -- --before <the r<B> runs> --after <the r<N> runs> --target <category> --round <N> --lever "<lever>" --hypothesis "<hypothesis>" --tsv`.
7. **Record**: on a round that meets the accept rule, the user accepts, and the lead commits the lever files (with the specs and tests of the section above) and the `eval:diff` output in the commit message; or the lead reverts (`git restore -- <files>`, and deletes any new lever file). Either way, append the round's row to `results.tsv`, from the draft row `eval:diff` printed.
8. **Stop rule**: below.

## The accept rule

Decision D2 of 2026-10-20, checked by `eval:diff --target` (R227); exit 0 means met.

| # | Condition | `eval:diff` shows it as |
|---|---|---|
| 1 | Every target category is up on dev | the dev row's flag is `up` (Newcombe's 95% interval of the change lies above 0) |
| 2 | On held-out, no target category is down; a target with no scored held-out question does not meet this. Until 2026-10-21 a held-out target that fell by one question failed it too; the user changed it after round 4, an A/A run in which three small held-out categories fell by chance | the held-out row's flag is not `down` |
| 3 | The held-out `all` row is not down | its flag is not `down` |
| 4 | No category is down on either split, and neither `all` row is | no row is flagged `down` |
| 5 | The cost per question rose by at most 10%; a side that is not priced or not recorded does not meet this | `Cost per question:` at most `+10%` |

With about ten questions per category, a single run rarely flags `up`: one flip moves a category by ten points, and the interval is wide. Condition 1 is what makes an accepted change believable; widening a slice (more questions, not more repeats) is the honest way to make it reachable.

**Kept** (since 2026-10-21): when conditions 2 to 5 hold and condition 1 does not, the user may keep the change as the new baseline. It is recorded as `kept`, not `accepted`, with the slice's per-attempt numbers as its evidence, and the next rounds build on it. A change that fails any of conditions 2 to 5 is reverted by the lead.

## The stop rule

- A category at its threshold of the plan's section 3.9 is left alone.
- Two levers tried on a slice with no gain: move to the next slice.
- Stop when the rounds have spent $22 (the sum of `round_cost_usd`), or on 2026-10-31, whichever comes first.

## The budget

$25 in all. A full run of the three sets at repeat 3 is 181 questions (63 World Cup, 68 Finance, 50 Marketing Analytics), so 543 attempts. The first estimate, about $3.30 with gpt-4o-mini at about 34,000 tokens per attempt (the plan's measure on `feat/engine-eval-loop`), was 2.3 times the measured baseline: $1.44, about 22,800 tokens per attempt with 66% of the input cached. On gpt-5.6-luna at low effort the probe of 2026-10-21 puts a full run at about $1.15 to $1.25, and at about 16.6 seconds per attempt, which is why the sets run at once. A round adds its target slice, a few dozen attempts, so about $1.35 a round; the judge stays off inside the loop.

## results.tsv

One row per round, tab-separated, in these columns:

| Column | Holds |
|---|---|
| `round` | `0` for the baseline, then `1`, `2`, … |
| `date` | `YYYY-MM-DD` |
| `hypothesis` | The failure group the round addressed, one sentence |
| `lever` | The one lever: `prompt`, `tools`, `context` or `knowledge`, with a few words |
| `files` | The lever files changed, `;`-separated |
| `target_categories` | `;`-separated |
| `dev_before`, `dev_after`, `heldout_before`, `heldout_after` | `<category>:<passed>/<scored>` per target, then `all`, `;`-separated: `join:4/8;all:20/48` |
| `categories_down` | The rows flagged `down` on either split, `;`-separated |
| `cost_per_question_before`, `cost_per_question_after` | Dollars, 4 decimals, or `not priced` / `not recorded` |
| `round_cost_usd` | What the round's runs cost: the full run (the draft fills it), plus the target slice's runs |
| `decision` | `baseline`, `accepted`, `kept` (conditions 2 to 5 met, condition 1 not, kept by the user; since 2026-10-21), `reverted` or `tried` (reverted after the target slice, before 2026-10-21) |
| `reason` | Why, one sentence: the accept rule's reasons when not met |
| `run_ids_before`, `run_ids_after` | 8-character run ids, `;`-separated |

`eval:diff --tsv` prints a draft row; the supervisor fills `files`, `decision` and `reason`. Held-out cells hold counts only: never a held-out question's id, wording, answer or check reason, here or anywhere the fixer can read.

## The leak check

`npm --prefix backend run eval:leak-check -- --diff-file <patch>` reads the lines a change adds to the lever files and rejects any that quotes a question bank file (dev and held-out alike, decision D6) or a planted-facts file: a run of a question's words, an entity name, a number, a quoted value (R229, R230). A reference query's string literal only warns. It exits 1 on a rejection. A false positive goes into [leak-allowlist.txt](leak-allowlist.txt) as `<literal> | <reason>`; the literal is the one the report prints between quotes. The fixer cannot read the allowlist: its reasons may name what a held-out question asks.
