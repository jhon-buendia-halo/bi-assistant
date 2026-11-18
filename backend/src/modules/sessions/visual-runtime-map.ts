import type { VisualChartSpec, VisualDataRecord } from './visual-runtime';

/**
 * The `us-map` chart form: United States states as a tile grid, one square per
 * state shaded by a measure.
 *
 * A tile grid, not a geographic outline: the visual frame is sandboxed with no
 * network, so no map tiles or boundary file can be fetched, and equal squares
 * keep small states (DC, RI, DE) as readable as Texas.
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
declare function chartMeasures(chart: VisualChartSpec): string[];
declare function chartSelect(chart: VisualChartSpec): string[];
declare function qtiCreate(
  tag: string,
  className?: string,
  text?: string,
): HTMLElement;
declare function qtiSvg(
  tag: string,
  attrs?: Record<string, string | number>,
): SVGElement;
declare function qtiText(
  x: number,
  y: number,
  text: string,
  attrs?: Record<string, string | number>,
): SVGElement;
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
declare function qtiCanvas(
  width: number,
  height: number,
  label: string,
): SVGElement;
declare function qtiAriaLabel(chart: VisualChartSpec): string;
/* eslint-enable @typescript-eslint/no-unused-vars */

/** One state's square: its postal code, its name and its cell in the grid. */
export interface UsStateTile {
  code: string;
  name: string;
  /** Column, 0 to 11, west to east. */
  col: number;
  /** Row, 0 to 7, north to south. */
  row: number;
}

/**
 * The 50 states, the District of Columbia and Puerto Rico on a 12 by 8 grid,
 * each roughly where it sits on a map. A function, not a constant, so the
 * browser script carries the table.
 */
export function usStateTiles(): UsStateTile[] {
  const cells: [string, string, number, number][] = [
    ['AK', 'Alaska', 0, 0],
    ['ME', 'Maine', 11, 0],
    ['WI', 'Wisconsin', 5, 1],
    ['VT', 'Vermont', 10, 1],
    ['NH', 'New Hampshire', 11, 1],
    ['WA', 'Washington', 0, 2],
    ['ID', 'Idaho', 1, 2],
    ['MT', 'Montana', 2, 2],
    ['ND', 'North Dakota', 3, 2],
    ['MN', 'Minnesota', 4, 2],
    ['IL', 'Illinois', 5, 2],
    ['MI', 'Michigan', 6, 2],
    ['NY', 'New York', 9, 2],
    ['MA', 'Massachusetts', 10, 2],
    ['OR', 'Oregon', 0, 3],
    ['NV', 'Nevada', 1, 3],
    ['WY', 'Wyoming', 2, 3],
    ['SD', 'South Dakota', 3, 3],
    ['IA', 'Iowa', 4, 3],
    ['IN', 'Indiana', 5, 3],
    ['OH', 'Ohio', 6, 3],
    ['PA', 'Pennsylvania', 7, 3],
    ['NJ', 'New Jersey', 8, 3],
    ['CT', 'Connecticut', 9, 3],
    ['RI', 'Rhode Island', 10, 3],
    ['CA', 'California', 0, 4],
    ['UT', 'Utah', 1, 4],
    ['CO', 'Colorado', 2, 4],
    ['NE', 'Nebraska', 3, 4],
    ['MO', 'Missouri', 4, 4],
    ['KY', 'Kentucky', 5, 4],
    ['WV', 'West Virginia', 6, 4],
    ['VA', 'Virginia', 7, 4],
    ['MD', 'Maryland', 8, 4],
    ['DE', 'Delaware', 9, 4],
    ['AZ', 'Arizona', 1, 5],
    ['NM', 'New Mexico', 2, 5],
    ['KS', 'Kansas', 3, 5],
    ['AR', 'Arkansas', 4, 5],
    ['TN', 'Tennessee', 5, 5],
    ['NC', 'North Carolina', 6, 5],
    ['SC', 'South Carolina', 7, 5],
    ['DC', 'District of Columbia', 8, 5],
    ['OK', 'Oklahoma', 3, 6],
    ['LA', 'Louisiana', 4, 6],
    ['MS', 'Mississippi', 5, 6],
    ['AL', 'Alabama', 6, 6],
    ['GA', 'Georgia', 7, 6],
    ['HI', 'Hawaii', 0, 7],
    ['TX', 'Texas', 3, 7],
    ['FL', 'Florida', 8, 7],
    ['PR', 'Puerto Rico', 10, 7],
  ];
  return cells.map(function (cell) {
    return { code: cell[0], name: cell[1], col: cell[2], row: cell[3] };
  });
}

