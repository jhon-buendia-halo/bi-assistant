import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, sep } from 'path';
import type { AssistantEvalCase } from './assistant.evals';
import { describeChecks } from './eval-checks';
import type { EvalCheckDescription } from './eval-checks';
import type { DatasetSnapshot } from '../tool-services';
import type { EvalDifficulty } from '../../modules/agents/eval-telemetry';
import { findFixture, requiredEntities } from '../../modules/testing-data/fixtures/registry';
import {
  acceptedDatasourceKinds,
  assistantEvalDatasetError,
  datasourceKindLabel,
} from './assistant-eval-datasets';
// Pure module: the same word rule that scores a trace decides here whether an
// expected phrase could ever be scored at all.
import {
  significantWords,
  type ExpectedReasoning,
} from '../../modules/expert-mode/expert-metrics';
// Pure entity module (types and constants only): the block kinds a scripted
// reviewer note may target are exactly the ones the feedback endpoint accepts.
import {
  REASONING_BLOCK_KINDS,
  type BlockVote,
  type ConfidenceBand,
  type ReasoningBlockKind,
} from '../../modules/expert-mode/entities/reasoning-trace.entity';

export type { ExpectedReasoning };

/** One scripted reviewer note: what a reviewer writes on one reasoning block. */
export interface LearningComment {
  block: ReasoningBlockKind;
  vote?: BlockVote;
  comment: string;
}

/**
 * A learning-from-feedback scenario on a trap case: the reviewer notes that
 * should teach the engine the missing facts, the other cases in the suite
 * those facts must also fix (with no notes of their own), and the confidence
 * band expected before and after. Read by the learning demo
 * (`npm run learning:demo`); `run-eval` reports the bands but never enforces
 * them, and the in-app runner ignores the field.
 */
export interface LearningScenario {
  /** At least one; posted in order on the first answer's reasoning trace. */
  comments: LearningComment[];
  /** Case ids in the same suite that must pass after these comments. */
  generalisesTo?: string[];
  before?: { band: ConfidenceBand };
  after?: { band: ConfidenceBand };
}

