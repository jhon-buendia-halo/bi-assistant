# Rule A40 on a second model: gpt-6-luna (2026-10-23)

Prompt rule A40 (round 9: a derived figure the answer cites is computed in SQL first) was kept on gpt-5.6-luna, where it cut the attempts with an ungrounded number from 19 to 11 of 543. A prompt rule tuned on one model may not hold on another, so it was measured again on gpt-6-luna, a model the loop never tuned on.

## How

- **Side a:** round 8's build snapshot (no A40). **Side b:** round 9's build snapshot (A40). The two `dist/` folders differ only in `mastra/agents/assistant-prompt.js`.
- Both sides ran on the same three data dirs, cloned from the loop's (same samples, same Finance knowledge, the loop's `loop_*` databases), with the LLM set to `openai/gpt-6-luna` at low reasoning effort.
- Each side: World Cup, Finance and Marketing Analytics at once, repeat 3, judge off; side b after side a.
- gpt-6-luna was priced in `pricing.json` first (input $0.10, cached $0.01, output $0.50 per million tokens, read 2026-10-23). On a gpt-6 model the visual designer keeps the configured model, so no other model was called.

## Result

| | Side a (no A40) | Side b (A40) |
|---|---|---|
| Dev questions passing all 3 attempts | 88/130 | 98/130 |
| Held-out questions passing all 3 attempts | 32/51 | 30/51 |
| Dev attempts passing | 317/390 | 341/390 |
| Held-out attempts passing | 109/153 | 112/153 |
| Dev attempts failing `check-numbers-grounded` | 15 | 6 |
| Held-out attempts failing `check-numbers-grounded` | 0 | 0 |
| Cost per question | $0.0022 | $0.0021 |

`eval:diff` flags no category `down` on either split. Dev `reasoning` is `up` (0/2 to 2/2), and every other row is within its interval, `all` included (dev +8 pts, −3 to +18; held-out −4 pts, −22 to +15). The full diff, flips included: [eval-diffs/a40-gpt-6-luna-diff.txt](eval-diffs/a40-gpt-6-luna-diff.txt).

**Reading:** on gpt-6-luna, A40 moves the same mechanism the same way as on gpt-5.6-luna: fewer numbers the answer works out in the text (15 to 6), and more attempts passing. The held-out total is within the noise round 4's A/A run measured. A40 holds on a second OpenAI model. It is still to be measured on the Claude model of the beta (BA-9's eval gate, waiting for Anthropic keys).

Cost: $0.7831 (side a $0.3998, side b $0.3833), counted in round 11's row of `docs/evals/loop/results.tsv`.

Runs: side a `a6cd6e48`, `e73f961a`, `69e0efa8`; side b `1d275876`, `e78aa25a`, `837c4238` (saved in the cloned data dirs, now removed; the run files were `.eval-loop/ab-a40/runs/`).
