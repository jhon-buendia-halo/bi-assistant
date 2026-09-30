import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, sep } from 'path';
import type { MastraScorer } from '@mastra/core/evals';
import type { AssistantEvalCase } from './assistant.evals';
import type { DatasetSnapshot } from '../tool-services';
import { findFixture, requiredEntities } from '../../modules/testing-data/fixtures/registry';
import { assistantEvalDatasetError } from './assistant-eval-datasets';
// Pure module: the same word rule that scores a trace decides here whether an
// expected phrase could ever be scored at all.
import {
  significantWords,
  type ExpectedReasoning,
} from '../../modules/expert-mode/expert-metrics';

export type { ExpectedReasoning };

/**
 * Eval suites, loaded from JSON instead of hard-coded TypeScript.
 *
 * The original suite was ten World Cup cases written as a TS array with live
 * `checks.*()` scorer objects inline. That worked while there was exactly one
 * fixture, but a suite per synthetic domain (health insurance, genomics — see
 * `docs/evals/synthetic-domains.md`) makes the TS array the wrong shape: cases
 * are data, they are written and reviewed alongside the fixture they probe,
 * and they must be diffable without a rebuild. So a suite is now a JSON file
 * in `suites/`, and the scorer objects are built from declarative `checks`
 * specs at load time.
 *
 * Two things stay in code on purpose:
 *
 * - **The check vocabulary.** A suite may only ask for checks this module
 *   knows how to build, so a typo in a JSON file fails loudly at load rather
 *   than silently scoring a case on fewer checks than its author intended.
 * - **The dataset preflight.** What a suite needs from the datasource
 *   (`requiredEntities`) is data, but the comparison — schema-qualified, last
 *   two dotted segments, one datasource of the suite's kind — is logic that
 *   every suite shares.
 *
 * A suite over one of the app's bundled samples names it with `fixtureId`
 * instead of listing entities: the Testing Data registry
 * (`modules/testing-data/fixtures/registry.ts`) stays the single source of
 * what that sample exposes, for the loader and the preflight alike.
 */

/**
 * The suite that ships with the app and the one every pre-suite caller
 * implicitly meant. Callers that take an optional `suiteId` default to this,
 * so existing runs, stored records and API clients keep their behaviour.
 */
export const DEFAULT_SUITE_ID = 'world-cup';

/** Folder next to this module holding one `<id>.json` per suite. */
const SUITES_DIRNAME = 'suites';

/**
 * One declarative assertion on a case, mapped to a `@mastra/evals/checks`
 * scorer by `toAssistantEvalCase`. Which fields a spec must carry depends on
 * its `type`; `validateCheck` enforces that pairing, since JSON cannot.
 */
export interface EvalCheckSpec {
  type:
    | 'includes'
    | 'excludes'
    | 'equals'
    | 'matches'
    | 'calledTool'
    | 'didNotCall'
    | 'toolOrder'
    | 'noToolErrors'
    | 'usedNoTools'
    | 'maxToolCalls';
  /** includes / excludes / equals — the substring compared against the answer. */
  value?: string;
  /** matches — a regular expression source, compiled at load time. */
  pattern?: string;
  /** matches — regex flags, e.g. `i`. */
  flags?: string;
  /** calledTool / didNotCall — the tool name. */
  tool?: string;
  /** toolOrder — the tools in the order they must appear. */
  tools?: string[];
  /** calledTool — how many times the tool must have been called (default 1). */
  times?: number;
  /** maxToolCalls — the ceiling on total tool calls. */
  max?: number;
}

