# Competitive Research: Question Answering & Visual Generation — Improvement Plan

*Research date: 2026-09-16. Sources: product docs, engineering blogs, and papers cited inline.*

## 1. How Questions-to-Insights works today (baseline)

- **Q&A**: single Mastra `assistant` agent (`backend/src/mastra/agents/assistant.agent.ts`) with tools `list_entities` / `describe_entity` / `sample_rows` / `run_readonly_sql` / `create_visual` / `update_visual` / `ask_clarification`. SQL is free-form LLM-authored against a raw schema snapshot (name/type/nullable). Guard is a regex read-only allowlist (`connector.ts:55-79`). Retry-on-error is only a prompt instruction; no execution-guided loop, no dry-run, no result caching. Max one clarification per turn (aborts the turn). 15-step ceiling with a tool-disabled synthesis fallback.
- **Visuals**: `visualization` designer agent emits raw `{title, description, html, css, javascript}` (no chart library, per the interactive-visuals skill). Validation = `new Function()` parse check with one retry. Rendered in a CSP-locked sandbox iframe; runtime errors reported via `postMessage` but not auto-repaired. No drill-down or re-query from a visual (`connect-src 'none'`); charts at most 100 frozen rows; row caps (500→200→100) truncate silently.
- **Context**: no semantic layer, no metric definitions, no join hints, no sample-value indexing, no verified-query store, no eval set.

## 2. How the market does it

### Enterprise conversational BI (Genie, Spotter, Power BI Copilot, Q in QuickSight, Tableau Pulse/Agent, Looker CA)

Cross-product table stakes (present in ≥3 of 6 products):

1. **Semantic/metric layer as grounding, not raw schema** — all six. Genie: per-space knowledge store (synonyms, join hints, certified metrics, value dictionaries). ThoughtSpot: LLM emits search tokens, deterministic engine compiles the query. Looker: Gemini never writes SQL — composes a Looker query over LookML. Power BI: semantic model + linguistic schema + DAX.
2. **Verified/certified answers matched before generation** — Genie trusted assets (parameterized SQL, executed verbatim, labeled), PBI verified answers (checkmark badge, matched trigger phrase, adjustable NL filters), QuickSight verified answers, ThoughtSpot reference questions, Looker verified queries.
3. **Visible interpretation / provenance** — all six show SQL/DAX/tokens/"Interpreted as"/reasoning steps. ThoughtSpot's tokens are *editable* by the user; QuickSight shows "Did you mean" alternates.
4. **Sample-value indexing** so user phrasing maps to actual data values (Genie value dictionaries; Looker sampling + fuzzy search).
5. **Thumbs feedback routed to a curator workflow** (Genie ask-for-review + monitoring view; ThoughtSpot Coach Spotter).
6. **Suggested questions + follow-ups from a chart** in stateful conversation — all six.
7. Rare differentiators: **Genie benchmark eval sets** (first-class feature), **QuickSight multi-visual answers** (center visual + context visual + KPIs + detail table, narrative sentences highlight their source visual), **Looker Python code-interpreter escape hatch**.

### AI-native tools (Hex, Julius, Zenlytic, DataChat, Vanna, WrenAI, Cube, Dot, Fabi, TextQL, camelAI)

Ideas that stand out vs incumbents:

- **Vanna learning loop**: RAG store of DDL + docs + *approved question→SQL pairs*; one-click save of a good answer back into the store — accuracy compounds.
- **WrenAI / Fabi dry-run validation**: parse/plan-check SQL against the model before hitting the DB; structured errors feed retries.
- **Zenlytic per-number citations**: every figure in prose links to the query that produced it; chart tailoring via form controls *and* chat on the same object; verified-field green checkmark with promotion path from ad-hoc SQL to governed metric.
- **Dot / Hex "Deep Analysis"**: deliberate slow path — plan, parallel investigation branches, anomaly drill-down, 2–10 min recommendation report, distinct from quick chat.
- **DataChat GEL**: deterministic intermediate language; LLM only maps intent, execution is reproducible by construction.
- **Fabi**: context lives in retrieval *tools*, not stuffed prompts; `dry_run` tool; per-user kernels seeded from a shared report.
- **Hex Modeling Agent / Cube DE Agent**: AI authors the semantic layer that later grounds AI answers.

### Techniques (papers + engineering blogs)

- Spider 2.0 reality check: frontier systems ~25–36% on realistic enterprise SQL; ~28% of errors are **schema linking**, not syntax. Winning recipes (ReFoRCE, XiYan-SQL, CHASE-SQL): schema pruning with sample cell values → multi-candidate generation → execution-guided filtering → self-correction (1–3 retries) → result-set voting/selection. All inference-time; +5–10 pts over single-shot.
- Semantic layers: dbt reports ~83% NL accuracy vs ~40% raw text-to-SQL. **Databricks Metric Views (Unity Catalog, GA Apr 2026)** are the stack-native option; Genie's grounding hierarchy: documented datasets > SQL expressions > example queries > plain-text instructions.
- Ambiguity: AmbiSQL — multiple-choice clarifications lift ambiguous-query accuracy 42.5% → 92.5%; multiple-choice beats free-text.
- Eval: golden question→SQL set, compare **result sets** in CI; every thumbs-up feeds both eval set and RAG store (one flywheel, two uses).
- Charts: LIDA finding — constraining degrees of freedom (scaffolds/specs) lowers error rates; Vega-Lite/ECharts specs are schema-validatable and diffable, freeform HTML maximizes expressiveness (our current choice). Middle ground: constrained spec for chart core, code-gen for interactive shell. Deterministic data-shape → mark-type heuristic (temporal+measure→line; categorical+measure→sorted bar; 2 measures→scatter; cat×cat+measure→heatmap; >8 categories→top-N+other) passed to the LLM as an overridable default. Repair loops: parse → sandbox render → feed error back (fixes ~15% of failures); 1–2 iterations capture most gain.
- Interactivity: chart click → selection event → pre-filled follow-up question is the emerging chat-app pattern (Databricks AI/BI dashboards are the production reference).

