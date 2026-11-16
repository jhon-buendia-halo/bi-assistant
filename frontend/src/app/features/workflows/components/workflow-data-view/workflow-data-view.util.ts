/** Pure helpers of the workflow data view: the Table and Schema modes and the JSON tokens. */

export type DataMode = 'json' | 'table' | 'schema';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPlainObject);
}

export interface DataTable {
  columns: string[];
  rows: Record<string, unknown>[];
}

/**
 * The rows of a value the Table mode can show: an array of objects, or an
 * object holding such an array (the first one). Null for anything else.
 */
export function tableOf(value: unknown): DataTable | null {
  const rows = isRowArray(value)
    ? value
    : isPlainObject(value)
      ? Object.values(value).find(isRowArray)
      : undefined;
  if (!rows) return null;
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return { columns, rows };
}

/** A table cell as text: strings as they are, everything else as compact JSON. */
export function cellText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export interface SchemaNode {
  name: string;
  /** `string`, `number`, `boolean`, `null`, `object`, `object[]`, `string[]`, `array`. */
  type: string;
  children: SchemaNode[];
}

const SAMPLE = 20;

function typeOf(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}

function nodeOf(name: string, value: unknown): SchemaNode {
  if (Array.isArray(value)) {
    const items = value.slice(0, SAMPLE);
    const kinds = [...new Set(items.map(typeOf))];
    const type = kinds.length === 1 ? `${kinds[0]}[]` : 'array';
    const objects = items.filter(isPlainObject);
    return { name, type, children: mergedChildren(objects) };
  }
  return {
    name,
    type: typeOf(value),
    children: isPlainObject(value) ? childrenOf(value) : [],
  };
}

function childrenOf(value: Record<string, unknown>): SchemaNode[] {
  return Object.entries(value).map(([key, v]) => nodeOf(key, v));
}

/** The union of the keys of several objects, typed by the first value seen. */
function mergedChildren(objects: Record<string, unknown>[]): SchemaNode[] {
  const seen = new Map<string, unknown[]>();
  for (const object of objects) {
    for (const [key, v] of Object.entries(object)) {
      seen.set(key, [...(seen.get(key) ?? []), v]);
    }
  }
  return [...seen.entries()].map(([key, values]) => nodeOf(key, values[0]));
}

/** The key/type tree of a value: an object's keys, an array's item keys, or one `value` row. */
export function schemaOf(value: unknown): SchemaNode[] {
  if (isPlainObject(value)) return childrenOf(value);
  if (Array.isArray(value)) {
    const root = nodeOf('', value);
    return root.children.length
      ? root.children
      : [{ name: 'items', type: root.type, children: [] }];
  }
  return [{ name: 'value', type: typeOf(value), children: [] }];
}

export interface JsonToken {
  text: string;
  kind: 'key' | 'string' | 'number' | 'literal' | 'plain';
}

const TOKEN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Pretty-printed JSON split into coloured tokens. */
export function jsonTokens(value: unknown): JsonToken[] {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  const tokens: JsonToken[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) tokens.push({ text: text.slice(last, at), kind: 'plain' });
    if (match[1] !== undefined) {
      if (match[2] !== undefined) {
        tokens.push({ text: match[1], kind: 'key' });
        tokens.push({ text: match[2], kind: 'plain' });
      } else {
        tokens.push({ text: match[1], kind: 'string' });
      }
    } else if (match[3] !== undefined) {
      tokens.push({ text: match[0], kind: 'literal' });
    } else {
      tokens.push({ text: match[0], kind: 'number' });
    }
    last = at + match[0].length;
  }
  if (last < text.length)
    tokens.push({ text: text.slice(last), kind: 'plain' });
  return tokens;
}