export interface EvalSuiteCase {
  /** Short id used when reporting per-question scores; unique within a suite. */
  id: string;
  /**
   * The failure class this case probes, from the vocabulary in
   * `docs/evals/synthetic-domains.md` (`ratio-trap`, `value-vocabulary`,
   * `control`, …). Categories are what the improvement loop is steered by:
   * a run's pass rate per category says *what kind* of mistake the engine is
   * making, which an overall percentage cannot.
   */
  category: string;
  question: string;
  /** What the question is probing for, for the run report. */
  intent: string;
  /** Why this case exists and what regression it guards. Documentation only. */
  notes?: string;
  checks?: EvalCheckSpec[];
  /** Trusted SQL whose live result set is the reference answer. */
  expectedSql?: string;
  /**
   * `distinctRows`: compare distinct rows only (in-app result-set check).
   * `percentEquivalent`: a ratio may be reported as a fraction or a
   * percentage — the CLI also accepts the assistant's numbers scaled by 100
   * either way (use on rate questions; the reference must not round).
   */
  resultSetOptions?: { distinctRows?: boolean; percentEquivalent?: boolean };
  /** Grading rubric for cases a regex on the final answer would judge badly. */
  judgeRubric?: string;
  /**
   * What a correct business-expert trace should explain for this question:
   * the `schema.table` entities it must choose, short phrases its assumptions
   * must cover, and the metric it must define. Read only by the CLI's
   * `--expert` runs (coverage columns); it never affects the verdict.
   */
  expectedReasoning?: ExpectedReasoning;
}

/** The kinds of datasource a suite can be run against. */
export type EvalSuiteDatasourceKind = 'postgres' | 'rest';

/**
 * A suite derived from another one: the same questions, checks and rubrics
 * over a second datasource kind, with only the reference SQL ported. Keeps the
 * two in step by construction — a question edited in the base suite is edited
 * in its variant too.
 */
export interface EvalSuiteVariant {
  /** The base suite's id. It may not itself be a variant. */
  suite: string;
  /** Prepended to every base case id, so ids stay unique across suites. */
  idPrefix: string;
  /**
   * Reference SQL per base case id, in the variant's dialect. Every base case
   * with `expectedSql` must have an entry, so a new reference cannot silently
   * go ungraded in the variant.
   */
  expectedSql: Record<string, string>;
}

export interface EvalSuite {
  /** Matches the filename (`world-cup.json` → `world-cup`). */
  id: string;
  name: string;
  /**
   * For a suite without a `fixtureId`, doubles as the operator-facing setup
   * sentence: `suiteDatasetError` uses it verbatim when a run's data scope
   * does not satisfy the suite, so it should say what fixture to load and
   * where the setup instructions live.
   */
  description?: string;
  /**
   * The bundled sample this suite questions, by `SampleFixture.id`. When set,
   * `requiredEntities`, `datasourceKind` and the default `datasets` come from
   * the fixture registry and may not be repeated in the file.
   */
  fixtureId?: string;
  /** The kind of datasource the suite runs against; `postgres` by default. */
  datasourceKind: EvalSuiteDatasourceKind;
  /** The dataset names this suite is written against, as a default/hint. */
  datasets: string[];
  /** Schema-qualified tables and views the suite cannot run without. */
  requiredEntities: string[];
  /** Set when the cases were derived from another suite. */
  variantOf?: EvalSuiteVariant;
  cases: EvalSuiteCase[];
}

/* --------------------------------------------------------------- location */

/**
 * Where the suite JSON lives. This has to work from two places: `src/` under
 * ts-node/jest, and `dist/` after `nest build` — which is why
 * `mastra/evals/suites/**\/*` is declared in `nest-cli.json`'s assets, the same
 * way `mastra/skills` is. When the dist copy is missing (a stale build, or a
 * runner that compiled without the asset step), fall back to the `src` tree
 * rather than reporting "no suites": an eval harness that silently finds
 * nothing is worse than one that runs slightly stale cases.
 *
 * `fromDir` exists so the fallback is unit-testable against a fake tree; every
 * caller uses the default and the exported contract stays `(): string`.
 */
export function suiteDirectory(fromDir: string = __dirname): string {
  const compiled = join(fromDir, SUITES_DIRNAME);
  if (existsSync(compiled)) return compiled;
  const fromSource = swapDistForSrc(compiled);
  return fromSource && existsSync(fromSource) ? fromSource : compiled;
}

/**
 * `<root>/dist/mastra/evals/suites` → `<root>/src/mastra/evals/suites`. The
 * *last* `dist` segment is the build output — a checkout that happens to live
 * under a folder called `dist` must not be rewritten at its first match.
 */
function swapDistForSrc(dir: string): string | undefined {
  const segments = dir.split(sep);
  const index = segments.lastIndexOf('dist');
  if (index < 0) return undefined;
  segments[index] = 'src';
  return segments.join(sep);
}

/* ------------------------------------------------------------ validation */

