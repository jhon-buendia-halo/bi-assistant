/**
 * The Unity Catalog catalog a Databricks reference query runs in
 * (agents-evals R192).
 *
 * Set files write every Databricks reference in one canonical form,
 * `` `evals`.<schema>.<table> `` (R206), but a workspace may not allow a
 * catalog named `evals`: the loader can put a sample in any catalog
 * (testing-data R24). Wherever a reference runs, the catalog is therefore
 * read from the selected datasets' entity keys (`<catalog>.<schema>.<table>`)
 * and the backticked `` `evals`. `` is rewritten to it. PostgreSQL and SQLite
 * references are never touched.
 *
 * Pure: no Nest, no Mastra, no connector; the result-set check, the
 * validator, the preflight and the unit tests import it.
 */
import { DATABRICKS_FIXTURE_CATALOG } from '../../modules/testing-data/fixtures/registry';
import type { EvalDialect } from './eval-set-files';

/** The catalog every Databricks reference names in its set file. */
export const REFERENCE_CATALOG = DATABRICKS_FIXTURE_CATALOG;

/** The selected datasets do not name one catalog; the message says why. */
export class DatabricksCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabricksCatalogError';
  }
}

/**
 * The one catalog of the selected datasets' entities: the first part of every
 * `<catalog>.<schema>.<table>` key, compared ignoring case (Unity Catalog
 * stores names in lower case). Throws when there is no entity, when a key is
 * not three-part, or when the keys name more than one catalog.
 */
export function catalogOfEntities(keys: readonly string[]): string {
  if (keys.length === 0) {
    throw new DatabricksCatalogError(
      'The selected datasets hold no entity, so the catalog the Databricks reference queries run in cannot be chosen.',
    );
  }
  const catalogs = new Set<string>();
  for (const key of keys) {
    const parts = key.split('.');
    if (parts.length !== 3 || parts.some((part) => !part.trim())) {
      throw new DatabricksCatalogError(
        `The entity "${key}" is not catalog.schema.table, so the catalog the Databricks reference queries run in cannot be chosen.`,
      );
    }
    catalogs.add(parts[0].trim().toLowerCase());
  }
  if (catalogs.size > 1) {
    throw new DatabricksCatalogError(
      `The selected datasets span several catalogs (${[...catalogs].sort().join(', ')}); ` +
        'the Databricks reference queries run in one. Select datasets whose entities are all in one catalog.',
    );
  }
  return [...catalogs][0];
}

function quoteIdent(name: string): string {
  return `\`${name.replace(/`/g, '``')}\``;
}

/**
 * The reference with its backticked catalog `` `evals`. `` rewritten to
 * `` `<catalog>`. ``, and nothing else: a bare `evals.`, a backticked
 * `` `evals` `` not followed by a dot, and anything inside a string literal
 * or a comment stay as written.
 */
export function referenceInCatalog(sql: string, catalog: string): string {
  if (catalog === REFERENCE_CATALOG) return sql;
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      // A Databricks string literal; a backslash escapes the next character.
      let j = i + 1;
      while (j < sql.length && sql[j] !== ch) j += sql[j] === '\\' ? 2 : 1;
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      const j = end < 0 ? sql.length : end;
      out += sql.slice(i, j);
      i = j;
    } else if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      const j = end < 0 ? sql.length : end + 2;
      out += sql.slice(i, j);
      i = j;
    } else if (ch === '`') {
      // A quoted identifier; a doubled backtick is a backtick in the name.
      let j = i + 1;
      let name = '';
      while (j < sql.length) {
        if (sql[j] === '`' && sql[j + 1] === '`') {
          name += '`';
          j += 2;
        } else if (sql[j] === '`') {
          break;
        } else {
          name += sql[j];
          j += 1;
        }
      }
      out +=
        name === REFERENCE_CATALOG && sql[j + 1] === '.'
          ? quoteIdent(catalog)
          : sql.slice(i, j + 1);
      i = j + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * A reference as it runs on the selected datasets: a `databricks` reference
 * in the datasets' catalog (throws `DatabricksCatalogError` when they do not
 * name one), any other dialect unchanged.
 */
export function referenceForDatasets(
  sql: string,
  dialect: EvalDialect,
  entityKeys: readonly string[],
): string {
  return dialect === 'databricks'
    ? referenceInCatalog(sql, catalogOfEntities(entityKeys))
    : sql;
}