/**
 * The postal code a value names, or `null` when it names no tile: a two-letter
 * code in any case (`fl`, ` FL `) or a full name (`Florida`, `district of
 * columbia`, `Washington DC`, `Washington, D.C.`).
 */
export function usStateCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = (
    typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  ).trim();
  if (!text) return null;
  const tiles = usStateTiles();
  const upper = text.toUpperCase();
  if (upper.length === 2) {
    for (const tile of tiles) if (tile.code === upper) return tile.code;
    return null;
  }
  const plain = upper.replace(/[.,]/g, '').replace(/\s+/g, ' ');
  if (plain === 'WASHINGTON DC' || plain === 'DC') return 'DC';
  for (const tile of tiles) {
    if (tile.name.toUpperCase() === plain) return tile.code;
  }
  return null;
}

/** One state's summed value and the first spelling the data used for it. */
export interface UsMapState {
  value: number;
  raw: unknown;
}

/** The rows folded onto tiles. */
export interface UsMapFold {
  byCode: Record<string, UsMapState>;
  /** Rows whose x names no tile, summed by name, in first-seen order. */
  unmatched: { name: string; value: number }[];
  min: number | null;
  max: number | null;
}

/**
 * Fold rows onto the tiles: several rows of one state are summed (whatever
 * their spelling), rows naming no tile are kept aside, rows without a number
 * are dropped. `min` and `max` span the states that have a value.
 */
export function usMapFold(
  rows: Record<string, unknown>[],
  x: string,
  y: string,
): UsMapFold {
  const byCode: Record<string, UsMapState> = {};
  const unmatched: { name: string; value: number }[] = [];
  for (const row of rows) {
    const value = toNumber(row[y]);
    if (!Number.isFinite(value)) continue;
    const raw = row[x];
    const code = usStateCode(raw);
    if (code) {
      if (byCode[code]) byCode[code].value += value;
      else byCode[code] = { value: value, raw: raw };
      continue;
    }
    const name =
      (typeof raw === 'string' || typeof raw === 'number'
        ? String(raw).trim()
        : '') || '(blank)';
    let found: { name: string; value: number } | null = null;
    for (const item of unmatched) if (item.name === name) found = item;
    if (found) found.value += value;
    else unmatched.push({ name: name, value: value });
  }
  let min: number | null = null;
  let max: number | null = null;
  for (const code in byCode) {
    if (!Object.prototype.hasOwnProperty.call(byCode, code)) continue;
    const value = byCode[code].value;
    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
  }
  return { byCode: byCode, unmatched: unmatched, min: min, max: max };
}

/**
 * The shading step, 0 (smallest) to 4 (largest), of a value: five equal bands
 * between `min` and `max`. When every value is equal, all take the top step.
 */
export function usMapStep(value: number, min: number, max: number): number {
  if (!(max > min)) return 4;
  const step = Math.floor(((value - min) / (max - min)) * 5);
  return Math.max(0, Math.min(4, step));
}

/**
 * The fill of a step, from the frame's tokens only. The first three steps
 * tint the series colour over the page, with the strong text colour on top.
 * The last two deepen the series colour with the strong text colour so the
 * on-colour label keeps 4.5:1 in the Light theme (where it is white) and in the
 * Dark theme (where it is near-black on a lighter tile).
 */
function usMapFill(step: number): string {
  const tint = [15, 32, 50];
  if (step < 3) {
    return (
      'color-mix(in srgb, var(--qti-cat-1) ' + tint[step] + '%, var(--qti-bg))'
    );
  }
  const keep = step === 3 ? 85 : 70;
  return (
    'color-mix(in srgb, var(--qti-cat-1) ' + keep + '%, var(--qti-fg-strong))'
  );
}

/** The label colour that reads on a step's fill. */
function usMapLabelColor(step: number): string {
  return step < 3 ? 'var(--qti-fg-strong)' : 'var(--qti-on-cat)';
}

