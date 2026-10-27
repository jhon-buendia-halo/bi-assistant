/**
 * The leak check's text normalisation and its **common** vocabulary
 * (agents-evals R229): a word is common when it is a stopword, appears in the
 * lever files at the base, or is the name of a sample's schema entity or
 * column; any other word is distinctive. A change may use common words
 * freely; a run of a question's words, or a name, is a leak only when it
 * carries distinctive ones.
 *
 * Both sides of every comparison go through `normalizeText`: Unicode NFKD
 * with the accents removed, lower case, curly quotes and dashes made
 * straight, runs of white space made one space. A word is a run of letters
 * and digits, so `customer_id` is the two words `customer` and `id`.
 *
 * No Nest, no Mastra, no model.
 */
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { gunzipSync } from 'zlib';
import { SAMPLE_FIXTURES } from '../../../modules/testing-data/fixtures/registry';

/** Where the registry's seed SQL files live. */
export const FIXTURES_DIR = resolve(
  __dirname,
  '..',
  '..',
  '..',
  'modules',
  'testing-data',
  'fixtures',
);

/** NFKD, accents removed, lower case, quotes and dashes straight. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/\s+/g, ' ');
}

/** The words of an already normalised text. */
export function wordsOf(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** The words of any text: normalised, then split. */
export function tokenize(text: string): string[] {
  return wordsOf(normalizeText(text));
}

/**
 * English function words, and the words every question uses to ask. Any
 * word of one character is common too.
 */
export const STOPWORDS: ReadonlySet<string> = new Set(
  `a about above after again against all also am an and any are aren as at be
  because been before being below between both but by can cannot could
  couldn did didn do does doesn doing don down during each either else even
  ever every few for from further get gets got had hadn has hasn have haven
  having he her here hers herself him himself his how however i if in into
  is isn it its itself just least less let like ll made make many may me
  might more most much must mustn my myself neither no nor not now of off
  often on once one only onto or other others otherwise our ours ourselves
  out over own per please rather re same say says shall shan she should
  shouldn show since so some such than that the their theirs them
  themselves then there these they this those though through thus to too
  toward towards under until up upon us ve very via was wasn we were weren
  what whatever when whenever where whereas wherever whether which while who
  whoever whom whose why will with within without won would wouldn yes yet
  you your yours yourself yourselves`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * The table, view and column names, and the column aliases of views, that a
 * seed's DDL declares (`CREATE TABLE <name> (<column> <type>, …)`, `CREATE
 * VIEW <name> AS … AS <alias>`). Rows are not read.
 */
export function schemaNamesFromSql(sql: string): string[] {
  const names = new Set<string>();
  const ddl = sql.slice(0, firstDataStatement(sql));
  for (const match of ddl.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."]+)\s*\(([\s\S]*?)\n\s*\);/gi,
  )) {
    names.add(lastPart(match[1]));
    for (const line of match[2].split('\n')) {
      const column = /^\s*"?([A-Za-z_][\w]*)"?\s+[A-Za-z]/.exec(line);
      if (
        column &&
        !/^(constraint|primary|unique|foreign|check|exclude)$/i.test(column[1])
      ) {
        names.add(column[1]);
      }
    }
  }
  for (const match of ddl.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+([\w."]+)\s+AS([\s\S]*?);/gi,
  )) {
    names.add(lastPart(match[1]));
    for (const alias of match[2].matchAll(/\bAS\s+"?([A-Za-z_]\w*)"?/gi)) {
      names.add(alias[1]);
    }
  }
  return [...names];
}

function lastPart(name: string): string {
  const parts = name.replace(/"/g, '').split('.');
  return parts[parts.length - 1];
}

function firstDataStatement(sql: string): number {
  const at = sql.search(/^(?:INSERT\s+INTO|COPY)\s/im);
  return at < 0 ? sql.length : at;
}

/**
 * Every schema name of the bundled samples: each fixture's schema and
 * required entities (the registry), and the names its seed's DDL declares.
 */
export function sampleSchemaNames(
  fixturesDir: string = FIXTURES_DIR,
): string[] {
  const names = new Set<string>();
  const seeds = new Set<string>();
  for (const fixture of SAMPLE_FIXTURES) {
    names.add(fixture.schema);
    for (const table of fixture.requiredTables) names.add(lastPart(table));
    if (fixture.seedFile) seeds.add(fixture.seedFile);
  }
  for (const seed of seeds) {
    const path = join(fixturesDir, seed);
    if (!existsSync(path)) continue;
    const raw = readFileSync(path);
    const sql = (seed.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
    for (const name of schemaNamesFromSql(sql)) names.add(name);
  }
  return [...names];
}

/** Whether `phrase` occurs in `text` as whole words (both normalised). */
export function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(phrase, from);
    if (at < 0) return false;
    const before = at === 0 ? '' : text[at - 1];
    const after = text[at + phrase.length] ?? '';
    if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) {
      return true;
    }
    from = at + 1;
  }
}

/** The common vocabulary of one leak check (R229). */
export class CommonVocabulary {
  private readonly words: Set<string>;
  private readonly schemaWords: Set<string>;
  private readonly baseText: string;

  constructor(
    baseLeverTexts: readonly string[],
    schemaNames: readonly string[],
  ) {
    this.baseText = baseLeverTexts.map(normalizeText).join('\n');
    this.schemaWords = new Set(schemaNames.flatMap(tokenize));
    this.words = new Set([
      ...STOPWORDS,
      ...this.schemaWords,
      ...wordsOf(this.baseText),
    ]);
  }

  /** A stopword, a word of the lever files at the base, or a schema name. */
  isCommonWord(word: string): boolean {
    return word.length <= 1 || this.words.has(word);
  }

  /**
   * Whether a name or value (normalised) is common: one common word; a phrase
   * that already appears, whole, in the lever files at the base; or a phrase
   * of only stopwords and schema names. A phrase of common words is not
   * common by itself (`pet parents week`), since together they name one thing.
   */
  isCommonPhrase(phrase: string): boolean {
    const words = wordsOf(phrase);
    if (words.length === 0) return true;
    if (words.length === 1) return this.isCommonWord(words[0]);
    if (containsPhrase(this.baseText, phrase)) return true;
    return words.every(
      (w) => w.length <= 1 || STOPWORDS.has(w) || this.schemaWords.has(w),
    );
  }

  /** Whether a normalised text appears whole in the lever files at base. */
  inBase(phrase: string): boolean {
    return containsPhrase(this.baseText, phrase);
  }
}
