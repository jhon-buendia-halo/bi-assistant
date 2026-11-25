# The dashboard's blueprint

## Columns
- Each column of the query has a snake_case alias (`goals_scored`, `tournament_year`) and an entry in `dashboard.columns` with its type and what it holds.
- Types: `number` for anything a measure sums or ranges over, `date` for dates, `string` for labels, `boolean` for yes or no.
- Never invent a column or a value: every column comes from a table you described.

## Widgets
- 1 to 12 widgets, in reading order: KPIs first (span 3 or 4), then charts (span 6 to 12), a table last when it helps. Spans run from 2 to 12 on a 12-column grid; widgets wrap in order.
- Kinds: `kpi`, `bar`, `line`, `area`, `pie`, `donut`, `table`, `scatter`, `heatmap`, `map`, `gauge`, `funnel`. A KPI, a pie or a donut shows one measure.
- Each widget's dimension is a column of the query; its description says the measure, the breakdown, the units and the time grain.

## Measures
- A measure folds a column with `sum`, `avg`, `min` or `max` (a number column), or `count` (no column: leave it empty).
- Prefer `sum` and `count`: the page folds your rows again, so an `avg` of rows that are already averages is wrong. For a ratio, return its numerator and denominator.
- Formats: `number`, `currency`, `percent`, `compact`, with a unit or currency symbol (empty for none).

## Filters
- Kinds: `select`, `multi-select`, `date-range`, `search`, `toggle`, `tabs`. Each reads one column of the query; a `search` box narrows every widget.
- A widget's `filteredBy` lists the ids of the filters that change it.
- Ids of widgets and filters are short, kebab-case and unique.

## Look
- Theme: light, unless the user asks for dark; an accent and 4 to 6 distinct palette colours as `#rrggbb`.
- The layout says the grid in words: its rows, and which widget sits where.