/** Add the legend and layout styles once per page. */
function usMapStyle(): void {
  if (document.getElementById('qti-usmap-style')) return;
  const style = document.createElement('style');
  style.id = 'qti-usmap-style';
  style.textContent = [
    '.qti-usmap { width: 100%; }',
    '.qti-usmap svg { display: block; max-width: 100%; }',
    '.qti-usmap-empty rect { fill: none; stroke: var(--qti-border); }',
    '.qti-usmap-legend { display: flex; align-items: center; gap: 8px;',
    '  margin: 8px 0 0; font-size: 12px; color: var(--qti-fg-muted); }',
    '.qti-usmap-ramp { display: flex; gap: 2px; }',
    '.qti-usmap-swatch { width: 22px; height: 10px; border-radius: 2px; }',
    '.qti-usmap-unmatched { margin: 6px 0 0; font-size: 12px;',
    '  color: var(--qti-fg-muted); }',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Draw the tile map into `wrap`: `chart.x` names the state column (codes or
 * names), the first measure of `chart.y` shades each square.
 */
export function qtiUsMap(
  root: HTMLElement,
  wrap: HTMLElement,
  data: VisualDataRecord[],
  chart: VisualChartSpec,
): void {
  const x = chart.x || '';
  const y = chartMeasures(chart)[0] || '';
  const record = selectRecord(data, chartSelect(chart));
  const source = record && record.rows ? record.rows : [];
  const folded = usMapFold(source, x, y);
  if (!x || !y || folded.min === null || folded.max === null) {
    wrap.appendChild(qtiNoData());
    return;
  }
  const min = folded.min;
  const max = folded.max;
  const format = chart.format ? chart.format.y : undefined;
  const measureLabel = chart.yLabel || y;
  usMapStyle();
  // Tiles are sized from the viewBox, so the map scales with its panel.
  const cell = 64;
  const gap = 4;
  const svg = qtiCanvas(12 * cell, 8 * cell, qtiAriaLabel(chart));
  for (const tile of usStateTiles()) {
    const left = tile.col * cell + gap / 2;
    const top = tile.row * cell + gap / 2;
    const size = cell - gap;
    const state = folded.byCode[tile.code];
    const group = qtiSvg('g', { 'data-qti-state': tile.code });
    const rect = qtiSvg('rect', {
      x: left,
      y: top,
      width: size,
      height: size,
      rx: 5,
    });
    let labelColor = 'var(--qti-fg-muted)';
    if (state) {
      const step = usMapStep(state.value, min, max);
      rect.setAttribute('fill', usMapFill(step));
      labelColor = usMapLabelColor(step);
      const shown = formatValue(state.value, format);
      group.setAttribute('aria-label', tile.name + ': ' + shown);
      qtiMark(group, state.raw, x);
      qtiBindTooltip(root, group, [tile.name, measureLabel + ': ' + shown]);
    } else {
      group.setAttribute('class', 'qti-usmap-empty');
      rect.setAttribute('fill', 'none');
      rect.setAttribute('stroke', 'var(--qti-border)');
      rect.setAttribute('stroke-width', '1.5');
    }
    group.appendChild(rect);
    group.appendChild(
      qtiText(left + size / 2, top + size / 2 + 8, tile.code, {
        'text-anchor': 'middle',
        'font-size': 24,
        'font-weight': 600,
        fill: labelColor,
        'pointer-events': 'none',
      }),
    );
    svg.appendChild(group);
  }
  const map = qtiCreate('div', 'qti-usmap');
  map.appendChild(svg);

  const legend = qtiCreate('div', 'qti-usmap-legend');
  legend.appendChild(qtiCreate('span', undefined, formatValue(min, format)));
  const ramp = qtiCreate('div', 'qti-usmap-ramp');
  for (let step = 0; step < 5; step++) {
    const swatch = qtiCreate('span', 'qti-usmap-swatch');
    swatch.style.background = usMapFill(step);
    ramp.appendChild(swatch);
  }
  legend.appendChild(ramp);
  legend.appendChild(qtiCreate('span', undefined, formatValue(max, format)));
  map.appendChild(legend);

  if (folded.unmatched.length) {
    const parts: string[] = [];
    for (let i = 0; i < folded.unmatched.length && i < 5; i++) {
      const item = folded.unmatched[i];
      parts.push(item.name + ' (' + formatValue(item.value, format) + ')');
    }
    let text = 'Not on the map: ' + parts.join(', ');
    if (folded.unmatched.length > 5) {
      text += ', and ' + (folded.unmatched.length - 5) + ' more';
    }
    map.appendChild(qtiCreate('p', 'qti-usmap-unmatched', text));
  }
  wrap.appendChild(map);
}

/** What `visual-runtime.ts` embeds from this file, in a readable order. */
export const US_MAP_RUNTIME_MEMBERS: { toString(): string }[] = [
  usStateTiles,
  usStateCode,
  usMapFold,
  usMapStep,
  usMapFill,
  usMapLabelColor,
  usMapStyle,
  qtiUsMap,
];
