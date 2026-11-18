import type { VisualChartSpec, VisualDataRecord } from './visual-runtime';

/**
 * The `pivot` chart form: a crosstab of exact numbers, one row per value of
 * `chart.x`, with a Total row.
 *
 * Two data shapes give the same table:
 *  - long: `chart.series` names the column whose values become the table's
 *    columns and `chart.y` is one measure (rows of `age_band, plan_type, n`);
 *  - wide: no `series`, and `chart.y` lists the measures that are the table's
 *    columns already (rows of `age_band, hsa, ppo, na`).
 *
 * Same rules as `visual-runtime.ts`: every function here is embedded into the
 * browser script through `toString()`, so a function may only call other
 * embedded functions, never a module constant or an import. The shared helpers
 * of `visual-runtime.ts` are reached through the ambient declarations below;
 * importing them would compile to a module-qualified call the browser cannot
 * resolve.
 */

/* eslint-disable @typescript-eslint/no-unused-vars -- ambient signatures of the helpers embedded from visual-runtime.ts */
declare function toNumber(value: unknown): number;
declare function selectRecord(
  data: VisualDataRecord[] | undefined,
  select: string[] | undefined,
): VisualDataRecord | null;
declare function formatValue(
  value: number | null | undefined,
  format?: 'number' | 'compact' | 'percent' | 'currency',
  unit?: string,
): string;
declare function compareValues(a: string, b: string): number;
declare function chartMeasures(chart: VisualChartSpec): string[];
declare function chartSelect(chart: VisualChartSpec): string[];
declare function qtiCreate(
  tag: string,
  className?: string,
  text?: string,
): HTMLElement;
declare function qtiNoData(): HTMLElement;
declare function qtiString(value: unknown): string;
declare function qtiMark(
  node: SVGElement | HTMLElement,
  value: unknown,
  column?: string,
  label?: string,
): void;
declare function qtiBindTooltip(
  root: HTMLElement,
  node: SVGElement | HTMLElement,
  lines: string[],
): void;
declare function qtiAriaLabel(chart: VisualChartSpec): string;
/* eslint-enable @typescript-eslint/no-unused-vars */

/** The crosstab as plain numbers, before any markup. */
export interface PivotModel {
  rowLabels: string[];
  columnLabels: string[];
  /** `cells[row][column]`: the summed value, or `null` when the pair has none. */
  cells: (number | null)[][];
  rowTotals: number[];
  columnTotals: number[];
  grandTotal: number;
  /** A Total row is drawn. */
  totalRow: boolean;
  /** A Total column is drawn (long shape only). */
  rowTotalColumn: boolean;
  /** The last row is the folded "Other" row. */
  otherRow: boolean;
}

/**
 * Turn rows into the crosstab. Rows and columns keep the order of first
 * appearance; `chart.sort` reorders rows only; `chart.topN` folds the smallest
 * rows into "Other"; a long shape with more than 12 series values folds the
 * smallest columns into "Other". A cell that is not a finite number counts as
 * nothing.
 */
