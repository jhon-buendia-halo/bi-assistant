/**
 * Live answer-quality gate (opt-in, costs real money).
 *
 * Every result guard in `src/modules/projects/result-guards.ts` exists because a
 * *model* once produced a fluent, wrong answer: a rate divided by itself and
 * reported as a flat 100%, a tie flattened into a ranking, a metric that cannot
 * vary presented as a comparison. Unit tests pin the guards; only a real turn
 * proves the assistant, with those guards in its loop, no longer ships the
 * defect. So this runs by hand (or in a gate that opts in), never as part of
 * `npm test`:
 *
 *   docker compose up -d                 # World Cup Postgres fixture
 *   OPENAI_API_KEY=... npm run check:answers
 *
 * Exit 0 = every check passed. Non-zero = a check failed, the fixture was
 * unreachable, or no key was exported. The SQL and the prose of every turn are
 * printed, because reproducing a failure costs another round of model calls.
 *
 * A single turn cannot tell a fixed defect from a lucky sample: these questions
 * pass or fail stochastically, so one run is one draw. For measurement —
 * comparing two schema-context arms, say — run the set many times and read
 * proportions with intervals instead of verdicts:
 *
 *   CHECK_TRIALS=20 CHECK_ARM=with-join-hints OPENAI_API_KEY=... \
 *     npm run check:answers
 *
 * `CHECK_TRIALS` (default 1) repeats the whole set in one invocation against one
 * provisioned datastore; the summary then reports, per check, the pass rate with
 * a Wilson 95% interval plus the three diagnostics that explain a regression:
 * turns whose SQL never succeeded, answers naming raw identifiers instead of
 * teams, and turns where a result guard fired. `CHECK_ARM` is free text echoed
 * in the header so a captured transcript records which arm produced it.
 *
 * Sibling of `scripts/run-eval.ts`: that one compares result sets against
 * trusted SQL, this one asserts the answer is not degenerate. Same boot path,
 * same throwaway-project mechanics.
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
// Pure heuristics — no DI, no datastore import, safe to pull in eagerly.
import { inspectResult } from '../src/modules/projects/result-guards';
import type {
  ChatMessage,
  ToolDataRecord,
} from '../src/modules/projects/entities/project.entity';
import { WORLD_CUP_CONNECTION, worldCupReachable } from '../test/world-cup';

/** Real model calls take tens of seconds; a tight timeout only buys false alarms. */
const TURN_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS ?? 180_000);
/** `run_readonly_sql` defaults to 100 rows; the guards judge truncation against the same cap. */
const ROW_LIMIT = 100;
const SANDBOX_NAME = 'World Cup';
/** The cheapest model that still routes tools — and the one the ratio bug shipped on. */
const MODEL = process.env.CHECK_MODEL ?? 'gpt-4o-mini';
/** Free-text label for the configuration under test, echoed so output is self-describing. */
const ARM = process.env.CHECK_ARM?.trim() ?? '';

/** Entities the checks need. Keys are resolved from the live inventory, never typed by hand. */
const REQUIRED_TABLES = [
  'matches',
  'goals',
  'teams',
  'match_team_statistics',
  'disciplinary_events',
  'players',
];

/** A misconfiguration the operator must fix — reported without a stack trace. */
class SetupError extends Error {}

interface Answer {
  question: string;
  text: string;
  records: ToolDataRecord[];
}

interface Check {
  name: string;
  question: string;
  /** Why this case exists — printed with the failure so the defect is legible. */
  guards: string;
  /** Null when the answer is acceptable, else the one-line reason it is not. */
  verify: (answer: Answer) => string | null;
}

type Verdict = 'PASS' | 'FAIL' | 'ERROR';

/**
 * The three failure modes worth counting separately from the verdict. A check
 * can fail for any of them, and which one dominates is the whole diagnosis:
 * broken SQL means the schema context did not let the model join, raw ids mean
 * it joined but never resolved the label, a guard warning means the guards
 * caught what the prose would otherwise have claimed.
 */
interface Diagnostics {
  /** No `run_readonly_sql` record succeeded — the turn never got data. */
  failedSql: boolean;
  /** The answer prose referenced a bare identifier ("Team ID 5"). */
  rawId: boolean;
  /** A persisted record carried `warnings`, i.e. a result guard fired. */
  guardWarning: boolean;
}

