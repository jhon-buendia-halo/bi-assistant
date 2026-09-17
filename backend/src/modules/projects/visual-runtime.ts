/**
 * Spec-based visual runtime.
 *
 * The designer model used to hand-write ~200 lines of SVG and JavaScript per
 * visual, and regularly fumbled one of them: a `NaN` total, a bar with zero
 * height, an axis that never rendered. Here the model only emits a small JSON
 * spec (see `VisualSpec`) and this fixed, hand-written runtime draws it.
 *
 * The file has two halves that are deliberately one implementation:
 *
 *  1. Pure helpers (`selectRecord`, `aggregate`, `formatValue`, `coerceRows`,
 *     `topNCut`, `ticks`, …) exported as ordinary TypeScript so they can be
 *     unit-tested in Node.
 *  2. The browser renderer — plain functions written against the DOM.
 *
 * `VISUAL_RUNTIME_SCRIPT` is assembled by string-embedding the *same* function
 * objects (`Function.prototype.toString`), so the browser runs byte-for-byte
 * the logic the tests cover. There is no second copy to drift.
 *
 * The browser half runs after `FRAME_SELECT_SCRIPT` (see
 * `visualization-document.ts`), so it can rely on `window.qti.data` and
 * `window.qti.onRefresh`. It never registers click handlers for selection —
 * the frame bridge owns that; marks only carry `data-qti-*` attributes.
 */

/* ------------------------------------------------------------------ *
 * Spec schema v1
 * ------------------------------------------------------------------ */

/** How a KPI collapses its rows into one number. */
export type VisualAggregation =
  'sum' | 'avg' | 'min' | 'max' | 'count' | 'value';

/** Display formatting for a measure. `percent` treats the value as already in percent units. */
export type VisualFormat = 'number' | 'compact' | 'percent' | 'currency';

/** The chart forms the product supports (mirrors `chart-heuristic.ts`). */
export type VisualChartForm =
  'bar' | 'line' | 'scatter' | 'heatmap' | 'metric-cards' | 'table' | 'donut';

/** One result set as handed to the runtime (same shape as `ChartDataRecord`). */
export interface VisualDataRecord {
  tool?: string;
  input?: string;
  columns?: string[];
  rowCount?: number;
  rows: Record<string, unknown>[];
}

/** A headline tile above the chart. */
export interface VisualKpiSpec {
  label: string;
  /** Record selector: the columns the source result set must contain. */
  select?: string[];
  column: string;
  agg?: VisualAggregation;
  format?: VisualFormat;
  unit?: string;
}

/** Sort applied to the chart's categories. */
export interface VisualSortSpec {
  by?: 'x' | 'y';
  dir?: 'asc' | 'desc';
}

/** The main chart. */
export interface VisualChartSpec {
  form: VisualChartForm;
  select?: string[];
  x?: string;
  /** Measure, or several measures for a multi-series line. */
  y?: string | string[];
  series?: string;
  sort?: VisualSortSpec;
  /** Keep the top N categories by y and fold the rest into "Other" (bar/donut). */
  topN?: number;
  stacked?: boolean;
  labels?: boolean;
  format?: { y?: VisualFormat };
  xLabel?: string;
  yLabel?: string;
}

/** The collapsible detail table under the chart. */
export interface VisualTableSpec {
  select?: string[];
  columns?: string[];
  collapsed?: boolean;
}

/** The document the designer agent emits. Unknown extra fields are ignored. */
export interface VisualSpec {
  spec?: number;
  kpis?: VisualKpiSpec[];
  chart: VisualChartSpec;
  table?: VisualTableSpec;
}

/* ------------------------------------------------------------------ *
 * Pure helpers — shared verbatim with the browser script
 *
 * Everything below this banner up to the renderer banner is embedded into
 * `VISUAL_RUNTIME_SCRIPT` via `toString()`. Two consequences:
 *   - a helper may only reference other embedded helpers, never a module
 *     constant or an import (there is no module scope in the browser);
 *   - the body must be valid ES2017 after type erasure.
 * ------------------------------------------------------------------ */

/**
 * `Number(...)` with the coercions a SQL driver forces on us: values arrive as
 * strings (`"4"`, `"1,204"`, `"$38.20"`, `"12%"`), and `Number('')`,
 * `Number(null)` and `Number(true)` would all silently become a number the
 * data never contained. Anything not genuinely numeric returns `NaN` so the
 * caller can skip it instead of rendering nonsense.
 */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return NaN;
  if (typeof value === 'string') {
    const text = value.replace(/[$,\s%]/g, '');
    if (text === '') return NaN;
    return Number(text);
  }
  return Number(value);
}

/**
 * The first result set that carries every column the component asked for.
 * Columns come from `record.columns` when present, otherwise from the keys of
 * the first row. An empty selector matches the first record — the safe default
 * when the spec omits one. Returns `null` when nothing matches; a match with
 * zero rows is still returned so the caller can say "No data for this view."
 */
export function selectRecord(
  data: VisualDataRecord[] | undefined,
  select: string[] | undefined,
): VisualDataRecord | null {
  const records = data || [];
  const wanted = select || [];
  for (const record of records) {
    if (!record) continue;
    const rows = record.rows || [];
    const columns =
      record.columns && record.columns.length
        ? record.columns
        : Object.keys(rows[0] || {});
    let matches = true;
    for (const name of wanted) {
      if (columns.indexOf(name) === -1) {
        matches = false;
        break;
      }
    }
    if (matches) return record;
  }
  return null;
}

/**
 * Collapse rows to one number. Non-numeric rows are skipped rather than
 * poisoning the result, so a single `"n/a"` cell can never produce `NaN`.
 * `count` counts rows with a non-blank value in `column` (all rows when no
 * column is given); `value` takes the first numeric row. Returns `null` when
 * there is nothing to aggregate — the caller renders an em dash, never `NaN`.
 */
export function aggregate(
  rows: Record<string, unknown>[] | undefined,
  column: string | undefined,
  agg: VisualAggregation | undefined,
): number | null {
  const list = rows || [];
  const kind = agg || 'sum';
  if (kind === 'count') {
    if (!column) return list.length;
    let count = 0;
    for (const row of list) {
      const raw = row[column];
      if (raw === null || raw === undefined) continue;
      if (typeof raw === 'string' && raw.trim() === '') continue;
      count += 1;
    }
    return count;
  }
  if (!column) return null;
  const values: number[] = [];
  for (const row of list) {
    const value = toNumber(row[column]);
    if (Number.isFinite(value)) values.push(value);
  }
  if (!values.length) return null;
  if (kind === 'value') return values[0];
  if (kind === 'min' || kind === 'max') {
    let best = values[0];
    for (const value of values) {
      if (kind === 'min' ? value < best : value > best) best = value;
    }
    return best;
  }
  let total = 0;
  for (const value of values) total += value;
  return kind === 'avg' ? total / values.length : total;
}

/** `1.2K` / `3.4M` style. Hand-rolled so the output is identical everywhere. */
export function compactNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const units = [
    { at: 1e12, suffix: 'T' },
    { at: 1e9, suffix: 'B' },
    { at: 1e6, suffix: 'M' },
    { at: 1e3, suffix: 'K' },
  ];
  for (const unit of units) {
    if (abs >= unit.at) {
      const scaled = abs / unit.at;
      const text =
        scaled >= 100
          ? String(Math.round(scaled))
          : scaled.toFixed(1).replace(/\.0$/, '');
      return sign + text + unit.suffix;
    }
  }
  return sign + abs.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Format a measure for display. Anything that is not a finite number becomes
 * an em dash — the string `NaN` must never reach the page.
 */
export function formatValue(
  value: number | null | undefined,
  format?: VisualFormat,
  unit?: string,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  const suffix = unit ? ' ' + unit : '';
  const kind = format || 'number';
  if (kind === 'compact') return compactNumber(value) + suffix;
  const sign = value < 0 ? '-' : '';
  const text = Math.abs(value).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  });
  if (kind === 'currency') return sign + '$' + text + suffix;
  if (kind === 'percent') return sign + text + '%' + suffix;
  return sign + text + suffix;
}

