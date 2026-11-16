/**
 * The stories of Answer a Business Question's steps (ui.md 4.4b, Logs
 * *Story*): what each step did in this run, in business words, from its
 * output (Plan's plan, Analyse's queries, Validate's findings) and, for a
 * skipped step, why the run went another way. A step whose data is missing
 * (an old run, an output over the cap) falls back to the generic story.
 * Pure: no framework import.
 */
import {
  capList,
  clip,
  listPhrase,
  plural,
  record,
  strings,
  textOf,
  type StepStory,
  type StepStoryteller,
  type StoryContext,
  type StoryFact,
  type StoryStep,
} from './workflow-story';

type Told = Omit<StepStory, 'source'>;

/** The SQL tool every query of the analysis runs through. */
const SQL_TOOL = 'run_readonly_sql';

/** The output of a step's last attempt in the run so far, if it kept one. */
function lastOutput(
  context: StoryContext,
  id: string,
): Record<string, unknown> | undefined {
  return context.steps.filter((step) => step.id === id).at(-1)?.output;
}

/** `"text"`, clipped. */
function quoted(text: string, max?: number): string {
  return `“${clip(text, max)}”`;
}

function receiveQuestion(step: StoryStep): Told | undefined {
  const output = step.output;
  const question = output?.['question'];
  if (typeof question !== 'string' || !question.trim()) return undefined;
  const datasets = strings(output?.['datasets']);
  const on = !datasets.length
    ? ''
    : datasets.length === 1
      ? ` on the ${datasets[0]} dataset`
      : ` on ${datasets.length} datasets: ${listPhrase(datasets)}`;
  return { headline: `Got the question ${quoted(question)}${on}.` };
}

function loadCatalog(step: StoryStep): Told | undefined {
  const catalog = step.output?.['catalog'];
  if (!Array.isArray(catalog)) return undefined;
  const entities = catalog
    .map(record)
    .filter((entry): entry is Record<string, unknown> => !!entry);
  const names = entities
    .map((entry) => entry['entity'])
    .filter((name): name is string => typeof name === 'string');
  const counts = entities.map((entry) => entry['columnCount']);
  const known = counts.filter(
    (count): count is number => typeof count === 'number',
  );
  const columns =
    known.length === counts.length
      ? known.reduce((sum, count) => sum + count, 0)
      : null;
  if (!names.length) {
    return { headline: 'Found no tables in the datasets of this run.' };
  }
  return {
    headline: `Read the catalog: ${plural(names.length, 'table')}${
      columns !== null ? ` and ${plural(columns, 'column')}` : ''
    }.`,
    facts: [{ label: 'Tables', values: capList(names), code: true }],
  };
}

/** The plan of a Plan output, or undefined. */
function planOf(output: Record<string, unknown> | undefined) {
  return record(output?.['plan']);
}

function plan(step: StoryStep): Told | undefined {
  if (step.status === 'stopped' && !step.output) {
    return { headline: 'You stopped the run while it was planning.' };
  }
  const planned = planOf(step.output);
  const restated = planned?.['question'];
  if (!planned || typeof restated !== 'string') return undefined;
  const facts: StoryFact[] = [];
  const measures = strings(planned['measures']);
  if (measures.length) facts.push({ label: 'Will measure', values: measures });
  const entities = strings(planned['entities']);
  if (entities.length) {
    facts.push({ label: 'Tables', values: capList(entities), code: true });
  }
  const scope = planned['scope'];
  if (typeof scope === 'string' && scope.trim()) {
    facts.push({ label: 'Scope', values: [clip(scope)] });
  }
  const assumptions = strings(planned['assumptions']);
  if (assumptions.length) {
    facts.push({ label: 'Assumed', values: assumptions.map((a) => clip(a)) });
  }
  const clarification = record(planned['clarification']);
  const ask = clarification?.['question'];
  const answered = record(step.input?.['clarification']);
  let next: string;
  if (planned['needsClarification'] === true && typeof ask === 'string') {
    next = `Something in the question changes the analysis, so Clarify asks you: ${quoted(ask)}`;
  } else if (answered && typeof answered['answer'] === 'string') {
    next = `It planned with your answer ${quoted(answered['answer'], 120)}, then Analyse ran.`;
  } else {
    next =
      'Nothing was ambiguous, so Clarify was skipped and Analyse ran next.';
  }
  return {
    headline: `Read the question as ${quoted(restated)}`,
    ...(facts.length ? { facts } : {}),
    next,
  };
}

