# Running the improvement loop

How to measure the engine on a dataset, change one thing, and prove whether it
helped. This is the operator's runbook for the loop in *Questions to Insights
Evals*, Part 2.

The rule the whole thing rests on: **same questions, same data, one change at a
time.** Change two levers at once and the report tells you nothing about either.

---

## 0. Once per machine

```bash
# repo root
docker compose up -d postgres          # the three fixtures live here
cd backend && npm run fixtures:register # datasource + datasets + knowledge/metrics
```

`fixtures:register` is idempotent — re-run it after regenerating a fixture.

The harnesses read the **same local datastore the desktop app uses**. On macOS
that is `~/Library/Application Support/Halo BI Assistant`. Either run the app
once and configure Settings → LLM there, or point the harness at its own store:

```bash
export APP_DATA_DIR="$HOME/Library/Application Support/Halo BI Assistant"
```

An LLM must be configured in that store, or `OPENAI_API_KEY` must be exported
for the `gpt-4o-mini` fallback. Everything in step 1 runs without either.

---

## 1. Validate the case set — zero model calls, zero cost

Before spending anything, prove the references are trustworthy. The harness
believes `expectedSql` completely, so a wrong reference produces confident false
failures — the second of the three honest limits.

```bash
cd backend
npm run eval:validate -- --suite world-cup
npm run eval:validate -- --suite health-insurance
npm run eval:validate -- --suite genomics
```

Every case must report **OK** with a small row count. Investigate anything else:

| Verdict | What it means | What to do |
| --- | --- | --- |
| `EMPTY` | The reference returns no rows | The case cannot discriminate. Fix the SQL or the fixture. |
| `TOO-MANY` | At or above the row cap | The comparison is untrustworthy. Narrow the question. |
| `ERROR` | The SQL does not run | A column was renamed, or the fixture was not loaded. |

Re-run this after **every** fixture regeneration. It is free.

---

## 2. Record the baseline

The "before" every later run is compared against. Label it, so the log is
readable a month from now.

```bash
npm run eval -- --suite health-insurance --label baseline
npm run eval -- --suite genomics --label baseline
npm run eval -- --suite world-cup --label baseline
```

Each run writes `logs/evals/<date>-<suite>-baseline-<id>.json` and appends a
line to `logs/evals/index.ndjson`: pass counts, per-category tallies, token
counts and — once `logs/pricing.json` has a rate for the model — an estimated
cost. Token counts are measured; costs are estimated. See `logs/README.md`.

Run the World Cup suite too, even though you are not working on it. It is the
side-effect detector: a prompt change that fixes claims questions and quietly
breaks football questions is the failure mode evals exist to catch.

### If a case flips between runs

Models are not deterministic. One flip may be noise, not signal.

```bash
npm run eval -- --suite health-insurance --only paid-share --repeat 5
```

A case that passes 5/5 or 0/5 is telling you something. A case that passes 3/5
is telling you it is flaky, and that fixing it means making the answer
*reliable*, not just possible.

---

## 3. Read the per-category table, not the total

The run prints a per-category summary sorted worst-first. That ordering is the
whole diagnostic: the category is the failure class, and each failure class
points at one lever.

| Category | Lever it usually points at |
| --- | --- |
| `ratio-trap`, `constant-column`, `empty-column` | **Tools & guards** — a wrong result reached the answer without a warning |
| `value-vocabulary`, `metric-definition`, `default-filter`, `domain-semantics` | **Context** — the agent misunderstood your business, not SQL |
| `clarification`, `out-of-scope`, `id-vs-name`, `unit-confusion` | **Prompt rules** — a written rule could have prevented it |
| `multi-step-join`, `ties`, `quality-filter` | **Model & mode** — the reasoning itself was too weak |
| `discovery`, `control` | Nothing. These must keep passing; a failure here is a regression. |

The mapping is a starting point, not a law. Read the trace before you act:
Agents → Evals → Executions → click a case, or the `#### Executed steps`
section of the downloaded Markdown report.

---

## 4. Change exactly one lever

| Lever | Where | Rebuild? |
| --- | --- | --- |
| Prompt rules | `backend/src/mastra/agents/assistant.agent.ts` | yes |
| Tools & guards | `backend/src/mastra/tools/dataset.tools.ts`, `backend/src/modules/sessions/result-guards.ts`, `sql-fixer.agent.ts` | yes |
| Context | Knowledge / Metrics / Datasets screens, or `npm run fixtures:register` | no |
| Model & mode | Settings → LLM; the Careful switch | no |

Write down what you changed and why *before* re-running. The log records the
numbers; only you can record the intent.

---

## 5. Re-run the affected category, then everything

Cheap first, broad second:

```bash
# did the thing you aimed at move?
npm run eval -- --suite health-insurance --category ratio-trap --label iter-1-guards

# did anything else break?
npm run eval -- --suite health-insurance --label iter-1-guards
npm run eval -- --suite world-cup        --label iter-1-guards
```

Then compare. In the app, Agents → Evals → Executions shows the diff against the
previous run of the same suite. From the log:

```bash
jq -s 'map({label, suite, passed, cases, totalTokens, estimatedCostUsd})' \
  logs/evals/index.ndjson
```

---

## 6. Keep or revert — a person decides

Keep the change when the category improved and nothing regressed. Revert when
the totals are flat but two categories traded places: that is not an
improvement, it is a different set of failures.

Append the result to `docs/evals/change-log.md`: the lever, the one-line
rationale, and the before/after counts per category. That file is the answer to
"why is the prompt like this?" six months from now.

---

## 7. Add a case whenever a real answer is wrong

The loop only defends what it measures. When a user hits a wrong answer in a
real session, it becomes a case:

1. Reproduce it against a fixture, or plant the property that caused it.
2. Write the trusted SQL **by hand** and verify it (step 1).
3. Add it to the suite JSON with the `category` of the failure class.
4. Re-run. It should fail. Then fix it.

A case added after the fix, that passes immediately, guards nothing.

---

## Honest limits

- **Non-determinism.** One flip may be noise. Use `--repeat` before acting.
- **A wrong reference is worse than no reference.** It produces confident false
  failures, and you will change the engine to satisfy a bug. Step 1 is not
  optional.
- **The judge runs on the same model as the agent.** Treat its verdicts as a
  second opinion, not proof — especially when it passes something you doubt.
- **Costs are estimates.** Token counts come from the provider and are exact.
  Dollars are counts × the rates in `logs/pricing.json`, which you maintain.