export function qtiPivotModel(
  rows: Record<string, unknown>[],
  chart: VisualChartSpec,
): PivotModel {
  const maxColumns = 12;
  const x = chart.x || '';
  const measures: string[] = Array.isArray(chart.y)
    ? chart.y.filter((name) => !!name)
    : chart.y
      ? [chart.y]
      : [];
  const seriesColumn = chart.series || '';
  const isLong = !!seriesColumn;
  const text = (value: unknown): string =>
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : typeof value === 'number' ||
            typeof value === 'bigint' ||
            typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);

  let rowLabels: string[] = [];
  let columnLabels: string[] = [];
  const rowIndex = new Map<string, number>();
  const columnIndex = new Map<string, number>();
  // cells[row][column], grown as new labels appear
  let cells: (number | null)[][] = [];

  const add = (row: string, column: string, raw: unknown): void => {
    if (!rowIndex.has(row)) {
      rowIndex.set(row, rowLabels.length);
      rowLabels.push(row);
      cells.push([]);
    }
    if (!columnIndex.has(column)) {
      columnIndex.set(column, columnLabels.length);
      columnLabels.push(column);
    }
    const r = rowIndex.get(row) as number;
    const c = columnIndex.get(column) as number;
    const value = toNumber(raw);
    const line = cells[r];
    while (line.length < columnLabels.length) line.push(null);
    if (!Number.isFinite(value)) return;
    const current = line[c];
    line[c] = (current === null || current === undefined ? 0 : current) + value;
  };

  for (const row of rows || []) {
    const label = text(row[x]);
    if (isLong) {
      if (!measures.length) continue;
      add(label, text(row[seriesColumn]), row[measures[0]]);
    } else {
      for (const measure of measures) add(label, measure, row[measure]);
    }
  }
  for (const line of cells) {
    while (line.length < columnLabels.length) line.push(null);
  }

  const sum = (line: (number | null)[]): number => {
    let total = 0;
    for (const value of line) total += value === null ? 0 : value;
    return total;
  };

  // fold the smallest columns of a wide-ranging long shape into "Other"
  if (isLong && columnLabels.length > maxColumns) {
    const totals = columnLabels.map((_, c) =>
      cells.reduce((total, line) => total + (line[c] || 0), 0),
    );
    const ranked = totals
      .map((total, c) => ({ total, c }))
      .sort((a, b) => b.total - a.total || a.c - b.c)
      .slice(0, maxColumns)
      .map((entry) => entry.c)
      .sort((a, b) => a - b);
    const kept = new Set(ranked);
    columnLabels = ranked.map((c) => columnLabels[c]).concat(['Other']);
    cells = cells.map((line) => {
      let other: number | null = null;
      line.forEach((value, c) => {
        if (!kept.has(c) && value !== null) other = (other || 0) + value;
      });
      return ranked.map((c) => line[c]).concat([other]);
    });
  }

  // keep the top N rows in their order, fold the rest into "Other"
  let otherRow = false;
  const topN = chart.topN && chart.topN > 0 ? Math.floor(chart.topN) : 0;
  if (topN && rowLabels.length > topN) {
    const ranked = cells
      .map((line, r) => ({ total: sum(line), r }))
      .sort((a, b) => b.total - a.total || a.r - b.r)
      .slice(0, topN)
      .map((entry) => entry.r)
      .sort((a, b) => a - b);
    const kept = new Set(ranked);
    const other: (number | null)[] = columnLabels.map(() => null);
    cells.forEach((line, r) => {
      if (kept.has(r)) return;
      line.forEach((value, c) => {
        if (value !== null) other[c] = (other[c] || 0) + value;
      });
    });
    rowLabels = ranked.map((r) => rowLabels[r]);
    cells = ranked.map((r) => cells[r]);
    otherRow = true;
    rowLabels.push('Other');
    cells.push(other);
  }

  // sort the rows, leaving a folded "Other" row last
  const sort = chart.sort;
  if (sort && (sort.by === 'x' || sort.by === 'y')) {
    const sortable = rowLabels.length - (otherRow ? 1 : 0);
    const order = rowLabels
      .slice(0, sortable)
      .map((label, r) => ({ label, total: sum(cells[r]), r }));
    const direction =
      (sort.dir || (sort.by === 'y' ? 'desc' : 'asc')) === 'desc' ? -1 : 1;
    order.sort((a, b) => {
      const diff =
        sort.by === 'x' ? compareValues(a.label, b.label) : a.total - b.total;
      return diff * direction || a.r - b.r;
    });
    const tail = otherRow ? [sortable] : [];
    const indexes = order.map((entry) => entry.r).concat(tail);
    rowLabels = indexes.map((r) => rowLabels[r]);
    cells = indexes.map((r) => cells[r]);
  }

  const rowTotals = cells.map((line) => sum(line));
  const columnTotals = columnLabels.map((_, c) =>
    cells.reduce((total, line) => total + (line[c] || 0), 0),
  );
  const totalsOn = chart.totals !== false;
  return {
    rowLabels,
    columnLabels,
    cells,
    rowTotals,
    columnTotals,
    grandTotal: rowTotals.reduce((total, value) => total + value, 0),
    totalRow: totalsOn,
    rowTotalColumn: totalsOn && isLong,
    otherRow,
  };
}