interface CheckResult {
  name: string;
  verdict: Verdict;
  detail: string;
  durationMs: number;
  diagnostics: Diagnostics;
}

/**
 * Percentages the answer states in prose, as fractions of 1. A model that
 * returns the numerator and denominator and divides in the narrative is
 * answering correctly, so the figures have to be read from the text too.
 */
function percentagesIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0 && value <= 100) found.push(value);
  }
  return found;
}

/**
 * A bare identifier standing in for a name: the defect this harness measures.
 * Observed shapes, all of which must match, are `Team ID **5**` (markdown
 * emphasis between the label and the number), `1. Team ID 5 2. Team ID 2`,
 * `- **Team 4**: 87.13%` (no "id" at all — the noun and a key) and `team_id 5`.
 *
 * Hence the two branches: an entity noun with an *optional* id word, or a bare
 * `id`. `(?![a-z])` rather than `\b` after each word so `team_id` is caught
 * while `matches`, `teams`, `identifier` and `player_name` are not, and
 * `[\W_]{0,4}` for the gap so `**`, `#`, `:`, `(` and `_` are crossed but a real
 * word in between is not — that is what keeps `France scored the most goals
 * (14)`, `France led with 14 goals.`, `Team France scored 14 goals` and
 * `France won 7 matches and scored 14 goals` clean.
 *
 * A wrong pattern here silently invalidates the experiment in both directions —
 * too loose and every arm looks broken, too tight and the defect disappears —
 * so it is pinned against the strings above rather than eyeballed.
 */
const BARE_IDENTIFIER =
  /(?:\b(?:team|player|match|club|squad)(?![a-z])(?:[\W_]{0,4}(?:id|no|number)(?![a-z]))?|\bid(?![a-z]))[\W_]{0,4}\d+\b/i;

// ---------------------------------------------------------------- checks

const CHECKS: Check[] = [
  {
    name: 'pass-completion-ratio',
    question: 'What share of their attempted passes did each team complete?',
    guards:
      'the production bug: the same measure aliased twice and divided by itself, narrated as a flat rate',
    verify: (answer) => {
      const record = successfulSql(answer);
      if (!record) return 'no successful run_readonly_sql';

      const codes = inspectResult(
        record.input ?? '',
        record.rows ?? [],
        ROW_LIMIT,
      ).map((warning) => warning.code);
      if (codes.includes('degenerate-ratio')) {
        return 'the SQL divides a measure by itself (degenerate-ratio)';
      }

      // Ground truth varies per team — Croatia .871, Brazil .870, England .869
      // — so a correct answer cannot be uniform, and a collapsed denominator
      // shows up as one value repeated on every row.
      // Computing the share in SQL and computing it in prose from a correct
      // numerator and denominator are both right answers — this check exists
      // to catch a collapsed denominator, not to dictate where the division
      // happens. An earlier version demanded a rate column and failed sound
      // answers that divided in the narrative instead.
      const rates = ratesIn(record.rows ?? []);
      if (rates.length >= 2) {
        const distinct = new Set(rates.map((rate) => rate.toFixed(4)));
        if (distinct.size < 2) {
          return `every team reports the same rate (${rates[0]})`;
        }
        const outOfRange = rates.filter((rate) => rate <= 0 || rate >= 1);
        if (outOfRange.length) {
          return `rate outside (0,1): ${outOfRange.slice(0, 3).join(', ')}`;
        }
        return null;
      }
      // No rate column: the answer must still state varying percentages, and
      // the row data must carry two different measures to divide.
      const percentages = percentagesIn(answer.text);
      const distinctText = new Set(percentages.map((pct) => pct.toFixed(1)));
      if (distinctText.size < 2) {
        return `no rate column in ${columnList(record)} and no varying percentages in the answer`;
      }
      const spread = Math.max(...percentages) - Math.min(...percentages);
      if (spread < 0.5) {
        return `the reported shares barely vary (spread ${spread.toFixed(2)})`;
      }
      return null;
    },
  },
  {
    name: 'tie-not-ranked',
    question: 'Which teams scored exactly four goals in total?',
    guards:
      'ties flattened into a ranking: the model naming whichever tied team came back first',
    verify: (answer) => {
      if (!successfulSql(answer)) return 'no successful run_readonly_sql';
      // Belgium and England both scored exactly four; naming one is wrong.
      const missing = ['Belgium', 'England'].filter(
        (team) => !new RegExp(team, 'i').test(answer.text),
      );
      return missing.length
        ? `the answer never mentions ${missing.join(' or ')}`
        : null;
    },
  },
  {
    name: 'constant-metric-not-compared',
    question: 'What share of the disciplinary cards shown were yellow?',
    guards:
      'invented variation: breaking down a metric that is 100% on every row as if teams differed',
    verify: (answer) => {
      if (!successfulSql(answer)) return 'no successful run_readonly_sql';
      // Every card in the fixture is a yellow, so the share is 100% and there
      // is nothing to compare. Deliberately loose: this checks the shape of the
      // claim, and pinning model wording would only buy flakes.
      if (!/yellow/i.test(answer.text)) {
        return 'the answer never mentions yellow cards';
      }
      if (
        !/\b(all|every|only|entire|100\s?%|100 percent)\b/i.test(answer.text)
      ) {
        return 'the answer does not say the cards were all yellows';
      }
      return null;
    },
  },
  {
    name: 'entity-named-not-id',
    question: 'Which team scored the most goals in total?',
    guards:
      'the raw-identifier answer: goals aggregate by a foreign key and the model reports "Team ID 5" instead of resolving the name',
    verify: (answer) => {
      if (!successfulSql(answer)) return 'no successful run_readonly_sql';
      // Ground truth verified against the live fixture: France, 14 goals — a
      // clear winner, so unlike `tie-not-ranked` there is exactly one name the
      // answer has to carry.
      if (!/France/i.test(answer.text)) {
        return 'the answer never names France (ground truth: France, 14 goals)';
      }
      // Naming France is not enough: an answer that names it and still lists
      // `Team ID 2` for the runners-up has not resolved the join, and reading it
      // requires the database the reader does not have.
      const bare = BARE_IDENTIFIER.exec(answer.text);
      if (bare) {
        return `the answer reports a bare identifier ("${oneLine(bare[0])}") instead of a team name`;
      }
      return null;
    },
  },
];

