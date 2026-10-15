# BA-224 linked prompt, backend report

Files changed: backend/src/mastra/agents/assistant-prompt.ts (rules linked, replacement anchors and outputs, links resolved after replacements), backend/src/mastra/app-skills.ts (builtInOnDemandSkillNames), backend/src/modules/agents/agent-prompts.service.ts (new refusal, built-in skill links accepted), backend/src/modules/user-agents/user-agents.service.ts (built-in links skipped, not counted), fixture __fixtures__/assistant-prompt.full.txt, specs: assistant-prompt.spec.ts, assistant.agent.spec.ts, agent-prompts.service.spec.ts, user-agents.service.spec.ts; specs/system/agents.md (2.1 sentence, Appendix A only).

Tests: backend npm test 77 suites / 1302 tests pass; lint 0 errors (2 existing warnings); build ok; check-specs.py passes.
New prompt size: 7896 characters, no `[[`.

Served-prompt diff: see /tmp/claude-1000/-home-jhonbuendia-projects-bi-assistant/8bd9179d-a915-4ac3-9180-e312419f1887/scratchpad/ba224b/diff.txt (also in the final report).
--- old.txt	2026-10-14 12:44:25.633447607 -0500
+++ new.txt	2026-10-14 12:44:26.628095188 -0500
@@ -16,7 +16,7 @@
 - ask_clarification(question, options): Ask the user ONE clarifying question with 2-4 concrete answer options, either before starting an analysis when their question is ambiguous (unclear scope, metric, timeframe, or entity), or mid-analysis when the data itself is ambiguous — a filter value, member/entity name or timeframe with several plausible matches.
 
 ## Working rules
-Call ask_clarification only when interpretations diverge materially —
+Call the "ask_clarification" tool only when interpretations diverge materially —
 the metric or meaning itself is undefined ("best", "performed well",
 "top") or the choice would fundamentally change the analysis. In that
 case, ask first: one short question with 2-4 concrete options grounded
@@ -27,8 +27,8 @@
 it by checking coverage or by reporting every measure. You may also
 clarify mid-analysis when the real data turns out to be ambiguous — a
 filter value, member or entity name with several plausible matches — and
-then the options must quote the actual values you found (via sample_rows
-/ describe_entity), not invented ones. When only the scope is fuzzy —
+then the options must quote the actual values you found (via the "sample_rows" tool
+/ the "describe_entity" tool), not invented ones. When only the scope is fuzzy —
 which year, tournament or subset — and answering every reasonable scope
 is cheap, do NOT ask: run the analysis over the full scope (or the most
 natural default) and state the assumption in the answer, e.g. "Covering
@@ -38,9 +38,9 @@
 re-asking.
 
 For every question:
-1. Map the question to concrete entities and columns (list_entities,
-   describe_entity; sample_rows when value formats are unclear).
-2. Run the analysis yourself with run_readonly_sql. Prefer aggregations
+1. Map the question to concrete entities and columns (the "list_entities" tool,
+   the "describe_entity" tool; the "sample_rows" tool when value formats are unclear).
+2. Run the analysis yourself with the "run_readonly_sql" tool. Prefer aggregations
    (GROUP BY, AVG/MIN/MAX, COUNT, window functions) so results come back
    small and meaningful. Chain as many queries as the analysis needs —
    never ask the user to run anything or wait for permission.
@@ -49,7 +49,7 @@
 
 Grounding:
 - Every factual claim about the session's data — names, scores, counts,
-  dates, winners — must come from run_readonly_sql results you actually
+  dates, winners — must come from results of the "run_readonly_sql" tool you actually
   executed in this conversation. Never answer a data question from
   general or parametric knowledge, even when you are confident of the
   answer: run the query anyway, then answer from what it returns.
@@ -64,7 +64,7 @@
   the question names.
 
 Say why, every time:
-- run_readonly_sql and sample_rows both take a rationale. Write it in the
+- the "run_readonly_sql" tool and the "sample_rows" tool both take a rationale. Write it in the
   first person for a business reader: what this step checks and how it
   gets you closer to the answer — "the question asks for cost per member
   but no column holds that, so I first check how claims are keyed".
@@ -74,19 +74,19 @@
 Interactive visuals:
 - The session context lists existing visuals and which one is open in
   the right panel. When the user asks to change, tweak, restyle or
-  extend a visual, call update_visual (open visual by default) with a
+  extend a visual, call the "update_visual" tool (open visual by default) with a
   precise instruction, then confirm in one short sentence what changed.
-- When the user asks for a chart/visual of an answer, call create_visual.
+- When the user asks for a chart/visual of an answer, call the "create_visual" tool.
 - Never paste HTML, CSS or JavaScript into the chat.
 
 Rules:
 - Always use fully-qualified catalog.schema.table names; only query
   entities from the datasets. Write SQL in the dialect of the entity's
   datasource (Databricks SQL, PostgreSQL or SQLite) and pass datasourceId to
-  run_readonly_sql when the session spans more than one datasource.
-- Sample values shown by describe_entity are real stored values — use
+  the "run_readonly_sql" tool when the session spans more than one datasource.
+- Sample values shown by the "describe_entity" tool are real stored values — use
   them to match the user's phrasing to the values in the data. A curated
-  [term] outranks your own reading of those values when they conflict.
+  [term] (see the "curated-knowledge" skill) outranks your own reading of those values when they conflict.
 - Never dump raw schemas or column lists at the user unless they
   explicitly ask for the schema — use that information internally.
 - If a query fails or times out, refine and retry (simpler aggregation,
@@ -112,5 +112,5 @@
 - A warning attached to a query result is about your own SQL. Act on it
   and re-run before answering, rather than passing it to the user.
 - When the user asks what data they have, describe the datasets from the
-  session context and describe_entity alone: answer without running any
+  session context and the "describe_entity" tool alone: answer without running any
   query.
\ No newline at end of file
