import { ToolDataRecord } from '../../features/sessions/models/session.model';
import { QueryEvidence } from './query-evidence.model';

/**
 * Links the figures of an answer to the queries whose rows hold them (plan
 * m1-25 section 3a). A pure function of the stored rows and the answer text,
 * so it works for every past answer and every agent.
 */

/** What one query's stored rows hold: numbers and ISO dates. */
export interface FigureIndexEntry {
  /** Index into the message's `data`. */
  query: number;
  numbers: number[];
  /** `YYYY-MM-DD` keys. */
  dates: Set<string>;
}

export type FigureIndex = FigureIndexEntry[];

/** One figure found in the text, with every query (Q order) whose rows hold it. */
export interface Figure {
  start: number;
  end: number;
  text: string;
  queries: number[];
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const GROUPED_NUMBER = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const ISO_CELL = /^(\d{4}-\d{2}-\d{2})(?:$|[T\s])/;

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];
const MONTH_NAME =
  '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

/**
 * Columns that identify or rank a row. Their values are not figures a reader
 * would look up, and a small rank matches too many numbers in a text.
 */
const IDENTIFIER_COLUMN = /^(id|.*_id|rnk|rank|rn|row_?num(ber)?)$/i;

/** Index every record that did not fail. */
export function figureIndex(
  data: readonly ToolDataRecord[] | undefined,
): FigureIndex {
  const index: FigureIndex = [];
  (data ?? []).forEach((record, query) => {
    if (record.error || !record.rows?.length) return;
    const numbers: number[] = [];
    const dates = new Set<string>();
    for (const row of record.rows) {
      for (const [column, cell] of Object.entries(row)) {
        if (IDENTIFIER_COLUMN.test(column)) continue;
        if (typeof cell === 'number') {
          if (Number.isFinite(cell)) numbers.push(cell);
        } else if (typeof cell === 'bigint') {
          numbers.push(Number(cell));
        } else if (typeof cell === 'string') {
          const text = cell.trim();
          const iso = ISO_CELL.exec(text);
          if (iso) {
            dates.add(iso[1]);
          } else if (PLAIN_NUMBER.test(text) || GROUPED_NUMBER.test(text)) {
            const value = Number(text.replace(/,/g, ''));
            if (Number.isFinite(value)) numbers.push(value);
          }
        }
      }
    }
    if (numbers.length || dates.size) index.push({ query, numbers, dates });
  });
  return index;
}

interface Span {
  start: number;
  end: number;
}