/**
 * Eval suites, loaded from JSON instead of hard-coded TypeScript.
 *
 * The original suite was ten World Cup cases written as a TS array with live
 * `checks.*()` scorer objects inline. That worked while there was exactly one
 * fixture, but a suite per synthetic domain (health insurance, genomics — see
 * `docs/evals/synthetic-domains.md`) makes the TS array the wrong shape: cases
 * are data, they are written and reviewed alongside the fixture they probe,
 * and they must be diffable without a rebuild. So a suite is now a JSON file
 * in `suites/`, and its `checks` are declarative specs that `eval-checks.ts`
 * evaluates against the finished production turn (`TurnResult`).
 *
 * Two things stay in code on purpose:
 *
 * - **The check vocabulary.** A suite may only ask for checks this module
 *   knows how to build, so a typo in a JSON file fails loudly at load rather
 *   than silently scoring a case on fewer checks than its author intended.
 * - **The dataset preflight.** What a suite needs from the datasource
 *   (`requiredEntities`) is data, but the comparison — schema-qualified, last
 *   two dotted segments, one datasource of the suite's kind (a PostgreSQL
 *   suite also runs on a Databricks copy of its fixture) — is logic that
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
 * One declarative assertion on a case, evaluated by `eval-checks.ts` on the
 * final turn. Which fields a spec must carry depends on its `type`;
 * `validateCheck` enforces that pairing, since JSON cannot.
 *
 * `finalSqlSucceeded` passes when the answer's last `run_readonly_sql`
 * succeeded — what `noToolErrors` was being used for, without failing a turn
 * that hit an error, recovered and answered correctly.
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
    | 'maxToolCalls'
    | 'finalSqlSucceeded';
  /** includes / excludes / equals — the substring compared against the answer. */
  value?: string;
  /** matches — a regular expression source, compiled at load time. */
  pattern?: string;
  /**
   * matches — regex flags. Absent = `i`: an answer that writes "Paid" for
   * `PAID` is not wrong, and a case-sensitive default failed correct answers.
   * `""` asks for a case-sensitive match explicitly.
   */
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
   * Further references that are equally correct, for a question that
   * legitimately admits more than one answer the data cannot decide between
   * — typically a unit the question does not name (cents or dollars, a
   * fraction or a percentage). The result-set check passes when an answer
   * matches ANY reference (`referenceSqlsFor`). Never a way to accept a wrong
   * answer. Postgres/portable SQL: there is no per-dialect form, and an
   * alternative that cannot run on a datasource only costs that alternative.
   * Only allowed alongside `expectedSql`.
   */
  expectedSqlAlternatives?: string[];
  /**
   * `distinctRows`: compare distinct rows only.
   * `percentEquivalent`: a ratio may be reported as a fraction or a
   * percentage — the result-set check also accepts the assistant's numbers
   * scaled by 100 either way (use on rate questions; the reference must not
   * round). Both runners honour it: they share the result-set check.
   */
  resultSetOptions?: { distinctRows?: boolean; percentEquivalent?: boolean };
  /** Grading rubric for cases a regex on the final answer would judge badly. */
  judgeRubric?: string;
  /** How hard the question is for a careful analyst, for the per-difficulty table. */
  difficulty?: EvalDifficulty;
  /**
   * Paraphrases of `question` with the same answer. Run only when a caller
   * asks (`expandVariants(suite, true)`): they measure whether a pass was the
   * wording or the understanding.
   */
  variants?: string[];
  /**
   * The plausible wrong query this case is a trap for (the ratio of the wrong
   * columns, the count without the default filter). `eval:validate` asserts
   * its result differs from `expectedSql`'s — a trap whose wrong answer
   * happens to equal the right one tests nothing.
   */
  trapSql?: string;
  /** Per-dialect reference SQL; `referenceSqlFor` falls back to `expectedSql`. */
  expectedSqlByDialect?: { postgres?: string; databricks?: string };
  /** `hand` = written and verified by a person; `model-drafted-verified` = drafted by a model, rows read by a person. */
  provenance?: EvalCaseProvenance;
  /**
   * What a correct business-expert trace should explain for this question:
   * the `schema.table` entities it must choose, short phrases its assumptions
   * must cover, and the metric it must define. Read only by the CLI's
   * `--expert` runs (coverage columns); it never affects the verdict.
   */
  expectedReasoning?: ExpectedReasoning;
  /**
   * The reviewer notes that should turn this case from FAIL to PASS, and the
   * cases they must generalise to. Only a trap case carries one; see
   * `LearningScenario`.
   */
  learningScenario?: LearningScenario;
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

export type { EvalDifficulty };
export type EvalCaseProvenance = 'hand' | 'model-drafted-verified';
export type SqlDialect = 'postgres' | 'databricks';

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

/** Every check type `eval-checks.ts` can evaluate. */
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
  'finalSqlSucceeded',
]);

const DIFFICULTIES = new Set<EvalDifficulty>(['easy', 'medium', 'hard']);
const PROVENANCES = new Set<EvalCaseProvenance>([
  'hand',
  'model-drafted-verified',
]);
const DIALECTS = new Set<SqlDialect>(['postgres', 'databricks']);

/** Suite ids become filenames, so they may not reach outside the folder. */
const SUITE_ID = /^[a-z0-9][a-z0-9-]*$/i;

function fail(file: string, message: string): never {
  throw new Error(`Invalid eval suite ${file}: ${message}`);
}

