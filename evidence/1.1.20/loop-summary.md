# The supervised improvement loop, rounds 0 to 9 (BA-242)

Generated from [docs/evals/loop/results.tsv](../../docs/evals/loop/results.tsv) on 2026-10-22; the `eval:diff` output of each round is in [eval-diffs/](eval-diffs/). Every run: World Cup, Finance and Marketing Analytics on PostgreSQL, repeat 3, judge off; a question passes only when all three attempts pass. Rounds 0 to 2 ran on gpt-4o-mini, rounds 3 to 9 on gpt-5.6-luna at low reasoning effort.

| Round | Model | Change | Target | Dev before → after | Held-out before → after | Cost/question after | Round cost | Decision |
|---|---|---|---|---|---|---|---|---|
| 0 | gpt-4o-mini | — | — | — → all:13/130 | — → all:7/51 | 0.0079 | $1.4378 | baseline |
| 1 | gpt-4o-mini | context: each entity's columns and types in the turn's orientation lines | ranking | ranking:0/16;all:13/130 → ranking:1/16;all:24/130 | ranking:1/6;all:7/51 → ranking:0/6;all:7/51 | 0.0066 | $1.3124 | reverted |
| 2 | gpt-4o-mini | context: every entity's columns and types in the orientation lines, views included, cut… | aggregate | aggregate:1/15;all:13/130 → aggregate:7/15 | aggregate:0/4;all:7/51 → — | 0.0068 | $1.0739 | reverted |
| 3 | gpt-5.6-luna | model: gpt-5.6-luna at low reasoning effort (was gpt-4o-mini) | — | — → all:74/130 | — → all:27/51 | not priced | $1.6056 | baseline |
| 4 | gpt-5.6-luna | none: round 3 again, with gpt-4.1-mini priced | — | all:74/130 → all:79/130 | all:27/51 → all:24/51 | 0.0068 | $1.2266 | baseline |
| 5 | gpt-5.6-luna | context: every entity's columns and types in the orientation lines, views included, cut… | aggregate | aggregate:8/15;all:79/130 → aggregate:9/15;all:81/130 | aggregate:1/4;all:24/51 → aggregate:1/4;all:26/51 | 0.0058 | $1.1199 | kept |
| 6 | gpt-5.6-luna | context: the curated knowledge block's budget, KNOWLEDGE_BLOCK_CHARS, 2,000 to 7,000 ch… | encoding | encoding:3/10;all:81/130 → encoding:4/10;all:83/130 | encoding:0/4;all:26/51 → encoding:1/4;all:28/51 | 0.0057 | $1.1046 | kept |
| 7 | gpt-5.6-luna | knowledge: wealth entries in the Finance seed (fiscal calendar, fee status and revenue,… | encoding | encoding:4/10;all:83/130 → encoding:9/10;all:97/130 | encoding:1/4;all:28/51 → encoding:1/4;all:28/51 | 0.0053 | $1.0099 | accepted |
| 8 | gpt-5.6-luna | none: round 7's code measured again under R31's share tolerance (a check change) | — | all:97/130 → all:103/130 | all:28/51 → all:31/51 | 0.0054 | $0.9736 | baseline |
| 9 | gpt-5.6-luna | prompt: Grounding rule, derived figures (totals, differences, shares, changes) computed… | aggregate | aggregate:10/15;all:103/130 → aggregate:12/15;all:102/130 | aggregate:2/4;all:31/51 → aggregate:2/4;all:33/51 | 0.0053 | $1.0288 | kept |

OpenAI spend recorded in the rounds: $11.89 of the $25 budget ($22 stop rule). The fixer sessions ran on the user's Claude Code subscription, outside that budget.

## What changed in the app, and stayed

- Round 5, **kept**: every entity's columns and types in the turn's orientation block (agents.md 4.1). Tool calls per attempt 5.40 → 3.66, cost per question −14.5%.
- Round 6, **kept**: the curated knowledge block from 2,000 to 7,000 characters (knowledge R17). At 2,000 the Finance seed reached the model with 3 of its 12 entries.
- Round 7, **accepted**: wealth rules in the Finance knowledge seed. Finance dev 29/48 → 43/48, held-out 11/20 → 14/20.
- Round 9, **kept**: prompt rule A40, derived figures are computed in SQL before they are cited. Attempts with an ungrounded number 19 → 11 of 543. A prompt rule: re-measure on any other model.

## Changes to the harness and the rules, outside the rounds (the user's decisions)

- 2026-10-21: the fixer runs headless (`start-fixer.sh --headless`), `mcp__ide` and `~/.claude/projects/**` denied; the lead reverts on its own a round that fails the accept rule and asks the user only about one that meets it.
- 2026-10-21: every round gets its full run; a change that meets conditions 2 to 5 may be kept (`kept`).
- 2026-10-21: the loop moves to gpt-5.6-luna ([model-probe.md](model-probe.md)), the three sets run at once from one data directory each; gpt-5.6-luna and gpt-4.1-mini (the visual designer's model on gpt-5 family models) are priced.
- 2026-10-21: accept-rule condition 2 refuses a held-out target only when it is `down`, after round 4, an A/A rerun, made three small held-out categories fall by chance.
- 2026-10-22: the result-set match accepts a share stated rounded or as a percentage (R31); round 8 is the baseline under it.

## Open

- The repo's eval gate (100%, three runs) does not pass on gpt-5.6-luna: round 9 has dev 102/130. Rounds 5, 6, 7 and 9 change what the assistant receives, so before PR #81 merges they need that gate on a Claude model once the Anthropic keys arrive, or a change to the gate.
- Prompt rule A40 is re-measured on any other model before it counts there.
- SQLite (REST datasources) has no `ROLLUP`, which rule A40 names; not measured, since the loop runs on PostgreSQL.
- Left in dev at round 9: 4 questions that always fail and 24 flaky ones; a seen failure mode is an attempt that loads the curated-knowledge skill and then runs no query.