function dateKey(year: string, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthOf(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/** Dates read first, so their parts never match as numbers. */
function findDates(text: string): (Span & { key: string | null })[] {
  const found: (Span & { key: string | null })[] = [];
  const add = (m: RegExpMatchArray, key: string | null): void => {
    found.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, key });
  };
  for (const m of text.matchAll(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g)) {
    add(m, dateKey(m[1], Number(m[2]), Number(m[3])));
  }
  const dayFirst = new RegExp(
    `(?<![\\p{L}\\p{N}])(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAME}\\.?,?\\s+(\\d{4})(?![\\p{L}\\p{N}])`,
    'giu',
  );
  for (const m of text.matchAll(dayFirst)) {
    add(m, dateKey(m[3], monthOf(m[2]), Number(m[1])));
  }
  const monthFirst = new RegExp(
    `(?<![\\p{L}\\p{N}])${MONTH_NAME}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?![\\p{L}\\p{N}])`,
    'giu',
  );
  for (const m of text.matchAll(monthFirst)) {
    add(m, dateKey(m[3], monthOf(m[1]), Number(m[2])));
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof found = [];
  for (const d of found) {
    if (!kept.length || d.start >= kept[kept.length - 1].end) kept.push(d);
  }
  return kept;
}

const NUMBER_TOKEN =
  /(?<![\p{L}\p{N}_])([-−+]?)(\p{Sc}?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%|bn|[kKMB])?(?![\p{L}\p{N}_])/gu;

const SCALES: Record<string, number> = {
  k: 1e3,
  K: 1e3,
  M: 1e6,
  bn: 1e9,
  B: 1e9,
};

/** `|c/s - t| <= 0.5 * 10^-d` (a hair of slack for float noise). */
function matches(cell: number, shown: number, decimals: number, scale: number, percent: boolean): boolean {
  const tolerance = 0.5 * Math.pow(10, -decimals) + 1e-9 * Math.max(1, Math.abs(shown));
  if (Math.abs(cell / scale - shown) <= tolerance) return true;
  return percent && Math.abs((cell * 100) / scale - shown) <= tolerance;
}

/**
 * The whole numbers a question names ("the top 100", "in 2018"). An answer
 * that repeats one is echoing the question, not reporting a result, so it
 * gets no chip.
 */
export function questionNumbers(question: string | null | undefined): number[] {
  const numbers: number[] = [];
  for (const m of (question ?? '').matchAll(NUMBER_TOKEN)) {
    const [, , , whole, fraction, suffix] = m;
    if (fraction === undefined && !suffix) numbers.push(Number(whole.replace(/,/g, '')));
  }
  return numbers;
}

/**
 * Every figure of `text` that an indexed query holds. `asked` are the whole
 * numbers of the question (`questionNumbers`): a bare whole number equal to
 * one of them is skipped.
 */
export function findFigures(
  text: string,
  index: FigureIndex,
  asked: readonly number[] = [],
): Figure[] {
  if (!text || !index.length) return [];
  const figures: Figure[] = [];
  const dates = findDates(text);
  for (const date of dates) {
    if (date.key === null) continue;
    const queries = index
      .filter((entry) => entry.dates.has(date.key as string))
      .map((entry) => entry.query);
    if (queries.length) {
      figures.push({ start: date.start, end: date.end, text: text.slice(date.start, date.end), queries });
    }
  }
  for (const m of text.matchAll(NUMBER_TOKEN)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (dates.some((d) => start < d.end && end > d.start)) continue;
    const [, sign, currency, whole, fraction, suffix] = m;
    const bare = !currency && !suffix && fraction === undefined && !whole.includes(',');
    const magnitude = Number(whole.replace(/,/g, '') + (fraction !== undefined ? `.${fraction}` : ''));
    if (bare && magnitude < 10) continue;
    if (fraction === undefined && !suffix && !currency && asked.includes(magnitude)) continue;
    const shown = sign === '-' || sign === '−' ? -magnitude : magnitude;
    const decimals = fraction?.length ?? 0;
    const scale = suffix && suffix !== '%' ? SCALES[suffix] : 1;
    const percent = suffix === '%';
    const queries = index
      .filter((entry) =>
        entry.numbers.some((cell) => matches(cell, shown, decimals, scale, percent)),
      )
      .map((entry) => entry.query);
    if (queries.length) figures.push({ start, end, text: m[0], queries });
  }
  return figures.sort((a, b) => a.start - b.start);
}

const SKIPPED_ANCESTORS = 'code, pre, a, th, .figure-ref';

/**
 * Adds one chip after each figure of already-sanitized HTML. The chips are
 * built with DOM APIs (labels through `textContent`); nothing is assembled as
 * a string, and text inside `code`, `pre`, `a`, `th` and existing chips is
 * left alone. A figure several queries hold gets the chip of one of them: a
 * query that is not a sample first, then the query that holds the most
 * figures of this answer, then the earliest; the chip's title names the
 * others. `sampleQueries` are the queries whose result is only a sample: a
 * figure whose every match is one gets the warning tone. `asked` are the
 * question's own numbers, which get no chip.
 */
export function linkFigures(
  sanitizedHtml: string,
  index: FigureIndex,
  sampleQueries: ReadonlySet<number> = new Set(),
  asked: readonly number[] = [],
): string {
  if (!index.length) return sanitizedHtml;
  const template = document.createElement('template');
  template.innerHTML = sanitizedHtml;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent && parent.closest(SKIPPED_ANCESTORS)) continue;
    nodes.push(node as Text);
  }
  const found = nodes.map((node) => ({ node, figures: findFigures(node.data, index, asked) }));
  const held = new Map<number, number>();
  for (const { figures } of found) {
    for (const figure of figures) {
      for (const query of figure.queries) held.set(query, (held.get(query) ?? 0) + 1);
    }
  }
  const sourceOf = (queries: number[]): number =>
    [...queries].sort(
      (a, b) =>
        Number(sampleQueries.has(a)) - Number(sampleQueries.has(b)) ||
        (held.get(b) ?? 0) - (held.get(a) ?? 0) ||
        a - b,
    )[0];
  for (const { node, figures } of found) {
    if (!figures.length) continue;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const figure of figures) {
      fragment.append(document.createTextNode(node.data.slice(cursor, figure.end)));
      cursor = figure.end;
      const source = sourceOf(figure.queries);
      fragment.append(
        chip(
          source,
          figure.text,
          figure.queries.every((q) => sampleQueries.has(q)),
          figure.queries.filter((q) => q !== source),
        ),
      );
    }
    fragment.append(document.createTextNode(node.data.slice(cursor)));
    node.replaceWith(fragment);
  }
  return template.innerHTML;
}

function chip(
  query: number,
  figure: string,
  sample: boolean,
  others: number[],
): HTMLElement {
  const label = `Q${query + 1}`;
  const sup = document.createElement('sup');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = sample ? 'figure-ref figure-ref--sample' : 'figure-ref';
  button.setAttribute('data-query-index', String(query));
  button.setAttribute('data-testid', 'figure-ref');
  button.setAttribute('aria-label', `Open query ${label}, the source of ${figure}`);
  const also = others.length
    ? `Also in ${others.map((q) => `Q${q + 1}`).join(', ')}`
    : '';
  const title = [sample ? 'From a sample: not a reliable figure' : '', also]
    .filter((part) => part !== '')
    .join('. ');
  if (title) button.title = title;
  button.textContent = label;
  sup.append(button);
  return sup;
}

/** The queries whose result is only a sample, from the stored evidence. */
export function sampleQueriesOf(
  evidence: readonly QueryEvidence[] | undefined,
): Set<number> {
  return new Set(
    (evidence ?? []).filter((e) => e.coverage === 'sample').map((e) => e.index),
  );
}
