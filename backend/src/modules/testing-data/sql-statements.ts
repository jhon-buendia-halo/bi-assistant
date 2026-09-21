/**
 * Split a SQL script into individual statements.
 *
 * A bundled sample can be tens of megabytes. Handing all of it to
 * `client.query()` in one simple-query round-trip makes the server parse the
 * whole script at once, which blows out its shared memory (`could not resize
 * shared memory segment ... No space left on device` against a container with
 * Docker's default 64 MB `/dev/shm`). Splitting lets the loader feed the
 * server bounded batches instead.
 *
 * Semicolons cannot simply be split on — one inside a string literal, an
 * identifier or a comment is data, not a terminator. This scanner tracks the
 * lexical contexts a `pg_dump` script can put a semicolon in:
 *   'single quotes'  (with '' escapes)   "quoted identifiers"  (with "" escapes)
 *   -- line comments  /* block comments *(/)  $tag$ dollar quoting $tag$
 * Nothing here is Postgres-specific beyond dollar quoting, and no statement is
 * rewritten — each is returned verbatim, minus the trailing semicolon.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let start = 0;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];

    // -- line comment
    if (ch === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }

    // /* block comment */ — Postgres nests these, so track the depth.
    if (ch === '/' && sql[i + 1] === '*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      continue;
    }

    // 'string literal' or "quoted identifier" — a doubled quote is an escape,
    // not a terminator.
    if (ch === "'" || ch === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === ch) {
          if (sql[i + 1] === ch) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // $tag$ dollar-quoted body $tag$ (the tag may be empty: $$ ... $$).
    if (ch === '$') {
      const tag = /^\$[A-Za-z_-￿][A-Za-z0-9_-￿]*\$|^\$\$/.exec(
        sql.slice(i),
      )?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end === -1 ? sql.length : end + tag.length;
        continue;
      }
    }

    if (ch === ';') {
      const statement = sql.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }

    i++;
  }

  const tail = sql.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}
