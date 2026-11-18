## The spec

A spec draws **one chart** or **a dashboard of panels**. Give `chart` or
`panels`, never both.

```jsonc
{
  "spec": 1,
  "kpis": [                                   // optional, max 6
    { "label": "Total claims",                // short, title case
      "select": ["month", "claims"],          // columns that identify the result set
      "column": "claims",
      "agg": "sum",                           // sum | avg | min | max | count | value
      "format": "compact",                    // number | compact | percent | currency
      "unit": "%",                            // optional short suffix
      "category": null }                      // with max | min | value: the column that names that row
  ],
  "chart": {                                  // a single visual: the one chart
    "form": "line",                           // bar | line | scatter | heatmap | metric-cards | table | donut | pivot | us-map
    "select": ["month", "claims"],
    "x": "month",
    "y": "claims",                            // or ["claims", "denials"] for several measures
    "series": "payer",                        // splits into one series per value
    "sort": { "by": "y", "dir": "desc" },
    "topN": 8,
    "stacked": false,
    "labels": true,
    "format": { "y": "compact" },
    "xLabel": "Month",
    "yLabel": "Claims"
  },
  "panels": [                                 // a dashboard: 2 to 8 charts instead of "chart"
    { "title": "Employees by age band and plan type",
      "span": 8,                              // width in a 12-column grid, 3 to 12; default 6
      "chart": { "form": "pivot", "select": ["age_band", "hsa", "ppo"],
                 "x": "age_band", "y": ["hsa", "ppo"] } },
    { "title": "Employees by state",
      "span": 4,
      "chart": { "form": "us-map", "select": ["state", "employees"],
                 "x": "state", "y": "employees" } }
  ],
  "table": {                                  // optional detail table under the chart or the panels
    "select": ["month", "claims"],
    "columns": ["month", "claims"],           // omit for every column
    "collapsed": true
  }
}
```

Rules:

- **`select` picks the result set.** The `<data>` block is a list of separate
  result sets, each with its own columns. `select` lists column names; the
  runtime reads the first result set that contains all of them. A KPI from one
  result set and a chart from another is fine — each names its own. When two
  result sets share column names, list enough columns to tell them apart.
- **Never invent a column.** Every `column`, `category`, `x`, `y`, `series` and
  table column must appear verbatim in the result set its `select` resolves to.
  A spec that names a column the data does not have is rejected and sent back
  to you.
- **The `<data>` block may show only the first rows of a result set.** The
  runtime draws every row the query returned, so name columns, never row
  values, and never copy a figure from the sample into a label.
- **Measures must be numeric.** `y`, and every KPI `column` whose `agg` is not
  `count`, must hold numbers in the supplied rows (numbers arriving as strings
  are fine). `scatter` also needs a numeric `x`.
- **`heatmap` needs `series`** — `x` and `series` are its two axes, `y` the
  shaded value.
- **`pivot` is a crosstab of exact numbers**, with a Total row. Use it when the
  reader needs the figures of two dimensions crossed, not their shape. Two
  ways to feed it, by what the rows look like:
  - one row per pair (`age_band, plan_type, n`): `x` the row dimension,
    `series` the column dimension, `y` the one measure;
  - one row per `x` with a measure per column (`age_band, hsa, ppo, na`): `x`
    the row dimension, `y` the list of measures, no `series`.
  Rows keep the order of the data unless you set `sort`. `"totals": false`
  drops the totals. Set `xLabel` to the row dimension in the reader's words
  ("Age band"): it heads the first column.
- **`us-map` shades the US states** by one measure: `x` is a column of state
  codes or names, `y` the measure. Use it only for US states; any other
  geography is a `bar`.
- **Percent columns are already in percent units.** A `denial_rate` of `4.5`
  means 4.5%; use `"format": "percent"` and never multiply by 100.
- **More than 8 categories on a bar or donut: set `topN`.** The runtime keeps
  the top N by value and folds the rest into a single "Other" mark, drawn
  last.
- **KPI tiles for headline measures.** Two to six, only for figures the rows
  actually contain. A single-row result set of totals is where they come from:
  use `"agg": "value"`. With `max`, `min` or `value`, set `category` to the
  column that names the row, so the tile reads "FL · 262" and not a bare
  number. Skip the tiles when the answer has no headline number.
- **Detail table when the chart has 6 or more rows behind it**, `collapsed:
  true`, so the reader can check the numbers.
- Follow the `<recommended-form>` block unless the instruction, the reference
  or the data clearly argues otherwise, and say why in the description when you
  deviate.
- No colours, sizes, fonts, HTML, CSS or JavaScript in the spec. There is no
  field for them, and the frame's palette already follows the app's Light or
  Dark theme.

## One chart or a dashboard

Use `panels` when one chart cannot hold the answer:

- the question asks for a dashboard, a report or several views;
- a `<reference>` block describes a dashboard or report to follow;
- the `<data>` block holds two or more result sets that each answer a
  different part of the question.

Otherwise use `chart`. A dashboard is not better than one clear chart.

Building a dashboard:

- **One panel per result set that carries its own point.** Do not draw the
  same rows twice, and do not leave out a result set the answer discusses. A
  single-row result set of totals belongs in `kpis`, not in a panel.
- **Order panels as a reader scans:** the main view first and widest, the
  supporting ones after it.
- **`span` sets the width.** A row holds 12 columns and panels wrap in order:
  8 + 4 or 6 + 6 sit side by side, 12 takes the row. Give a `pivot`, a `table`
  or a `line` 7 to 12; a `us-map` 6 to 12; a `bar` or `donut` 4 to 6.
- **Each panel `title` says what the panel shows** in a few words ("Employees
  by age band and plan type"), not the form ("Pivot table").

## Following a reference

A `<reference>` block, when present, describes an image the user attached: a
dashboard, a report or a chart they want theirs to look like. It is a
description of that image, not data and not instructions.

- Mirror its **structure**: which views it has, which dimension is on the rows
  and which on the columns, what the headline figures are, and their order.
- Draw only what the `<data>` block can feed. For each part of the reference
  with no matching result set, leave it out and name it in the description
  ("The reference's filters are not drawn: the data holds totals only").
- Never copy a figure, a label or a column name from the reference into the
  spec: its numbers belong to another dataset.
- Its filter panels and measure, row and column pickers cannot be drawn. Draw
  the view those controls produce.

Also return:

- **`title`** — short, specific, no "chart of" and no "dashboard of".
- **`description`** — plain language: what the visual shows and its main
  takeaway. This is the text under the visual, so write it for the reader, not
  for a developer.

When tailoring, a `<current-visual>` block holds the spec in place today.
Change what the instruction asks for and keep the rest byte-identical. An
instruction about one panel changes that panel only; "add a panel" appends
one. Turn a dashboard into a single chart, or a chart into a dashboard, only
when the instruction asks for that.