## 3. Improvement plan

Ordered by impact-for-effort for this app (Electron + NestJS + Mastra over Databricks, health-analytics demo for a Product Owner persona).

### Phase 1 — Answer reliability (highest leverage, small builds)

1. **Execution-guided self-correction loop** in `run_readonly_sql`: on SQL error or empty result, auto-retry up to 2× with the structured error message in context (move retry from prompt suggestion to enforced tool loop). *Pattern: BIRD top systems, WrenAI, Fabi.*
2. **Verified query library (Vanna pattern)**: new DocStore collection of `{question, sql, entities, thumbs}`; thumbs-up on an answer saves the pair; retrieval tool injects top-k similar pairs into the assistant prompt. Compounds accuracy with zero curation overhead.
3. **Richer schema context**: enrich the dataset schema snapshot with sample cell values per column (cheap query at dataset save time) + optional column descriptions from Unity Catalog comments. Attacks the #1 error class (schema linking). *Pattern: Genie value dictionaries, ReFoRCE, Pinterest.*
4. **Golden-set eval harness**: 30–50 question→expected-result pairs over the demo dataset; CI script runs them through the pipeline and compares result sets. Only Genie ships this as a feature — cheap regression safety before demo day.

### Phase 2 — Trust UX (demo-visible, persona-critical)

5. **"How was this computed" panel**: SQL already captured — surface it as a first-class expandable per answer with a one-line English explanation of tables/filters chosen (Genie/PBI/QuickSight all do this). Add QuickSight-style "Interpreted as" line: which entities/columns the question mapped to.
6. **Verified-answer badge**: answers built from a saved verified query pair get a checkmark; ad-hoc SQL is unlabeled; a "save as verified" action promotes it. *Pattern: PBI verified answers, Zenlytic tiering, Genie trusted assets.*
7. **Multiple-choice clarifications, non-aborting**: already has `ask_clarification` with options — extend so the turn resumes after the choice instead of aborting, and allow it for value/time-range ambiguity per AmbiSQL taxonomy.
8. **Truncation markers**: whenever row caps clip (500/200/100), state it in the answer and the visual footer.

### Phase 3 — Visual quality + interactivity

9. **Deterministic chart-type heuristic**: compute data-shape signature (column types, cardinality, row count) in `visualization.service.ts`; pass recommended mark type to the designer prompt as overridable default. Near-zero effort, kills the most common wrong-chart failures.
10. **Runtime repair loop**: iframe already postMessages `visual-error` — feed that error back for one auto-repair pass (currently just a banner). Add blank-render check (no painted SVG/canvas nodes → repair).
11. **Click-to-follow-up**: extend the iframe host bridge so visuals emit selection events (clicked bar/segment → `postMessage {type:'visual-select', value}`); host renders pre-filled follow-up chips ("Drill into <value>"). Converts static artifact into conversation entry point — outsized demo impact. *Pattern: Databricks AI/BI, ThoughtSpot.*
12. **Structured tailoring controls (Zenlytic pattern)**: small form in the visual panel (chart type, sort, top-N) whose changes route through `update_visual` — same object editable by click and by chat.

### Phase 4 — Strategic bets (post-demo)

13. **Databricks Metric Views / lightweight semantic layer**: define core demo metrics in Unity Catalog; assistant prefers metric queries, raw SQL only for the long tail. Biggest structural accuracy jump (~40%→~80% class), larger build.
14. **Multi-candidate SQL generation + result-set voting** for hard questions (3 candidates, execution-filtered). 3–5× token cost — gate behind a "careful mode".
15. **Deep Analysis mode (Dot/Hex pattern)**: async multi-step investigation producing a report artifact (plan → parallel queries → anomaly drill-down → recommendations). Natural fit for the Mastra workspace-per-session design; strong Product Owner story.
16. **Multi-visual answers (QuickSight pattern)**: KPI tiles + main chart + detail table composed in the existing visual frame.

### Explicitly not recommended now

- Full ThoughtSpot/DataChat-style intermediate query language — high build cost, semantic layer (13) gets most of the benefit on this stack.
- Fine-tuning any model — inference-time techniques above capture the gains.
- Switching visuals to pure Vega-Lite specs — would sacrifice the interactive freeform frame that differentiates the demo; adopt the middle ground (heuristic + repair loop) instead.

## 4. Key sources

Genie trusted assets/best practices (docs.databricks.com/genie), ThoughtSpot Spotter/Coach docs, Power BI verified answers (learn.microsoft.com), QuickSight Generative Q&A docs, Tableau Pulse insights platform, Looker Conversational Analytics docs; Hex Notebook Agent, Zenlytic Zoe docs, Vanna docs, WrenAI GitHub, Cube D3, Dot Deep Analysis, Fabi Analyst Agent engineering post, TextQL ontology; Spider 2.0 (spider2-sql.github.io), ReFoRCE (arXiv:2502.00675), XiYan-SQL (arXiv:2411.08599), CHASE-SQL (ICLR 2025), AmbiSQL (arXiv:2508.15276), LIDA (microsoft.github.io/lida), Draco/Voyager (UW IDL), VisCoder (arXiv:2506.03930), Uber QueryGPT, LinkedIn SQL Bot, Pinterest text-to-SQL.