function requiredString(value: unknown, file: string, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    fail(file, `${field} must be a non-empty string`);
  }
  return value.trim();
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
      if (spec.flags !== undefined && typeof spec.flags !== 'string') {
        fail(file, `${label}.flags must be a string`);
      }
      try {
        new RegExp(spec.pattern as string, spec.flags ?? 'i');
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
      // noToolErrors / usedNoTools / finalSqlSucceeded take no arguments.
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

/** Keys each part of a `learningScenario` may carry — anything else is a typo. */
const LEARNING_SCENARIO_KEYS = ['comments', 'generalisesTo', 'before', 'after'];
const LEARNING_COMMENT_KEYS = ['block', 'vote', 'comment'];
const BAND_EXPECTATION_KEYS = ['band'];
const BLOCK_VOTES: BlockVote[] = ['up', 'down'];
const CONFIDENCE_BAND_NAMES: ConfidenceBand[] = ['high', 'medium', 'low'];

/** A plain JSON object whose keys are all in `known`; fails naming the strays. */
function strictObject(
  value: unknown,
  known: string[],
  file: string,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(file, `${label} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((key) => !known.includes(key));
  if (unknown.length) {
    fail(
      file,
      `${label} has unknown field(s) ${unknown.map((key) => `"${key}"`).join(', ')} — known fields: ${known.join(', ')}`,
    );
  }
  return raw;
}

function parseBandExpectation(
  value: unknown,
  file: string,
  label: string,
): { band: ConfidenceBand } {
  const raw = strictObject(value, BAND_EXPECTATION_KEYS, file, label);
  const band = raw.band as ConfidenceBand;
  if (!CONFIDENCE_BAND_NAMES.includes(band)) {
    fail(
      file,
      `${label}.band must be one of ${CONFIDENCE_BAND_NAMES.join(', ')}, got ${JSON.stringify(raw.band)}`,
    );
  }
  return { band };
}

/**
 * Validate a case's `learningScenario` shape. Strict for the same reason as
 * `expectedReasoning`: a misspelt `vote` or block kind would not fail a run —
 * the demo would post a note the feedback endpoint rejects, or teach nothing,
 * and report the engine as unable to learn. Whether `generalisesTo` names
 * real cases is checked by `parseSuite`, once every case id is known.
 */
function parseLearningScenario(
  value: unknown,
  file: string,
  where: string,
): LearningScenario {
  const label = `${where}.learningScenario`;
  const raw = strictObject(value, LEARNING_SCENARIO_KEYS, file, label);
  if (!Array.isArray(raw.comments) || raw.comments.length === 0) {
    fail(file, `${label}.comments must be a non-empty array`);
  }
  const comments = (raw.comments as unknown[]).map(
    (entry, index): LearningComment => {
      const at = `${label}.comments[${index}]`;
      const comment = strictObject(entry, LEARNING_COMMENT_KEYS, file, at);
      const block = comment.block as ReasoningBlockKind;
      if (!REASONING_BLOCK_KINDS.includes(block)) {
        fail(
          file,
          `${at}.block must be one of ${REASONING_BLOCK_KINDS.join(', ')}, got ${JSON.stringify(comment.block)}`,
        );
      }
      const parsed: LearningComment = {
        block,
        comment: requiredString(comment.comment, file, `${at}.comment`),
      };
      if (comment.vote !== undefined) {
        if (!BLOCK_VOTES.includes(comment.vote as BlockVote)) {
          fail(
            file,
            `${at}.vote must be one of ${BLOCK_VOTES.join(', ')}, got ${JSON.stringify(comment.vote)}`,
          );
        }
        parsed.vote = comment.vote as BlockVote;
      }
      return parsed;
    },
  );
  const scenario: LearningScenario = { comments };
  if (raw.generalisesTo !== undefined) {
    const ids = stringArray(raw.generalisesTo, file, `${label}.generalisesTo`);
    const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
    if (duplicate !== undefined) {
      fail(file, `${label}.generalisesTo lists "${duplicate}" twice`);
    }
    scenario.generalisesTo = ids;
  }
  if (raw.before !== undefined) {
    scenario.before = parseBandExpectation(raw.before, file, `${label}.before`);
  }
  if (raw.after !== undefined) {
    scenario.after = parseBandExpectation(raw.after, file, `${label}.after`);
  }
  return scenario;
}

/**
 * `generalisesTo` must name other cases of the same suite, and those cases
 * must carry no notes of their own — a case that is taught directly proves
 * nothing about generalisation.
 */
function checkLearningTargets(suite: EvalSuite, file: string): void {
  const byId = new Map(suite.cases.map((evalCase) => [evalCase.id, evalCase]));
  for (const evalCase of suite.cases) {
    const label = `case "${evalCase.id}".learningScenario.generalisesTo`;
    for (const id of evalCase.learningScenario?.generalisesTo ?? []) {
      const target = byId.get(id);
      if (!target) {
        fail(
          file,
          `${label} names "${id}", which is not a case in this suite — known ids: ${[...byId.keys()].join(', ')}`,
        );
      }
      if (id === evalCase.id) {
        fail(file, `${label} names the case itself`);
      }
      if (target.learningScenario) {
        fail(
          file,
          `${label} names "${id}", which carries a learningScenario of its own — a generalisation case must pass with no notes of its own`,
        );
      }
    }
  }
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
  if (raw.expectedSqlAlternatives !== undefined) {
    // An alternative is "another way to be right about the same question",
    // so it means nothing without the reference it is an alternative to.
    if (parsed.expectedSql === undefined) {
      fail(
        file,
        `${where}.expectedSqlAlternatives needs an expectedSql to be an alternative to`,
      );
    }
    parsed.expectedSqlAlternatives = stringArray(
      raw.expectedSqlAlternatives,
      file,
      `${where}.expectedSqlAlternatives`,
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
  if (raw.difficulty !== undefined) {
    if (!DIFFICULTIES.has(raw.difficulty as EvalDifficulty)) {
      fail(
        file,
        `${where}.difficulty must be one of ${[...DIFFICULTIES].join(', ')} — got ${JSON.stringify(raw.difficulty)}`,
      );
    }
    parsed.difficulty = raw.difficulty as EvalDifficulty;
  }
  if (raw.variants !== undefined) {
    parsed.variants = stringArray(raw.variants, file, `${where}.variants`);
  }
  if (raw.trapSql !== undefined) {
    parsed.trapSql = requiredString(raw.trapSql, file, `${where}.trapSql`);
  }
  if (raw.expectedSqlByDialect !== undefined) {
    const byDialect = raw.expectedSqlByDialect as Record<string, unknown>;
    if (
      !byDialect ||
      typeof byDialect !== 'object' ||
      Array.isArray(byDialect)
    ) {
      fail(file, `${where}.expectedSqlByDialect must be an object`);
    }
    const parsedByDialect: NonNullable<EvalSuiteCase['expectedSqlByDialect']> =
      {};
    for (const [dialect, sql] of Object.entries(byDialect)) {
      if (!DIALECTS.has(dialect as SqlDialect)) {
        fail(
          file,
          `${where}.expectedSqlByDialect has an unknown dialect "${dialect}" — known: ${[...DIALECTS].join(', ')}`,
        );
      }
      parsedByDialect[dialect as SqlDialect] = requiredString(
        sql,
        file,
        `${where}.expectedSqlByDialect.${dialect}`,
      );
    }
    parsed.expectedSqlByDialect = parsedByDialect;
  }
  if (raw.provenance !== undefined) {
    if (!PROVENANCES.has(raw.provenance as EvalCaseProvenance)) {
      fail(
        file,
        `${where}.provenance must be one of ${[...PROVENANCES].join(', ')} — got ${JSON.stringify(raw.provenance)}`,
      );
    }
    parsed.provenance = raw.provenance as EvalCaseProvenance;
  }
  if (raw.checks !== undefined) {
    if (!Array.isArray(raw.checks)) {
      fail(file, `${where}.checks must be an array`);
    }
    parsed.checks = raw.checks.map((check) =>
      validateCheck(check, file, where),
    );
    rejectDuplicateCheckTypes(parsed.checks, file, where);
  }
  if (raw.expectedReasoning !== undefined) {
    parsed.expectedReasoning = parseExpectedReasoning(
      raw.expectedReasoning,
      file,
      where,
    );
  }
  if (raw.learningScenario !== undefined) {
    parsed.learningScenario = parseLearningScenario(
      raw.learningScenario,
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
  const cases = base.cases.map((baseCase) => {
    // Reference data in the base suite's dialects (Postgres alternatives, a
    // Databricks override, the trap query) cannot run against the variant's
    // datasource; its only reference is the ported `expectedSql`.
    const { id, expectedSql: baseSql, ...rest } = baseCase;
    delete rest.expectedSqlAlternatives;
    delete rest.expectedSqlByDialect;
    delete rest.trapSql;
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
 * One check of each type per case. Scores are keyed by check id, and the id
 * is the type (`check-matches`), so a second `matches` would silently replace
 * the first (it did under Mastra `runEvals`) or need a suffix nobody reading
 * a report would connect back to the JSON. Two assertions of one kind belong
 * in one pattern (a regex with lookaheads).
 */
function rejectDuplicateCheckTypes(
  checks: EvalCheckSpec[],
  file: string,
  where: string,
): void {
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.type)) {
      fail(
        file,
        `${where} uses the "${check.type}" check twice — scores are keyed by check type, ` +
          'so one would silently replace the other. Combine them (e.g. one regex with lookaheads).',
      );
    }
    seen.add(check.type);
  }
}

/**
 * A text check whose value is nothing but a number: digits, separators and
 * regex punctuation (`\b`, `[,.]?`, `|`, `\s*`), no word.
 */
export function isNumericLooking(value: string): boolean {
  const stripped = value
    .replace(/\\[bBdDsSwW]/g, ' ')
    .replace(/\\(.)/g, '$1')
    .replace(/[\s.,:;%()[\]|?*+{}^$\-–—'"]/g, '');
  return /^\d+$/.test(stripped);
}

/** One text check asserting a bare number on a case that has `expectedSql`. */
export interface NumericCheckFinding {
  caseId: string;
  type: 'includes' | 'matches';
  value: string;
}

/**
 * A bare number asserted on the answer text of a case whose figure the
 * result-set check already compares. It adds no correctness signal and fails
 * correct answers on formatting (`1,234` vs `1234.0`, `48.4%` vs `0.484`).
 */
export function numericCheckFindings(
  cases: readonly EvalSuiteCase[],
): NumericCheckFinding[] {
  const findings: NumericCheckFinding[] = [];
  for (const evalCase of cases) {
    if (!evalCase.expectedSql) continue;
    for (const check of evalCase.checks ?? []) {
      const value =
        check.type === 'includes'
          ? check.value
          : check.type === 'matches'
            ? check.pattern
            : undefined;
      if (value && isNumericLooking(value)) {
        findings.push({
          caseId: evalCase.id,
          type: check.type as NumericCheckFinding['type'],
          value,
        });
      }
    }
  }
  return findings;
}

/** Warn once per process per suite state, not on every listing of the suites. */
const numericWarnings = new Set<string>();

/**
 * Flagged as a warning, not an error: the suites still carry such checks,
 * and refusing to load them would take the Evals tab down with them. One
 * line per suite file, so listing suites does not flood the log.
 */
function warnNumericChecks(
  cases: readonly EvalSuiteCase[],
  file: string,
): void {
  const findings = numericCheckFindings(cases);
  if (!findings.length) return;
  const listed = findings
    .map(
      (finding) =>
        `${finding.caseId} (${finding.type} ${JSON.stringify(finding.value)})`,
    )
    .join(', ');
  const key = `${file}|${listed}`;
  if (numericWarnings.has(key)) return;
  numericWarnings.add(key);
  console.warn(
    `Eval suite ${file}: ${findings.length} check(s) assert a bare number on a case that has ` +
      'expectedSql — the result-set check already compares the figure, and a text check fails ' +
      `correct answers on formatting: ${listed}.`,
  );
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
  warnNumericChecks(suite.cases, file);
  // Run logs key cases by id and the regression diff matches cases across
  // runs by id — duplicates would silently merge two questions into one.
  const seen = new Set<string>();
  for (const evalCase of suite.cases) {
    if (seen.has(evalCase.id)) {
      fail(file, `duplicate case id "${evalCase.id}"`);
    }
    seen.add(evalCase.id);
  }
  checkLearningTargets(suite, file);
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

/**
 * The suite a selection of questions belongs to. Case ids are unique across
 * suites (the suite loader's tests assert it), so a list of ids alone names
 * its suite. Throws when the selection matches no suite, or spans several —
 * their schemas are unrelated, and a run scoped to one cannot answer the
 * other.
 */
export function suiteForCases(caseIds?: string[]): EvalSuite {
  const suites = listSuites();
  // A paraphrase (`<id>~v1`, see `variantCaseId`) belongs to its base case's suite.
  const wanted = caseIds
    ? new Set(caseIds.map((id) => id.replace(/~v\d+$/, '')))
    : undefined;
  const touched = wanted
    ? suites.filter((suite) =>
        suite.cases.some((evalCase) => wanted.has(evalCase.id)),
      )
    : suites;
  if (touched.length === 0) {
    throw new Error(
      'No question set matches the selected questions, so there is no sample ' +
        'to validate the datasets against.',
    );
  }
  if (touched.length > 1) {
    throw new Error(
      `The selected questions span several sets (${touched
        .map((suite) => suite.id)
        .join(', ')}) — run one set at a time.`,
    );
  }
  return touched[0];
}

/* ------------------------------------------------------------- run cases */

/**
 * A case as the runners want it: the declarative `checks` (what the parity
 * harness evaluates with `eval-checks.ts`) plus the case's reference data.
 * `difficulty`, `variantOf` and `expectedSqlByDialect` are declared on
 * `AssistantEvalCase` itself, because the harness reads them.
 */
export interface SuiteEvalCase extends AssistantEvalCase {
  checks: EvalCheckSpec[];
  trapSql?: string;
  provenance?: EvalCaseProvenance;
}

/**
 * A JSON case as the runner wants it. `checks` are the specs themselves.
 *
 * `scorers` is a compatibility view only: the specs as the question list
 * shows them (`describeChecks` — id, name, description), for callers written
 * when a case carried live `@mastra/evals/checks` scorer objects. Nothing
 * scores through it any more — the parity harness grades the `TurnResult`
 * with `evaluateChecks` — so new code should call `describeChecks(checks)`.
 */
export function toAssistantEvalCase(
  c: EvalSuiteCase,
): SuiteEvalCase & { scorers: EvalCheckDescription[] } {
  const checks = c.checks ?? [];
  return {
    id: c.id,
    category: c.category,
    question: c.question,
    intent: c.intent,
    checks,
    scorers: describeChecks(checks),
    ...(c.expectedSql ? { expectedSql: c.expectedSql } : {}),
    ...(c.expectedSqlAlternatives?.length
      ? { expectedSqlAlternatives: c.expectedSqlAlternatives }
      : {}),
    ...(c.resultSetOptions ? { resultSetOptions: c.resultSetOptions } : {}),
    ...(c.judgeRubric ? { judgeRubric: c.judgeRubric } : {}),
    ...(c.difficulty ? { difficulty: c.difficulty } : {}),
    ...(c.trapSql ? { trapSql: c.trapSql } : {}),
    ...(c.expectedSqlByDialect
      ? { expectedSqlByDialect: c.expectedSqlByDialect }
      : {}),
    ...(c.provenance ? { provenance: c.provenance } : {}),
  };
}

/**
 * The reference SQL for the dialect a run executes in: the case's override
 * for that dialect, else `expectedSql` (portable SQL needs no override).
 */
export function referenceSqlFor(
  evalCase: {
    expectedSql?: string;
    expectedSqlByDialect?: { postgres?: string; databricks?: string };
  },
  /** A `SqlDialect`; anything else (or nothing) means "use `expectedSql`". */
  dialect: string | undefined,
): string | undefined {
  const override =
    dialect && DIALECTS.has(dialect as SqlDialect)
      ? evalCase.expectedSqlByDialect?.[dialect as SqlDialect]
      : undefined;
  return override ?? evalCase.expectedSql;
}

/**
 * Every reference that may judge a case in `dialect`: the primary
 * (`referenceSqlFor`) first, then `expectedSqlAlternatives` in file order.
 * Alternatives are Postgres/portable SQL and are listed for every dialect —
 * one that cannot run on a datasource only costs that alternative, since the
 * result-set check is a measurement gap only when every reference failed.
 * Empty when the case has no primary reference.
 */
export function referenceSqlsFor(
  evalCase: {
    expectedSql?: string;
    expectedSqlByDialect?: { postgres?: string; databricks?: string };
    expectedSqlAlternatives?: string[];
  },
  dialect: string | undefined,
): string[] {
  const primary = referenceSqlFor(evalCase, dialect);
  return primary ? [primary, ...(evalCase.expectedSqlAlternatives ?? [])] : [];
}

/** `<case id>~v<n>` — the id a paraphrase variant runs under. */
export function variantCaseId(caseId: string, index: number): string {
  return `${caseId}~v${index + 1}`;
}

/**
 * The suite's cases, plus — when `includeVariants` — one extra case per
 * paraphrase, right after its original. A variant keeps every check, the
 * reference SQL and the category: only the wording changes, so a variant
 * that fails where its original passed is a wording-sensitivity finding.
 */
export function expandVariants(
  suite: EvalSuite,
  includeVariants: boolean,
): SuiteEvalCase[] {
  return suite.cases.flatMap((c) => {
    const original = toAssistantEvalCase(c);
    if (!includeVariants || !c.variants?.length) return [original];
    return [
      original,
      ...c.variants.map((question, index) => {
        const variant = toAssistantEvalCase({
          ...c,
          id: variantCaseId(c.id, index),
          question,
        });
        variant.variantOf = c.id;
        return variant;
      }),
    ];
  });
}

/**
 * A named group of eval questions that share one fixture — one suite file
 * under `suites/`, presented as a set by the questions tab. Sets exist so the
 * suite can grow past the World Cup sample without the questions tab becoming
 * one undifferentiated list: a set brings its own schema and its own
 * datasource, and two sets must not be run against each other.
 */
export interface AssistantEvalSet {
  /** Stable id (the suite file name), used by the API and the questions tab. */
  id: string;
  name: string;
  /** What the set covers and what it needs to run, shown above its questions. */
  description: string;
  /**
   * The registry sample this set questions, by `SampleFixture.id`, when it is
   * one of the bundled samples. Absent for suites whose fixture is installed
   * outside the app (`npm run fixtures:register`); those declare their own
   * required entities instead.
   */
  fixtureId?: string;
  /** The dataset names the set is written against, as a default/hint. */
  datasets: string[];
  cases: AssistantEvalSetCase[];
}

/** A set's case as the questions tab lists it: the run shape plus its paraphrase count. */
export type AssistantEvalSetCase = SuiteEvalCase & {
  /** Paraphrase variants the case carries (run with `includeVariants`). */
  variantCount: number;
};

/**
 * Every question set the assistant offers: one per suite file, id-sorted.
 * Read fresh on each call (see `listSuites`) so a suite edited while the
 * backend runs shows up without a restart.
 *
 * Defensive like `loadDefaultSuiteCases` (assistant.evals.ts): the suites are a build asset,
 * and a broken or missing one must not take the Agents page down with it.
 */
export function assistantEvalSets(): AssistantEvalSet[] {
  try {
    return listSuites().map((suite) => ({
      id: suite.id,
      name: suite.name,
      description: suite.description ?? '',
      ...(suite.fixtureId ? { fixtureId: suite.fixtureId } : {}),
      datasets: suite.datasets,
      cases: suite.cases.map((evalCase) => ({
        ...toAssistantEvalCase(evalCase),
        variantCount: evalCase.variants?.length ?? 0,
      })),
    }));
  } catch (err) {
    console.warn(
      `Eval suites could not be loaded: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

/* ------------------------------------------------------------- preflight */

/**
 * Validate a run's data scope before creating a run or spending model tokens.
 * Dataset *names* are user-defined, so this matches on schema-qualified
 * entities instead. It checks the saved scope, not whether the live fixture's
 * rows have drifted. One datasource of the suite's kind — for a PostgreSQL
 * suite that may also be a Databricks copy of the fixture (the fixture loader
 * can copy the schemas into a Databricks catalog, and `referenceSqlFor` picks
 * the reference SQL for its dialect).
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
  const accepted = acceptedDatasourceKinds(suite.datasourceKind);
  const kindLabel = datasourceKindLabel(suite.datasourceKind);
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
    selected.some(
      (dataset) => !accepted.includes(dataset.datasourceKind ?? ('' as never)),
    )
  ) {
    return `${setup} The selected datasets must belong to one ${kindLabel} datasource.`;
  }
  // Inventory keys are catalog.schema.table (`api.schema.table` for REST,
  // the Databricks catalog for a copied fixture); older Postgres snapshots
  // may have schema.table. Never accept a similarly named table in another
  // schema.
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
