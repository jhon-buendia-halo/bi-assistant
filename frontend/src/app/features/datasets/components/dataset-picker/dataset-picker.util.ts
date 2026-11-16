import { kindLabel } from '../../../datasources/models/datasource.model';
import { Dataset } from '../../services/datasets-api.service';

/** At or below this many choices the picker offers them as one-click chips and skips groups. */
export const QUICK_PICK_MAX = 6;
/** How many recently updated datasets head the list when there are more than QUICK_PICK_MAX. */
export const RECENT_COUNT = 3;
/** The most options a search renders at once; typing more narrows the rest. */
export const OPTION_LIMIT = 100;
/** Without a search, the most options each datasource group renders, so every group shows. */
export const GROUP_LIMIT = 20;

/** A piece of a label: `match` marks the part equal to the search. */
export interface TextPart {
  text: string;
  match: boolean;
}

export interface PickerOption {
  name: string;
  entities: number;
  selected: boolean;
  /** The name split around the search match. */
  label: TextPart[];
  /** The datasource line, or the matching table when it matched by table. */
  detail: TextPart[] | null;
  /** True when the option matched by one of its tables, not by its name. */
  byTable: boolean;
}

export interface PickerSection {
  id: string;
  title: string | null;
  options: PickerOption[];
  /** How many of the group's datasets are not rendered (found through the search). */
  hidden: number;
}

export interface PickerView {
  sections: PickerSection[];
  /** The options in display order (keyboard navigation walks this). */
  flat: PickerOption[];
  /** How many datasets a search matches before OPTION_LIMIT; without a search, the rendered count. */
  matches: number;
}

/** Splits `text` around the first case-insensitive occurrence of `query`. */
export function highlight(text: string, query: string): TextPart[] {
  const q = query.trim().toLowerCase();
  const at = q === '' ? -1 : text.toLowerCase().indexOf(q);
  if (at < 0) return [{ text, match: false }];
  const parts: TextPart[] = [];
  if (at > 0) parts.push({ text: text.slice(0, at), match: false });
  parts.push({ text: text.slice(at, at + q.length), match: true });
  if (at + q.length < text.length) parts.push({ text: text.slice(at + q.length), match: false });
  return parts;
}

/** `PostgreSQL · World Cup PostgreSQL`, or the kind alone without a known datasource. */
export function sourceLabel(dataset: Dataset, datasourceNames: ReadonlyMap<string, string>): string {
  const name = dataset.datasourceId ? datasourceNames.get(dataset.datasourceId) : undefined;
  const kind = dataset.datasourceKind ? kindLabel(dataset.datasourceKind) : null;
  if (kind && name) return `${kind} · ${name}`;
  return name ?? kind ?? 'Other datasets';
}

function byName(a: Dataset, b: Dataset): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

function updatedTime(d: Dataset): number {
  const t = d.updatedAt ? Date.parse(d.updatedAt) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * What the open list shows. With a search: datasets whose name matches, then those that
 * match only by a table name. Without one: with more than QUICK_PICK_MAX choices, the most
 * recently updated first, then the rest grouped by datasource (each group cut at
 * `groupLimit`, saying how many it hides); otherwise one flat list.
 */
export function buildPickerView(
  datasets: readonly Dataset[],
  selected: readonly string[],
  query: string,
  datasourceNames: ReadonlyMap<string, string>,
  limit = OPTION_LIMIT,
  groupLimit = GROUP_LIMIT,
): PickerView {
  const q = query.trim().toLowerCase();
  const picked = new Set(selected);
  let budget = limit;
  const take = (list: PickerOption[]): PickerOption[] => {
    const kept = list.slice(0, Math.max(0, budget));
    budget -= kept.length;
    return kept;
  };
  const option = (d: Dataset, detail: TextPart[] | null, byTable = false): PickerOption => ({
    name: d.name,
    entities: d.tables.length,
    selected: picked.has(d.name),
    label: highlight(d.name, byTable ? '' : q),
    detail,
    byTable,
  });

  const sections: PickerSection[] = [];
  let matches = 0;

  if (q !== '') {
    const sorted = [...datasets].sort(byName);
    const named = sorted.filter((d) => d.name.toLowerCase().includes(q));
    const tabled = sorted
      .filter((d) => !d.name.toLowerCase().includes(q))
      .map((d) => ({ d, table: d.tables.find((t) => t.toLowerCase().includes(q)) }))
      .filter((x): x is { d: Dataset; table: string } => x.table !== undefined);
    matches = named.length + tabled.length;
    const nameOptions = take(
      named.map((d) => option(d, [{ text: sourceLabel(d, datasourceNames), match: false }])),
    );
    const tableOptions = take(tabled.map(({ d, table }) => option(d, highlight(table, q), true)));
    if (nameOptions.length) {
      sections.push({ id: 'names', title: 'Name matches', options: nameOptions, hidden: 0 });
    }
    if (tableOptions.length) {
      sections.push({ id: 'tables', title: 'Table matches', options: tableOptions, hidden: 0 });
    }
  } else if (datasets.length <= QUICK_PICK_MAX) {
    const options = [...datasets].sort(byName).map((d) => option(d, null));
    sections.push({ id: 'all', title: null, options, hidden: 0 });
  } else {
    const recent = [...datasets]
      .filter((d) => updatedTime(d) > 0)
      .sort((a, b) => updatedTime(b) - updatedTime(a) || byName(a, b))
      .slice(0, RECENT_COUNT);
    const recentNames = new Set(recent.map((d) => d.name));
    if (recent.length) {
      sections.push({
        id: 'recent',
        title: 'Recent',
        options: recent.map((d) => option(d, null)),
        hidden: 0,
      });
    }
    const groups = new Map<string, Dataset[]>();
    for (const d of datasets) {
      if (recentNames.has(d.name)) continue;
      const key = sourceLabel(d, datasourceNames);
      const group = groups.get(key);
      if (group) group.push(d);
      else groups.set(key, [d]);
    }
    for (const key of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
      const members = groups.get(key)!.sort(byName);
      const options = members.slice(0, groupLimit).map((d) => option(d, null));
      sections.push({ id: `source:${key}`, title: key, options, hidden: members.length - options.length });
    }
  }

  const flat = sections.flatMap((s) => s.options);
  return { sections, flat, matches: q !== '' ? matches : flat.length };
}
