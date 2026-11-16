/**
 * Pure scanning of a SQL statement's own text: literals and comments masked,
 * brackets blanked, the top-level LIMIT found and raised. No framework
 * import. The connectors use it to wrap a stored statement (datasources R52);
 * the query evidence reads it for coverage and the CSV (api.md 139, 143).
 */
import { PAGE_MAX_ROWS } from './paged-sql.types';

/**
 * Blanks out string literals and comments while preserving every character
 * offset, so keyword scanning cannot trip over a `'... LIMIT ...'` inside a
 * label while expression text is still sliced from the original SQL.
 */
export function maskLiterals(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += ' ';
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '\\' && i + 1 < sql.length) {
          out += '  ';
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            out += '  ';
            i += 2;
            continue;
          }
          out += ' ';
          i += 1;
          break;
        }
        out += sql[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (ch === '/' && sql[i + 1] === '*') {
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        out += sql[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < sql.length) {
        out += '  ';
        i += 2;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/**
 * The masked SQL with everything inside brackets blanked, offsets kept, so
 * only the statement's own clauses are left to scan.
 */
export function topLevel(mask: string): string {
  let depth = 0;
  let out = '';
  for (const ch of mask) {
    if (ch === '(') {
      depth += 1;
      out += ' ';
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
      out += ' ';
    } else {
      out += depth > 0 ? (ch === '\n' ? '\n' : ' ') : ch;
    }
  }
  return out;
}

export interface OuterLimit {
  value: number;
  /** Offsets of the count's digits in the SQL. */
  start: number;
  end: number;
  /** Offset of the LIMIT / FETCH keyword. */
  at: number;
}

/** The statement's own top-level LIMIT or FETCH FIRST n, with its offsets. */
export function outerLimit(sql: string): OuterLimit | undefined {
  const top = topLevel(maskLiterals(sql));
  let found: OuterLimit | undefined;
  for (const m of top.matchAll(/\blimit\s+(\d+)(\s*,\s*(\d+))?/gi)) {
    // SQLite's `LIMIT offset, count`: the count is the second number.
    const digits = m[3] ?? m[1];
    const start =
      m.index +
      (m[3] !== undefined ? m[0].length - digits.length : m[0].indexOf(digits));
    found = {
      value: Number(digits),
      start,
      end: start + digits.length,
      at: m.index,
    };
  }
  for (const m of top.matchAll(
    /\bfetch\s+(?:first|next)\s+(\d+)\s+rows?\s+only\b/gi,
  )) {
    if (found && found.at > m.index) continue;
    const start = m.index + m[0].indexOf(m[1], 'fetch'.length);
    found = {
      value: Number(m[1]),
      start,
      end: start + m[1].length,
      at: m.index,
    };
  }
  return found;
}

/** The statement's own top-level LIMIT or FETCH FIRST n, if any. */
export function outerLimitOf(sql: string): number | undefined {
  return outerLimit(sql)?.value;
}

/** The statement without a trailing semicolon, comment or blank. */
export function withoutTrailingFraming(sql: string): string {
  const mask = maskLiterals(sql);
  let end = mask.length;
  while (end > 0 && /[\s;]/.test(mask[end - 1])) end -= 1;
  return sql.slice(0, end);
}

/**
 * The statement with its top-level LIMIT (or FETCH FIRST n) raised to `rows`,
 * or that LIMIT appended: the CSV download (api.md 143) and the paged read
 * (datasources R52) both read up to 50,001 rows. A trailing semicolon or
 * comment is dropped first.
 */
export function withExportLimit(sql: string, rows = PAGE_MAX_ROWS + 1): string {
  const body = withoutTrailingFraming(sql);
  const limit = outerLimit(body);
  if (limit) {
    return `${body.slice(0, limit.start)}${rows}${body.slice(limit.end)}`;
  }
  return `${body}\nLIMIT ${rows}`;
}
