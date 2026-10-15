/**
 * The assistant eval question sets, as data (ADR-0015).
 *
 * Every question lives in a JSON file under `./sets/`, one file per question
 * bank. A file declares one or more *variants*: the same questions run against
 * a different sample or datasource kind (the World Cup questions on its
 * PostgreSQL sample and on its REST API sample). This module reads the files,
 * refuses an incomplete or inconsistent case, and expands every file into one
 * set per variant, with the case ids prefixed and the reference SQL collapsed
 * to the variant's dialect. What it returns is plain data; the Mastra scorers
 * are built from it in `eval-check-scorers.ts`.
 *
 * Pure module: no Nest, no Mastra, no model, no database. The validator and the
 * unit tests import it directly.
 *
 * The files are imported (`resolveJsonModule`), not read from disk at run
 * time, so `tsc`/`nest build` emits them next to this module in `dist/`, and
 * the CLI, the npm package and the desktop app load them from there. A new
 * file needs one import and one entry in `EVAL_SET_FILES`; the unit test fails
 * when a file in `./sets/` is not registered.
 *
 * Dialect notes for reference SQL:
 * - `postgres` reads `<schema>.<table>` on the sample's PostgreSQL database.
 * - `sqlite` is the REST connector's engine: it materialises the endpoints a
 *   statement references into in-memory SQLite tables named by their dotted
 *   key, so the reference reads `api.<schema>.<table>`, cannot use
 *   PostgreSQL-only syntax (`::` casts, `ILIKE`, `FILTER`) and cannot alias a
 *   table `match` (a SQLite operator keyword).
 * - `databricks` reads `<catalog>.<schema>.<table>`, written with the
 *   canonical catalog backticked (`` `evals`.world_cup.matches ``); where it
 *   runs, `databricks-catalog.ts` rewrites `` `evals`. `` to the selected
 *   datasets' catalog (agents-evals R191).
 */
import { SAMPLE_FIXTURES } from '../../modules/testing-data/fixtures/registry';
import type { ResultSetCheckOptions } from './result-set-check';
import {
  DETERMINISTIC_CHECK_TYPES,
  DETERMINISTIC_CHECKS,
  isDeterministicCheckType,
} from './checks';
import type { DeterministicCheckSpec, DeterministicCheckType } from './checks';
import worldCupSetFile from './sets/world-cup.json';
import formula1SetFile from './sets/formula-1.json';
import worldCupGoldenSetFile from './sets/world-cup-golden.json';
import worldCupRestConnectorSetFile from './sets/world-cup-rest-connector.json';
import worldCupDatabricksOnlySetFile from './sets/world-cup-databricks-only.json';
import financeSetFile from './sets/finance.json';
import healthInsuranceSetFile from './sets/health-insurance.json';
import genomicsSetFile from './sets/genomics.json';
import supplyChainSetFile from './sets/supply-chain.json';
import marketingAnalyticsSetFile from './sets/marketing-analytics.json';

/** The SQL dialects a reference query can be written in. */
export const EVAL_DIALECTS = ['postgres', 'sqlite', 'databricks'] as const;
export type EvalDialect = (typeof EVAL_DIALECTS)[number];

/** One primary category per case (research 2.6). */
export const EVAL_CATEGORIES = [
  'lookup',
  'aggregate',
  'join',
  'ranking',
  'ratio',
  'null',
  'encoding',
  'reasoning',
  'discovery',
  'ambiguous',
  'fuzzy-scope',
  'out-of-scope',
  'non-existent',
  'business-term',
  'default-filter',
  'visual',
  'follow-up',
  'paraphrase',
] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

/** `held-out` cases are kept out of prompt tuning; `dev` is the default. */
export const EVAL_SPLITS = ['dev', 'held-out'] as const;
export type EvalSplit = (typeof EVAL_SPLITS)[number];

