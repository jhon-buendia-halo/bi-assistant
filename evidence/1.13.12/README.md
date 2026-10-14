# 1.13.12 — Assistant reliability for the 100% eval bar ([BA-210](https://halo-powered.atlassian.net/browse/BA-210))

Epic [BA-198](https://halo-powered.atlassian.net/browse/BA-198). Commits 8ef933e, 9b4e0c2, 883be0b, 306f361, 9c29efa, c948702.

**Status: the acceptance gate has not passed.** The bar (CLAUDE.md step 9) is the world-cup set at 10/10 in each of 3 runs. The last round scored 9, 10, 10.

## What changed
- **Rule A4.** A best/top/performed-well question with no measure is ambiguous even when several measures could be covered, so the model asks first.
- **Rule A32.** Names are joined in the same query, so one result holds the whole answer.
- **Rule A35.** A question about the available data is answered without a query.
- **`create_visual`.** With no instruction it uses the turn's question (`turn-question`).
- **Designer data.** With more than 3 result sets and an instruction, the designer is shown the 3 the instruction is about, not the 3 largest.
- **`ask_clarification`.**
  - `options` is one string, one option per line. Models serialized the array forms wrongly now and then.
  - A list, a JSON list and a leaked `<parameter name="…">` wrapper are normalized.
  - A call that still fails the schema is retried, never shown as a card without options.

## E2E (web target, headless Chromium; desktop not run)
- [e2e-web-designer-and-prompt.txt](e2e-web-designer-and-prompt.txt): 36 passed (8ef933e/883be0b).
- [e2e-web-clarification.txt](e2e-web-clarification.txt): 17 passed (9c29efa).
- [e2e-web-final.txt](e2e-web-final.txt): 21 passed (c948702). Covers `chat-clarification`, `designer-skills`, `chat-and-visuals`, `agents` and `assistant-skills`.
- Scenario decisions: [../1.13.9/e2e-impact.md](../1.13.9/e2e-impact.md).

## Evals (`claude-sonnet-5`, World Cup Core; per-case JSON and summaries in [evals/](evals/))

| Commit | Run 1 | Run 2 | Run 3 | Failures |
|---|---|---|---|---|
| 9b4e0c2 | 9/10 | 9/10 | stopped | `ambiguous-best-team`: options array serialized wrongly |
| 306f361 | 10/10 | 9/10 | 8/10 | `final-score-2018`: names looked up in a second query; `ambiguous-best-team`: leaked parameter text |
| 9c29efa | 10/10 | 9/10 | 9/10 | `ambiguous-best-team`: string array serialized wrongly; `visual-request`: the designer lost the per-team result set |
| c948702 | 9/10 | 10/10 | 10/10 | `out-of-scope`: the answer added "Pelé played in 1958–1970" from general knowledge (rule A11) |

Before these stories the base scored 5/10, and the head before 1.13.11 scored 4/10.

## Next
`out-of-scope` passed in every earlier run. One fix is a sharper A12 sentence ("when the data doesn't cover the question, add nothing about it from general knowledge, not even background"), followed by another 3-run round.