function clarify(step: StoryStep, context: StoryContext): Told | undefined {
  if (step.status === 'skipped') {
    const planned = planOf(lastOutput(context, 'plan'));
    if (!planned) return undefined;
    return planned['needsClarification'] === true
      ? undefined
      : { headline: 'Skipped: nothing in the plan needed your answer.' };
  }
  const clarification = record(step.output?.['clarification']);
  const question = clarification?.['question'];
  const answer = clarification?.['answer'];
  if (typeof question !== 'string' || typeof answer !== 'string') {
    return undefined;
  }
  return {
    headline: `Asked you ${quoted(question)} and you answered ${quoted(answer, 120)}.`,
    next: 'Plan planned again with your answer.',
  };
}

/** One query of an analysis attempt, from its output or its tool calls. */
interface StoryQuery {
  why: string | null;
  rows: number | null;
  error: string | null;
  /** The statement, to find it among the answer's queries; null when not kept. */
  sql: string | null;
}

/** The longest statement a query fact carries, in characters. */
const STORY_SQL_MAX = 4000;

function sqlOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value.slice(0, STORY_SQL_MAX)
    : null;
}

function queriesOf(step: StoryStep): StoryQuery[] {
  const queries = step.output?.['queries'];
  if (Array.isArray(queries)) {
    return queries.map(record).flatMap((query) =>
      query
        ? [
            {
              why:
                typeof query['rationale'] === 'string' &&
                query['rationale'].trim()
                  ? query['rationale']
                  : null,
              rows:
                typeof query['rowCount'] === 'number'
                  ? query['rowCount']
                  : null,
              error:
                typeof query['error'] === 'string' && query['error']
                  ? query['error']
                  : null,
              sql: sqlOf(query['sql']),
            },
          ]
        : [],
    );
  }
  return (step.toolCalls ?? [])
    .filter((call) => call.tool === SQL_TOOL)
    .map((call) => ({
      why: null,
      rows: typeof call.rowCount === 'number' ? call.rowCount : null,
      error: call.error ?? null,
      sql: sqlOf(call.input),
    }));
}

/** The failed checks Analyse retries after: its input's findings. */
function retryReasons(step: StoryStep): string[] {
  const findings = step.input?.['findings'];
  if (!Array.isArray(findings)) return [];
  return findings
    .map(record)
    .filter((finding) => finding && finding['passed'] === false)
    .map((finding) => textOf(finding?.['check']))
    .filter(Boolean);
}

function analyse(step: StoryStep): Told | undefined {
  const queries = queriesOf(step);
  const failed = queries.filter((query) => query.error).length;
  const lastGood = [...queries].reverse().find((query) => !query.error);
  const retry = (step.attempt ?? 1) > 1;
  const reasons = retry ? retryReasons(step) : [];
  const prefix = retry
    ? `Second try${reasons.length ? `, after Validate flagged ${listPhrase(reasons.map((r) => r.toLowerCase()))}` : ''}. `
    : '';
  let headline: string;
  if (!queries.length) {
    headline =
      step.status === 'stopped'
        ? 'You stopped the analysis before it ran a query.'
        : 'Finished without running a query on the data.';
  } else {
    const ran = `Ran ${plural(queries.length, 'query', 'queries')} on the data${
      failed ? ` (${failed} failed)` : ''
    }.`;
    const result =
      lastGood && lastGood.rows !== null
        ? ` The last one returned ${plural(lastGood.rows, 'row')}.`
        : '';
    headline =
      step.status === 'stopped'
        ? `You stopped the analysis after it ran ${plural(queries.length, 'query', 'queries')}.`
        : `${ran}${result}`;
  }
  // One fact per query that says something beyond "it ran".
  const facts: StoryFact[] = queries.slice(0, 8).flatMap((query, index) => {
    const result = query.error
      ? `failed: ${clip(query.error, 120)}`
      : query.rows !== null
        ? plural(query.rows, 'row')
        : '';
    if (!query.why && !result) return [];
    return [
      {
        label: `Query ${index + 1}`,
        values: [
          [query.why ? clip(query.why, 160) : 'Ran a query', result]
            .filter(Boolean)
            .join(' — '),
        ],
        ...(query.error ? { verdict: 'failed' as const } : {}),
        ...(query.sql ? { sql: query.sql } : {}),
      },
    ];
  });
  return {
    headline: `${prefix}${headline}`,
    ...(facts.length ? { facts } : {}),
    stats: [
      {
        value: String(queries.length),
        label: failed
          ? `${queries.length === 1 ? 'query' : 'queries'} · ${failed} failed`
          : queries.length === 1
            ? 'query'
            : 'queries',
      },
    ],
  };
}

