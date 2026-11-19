/**
 * The step checks of the Answer a Business Question workflow (agents-evals
 * R259 to R261): each critical step scored inside the same eval run, from
 * the step's own output (`EvalRunDetails.steps`), so a failed question names
 * the step where it broke. Diagnostic only: a step check never changes the
 * question's verdict (R258).
 *
 * No Nest, no Mastra, no model: `compareEvidence` is the result-set match's.
 */
import { compareEvidence } from './result-set-check';
import type { ResultSetCheckOptions } from './result-set-check';
import type { EvalCheckSpec } from './eval-set-files';
import type { EvalStatus } from './eval-summary';

type Row = Record<string, unknown>;

/** What a case expects of the run, read from its file checks. */
export interface CaseExpectations {
  /** `askedClarification`: true asks back; `{ asked: false }` must not. */
  clarification?: boolean;
  /** `builtVisual`: true builds one; `{ built: false }` must not. */
  visual?: boolean;
}

/** A case's expectations, from its `askedClarification` and `builtVisual`. */
export function expectationsOf(
  checks: readonly EvalCheckSpec[],
): CaseExpectations {
  const expects: CaseExpectations = {};
  for (const check of checks) {
    const args = (check.args ?? {}) as Record<string, unknown>;
    if (check.type === 'askedClarification') {
      expects.clarification = args['asked'] !== false;
    } else if (check.type === 'builtVisual') {
      expects.visual = args['built'] !== false;
    }
  }
  return expects;
}

/** The workflow's critical steps, in run order. */
export const WORKFLOW_STEPS = [
  'plan',
  'analyse',
  'validate',
  'write',
  'visual',
] as const;
export type WorkflowStep = (typeof WORKFLOW_STEPS)[number];

export const STEP_CHECK_IDS: Record<WorkflowStep, string> = {
  plan: 'step-plan',
  analyse: 'step-analyse',
  validate: 'step-validate',
  write: 'step-write',
  visual: 'step-visual',
};

const DESCRIPTIONS: Record<WorkflowStep, string> = {
  plan: 'Step: Plan chose the right action and named the tables the reference reads',
  analyse: 'Step: an Analyse query holds the reference result',
  validate: "Step: Validate's verdict agrees with the reference",
  write: 'Step: Write answer states what the kept result holds',
  visual:
    'Step: Build visual built a visual when, and only when, one was asked for',
};

/**
 * The answer checks a Write answer failure shows in: they read the answer's
 * text and figures, which Write answer wrote from the kept queries.
 */
export const WRITE_CHECK_IDS: ReadonlySet<string> = new Set([
  'check-includes',
  'check-matches',
  'check-not-matches',
  'check-numbers-grounded',
  'check-names-not-ids',
  'check-no-html',
]);

/** One step check's verdict, with its status. */
export interface StepCheckResult {
  id: string;
  description: string;
  score: number;
  passed: boolean;
  status: EvalStatus;
  reason?: string;
}

/** What the step checks read. */
export interface StepCheckInput {
  /** The run's step outputs by step id (`plan`, `analyse`, …). */
  steps: Record<string, unknown>;
  expects: CaseExpectations;
  expectedSql?: string;
  /** The reference query's rows; undefined when the case has none. */
  referenceRows?: Row[];
  resultSetOptions?: ResultSetCheckOptions;
  /** The run ended on a clarifying question (Plan's or Analyse's). */
  endedOnClarification: boolean;
  /** The question's other checks, with their statuses. */
  checks: readonly { id: string; status: EvalStatus }[];
}

interface Query {
  rows: Row[];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
}

