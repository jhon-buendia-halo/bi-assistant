/** The shipped order of category headings. */
export const VISUAL_CATEGORIES = [
  'Comparison',
  'Change over time',
  'Part-to-whole',
  'Distribution',
  'Relationship',
  'Ranking',
  'Flow',
  'Spatial',
  'Numbers and tables',
] as const;

/** Thumbnail keys the UI can draw; `none` means no thumbnail. */
export const VISUAL_PREVIEW_KEYS = [
  'bar',
  'column',
  'grouped-bar',
  'bullet',
  'radar',
  'line',
  'area',
  'sparkline',
  'slope',
  'calendar-heatmap',
  'donut',
  'pie',
  'stacked-bar',
  'treemap',
  'waterfall',
  'histogram',
  'box-plot',
  'strip',
  'scatter',
  'bubble',
  'heatmap',
  'ordered-bar',
  'lollipop',
  'bump',
  'sankey',
  'funnel',
  'choropleth',
  'symbol-map',
  'metric-cards',
  'table',
] as const;

export const VISUAL_PREVIEW_NONE = 'none';

/** A chart in the visuals library: a chart type with guidance on when to use it. */
export interface VisualChart {
  id: string;
  name: string;
  category: string;
  previewKey: string;
  /** A renderer form the app draws, or null when the app does not draw it. */
  rendererForm: string | null;
  description: string;
  whenToUse: string;
  whenToAvoid: string;
  dataShape: string;
  enabled: boolean;
  /** True for the seeded defaults; server-owned, never taken from the client. */
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Everything a caller supplies; the server owns `id`, `builtIn` and the timestamps. */
export type VisualChartInput = Omit<
  VisualChart,
  'id' | 'builtIn' | 'createdAt' | 'updatedAt'
>;