function validate(step: StoryStep): Told | undefined {
  const findings = step.output?.['findings'];
  if (!Array.isArray(findings)) return undefined;
  const checks = findings
    .map(record)
    .filter((finding): finding is Record<string, unknown> => !!finding);
  const passed = checks.filter((check) => check['passed'] === true).length;
  const ok = step.output?.['ok'] === true;
  const attempt = step.attempt ?? Number(step.output?.['attempt'] ?? 1);
  const failedCount = checks.length - passed;
  const headline = !checks.length
    ? 'Had nothing to check.'
    : failedCount === 0
      ? checks.length === 1
        ? 'Its one check passed.'
        : `All ${plural(checks.length, 'check')} passed.`
      : `${failedCount} of ${plural(checks.length, 'check')} failed.`;
  const next = ok
    ? 'The results hold, so the answer was written from them.'
    : attempt < 2
      ? 'Analyse tried once more to fix it.'
      : 'It had already retried once, so the answer was written from these results, with the failed checks noted.';
  return {
    headline,
    facts: checks.map((check) => ({
      label: clip(textOf(check['check'], 'Check'), 80),
      values: [clip(textOf(check['detail']), 200)].filter(Boolean),
      verdict:
        check['passed'] === true ? ('passed' as const) : ('failed' as const),
    })),
    next,
    stats: [{ value: `${passed} / ${checks.length}`, label: 'checks passed' }],
  };
}

function checkDataQuality(
  step: StoryStep,
  context: StoryContext,
): Told | undefined {
  if (step.status === 'skipped') {
    return context.runInput['checkDataQuality'] === true
      ? undefined
      : { headline: 'Skipped: the data quality check was off for this run.' };
  }
  const summary = record(step.output?.['dataQuality']);
  if (!summary) return undefined;
  const error = summary['error'];
  if (typeof error === 'string' && error) {
    return { headline: `Could not check the data quality: ${clip(error)}` };
  }
  const tables = strings(summary['tables']);
  const issues = typeof summary['issues'] === 'number' ? summary['issues'] : 0;
  const skipped = strings(summary['skipped']);
  const facts: StoryFact[] = [];
  if (tables.length) {
    facts.push({
      label: 'Tables checked',
      values: capList(tables),
      code: true,
    });
  }
  if (skipped.length) {
    facts.push({
      label: 'Not assessed',
      values: capList(skipped),
      code: true,
    });
  }
  return {
    headline: `Checked the quality of ${plural(tables.length, 'table')}: ${
      issues
        ? `${plural(issues, 'issue')} could affect this answer`
        : 'nothing found that affects this answer'
    }.`,
    ...(facts.length ? { facts } : {}),
  };
}

function writeAnswer(step: StoryStep): Told | undefined {
  const headline = step.output?.['headline'];
  if (typeof headline !== 'string' || !headline.trim()) return undefined;
  const queries = step.input?.['queries'];
  const facts: StoryFact[] = [];
  if (Array.isArray(queries)) {
    const good = queries
      .map(record)
      .filter((query) => query && !query['error']);
    const rows = good.reduce(
      (sum, query) =>
        sum + (typeof query?.['rowCount'] === 'number' ? query['rowCount'] : 0),
      0,
    );
    facts.push({
      label: 'Based on',
      values: [
        `${plural(rows, 'row')} from ${plural(good.length, 'query', 'queries')}`,
      ],
    });
  }
  return {
    headline: `Wrote the answer: ${quoted(headline)}`,
    ...(facts.length ? { facts } : {}),
  };
}

function wrapUp(step: StoryStep): Told | undefined {
  const rows = step.output?.['rows'];
  const queries = step.output?.['sqlQueries'];
  if (typeof rows !== 'number' || typeof queries !== 'number') return undefined;
  return {
    headline: `Finished: the answer rests on ${plural(rows, 'row')} from ${plural(queries, 'query', 'queries')}.`,
    stats: [{ value: rows.toLocaleString('en-US'), label: 'rows read' }],
  };
}

const TELLERS: Record<
  string,
  (step: StoryStep, context: StoryContext) => Told | undefined
> = {
  'receive-question': receiveQuestion,
  'load-catalog': loadCatalog,
  plan,
  clarify,
  analyse,
  validate,
  'check-data-quality': checkDataQuality,
  'write-answer': writeAnswer,
  'wrap-up': wrapUp,
};

/**
 * Answer a Business Question's storyteller: a failed step is left to the
 * generic story (its error); any other step, by its id.
 */
export const answerBusinessQuestionStoryteller: StepStoryteller = (
  step,
  context,
) => {
  if (step.status === 'failed') return undefined;
  return TELLERS[step.id]?.(step, context);
};