/**
 * The ids of the BA-9 criteria list (research 2.5) a check may measure:
 * domain, generation, instruction-following, cost and latency. J1 and J2
 * grade the judge, never a question.
 */
export const EVAL_CRITERIA = [
  'D1',
  'D2',
  'D3',
  'D4',
  'D5',
  'D6',
  'G1',
  'G2',
  'G3',
  'G4',
  'I1',
  'I2',
  'I3',
  'I4',
  'I5',
  'I6',
  'I7',
  'C1',
  'C2',
  'C3',
  'C4',
] as const;
export type EvalCriterion = (typeof EVAL_CRITERIA)[number];

/**
 * Check types: the six `@mastra/evals/checks` functions of the same name, so
 * their scorer ids and descriptions are the ones the Evals tab and stored
 * runs already show, then the deterministic checks of `./checks/`
 * (agents-evals R111 to R123). `eval-check-scorers.ts` builds both.
 */
export const EVAL_CHECK_TYPES = [
  'includes',
  'matches',
  'calledTool',
  'didNotCall',
  'toolOrder',
  'noToolErrors',
  ...DETERMINISTIC_CHECK_TYPES,
] as const;
export type EvalCheckType = (typeof EVAL_CHECK_TYPES)[number];

/** One check as a set file writes it. `criterion` is a research 2.5 id. */
export type EvalCheckSpec = (
  | { type: 'includes'; args: { text: string } }
  | { type: 'matches'; args: { pattern: string; flags?: string } }
  | { type: 'calledTool'; args: { tool: string } }
  | { type: 'didNotCall'; args: { tool: string } }
  | { type: 'toolOrder'; args: { tools: string[] } }
  | { type: 'noToolErrors'; args?: Record<string, never> }
  | DeterministicCheckSpec
) & { criterion?: EvalCriterion };

/** One variant of a set file: the set a run selects. */
export interface EvalSetVariant {
  /** Stable id, used by the API, the questions tab and `EVAL_SET`. */
  id: string;
  name: string;
  /** What the set covers and what it needs to run, shown above its questions. */
  description: string;
  /** The sample this set questions, by `SampleFixture.id`. */
  fixtureId: string;
  /** Which `expectedSql` entry this variant's cases are graded against. */
  dialect: EvalDialect;
  /** Prepended to every case id, so variants of one file never collide. */
  caseIdPrefix: string;
}

/** One case after expansion: the shape the suite runs. */
export interface EvalCaseDefinition {
  /** The case id with the variant's prefix. */
  id: string;
  category: EvalCategory;
  split: EvalSplit;
  tags: string[];
  question: string;
  /** What the question is probing for, for the run report. */
  intent: string;
  /** Why the case exists and what it guards; for people, never graded. */
  notes?: string;
  checks: EvalCheckSpec[];
  /** The reference query in the variant's dialect, when the case has one. */
  expectedSql?: string;
  resultSetOptions?: ResultSetCheckOptions;
  judgeRubric?: string;
}

/** One runnable set: a variant of a set file with its expanded cases. */
export interface EvalSetDefinition extends Omit<
  EvalSetVariant,
  'caseIdPrefix'
> {
  /** The file under `./sets/` it came from. */
  file: string;
  cases: EvalCaseDefinition[];
}

/** A set file's name and parsed content, before validation. */
export interface EvalSetFileSource {
  file: string;
  content: unknown;
}

/**
 * Every set file, in the order the suite lists its sets: World Cup, World Cup
 * (REST API), Formula 1, World Cup (golden set), World Cup (REST connector,
 * BA-187), World Cup (Databricks only, BA-186), then the synthetic domains
 * (BA-185): Finance, Health Insurance, Genomics, Supply Chain, Marketing
 * Analytics.
 */