// ------------------------------------------------------------ provisioning

/**
 * Write the LLM settings, the Postgres datasource and the sandbox into the
 * throwaway datastore. Nothing here may reach the developer's real app.sqlite,
 * which is why `main` redirects APP_DATA_DIR before the first Nest import.
 */
async function provision(
  app: INestApplicationContext,
  apiKey: string,
): Promise<void> {
  const { LlmService } =
    require('../src/modules/llm/llm.service') as typeof import('../src/modules/llm/llm.service');
  const { DatasourcesService } =
    require('../src/modules/datasources/datasources.service') as typeof import('../src/modules/datasources/datasources.service');
  const { SandboxService } =
    require('../src/modules/sandbox/sandbox.service') as typeof import('../src/modules/sandbox/sandbox.service');

  await app.get(LlmService).save({ provider: 'openai', model: MODEL, apiKey });

  const datasources = app.get(DatasourcesService);
  const datasource = await datasources.save({
    name: SANDBOX_NAME,
    kind: 'postgres',
    config: {
      host: WORLD_CUP_CONNECTION.host,
      port: WORLD_CUP_CONNECTION.port,
      database: WORLD_CUP_CONNECTION.database,
      user: WORLD_CUP_CONNECTION.user,
      password: WORLD_CUP_CONNECTION.password,
      ssl: false,
    },
  });

  // Entity keys come from the connector's inventory. Hand-building
  // `catalog.schema.table` would hard-code that Postgres reports the database
  // as the catalog — exactly the coupling that makes a fixture rename look like
  // an assistant regression.
  const { catalogs } = await datasources.inventory(datasource.id);
  const entities = catalogs.flatMap((catalog) =>
    catalog.schemas.flatMap((schema) =>
      schema.tables
        .filter((table) => REQUIRED_TABLES.includes(table.name))
        .map((table) => ({
          key: `${catalog.name}.${schema.name}.${table.name}`,
          columns: table.columns,
        })),
    ),
  );
  const missing = REQUIRED_TABLES.filter(
    (name) => !entities.some((entity) => entity.key.endsWith(`.${name}`)),
  );
  if (missing.length) {
    throw new SetupError(
      `The World Cup fixture is missing ${missing.join(', ')} — re-seed it ` +
        '(docker compose down -v && docker compose up -d) and retry.',
    );
  }

  await app.get(SandboxService).save({
    name: SANDBOX_NAME,
    tables: entities.map((entity) => entity.key),
    entities,
    datasourceId: datasource.id,
  });
}