/** A value as text when it is a string or a number, else ''. */
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function queriesOf(value: unknown): Query[] {
  return (Array.isArray(value) ? value : [])
    .map((entry) => record(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .filter((entry) => !entry['error'] && Array.isArray(entry['rows']))
    .map((entry) => entry as unknown as Query);
}

/** The last segment of a table name, unquoted and lower-cased. */
function bareName(name: string): string {
  const last = name.split('.').pop() ?? name;
  return last.replace(/[`"[\]]/g, '').toLowerCase();
}

/** A table name without a plural ending: `matches` → `match`. */
function stem(table: string): string {
  return table.replace(/(?:es|s)$/, '');
}

/**
 * Whether a catalogue entity Plan named stands for a table the reference
 * reads: the table itself, or a view over it, which the catalogue names
 * `v_<…>` around the table's stem (`v_transactions` for `transactions`,
 * `v_match_results` for `matches`, `v_player_goal_totals` for `goals`).
 * Plan checks it both ways: a base table it named also stands for a
 * reference that reads a view over it.
 */
export function namesTable(entity: string, table: string): boolean {
  if (entity === table) return true;
  if (!entity.startsWith('v_')) return false;
  const root = stem(table);
  return root.length >= 3 && entity.slice(2).includes(root);
}

/** The tables a reference query reads (its CTE names left out). */
export function referenceTables(sql: string): string[] {
  const ctes = new Set(
    [...sql.matchAll(/(?:\bwith|,)\s+([A-Za-z_][\w]*)\s+as\s*\(/gi)].map(
      (match) => match[1].toLowerCase(),
    ),
  );
  const tables = [
    ...sql.matchAll(/\b(?:from|join)\s+([A-Za-z_`"[][\w.`"[\]]*)/gi),
  ]
    .map((match) => bareName(match[1]))
    .filter((name) => name && !ctes.has(name));
  return [...new Set(tables)];
}

/** Whether one of the queries holds the reference, and why not. */
function holdsReference(
  queries: Query[],
  reference: Row[],
  options: ResultSetCheckOptions,
): { match: boolean; reason: string } {
  if (!queries.length) {
    return { match: false, reason: 'no successful query' };
  }
  let reason = '';
  for (const query of queries) {
    const compared = compareEvidence(reference, query.rows, options);
    if (compared.match) return { match: true, reason: '' };
    const clipped =
      query.truncated && (query.rowCount ?? 0) > query.rows.length
        ? ` (its ${query.rowCount} rows were stored as ${query.rows.length})`
        : '';
    reason = `${compared.reason}${clipped}`;
  }
  return { match: false, reason };
}

function verdict(
  step: WorkflowStep,
  status: EvalStatus,
  reason?: string,
): StepCheckResult {
  return {
    id: STEP_CHECK_IDS[step],
    description: DESCRIPTIONS[step],
    score: status === 'passed' ? 1 : 0,
    passed: status === 'passed',
    status,
    ...(reason ? { reason } : {}),
  };
}

/**
 * The five step checks of one run (R259 to R261). A step that an earlier
 * step kept from running, or that the case gives nothing to judge, is not
 * scored, with the reason.
 */
