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
 *   datasets' catalog (agents-evals R192).
 *
 * `memory.json` (BA-190) holds memory cases instead of questions: each
 * teaches signals, then asks a probe (agents-evals R233 to R236). Its
 * variants are PostgreSQL sets, one per sample, each holding the cases whose
 * `fixture` is its sample, and a memory case loads as an ordinary case whose
 * question, checks and reference are its probe's, plus its `teach`, its
 * `trapSql` and its memory checks.
 */
import { SAMPLE_FIXTURES } from '../../modules/testing-data/fixtures/registry';
import { OPTIONAL_AGENT_TOOLS } from '../agent-tools';
import type { OptionalAgentTool } from '../agent-tools';
import type { ResultSetCheckOptions } from './result-set-check';
import {
  DETERMINISTIC_CHECK_TYPES,
  DETERMINISTIC_CHECKS,
  isDeterministicCheckType,
} from './checks';
import type { DeterministicCheckSpec, DeterministicCheckType } from './checks';
import { MEMORY_CHECKS } from './checks/memory-checks';
import { MEMORY_CHECK_TYPES } from './memory-case';
import type {
  MemoryCheckSpec,
  MemoryCheckType,
  TeachSignal,
} from './memory-case';
import worldCupSetFile from './sets/world-cup.json';
import formula1SetFile from './sets/formula-1.json';
import worldCupRestConnectorSetFile from './sets/world-cup-rest-connector.json';
import worldCupDatabricksOnlySetFile from './sets/world-cup-databricks-only.json';
import financeSetFile from './sets/finance.json';
import healthInsuranceSetFile from './sets/health-insurance.json';
import genomicsSetFile from './sets/genomics.json';
import supplyChainSetFile from './sets/supply-chain.json';
import marketingAnalyticsSetFile from './sets/marketing-analytics.json';
import memorySetFile from './sets/memory.json';

/** The SQL dialects a reference query can be written in. */
export const EVAL_DIALECTS = ['postgres', 'sqlite', 'databricks'] as const;
export type EvalDialect = (typeof EVAL_DIALECTS)[number];

/**
 * One primary category per question (research 2.6): the eighteen of every
 * question bank but `memory.json`. `EVAL_CATEGORY` and the judge's
 * `categories` take these only (agents-evals R236, OD-17).
 */
