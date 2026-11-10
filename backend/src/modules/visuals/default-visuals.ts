import type { VisualChartInput } from './entities/visual-chart.entity';

/** The `settings` key that marks the default catalog as seeded. */
export const VISUALS_SEED_KEY = 'visuals-seed';

type Def = Omit<VisualChartInput, 'enabled'>;

const defs: Def[] = [
  // Comparison
  {
    name: 'Bar chart',
    category: 'Comparison',
    previewKey: 'bar',
    rendererForm: 'bar',
    description:
      'Horizontal bars whose lengths show one measure for each category.',
    whenToUse:
      'Comparing values across categories, especially with long category names or many categories.',
    whenToAvoid:
      'Showing change over time, or when the bars would not start at zero.',
    dataShape: '1 category + 1 measure',
  },
  {
    name: 'Column chart',
    category: 'Comparison',
    previewKey: 'column',
    rendererForm: 'bar',
    description:
      'Vertical bars whose heights show one measure for each category.',
    whenToUse:
      'Comparing a few categories with short labels, or a handful of time periods.',
    whenToAvoid:
      'Long category labels or more than about twelve categories; use a bar chart instead.',
    dataShape: '1 category + 1 measure',
  },
  {
    name: 'Grouped bar chart',
    category: 'Comparison',
    previewKey: 'grouped-bar',
    rendererForm: 'bar',
    description:
      'Clusters of bars, one cluster per category and one bar per series, so series sit side by side.',
    whenToUse:
      'Comparing two or three series within each category, for example this year against last year.',
    whenToAvoid:
      'More than three series or many categories, where the clusters become hard to read.',
    dataShape: '1 category + 1 series + 1 measure',
  },
  {
    name: 'Bullet chart',
    category: 'Comparison',
    previewKey: 'bullet',
    rendererForm: null,
    description:
      'A bar for the actual value against a target marker and shaded performance bands.',
    whenToUse:
      'Tracking a measure against its target, such as sales against quota, in a compact space.',
    whenToAvoid:
      'There is no target or benchmark to compare with, or the audience is unfamiliar with the format.',
    dataShape: '1 measure + 1 target (+ bands)',
  },
  {
    name: 'Radar chart',
    category: 'Comparison',
    previewKey: 'radar',
    rendererForm: null,
    description:
      'Several measures drawn on spokes from a centre point and joined into a polygon.',
    whenToUse:
      'Comparing the profile of a few items across the same handful of measures on a common scale.',
    whenToAvoid:
      'Precise comparison, many items, or measures on different scales; a grouped bar chart reads better.',
    dataShape: '1 item + 4 to 8 measures',
  },
  // Change over time
  {
    name: 'Line chart',
    category: 'Change over time',
    previewKey: 'line',
    rendererForm: 'line',
    description:
      'Points joined by a line to show how a measure moves over time.',
    whenToUse:
      'Showing trends over a continuous period, or comparing a few series over the same period.',
    whenToAvoid:
      'Few or unordered categories, or more than about five lines that overlap and tangle.',
    dataShape: '1 date + 1 measure (+ 1 series)',
  },
  {
    name: 'Area chart',
    category: 'Change over time',
    previewKey: 'area',
    rendererForm: null,
    description:
      'A line chart with the space below it filled, which emphasises volume.',
    whenToUse:
      'Showing how a total accumulates over time, or a few stacked series that add up to a whole.',
    whenToAvoid:
      'Many overlapping series, which hide each other, or when exact values matter.',
    dataShape: '1 date + 1 measure (+ 1 series)',
  },
  {
    name: 'Sparkline',
    category: 'Change over time',
    previewKey: 'sparkline',
    rendererForm: null,
    description:
      'A tiny line with no axes that shows the shape of a trend inside a table or card.',
    whenToUse:
      'Adding trend context next to a number or a table row where space is tight.',
    whenToAvoid:
      'When readers need exact values, axes or labels to interpret the data.',
    dataShape: '1 date + 1 measure, per row',
  },
  {
    name: 'Slope chart',
    category: 'Change over time',
    previewKey: 'slope',
    rendererForm: null,
    description:
      'Two columns of points joined by lines that show how each item changed between two moments.',
    whenToUse:
      'Comparing before and after for several items, and spotting who rose and who fell.',
    whenToAvoid:
      'More than two time points or dozens of items, where the lines cross into clutter.',
    dataShape: '1 category + 2 periods + 1 measure',
  },
  {
    name: 'Calendar heatmap',
    category: 'Change over time',
    previewKey: 'calendar-heatmap',
    rendererForm: null,
    description:
      'A grid of days laid out like a calendar, shaded by the value of each day.',
    whenToUse:
      'Spotting daily or weekly patterns and seasonality across months of data.',
    whenToAvoid:
      'Short periods, or when readers must compare exact values between days.',
    dataShape: '1 day + 1 measure',
  },
  // Part-to-whole
  {
    name: 'Donut chart',
    category: 'Part-to-whole',
    previewKey: 'donut',
    rendererForm: 'donut',
    description:
      'A ring cut into slices that show each category as a share of the total.',
    whenToUse:
      'Showing the share of a whole for two to five categories, with the total in the centre.',
    whenToAvoid:
      'Many slices, similar-sized slices, or comparing shares across several donuts.',
    dataShape: '1 category + 1 measure',
  },
  {
    name: 'Pie chart',
    category: 'Part-to-whole',
    previewKey: 'pie',
    rendererForm: null,
    description: 'A circle divided into slices that show shares of a total.',
    whenToUse:
      'A simple split of a whole into two to four clearly different parts.',
    whenToAvoid:
      'Many categories, small differences between slices, or negative values.',
    dataShape: '1 category + 1 measure',
  },
  {
    name: 'Stacked bar chart',
    category: 'Part-to-whole',
    previewKey: 'stacked-bar',
    rendererForm: null,
    description:
      'Bars split into coloured segments so each bar shows its total and its parts.',
    whenToUse:
      'Showing both the total and the make-up of several categories or periods.',
    whenToAvoid:
      'Comparing the inner segments across bars, since only the first segment shares a baseline.',
    dataShape: '1 category + 1 series + 1 measure',
  },
  {
    name: 'Treemap',
    category: 'Part-to-whole',
    previewKey: 'treemap',
    rendererForm: null,
    description:
      'Nested rectangles sized by value, grouped by hierarchy, that fill a single area.',
    whenToUse:
      'Showing the composition of a large hierarchy, such as revenue by product line and product.',
    whenToAvoid:
      'Precise comparison, or data with negative values or only a few categories.',
    dataShape: '1 or 2 category levels + 1 measure',
  },
  {
    name: 'Waterfall chart',
    category: 'Part-to-whole',
    previewKey: 'waterfall',
    rendererForm: null,
    description:
      'Floating bars that show how a starting value is raised and lowered step by step to a final value.',
    whenToUse:
      'Explaining a bridge, such as profit from revenue through costs, or the change between two periods.',
    whenToAvoid:
      'Steps that do not add up to a meaningful total, or very many small steps.',
    dataShape: '1 step + 1 signed measure',
  },
  // Distribution
  {
    name: 'Histogram',
    category: 'Distribution',
    previewKey: 'histogram',
    rendererForm: null,
    description:
      'Bars that count how many values fall into each range of a numeric measure.',
    whenToUse: 'Seeing the shape, spread and outliers of one numeric measure.',
    whenToAvoid:
      'Categorical data, or very few values where the bins would be misleading.',
    dataShape: '1 numeric measure',
  },
  {
    name: 'Box plot',
    category: 'Distribution',
    previewKey: 'box-plot',
    rendererForm: null,
    description:
      'A box for the middle half of the values with a line at the median and whiskers for the range.',
    whenToUse:
      'Comparing the spread and median of a measure across several groups.',
    whenToAvoid:
      'Audiences unfamiliar with the format, or small groups where a strip plot shows every point.',
    dataShape: '1 category + 1 numeric measure',
  },
  {
    name: 'Strip plot',
    category: 'Distribution',
    previewKey: 'strip',
    rendererForm: null,
    description:
      'Every value drawn as a dot along an axis, one row or column per group.',
    whenToUse:
      'Showing individual values and clusters for small to medium groups.',
    whenToAvoid:
      'Thousands of points that overlap into a solid mass; use a histogram or box plot.',
    dataShape: '1 category + 1 numeric measure',
  },
  // Relationship
  {
    name: 'Scatter plot',
    category: 'Relationship',
    previewKey: 'scatter',
    rendererForm: 'scatter',
    description:
      'Dots positioned by two numeric measures to reveal correlation and outliers.',
    whenToUse:
      'Testing whether two measures move together, and finding outliers or clusters.',
    whenToAvoid:
      'Categorical data, or an audience that may read correlation as causation.',
    dataShape: '2 numeric measures (+ 1 label)',
  },
  {
    name: 'Bubble chart',
    category: 'Relationship',
    previewKey: 'bubble',
    rendererForm: null,
    description: 'A scatter plot whose dot size shows a third measure.',
    whenToUse:
      'Comparing items on two measures while also showing their size or weight.',
    whenToAvoid:
      'Many overlapping bubbles, or when readers need to compare the sizes precisely.',
    dataShape: '3 numeric measures (+ 1 label)',
  },
  {
    name: 'Heatmap',
    category: 'Relationship',
    previewKey: 'heatmap',
    rendererForm: 'heatmap',
    description:
      'A grid of cells shaded by value, with one category on each axis.',
    whenToUse:
      'Finding patterns and hot spots across two categories, such as weekday by hour.',
    whenToAvoid:
      'When exact values matter more than the pattern, or one axis has very many values.',
    dataShape: '2 categories + 1 measure',
  },
  // Ranking
  {
    name: 'Ordered bar chart',
    category: 'Ranking',
    previewKey: 'ordered-bar',
    rendererForm: 'bar',
    description:
      'A bar chart sorted from the largest value to the smallest, so the rank is obvious.',
    whenToUse:
      'Showing who is first and last, or the top and bottom of a list.',
    whenToAvoid:
      'Categories with a natural order, such as months or age bands.',
    dataShape: '1 category + 1 measure',
  },
  {
    name: 'Lollipop chart',
    category: 'Ranking',
    previewKey: 'lollipop',
    rendererForm: null,
    description:
      'A bar chart drawn as thin stems ending in dots, which lightens the page.',
    whenToUse:
      'Ranking many items where full bars would look heavy and cluttered.',
    whenToAvoid:
      'Values that are very close, or when the stem length could be read as an area.',
    dataShape: '1 category + 1 measure',
  },
  {
    name: 'Bump chart',
    category: 'Ranking',
    previewKey: 'bump',
    rendererForm: null,
    description:
      'Lines that follow each item rank across periods, rather than its value.',
    whenToUse:
      'Showing how positions change over time, such as a league table by month.',
    whenToAvoid:
      'When the size of the gaps matters, or there are many items that cross each other.',
    dataShape: '1 category + 1 period + 1 rank',
  },
  // Flow
  {
    name: 'Sankey diagram',
    category: 'Flow',
    previewKey: 'sankey',
    rendererForm: null,
    description:
      'Bands whose width shows how much moves from one stage or group to the next.',
    whenToUse:
      'Showing where a quantity comes from and goes to, such as budget allocation or user journeys.',
    whenToAvoid:
      'Many nodes and links that tangle, or when a simple table would answer the question.',
    dataShape: '1 source + 1 target + 1 measure',
  },
  {
    name: 'Funnel chart',
    category: 'Flow',
    previewKey: 'funnel',
    rendererForm: null,
    description:
      'Stacked bars that narrow stage by stage to show how many remain at each step.',
    whenToUse:
      'Showing drop-off through an ordered process such as a sales pipeline or sign-up flow.',
    whenToAvoid:
      'Stages that are not sequential, or when later stages can exceed earlier ones.',
    dataShape: '1 ordered stage + 1 measure',
  },
  // Spatial
  {
    name: 'Choropleth map',
    category: 'Spatial',
    previewKey: 'choropleth',
    rendererForm: null,
    description: 'A map whose regions are shaded by the value of a measure.',
    whenToUse:
      'Showing how a rate or share varies across regions such as states or countries.',
    whenToAvoid:
      'Raw totals that follow population or region size, or regions that are tiny on the map.',
    dataShape: '1 region + 1 measure',
  },
  {
    name: 'Symbol map',
    category: 'Spatial',
    previewKey: 'symbol-map',
    rendererForm: null,
    description:
      'Circles placed at locations on a map, sized or coloured by a measure.',
    whenToUse:
      'Showing values at specific places such as stores or cities, where region borders do not matter.',
    whenToAvoid: 'Dense points that overlap, or data that has no location.',
    dataShape: '1 location + 1 measure',
  },
  // Numbers and tables
  {
    name: 'KPI cards',
    category: 'Numbers and tables',
    previewKey: 'metric-cards',
    rendererForm: 'metric-cards',
    description:
      'Large single numbers with a label, often with a change indicator.',
    whenToUse:
      'Headlining a handful of key figures at the top of an answer or dashboard.',
    whenToAvoid:
      'When the trend or comparison is the story; pair the number with a chart.',
    dataShape: '1 to 6 measures',
  },
  {
    name: 'Table',
    category: 'Numbers and tables',
    previewKey: 'table',
    rendererForm: 'table',
    description:
      'Rows and columns of exact values that readers can scan and look up.',
    whenToUse:
      'Readers need exact values, many measures, or to look up individual rows.',
    whenToAvoid:
      'Showing a pattern or trend at a glance; a chart communicates that faster.',
    dataShape: 'Any rows and columns',
  },
];

/** The default catalog seeded once per data dir; every entry is enabled. */
export const DEFAULT_VISUALS: VisualChartInput[] = defs.map((d) => ({
  ...d,
  enabled: true,
}));