export function workflowStepChecks(input: StepCheckInput): StepCheckResult[] {
  const { steps, expects, referenceRows } = input;
  const options = input.resultSetOptions ?? {};
  const passedCheck = (id: string) =>
    input.checks.some((check) => check.id === id && check.status === 'passed');
  const planOutput = record(record(steps['plan'])?.['plan']);
  const planAsked = planOutput?.['needsClarification'] === true;
  const analyse = record(steps['analyse']);
  const validate = record(steps['validate']);
  const written = record(steps['write-answer']);
  const results: StepCheckResult[] = [];

  // Plan: the action, then the tables.
  if (!planOutput) {
    results.push(verdict('plan', 'failed', 'Plan did not run'));
  } else if (
    expects.clarification === true &&
    !planAsked &&
    !passedCheck('check-asked-clarification')
  ) {
    results.push(
      verdict(
        'plan',
        'failed',
        'Plan went on to analyse; the question needed a clarifying question',
      ),
    );
  } else if (
    planAsked &&
    (expects.clarification === false ||
      (expects.clarification === undefined && input.expectedSql))
  ) {
    results.push(
      verdict(
        'plan',
        'failed',
        'Plan asked back; the question should have been answered',
      ),
    );
  } else if (!planAsked && input.expectedSql) {
    const wanted = referenceTables(input.expectedSql);
    const named = (
      Array.isArray(planOutput['entities']) ? planOutput['entities'] : []
    )
      .filter((entity): entity is string => typeof entity === 'string')
      .map(bareName);
    const hit = wanted.some((table) =>
      named.some(
        (entity) => namesTable(entity, table) || namesTable(table, entity),
      ),
    );
    results.push(
      wanted.length && !hit
        ? verdict(
            'plan',
            'failed',
            `Plan named none of the tables the reference reads (${wanted.join(', ')}); it named ${named.join(', ') || 'none'}`,
          )
        : verdict('plan', 'passed'),
    );
  } else {
    results.push(verdict('plan', 'passed'));
  }

  // Analyse: one of its queries (both attempts') holds the reference.
  if (planAsked) {
    results.push(
      verdict('analyse', 'not-scored', 'Plan asked back; Analyse did not run'),
    );
  } else if (!analyse) {
    results.push(
      input.endedOnClarification
        ? verdict(
            'analyse',
            'not-scored',
            'Analyse ended the run on a clarifying question',
          )
        : verdict('analyse', 'failed', 'Analyse did not finish'),
    );
  } else if (!referenceRows) {
    results.push(
      verdict('analyse', 'not-scored', 'the case has no reference query'),
    );
  } else {
    const queries = [
      ...queriesOf(analyse['queries']),
      ...queriesOf(record(analyse['earlier'])?.['queries']),
    ];
    const held = holdsReference(queries, referenceRows, options);
    results.push(
      held.match
        ? verdict('analyse', 'passed')
        : verdict(
            'analyse',
            'failed',
            `no Analyse query holds the reference result: ${held.reason}`,
          ),
    );
  }

  // Validate: its last verdict against whether the kept queries are right.
  let keptRight: boolean | undefined;
  if (!validate) {
    results.push(
      verdict(
        'validate',
        analyse ? 'failed' : 'not-scored',
        analyse ? 'Validate did not run' : 'Analyse did not finish',
      ),
    );
  } else if (!referenceRows) {
    results.push(
      verdict('validate', 'not-scored', 'the case has no reference query'),
    );
  } else {
    const kept = holdsReference(
      queriesOf(validate['queries']),
      referenceRows,
      options,
    );
    keptRight = kept.match;
    const ok = validate['ok'] === true;
    const failedFindings = (
      Array.isArray(validate['findings']) ? validate['findings'] : []
    )
      .map((finding) => record(finding))
      .filter((finding) => finding && finding['passed'] === false)
      .map((finding) => text(finding?.['check']))
      .filter(Boolean);
    if (ok && !kept.match) {
      results.push(
        verdict(
          'validate',
          'failed',
          `Validate passed queries that do not hold the reference result: ${kept.reason}`,
        ),
      );
    } else if (!ok && kept.match) {
      results.push(
        verdict(
          'validate',
          'failed',
          `Validate failed a result that holds the reference${failedFindings.length ? ` (${failedFindings.join('; ')})` : ''}`,
        ),
      );
    } else {
      results.push(verdict('validate', 'passed'));
    }
  }

  // Write answer: the kept result is right (or unknown), the answer states it.
  if (!written) {
    const upstream = planAsked || input.endedOnClarification || !validate;
    results.push(
      verdict(
        'write',
        upstream ? 'not-scored' : 'failed',
        upstream
          ? 'the run ended before Write answer'
          : 'Write answer did not run',
      ),
    );
  } else if (keptRight === false) {
    results.push(
      verdict(
        'write',
        'not-scored',
        'the kept result was already wrong before Write answer',
      ),
    );
  } else {
    const failed = input.checks
      .filter(
        (check) => WRITE_CHECK_IDS.has(check.id) && check.status === 'failed',
      )
      .map((check) => check.id);
    results.push(
      failed.length
        ? verdict(
            'write',
            'failed',
            `${keptRight ? 'the kept result holds the reference, but ' : ''}the answer fails ${failed.join(', ')}`,
          )
        : verdict('write', 'passed'),
    );
  }

  // Build visual: when, and only when, the case asks for one.
  const visual = record(record(steps['build-visual'])?.['visual']);
  if (expects.visual === undefined) {
    results.push(
      verdict('visual', 'not-scored', 'the case asks nothing about a visual'),
    );
  } else if (expects.visual) {
    results.push(
      visual?.['visualId']
        ? verdict('visual', 'passed')
        : verdict(
            'visual',
            written ? 'failed' : 'not-scored',
            written
              ? `no visual was built${visual?.['skipped'] ? `: ${text(visual['skipped'])}` : visual?.['error'] ? `: ${text(visual['error'])}` : ''}`
              : 'the run ended before Build visual',
          ),
    );
  } else {
    results.push(
      visual?.['visualId']
        ? verdict(
            'visual',
            'failed',
            'a visual was built the case did not ask for',
          )
        : verdict('visual', 'passed'),
    );
  }
  return results;
}

/**
 * The step a question broke at (R261): the first step, in run order, whose
 * check failed; undefined when none did.
 */
export function brokeAt(
  checks: readonly { id: string; status?: EvalStatus }[],
): WorkflowStep | undefined {
  return WORKFLOW_STEPS.find((step) =>
    checks.some(
      (check) => check.id === STEP_CHECK_IDS[step] && check.status === 'failed',
    ),
  );
}
