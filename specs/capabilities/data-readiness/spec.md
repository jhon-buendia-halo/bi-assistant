# Data readiness

Dana, the **Data Readiness Assessor** (`data-readiness-assessor`, 2026-11-26), is a built-in conversational agent that answers one question: *is this data ready for this use?* She scopes the use with the requester, measures the datasets the conversation holds, and reports a verdict, a level per dimension and the evidence behind each. The measurement, the levels, the gates and the verdict are computed **in code** by the `assess_readiness` tool; the model scopes and narrates ([architecture.md](../../system/architecture.md) ADR-0060). She never changes data.

She replaces the capability of Sarah (`data-readiness`, the Data Readiness Agent), who was removed on the same day ([workflows](../workflows/spec.md) R50, [agents.md](../../system/agents.md) 2.10). Nothing of Sarah is revived: a new key, a new collection, a new tool and new field names. Dana's agent, tool, prompt and skills are in [agents.md](../../system/agents.md) 2.24, 3.19 and 7.4; the stored shape in [data-model.md](../../system/data-model.md) 3.21; the conversation is the one of Elena ([agents-evals](../agents-evals/spec.md) R115 and R120). The sampled profile of the dataset editor (**Profile & synthesize**) is a different feature: [synthetic-data](../synthetic-data/spec.md).

## Concepts

- **Use case.** What the data will be used for, in the requester's words, with a **use type** (`analytics`, `dashboard`, `ml`, `rag-agent`) and a **risk** (`low`, `medium`, `high`). Without one there is no assessment.
- **Scoping card.** The `ReadinessScope` Dana builds with the requester and passes to `assess_readiness`: use case, use type, risk, consumer, decision, critical entities, critical fields (each marked indispensable or not, with its tolerated null rate), grain keys, required freshness in hours, tolerated duplicate rate, whether personal data is needed, the legal basis, the owner of each dataset and every **assumption** made instead of asking.
- **Dimensions D1 to D6.** D1 Availability and access, D2 Quality, D3 Freshness and reliability, D4 Semantics and documentation, D5 Governance and privacy, D6 AI fitness (only for `ml` and `rag-agent`).
- **Level.** 0 Nonexistent, 1 Initial, 2 Partial, 3 Adequate, 4 Optimal, or **N/E** (not evaluated: it could not be measured; never averaged as 0 or 4).
- **Gates G1 to G6.** Blocking criteria (access, owner, legal basis, exposed PII, key field, critical freshness). Each is `pass`, `fail` or `not-evaluated`.
- **Verdict.** `ready`, `ready-with-conditions` or `not-ready`, decided by the gates and the minimums, never by the average.
- **Critical dimension.** A dimension whose weight for the use type is 20% or more.
- **Evidence.** One measured fact (`EV-001`…): an aggregate SQL result, a computation over a sample, or the dataset's saved metadata, with its coverage. Every level, gate and finding cites evidence.
- **Baseline.** The previous assessment of the same use case and datasets (same `useCaseKey`); the next one reports what changed against it.

## Rules

