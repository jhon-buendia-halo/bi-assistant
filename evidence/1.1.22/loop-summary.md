# 1.1.22 (BA-244) — Improvement loop rounds 10 to 13, and rule A40 on a second model

Rounds run on 2026-10-23 from round 9's baseline, on gpt-5.6-luna at low effort, the three sets at once, repeat 3, judge off, by [program.md](../../docs/evals/loop/program.md). The same day the user delegated the keep and accept decisions to the lead session; the accept rule, the levers and the forbidden paths did not change. Every row is in [results.tsv](../../docs/evals/loop/results.tsv); every `eval:diff` is in [eval-diffs/](eval-diffs/).

| Round | Lever and change | Dev | Held-out | Cost per question | Decision | Commit |
|---|---|---|---|---|---|---|
| 9 (baseline) | — | 102/130 | 33/51 | $0.0053 | — | — |
| 10 | Tools: a grouped result of several rows carries a note that a total, a difference or a count across its rows comes from the query (a window column or one more query) | 106/130 | 29/51 | $0.0055 (+4.6%) | kept | `e369318` |
| 11 | Prompt, rule A41: a masked identity stays masked | 107/130 | 34/51 | $0.0055 (+0.1%) | kept | `bd21277` |
| 12 | Tools: a warning when a filter in a LEFT JOIN's ON clause removes no row | 111/130 | 31/51 | $0.0056 (+1.3%) | kept | `114423c` |
| 13 (baseline) | None: round 12's code under the fixed `check-option-count` (a check change) | 113/130 | 35/51 | $0.0057 (+1.4%) | baseline | `2a39a01`, `3f6ebba` |

No round met condition 1 of the accept rule (its target category `up` on dev); each kept round met conditions 2 to 5 (nothing `down` on either split, cost per question up at most 10%). What each one moved:

- **Round 10.** Attempts failing `check-numbers-grounded` 11 to 4 of 543; attempts with a window function 51 to 267; two of the three aggregate questions that cited a worked-out total now pass 3/3. Held-out 33 to 29 is within its interval, and within the flips of round 4's A/A run; clarification requests per attempt stayed as in rounds 8 and 9.
- **Round 11.** The governance question that asks who stands behind a masked competitor went from 0/3 to 3/3 (the assistant had joined the masking table back to the carriers table and named the real carrier). Held-out out-of-scope 2/3 to 3/3.
- **Round 12.** The fixer's patch refused the statement; the lead turned the refusal into a warning on the result, because a refused statement is a tool error, and `check-no-tool-errors` fails it even when the assistant recovers. Run over round 11's 493 dev statements, the check flagged 7, each a filter that removed no row. In the full run the warning fired in 3 attempts, all dev, and each then passed; the join question whose fiscal-year filter sat in a LEFT JOIN's ON clause went from 0/3 to 3/3. No question that flipped to failing had the warning fire.
- **Round 13.** Since BA-210 `ask_clarification` takes its options as one string, one per line, and `check-option-count` read only a list, so every clarification failed as carrying no options (18 of 18 in rounds 10 to 12). With the check reading the options as the tool does, 9 of 9 option-count results pass; dev ambiguous 4/5 to 5/5, held-out ambiguous 2/3 to 3/3.

**Rule A40 on gpt-6-luna:** dev 88/130 to 98/130, held-out 32/51 to 30/51 (within), ungrounded dev attempts 15 to 6. See [a40-gpt-6-luna.md](a40-gpt-6-luna.md).

**Spend:** rounds 10 to 13 and the A/B cost $5.00; the loop has spent $16.89 of its $22 (`round_cost_usd` summed).

## Why the rounds stopped at 13

With $5.11 left and the deadline on 2026-10-31, the lead stopped after round 13: what still fails on dev is no longer a group one lever can move. At round 13, 17 dev questions fail: 4 on every attempt and 13 flaky.

- **The check or the question, not the assistant** (each is the user's call; the question bank files and checks are forbidden to the rounds):
  - `final-score-2018` (join, 0/3): the answer reads the view `v_match_results`, which joins matches, tournaments and teams; `check-uses-entities` asks for one query that reads the three tables.
  - `possession-vs-result` (reasoning, 0/3): the answer names "the round of 16" to say the data does not hold it, and `check-numbers-grounded` reads the 16 as an ungrounded number.
  - `non-performing-loans` (encoding, 0/3 to 2/3 in rounds 11 to 13): its `matches` pattern `/^(?=[\s\S]*delinquen)(?=[\s\S]*default)/` has no `i` flag, so an answer naming the statuses as stored (`DELINQUENT`, `DEFAULTED`) fails.
  - `matches-by-stage` (aggregate, 0/3): the answer breaks the stages down by tournament; the reference counts each stage across both.
- **Knowledge the Marketing Analytics sample does not have:** `chart-harborline-premium-by-quarter` (visual, 0/3) sums every sale, the reference only bound ones. Marketing Analytics has no knowledge seed, and adding one means registering it in `registry.ts`, the supervisor's change in its own story (program.md, decision D7).
- **A flaky tail:** 13 questions pass 1 or 2 of 3 attempts, each on a different check.

## Re-measure on Claude

Rounds 9 and 11 are prompt rules, rounds 10 and 12 tool changes. All four change what the assistant receives, so the repo's eval gate on a Claude model (100%, three runs) still applies before PR #81 merges; it waits for the Anthropic keys.