// ---------------------------------------------------------------- runtime

/**
 * One turn in a throwaway project through the same path the desktop app drives
 * (`ProjectsService.streamMessage` with a no-op emitter), then the persisted
 * assistant message — identical mechanics to `scripts/run-eval.ts`.
 */
async function ask(
  app: INestApplicationContext,
  question: string,
): Promise<Answer> {
  const { ProjectsService } =
    require('../src/modules/projects/projects.service') as typeof import('../src/modules/projects/projects.service');
  const projects = app.get(ProjectsService);
  const project = await projects.create(
    `check-answers ${new Date().toISOString()}`.slice(0, 64),
    [SANDBOX_NAME],
  );
  try {
    const turn = new AbortController();
    const timer = setTimeout(() => turn.abort(), TURN_TIMEOUT_MS);
    try {
      await projects.streamMessage(project.id, question, () => {}, turn.signal);
    } finally {
      clearTimeout(timer);
    }
    if (turn.signal.aborted) {
      throw new Error(
        `the turn exceeded ${Math.round(TURN_TIMEOUT_MS / 1000)}s`,
      );
    }
    const answered = await projects.get(project.id);
    const message = lastAssistantMessage(answered.messages);
    return {
      question,
      text: message?.content ?? '',
      records: message?.data ?? [],
    };
  } finally {
    await projects
      .delete(project.id)
      .catch((error: unknown) =>
        console.warn(
          `  ! could not delete throwaway project ${project.id} — ${message(error)}`,
        ),
      );
  }
}

/**
 * Read the diagnostics off a turn. Independent of the verdict on purpose: a
 * check can pass while a guard fired, and both numbers are needed to explain an
 * arm. A turn that never produced an answer counts as a failed-SQL turn, which
 * is what it is from the reader's side.
 */
function diagnose(answer: Answer | undefined): Diagnostics {
  if (!answer) return { failedSql: true, rawId: false, guardWarning: false };
  return {
    failedSql: !successfulSql(answer),
    rawId: BARE_IDENTIFIER.test(answer.text),
    guardWarning: answer.records.some((record) => record.warnings?.length),
  };
}

async function runCheck(
  app: INestApplicationContext,
  check: Check,
): Promise<CheckResult> {
  const started = Date.now();
  console.log(`\n▶ ${check.name}: ${check.question}`);
  console.log(`  guards ${check.guards}`);
  let answer: Answer;
  try {
    answer = await ask(app, check.question);
  } catch (error) {
    return {
      name: check.name,
      verdict: 'ERROR',
      detail: `turn failed — ${message(error)}`,
      durationMs: Date.now() - started,
      diagnostics: diagnose(undefined),
    };
  }
  // Printed before the verdict: re-running to see the SQL costs another turn.
  report(answer);
  const diagnostics = diagnose(answer);
  let reason: string | null;
  try {
    reason = check.verify(answer);
  } catch (error) {
    return {
      name: check.name,
      verdict: 'ERROR',
      detail: `check crashed — ${message(error)}`,
      durationMs: Date.now() - started,
      diagnostics,
    };
  }
  return {
    name: check.name,
    verdict: reason ? 'FAIL' : 'PASS',
    detail: reason ?? 'answer is sound',
    durationMs: Date.now() - started,
    diagnostics,
  };
}

// ----------------------------------------------------------------- output

function report(answer: Answer): void {
  for (const record of answer.records) {
    if (record.tool !== 'run_readonly_sql') continue;
    console.log(
      `  sql${record.error ? ' (failed)' : ''}: ${oneLine(record.input ?? '')}`,
    );
    if (record.warnings?.length) {
      console.log(`  warnings: ${record.warnings.join(' | ')}`);
    }
  }
  console.log(`  answer: ${oneLine(answer.text)}`);
}

function table(header: string[], rows: string[][]): void {
  const widths = header.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => cell.padEnd(widths[i]))
      .join('  ')
      .trimEnd();

  console.log('');
  console.log(line(header));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) console.log(line(row));
}

function countVerdict(results: CheckResult[], verdict: Verdict): number {
  return results.filter((result) => result.verdict === verdict).length;
}