/**
 * Copy the rows, coercing every listed measure to a number and dropping the
 * rows where one of them is not finite. Everything the renderer plots goes
 * through this first, which is what keeps `NaN` out of path data.
 */
export function coerceRows(
  rows: Record<string, unknown>[] | undefined,
  measures: string[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const row of rows || []) {
    const next: Record<string, unknown> = {};
    for (const key in row) {
      if (Object.prototype.hasOwnProperty.call(row, key)) next[key] = row[key];
    }
    let usable = true;
    for (const measure of measures) {
      if (!measure) continue;
      const value = toNumber(row[measure]);
      if (!Number.isFinite(value)) {
        usable = false;
        break;
      }
      next[measure] = value;
    }
    if (usable) out.push(next);
  }
  return out;
}

/**
 * Keep the `n` largest rows by `y` and fold the remainder into a single
 * "Other" row. Rows are returned ranked descending; the "Other" row is last.
 * Below the cut the rows are returned unchanged (and unsorted).
 */
export function topNCut(
  rows: Record<string, unknown>[] | undefined,
  x: string,
  y: string,
  n: number | undefined,
): Record<string, unknown>[] {
  const list = (rows || []).slice();
  if (!n || n <= 0 || list.length <= n) return list;
  const ranked = list.sort(
    (a, b) => (toNumber(b[y]) || 0) - (toNumber(a[y]) || 0),
  );
  const head = ranked.slice(0, n);
  let other = 0;
  for (const row of ranked.slice(n)) {
    const value = toNumber(row[y]);
    if (Number.isFinite(value)) other += value;
  }
  const bucket: Record<string, unknown> = {};
  bucket[x] = 'Other';
  bucket[y] = other;
  head.push(bucket);
  return head;
}

/**
 * Nice tick values from 0 up to at least `max`, stepping by 1/2/5 × a power of
 * ten. A degenerate domain (0, negative, non-finite) still gets a drawable
 * axis so an empty chart has gridlines instead of a void.
 */
export function ticks(max: number, count?: number): number[] {
  const target = count && count > 0 ? count : 5;
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rough = max / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;
  const out: number[] = [];
  for (let i = 0; i * step <= max + step / 1000 && out.length < 40; i++) {
    out.push(Number((i * step).toPrecision(12)));
  }
  if (!out.length) out.push(0);
  if (out[out.length - 1] < max) {
    out.push(Number((out.length * step).toPrecision(12)));
  }
  return out;
}

/** `ticks` extended downwards when the data goes negative, same step. */
export function scaleTicks(min: number, max: number, count?: number): number[] {
  const positive = ticks(Math.max(max, 0), count);
  const step = positive.length > 1 ? positive[1] - positive[0] : 1;
  const out = positive.slice();
  let value = -step;
  while (min < 0 && out.length < 60) {
    out.unshift(Number(value.toPrecision(12)));
    if (value <= min + step / 1000) break;
    value -= step;
  }
  return out;
}

/** Natural comparison (numeric-aware) used for category sorting. */
export function compareValues(a: string, b: string): number {
  const left = toNumber(a);
  const right = toNumber(b);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  return String(a).localeCompare(String(b), 'en', { numeric: true });
}

/** The measures a chart plots: `y`, or every entry of `y` when it is a list. */
export function chartMeasures(chart: VisualChartSpec): string[] {
  const y = chart ? chart.y : undefined;
  if (Array.isArray(y)) return y.filter((name) => !!name);
  return y ? [y] : [];
}

/** The record selector for a chart: its own `select`, else the columns it names. */
export function chartSelect(chart: VisualChartSpec): string[] {
  if (chart && chart.select && chart.select.length) return chart.select;
  const out: string[] = [];
  if (chart && chart.x) out.push(chart.x);
  for (const measure of chartMeasures(chart)) out.push(measure);
  if (chart && chart.series) out.push(chart.series);
  return out;
}

/**
 * Cross-tabulate rows into `category → series → summed measure`, preserving
 * first-seen order for both dimensions. One shape feeds bar, heatmap and donut.
 */
export function groupRows(
  rows: Record<string, unknown>[],
  x: string,
  series: string | undefined,
  y: string,
): {
  categories: string[];
  series: string[];
  values: Record<string, Record<string, number>>;
} {
  const categories: string[] = [];
  const seriesNames: string[] = [];
  const values: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    const category = String(row[x]);
    const name = series ? String(row[series]) : '';
    const value = toNumber(row[y]);
    if (!Number.isFinite(value)) continue;
    if (categories.indexOf(category) === -1) categories.push(category);
    if (seriesNames.indexOf(name) === -1) seriesNames.push(name);
    const bucket = values[category] || (values[category] = {});
    bucket[name] = (bucket[name] || 0) + value;
  }
  return { categories: categories, series: seriesNames, values: values };
}

/* ------------------------------------------------------------------ *
 * Browser renderer
 *
 * Also embedded verbatim. These functions only ever run in the sandboxed
 * document; in Node they exist purely as source. `qtiState` is declared by the
 * IIFE preamble below, and `window.qti` by the frame bridge.
 * ------------------------------------------------------------------ */

/** Mutable runtime state, owned by the IIFE. */
interface QtiRuntimeState {
  spec: VisualSpec | null;
  /** Series/slice names the reader has switched off from the legend. */
  hidden: Record<string, boolean>;
  /** Per-table sort, keyed by table ("chart" or "detail"). */
  sort: Record<string, { column: string; dir: 'asc' | 'desc' }>;
}

/** The frame bridge installed by `FRAME_SELECT_SCRIPT`. */
interface QtiBridge {
  data?: VisualDataRecord[];
  onRefresh?: (callback: (data: VisualDataRecord[]) => void) => void;
}

declare const qtiState: QtiRuntimeState;
declare const window: Window & {
  qti?: QtiBridge;
  qtiChart?: { mount: () => void };
};

/** One axis tick: a pixel position, its label, and whether it draws a gridline. */
interface QtiTick {
  at: number;
  label: string;
  grid?: boolean;
}

/** Plot rectangle plus the ticks drawn around it. */
interface QtiAxisConfig {
  left: number;
  top: number;
  width: number;
  height: number;
  xTicks?: QtiTick[];
  yTicks?: QtiTick[];
  xLabel?: string;
  yLabel?: string;
}

function qtiCreate(
  tag: string,
  className?: string,
  text?: string,
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function qtiSvg(
  tag: string,
  attrs?: Record<string, string | number>,
): SVGElement {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) {
    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        node.setAttribute(key, String(attrs[key]));
      }
    }
  }
  return node;
}

function qtiText(
  x: number,
  y: number,
  text: string,
  attrs?: Record<string, string | number>,
): SVGElement {
  const node = qtiSvg('text', {
    x: x,
    y: y,
    fill: 'var(--qti-axis)',
    'font-size': 11,
    'font-family': 'inherit',
  });
  if (attrs) {
    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        node.setAttribute(key, String(attrs[key]));
      }
    }
  }
  node.textContent = text;
  return node;
}

/** The one thing a component renders when its data is missing or empty. */
function qtiNoData(): HTMLElement {
  return qtiCreate('p', 'qti-muted', 'No data for this view.');
}

/** Cycle the frame's categorical tokens; never a hex literal for a data mark. */
function qtiSeriesColor(index: number): string {
  const slot = (((index || 0) % 8) + 8) % 8;
  return 'var(--qti-cat-' + (slot + 1) + ')';
}

function qtiTruncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** Cell values reach the page as text; an object would stringify to `[object Object]`. */
function qtiString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return '';
}

/**
 * Tag an element as a clickable data mark. The frame bridge turns the click
 * into a follow-up question or a dashboard cross-filter; this runtime
 * deliberately installs no click handler of its own.
 */
