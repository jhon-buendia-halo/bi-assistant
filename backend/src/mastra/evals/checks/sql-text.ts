/**
 * Just enough SQL reading for the deterministic checks and the validator
 * (agents-evals R68, R66): comments and string literals set aside, and the
 * table references of a statement. No parser dependency, the same decision
 * as `failure-labels.ts` on `feat/engine-eval-loop`, whose tokenizer this
 * follows: a parser adds dialect gaps and packaging weight, and these rules
 * need only the names after FROM and JOIN.
 *
 * Conservative by design: when a name might not be a table (a function call,
 * a subquery, a CTE), it is left out, so a check or the validator can miss a
 * table but never invents one.
 */

export type SqlTokenKind = 'word' | 'quoted' | 'string' | 'number' | 'punct';

export interface SqlToken {
  kind: SqlTokenKind;
  /** Words lowercased; quoted identifiers and strings as written. */
  text: string;
  /** For `quoted`: the quote character, `"` or a backtick. */
  quote?: string;
}

/**
 * Comments dropped, string literals and quoted identifiers kept whole (so a
 * keyword inside quotes is not a keyword), words lowercased, numbers whole,
 * everything else one character at a time.
 */
export function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  const source = sql ?? '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '-' && source[i + 1] === '-') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (ch === "'") {
      let value = '';
      i += 1;
      while (i < source.length) {
        if (source[i] === "'" && source[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (source[i] === "'") {
          i += 1;
          break;
        } else {
          value += source[i];
          i += 1;
        }
      }
      tokens.push({ kind: 'string', text: value });
    } else if (ch === '"' || ch === '`') {
      const end = source.indexOf(ch, i + 1);
      const stop = end < 0 ? source.length : end;
      tokens.push({
        kind: 'quoted',
        text: source.slice(i + 1, stop),
        quote: ch,
      });
      i = stop + 1;
    } else if (/\d/.test(ch)) {
      const match = /^\d*\.?\d+(?:e[+-]?\d+)?/i.exec(source.slice(i));
      const text = match ? match[0] : ch;
      tokens.push({ kind: 'number', text });
      i += text.length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(source.slice(i));
      const text = match ? match[0] : ch;
      tokens.push({ kind: 'word', text: text.toLowerCase() });
      i += text.length;
    } else {
      tokens.push({ kind: 'punct', text: ch });
      i += 1;
    }
  }
  return tokens;
}

/**
 * The statement with comments removed and every string literal emptied
 * (`'…'` becomes `''`), quoted identifiers kept. What the dialect rules scan,
 * so `'a::b'` or `-- ILIKE` never counts as syntax.
 */
export function withoutLiterals(sql: string): string {
  return (sql ?? '').replace(
    /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:[^']|'')*'?/g,
    (match) => (match.startsWith("'") ? "''" : ' '),
  );
}

const isIdentifier = (token: SqlToken | undefined): boolean =>
  token?.kind === 'word' || token?.kind === 'quoted';

/** Words that are never an alias. */
const KEYWORDS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'on',
  'using',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'full',
  'cross',
  'natural',
  'lateral',
  'group',
  'order',
  'by',
  'having',
  'limit',
  'offset',
  'union',
  'intersect',
  'except',
  'window',
  'qualify',
  'fetch',
  'as',
  'with',
  'tablesample',
]);

/** Functions whose arguments use FROM as a keyword. */
const FROM_FUNCTIONS = new Set([
  'extract',
  'substring',
  'trim',
  'overlay',
  'position',
]);

/** Names a `WITH` clause defines: not tables, whatever FROM says. */
function cteNames(tokens: SqlToken[]): Set<string> {
  const names = new Set<string>();
  tokens.forEach((token, index) => {
    if (!isIdentifier(token)) return;
    const next = tokens[index + 1];
    const after = tokens[index + 2];
    if (next?.kind !== 'word' || next.text !== 'as' || after?.text !== '(') {
      return;
    }
    const before = tokens[index - 1];
    if (
      before?.text === ',' ||
      (before?.kind === 'word' &&
        (before.text === 'with' || before.text === 'recursive'))
    ) {
      names.add(token.text.toLowerCase());
    }
  });
  return names;
}

/** The name parts of a quoted or bare identifier (`"api.x.y"` splits). */
function nameParts(token: SqlToken): string[] {
  return token.kind === 'quoted' ? token.text.split('.') : [token.text];
}

/**
 * The table references of a statement (R68), in order, each as its name
 * parts (`world_cup.goals` → `['world_cup', 'goals']`), duplicates kept. A
 * reference is a name after FROM or JOIN, or after a comma in a FROM list.
 * Left out: names a WITH clause defines, subqueries, table functions
 * (`generate_series(…)`), and the FROM of `EXTRACT(… FROM …)`, `SUBSTRING`,
 * `TRIM`, `POSITION`, `OVERLAY` and `IS DISTINCT FROM`.
 */
export function tableReferences(sql: string): string[][] {
  const tokens = tokenizeSql(sql);
  const ctes = cteNames(tokens);
  const references: string[][] = [];
  const calls: (string | undefined)[] = [];

  /** Read a dotted name from `from`; returns its parts and the next index. */
  const readName = (from: number): [string[], number] => {
    const parts: string[] = [];
    let index = from;
    while (isIdentifier(tokens[index])) {
      parts.push(...nameParts(tokens[index]));
      if (tokens[index + 1]?.text !== '.') {
        index += 1;
        break;
      }
      index += 2;
    }
    return [parts, index];
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.text === '(' && token.kind === 'punct') {
      const before = tokens[index - 1];
      calls.push(before?.kind === 'word' ? before.text : undefined);
      continue;
    }
    if (token.text === ')' && token.kind === 'punct') {
      calls.pop();
      continue;
    }
    if (
      token.kind !== 'word' ||
      (token.text !== 'from' && token.text !== 'join')
    ) {
      continue;
    }
    if (token.text === 'from') {
      const call = calls[calls.length - 1];
      if (call && FROM_FUNCTIONS.has(call)) continue;
      const before = tokens[index - 1];
      if (before?.kind === 'word' && before.text === 'distinct') continue;
    }
    let cursor = index + 1;
    for (;;) {
      if (
        tokens[cursor]?.kind === 'word' &&
        tokens[cursor].text === 'lateral'
      ) {
        cursor += 1;
      }
      if (tokens[cursor]?.text === '(') break; // a subquery
      const [parts, next] = readName(cursor);
      if (!parts.length) break;
      if (tokens[next]?.text === '(') break; // a table function
      const isCte = parts.length === 1 && ctes.has(parts[0].toLowerCase());
      if (!isCte) references.push(parts);
      cursor = next;
      // Skip an alias (`goals g`, `goals AS g`), then continue on a comma.
      if (tokens[cursor]?.kind === 'word' && tokens[cursor].text === 'as') {
        cursor += 1;
      }
      if (
        isIdentifier(tokens[cursor]) &&
        !(tokens[cursor].kind === 'word' && KEYWORDS.has(tokens[cursor].text))
      ) {
        cursor += 1;
      }
      if (token.text === 'from' && tokens[cursor]?.text === ',') {
        cursor += 1;
        continue;
      }
      break;
    }
  }
  return references;
}

/** A reference's last name part, lowercased: the table's own name. */
export function tableName(parts: string[]): string {
  return (parts[parts.length - 1] ?? '').toLowerCase();
}
