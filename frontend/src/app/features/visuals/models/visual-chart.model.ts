/**
 * A chart type in the Visuals library (roadmap 1.21.12). Stored by the
 * backend's /visuals; the 30 defaults are seeded once per data dir.
 */
export interface VisualChart {
  id: string;
  name: string;
  category: string;
  /** One of VISUAL_PREVIEW_KEYS or 'none'. */
  previewKey: string;
  /** One of VISUAL_RENDERER_FORMS, or null when the app does not draw it. */
  rendererForm: string | null;
  description: string;
  whenToUse: string;
  whenToAvoid: string;
  dataShape: string;
  enabled: boolean;
  /** True for the seeded defaults; server-owned. */
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export type VisualChartInput = Omit<
  VisualChart,
  'id' | 'builtIn' | 'createdAt' | 'updatedAt'
>;

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

/** The forms the app's own renderer can draw (backend SPEC_CHART_FORMS). */
export const VISUAL_RENDERER_FORMS = [
  'bar',
  'line',
  'scatter',
  'heatmap',
  'metric-cards',
  'table',
  'donut',
] as const;

export const NO_PREVIEW = 'none';

/** Client-side limits; they mirror the backend's validation. */
export const VISUAL_LIMITS = {
  name: 80,
  category: 60,
  description: 1000,
  whenToUse: 1000,
  whenToAvoid: 1000,
  dataShape: 200,
} as const;

/** "grouped-bar" → "Grouped bar"; "metric-cards" → "Metric cards". */
export function keyLabel(key: string): string {
  const words = key.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Category order: the shipped categories first in their order, any other
 * category after them alphabetically (case-insensitive).
 */
export function compareCategories(a: string, b: string): number {
  const order = VISUAL_CATEGORIES as readonly string[];
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}