function qtiMark(
  node: SVGElement | HTMLElement,
  value: unknown,
  column?: string,
  label?: string,
): void {
  if (value === null || value === undefined) return;
  node.setAttribute('data-qti-value', qtiString(value));
  if (column) node.setAttribute('data-qti-column', column);
  if (
    label !== undefined &&
    label !== null &&
    qtiString(label) !== qtiString(value)
  ) {
    node.setAttribute('data-qti-label', qtiString(label));
  }
  node.setAttribute('tabindex', '0');
  node.style.cursor = 'pointer';
}

/** Show the exact values near a mark on hover and on keyboard focus. */
function qtiBindTooltip(
  root: HTMLElement,
  node: SVGElement | HTMLElement,
  lines: string[],
): void {
  const show = function (): void {
    const tip = root.querySelector<HTMLElement>('.qti-tooltip');
    if (!tip) return;
    while (tip.firstChild) tip.removeChild(tip.firstChild);
    for (const line of lines) {
      tip.appendChild(qtiCreate('div', undefined, line));
    }
    tip.style.display = 'block';
    const box = node.getBoundingClientRect();
    const frame = root.getBoundingClientRect();
    tip.style.left = box.left - frame.left + box.width / 2 + 'px';
    tip.style.top = box.top - frame.top - 8 + 'px';
    tip.style.transform = 'translate(-50%, -100%)';
  };
  const hide = function (): void {
    const tip = root.querySelector<HTMLElement>('.qti-tooltip');
    if (tip) tip.style.display = 'none';
  };
  node.addEventListener('mouseover', show);
  node.addEventListener('mouseout', hide);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hide);
}

/**
 * Series switches. Not data marks: they carry no `data-qti-value`, so the
 * frame bridge ignores them and a click only toggles visibility here.
 */
function qtiLegend(entries: { name: string; label: string }[]): HTMLElement {
  const legend = qtiCreate('div', 'qti-legend');
  legend.setAttribute('role', 'group');
  legend.setAttribute('aria-label', 'Series');
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const visible = !qtiState.hidden[entry.name];
    const button = qtiCreate('button', 'qti-legend-item');
    button.setAttribute('type', 'button');
    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    const swatch = qtiCreate('span', 'qti-legend-swatch');
    swatch.style.background = qtiSeriesColor(index);
    button.appendChild(swatch);
    button.appendChild(qtiCreate('span', undefined, entry.label));
    button.addEventListener('click', function () {
      if (qtiState.hidden[entry.name]) delete qtiState.hidden[entry.name];
      else qtiState.hidden[entry.name] = true;
      qtiRender();
    });
    legend.appendChild(button);
  }
  return legend;
}

/** Axis lines, gridlines, tick labels and axis titles around a plot rectangle. */
function qtiAxes(svg: SVGElement, config: QtiAxisConfig): void {
  const right = config.left + config.width;
  const bottom = config.top + config.height;
  for (const tick of config.yTicks || []) {
    if (tick.grid !== false) {
      svg.appendChild(
        qtiSvg('line', {
          x1: config.left,
          y1: tick.at,
          x2: right,
          y2: tick.at,
          stroke: 'var(--qti-grid)',
          'stroke-width': 1,
        }),
      );
    }
    svg.appendChild(
      qtiText(config.left - 8, tick.at + 4, tick.label, {
        'text-anchor': 'end',
      }),
    );
  }
  for (const tick of config.xTicks || []) {
    if (tick.grid) {
      svg.appendChild(
        qtiSvg('line', {
          x1: tick.at,
          y1: config.top,
          x2: tick.at,
          y2: bottom,
          stroke: 'var(--qti-grid)',
          'stroke-width': 1,
        }),
      );
    }
    svg.appendChild(
      qtiText(tick.at, bottom + 18, tick.label, { 'text-anchor': 'middle' }),
    );
  }
  svg.appendChild(
    qtiSvg('line', {
      x1: config.left,
      y1: config.top,
      x2: config.left,
      y2: bottom,
      stroke: 'var(--qti-axis)',
      'stroke-width': 1,
    }),
  );
  svg.appendChild(
    qtiSvg('line', {
      x1: config.left,
      y1: bottom,
      x2: right,
      y2: bottom,
      stroke: 'var(--qti-axis)',
      'stroke-width': 1,
    }),
  );
  if (config.xLabel) {
    svg.appendChild(
      qtiText(config.left + config.width / 2, bottom + 40, config.xLabel, {
        'text-anchor': 'middle',
      }),
    );
  }
  if (config.yLabel) {
    svg.appendChild(
      qtiText(0, 0, config.yLabel, {
        'text-anchor': 'middle',
        transform:
          'translate(' +
          (config.left - 46) +
          ',' +
          (config.top + config.height / 2) +
          ') rotate(-90)',
      }),
    );
  }
}

/** A scaling `<svg>` with the accessibility wrapper every chart shares. */
function qtiCanvas(width: number, height: number, label: string): SVGElement {
  const svg = qtiSvg('svg', {
    viewBox: '0 0 ' + width + ' ' + height,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });
  svg.setAttribute('aria-label', label);
  svg.style.width = '100%';
  svg.style.height = 'auto';
  return svg;
}

function qtiAriaLabel(chart: VisualChartSpec): string {
  const measures = chartMeasures(chart).join(' and ');
  let label = chart.form + ' chart';
  if (measures) label += ' of ' + measures;
  if (chart.x) label += ' by ' + chart.x;
  if (chart.series) label += ', split by ' + chart.series;
  return label;
}

/** Order the categories the way the spec asked for. */
function qtiSortCategories(
  categories: string[],
  values: Record<string, Record<string, number>>,
  sort: VisualSortSpec | undefined,
): string[] {
  if (!sort || !sort.by) return categories;
  const direction = sort.dir === 'asc' ? 1 : -1;
  const total = function (category: string): number {
    const bucket = values[category] || {};
    let sum = 0;
    for (const key in bucket) {
      if (Object.prototype.hasOwnProperty.call(bucket, key)) sum += bucket[key];
    }
    return sum;
  };
  const sorted = categories.slice();
  if (sort.by === 'x') {
    sorted.sort(function (a, b) {
      return compareValues(a, b) * (sort.dir === 'desc' ? -1 : 1);
    });
  } else {
    sorted.sort(function (a, b) {
      return (total(a) - total(b)) * direction;
    });
  }
  return sorted;
}

/** Apply `topN` to a cross-tab, folding the remainder into an "Other" column. */
function qtiApplyTopN(
  grouped: {
    categories: string[];
    series: string[];
    values: Record<string, Record<string, number>>;
  },
  x: string,
  y: string,
  n: number | undefined,
): void {
  if (!n || n <= 0 || grouped.categories.length <= n) return;
  const totals: Record<string, unknown>[] = [];
  for (const category of grouped.categories) {
    const bucket = grouped.values[category] || {};
    let sum = 0;
    for (const key in bucket) {
      if (Object.prototype.hasOwnProperty.call(bucket, key)) sum += bucket[key];
    }
    const row: Record<string, unknown> = {};
    row[x] = category;
    row[y] = sum;
    totals.push(row);
  }
  const kept = topNCut(totals, x, y, n).map(function (row) {
    return String(row[x]);
  });
  const keptSet: Record<string, boolean> = {};
  for (const name of kept) keptSet[name] = true;
  const remapped: Record<string, Record<string, number>> = {};
  for (const category of grouped.categories) {
    const target = keptSet[category] ? category : 'Other';
    const bucket = remapped[target] || (remapped[target] = {});
    const source = grouped.values[category] || {};
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        bucket[key] = (bucket[key] || 0) + source[key];
      }
    }
  }
  grouped.categories = kept;
  grouped.values = remapped;
}