/** One trial's verdicts, with the reason each check gave. */
function summarize(results: CheckResult[]): void {
  table(
    ['CHECK', 'VERDICT', 'TIME', 'DETAIL'],
    results.map((result) => [
      result.name,
      result.verdict,
      `${(result.durationMs / 1000).toFixed(1)}s`,
      oneLine(result.detail).slice(0, 80),
    ]),
  );

  console.log('');
  console.log(
    `${results.length} checks — ${countVerdict(results, 'PASS')} passed, ` +
      `${countVerdict(results, 'FAIL')} failed, ` +
      `${countVerdict(results, 'ERROR')} errored`,
  );
}

/**
 * Wilson score interval at 95%, implemented inline to keep this script
 * dependency-free. Deliberately not the normal approximation: at the rates these
 * checks sit at (0.9 and up, sometimes 1.0) the Wald interval runs past 1 and
 * collapses to zero width at 0/n and n/n, which would read as certainty
 * manufactured by arithmetic. Sanity anchor: 9/10 → [0.596, 0.982].
 */
function wilson95(passes: number, trials: number): [number, number] {
  if (trials <= 0) return [0, 0];
  const z = 1.959963984540054;
  const z2 = z * z;
  const p = passes / trials;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}

/**
 * Per-check proportions over every trial. This is the output an experiment is
 * read from: a rate is only interpretable next to its interval and next to the
 * counts that say *how* the failures failed.
 */
function summarizeTrials(trials: CheckResult[][]): void {
  const flat = trials.flat();
  const rows = CHECKS.map((check) => {
    const runs = flat.filter((result) => result.name === check.name);
    const passes = countVerdict(runs, 'PASS');
    const [low, high] = wilson95(passes, runs.length);
    const tally = (pick: (diagnostics: Diagnostics) => boolean) =>
      String(runs.filter((run) => pick(run.diagnostics)).length);
    return [
      check.name,
      `${passes}/${runs.length}`,
      runs.length ? (passes / runs.length).toFixed(2) : '-',
      `[${low.toFixed(2)}, ${high.toFixed(2)}]`,
      tally((diagnostics) => diagnostics.failedSql),
      tally((diagnostics) => diagnostics.rawId),
      tally((diagnostics) => diagnostics.guardWarning),
      String(countVerdict(runs, 'ERROR')),
    ];
  });

  console.log('');
  console.log(
    `${trials.length} trial${trials.length === 1 ? '' : 's'} × ${CHECKS.length} checks` +
      `${ARM ? ` — arm ${ARM}` : ''} (model ${MODEL})`,
  );
  table(
    [
      'CHECK',
      'PASS',
      'RATE',
      '95% CI',
      'FAILED-SQL',
      'RAW-ID',
      'WARNINGS',
      'ERRORS',
    ],
    rows,
  );

  const total = flat.length;
  const passed = countVerdict(flat, 'PASS');
  const clean = trials.filter((trial) =>
    trial.every((result) => result.verdict === 'PASS'),
  ).length;
  console.log('');
  console.log(
    `${passed}/${total} checks passed overall; ${clean}/${trials.length} trials ` +
      'passed every check',
  );
  console.log(
    'FAILED-SQL = no successful run_readonly_sql; RAW-ID = answer named a bare ' +
      'identifier; WARNINGS = a result guard fired',
  );
}

// ---------------------------------------------------------------- helpers

function lastAssistantMessage(
  messages: ChatMessage[],
): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') return messages[i];
  }
  return undefined;
}

/** The last `run_readonly_sql` that succeeded — the query the answer rests on. */
function successfulSql(answer: Answer): ToolDataRecord | undefined {
  for (let i = answer.records.length - 1; i >= 0; i--) {
    const record = answer.records[i];
    if (record.tool === 'run_readonly_sql' && !record.error && record.input) {
      return record;
    }
  }
  return undefined;
}

const RATE_NAME =
  /(rate|ratio|share|pct|percent|accuracy|completion|complete)/i;
const NUMERIC = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * The rate column, whatever the model called it, as fractions. Postgres returns
 * numerics as strings and models answer in either 0-1 or 0-100, so both are
 * normalised: the assertion is about spread and plausibility, not the unit.
 */
