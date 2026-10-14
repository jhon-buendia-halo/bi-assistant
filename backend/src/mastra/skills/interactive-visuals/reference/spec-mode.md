## The spec

```jsonc
{
  "spec": 1,
  "kpis": [                                   // optional, max 4
    { "label": "Total claims",                // short, title case
      "select": ["month", "claims"],          // columns that identify the result set
      "column": "claims",
      "agg": "sum",                           // sum | avg | min | max | count | value
      "format": "compact",                    // number | compact | percent | currency
      "unit": "%" }                           // optional short suffix
  ],
  "chart": {                                  // required
    "form": "line",                           // bar | line | scatter | heatmap | metric-cards | table | donut
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
  "table": {                                  // optional detail table under the chart
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
  result set and a chart from another is fine — each names its own.
- **Never invent a column.** Every `column`, `x`, `y`, `series` and table column
  must appear verbatim in the result set its `select` resolves to. A spec that
  names a column the data does not have is rejected and sent back to you.
- **Measures must be numeric.** `y`, and every KPI `column` whose `agg` is not
  `count`, must hold numbers in the supplied rows (numbers arriving as strings
  are fine). `scatter` also needs a numeric `x`.
- **`heatmap` needs `series`** — `x` and `series` are its two axes, `y` the
  shaded value.
- **Percent columns are already in percent units.** A `denial_rate` of `4.5`
  means 4.5%; use `"format": "percent"` and never multiply by 100.
- **More than 8 categories: set `topN`.** The runtime keeps the top N by value
  and folds the rest into a single "Other" mark.
- **KPI tiles for headline measures.** Two to four, only for figures the rows
  actually contain. Skip them when the answer has no headline number.
- **Detail table when the chart has 6 or more rows behind it**, `collapsed:
  true`, so the reader can check the numbers.
- Follow the `<recommended-form>` block's form unless the instruction or the
  data clearly argues otherwise, and say why in the description when you
  deviate.
- No colours, sizes, fonts, HTML, CSS or JavaScript in the spec. There is no
  field for them, and the frame's palette is already accessible on the dark
  panel.

Also return:

- **`title`** — short, specific, no "chart of".
- **`description`** — plain language: what the visual shows and its main
  takeaway. This is the text under the visual, so write it for the reader, not
  for a developer.

When tailoring, a `<current-visual>` block holds the spec in place today.
Change what the instruction asks for and keep the rest byte-identical.