/** One KPI tile using the frame's ready-made classes. */
function qtiTile(
  label: string,
  text: string,
  markValue?: unknown,
  markColumn?: string,
  markLabel?: string,
): HTMLElement {
  const tile = qtiCreate('div', 'qti-kpi');
  tile.appendChild(qtiCreate('span', 'qti-kpi-value', text));
  tile.appendChild(qtiCreate('span', 'qti-kpi-label', label));
  if (markValue !== undefined) qtiMark(tile, markValue, markColumn, markLabel);
  return tile;
}

/**
 * The KPI row above the chart. A tile whose record or column is missing shows
 * an em dash rather than disappearing, so the layout stays stable.
 */
function qtiRenderKpis(
  root: HTMLElement,
  data: VisualDataRecord[],
  kpis: VisualKpiSpec[],
): HTMLElement {
  const wrap = qtiCreate('div', 'qti-kpis');
  for (const kpi of kpis.slice(0, 4)) {
    const record = selectRecord(data, kpi.select);
    const rows = record && record.rows ? record.rows : [];
    const value = rows.length ? aggregate(rows, kpi.column, kpi.agg) : null;
    // Deliberately no `data-qti-column`: a KPI is an aggregate, so its label is
    // not a value of that column and a cross-filter on it would empty the tile.
    const tile = qtiTile(
      kpi.label,
      formatValue(value, kpi.format, kpi.unit),
      kpi.label,
    );
    qtiBindTooltip(root, tile, [
      kpi.label,
      (kpi.agg || 'sum') +
        ' of ' +
        kpi.column +
        ': ' +
        formatValue(value, 'number', kpi.unit),
    ]);
    wrap.appendChild(tile);
  }
  return wrap;
}