export const QUESTION_CATEGORIES = [
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

/**
 * A memory case's category (agents-evals R236): the four learning
 * categories, where what was taught should change the answer, then the two
 * a memory must not change.
 */
export const MEMORY_CATEGORIES = [
  'memory-reuse',
  'memory-correction',
  'memory-update',
  'memory-rejected',
  'memory-abstain',
  'memory-vs-curated',
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

/**
 * Every category a case can have, in the order the run summary lists them:
 * the memory categories after the eighteen (R148, R236).
 */
export const EVAL_CATEGORIES = [
  ...QUESTION_CATEGORIES,
  ...MEMORY_CATEGORIES,
] as const;
export type EvalCategory = (typeof EVAL_CATEGORIES)[number];

/** `held-out` cases are kept out of prompt tuning; `dev` is the default. */
export const EVAL_SPLITS = ['dev', 'held-out'] as const;
export type EvalSplit = (typeof EVAL_SPLITS)[number];

/**
 * The ids of the BA-9 criteria list (research 2.5) a check may measure:
 * domain, generation, instruction-following, cost and latency, then the
 * memory bucket M1 to M3 (agents-evals R244). J1 and J2 grade the judge,
 * never a question.
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
  'M1',
  'M2',
  'M3',
] as const;
export type EvalCriterion = (typeof EVAL_CRITERIA)[number];

/**
 * Check types: the six `@mastra/evals/checks` functions of the same name, so
 * their scorer ids and descriptions are the ones the Evals tab and stored
 * runs already show, then the deterministic checks of `./checks/`
 * (agents-evals R112 to R124). `eval-check-scorers.ts` builds both.
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
  /**
   * The tool selection the case runs with, as a session bound to a user
   * agent would (agents.md 4.2): ids from `OPTIONAL_AGENT_TOOLS`. Absent
   * means every tool.
   */
  agentTools?: OptionalAgentTool[];
  checks: EvalCheckSpec[];
  /** The reference query in the variant's dialect, when the case has one. */
  expectedSql?: string;
  resultSetOptions?: ResultSetCheckOptions;
  judgeRubric?: string;
  /**
   * A memory case only (agents-evals R234): the signals stored before the
   * question, which is its probe's, in file order.
   */
  teach?: TeachSignal[];
  /** A memory case only: the probe's trap query, for the validator (R237). */
  trapSql?: string;
  /**
   * A memory case only: the checks of R241 to R243, in file order, each with
   * its criterion (named, or its type's default). They are not in `checks`:
   * they read the attempt's memory record, so no scorer is built for them.
   */
  memoryChecks?: MemoryCheckSpec[];
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

/** The question bank file of the memory cases (agents-evals R233). */
export const MEMORY_SET_FILE = 'memory.json';

/**
 * Every set file, in the order the suite lists its sets: World Cup, World Cup
 * (REST API), Formula 1, World Cup (REST connector, BA-187), World Cup
 * (Databricks only, BA-186), then the synthetic domains (BA-185): Finance,
 * Health Insurance, Genomics, Supply Chain, Marketing Analytics; then the
 * memory sets (BA-190), before the RFP Builder's set (R11).
 */
export const EVAL_SET_FILES: readonly EvalSetFileSource[] = [
  { file: 'world-cup.json', content: worldCupSetFile },
  { file: 'formula-1.json', content: formula1SetFile },
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
  { file: MEMORY_SET_FILE, content: memorySetFile },
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
  'agentTools',
  'checks',
  'expectedSql',
  'resultSetOptions',
  'judgeRubric',
];
const CHECK_KEYS = ['type', 'args', 'criterion'];
const RESULT_SET_OPTION_KEYS = ['distinctRows'];
/** A memory case's fields (R234); `split` is the only optional one. */
const MEMORY_CASE_KEYS = [
  'id',
  'fixture',
  'category',
  'split',
  'tags',
  'intent',
  'notes',
  'teach',
  'probe',
];
const TEACH_SIGNAL_KEYS = ['kind', 'at', 'question', 'sql', 'note'];
const PROBE_KEYS = [
  'question',
  'expectedSql',
  'trapSql',
  'checks',
  'resultSetOptions',
];
const TEACH_KINDS: readonly TeachSignal['kind'][] = [
  'verified_query',
  'correction',
  'rejection',
];
const MAX_TEACH_SIGNALS = 3;
/** One of these per memory case (R234): the probe's language. */
const LANGUAGE_TAGS = ['lang:en', 'lang:es'];
/** And one of these. */
const DIFFICULTY_TAGS = [
  'difficulty:easy',
  'difficulty:medium',
  'difficulty:hard',
];
/** An ISO 8601 time in UTC (`2026-11-02T15:00:00Z`). */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;

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
  const memory = file === MEMORY_SET_FILE;
  if (memory) {
    // A probe has a PostgreSQL reference only (R233).
    const other = variants.find((v) => v.dialect !== 'postgres');
    if (other) {
      throw new EvalSetError(
        file,
        `variant "${other.id}"`,
        `a memory set runs on PostgreSQL only; dialect "${other.dialect}" is not postgres`,
      );
    }
  }
  const cases = content.cases.map((raw, index) =>
    memory
      ? parseMemoryCase(file, raw, index, variants)
      : parseCase(file, raw, index, dialects),
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
interface ParsedCase extends Omit<
  EvalCaseDefinition,
  'expectedSql' | 'trapSql'
> {
  expectedSql?: Partial<Record<EvalDialect, string>>;
  trapSql?: Partial<Record<EvalDialect, string>>;
  /** A memory case's sample: only the variant on it holds the case (R233). */
  fixture?: string;
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
    cases: cases.flatMap(({ expectedSql, trapSql, fixture, ...evalCase }) => {
      // A memory case belongs to the variant of its sample only (R233).
      if (fixture !== undefined && fixture !== variant.fixtureId) return [];
      const sql = expectedSql?.[variant.dialect];
      const trap = trapSql?.[variant.dialect];
      return [
        {
          ...evalCase,
          id: `${caseIdPrefix}${evalCase.id}`,
          ...(sql !== undefined ? { expectedSql: sql } : {}),
          ...(trap !== undefined ? { trapSql: trap } : {}),
        },
      ];
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
  // A memory category belongs to memory.json only (R236).
  const category = parseCategory(file, where, raw, QUESTION_CATEGORIES);
  const split = parseSplit(file, where, raw);
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
  const agentTools = parseAgentTools(file, where, raw.agentTools);
  const judgeRubric = optionalString(file, where, raw, 'judgeRubric');
  const { checks } = parseChecks(file, where, raw.checks, false);
  const expectedSql = parseExpectedSql(file, where, raw.expectedSql, dialects);
  validateDeterministicChecks(file, where, checks, expectedSql);
  const resultSetOptions = parseResultSetOptions(
    file,
    where,
    raw.resultSetOptions,
  );
  return {
    id,
    category,
    split,
    tags,
    question,
    intent,
    ...(notes !== undefined ? { notes } : {}),
    ...(agentTools ? { agentTools } : {}),
    checks,
    ...(expectedSql ? { expectedSql } : {}),
    ...(resultSetOptions ? { resultSetOptions } : {}),
    ...(judgeRubric !== undefined ? { judgeRubric } : {}),
  };
}

function parseCategory(
  file: string,
  where: string,
  raw: Json,
  categories: readonly EvalCategory[],
): EvalCategory {
  if (raw.category === undefined) {
    throw new EvalSetError(file, where, '"category" is required');
  }
  if (!categories.includes(raw.category as EvalCategory)) {
    throw new EvalSetError(
      file,
      where,
      `category ${JSON.stringify(raw.category)} is not one of ${oneOf(categories)}`,
    );
  }
  return raw.category as EvalCategory;
}

function parseSplit(file: string, where: string, raw: Json): EvalSplit {
  const split = raw.split ?? 'dev';
  if (!EVAL_SPLITS.includes(split as EvalSplit)) {
    throw new EvalSetError(
      file,
      where,
      `split ${JSON.stringify(split)} is not one of ${oneOf(EVAL_SPLITS)}`,
    );
  }
  return split as EvalSplit;
}

/** `usesEntities` without entities reads them from the reference (R125). */
function validateDeterministicChecks(
  file: string,
  where: string,
  checks: EvalCheckSpec[],
  expectedSql: Partial<Record<EvalDialect, string>> | undefined,
): void {
  checks.forEach((check, index) => {
    if (!isDeterministicCheckType(check.type)) return;
    const problem = DETERMINISTIC_CHECKS[check.type].validateCase?.(
      (check.args ?? {}) as Json,
      expectedSql,
    );
    if (problem) {
      throw new EvalSetError(file, `${where}, check #${index + 1}`, problem);
    }
  });
}

/**
 * A memory case of `memory.json` (agents-evals R234, R235): its own fields,
 * its teach signals and its probe, refused as R235 lists. It loads as a case
 * whose question, checks, reference and options are the probe's, plus its
 * `teach`, its `trapSql` and its memory checks; `fixture` picks the variant
 * that holds it.
 */
function parseMemoryCase(
  file: string,
  raw: unknown,
  index: number,
  variants: readonly EvalSetVariant[],
): ParsedCase {
  const at = `case #${index + 1}`;
  if (!isObject(raw)) throw new EvalSetError(file, at, 'must be an object');
  const id = requireString(file, at, raw, 'id');
  const where = `case "${id}"`;
  refuseUnknownKeys(file, where, raw, MEMORY_CASE_KEYS);
  if (!ID_PATTERN.test(id)) {
    throw new EvalSetError(
      file,
      where,
      'the id must be lowercase words joined by hyphens',
    );
  }
  const fixture = requireString(file, where, raw, 'fixture');
  const samples = Array.from(new Set(variants.map((v) => v.fixtureId)));
  if (!samples.includes(fixture)) {
    throw new EvalSetError(
      file,
      where,
      `fixture "${fixture}" is the sample of no variant of this file; known: ${oneOf(samples)}`,
    );
  }
  const category = parseCategory(file, where, raw, MEMORY_CATEGORIES);
  const split = parseSplit(file, where, raw);
  const tags = parseMemoryTags(file, where, raw.tags);
  const intent = requireString(file, where, raw, 'intent');
  const notes = requireString(file, where, raw, 'notes');
  const teach = parseTeach(file, where, raw.teach);
  if (
    category === 'memory-rejected' &&
    !teach.some((signal) => signal.kind === 'rejection')
  ) {
    throw new EvalSetError(
      file,
      where,
      'a memory-rejected case needs a "rejection" teach signal',
    );
  }

  const probe = raw.probe;
  if (!isObject(probe)) {
    throw new EvalSetError(
      file,
      where,
      '"probe" is required and must be an object',
    );
  }
  const inProbe = `${where}, probe`;
  refuseUnknownKeys(file, inProbe, probe, PROBE_KEYS);
  const question = requireString(file, inProbe, probe, 'question');
  const expectedSql = parsePostgresOnly(file, inProbe, probe, 'expectedSql');
  const trapSql = parsePostgresOnly(file, inProbe, probe, 'trapSql');
  const { checks, memoryChecks } = parseChecks(
    file,
    inProbe,
    probe.checks,
    true,
  );
  validateDeterministicChecks(file, inProbe, checks, expectedSql);
  const required: [MemoryCheckType, boolean, string][] = [
    ['noRowValuesRetained', true, 'every memory case'],
    [
      'notRejectedSql',
      category === 'memory-rejected',
      'a memory-rejected case',
    ],
    [
      'teachNotRecalled',
      category === 'memory-abstain',
      'a memory-abstain case',
    ],
  ];
  for (const [type, needed, who] of required) {
    if (needed && !memoryChecks.some((check) => check.type === type)) {
      throw new EvalSetError(
        file,
        inProbe,
        `the check "${type}" is required on ${who}`,
      );
    }
  }
  const resultSetOptions = parseResultSetOptions(
    file,
    inProbe,
    probe.resultSetOptions,
  );
  return {
    id,
    fixture,
    category,
    split,
    tags,
    question,
    intent,
    notes,
    checks,
    expectedSql,
    trapSql,
    ...(resultSetOptions ? { resultSetOptions } : {}),
    teach,
    memoryChecks,
  };
}

/** A memory case's tags: the probe's language and a difficulty (R234). */
function parseMemoryTags(file: string, where: string, raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every(isNonEmptyString)) {
    throw new EvalSetError(
      file,
      where,
      '"tags" is required and must be a non-empty array of non-empty strings',
    );
  }
  for (const [kind, wanted] of [
    ['language', LANGUAGE_TAGS],
    ['difficulty', DIFFICULTY_TAGS],
  ] as const) {
    if (!wanted.some((tag) => raw.includes(tag))) {
      throw new EvalSetError(
        file,
        where,
        `"tags" must name the ${kind} with one of ${oneOf(wanted)}`,
      );
    }
  }
  return raw;
}

/**
 * A memory case's teach signals (R234, R235): 1 to 3, in time order, each a
 * known kind at an ISO 8601 UTC time later than the one before it; a
 * correction has a note, an approval has none.
 */
function parseTeach(file: string, where: string, raw: unknown): TeachSignal[] {
  if (
    !Array.isArray(raw) ||
    raw.length === 0 ||
    raw.length > MAX_TEACH_SIGNALS
  ) {
    throw new EvalSetError(
      file,
      where,
      `"teach" is required and must hold 1 to ${MAX_TEACH_SIGNALS} signals`,
    );
  }
  let previous: { at: string; time: number } | undefined;
  return raw.map((signal, index): TeachSignal => {
    const at = `${where}, teach signal #${index + 1}`;
    if (!isObject(signal))
      throw new EvalSetError(file, at, 'must be an object');
    refuseUnknownKeys(file, at, signal, TEACH_SIGNAL_KEYS);
    const kind = signal.kind;
    if (!TEACH_KINDS.includes(kind as TeachSignal['kind'])) {
      throw new EvalSetError(
        file,
        at,
        `kind ${JSON.stringify(kind)} is not one of ${oneOf(TEACH_KINDS)}`,
      );
    }
    const time = requireString(file, at, signal, 'at');
    const parsed = Date.parse(time);
    if (!ISO_UTC.test(time) || Number.isNaN(parsed)) {
      throw new EvalSetError(
        file,
        at,
        `"at" ${JSON.stringify(time)} is not an ISO 8601 UTC time such as 2026-11-02T15:00:00Z`,
      );
    }
    if (previous && parsed <= previous.time) {
      throw new EvalSetError(
        file,
        at,
        `"at" ${time} is not later than the signal before it (${previous.at})`,
      );
    }
    previous = { at: time, time: parsed };
    const question = requireString(file, at, signal, 'question');
    const sql = requireString(file, at, signal, 'sql');
    const note = optionalString(file, at, signal, 'note');
    if (kind === 'correction' && note === undefined) {
      throw new EvalSetError(file, at, 'a correction needs a "note"');
    }
    if (kind === 'verified_query' && note !== undefined) {
      throw new EvalSetError(
        file,
        at,
        'an approval (verified_query) takes no "note"',
      );
    }
    return {
      kind: kind as TeachSignal['kind'],
      at: time,
      question,
      sql,
      ...(note !== undefined ? { note } : {}),
    };
  });
}

/**
 * A probe's `expectedSql` or `trapSql`: `{ postgres }` and nothing else,
 * since the memory bank has no other dialect (R233).
 */
function parsePostgresOnly(
  file: string,
  where: string,
  probe: Json,
  key: 'expectedSql' | 'trapSql',
): { postgres: string } {
  const raw = probe[key];
  if (!isObject(raw) || !isNonEmptyString(raw.postgres)) {
    throw new EvalSetError(
      file,
      where,
      `"${key}.postgres" is required and must be a non-empty string`,
    );
  }
  refuseUnknownKeys(file, `${where} ${key}`, raw, ['postgres']);
  return { postgres: raw.postgres };
}

/**
 * A case's tool selection: distinct optional tool ids (`sample_rows`,
 * `ask_clarification`, `visuals`); an empty list keeps only the always-on
 * tools. Those are never listed, so an unknown id is refused, not ignored.
 */
function parseAgentTools(
  file: string,
  where: string,
  raw: unknown,
): OptionalAgentTool[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    throw new EvalSetError(
      file,
      where,
      `"agentTools" must be an array of tool ids (${oneOf(OPTIONAL_AGENT_TOOLS)}); leave it out for every tool`,
    );
  }
  const seen = new Set<string>();
  for (const tool of raw as unknown[]) {
    if (!OPTIONAL_AGENT_TOOLS.includes(tool as OptionalAgentTool)) {
      throw new EvalSetError(
        file,
        where,
        `agentTools has an unknown tool ${JSON.stringify(tool)}; known: ${oneOf(OPTIONAL_AGENT_TOOLS)}`,
      );
    }
    if (seen.has(tool as string)) {
      throw new EvalSetError(
        file,
        where,
        `agentTools lists "${tool as string}" twice`,
      );
    }
    seen.add(tool as string);
  }
  return raw as OptionalAgentTool[];
}

function isMemoryCheckType(type: unknown): type is MemoryCheckType {
  return MEMORY_CHECK_TYPES.includes(type as MemoryCheckType);
}

/**
 * A case's checks, in file order. The memory checks of R241 to R243 come
 * apart in `memoryChecks` (only `memory.json` may hold them, since they need
 * a teach step, R235); every other check is in `checks`.
 */
function parseChecks(
  file: string,
  where: string,
  raw: unknown,
  memory: boolean,
): { checks: EvalCheckSpec[]; memoryChecks: MemoryCheckSpec[] } {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new EvalSetError(
      file,
      where,
      '"checks" is required and must be a non-empty array',
    );
  }
  const known: readonly string[] = memory
    ? [...EVAL_CHECK_TYPES, ...MEMORY_CHECK_TYPES]
    : EVAL_CHECK_TYPES;
  const seen = new Set<string>();
  const checks: EvalCheckSpec[] = [];
  const memoryChecks: MemoryCheckSpec[] = [];
  raw.forEach((check, index) => {
    const at = `${where}, check #${index + 1}`;
    if (!isObject(check)) throw new EvalSetError(file, at, 'must be an object');
    refuseUnknownKeys(file, at, check, CHECK_KEYS);
    const type = check.type;
    if (!memory && isMemoryCheckType(type)) {
      throw new EvalSetError(
        file,
        at,
        `check type "${type}" needs a teach step, so only ${MEMORY_SET_FILE} may use it`,
      );
    }
    if (!known.includes(type as string)) {
      throw new EvalSetError(
        file,
        at,
        `check type ${JSON.stringify(type)} is not one of ${oneOf(known)}`,
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
    const statedCriterion = (): string | undefined => {
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
      return stated;
    };
    if (isMemoryCheckType(type)) {
      // No arguments: the check reads the case's teach and the attempt's
      // memory record. Its criterion is M1, M2 or M3 unless named (R244).
      if (
        check.args !== undefined &&
        (!isObject(check.args) || Object.keys(check.args).length > 0)
      ) {
        throw new EvalSetError(file, at, `"${type}" takes no "args"`);
      }
      memoryChecks.push({
        type,
        criterion: statedCriterion() ?? MEMORY_CHECKS[type].criterion,
      });
      return;
    }
    const args = parseCheckArgs(file, at, type as EvalCheckType, check.args);
    const stated = statedCriterion();
    // A deterministic check measures its own criterion unless the file says
    // otherwise (R125); the Mastra helpers have none.
    const criterion =
      stated ??
      (isDeterministicCheckType(type)
        ? DETERMINISTIC_CHECKS[type].criterion
        : undefined);
    checks.push({
      type,
      ...(args ? { args } : {}),
      ...(criterion !== undefined ? { criterion } : {}),
    } as EvalCheckSpec);
  });
  return { checks, memoryChecks };
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
