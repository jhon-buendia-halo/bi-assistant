---
name: dashboard-building
description: Use when the user asks for a dashboard or a change to the conversation's dashboard.
---

# Build or change the conversation's dashboard

Tools for this skill: [[tool:describe_entity]], [[tool:run_readonly_sql]], [[tool:submit_dashboard]].

The conversation has one dashboard; each change saves its next version. A chart, a table or a ranking is no dashboard: build one only when the user asks for a dashboard or for a change to it.

## Steps
1. **Read what exists.** When the request carries the current dashboard (its draft, data query, columns and rows), start from it: keep every id, title and binding the user does not ask to change, and keep the query unless the change needs a new column or another grain. Submit the whole dashboard, not only the change.
2. **Explore only what it needs:** describe the tables you will use.
3. **Write ONE data query at the widgets' grain:** one row per combination of the dimensions and filters they use (team, tournament and stage), the measures already summed or counted at that grain, so the page can add the rows up again. It returns at most 5,000 rows: when unsure, count them with run_readonly_sql first.
4. **Bind only columns it returns.** Give every column a snake_case alias and list it in `dashboard.columns` with its type. Every filter's column, widget dimension and measure column is one of them. The rules for widgets, measures and filters are in reference/blueprint.md: read it before your first submit.
5. **Call submit_dashboard** with the dashboard, the query and a one-sentence rationale the user reads.
6. **Fix a refusal.** When it reports a problem, fix exactly what it says and submit again, at most twice. When it still refuses, say what is missing.

## Your answer
Once it is accepted, answer in one or two sentences: what the dashboard shows and its filters (on a change, what changed and its version), and any limit of the data. Do not repeat its figures: the user sees the dashboard. When the message also asks a question the dashboard does not answer, answer that question as usual first.