export const EVAL_SET_FILES: readonly EvalSetFileSource[] = [
  { file: 'world-cup.json', content: worldCupSetFile },
  { file: 'formula-1.json', content: formula1SetFile },
  { file: 'world-cup-golden.json', content: worldCupGoldenSetFile },
  {
    file: 'world-cup-rest-connector.json',
    content: worldCupRestConnectorSetFile,
  },
  {
    file: 'world-cup-databricks-only.json',
    content: worldCupDatabricksOnlySetFile,
  },
  { file: 'finance.json', content: financeSetFile },
  { file: 'health-insurance.json', content: healthInsuranceSetFile },
  { file: 'genomics.json', content: genomicsSetFile },
  { file: 'supply-chain.json', content: supplyChainSetFile },
  { file: 'marketing-analytics.json', content: marketingAnalyticsSetFile },
];

const FILE_KEYS = ['variants', 'cases'];
const VARIANT_KEYS = [
  'id',
  'name',
  'description',
  'fixtureId',
  'dialect',
  'caseIdPrefix',
];
const CASE_KEYS = [
  'id',
  'category',
  'split',
  'tags',
  'question',
  'intent',
  'notes',
  'checks',
  'expectedSql',
  'resultSetOptions',
  'judgeRubric',
];
const CHECK_KEYS = ['type', 'args', 'criterion'];
const RESULT_SET_OPTION_KEYS = ['distinctRows'];

/** Required and optional `args` per check type. */
const CHECK_ARGS: Readonly<
  Record<
    EvalCheckType,
    { required: readonly string[]; optional: readonly string[] }
  >
> = {
  includes: { required: ['text'], optional: [] },
  matches: { required: ['pattern'], optional: ['flags'] },
  calledTool: { required: ['tool'], optional: [] },
  didNotCall: { required: ['tool'], optional: [] },
  toolOrder: { required: ['tools'], optional: [] },
  noToolErrors: { required: [], optional: [] },
  ...(Object.fromEntries(
    DETERMINISTIC_CHECK_TYPES.map((type) => [
      type,
      DETERMINISTIC_CHECKS[type].args,
    ]),
  ) as Record<
    DeterministicCheckType,
    { required: readonly string[]; optional: readonly string[] }
  >),
};

/**
 * The fixture kind each dialect runs on: a variant's dialect must be the one
 * its sample's datasource speaks, or its references would never run.
 */
const DIALECT_FOR_KIND: Readonly<Record<string, EvalDialect>> = {
  postgres: 'postgres',
  rest: 'sqlite',
  databricks: 'databricks',
};

/** Case and variant ids: lowercase words joined by hyphens. */
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Json = Record<string, unknown>;

