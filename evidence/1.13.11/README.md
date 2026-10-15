# 1.13.11 — Eval checks: a wider correct query passes; discovery cases don't require `list_entities` ([BA-209](https://halo-powered.atlassian.net/browse/BA-209))

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). Commit 906999d. Decided with the user 2026-10-14.

- **Why.** Before this change `champion-2022`, `final-score-2018`, `top-scorer-2022` and `biggest-venue` failed in every run, with correct answers: `result-set-match` required the query to return exactly the reference rows, and the model queries one level wider (all knockout matches, the top-10 scorers). `schema-discovery` required `list_entities`, although the session context lists the entities.
- **Now.** One complete, untruncated query passes when it holds every reference row in a row of its own; extra rows and columns are allowed; queries are never combined; an empty reference still needs an empty result. The discovery cases keep "mentions matches/driver", "no SQL" and "no tool errors".
- **Tests.** `result-set-check.spec.ts`: a leaderboard holding the answer passes, a wrong figure fails, two reference rows need two rows, an empty reference rejects any row, results from two queries are never combined.
- **Effect.** On 906999d, with nothing else changed: 8/10, with all four result-set cases passing ([../1.13.12/evals/](../1.13.12/evals/) has the gate runs).