/** Vertical or horizontal bars, grouped or stacked. */
function qtiBar(
  root: HTMLElement,
  wrap: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): void {
  const x = chart.x || '';
  const y = chartMeasures(chart)[0] || '';
  const record = selectRecord(data, chartSelect(chart));
  const source = record && record.rows ? record.rows : [];
  const rows = coerceRows(source, [y]);
  if (!x || !y || !rows.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  const grouped = groupRows(rows, x, chart.series, y);
  qtiApplyTopN(grouped, x, y, chart.topN);
  const categories = qtiSortCategories(
    grouped.categories,
    grouped.values,
    chart.sort,
  );
  const split = !!chart.series && grouped.series.length > 1;
  const format = chart.format ? chart.format.y : undefined;

  if (split) {
    wrap.appendChild(
      qtiLegend(
        grouped.series.map(function (name) {
          return { name: name, label: name };
        }),
      ),
    );
  }
  const visible = grouped.series.filter(function (name) {
    return !split || !qtiState.hidden[name];
  });
  if (!categories.length || !visible.length) {
    wrap.appendChild(qtiNoData());
    return;
  }

  const stacked = !!chart.stacked && split;
  const valueOf = function (category: string, name: string): number {
    const bucket = grouped.values[category] || {};
    const value = bucket[name];
    return Number.isFinite(value) ? value : 0;
  };
  let maxValue = 0;
  let minValue = 0;
  for (const category of categories) {
    let stack = 0;
    for (const name of visible) {
      const value = valueOf(category, name);
      if (stacked) {
        if (value > 0) stack += value;
        if (value < minValue) minValue = value;
      } else {
        if (value > maxValue) maxValue = value;
        if (value < minValue) minValue = value;
      }
    }
    if (stacked && stack > maxValue) maxValue = stack;
  }
  const scale = scaleTicks(minValue, maxValue, 5);
  const domainMin = scale[0];
  const domainMax = scale[scale.length - 1];
  const span = domainMax - domainMin || 1;
  const horizontal = categories.length > 8 && !split;
  const label = qtiAriaLabel(chart);

  if (horizontal) {
    const width = 760;
    const rowHeight = 30;
    const margin = {
      top: 16,
      right: 64,
      bottom: chart.xLabel ? 56 : 36,
      left: 160,
    };
    const plotHeight = categories.length * rowHeight;
    const height = plotHeight + margin.top + margin.bottom;
    const plotWidth = width - margin.left - margin.right;
    const svg = qtiCanvas(width, height, label);
    const xScale = function (value: number): number {
      return margin.left + ((value - domainMin) / span) * plotWidth;
    };
    qtiAxes(svg, {
      left: margin.left,
      top: margin.top,
      width: plotWidth,
      height: plotHeight,
      xTicks: scale.map(function (value) {
        return {
          at: xScale(value),
          label: formatValue(value, format),
          grid: true,
        };
      }),
      xLabel: chart.yLabel || chart.xLabel,
    });
    const zero = xScale(Math.max(domainMin, Math.min(0, domainMax)));
    for (let index = 0; index < categories.length; index++) {
      const category = categories[index];
      const value = valueOf(category, visible[0]);
      const center = margin.top + index * rowHeight + rowHeight / 2;
      const barHeight = Math.min(20, rowHeight * 0.66);
      const end = xScale(value);
      const rect = qtiSvg('rect', {
        x: Math.min(zero, end),
        y: center - barHeight / 2,
        width: Math.max(1, Math.abs(end - zero)),
        height: barHeight,
        rx: 2,
        fill: qtiSeriesColor(0),
      });
      qtiMark(rect, category, x);
      qtiBindTooltip(root, rect, [
        x + ': ' + category,
        y + ': ' + formatValue(value, format),
      ]);
      svg.appendChild(rect);
      svg.appendChild(
        qtiText(margin.left - 8, center + 4, qtiTruncate(category, 22), {
          'text-anchor': 'end',
        }),
      );
      if (chart.labels !== false) {
        svg.appendChild(
          qtiText(
            value >= 0 ? end + 6 : end - 6,
            center + 4,
            formatValue(value, format),
            {
              'text-anchor': value >= 0 ? 'start' : 'end',
              fill: '#d4d4d8',
            },
          ),
        );
      }
    }
    wrap.appendChild(svg);
    return;
  }

  const width = 760;
  const height = 340;
  const margin = {
    top: 20,
    right: 20,
    bottom: chart.xLabel ? 64 : 48,
    left: chart.yLabel ? 76 : 64,
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const svg = qtiCanvas(width, height, label);
  const yScale = function (value: number): number {
    return margin.top + plotHeight - ((value - domainMin) / span) * plotHeight;
  };
  const band = plotWidth / categories.length;
  qtiAxes(svg, {
    left: margin.left,
    top: margin.top,
    width: plotWidth,
    height: plotHeight,
    yTicks: scale.map(function (value) {
      return { at: yScale(value), label: formatValue(value, format) };
    }),
    xTicks: categories.map(function (category, index) {
      return {
        at: margin.left + band * (index + 0.5),
        label: qtiTruncate(category, Math.max(6, Math.floor(band / 7))),
      };
    }),
    xLabel: chart.xLabel,
    yLabel: chart.yLabel,
  });
  const zero = yScale(Math.max(domainMin, Math.min(0, domainMax)));
  for (let index = 0; index < categories.length; index++) {
    const category = categories[index];
    const inner = band * 0.72;
    const start = margin.left + band * index + band * 0.14;
    let positive = 0;
    for (let s = 0; s < visible.length; s++) {
      const name = visible[s];
      const value = valueOf(category, name);
      const barWidth = stacked ? inner : inner / visible.length;
      const barX = stacked ? start : start + barWidth * s;
      let top: number;
      let barHeight: number;
      if (stacked) {
        const base = value >= 0 ? positive : 0;
        top = yScale(base + Math.max(value, 0));
        barHeight = Math.abs(yScale(base) - top);
        if (value >= 0) positive += value;
        else {
          top = zero;
          barHeight = Math.abs(yScale(value) - zero);
        }
      } else {
        top = value >= 0 ? yScale(value) : zero;
        barHeight = Math.abs(yScale(value) - zero);
      }
      const rect = qtiSvg('rect', {
        x: barX,
        y: top,
        width: Math.max(1, barWidth - 1),
        height: Math.max(1, barHeight),
        rx: 2,
        fill: qtiSeriesColor(grouped.series.indexOf(name)),
      });
      qtiMark(rect, category, x);
      qtiBindTooltip(
        root,
        rect,
        split
          ? [x + ': ' + category, name + ': ' + formatValue(value, format)]
          : [x + ': ' + category, y + ': ' + formatValue(value, format)],
      );
      svg.appendChild(rect);
      if (chart.labels && !stacked) {
        svg.appendChild(
          qtiText(
            barX + barWidth / 2,
            value >= 0 ? top - 5 : top + barHeight + 12,
            formatValue(value, format || 'compact'),
            { 'text-anchor': 'middle', fill: '#d4d4d8', 'font-size': 10 },
          ),
        );
      }
    }
    if (chart.labels && stacked) {
      svg.appendChild(
        qtiText(
          start + inner / 2,
          yScale(positive) - 5,
          formatValue(positive, format || 'compact'),
          { 'text-anchor': 'middle', fill: '#d4d4d8', 'font-size': 10 },
        ),
      );
    }
  }
  wrap.appendChild(svg);
}

/** One line per series, or one per measure when `y` is a list. */
function qtiLine(
  root: HTMLElement,
  wrap: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): void {
  const x = chart.x || '';
  const measures = chartMeasures(chart);
  const record = selectRecord(data, chartSelect(chart));
  const source = record && record.rows ? record.rows : [];
  const rows = coerceRows(source, measures.length === 1 ? measures : []);
  if (!x || !measures.length || !rows.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  const format = chart.format ? chart.format.y : undefined;
  let names: string[] = [];
  // series → one line per series value; otherwise one line per measure.
  const byName: Record<string, Record<string, number>> = {};
  if (chart.series) {
    const grouped = groupRows(rows, x, chart.series, measures[0]);
    names = grouped.series;
    for (const name of names) {
      const line: Record<string, number> = {};
      for (const category of grouped.categories) {
        const bucket = grouped.values[category] || {};
        if (Object.prototype.hasOwnProperty.call(bucket, name)) {
          line[category] = bucket[name];
        }
      }
      byName[name] = line;
    }
  } else {
    names = measures;
    for (const measure of measures) {
      const line: Record<string, number> = {};
      for (const row of rows) {
        const value = toNumber(row[measure]);
        if (!Number.isFinite(value)) continue;
        const category = String(row[x]);
        line[category] = (line[category] || 0) + value;
      }
      byName[measure] = line;
    }
  }
  let categories: string[] = [];
  for (const row of rows) {
    const category = String(row[x]);
    if (categories.indexOf(category) === -1) categories.push(category);
  }
  // Row order is the SQL's order, which is usually the intended reading order
  // ("Group", "Round of 16", "Final"). Only re-order when the spec asks, or
  // when every category is a bare number and reading them out of order would
  // be plainly wrong.
  const allNumeric = categories.every(function (category) {
    return Number.isFinite(toNumber(category));
  });
  if ((chart.sort && chart.sort.by === 'x') || allNumeric) {
    const direction = chart.sort && chart.sort.dir === 'desc' ? -1 : 1;
    categories = categories.slice().sort(function (a, b) {
      return compareValues(a, b) * direction;
    });
  }
  if (names.length > 1) {
    wrap.appendChild(
      qtiLegend(
        names.map(function (name) {
          return { name: name, label: name };
        }),
      ),
    );
  }
  const visible = names.filter(function (name) {
    return names.length < 2 || !qtiState.hidden[name];
  });
  if (!categories.length || !visible.length) {
    wrap.appendChild(qtiNoData());
    return;
  }

  let maxValue = 0;
  let minValue = 0;
  for (const name of visible) {
    const line = byName[name] || {};
    for (const category of categories) {
      const value = line[category];
      if (!Number.isFinite(value)) continue;
      if (value > maxValue) maxValue = value;
      if (value < minValue) minValue = value;
    }
  }
  const scale = scaleTicks(minValue, maxValue, 5);
  const domainMin = scale[0];
  const domainMax = scale[scale.length - 1];
  const span = domainMax - domainMin || 1;
  const width = 760;
  const height = 340;
  const margin = {
    top: 20,
    right: 24,
    bottom: chart.xLabel ? 64 : 48,
    left: chart.yLabel ? 76 : 64,
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const svg = qtiCanvas(width, height, qtiAriaLabel(chart));
  const xScale = function (index: number): number {
    if (categories.length === 1) return margin.left + plotWidth / 2;
    return margin.left + (index / (categories.length - 1)) * plotWidth;
  };
  const yScale = function (value: number): number {
    return margin.top + plotHeight - ((value - domainMin) / span) * plotHeight;
  };
  const stride = Math.max(1, Math.ceil(categories.length / 8));
  qtiAxes(svg, {
    left: margin.left,
    top: margin.top,
    width: plotWidth,
    height: plotHeight,
    yTicks: scale.map(function (value) {
      return { at: yScale(value), label: formatValue(value, format) };
    }),
    xTicks: categories
      .map(function (category, index) {
        return {
          at: xScale(index),
          label: qtiTruncate(category, 12),
          index: index,
        };
      })
      .filter(function (tick) {
        return tick.index % stride === 0;
      }),
    xLabel: chart.xLabel,
    yLabel: chart.yLabel,
  });
  for (const name of visible) {
    const colorIndex = names.indexOf(name);
    const color = qtiSeriesColor(colorIndex);
    const line = byName[name] || {};
    let path = '';
    for (let index = 0; index < categories.length; index++) {
      const value = line[categories[index]];
      if (!Number.isFinite(value)) {
        path += '';
        continue;
      }
      const px = xScale(index);
      const py = yScale(value);
      path +=
        (path === '' || !Number.isFinite(line[categories[index - 1]])
          ? 'M'
          : 'L') +
        px +
        ' ' +
        py +
        ' ';
    }
    if (path) {
      svg.appendChild(
        qtiSvg('path', {
          d: path.trim(),
          fill: 'none',
          stroke: color,
          'stroke-width': 2,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        }),
      );
    }
    for (let index = 0; index < categories.length; index++) {
      const category = categories[index];
      const value = line[category];
      if (!Number.isFinite(value)) continue;
      const point = qtiSvg('circle', {
        cx: xScale(index),
        cy: yScale(value),
        r: 3.5,
        fill: color,
      });
      qtiMark(point, category, x);
      qtiBindTooltip(root, point, [
        x + ': ' + category,
        name + ': ' + formatValue(value, format),
      ]);
      svg.appendChild(point);
      if (chart.labels) {
        svg.appendChild(
          qtiText(
            xScale(index),
            yScale(value) - 8,
            formatValue(value, format || 'compact'),
            { 'text-anchor': 'middle', fill: '#d4d4d8', 'font-size': 10 },
          ),
        );
      }
    }
  }
  wrap.appendChild(svg);
}

/**
 * Fan out points that share exact plot coordinates so ties stay visible:
 * small-integer measures routinely stack several points on one spot, which
 * reads as a broken, mostly-empty chart. Singles are untouched; groups of
 * n > 1 are arranged on a small ring around the shared centre, in input
 * order, so the layout is deterministic.
 */
export function spreadOverlaps(
  points: { cx: number; cy: number }[],
  spacing: number,
): { cx: number; cy: number }[] {
  const groups: Record<string, number[]> = {};
  points.forEach(function (point, index) {
    const key = point.cx.toFixed(1) + ':' + point.cy.toFixed(1);
    (groups[key] = groups[key] || []).push(index);
  });
  const out = points.map(function (point) {
    return { cx: point.cx, cy: point.cy };
  });
  for (const key in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
    const members = groups[key];
    if (members.length < 2) continue;
    for (let i = 0; i < members.length; i++) {
      const angle = (2 * Math.PI * i) / members.length;
      out[members[i]].cx += spacing * Math.cos(angle);
      out[members[i]].cy += spacing * Math.sin(angle);
    }
  }
  return out;
}

/** Two measures against each other, coloured by series. */
function qtiScatter(
  root: HTMLElement,
  wrap: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): void {
  const x = chart.x || '';
  const y = chartMeasures(chart)[0] || '';
  const record = selectRecord(data, chartSelect(chart));
  const source = record && record.rows ? record.rows : [];
  const rows = coerceRows(source, [x, y]);
  if (!x || !y || !rows.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  const format = chart.format ? chart.format.y : undefined;
  const names: string[] = [];
  for (const row of rows) {
    const name = chart.series ? String(row[chart.series]) : '';
    if (names.indexOf(name) === -1) names.push(name);
  }
  if (chart.series && names.length > 1) {
    wrap.appendChild(
      qtiLegend(
        names.map(function (name) {
          return { name: name, label: name };
        }),
      ),
    );
  }
  const plotted = rows.filter(function (row) {
    const name = chart.series ? String(row[chart.series]) : '';
    return names.length < 2 || !qtiState.hidden[name];
  });
  if (!plotted.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  let xMax = 0;
  let xMin = 0;
  let yMax = 0;
  let yMin = 0;
  for (const row of plotted) {
    const xValue = toNumber(row[x]);
    const yValue = toNumber(row[y]);
    if (xValue > xMax) xMax = xValue;
    if (xValue < xMin) xMin = xValue;
    if (yValue > yMax) yMax = yValue;
    if (yValue < yMin) yMin = yValue;
  }
  const xScaleTicks = scaleTicks(xMin, xMax, 5);
  const yScaleTicks = scaleTicks(yMin, yMax, 5);
  const xDomainMin = xScaleTicks[0];
  const xSpan = xScaleTicks[xScaleTicks.length - 1] - xDomainMin || 1;
  const yDomainMin = yScaleTicks[0];
  const ySpan = yScaleTicks[yScaleTicks.length - 1] - yDomainMin || 1;
  const width = 760;
  const height = 340;
  const margin = {
    top: 20,
    right: 24,
    bottom: chart.xLabel ? 64 : 48,
    left: chart.yLabel ? 76 : 64,
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const svg = qtiCanvas(width, height, qtiAriaLabel(chart));
  const xScale = function (value: number): number {
    return margin.left + ((value - xDomainMin) / xSpan) * plotWidth;
  };
  const yScale = function (value: number): number {
    return (
      margin.top + plotHeight - ((value - yDomainMin) / ySpan) * plotHeight
    );
  };
  qtiAxes(svg, {
    left: margin.left,
    top: margin.top,
    width: plotWidth,
    height: plotHeight,
    yTicks: yScaleTicks.map(function (value) {
      return { at: yScale(value), label: formatValue(value, format) };
    }),
    xTicks: xScaleTicks.map(function (value) {
      return { at: xScale(value), label: formatValue(value) };
    }),
    xLabel: chart.xLabel || x,
    yLabel: chart.yLabel || y,
  });
  const positions = spreadOverlaps(
    plotted.map(function (row) {
      return { cx: xScale(toNumber(row[x])), cy: yScale(toNumber(row[y])) };
    }),
    7,
  );
  plotted.forEach(function (row, index) {
    const name = chart.series ? String(row[chart.series]) : '';
    const xValue = toNumber(row[x]);
    const yValue = toNumber(row[y]);
    const point = qtiSvg('circle', {
      cx: positions[index].cx,
      cy: positions[index].cy,
      r: 4.5,
      fill: qtiSeriesColor(names.indexOf(name)),
      'fill-opacity': 0.85,
    });
    if (chart.series) qtiMark(point, name, chart.series);
    else qtiMark(point, xValue, x);
    const lines = [
      x + ': ' + formatValue(xValue),
      y + ': ' + formatValue(yValue, format),
    ];
    if (chart.series) lines.unshift(chart.series + ': ' + name);
    qtiBindTooltip(root, point, lines);
    svg.appendChild(point);
  });
  wrap.appendChild(svg);
}

/** `x` × `series` grid, cells shaded by `y`. */
function qtiHeatmap(
  root: HTMLElement,
  wrap: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): void {
  const x = chart.x || '';
  const y = chartMeasures(chart)[0] || '';
  const series = chart.series || '';
  const record = selectRecord(data, chartSelect(chart));
  const source = record && record.rows ? record.rows : [];
  const rows = coerceRows(source, [y]);
  if (!x || !y || !series || !rows.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  const format = chart.format ? chart.format.y : undefined;
  const grouped = groupRows(rows, x, series, y);
  const columns = qtiSortCategories(
    grouped.categories,
    grouped.values,
    chart.sort,
  );
  const lanes = grouped.series;
  if (!columns.length || !lanes.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  let maxValue = 0;
  for (const category of columns) {
    const bucket = grouped.values[category] || {};
    for (const lane of lanes) {
      const value = bucket[lane];
      if (Number.isFinite(value) && Math.abs(value) > maxValue) {
        maxValue = Math.abs(value);
      }
    }
  }
  const width = 760;
  const cellHeight = 34;
  const margin = {
    top: 16,
    right: 20,
    bottom: chart.xLabel ? 62 : 44,
    left: 150,
  };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = lanes.length * cellHeight;
  const height = plotHeight + margin.top + margin.bottom;
  const cellWidth = plotWidth / columns.length;
  const svg = qtiCanvas(width, height, qtiAriaLabel(chart));
  for (let lane = 0; lane < lanes.length; lane++) {
    const name = lanes[lane];
    svg.appendChild(
      qtiText(
        margin.left - 8,
        margin.top + lane * cellHeight + cellHeight / 2 + 4,
        qtiTruncate(name, 20),
        { 'text-anchor': 'end' },
      ),
    );
    for (let column = 0; column < columns.length; column++) {
      const category = columns[column];
      const bucket = grouped.values[category] || {};
      const value = bucket[name];
      const has = Number.isFinite(value);
      const cell = qtiSvg('rect', {
        x: margin.left + column * cellWidth + 1,
        y: margin.top + lane * cellHeight + 1,
        width: Math.max(1, cellWidth - 2),
        height: cellHeight - 2,
        rx: 3,
        fill: has ? 'var(--qti-cat-1)' : 'var(--qti-grid)',
        'fill-opacity': has
          ? 0.14 + 0.82 * (maxValue ? Math.abs(value) / maxValue : 0)
          : 1,
      });
      qtiMark(cell, category, x);
      qtiBindTooltip(root, cell, [
        x + ': ' + category,
        series + ': ' + name,
        y + ': ' + formatValue(has ? value : null, format),
      ]);
      svg.appendChild(cell);
      svg.appendChild(
        qtiText(
          margin.left + column * cellWidth + cellWidth / 2,
          margin.top + lane * cellHeight + cellHeight / 2 + 4,
          formatValue(has ? value : null, format || 'compact'),
          { 'text-anchor': 'middle', fill: '#fafafa', 'font-size': 10 },
        ),
      );
    }
  }
  qtiAxes(svg, {
    left: margin.left,
    top: margin.top,
    width: plotWidth,
    height: plotHeight,
    xTicks: columns.map(function (category, index) {
      return {
        at: margin.left + cellWidth * (index + 0.5),
        label: qtiTruncate(category, Math.max(6, Math.floor(cellWidth / 7))),
      };
    }),
    xLabel: chart.xLabel,
  });
  wrap.appendChild(svg);
}

/** Headline numbers instead of a chart. */
function qtiMetricCards(
  root: HTMLElement,
  wrap: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): void {
  const record = selectRecord(data, chartSelect(chart));
  const rows = record && record.rows ? record.rows : [];
  if (!rows.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  const format = chart.format ? chart.format.y : undefined;
  const measures = chartMeasures(chart);
  const tiles = qtiCreate('div', 'qti-kpis');
  if (rows.length === 1 && measures.length) {
    // One row of measures: a card per measure. The mark is the column name, so
    // no `data-qti-column` — there is no cell value to cross-filter on.
    for (const measure of measures) {
      const value = toNumber(rows[0][measure]);
      const label = measure.replace(/_/g, ' ');
      const tile = qtiTile(
        label,
        formatValue(Number.isFinite(value) ? value : null, format),
        measure,
        undefined,
        label,
      );
      qtiBindTooltip(root, tile, [
        label,
        formatValue(Number.isFinite(value) ? value : null),
      ]);
      tiles.appendChild(tile);
    }
  } else {
    const x = chart.x || (record && record.columns ? record.columns[0] : '');
    const y = measures[0] || '';
    const coerced = coerceRows(rows, [y]).slice(0, 8);
    if (!x || !y || !coerced.length) {
      wrap.appendChild(qtiNoData());
      return;
    }
    for (const row of coerced) {
      const label = String(row[x]);
      const value = toNumber(row[y]);
      const tile = qtiTile(label, formatValue(value, format), label, x);
      qtiBindTooltip(root, tile, [
        x + ': ' + label,
        y + ': ' + formatValue(value),
      ]);
      tiles.appendChild(tile);
    }
  }
  wrap.appendChild(tiles);
}

/**
 * A compact table. `key` namespaces the sort state so the chart table and the
 * detail table can be sorted independently.
 */
function qtiDataTable(
  root: HTMLElement,
  rows: Record<string, unknown>[],
  columns: string[],
  keyColumn: string,
  sortKey: string,
): HTMLElement {
  const maxRows = 200;
  const wrap = qtiCreate('div', 'qti-table-wrap');
  const table = qtiCreate('table', 'qti-table qti-sortable');
  const head = qtiCreate('thead');
  const headRow = qtiCreate('tr');
  const sort = qtiState.sort[sortKey];
  for (const column of columns) {
    const cell = qtiCreate('th');
    const active = sort && sort.column === column;
    cell.textContent =
      column + (active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('role', 'button');
    cell.setAttribute(
      'aria-label',
      'Sort by ' +
        column +
        (active && sort.dir === 'asc' ? ', descending' : ', ascending'),
    );
    cell.style.cursor = 'pointer';
    const toggle = function (): void {
      const current = qtiState.sort[sortKey];
      const descending =
        current && current.column === column && current.dir === 'desc';
      qtiState.sort[sortKey] = {
        column: column,
        dir: descending ? 'asc' : 'desc',
      };
      qtiRender();
    };
    cell.addEventListener('click', toggle);
    cell.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        toggle();
      }
    });
    headRow.appendChild(cell);
  }
  head.appendChild(headRow);
  table.appendChild(head);

  let ordered = rows.slice();
  if (sort && columns.indexOf(sort.column) !== -1) {
    const direction = sort.dir === 'asc' ? 1 : -1;
    ordered = ordered.sort(function (a, b) {
      return (
        compareValues(qtiString(a[sort.column]), qtiString(b[sort.column])) *
        direction
      );
    });
  }
  const body = qtiCreate('tbody');
  for (const row of ordered.slice(0, maxRows)) {
    const tr = qtiCreate('tr');
    if (keyColumn && row[keyColumn] !== undefined) {
      qtiMark(tr, row[keyColumn], keyColumn);
    }
    for (const column of columns) {
      const raw = row[column];
      const cell = qtiCreate('td');
      cell.textContent =
        raw === null || raw === undefined ? '—' : qtiString(raw);
      if (Number.isFinite(toNumber(raw))) cell.style.textAlign = 'right';
      tr.appendChild(cell);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  wrap.appendChild(table);
  if (ordered.length > maxRows) {
    wrap.appendChild(
      qtiCreate(
        'p',
        'qti-muted',
        'Showing ' + maxRows + ' of ' + ordered.length + ' rows.',
      ),
    );
  }
  return wrap;
}

/** The `table` chart form: the rows themselves, sortable. */
function qtiTableChart(
  root: HTMLElement,
  wrap: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): void {
  const record = selectRecord(data, chartSelect(chart));
  const rows = record && record.rows ? record.rows : [];
  if (!rows.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  const columns =
    chart.select && chart.select.length
      ? chart.select
      : record && record.columns && record.columns.length
        ? record.columns
        : Object.keys(rows[0] || {});
  wrap.appendChild(
    qtiDataTable(root, rows, columns, chart.x || columns[0], 'chart'),
  );
}

/** Donut with the visible total in the middle. */
function qtiDonut(
  root: HTMLElement,
  wrap: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): void {
  const x = chart.x || '';
  const y = chartMeasures(chart)[0] || '';
  const record = selectRecord(data, chartSelect(chart));
  const source = record && record.rows ? record.rows : [];
  const rows = coerceRows(source, [y]);
  if (!x || !y || !rows.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  const format = chart.format ? chart.format.y : undefined;
  const grouped = groupRows(rows, x, undefined, y);
  qtiApplyTopN(grouped, x, y, chart.topN && chart.topN > 0 ? chart.topN : 8);
  const categories = qtiSortCategories(
    grouped.categories,
    grouped.values,
    chart.sort,
  );
  wrap.appendChild(
    qtiLegend(
      categories.map(function (category) {
        return { name: category, label: category };
      }),
    ),
  );
  const slices: { name: string; value: number; color: string }[] = [];
  let total = 0;
  for (let index = 0; index < categories.length; index++) {
    const category = categories[index];
    if (qtiState.hidden[category]) continue;
    const bucket = grouped.values[category] || {};
    const value = bucket[''];
    if (!Number.isFinite(value) || value <= 0) continue;
    slices.push({ name: category, value: value, color: qtiSeriesColor(index) });
    total += value;
  }
  if (!slices.length || total <= 0) {
    wrap.appendChild(qtiNoData());
    return;
  }
  const width = 460;
  const height = 300;
  const cx = width / 2;
  const cy = height / 2;
  const outer = 112;
  const inner = 68;
  const svg = qtiCanvas(width, height, qtiAriaLabel(chart));
  const point = function (radius: number, angle: number): number[] {
    return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)];
  };
  let start = 0;
  for (const slice of slices) {
    const sweep = (slice.value / total) * Math.PI * 2;
    const end = start + sweep;
    let shape: SVGElement;
    if (slices.length === 1 || sweep >= Math.PI * 2 - 1e-9) {
      shape = qtiSvg('circle', {
        cx: cx,
        cy: cy,
        r: (outer + inner) / 2,
        fill: 'none',
        stroke: slice.color,
        'stroke-width': outer - inner,
      });
    } else {
      const large = sweep > Math.PI ? 1 : 0;
      const a = point(outer, start);
      const b = point(outer, end);
      const c = point(inner, end);
      const d = point(inner, start);
      shape = qtiSvg('path', {
        d:
          'M' +
          a[0] +
          ' ' +
          a[1] +
          'A' +
          outer +
          ' ' +
          outer +
          ' 0 ' +
          large +
          ' 1 ' +
          b[0] +
          ' ' +
          b[1] +
          'L' +
          c[0] +
          ' ' +
          c[1] +
          'A' +
          inner +
          ' ' +
          inner +
          ' 0 ' +
          large +
          ' 0 ' +
          d[0] +
          ' ' +
          d[1] +
          'Z',
        fill: slice.color,
      });
    }
    qtiMark(shape, slice.name, x);
    qtiBindTooltip(root, shape, [
      x + ': ' + slice.name,
      y + ': ' + formatValue(slice.value, format),
      formatValue((slice.value / total) * 100, 'percent') + ' of total',
    ]);
    svg.appendChild(shape);
    if (chart.labels !== false && sweep > 0.35) {
      const mid = point((outer + inner) / 2, start + sweep / 2);
      svg.appendChild(
        qtiText(
          mid[0],
          mid[1] + 4,
          formatValue(slice.value, format || 'compact'),
          {
            'text-anchor': 'middle',
            fill: '#18181b',
            'font-size': 11,
            'font-weight': 600,
          },
        ),
      );
    }
    start = end;
  }
  svg.appendChild(
    qtiText(cx, cy, formatValue(total, format || 'compact'), {
      'text-anchor': 'middle',
      fill: '#fafafa',
      'font-size': 24,
      'font-weight': 600,
    }),
  );
  svg.appendChild(qtiText(cx, cy + 18, 'Total', { 'text-anchor': 'middle' }));
  wrap.appendChild(svg);
}

/** Dispatch to the form's renderer. */
function qtiRenderChart(
  root: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): HTMLElement {
  const wrap = qtiCreate('div', 'qti-chart');
  if (!chart || !chart.form) {
    wrap.appendChild(qtiNoData());
    return wrap;
  }
  if (chart.form === 'bar') qtiBar(root, wrap, data, chart);
  else if (chart.form === 'line') qtiLine(root, wrap, data, chart);
  else if (chart.form === 'scatter') qtiScatter(root, wrap, data, chart);
  else if (chart.form === 'heatmap') qtiHeatmap(root, wrap, data, chart);
  else if (chart.form === 'metric-cards')
    qtiMetricCards(root, wrap, data, chart);
  else if (chart.form === 'table') qtiTableChart(root, wrap, data, chart);
  else if (chart.form === 'donut') qtiDonut(root, wrap, data, chart);
  else wrap.appendChild(qtiNoData());
  return wrap;
}

/** The collapsible detail table under the chart. */
function qtiRenderTable(
  root: HTMLElement,
  data: VisualDataRecord[],
  spec: VisualTableSpec,
): HTMLElement {
  const details = qtiCreate('details', 'qti-detail');
  const record = selectRecord(data, spec.select);
  const rows = record && record.rows ? record.rows : [];
  const columns =
    spec.columns && spec.columns.length
      ? spec.columns
      : record && record.columns && record.columns.length
        ? record.columns
        : Object.keys(rows[0] || {});
  const summary = qtiCreate(
    'summary',
    undefined,
    rows.length
      ? 'Detail — ' + rows.length + (rows.length === 1 ? ' row' : ' rows')
      : 'Detail',
  );
  details.appendChild(summary);
  if (spec.collapsed === false) details.setAttribute('open', 'open');
  if (!rows.length || !columns.length) details.appendChild(qtiNoData());
  else {
    details.appendChild(
      qtiDataTable(root, rows, columns, columns[0], 'detail'),
    );
  }
  return details;
}

/** Runtime-owned styles, injected once. */
function qtiEnsureStyle(): void {
  if (document.getElementById('qti-chart-style')) return;
  const style = document.createElement('style');
  style.id = 'qti-chart-style';
  style.textContent = [
    '#qti-chart-root { position: relative; }',
    '.qti-chart { position: relative; width: 100%; }',
    '.qti-chart svg { display: block; width: 100%; height: auto; overflow: visible; }',
    '.qti-chart [data-qti-value] { cursor: pointer; }',
    '.qti-chart [data-qti-value]:hover { filter: brightness(1.15); }',
    '.qti-legend { display: flex; flex-wrap: wrap; gap: 4px 10px; margin: 0 0 10px; }',
    '.qti-legend-item { display: inline-flex; align-items: center; gap: 6px; padding: 2px 6px;',
    '  border: 0; border-radius: 6px; background: transparent; color: #a1a1aa;',
    '  font: inherit; font-size: 12px; cursor: pointer; }',
    '.qti-legend-item[aria-pressed="false"] { opacity: .45; text-decoration: line-through; }',
    '.qti-legend-swatch { width: 10px; height: 10px; border-radius: 3px; }',
    '.qti-detail { margin-top: 16px; }',
    '.qti-detail summary { cursor: pointer; font-size: 12px; color: #a1a1aa; }',
    '.qti-sortable th { cursor: pointer; user-select: none; white-space: nowrap; }',
    '.qti-tooltip { display: none; white-space: nowrap; }',
    '@media (prefers-reduced-motion: reduce) {',
    '  .qti-chart *, .qti-kpi { animation: none !important; transition: none !important; } }',
  ].join('\n');
  document.head.appendChild(style);
}

/** Clear the root and rebuild every component from the current data. */
function qtiRender(): void {
  const root = document.getElementById('qti-chart-root');
  if (!root) return;
  const spec = qtiState.spec;
  while (root.firstChild) root.removeChild(root.firstChild);
  if (!spec || !spec.chart) {
    root.appendChild(
      qtiCreate(
        'p',
        'qti-error',
        'This visual could not be rendered: its specification is missing or unreadable.',
      ),
    );
    return;
  }
  qtiEnsureStyle();
  root.style.position = 'relative';
  const bridge = window.qti;
  const data: VisualDataRecord[] =
    bridge && Array.isArray(bridge.data) ? bridge.data : [];
  if (spec.kpis && spec.kpis.length) {
    root.appendChild(qtiRenderKpis(root, data, spec.kpis));
  }
  root.appendChild(qtiRenderChart(root, data, spec.chart));
  if (spec.table) root.appendChild(qtiRenderTable(root, data, spec.table));
  root.appendChild(qtiCreate('div', 'qti-tooltip'));
}

/** Read the spec, draw it, and re-draw whenever the frame swaps the data. */
function qtiMount(): void {
  const root = document.getElementById('qti-chart-root');
  if (!root) return;
  const element = document.getElementById('qti-spec');
  let parsed: unknown = null;
  if (element) {
    try {
      parsed = JSON.parse(element.textContent || '');
    } catch {
      parsed = null;
    }
  }
  const spec =
    parsed && typeof parsed === 'object' ? (parsed as VisualSpec) : null;
  qtiState.spec = spec && spec.chart ? spec : null;
  qtiState.hidden = {};
  qtiState.sort = {};
  qtiRender();
  const bridge = window.qti;
  if (bridge && typeof bridge.onRefresh === 'function') {
    bridge.onRefresh(function () {
      qtiRender();
    });
  }
}

/* ------------------------------------------------------------------ *
 * Script assembly
 * ------------------------------------------------------------------ */

/**
 * Everything embedded into the browser script, in a readable order. Function
 * declarations hoist, so the order here is cosmetic — but every function the
 * runtime calls must appear, or the browser gets a `ReferenceError`.
 */
const RUNTIME_MEMBERS: { toString(): string }[] = [
  toNumber,
  selectRecord,
  aggregate,
  compactNumber,
  formatValue,
  coerceRows,
  topNCut,
  ticks,
  scaleTicks,
  compareValues,
  chartMeasures,
  chartSelect,
  groupRows,
  spreadOverlaps,
  qtiCreate,
  qtiSvg,
  qtiText,
  qtiNoData,
  qtiSeriesColor,
  qtiTruncate,
  qtiString,
  qtiMark,
  qtiBindTooltip,
  qtiLegend,
  qtiAxes,
  qtiCanvas,
  qtiAriaLabel,
  qtiSortCategories,
  qtiApplyTopN,
  qtiTile,
  qtiRenderKpis,
  qtiBar,
  qtiLine,
  qtiScatter,
  qtiHeatmap,
  qtiMetricCards,
  qtiDataTable,
  qtiTableChart,
  qtiDonut,
  qtiRenderChart,
  qtiRenderTable,
  qtiEnsureStyle,
  qtiRender,
  qtiMount,
];

/** Filename the stored document loads the runtime from (CSP: script-src 'self'). */
export const VISUAL_RUNTIME_FILENAME = 'qti-chart.js';

/**
 * The browser runtime, as source. Deliberately does *not* auto-mount: the
 * document's bootstrap script calls `window.qtiChart.mount()` once the spec
 * and the frame bridge are both in place.
 */
export const VISUAL_RUNTIME_SCRIPT: string = [
  '(function () {',
  '  "use strict";',
  '  var qtiState = { spec: null, hidden: {}, sort: {} };',
  RUNTIME_MEMBERS.map((member) => member.toString()).join('\n\n'),
  '  window.qtiChart = { mount: qtiMount };',
  '})();',
]
  .join('\n')
  // Safe to inline in a <script> block as well as to serve as a file.
  .replace(/<\/script/gi, '<\\/script');