function ratesIn(rows: Record<string, unknown>[]): number[] {
  if (!rows.length) return [];
  const columns = Object.keys(rows[0] ?? {});
  const named = columns.filter((column) => RATE_NAME.test(column));
  for (const column of named.length ? named : columns) {
    const values = rows.map((row) => numeric(row?.[column]));
    if (values.some((value) => value === null)) continue;
    const numbers = values as number[];
    const scaled =
      Math.max(...numbers) > 1 ? numbers.map((value) => value / 100) : numbers;
    // Anything outside (0,1] after scaling is a count or a key, not a share.
    if (scaled.every((value) => value > 0 && value <= 1)) return scaled;
  }
  return [];
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && NUMERIC.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function columnList(record: ToolDataRecord): string {
  const columns = record.columns ?? Object.keys(record.rows?.[0] ?? {});
  return columns.length ? columns.join(', ') : '(no columns)';
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ------------------------------------------------------------------- main

/** `CHECK_TRIALS` — repeats of the whole set, one provisioned datastore for all. */
function trialCount(): number {
  const raw = process.env.CHECK_TRIALS;
  if (raw === undefined || raw.trim() === '') return 1;
  const trials = Number(raw);
  if (!Number.isInteger(trials) || trials < 1) {
    throw new SetupError(
      `CHECK_TRIALS must be a positive integer, got "${raw}". Each trial is a ` +
        `full pass over ${CHECKS.length} live turns, so the bill scales with it.`,
    );
  }
  return trials;
}

async function main(): Promise<number> {
  // The key is read from the environment and never stored, echoed or defaulted.
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new SetupError(
      'OPENAI_API_KEY is not set. These checks drive the real model and cost ' +
        'money, so they never run implicitly — export a key and retry.',
    );
  }
  const trials = trialCount();
  if (!(await worldCupReachable())) {
    throw new SetupError(
      `The World Cup fixture is not reachable on ${WORLD_CUP_CONNECTION.host}:` +
        `${WORLD_CUP_CONNECTION.port} — run \`docker compose up -d\` from the ` +
        'repo root and retry.',
    );
  }

  // `database.module.ts` and `mastra/storage.ts` capture the data directory when
  // they are first imported, so APP_DATA_DIR has to be redirected before the
  // first Nest import. Static imports are hoisted above this statement, hence
  // the deferred `require` below: without it these checks would write their LLM
  // settings, datasource and sandbox into the developer's real app.sqlite.
  const dataDir = mkdtempSync(join(tmpdir(), 'qti-llm-e2e-'));
  process.env.APP_DATA_DIR = dataDir;
  const { AppModule } =
    require('../src/app.module') as typeof import('../src/app.module');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });
  const perTrial: CheckResult[][] = [];
  try {
    // Provisioned once and reused by every trial: the settings, datasource and
    // sandbox are the arm under test, so re-creating them per trial would both
    // waste inventory round-trips and let the arm drift mid-experiment.
    await provision(app, apiKey);
    console.log(
      `Running ${CHECKS.length} answer checks × ${trials} trial${trials === 1 ? '' : 's'} ` +
        `against the World Cup fixture (model ${MODEL}, ` +
        `timeout ${Math.round(TURN_TIMEOUT_MS / 1000)}s` +
        `${ARM ? `, arm ${ARM}` : ''})`,
    );
    for (let trial = 1; trial <= trials; trial++) {
      // Progress is printed even for a single trial: a 20-trial run is tens of
      // minutes of model calls and silence is indistinguishable from a hang.
      console.log(
        `\n━━ trial ${trial}/${trials}${ARM ? ` — arm ${ARM}` : ''} ━━`,
      );
      const results: CheckResult[] = [];
      for (const check of CHECKS) {
        const result = await runCheck(app, check);
        results.push(result);
        console.log(`  ${result.verdict} — ${oneLine(result.detail)}`);
      }
      perTrial.push(results);
      console.log(
        `  trial ${trial}/${trials}: ${countVerdict(results, 'PASS')}/${results.length} passed`,
      );
    }
  } finally {
    await app.close().catch(() => undefined);
    // Throwaway datastore: nothing it holds may outlive the run.
    rmSync(dataDir, { recursive: true, force: true });
  }

  // The verdict table stays the single-run view; the aggregate is what an
  // experiment is read from.
  if (perTrial.length === 1) summarize(perTrial[0]);
  summarizeTrials(perTrial);
  return perTrial.flat().every((result) => result.verdict === 'PASS') ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      if (error instanceof SetupError) {
        console.error(`\n✖ ${error.message}\n`);
      } else {
        console.error('\n✖ Answer checks crashed:');
        console.error(error);
      }
      process.exit(1);
    });
}