/** Every check type this module can build a scorer for. */
const CHECK_TYPES = new Set<EvalCheckSpec['type']>([
  'includes',
  'excludes',
  'equals',
  'matches',
  'calledTool',
  'didNotCall',
  'toolOrder',
  'noToolErrors',
  'usedNoTools',
  'maxToolCalls',
]);

/** Suite ids become filenames, so they may not reach outside the folder. */
const SUITE_ID = /^[a-z0-9][a-z0-9-]*$/i;

function fail(file: string, message: string): never {
  throw new Error(`Invalid eval suite ${file}: ${message}`);
}

function requiredString(value: unknown, file: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail(file, `${field} must be a non-empty string`);
  }
  return (value as string).trim();
}

function stringArray(value: unknown, file: string, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(file, `${field} must be a non-empty array of strings`);
  }
  return (value as unknown[]).map((entry, index) =>
    requiredString(entry, file, `${field}[${index}]`),
  );
}

/**
 * Enforce the field/type pairing JSON cannot express, and compile `matches`
 * patterns eagerly — a regex that only blows up mid-run would waste every
 * model call the run had already paid for.
 */
function validateCheck(
  check: unknown,
  file: string,
  where: string,
): EvalCheckSpec {
  if (!check || typeof check !== 'object') {
    fail(file, `${where} has a check that is not an object`);
  }
  const spec = check as EvalCheckSpec;
  if (!CHECK_TYPES.has(spec.type)) {
    fail(
      file,
      `${where} has an unknown check type "${String(spec.type)}" — known types: ${[
        ...CHECK_TYPES,
      ].join(', ')}`,
    );
  }
  const label = `${where} check "${spec.type}"`;
  switch (spec.type) {
    case 'includes':
    case 'excludes':
    case 'equals':
      requiredString(spec.value, file, `${label}.value`);
      break;
    case 'matches':
      requiredString(spec.pattern, file, `${label}.pattern`);
      try {
        new RegExp(spec.pattern as string, spec.flags);
      } catch (err) {
        fail(
          file,
          `${label}.pattern is not a valid regular expression: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      break;
    case 'calledTool':
      requiredString(spec.tool, file, `${label}.tool`);
      if (spec.times !== undefined && !Number.isInteger(spec.times)) {
        fail(file, `${label}.times must be an integer`);
      }
      break;
    case 'didNotCall':
      requiredString(spec.tool, file, `${label}.tool`);
      break;
    case 'toolOrder':
      stringArray(spec.tools, file, `${label}.tools`);
      break;
    case 'maxToolCalls':
      if (!Number.isInteger(spec.max)) {
        fail(file, `${label}.max must be an integer`);
      }
      break;
    default:
      // noToolErrors / usedNoTools take no arguments.
      break;
  }
  return spec;
}

/** Keys `expectedReasoning` may carry — anything else is a typo. */
const EXPECTED_REASONING_KEYS = ['tables', 'assumptions', 'metric'];

/** Exactly two dot-separated segments: `hr.employees`, not `employees` or `db.hr.employees`. */
const SCHEMA_TABLE = /^[^.\s]+\.[^.\s]+$/;

/**
 * Validate a case's `expectedReasoning`. Exported so the CLI can hold a case
 * file given by path to the same rules as a registered suite.
 *
 * Strict on purpose: an unknown key (`table` for `tables`) or a phrase with no
 * word of four or more letters would not fail a run — it would silently make
 * a coverage column read 100% (or never move), which is worse.
 */
export function parseExpectedReasoning(
  value: unknown,
  file: string,
  where: string,
): ExpectedReasoning {
  const label = `${where}.expectedReasoning`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(file, `${label} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).filter(
    (key) => !EXPECTED_REASONING_KEYS.includes(key),
  );
  if (unknown.length) {
    fail(
      file,
      `${label} has unknown field(s) ${unknown.map((key) => `"${key}"`).join(', ')} — known fields: ${EXPECTED_REASONING_KEYS.join(', ')}`,
    );
  }
  const parsed: ExpectedReasoning = {};
  if (raw.tables !== undefined) {
    const tables = stringArray(raw.tables, file, `${label}.tables`);
    tables.forEach((table, index) => {
      if (!SCHEMA_TABLE.test(table)) {
        fail(
          file,
          `${label}.tables[${index}] "${table}" must be schema.table (e.g. hr.employees)`,
        );
      }
    });
    parsed.tables = tables;
  }
  if (raw.assumptions !== undefined) {
    const assumptions = stringArray(
      raw.assumptions,
      file,
      `${label}.assumptions`,
    );
    assumptions.forEach((phrase, index) => {
      if (!significantWords(phrase).length) {
        fail(
          file,
          `${label}.assumptions[${index}] "${phrase}" has no word of four or more letters, so no trace could ever be scored against it`,
        );
      }
    });
    parsed.assumptions = assumptions;
  }
  if (raw.metric !== undefined) {
    parsed.metric = requiredString(raw.metric, file, `${label}.metric`);
  }
  if (!parsed.tables && !parsed.assumptions && parsed.metric === undefined) {
    fail(
      file,
      `${label} must carry at least one of ${EXPECTED_REASONING_KEYS.join(', ')}`,
    );
  }
  return parsed;
}

function validateCase(
  value: unknown,
  file: string,
  index: number,
): EvalSuiteCase {
  if (!value || typeof value !== 'object') {
    fail(file, `cases[${index}] is not an object`);
  }
  const raw = value as Record<string, unknown>;
  const id = requiredString(raw.id, file, `cases[${index}].id`);
  const where = `case "${id}"`;
  const parsed: EvalSuiteCase = {
    id,
    category: requiredString(raw.category, file, `${where}.category`),
    question: requiredString(raw.question, file, `${where}.question`),
    intent: requiredString(raw.intent, file, `${where}.intent`),
  };
  if (raw.notes !== undefined) {
    parsed.notes = requiredString(raw.notes, file, `${where}.notes`);
  }
  if (raw.expectedSql !== undefined) {
    parsed.expectedSql = requiredString(
      raw.expectedSql,
      file,
      `${where}.expectedSql`,
    );
  }
  if (raw.judgeRubric !== undefined) {
    parsed.judgeRubric = requiredString(
      raw.judgeRubric,
      file,
      `${where}.judgeRubric`,
    );
  }
  if (raw.resultSetOptions !== undefined) {
    const options = raw.resultSetOptions as {
      distinctRows?: unknown;
      percentEquivalent?: unknown;
    };
    if (!options || typeof options !== 'object') {
      fail(file, `${where}.resultSetOptions must be an object`);
    }
    parsed.resultSetOptions = {
      ...(options.distinctRows === undefined
        ? {}
        : { distinctRows: Boolean(options.distinctRows) }),
      ...(options.percentEquivalent === undefined
        ? {}
        : { percentEquivalent: Boolean(options.percentEquivalent) }),
    };
  }
  if (raw.checks !== undefined) {
    if (!Array.isArray(raw.checks)) {
      fail(file, `${where}.checks must be an array`);
    }
    parsed.checks = raw.checks.map((check) =>
      validateCheck(check, file, where),
    );
    // `runEvals` keys scores by scorer id, so a second check of the same type
    // overwrites the first one's score instead of being graded on its own.
    const seenTypes = new Set<string>();
    for (const check of parsed.checks) {
      if (seenTypes.has(check.type)) {
        fail(
          file,
          `${where} uses the "${check.type}" check twice — scores are keyed by check type, ` +
            'so one would silently replace the other. Combine them (e.g. one regex with lookaheads).',
        );
      }
      seenTypes.add(check.type);
    }
  }
  if (raw.expectedReasoning !== undefined) {
    parsed.expectedReasoning = parseExpectedReasoning(
      raw.expectedReasoning,
      file,
      where,
    );
  }
  return parsed;
}

const DATASOURCE_KINDS = new Set<EvalSuiteDatasourceKind>(['postgres', 'rest']);

/**
 * Validate a `variantOf` block and derive the variant's cases from its base.
 * Mirrors the rules the TS-defined REST set enforced: an override for a case
 * the base does not have, or a base reference with no port, fails the load.
 */
function deriveVariantCases(
  value: unknown,
  file: string,
  resolveBase: ((id: string) => EvalSuite) | undefined,
): { variant: EvalSuiteVariant; cases: EvalSuiteCase[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(file, 'variantOf must be an object');
  }
  const raw = value as Record<string, unknown>;
  const baseId = requiredString(raw.suite, file, 'variantOf.suite');
  const idPrefix = requiredString(raw.idPrefix, file, 'variantOf.idPrefix');
  const sql = raw.expectedSql ?? {};
  if (!sql || typeof sql !== 'object' || Array.isArray(sql)) {
    fail(file, 'variantOf.expectedSql must be an object of case id → SQL');
  }
  const expectedSql: Record<string, string> = {};
  for (const [caseId, statement] of Object.entries(sql)) {
    expectedSql[caseId] = requiredString(
      statement,
      file,
      `variantOf.expectedSql["${caseId}"]`,
    );
  }
  if (!resolveBase) {
    fail(file, `variantOf needs suite "${baseId}" but no suite resolver was given`);
  }
  const base = resolveBase(baseId);
  if (base.variantOf) {
    fail(file, `variantOf.suite "${baseId}" is itself a variant`);
  }
  const unknown = Object.keys(expectedSql).filter(
    (caseId) => !base.cases.some((evalCase) => evalCase.id === caseId),
  );
  if (unknown.length > 0) {
    fail(
      file,
      `variantOf.expectedSql names cases suite "${baseId}" does not have: ${unknown.join(', ')}`,
    );
  }
  const cases = base.cases.map(({ id, expectedSql: baseSql, ...rest }) => {
    if (baseSql && !expectedSql[id]) {
      fail(file, `case "${id}" of suite "${baseId}" has expectedSql but no port`);
    }
    return {
      ...rest,
      id: `${idPrefix}${id}`,
      ...(baseSql ? { expectedSql: expectedSql[id] } : {}),
    };
  });
  return { variant: { suite: baseId, idPrefix, expectedSql }, cases };
}

/**
 * Parse and validate one suite file. Everything that can be wrong with a suite
 * is caught here, named by file and case, because the alternative is a run
 * that starts, spends tokens and then reports a case as failing for a reason
 * that is really a typo in its definition.
 *
 * `resolveBase` loads the suite a `variantOf` block points at; only suites
 * that declare `variantOf` need it.
 */
export function parseSuite(
  raw: unknown,
  file: string,
  resolveBase?: (id: string) => EvalSuite,
): EvalSuite {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    fail(file, 'the file must contain a JSON object');
  }
  const source = raw as Record<string, unknown>;
  const id = requiredString(source.id, file, 'id');
  const suite: EvalSuite = {
    id,
    name: requiredString(source.name, file, 'name'),
    datasourceKind: 'postgres',
    datasets: [],
    requiredEntities: [],
    cases: [],
  };
  if (source.description !== undefined) {
    suite.description = requiredString(source.description, file, 'description');
  }
  if (source.fixtureId !== undefined) {
    const fixtureId = requiredString(source.fixtureId, file, 'fixtureId');
    const fixture = findFixture(fixtureId);
    if (!fixture) {
      fail(file, `fixtureId "${fixtureId}" is not in the sample fixture registry`);
    }
    // One source of truth: what a bundled sample exposes lives in the
    // registry, so a suite repeating it could only ever drift from it.
    for (const field of ['requiredEntities', 'datasourceKind'] as const) {
      if (source[field] !== undefined) {
        fail(file, `${field} comes from fixture "${fixtureId}" — remove it from the suite`);
      }
    }
    suite.fixtureId = fixtureId;
    suite.datasourceKind = fixture.datasourceKind ?? 'postgres';
    suite.requiredEntities = requiredEntities(fixture);
    suite.datasets =
      source.datasets === undefined
        ? [fixture.datasetName]
        : stringArray(source.datasets, file, 'datasets');
  } else {
    suite.datasets = stringArray(source.datasets, file, 'datasets');
    suite.requiredEntities = stringArray(
      source.requiredEntities,
      file,
      'requiredEntities',
    );
    if (source.datasourceKind !== undefined) {
      const kind = requiredString(source.datasourceKind, file, 'datasourceKind');
      if (!DATASOURCE_KINDS.has(kind as EvalSuiteDatasourceKind)) {
        fail(file, `datasourceKind must be one of: ${[...DATASOURCE_KINDS].join(', ')}`);
      }
      suite.datasourceKind = kind as EvalSuiteDatasourceKind;
    }
  }
  if (source.variantOf !== undefined) {
    if (source.cases !== undefined) {
      fail(file, 'a suite with variantOf takes its cases from the base suite — remove cases');
    }
    const { variant, cases } = deriveVariantCases(
      source.variantOf,
      file,
      resolveBase,
    );
    suite.variantOf = variant;
    suite.cases = cases;
  } else {
    if (!Array.isArray(source.cases) || source.cases.length === 0) {
      fail(file, 'cases must be a non-empty array');
    }
    suite.cases = source.cases.map((entry, index) =>
      validateCase(entry, file, index),
    );
  }
  // `runEvals` keys scores by case id and the run report matches cases across
  // runs by id — duplicates would silently merge two questions into one.
  const seen = new Set<string>();
  for (const evalCase of suite.cases) {
    if (seen.has(evalCase.id)) {
      fail(file, `duplicate case id "${evalCase.id}"`);
    }
    seen.add(evalCase.id);
  }
  return suite;
}

/* --------------------------------------------------------------- loading */

function readSuiteFile(file: string): EvalSuite {
  return parseSuite(readSuiteJson(file), file, (baseId) =>
    readSuiteFile(join(suiteDirectory(), `${baseId}.json`)),
  );
}

function readSuiteJson(file: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(
      `Invalid eval suite ${file}: could not be read as JSON — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  return parsed;
}

/**
 * Every suite on disk, id-sorted. Read fresh on each call rather than cached:
 * suites are a handful of small files, and editing one while the backend is
 * running should show up in the Evals tab without a restart.
 *
 * A missing folder yields an empty list instead of throwing — `loadSuite` is
 * where a missing suite becomes a loud error, and a listing endpoint that
 * throws would take the whole Agents page down with it.
 */
export function listSuites(): EvalSuite[] {
  const dir = suiteDirectory();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => readSuiteFile(join(dir, entry)))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** One suite by id, with an error that names what is actually available. */
export function loadSuite(id: string): EvalSuite {
  const wanted = (id ?? '').trim();
  if (!SUITE_ID.test(wanted)) {
    throw new Error(
      `Unknown eval suite "${id}" — a suite id is letters, digits and hyphens.`,
    );
  }
  const dir = suiteDirectory();
  const file = join(dir, `${wanted}.json`);
  if (!existsSync(file)) {
    const available = existsSync(dir)
      ? readdirSync(dir)
          .filter((entry) => entry.endsWith('.json'))
          .map((entry) => entry.replace(/\.json$/, ''))
      : [];
    throw new Error(
      `Unknown eval suite "${wanted}". Looked in ${dir}. ` +
        (available.length
          ? `Available suites: ${available.join(', ')}.`
          : 'No suite files found there — was mastra/evals/suites copied into dist?'),
    );
  }
  const suite = readSuiteFile(file);
  // The filename is what callers select by, so a mismatch would make
  // `loadSuite(suite.id)` fail for a suite that plainly exists.
  if (suite.id !== wanted) {
    throw new Error(
      `Invalid eval suite ${file}: declares id "${suite.id}" but is named "${wanted}.json".`,
    );
  }
  return suite;
}

/* ---------------------------------------------------------- check mapping */

type ChecksModule = typeof import('@mastra/evals/checks');

let checksCache: ChecksModule['checks'] | undefined;

/**
 * `@mastra/evals/checks` is pulled in lazily, not imported at the top of this
 * file, because loading it drags in the whole Mastra core — including
 * ESM-only transitive dependencies. Everything else here (parsing, validating,
 * the dataset preflight) is plain data work that callers and unit tests must
 * be able to do without standing up a model stack, and only
 * `toAssistantEvalCase` actually needs a live scorer.
 */
function checkFactories(): ChecksModule['checks'] {
  checksCache ??= (require('@mastra/evals/checks') as ChecksModule).checks;
  return checksCache;
}

function toScorer(spec: EvalCheckSpec): MastraScorer<any, any, any, any> {
  const checks = checkFactories();
  switch (spec.type) {
    case 'includes':
      return checks.includes(spec.value as string);
    case 'excludes':
      return checks.excludes(spec.value as string);
    case 'equals':
      return checks.equals(spec.value as string);
    case 'matches':
      return checks.matches(new RegExp(spec.pattern as string, spec.flags));
    case 'calledTool':
      return checks.calledTool(
        spec.tool as string,
        spec.times === undefined ? undefined : { times: spec.times },
      );
    case 'didNotCall':
      return checks.didNotCall(spec.tool as string);
    case 'toolOrder':
      return checks.toolOrder(spec.tools as string[]);
    case 'maxToolCalls':
      return checks.maxToolCalls(spec.max as number);
    case 'usedNoTools':
      return checks.usedNoTools();
    case 'noToolErrors':
      return checks.noToolErrors();
    default:
      // Unreachable for a validated suite; kept so an added type that skips
      // `toScorer` fails here instead of scoring the case on fewer checks.
      throw new Error(`Unsupported eval check type "${String(spec.type)}"`);
  }
}

/**
 * A JSON case as the runner wants it: declarative specs become live scorer
 * objects, everything else passes straight through.
 *
 * `runEvals` keys its scores by scorer id, so two scorers of the same kind in
 * one case collide — a case must use each check type at most once, which is a
 * property of the suite file, not something this mapping can repair.
 */
export function toAssistantEvalCase(c: EvalSuiteCase): AssistantEvalCase {
  return {
    id: c.id,
    category: c.category,
    question: c.question,
    intent: c.intent,
    scorers: (c.checks ?? []).map(toScorer),
    ...(c.expectedSql ? { expectedSql: c.expectedSql } : {}),
    ...(c.resultSetOptions ? { resultSetOptions: c.resultSetOptions } : {}),
    ...(c.judgeRubric ? { judgeRubric: c.judgeRubric } : {}),
  };
}

/* ------------------------------------------------------------- preflight */

/**
 * Validate a run's data scope before creating a run or spending model tokens.
 * Dataset *names* are user-defined, so this matches on schema-qualified
 * entities instead. It checks the saved scope, not whether the live fixture's
 * rows have drifted.
 *
 * The suite's `description` carries the operator-facing setup sentence (what
 * fixture to load, where the instructions live), because only the suite's
 * author knows how its fixture is installed.
 */
export function suiteDatasetError(
  suite: EvalSuite,
  names: string[],
  snapshots: DatasetSnapshot[],
): string | undefined {
  // A bundled sample's preflight — and its operator-facing message — belongs
  // to the registry, so the Testing Data panel and the suite say the same.
  if (suite.fixtureId) {
    const fixture = findFixture(suite.fixtureId);
    if (fixture) return assistantEvalDatasetError(names, snapshots, fixture);
  }
  const kindLabel = suite.datasourceKind === 'rest' ? 'REST API' : 'PostgreSQL';
  const setup =
    suite.description?.trim() ||
    `These evals require the ${suite.name} fixture (suite "${suite.id}"). ` +
      `Select its ${kindLabel} datasource and save a dataset containing: ` +
      `${suite.requiredEntities.join(', ')}.`;
  const selected = snapshots.filter((dataset) => names.includes(dataset.name));
  const missingNames = names.filter(
    (name) => !selected.some((dataset) => dataset.name === name),
  );
  if (names.length === 0 || missingNames.length > 0) {
    return `${setup} ${missingNames.length ? `Datasets not found: ${missingNames.join(', ')}.` : 'No datasets selected.'}`;
  }
  const datasourceIds = new Set(
    selected.map((dataset) => dataset.datasourceId),
  );
  if (
    datasourceIds.size !== 1 ||
    datasourceIds.has(undefined) ||
    datasourceIds.has('') ||
    selected.some((dataset) => dataset.datasourceKind !== suite.datasourceKind)
  ) {
    return `${setup} The selected datasets must belong to one ${kindLabel} datasource.`;
  }
  // Inventory keys are catalog.schema.table (`api.schema.table` for REST);
  // older snapshots may have schema.table. Never accept a similarly named
  // table in another schema.
  const entities = new Set(
    selected.flatMap((dataset) =>
      dataset.tables.map((table) =>
        table.toLowerCase().split('.').slice(-2).join('.'),
      ),
    ),
  );
  const missing = suite.requiredEntities.filter(
    (entity) => !entities.has(entity.toLowerCase()),
  );
  if (missing.length > 0) {
    return `${setup} Selected datasets: ${names.join(', ')}. Missing entities: ${missing.join(', ')}.`;
  }
  return undefined;
}