/** Thrown for any set file the suite refuses to load. */
export class EvalSetError extends Error {
  constructor(file: string, where: string | undefined, problem: string) {
    super(`Eval set file ${file}${where ? `, ${where}` : ''}: ${problem}`);
    this.name = 'EvalSetError';
  }
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function oneOf(values: readonly string[]): string {
  return values.join(', ');
}

/**
 * The RegExp a `matches` check runs. `g` and `y` are refused at load: they
 * make `RegExp.test` stateful, so the same answer could score differently.
 */
export function checkRegExp(args: { pattern: string; flags?: string }): RegExp {
  return new RegExp(args.pattern, args.flags ?? '');
}

/** Validate and expand every set file, in order. Throws `EvalSetError`. */
export function loadEvalSets(
  files: readonly EvalSetFileSource[] = EVAL_SET_FILES,
): EvalSetDefinition[] {
  const sets: EvalSetDefinition[] = [];
  const setFiles = new Map<string, string>();
  const caseFiles = new Map<string, string>();
  for (const source of files) {
    for (const set of parseEvalSetFile(source)) {
      const otherFile = setFiles.get(set.id);
      if (otherFile !== undefined) {
        throw new EvalSetError(
          source.file,
          `variant "${set.id}"`,
          `the set id is already used by ${otherFile}`,
        );
      }
      setFiles.set(set.id, source.file);
      for (const evalCase of set.cases) {
        const other = caseFiles.get(evalCase.id);
        if (other !== undefined) {
          throw new EvalSetError(
            source.file,
            `case "${evalCase.id}"`,
            `the case id is already used in ${other}; case ids must be unique across every set`,
          );
        }
        caseFiles.set(evalCase.id, `${source.file} (set "${set.id}")`);
      }
      sets.push(set);
    }
  }
  return sets;
}

/** Validate one set file and expand it into one set per variant. */
export function parseEvalSetFile(
  source: EvalSetFileSource,
): EvalSetDefinition[] {
  const { file, content } = source;
  if (!isObject(content)) {
    throw new EvalSetError(file, undefined, 'must be a JSON object');
  }
  refuseUnknownKeys(file, undefined, content, FILE_KEYS);
  if (!Array.isArray(content.variants) || content.variants.length === 0) {
    throw new EvalSetError(
      file,
      undefined,
      '"variants" must be a non-empty array',
    );
  }
  if (!Array.isArray(content.cases) || content.cases.length === 0) {
    throw new EvalSetError(
      file,
      undefined,
      '"cases" must be a non-empty array',
    );
  }
  const variants = content.variants.map((raw, index) =>
    parseVariant(file, raw, index),
  );
  const dialects = Array.from(new Set(variants.map((v) => v.dialect)));
  const cases = content.cases.map((raw, index) =>
    parseCase(file, raw, index, dialects),
  );
  const seen = new Set<string>();
  for (const evalCase of cases) {
    if (seen.has(evalCase.id)) {
      throw new EvalSetError(
        file,
        `case "${evalCase.id}"`,
        'the case id appears twice in this file',
      );
    }
    seen.add(evalCase.id);
  }
  return variants.map((variant) => expand(file, variant, cases));
}

/** A case as the file writes it, validated but not yet expanded. */
interface ParsedCase extends Omit<EvalCaseDefinition, 'expectedSql'> {
  expectedSql?: Partial<Record<EvalDialect, string>>;
}

function expand(
  file: string,
  variant: EvalSetVariant,
  cases: ParsedCase[],
): EvalSetDefinition {
  const { caseIdPrefix, ...set } = variant;
  return {
    ...set,
    file,
    cases: cases.map(({ expectedSql, ...evalCase }) => {
      const sql = expectedSql?.[variant.dialect];
      return {
        ...evalCase,
        id: `${caseIdPrefix}${evalCase.id}`,
        ...(sql !== undefined ? { expectedSql: sql } : {}),
      };
    }),
  };
}

function refuseUnknownKeys(
  file: string,
  where: string | undefined,
  value: Json,
  known: string[],
): void {
  const unknown = Object.keys(value).filter((key) => !known.includes(key));
  if (unknown.length > 0) {
    throw new EvalSetError(
      file,
      where,
      `unknown field(s) ${unknown.map((key) => `"${key}"`).join(', ')}; known fields: ${oneOf(known)}`,
    );
  }
}

function requireString(
  file: string,
  where: string,
  value: Json,
  key: string,
): string {
  const field = value[key];
  if (!isNonEmptyString(field)) {
    throw new EvalSetError(
      file,
      where,
      `"${key}" is required and must be a non-empty string`,
    );
  }
  return field;
}

function optionalString(
  file: string,
  where: string,
  value: Json,
  key: string,
): string | undefined {
  if (value[key] === undefined) return undefined;
  return requireString(file, where, value, key);
}

function parseVariant(
  file: string,
  raw: unknown,
  index: number,
): EvalSetVariant {
  const at = `variant #${index + 1}`;
  if (!isObject(raw)) throw new EvalSetError(file, at, 'must be an object');
  const id = requireString(file, at, raw, 'id');
  const where = `variant "${id}"`;
  refuseUnknownKeys(file, where, raw, VARIANT_KEYS);
  if (!ID_PATTERN.test(id)) {
    throw new EvalSetError(
      file,
      where,
      'the id must be lowercase words joined by hyphens',
    );
  }
  const fixtureId = requireString(file, where, raw, 'fixtureId');
  const fixture = SAMPLE_FIXTURES.find((sample) => sample.id === fixtureId);
  if (!fixture) {
    throw new EvalSetError(
      file,
      where,
      `fixtureId "${fixtureId}" is not in the fixture registry; known: ${oneOf(SAMPLE_FIXTURES.map((sample) => sample.id))}`,
    );
  }
  const dialect = raw.dialect;
  if (dialect === undefined) {
    throw new EvalSetError(file, where, '"dialect" is required');
  }
  if (!EVAL_DIALECTS.includes(dialect as EvalDialect)) {
    throw new EvalSetError(
      file,
      where,
      `dialect ${JSON.stringify(dialect)} is not one of ${oneOf(EVAL_DIALECTS)}`,
    );
  }
  const kind = fixture.datasourceKind ?? 'postgres';
  if (DIALECT_FOR_KIND[kind] !== dialect) {
    throw new EvalSetError(
      file,
      where,
      `dialect "${dialect as EvalDialect}" does not match fixture "${fixtureId}", whose ${kind} datasource runs ${DIALECT_FOR_KIND[kind] ?? 'an unknown dialect'}`,
    );
  }
  const prefix = raw.caseIdPrefix;
  if (typeof prefix !== 'string' || !/^(?:[a-z0-9]+-)*$/.test(prefix)) {
    throw new EvalSetError(
      file,
      where,
      '"caseIdPrefix" is required: "" or lowercase words each followed by a hyphen (e.g. "rest-")',
    );
  }
  return {
    id,
    name: requireString(file, where, raw, 'name'),
    description: requireString(file, where, raw, 'description'),
    fixtureId,
    dialect: dialect as EvalDialect,
    caseIdPrefix: prefix,
  };
}

function parseCase(
  file: string,
  raw: unknown,
  index: number,
  dialects: EvalDialect[],
): ParsedCase {
  const at = `case #${index + 1}`;
  if (!isObject(raw)) throw new EvalSetError(file, at, 'must be an object');
  const id = requireString(file, at, raw, 'id');
  const where = `case "${id}"`;
  refuseUnknownKeys(file, where, raw, CASE_KEYS);
  if (!ID_PATTERN.test(id)) {
    throw new EvalSetError(
      file,
      where,
      'the id must be lowercase words joined by hyphens',
    );
  }
  if (raw.category === undefined) {
    throw new EvalSetError(file, where, '"category" is required');
  }
  if (!EVAL_CATEGORIES.includes(raw.category as EvalCategory)) {
    throw new EvalSetError(
      file,
      where,
      `category ${JSON.stringify(raw.category)} is not one of ${oneOf(EVAL_CATEGORIES)}`,
    );
  }
  const split = raw.split ?? 'dev';
  if (!EVAL_SPLITS.includes(split as EvalSplit)) {
    throw new EvalSetError(
      file,
      where,
      `split ${JSON.stringify(split)} is not one of ${oneOf(EVAL_SPLITS)}`,
    );
  }
  const tags = raw.tags ?? [];
  if (!Array.isArray(tags) || !tags.every(isNonEmptyString)) {
    throw new EvalSetError(
      file,
      where,
      '"tags" must be an array of non-empty strings',
    );
  }
  const question = requireString(file, where, raw, 'question');
  const intent = requireString(file, where, raw, 'intent');
  const notes = optionalString(file, where, raw, 'notes');
  const judgeRubric = optionalString(file, where, raw, 'judgeRubric');
  const checks = parseChecks(file, where, raw.checks);
  const expectedSql = parseExpectedSql(file, where, raw.expectedSql, dialects);
  checks.forEach((check, index) => {
    if (!isDeterministicCheckType(check.type)) return;
    // `usesEntities` without entities reads them from the reference (R124).
    const problem = DETERMINISTIC_CHECKS[check.type].validateCase?.(
      (check.args ?? {}) as Json,
      expectedSql,
    );
    if (problem) {
      throw new EvalSetError(file, `${where}, check #${index + 1}`, problem);
    }
  });
  const resultSetOptions = parseResultSetOptions(
    file,
    where,
    raw.resultSetOptions,
  );
  return {
    id,
    category: raw.category as EvalCategory,
    split: split as EvalSplit,
    tags,
    question,
    intent,
    ...(notes !== undefined ? { notes } : {}),
    checks,
    ...(expectedSql ? { expectedSql } : {}),
    ...(resultSetOptions ? { resultSetOptions } : {}),
    ...(judgeRubric !== undefined ? { judgeRubric } : {}),
  };
}

function parseChecks(
  file: string,
  where: string,
  raw: unknown,
): EvalCheckSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new EvalSetError(
      file,
      where,
      '"checks" is required and must be a non-empty array',
    );
  }
  const seen = new Set<string>();
  return raw.map((check, index) => {
    const at = `${where}, check #${index + 1}`;
    if (!isObject(check)) throw new EvalSetError(file, at, 'must be an object');
    refuseUnknownKeys(file, at, check, CHECK_KEYS);
    const type = check.type;
    if (!EVAL_CHECK_TYPES.includes(type as EvalCheckType)) {
      throw new EvalSetError(
        file,
        at,
        `check type ${JSON.stringify(type)} is not one of ${oneOf(EVAL_CHECK_TYPES)}`,
      );
    }
    // `runEvals` keys scores by scorer id, which is per type: a second check
    // of the same type would silently overwrite the first one's score.
    if (seen.has(type as string)) {
      throw new EvalSetError(
        file,
        at,
        `check type "${String(type)}" is used twice; each type may appear once per case`,
      );
    }
    seen.add(type as string);
    const args = parseCheckArgs(file, at, type as EvalCheckType, check.args);
    const stated = optionalString(file, at, check, 'criterion');
    if (
      stated !== undefined &&
      !EVAL_CRITERIA.includes(stated as EvalCriterion)
    ) {
      throw new EvalSetError(
        file,
        at,
        `criterion "${stated}" is not one of ${oneOf(EVAL_CRITERIA)}`,
      );
    }
    // A deterministic check measures its own criterion unless the file says
    // otherwise (R124); the Mastra helpers have none.
    const criterion =
      stated ??
      (isDeterministicCheckType(type)
        ? DETERMINISTIC_CHECKS[type].criterion
        : undefined);
    return {
      type,
      ...(args ? { args } : {}),
      ...(criterion !== undefined ? { criterion } : {}),
    } as EvalCheckSpec;
  });
}