/** Add the pivot's own table styles once, from the frame's colour tokens. */
export function qtiPivotStyle(): void {
  if (document.getElementById('qti-pivot-style')) return;
  const style = document.createElement('style');
  style.id = 'qti-pivot-style';
  style.textContent =
    '.qti-pivot-wrap { overflow-x: auto; max-width: 100%; }' +
    '.qti-pivot { width: 100%; border-collapse: collapse; font-size: 12.5px;' +
    ' font-variant-numeric: tabular-nums; }' +
    '.qti-pivot caption { position: absolute; width: 1px; height: 1px;' +
    ' overflow: hidden; clip: rect(0 0 0 0); }' +
    '.qti-pivot th, .qti-pivot td { padding: .4em .7em; white-space: nowrap;' +
    ' border-bottom: 1px solid var(--qti-border); }' +
    '.qti-pivot thead th { background: var(--qti-surface);' +
    ' color: var(--qti-fg-strong); font-weight: 600; text-align: right; }' +
    '.qti-pivot thead th:first-child, .qti-pivot tbody th { text-align: left; }' +
    '.qti-pivot tbody th { font-weight: 500; color: var(--qti-fg); }' +
    '.qti-pivot td { text-align: right; color: var(--qti-fg); }' +
    '.qti-pivot .qti-pivot-total { font-weight: 700;' +
    ' color: var(--qti-fg-strong); }' +
    '.qti-pivot tr.qti-pivot-total th, .qti-pivot tr.qti-pivot-total td {' +
    ' border-top: 2px solid var(--qti-border); background: var(--qti-surface); }';
  document.head.appendChild(style);
}

/**
 * A column name as a heading: `age_band` reads "Age band". Used where the
 * heading is a column's name (the corner, and the measures of the wide
 * shape), never for a heading that is a value of the data.
 */
export function qtiPivotHeading(name: string): string {
  const words = String(name).replace(/_+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/** Draw the crosstab into `wrap`. */
export function qtiPivot(
  root: HTMLElement,
  wrap: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): void {
  const record = selectRecord(data, chartSelect(chart));
  const rows = record && record.rows ? record.rows : [];
  const model = qtiPivotModel(rows, chart);
  if (!chart.x || !model.rowLabels.length || !model.columnLabels.length) {
    wrap.appendChild(qtiNoData());
    return;
  }
  qtiPivotStyle();
  const format = chart.format ? chart.format.y : undefined;
  const show = (value: number | null): string =>
    value === null || !Number.isFinite(value)
      ? '—'
      : formatValue(value, format);

  const scroller = qtiCreate('div', 'qti-pivot-wrap');
  const table = qtiCreate('table', 'qti-table qti-pivot');
  const label = qtiAriaLabel(chart);
  table.setAttribute('aria-label', label);
  table.appendChild(qtiCreate('caption', '', label));

  const head = qtiCreate('thead');
  const headRow = qtiCreate('tr');
  const corner = qtiCreate('th', '', chart.xLabel || qtiPivotHeading(chart.x));
  corner.setAttribute('scope', 'col');
  headRow.appendChild(corner);
  // Long shape: the columns are values of the data, shown as they are.
  // Wide shape: they are measure names.
  const headers = chart.series
    ? model.columnLabels.slice()
    : model.columnLabels.map(qtiPivotHeading);
  if (model.rowTotalColumn) headers.push('Total');
  headers.forEach((name, index) => {
    const th = qtiCreate(
      'th',
      model.rowTotalColumn && index === headers.length - 1
        ? 'qti-pivot-total'
        : '',
      name,
    );
    th.setAttribute('scope', 'col');
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  table.appendChild(head);

  const body = qtiCreate('tbody');
  model.rowLabels.forEach((rowLabel, r) => {
    const tr = qtiCreate('tr');
    const th = qtiCreate('th', '', rowLabel);
    th.setAttribute('scope', 'row');
    tr.appendChild(th);
    const folded = model.otherRow && r === model.rowLabels.length - 1;
    model.cells[r].forEach((value) => {
      const td = qtiCreate('td', '', show(value));
      if (!folded) qtiMark(td, rowLabel, chart.x);
      tr.appendChild(td);
    });
    if (model.rowTotalColumn) {
      tr.appendChild(
        qtiCreate('td', 'qti-pivot-total', show(model.rowTotals[r])),
      );
    }
    body.appendChild(tr);
  });
  if (model.totalRow) {
    const tr = qtiCreate('tr', 'qti-pivot-total');
    const th = qtiCreate('th', '', 'Total');
    th.setAttribute('scope', 'row');
    tr.appendChild(th);
    model.columnTotals.forEach((value) => {
      tr.appendChild(qtiCreate('td', '', show(value)));
    });
    if (model.rowTotalColumn) {
      tr.appendChild(
        qtiCreate('td', 'qti-pivot-total', show(model.grandTotal)),
      );
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  scroller.appendChild(table);
  wrap.appendChild(scroller);
}

/** What `visual-runtime.ts` embeds from this file, in a readable order. */
export const PIVOT_RUNTIME_MEMBERS: { toString(): string }[] = [
  qtiPivotModel,
  qtiPivotStyle,
  qtiPivotHeading,
  qtiPivot,
];
