# Learning from feedback + answer pinning — engineering plan

Date: 2026-09-30.

## Goal

Two things, deliberately built together because the second depends on the
first. **Learning:** a reviewer's comment on a rated block (Business expert
mode's per-block feedback, or a whole-answer thumbs) can teach the assistant a
standing, general rule — never the specific answer — so a wrong-but-plausible
interpretation gets fixed for every future question that depends on it, not
just the one that was corrected. **Consistency:** once a question has been
answered and its SQL result is stored, asking the exact same question again
returns the exact same answer — without a second call to the model — unless
the learned context or the underlying data has actually changed.

Headline metric: **learning lift** — the share of the trap case plus its
generalisation case that flip FAIL→PASS after the two scripted reviewer notes
(target 2/2, confidence band medium→high). Constraint: **repeat consistency**
— 100% byte-identical replays for a repeated question with no intervening
feedback, both on the just-learned trap and on an unrelated control question.

## Decisions

1. **No fine-tuning.** What a reviewer teaches is a fact about the data or the
   business (a fiscal calendar, what "net revenue" means), which belongs in a
   retrievable, auditable, editable store the model reads every turn — the
   existing curated-knowledge block — not in model weights. Three
   independent reasons converge on this: (a) in a same-provider comparison,
   retrieval beat unsupervised fine-tuning at injecting knowledge the model
   hadn't seen, including a current-events task where RAG scored 0.875/0.876
   accuracy against fine-tuning's 0.504/0.511 on the same models (Ovadia,
   Brief, Mishaeli, Elisha — Microsoft — "Fine-Tuning or Retrieval? Comparing
   Knowledge Injection in LLMs," arXiv:2312.05934, EMNLP 2024,
   https://arxiv.org/abs/2312.05934); (b) fine-tuning on unfamiliar facts
   doesn't reliably teach them — it measurably *increases* hallucination
   elsewhere once the model does absorb them, because models mostly acquire
   facts in pretraining and fine-tuning mainly changes how they use what they
   already know (Gekhman, Yona, Aharoni, Eyal, Feder, Reichart, Herzig —
   "Does Fine-Tuning LLMs on New Knowledge Encourage Hallucinations?",
   arXiv:2405.05904, EMNLP 2024, https://arxiv.org/abs/2405.05904); and (c)
   the concrete path doesn't exist for our target models anyway — OpenAI's
   own supervised fine-tuning docs put the floor at 10 examples (50
   recommended to see improvement) and list only the GPT-4.1 family as
   supported targets; GPT-5 and the o-series reasoning models we actually run
   are not offered for supervised fine-tuning at all (OpenAI, "Supervised
   fine-tuning," developers.openai.com/api/docs/guides/supervised-fine-tuning,
   fetched 2026-09-30). A handful of reviewer comments is nowhere near a
   training set by that bar; an in-context edit takes effect on the very next
   turn, is visible in the Knowledge tab, and is reversible with one toggle.
2. **Learning = block comment → 0..n "lessons" as knowledge snippets**
   (`source: 'feedback'`, dataset-scoped, with provenance), distilled by a new
   `feedback-learner` agent with a deterministic verbatim fallback. Lessons
   are general rules, never answers, so they fix related questions too. They
   reach the assistant, the sql-verifier, and the business-expert explainer
   with no extra plumbing — those all already call `knowledge.contextFor`.
   This mirrors a pattern with growing empirical support: reflect on
   feedback, curate the reflection into structured, durable context, never
   touch weights (Zhang et al., "Agentic Context Engineering," ACE,
   arXiv:2510.04618; Suzgun, Yuksekgonul, Bianchi, Jurafsky, Zou — Stanford —
   "Dynamic Cheatsheet: Test-Time Learning with Adaptive Memory,"
   arXiv:2504.07952; Agrawal et al., "GEPA: Reflective Prompt Evolution Can
   Outperform Reinforcement Learning," arXiv:2507.19457, ICLR 2026 Oral).
3. **Learning runs synchronously on comment save** (one model call,
   `reasoningEffort: 'medium'`), lessons come back in the HTTP response — the
   UI can toast "Learned: Fiscal year, Net revenue" and the demo script can
   assert before opening session 2.
4. **Thumbs semantics.** 👍 on the SQL block or the whole answer → verified
   query + pin approved, trace rescored with `verified_match`. 👎 on any
   block or the whole answer → pin marked rejected (`rejectedAt`; kept, not
   deleted, so the next fresh answer can be reported as `updated`), verified
   query removed, `verified` badge cleared. A rejected pin is never replayed
   and its wording is never kept. A 👎 with no comment teaches nothing — there is
   no general rule in a bare "wrong," so no lesson is produced (a documented
   limit, not an oversight).
5. **Knowledge budget ported (8,000 chars, `continue` not `break`) with
   feedback pinned second**, right after `default_filter`. A lesson must
   never be silently crowded out of the prompt — this codebase already hit
   that failure once, when a 2,000-char break-based budget silently dropped a
   genomics filter and the suite fell from 61% to 43%.
6. **Consistency = answer pinning, one pin per lineage, gated on an exact
   re-run match.** "Set temperature to 0" does not make a hosted LLM
   deterministic: inference kernels are not batch-invariant, so a request's
   output depends on what else shares its batch on the server, which client
   settings don't control — 1,000 temperature-0 completions of the same
   prompt against Qwen3-235B produced 80 unique completions, diverging as
   early as token 103 (He et al., Thinking Machines Lab, "Defeating
   Nondeterminism in LLM Inference," 2025-09-10,
   https://thinkingmachines.ai/blog/defeating-nondeterminism-in-llm-inference/).
   Independently, five LLMs under nominally "deterministic" settings showed
   up to 15% accuracy variation and up to a 70% gap between a task's best and
   worst individual run (Atil et al., "Non-Determinism of 'Deterministic'
   LLM Settings," arXiv:2408.04667, EVAL4NLP 2025). Even a leading vendor's
   verified-query feature is similarity-based guidance, not a guaranteed
   exact replay — Snowflake's own evaluation docs strip verified queries out
   before grading, specifically to test the model without an exact-match hit
   (Snowflake, Cortex Analyst Verified Query Repository docs,
   docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository,
   fetched 2026-09-30). So consistency has to be its own explicit, engineered
   layer — an exact-match pin keyed on the normalised question — not an
   assumption about model or vendor behaviour.
7. **Chain key: yes, cheap.** The memory catch-up needed anyway (so a
   follow-up after a replayed turn still works) makes multi-turn replay free
   to support; the chain is just a hash of prior normalised user messages.
8. **Mode (`plain`/`careful`/`expert`) is in the lineage key, not the
   fingerprint.** An expert ask only ever replays an expert pin (trace
   included, byte-identical); a plain ask never has to synthesise one.
9. **Fingerprint scoped to the dataset, not judged lexically.** Relevance of
   one comment to another question can't be decided by string matching ("FY"
   vs. "fiscal year"); the fingerprint recomputes whenever *any* knowledge,
   metric, verified-query, schema, or model/effort state for the dataset
   changes, and the stabiliser (decision 10) absorbs the resulting false
   positives instead of forcing a visibly different answer every time.
10. **Stabiliser, simple form.** When a fresh derivation is forced but the new
    rows match the old pin's rows, keep the old wording (`kept`) and re-key;
    only a genuine row change produces `updated`. No stream trickery — the
    text is swapped at persist time, the same way the grounding guard already
    does it.
11. **Service default off, controller default on, `pin: false` opts out.**
    `run-eval.ts` keeps its 7-positional call byte-identical, so `--repeat`
    keeps measuring the raw engine, never a cache.
12. **Memory catch-up on replay, not `memory.saveMessages`.** A replayed turn
    is never sent to the agent, so the next *real* turn's `agentInput` walks
    back and prepends any contiguous replayed `(user, assistant)` pairs — the
    same mechanism the clarification path already relies on.
13. **Human-review-gated learning, always visible, never auto-trusted.**
    Vendors doing something adjacent keep a review gate between a rating and
    a persisted change: Databricks' Genie surfaces feedback-driven "knowledge
    mining" suggestions that an analyst must manually accept, keeping its one
    fully-automatic path (an exact parameterized-query match, labelled
    "Trusted") architecturally separate from free-form generation (Databricks,
    "Trusted assets" and "Tune Genie Agent quality,"
    docs.databricks.com/gcp/en/genie/trusted-assets,
    docs.databricks.com/aws/en/genie-agents/tune-quality, fetched
    2026-09-30). We deliberately do **not** gate: the reviewer writing the
    note *is* the human in the loop, so a lesson is enabled the moment it is
    learned (the demo needs it on the very next session). The Knowledge tab
    is the after-the-fact review — every learned lesson is a normal, visible,
    editable, disable-able snippet with a "From feedback" badge and its
    provenance. Adding an "approve before it applies" step later is one
    `enabled: false` default plus a button.
14. **Expert mode is review mode: answer under a stated convention instead of
    asking.** On the first live run GPT-5 met "net revenue in fiscal year
    2025" with a clarification ("What's your fiscal year boundary?") before
    running a single query — and none of its four options was the real
    Feb–Jan calendar. A clarification settles one conversation; a corrected
    assumption becomes a lesson for every later one. So on `expert` turns
    `SessionsService.streamMessage` appends `REVIEW_MODE_CONTEXT`: for a
    business convention the curated knowledge does not cover (fiscal
    calendar, metric formula, what a term includes), answer under the most
    common convention and state the assumption; still ask when the *data*
    matches something several ways (a person, member or value). Plain and
    careful turns are unchanged. Side effect to watch: the HR suite's
    clarification case (`reports-to-manager`) may now be answered rather
    than asked in `--expert` runs.

## The contracts

Full detail lives in the implementation plan (`learn-plan.md` §2, not checked
in); this is the condensed version engineers need day to day.

### Knowledge (`modules/knowledge/`)

```ts
export type KnowledgeSnippetSource = 'user' | 'mined' | 'feedback';
export interface LessonProvenance {
  feedbackId: string; sessionId: string; messageAt: string; block: string;
  question: string; comment: string; vote?: 'up' | 'down';
  learnedAt: string; method: 'agent' | 'verbatim';
}
export interface KnowledgeSnippet { …existing…; source: KnowledgeSnippetSource; provenance?: LessonProvenance; }
```

`KnowledgeService.createLearned` / `deleteLearnedFor` / `listLearned`;
`contextFor` order is `default_filter` → `source === 'feedback'` → the rest,
8,000-char budget, skip an entry that doesn't fit and keep filling (never
`break`). `update` ignores client-supplied `source`/`provenance`.

### Learning (`modules/learning/`)

```ts
class LearningService {
  learnFromComment(input: LearnInput): Promise<LearnResult>; // { lessons, superseded }
  forget(feedbackId: string): Promise<number>;
}
```

The `feedback-learner` agent (`mastra/agents/feedback-learner.agent.ts`,
registered in `mastra/index.ts`) sees the dataset schema, the question, the
answer, the rated block snapshot, the final SQL, existing lesson titles, and
the reviewer's note; it returns 0–3 lessons (`kind: 'term' | 'instruction' |
'default_filter'`, title, body, optional synonyms/entities/`appliesWhen`) or
`nothingToLearn`. Instructions: state facts, never the answer; never mention
"this question"; prefer `term` for definitions, `default_filter` for a
predicate that applies to every query. `maxSteps: 1`, `toolChoice: 'none'`,
`reasoningEffort: 'medium'`, structured output, one retry on a zod error. On a
second failure, a pure fallback (`lesson-distiller.ts`) persists one
`instruction` titled "Reviewer note: <block title>" with the comment
verbatim, `method: 'verbatim'`. Persisting a re-learned comment first calls
`deleteLearnedFor(feedbackId)` — a re-edited note re-derives its lessons and
wipes any manual edits to the old ones (documented limit, not silent).

### Answer pins (`modules/answer-pins/`, collection `answer_pins`)

```ts
export type PinMode = 'plain' | 'careful' | 'expert';
export interface AnswerPinDoc {
  id: string; lineageKey: string; fingerprint: string;
  fingerprintParts: { v: 1; knowledge: string; metrics: string; verified: string; schema: string; model: string };
  question: string; normalizedQuestion: string; datasets: string[]; chain: string[]; mode: PinMode;
  datasourceId: string; sql: string; columns: string[]; rows: Record<string, unknown>[]; rowCount: number; rowLimit: number;
  message: Omit<ChatMessage, 'at' | 'feedback' | 'usage' | 'consistency'>;
  knowledgeIds: string[];
  sourceSessionId: string; sourceMessageAt: string;
  replays: number; lastReplayedAt?: string; createdAt?: string; updatedAt?: string;
}
```

`lineageKey = sha256([1, normalise(question), sort(datasets), chain.map(normalise), mode])`
— case/whitespace/trailing-punctuation-insensitive, dataset-order-insensitive,
but mode- and chain-sensitive (a paraphrase, or the same question in a
different conversation shape, is a new lineage — deliberate). `fingerprint =
sha256(knowledge-used-hash, metrics-block-hash, verified-block-hash,
schema-hash, model+effort)` — everything that legitimately changes an answer,
scoped to the dataset; it does *not* look at sample values — data changes are
caught instead by re-running the pinned SQL before every replay.
`AnswerPinsService.lookup / save / approve / reject / remove / touchReplay /
list / deleteForDataset`. HTTP:
`GET/DELETE /answer-pins?datasetId=`, `DELETE /answer-pins/:lineageKey`.
`eligibility.ts` excludes clarifications, visual turns, truncated/warned
records, empty results, and non-final answers from ever being pinned.

### Session message + replay algorithm

```ts
export interface AnswerConsistency {
  kind: 'replay' | 'kept' | 'updated';
  pinnedAt: string; sourceSessionId?: string; verifiedAt?: string; lessons?: string[];
}
export interface ChatMessage { …; consistency?: AnswerConsistency; }
```

`SessionsService.streamMessage(..., pin = false)`: computes the lineage key
and fingerprint before any model call; if a pin exists with a matching
fingerprint (and datasource), re-runs its stored SQL read-only and compares
results (6-significant-digit rule, same one careful mode and the eval harness
use) — a match emits the stored `message.content` verbatim with
`consistency.kind: 'replay'` and zero model calls; a mismatch (data moved)
falls through to a fresh derivation. At persist time, an eligible turn either
keeps the old wording (`kept`, rows match a moved fingerprint) or is saved as
`updated` with the titles of any new feedback lessons; the pin is (re)saved
either way. `agentInput` prepends any contiguous trailing `(user,
assistant-with-consistency.kind==='replay')` pairs that were never sent to the
agent, so a follow-up after a replay still has full context — the same
mechanism the clarification path already uses.

### HTTP / SSE

- `POST /sessions/:id/messages/stream` body gains `pin?: boolean` (service
  default `true` at the controller, `false` at the service — see decision 11).
  A replay emits one `text` event with the full content, then `done`; no new
  event types.
- `POST /sessions/:id/expert/feedback` response gains `lessons?:
  LearnedLesson[]`; `message` becomes `"Feedback saved — learned: Fiscal
  year, Net revenue"` when lessons were produced.
- 👍 on the SQL block or the whole answer now also approves the matching pin
  (fingerprint recomputed, trace rescored with `verified_match`, floored at
  0.85); 👎 on any block or the whole answer marks it rejected and removes the
  verified query.
- `GET /knowledge?source=feedback` filters to learned lessons.

### Suite JSON

```ts
export interface LearningScenario {
  comments: { block: ReasoningBlockKind; vote?: 'up' | 'down'; comment: string }[];
  generalisesTo?: string[];
  before?: { band: ConfidenceBand }; after?: { band: ConfidenceBand };
}
```

`EvalSuiteCase.learningScenario?: LearningScenario` — strict keys,
`generalisesTo` ids validated against the suite.

## The Retail fixture

New schema `retail` in the shared Docker Postgres (dataset **Retail**),
generated the same way as `hr.ts` — fixed `SEED`, one `Rng`, invariant
`assert`s that throw on drift, output piped to
`docker/postgres/init/005_retail.sql`. Data window 2024-01-01…2026-03-31 (FY
2025 = 2025-02-01…2026-01-31, fully inside the window).

**Tables:** `stores` (6, one Online), `products` (120, 8 categories),
`customers` (1,500), `orders` (~6,000, `status IN ('completed','cancelled')`,
one date column `ordered_at`), `order_lines` (quantity, `unit_price`,
`discount_amount`).

**The trap:** `amount_charged = round(merch_net * (1 + tax_rate) + shipping,
2)` — tax rate and shipping vary by store and are never exposed as columns
anywhere, and there is no `fiscal_periods` table. "Net revenue" is
`Σ(quantity * unit_price − discount_amount)` over **completed** orders in the
**fiscal** year window; `orders.amount_charged` is the amount charged (includes
tax and shipping) and a plain "2025" defaults to the calendar year. Ten
invariants (R1–R10) assert the two readings are never accidentally close —
e.g. FY2025 net revenue vs. calendar-year net revenue differ by ≥ 2.5%, and
the five candidate figures for the flagship question are pairwise distinct at
6 significant digits.

**Seeded knowledge** (facts about the data only): "Completed orders only"
(default filter), "Order date" (`ordered_at` is the only date on an order),
"Units", "Line discount", "Coverage" (date range, USD). **Deliberately
absent:** any statement of what a fiscal year is, and any definition of "net
revenue." Those two facts are exactly what the reviewer is meant to teach —
seeding them up front would make the trap untestable, the same overfitting
rule that removed two answer-hinting snippets from the HR/genomics fixtures.

**The six suite cases** (`suites/retail.json`, id `retail`):
`net-revenue-fy2025` (the flagship trap, `learningScenario` attached),
`orders-fy2025` (its generalisation case — a different question, same two
facts, no comments of its own), `top-category-units-march-2025` (control),
`gross-charged-cy2025` (control — proves the revenue lesson doesn't
over-generalise to `amount_charged`), `new-customers-2025` (control — proves
the fiscal-year lesson doesn't contaminate a plain calendar year),
`net-revenue-by-store-fy2025` (both lessons, six-row answer).

**The two reviewer comments** (verbatim, exactly as the demo posts them):

> **interpretation**, 👎 — "Our fiscal year runs from 1 February to 31
> January and is named for the year it starts: FY2025 is 2025-02-01 through
> 2026-01-31. Apply this only when a question says fiscal year or FY — a
> plain year like '2025' means the calendar year."

> **metric**, 👎 — "Net revenue is merchandise only: for each order line,
> quantity × unit_price minus discount_amount, summed over completed orders
> placed in the period. Never use orders.amount_charged for revenue — it is the
> amount charged and includes tax and shipping. Cancelled orders never
> count."

Why the trap lands in the medium band before learning: the interpretation and
metric terms carry basis `assumption`/`convention` (no grounded `sourceRef`)
so `knowledge_coverage` is 0 and `assumption_load` is capped — interpretation
≈ 0.2–0.4, assumptions ≈ 0.3–0.5, metric ≈ 0.45, while data-selection and SQL
stay ≈ 0.98, for an overall ≈ 0.68–0.74. After learning, every one of those
bases becomes `knowledge` with a matching `sourceRef` and every block scores
≥ 0.95.

## Measurement

- **Headline: learning lift** — of the flagship trap case and its
  generalisation case, the fraction that flip FAIL→PASS after the two
  scripted notes, with confidence band moving medium→high. Target 2/2.
- **Constraint: repeat consistency** — 100% byte-identical replays for a
  repeated question with no intervening feedback, measured both on the trap
  (post-learning) and on an unrelated control question.

## How to run

```bash
# 1. Build and load the fixture (init scripts only run on first container start)
cd backend && npm run fixtures:retail && cd ..
docker exec -i questions-to-insights-world-cup-postgres-1 \
  psql -U world_cup -d world_cup -v ON_ERROR_STOP=1 -c 'DROP SCHEMA IF EXISTS retail CASCADE'
docker exec -i questions-to-insights-world-cup-postgres-1 \
  psql -U world_cup -d world_cup -v ON_ERROR_STOP=1 < docker/postgres/init/005_retail.sql

# 2. Register the fixture into a SCRATCH store (never the real app store)
STORE=<scratch store dir>
cd backend
APP_DATA_DIR="$STORE" npm run fixtures:register
APP_DATA_DIR="$STORE" npm run eval:validate -- --suite retail   # zero model calls, every case OK

# 3. Run the backend on a test port and the scripted check
npm run build && APP_DATA_DIR="$STORE" PORT=3110 node dist/main &
npm run learning:demo -- --port 3110    # ~14-18 model calls

# 4. Frontend, pointed at the test backend
cd ../frontend && npm start
# open http://localhost:4200/?api=http://localhost:3110
```

**Testing inside the desktop app itself:** the installed app and `npm run
electron` both default to port 3000 and the same real app store, so they
cannot run at once. Quit the installed Questions to Insights app first, then
run `npm run electron` **from this worktree only** — never point it at the
scratch store or the real one interchangeably mid-session.

## Results

Live run 2026-09-30, `npm run learning:demo -- --port 3110`, gpt-5 at high
reasoning effort, scratch copy of the app store, one run (~17 model calls):

| Step | Question | Band | Correct | Consistency | Cross-check |
| --- | --- | --- | --- | --- | --- |
| S1 | net revenue in fiscal year 2025 (before notes) | low 0.50 | no ($389,641.99 — calendar year) | — | disagree |
| — | two reviewer notes → 5 lessons | | | | |
| S2 | same, new session | high 0.83 | yes ($401,306.11) | `updated` | agree |
| S3 | same, new session | high 0.83 | yes | `replay`, byte-identical, 0 calls | agree |
| S4 | orders in fiscal year 2025 (no notes of its own) | high 0.87 | yes | — | agree |
| S5 | top category by units, March 2025 (control) | low 0.50 | yes (Outdoor, 92) | — | disagree |
| S6 | same, new session | low 0.50 | yes | `replay`, byte-identical | disagree |

- **Learning lift: 2/2** (both learning-scenario cases FAIL→PASS, band
  low→high). **Repeat consistency: 2/2.**
- **Anomaly 1 — S1 low, not medium.** The verifier read "net revenue" as
  `orders.total_amount` ($423,385) while the assistant summed lines, so the
  disagreement cap applied. The column is now `amount_charged` (figures
  unchanged, `eval:validate` 6/6). Without that split, two probes of the same
  question landed medium (0.76, 0.79). Not re-run live after the rename.
- **Anomaly 2 — control S5 low while correct.** The verifier returned the
  top row, the answer the whole ranking; `compareResults` required equal row
  counts. Fixed with the cross-check-only `leadingRows` option
  (`result-compare.ts`, 4 specs); eval grading keeps strict row counts.
- **Anomaly 3 — first attempt was a clarification**, which led to decision 14
  (review mode).
- Provider noise during the run: OpenAI `ECONNRESET` and 300 s header
  timeouts; the explainer's retry absorbed them, and the demo client now uses
  `node:http` so a silent minute is never an abort.

## Honest limits

- Cross-check disagreement before learning would cap the answer at 0.5 (low,
  not medium) — the demo hard-asserts "wrong and not high" and warns loudly
  if the band comes back low, printing the cross-check note so it's obvious
  why.
- Lesson quality is only as good as the distillation call; it's visible and
  editable in the Knowledge tab, and a re-edited comment re-derives its
  lessons from scratch, wiping any manual edits made to the old ones.
- Fingerprint over-sensitivity: any knowledge or metric change on the dataset
  forces one fresh derivation per pinned lineage on that dataset, even when
  unrelated. The stabiliser keeps the old wording when the numbers hold, so
  the cost is a DB re-run, not a visibly different answer.
- Replays are exact-question-only (case/whitespace/punctuation-insensitive);
  a paraphrase is a new lineage — deliberate, not a missed case (a semantic/
  fuzzy match cache would risk returning a *different* question's answer).
- Memory catch-up depends on Mastra faithfully persisting assistant messages
  passed as input — the clarification path already depends on the same
  behaviour.
- Cost: one model call per comment save; a replay costs one DB query, zero
  model calls.
- Not built: a 👎 with no comment teaches nothing; lessons are dataset-scoped
  only, never global; the in-app Evals tab bypasses `SessionsService`
  entirely, so this feature is only measurable via the CLI/demo script, not
  from the UI's own eval runner.