function parseCheckArgs(
  file: string,
  at: string,
  type: EvalCheckType,
  raw: unknown,
): Json | undefined {
  const { required, optional } = CHECK_ARGS[type];
  if (raw === undefined && required.length === 0) return undefined;
  if (!isObject(raw)) {
    throw new EvalSetError(
      file,
      at,
      `"${type}" needs "args" with ${oneOf(required.map((key) => `"${key}"`))}`,
    );
  }
  refuseUnknownKeys(file, `${at} args`, raw, [...required, ...optional]);
  for (const key of required) {
    if (raw[key] === undefined) {
      throw new EvalSetError(file, at, `"${type}" needs args."${key}"`);
    }
  }
  for (const key of ['text', 'pattern', 'tool']) {
    if (raw[key] !== undefined && !isNonEmptyString(raw[key])) {
      throw new EvalSetError(
        file,
        at,
        `args."${key}" must be a non-empty string`,
      );
    }
  }
  if (type === 'toolOrder') {
    const tools = raw.tools;
    if (
      !Array.isArray(tools) ||
      tools.length === 0 ||
      !tools.every(isNonEmptyString)
    ) {
      throw new EvalSetError(
        file,
        at,
        'args."tools" must be a non-empty array of tool names',
      );
    }
  }
  if (isDeterministicCheckType(type)) {
    const problem = DETERMINISTIC_CHECKS[type].validateArgs?.(raw);
    if (problem) throw new EvalSetError(file, at, problem);
  }
  if (type === 'matches') {
    const flags = raw.flags ?? '';
    if (typeof flags !== 'string' || /[gy]/.test(flags)) {
      throw new EvalSetError(
        file,
        at,
        'args."flags" must be a string without "g" or "y" (they make the match stateful)',
      );
    }
    try {
      checkRegExp({ pattern: raw.pattern as string, flags });
    } catch (err) {
      throw new EvalSetError(
        file,
        at,
        `args."pattern" is not a valid regular expression: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return raw;
}

function parseExpectedSql(
  file: string,
  where: string,
  raw: unknown,
  dialects: EvalDialect[],
): Partial<Record<EvalDialect, string>> | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw) || Object.keys(raw).length === 0) {
    throw new EvalSetError(
      file,
      where,
      `"expectedSql" must be an object with a query per dialect (${oneOf(EVAL_DIALECTS)})`,
    );
  }
  for (const [dialect, sql] of Object.entries(raw)) {
    if (!EVAL_DIALECTS.includes(dialect as EvalDialect)) {
      throw new EvalSetError(
        file,
        where,
        `expectedSql has an unknown dialect "${dialect}"; known: ${oneOf(EVAL_DIALECTS)}`,
      );
    }
    if (!isNonEmptyString(sql)) {
      throw new EvalSetError(
        file,
        where,
        `expectedSql.${dialect} must be a non-empty string`,
      );
    }
  }
  // A reference for one dialect and not another would grade the same
  // question on one datasource kind and silently skip it on the other.
  const missing = dialects.filter((dialect) => raw[dialect] === undefined);
  if (missing.length > 0) {
    throw new EvalSetError(
      file,
      where,
      `expectedSql has no ${oneOf(missing)} query, but this file's variants run ${oneOf(dialects)}; give every dialect a reference or none`,
    );
  }
  return raw;
}

function parseResultSetOptions(
  file: string,
  where: string,
  raw: unknown,
): ResultSetCheckOptions | undefined {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) {
    throw new EvalSetError(file, where, '"resultSetOptions" must be an object');
  }
  refuseUnknownKeys(
    file,
    `${where} resultSetOptions`,
    raw,
    RESULT_SET_OPTION_KEYS,
  );
  if (raw.distinctRows !== undefined && typeof raw.distinctRows !== 'boolean') {
    throw new EvalSetError(
      file,
      where,
      'resultSetOptions.distinctRows must be true or false',
    );
  }
  return raw;
}

/**
 * The set an `EVAL_SET` value names. Throws with the known ids when it names
 * none, so a typo fails before any model or database call.
 */
export function evalSetById<T extends { id: string }>(
  sets: readonly T[],
  setId: string,
): T {
  const wanted = setId.trim();
  const set = sets.find((candidate) => candidate.id === wanted);
  if (!set) {
    throw new Error(
      `Unknown eval set "${wanted}". Known sets: ${oneOf(sets.map((candidate) => candidate.id))}.`,
    );
  }
  return set;
}

/**
 * The case ids an `EVAL_SET` value selects for a run: that set's cases, or
 * `undefined` (every case, as before) when no set is named.
 */
export function caseIdsForSet(
  sets: readonly { id: string; cases: readonly { id: string }[] }[],
  setId: string | undefined,
): string[] | undefined {
  if (setId === undefined || setId.trim() === '') return undefined;
  return evalSetById(sets, setId).cases.map((evalCase) => evalCase.id);
}