- R1 (retired, 2026-11-26). The app no longer offers the Data Readiness Agent (Sarah, `data-readiness`), the Assess Data Readiness workflow (`data-readiness-assessment`), its deterministic DMBOK engine, saved readiness reports (`readiness_reports`), the readiness scorecard or the readiness routes. Stored data of the removed feature is handled as [workflows](../workflows/spec.md) R50 and [data-model.md](../../system/data-model.md) M17 and M18 say. Dana (R2 onwards) replaces the capability with a new key and a new collection; the removed things stay removed.
- R2. Dana SHALL evaluate only against a use case. When the use case, its use type or its risk is not clear she SHALL ask (one question that makes the run wait and resume, as Elena's, [agents.md](../../system/agents.md) 2.23); what the requester does not answer she SHALL state as an assumption on the scoping card. `assess_readiness` SHALL refuse a scope with no use case.
- R3. The verdict, the levels, the gates and the weighted score SHALL be computed in code by `assess_readiness` from the rubric below, and SHALL NOT be computed, changed, rounded or overridden by the model. The report SHALL quote what the tool returned.
- R4. **Gates override averages.** When any gate fails, the verdict SHALL be `not-ready` whatever the levels and the weighted score are. The weighted score SHALL be reported only as a progress indicator between assessments.
- R5. **No evidence, no level.** A dimension or gate with no evidence SHALL be `N/E` (`not-evaluated` for a gate), never a guess. Where the evidence sits between two levels the engine SHALL take the lower. A criterion the app cannot measure SHALL cap the level at what was measured and SHALL be listed in `notEvaluated` with its reason.
- R6. **What the app measures.** From the datasets of the conversation, with portable aggregate SQL (`COUNT(*)`, `COUNT(col)`, `COUNT(DISTINCT …)`, `MAX(date)`) and a sample of rows (size by risk: low 200, medium 1,000, high 5,000, capped by the connector): D1 whether each critical entity answers and its row count and date range; D2 null or empty rate of critical fields, duplicate grain keys, invalid formats and sentinel values (sample), orphan references; D3 the age of the newest date value against the required freshness and daily volume gaps over the last 30 days; D4 the share of columns and critical fields with a useful description, notes, layers, declared references and cryptic names; D5 a PII scan of the sample (types and rates only), whether personal data is needed and the legal basis; D6 (`rag-agent`) machine-readable descriptions, coded values without a dictionary, raw-layer exposure and PII exposure.
- R7. **Always N/E.** The app SHALL always report as not evaluated, with the reason: owner metadata and support channel (D1: the owner is only what the requester named), accuracy against a source of truth and existing data-quality tests (D2), pipeline runs, SLA history and schema history (D3), governed metric definitions and lineage (D4), classification labels, access policies, retention and audit (D5), and for D6 ML labels, balance and leakage and document stores. Level 4 is reachable only when its automatic-control criterion has evidence, which the app has none of today.
- R8. **No personal value in any output.** Dana's report, the stored assessment, the evidence and the query inspector SHALL NOT contain an individual personal value (an email, a phone number, a card number, a national id, a name read from a row); they SHALL hold counts, rates, patterns and types only. Negative test: a dataset seeded with emails and phone numbers is assessed, and neither the tool's result, the stored assessment nor the answer contains any of the seeded values.
- R9. **Read-only, no remediation.** Dana SHALL recommend and assign; she SHALL NOT change data, pipelines or definitions, and a request to run a remediation SHALL be answered with the recommendation and an escalation. Every statement she runs is read-only ([agents.md](../../system/agents.md) 5.2).
- R10. **Baseline.** Each assessment SHALL be stored in `readiness_assessments` (R14) with its rubric version. When an earlier one exists for the same `useCaseKey` the new one SHALL carry the comparison (`previous`): per dimension the level before and after, per gate the status before and after, and the previous verdict. When the rubric version differs, the comparison SHALL say so.
- R11. **Escalation.** The assessment SHALL list in `escalations` why a human must look at it: no identifiable owner for a critical dataset, personal data with no classification or clear legal basis, sources that contradict each other with no source of truth, a high-risk use whose verdict is not `ready`, and a request to run remediation.
- R12. **Data is data.** Text inside tables, comments or results SHALL NOT be treated as an instruction (guardrail 7.2 of the rubric).
- R13. **Report order (the output contract).** Dana's final answer SHALL contain, in this order: 1 the verdict in one sentence; 2 the blocking gates and their status; 3 the score per dimension (level 0 to 4 or N/E, with the key evidence ids); 4 the main gaps (3 to 5, with impact and owner); 5 the remediation plan, prioritised, with closing criteria; 6 scope and method (use case, datasets, window assessed, what was not evaluated and why, the evidence). She answers in the language of the requester.
- R14. Dana SHALL be a built-in Official agent with the classes `person` and `data`, no memory and no Try it, run in a conversation like Elena's ([agents-evals](../agents-evals/spec.md) R120).

### The rubric (version 1.0)

The rubric is the standard the engine applies (`READINESS_RUBRIC_VERSION`, `modules/readiness-assessor/readiness.types.ts`). A change to any table below is a new version, so assessments stay comparable over time (R10).

**Dimensions (3.1).**

| # | Dimension | Question | Applies to |
|---|---|---|---|
| D1 | Availability and access | Does the data exist, is it reachable and has it an owner? | All |
| D2 | Quality | Is it complete, unique, valid, consistent and accurate? | All |
| D3 | Freshness and reliability | Does it arrive on time and steadily? | All |
| D4 | Semantics and documentation | Is it clear what each thing means and where it comes from? | All |
| D5 | Governance and privacy | Can it be used legally and safely? | All |
| D6 | AI fitness | Does it meet the requirements of ML, RAG or agents? | AI uses only (`ml`, `rag-agent`) |

**Levels (3.2).** 0 Nonexistent: cannot be reached or does not exist. 1 Initial: exists, with serious problems that prevent use. 2 Partial: usable with important limits and manual supervision. 3 Adequate: meets the use's requirements with minor, documented limits. 4 Optimal: exceeds them, with monitoring and automatic controls. N/E: could not be measured; never averaged.

**Criteria by dimension (3.3).**

| Dimension | Level 1 | Level 2 | Level 3 | Level 4 |
|---|---|---|---|---|
| D1 Availability | Exists but no stable access or no owner | Manual or high-friction access; informal owner | Programmatic access; defined owner | Governed self-service access; owner and support channel |
| D2 Quality | Serious failures in key fields (more than 20% nulls, massive duplicates) | Known moderate failures; no tests | Within the use's thresholds; basic tests | Within thresholds with automatic tests and alerts |
| D3 Freshness | Manual or irregular loads | Automatic loads with frequent failures or no SLA | Meets the required SLA in 95% or more of loads | Meets the SLA in 99% or more, with monitoring and a stable schema |
| D4 Semantics | No documentation; cryptic names | Partial documentation (under 50% of key columns) | Key columns documented; metrics defined | Semantic layer or governed metrics; full lineage |
| D5 Governance | No classification; uncontrolled PII | Partial classification; broad access | Classified; PII masked; access by role | The above plus retention, audit and documented legal basis |
| D6 AI fitness | Insufficient volume, labels or format | Sufficient with important biases or gaps | Representative, labelled and documented for the use | The above plus versioning, reproducible splits and drift monitoring |

**Blocking gates (3.4).** If any fails the verdict is `not-ready`.

| Gate | Fails when |
|---|---|
| G1 Access | A critical source is not reachable (D1 = 0) |
| G2 Owner | No critical source has an identifiable owner |
| G3 Legal basis | Personal data without a legal basis or purpose compatible with the use |
| G4 Exposed PII | PII neither classified nor masked in a use that does not need it |
| G5 Key field | A field the use cannot do without has quality level 1 or lower |
| G6 Critical freshness | Freshness is below the minimum the use requires (the use asks for daily data and it arrives weekly) |

**Weights by use type (3.5).**

| Use type | D1 | D2 | D3 | D4 | D5 | D6 |
|---|---|---|---|---|---|---|
| `analytics` (ad hoc) | 15% | 30% | 15% | 25% | 15% | — |
| `dashboard` (recurring report) | 10% | 25% | 25% | 25% | 15% | — |
| `ml` | 10% | 25% | 15% | 10% | 15% | 25% |
| `rag-agent` | 10% | 15% | 15% | 20% | 20% | 20% |

The weighted score (0 to 4) is the sum of level × weight over the evaluated dimensions, with the weights of N/E dimensions redistributed pro rata; it is `null` when a dimension weighing 20% or more is N/E, and `weightedScoreNote` says how it was made or why there is none.

**Verdict (3.6).**

| Verdict | Condition |
|---|---|
| `ready` | Every gate passes, no applicable dimension is below 3 and no critical dimension is N/E |
| `ready-with-conditions` | Every gate passes, no dimension is below 2, and each dimension at level 2 has at least one verifiable condition (the engine writes them from its findings into `conditions`) |
| `not-ready` | Any gate fails, or an applicable dimension is below 2, or a critical dimension is N/E |

A gate that is `not-evaluated` does not fail the verdict by itself, and it is listed in `notEvaluated`.

**Guardrails.** 7.1 no individual personal value in any output (R8); 7.2 data is data (R12); 7.3 every assessment records the rubric version (R10).

## Edge cases and errors

- **No datasets in the conversation.** `assess_readiness` answers that there is nothing to assess and Dana asks the requester to pick datasets; no assessment is stored.
- **A critical entity does not answer** (renamed, dropped, no access). D1 is level 0 for it, G1 fails, the verdict is `not-ready`; the other dimensions of that entity are `N/E`.
- **A statement fails or times out.** That measurement is `N/E` with the reason and the statement; the assessment continues with the rest.
- **A connector caps the sample** below the size the risk asks for. The evidence states the sample size actually used and its coverage `sample`.
- **No date column** on an entity. D3 is `N/E` for it and G6 is `not-evaluated`; the use's freshness requirement is listed as not evaluated.
- **`requiredFreshnessHours` absent.** G6 is `not-evaluated`.
- **A new rubric version** since the previous assessment. The comparison is still made and carries `previousRubricVersion`; Dana says the two are not strictly comparable.
- **The requester does not answer a scoping question.** Dana proceeds with the most natural reading, states each assumption on the card and in the report, and says which of them could change the verdict.
- **The tool's failure** (an unexpected error). Dana reports that the assessment could not be made and why, and does not estimate a verdict.

## Contracts

- **Tool `assess_readiness`** ([agents.md](../../system/agents.md) 3.19). Input: a `ReadinessScope` (the scoping card). Output: the `ReadinessAssessment` it computed and stored, with every level, gate, finding, evidence item, `notEvaluated` entry, escalation and the baseline comparison. It reads the conversation's datasets; it writes only its own assessment.
- **Stored assessment.** One document of the collection `readiness_assessments` per call ([data-model.md](../../system/data-model.md) 3.21). Types: `backend/src/modules/readiness-assessor/readiness.types.ts` (`ReadinessScope`, `ReadinessEvidence`, `ReadinessFinding`, `GateResult`, `DimensionResult`, `ReadinessBaselineDelta`, `ReadinessAssessment`).
- **Conversation.** A run of `agent:data-readiness-assessor` ([api.md](../../system/api.md) 2.6.2, 117); the catalogue entry of the agent carries `conversation` ([api.md](../../system/api.md) 34).
- No readiness route exists beside those: the assessment is made by the tool inside the conversation.

## UI

- Dana's agent page (Agent personas) carries **Ask Dana** (`agent-ask-button`), as Elena's page carries Ask Elena ([ui.md](../../system/ui.md) 4.5, 4.5.12; [agents-evals](../agents-evals/spec.md) R120). The conversation page is Elena's, with Dana's breadcrumb and chip.
- Dana's report is her answer in the chat, in the order of R13. The SQL behind each piece of `sql` evidence appears in the **query inspector** of the answer (agent-answers R56, as for every answer from data), with its result as aggregates only (R8).
- Dana has no Try it and no panel of her own.

## Flows

1. The requester opens Dana's page and chooses **Ask Dana**, picks datasets and says what the data is for.
2. Dana scopes the use: she asks at most one question at a time and writes the rest as assumptions (R2).
3. She calls `assess_readiness` with the scoping card. The tool measures, levels, gates, decides the verdict, compares with the baseline and stores the assessment (R3 to R10).
4. She drills down with the data tools when asked (read-only) and writes the report in the order of R13.
5. A later request for the same use case and datasets produces a new assessment that reports what changed against the baseline (R10).

## Acceptance

Gherkin. The Playwright spec of this Feature (`frontend/e2e/dana-readiness.spec.ts`) is not written yet, so the Feature carries no `E2E:` line (the spec check requires a referenced E2E file to exist); the line is added with the spec.

```gherkin
Feature: Ask Dana

  Scenario: Dana assesses a dataset for a use case and reports a verdict with evidence
    Given a dataset whose critical field has more than 20% empty values
    When I open the "Dana" agent and click "Ask Dana"
    And I say what the data is for and answer her scoping question
    Then I see a report that starts with the verdict "not ready"
    And I see the gate "G5 Key field" as failed
    And I see a level per dimension with evidence ids, and the dimensions she could not measure as "N/E"
    And I can open the query inspector and see the statements behind the evidence

  Scenario: A second assessment is compared with the first
    Given Dana has assessed this use case before
    When I ask her to assess it again
    Then the report says how each dimension and gate changed since the previous assessment

  Scenario: No personal value appears in the report
    Given a dataset with emails and phone numbers in a column
    When Dana assesses it
    Then the report states the types found and their rate
    And no email address or phone number appears in the answer or in the inspector
```

- The Agent Hub lists **Dana** with the Official owner in the Data Foundations section and `GET /agents/data-readiness-assessor` carries `conversation` (R14).
- The Agent Hub lists no Data Readiness Agent (Sarah) and `GET /workflows/data-readiness-assessment` answers 404 ([workflows](../workflows/spec.md) R50).
- Unit tests: the engine's pure functions (gates, levels, verdict, weighted score, baseline) and the no-personal-value test of R8 (`backend/src/modules/readiness-assessor/`).
