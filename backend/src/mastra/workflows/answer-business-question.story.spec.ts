import { answerBusinessQuestionStoryteller as tell } from './answer-business-question.story';
import type { StoryContext, StoryStep } from './workflow-story';

const PLAN = {
  question:
    'Which player scored the most goals in the 2022 World Cup, shoot-outs excluded?',
  measures: ['Goals per player'],
  entities: ['goals', 'players'],
  scope: 'Matches of the 2022 World Cup',
  assumptions: ["Shoot-out penalties don't count"],
  needsClarification: false,
  clarification: null,
};

function step(id: string, overrides: Partial<StoryStep> = {}): StoryStep {
  return { id, title: id, status: 'success', ...overrides };
}

function context(overrides: Partial<StoryContext> = {}): StoryContext {
  return { runInput: {}, steps: [], ...overrides };
}

describe('Answer a Business Question step stories (ui.md 4.4b, Logs Story)', () => {
  it('Receive question names the question and its dataset', () => {
    expect(
      tell(
        step('receive-question', {
          output: { question: 'Who won?', datasets: ['World Cup'] },
        }),
        context(),
      ),
    ).toEqual({
      headline: 'Got the question “Who won?” on the World Cup dataset.',
    });
  });

  it('Load catalog counts the tables and columns and lists the tables', () => {
    expect(
      tell(
        step('load-catalog', {
          output: {
            catalog: [
              { entity: 'goals', columnCount: 6 },
              { entity: 'players', columnCount: 4 },
            ],
          },
        }),
        context(),
      ),
    ).toEqual({
      headline: 'Read the catalog: 2 tables and 10 columns.',
      facts: [{ label: 'Tables', values: ['goals', 'players'], code: true }],
      brief: '2 tables',
    });
  });

  it('Plan restates the question, lists the plan and says Clarify was not needed', () => {
    expect(tell(step('plan', { output: { plan: PLAN } }), context())).toEqual({
      headline: `Read the question as “${PLAN.question}”`,
      facts: [
        { label: 'Will measure', values: ['Goals per player'] },
        { label: 'Tables', values: ['goals', 'players'], code: true },
        { label: 'Scope', values: ['Matches of the 2022 World Cup'] },
        { label: 'Assumed', values: ["Shoot-out penalties don't count"] },
      ],
      next: 'Nothing was ambiguous, so Clarify was skipped and Analyse ran next.',
    });
  });

  it('Plan says what Clarify asks when the plan needs an answer', () => {
    const asks = {
      ...PLAN,
      needsClarification: true,
      clarification: { question: 'Count own goals?', options: ['Yes', 'No'] },
    };
    expect(
      tell(step('plan', { output: { plan: asks } }), context())?.next,
    ).toBe(
      'Something in the question changes the analysis, so Clarify asks you: “Count own goals?”',
    );
  });

  it("a skipped Clarify gives the plan's reason", () => {
    const planStep = step('plan', { output: { plan: PLAN } });
    expect(
      tell(
        step('clarify', { status: 'skipped' }),
        context({ steps: [planStep] }),
      ),
    ).toEqual({
      headline: 'Skipped: nothing in the plan needed your answer.',
      brief: 'Nothing to clarify',
    });
  });

  it('Analyse counts its queries, the failed ones and the last rows, one fact per query', () => {
    const story = tell(
      step('analyse', {
        attempt: 1,
        output: {
          queries: [
            {
              sql: 'a',
              rationale: 'Goals per player',
              rowCount: 0,
              error: 'no column player_id',
            },
            {
              sql: 'b',
              rationale: 'Goals per player (fixed column)',
              rowCount: 116,
            },
            { sql: 'c', rationale: 'Top 10 scorers', rowCount: 10 },
          ],
        },
      }),
      context(),
    );
    expect(story).toEqual({
      headline:
        'Ran 3 queries on the data (1 failed). The last one returned 10 rows.',
      facts: [
        {
          label: 'Query 1',
          values: ['Goals per player — failed: no column player_id'],
          verdict: 'failed',
          sql: 'a',
        },
        {
          label: 'Query 2',
          values: ['Goals per player (fixed column) — 116 rows'],
          sql: 'b',
        },
        { label: 'Query 3', values: ['Top 10 scorers — 10 rows'], sql: 'c' },
      ],
      brief: '3 queries · 1 failed',
      stats: [{ value: '3', label: 'queries · 1 failed' }],
    });
  });

  it('Analyse falls back to its tool calls when its output was over the cap, and names a retry', () => {
    const story = tell(
      step('analyse', {
        attempt: 2,
        input: {
          findings: [
            { check: 'Result not cut', passed: false, detail: 'cut at 500' },
            { check: 'A query ran', passed: true, detail: 'yes' },
          ],
        },
        toolCalls: [
          { tool: 'list_entities' },
          { tool: 'run_readonly_sql', rowCount: 12 },
        ],
      }),
      context(),
    );
    expect(story?.headline).toBe(
      'Second try, after Validate flagged result not cut. Ran 1 query on the data. The last one returned 12 rows.',
    );
  });

  it('Validate lists each check with its verdict, counts them and says what came next', () => {
    const findings = [
      { check: 'A query ran', passed: true, detail: '3 queries ran' },
      { check: 'Result not cut', passed: false, detail: 'cut at 500 rows' },
    ];
    expect(
      tell(
        step('validate', {
          attempt: 1,
          output: { ok: false, attempt: 1, findings },
        }),
        context(),
      ),
    ).toEqual({
      headline: '1 of 2 checks failed.',
      facts: [
        { label: 'A query ran', values: ['3 queries ran'], verdict: 'passed' },
        {
          label: 'Result not cut',
          values: ['cut at 500 rows'],
          verdict: 'failed',
        },
      ],
      next: 'Analyse tried once more to fix it.',
      brief: '1 of 2 checks failed',
      concern: true,
      stats: [{ value: '1 / 2', label: 'checks passed' }],
    });
    expect(
      tell(
        step('validate', {
          attempt: 1,
          output: { ok: true, findings: [findings[0]] },
        }),
        context(),
      )?.headline,
    ).toBe('Its one check passed.');
  });

  it('a skipped Check data quality says the check was off', () => {
    expect(
      tell(step('check-data-quality', { status: 'skipped' }), context()),
    ).toEqual({
      headline: 'Skipped: the data quality check was off for this run.',
      brief: 'Off for this run',
    });
    // On but not reached: left to the generic story.
    expect(
      tell(
        step('check-data-quality', { status: 'skipped' }),
        context({ runInput: { checkDataQuality: true } }),
      ),
    ).toBeUndefined();
  });

  it('Check data quality counts the tables and the issues', () => {
    expect(
      tell(
        step('check-data-quality', {
          output: {
            dataQuality: { tables: ['goals'], issues: 2, skipped: [] },
          },
        }),
        context(),
      ),
    ).toEqual({
      headline:
        'Checked the quality of 1 table: 2 issues could affect this answer.',
      facts: [{ label: 'Tables checked', values: ['goals'], code: true }],
      brief: '2 issues',
      concern: true,
    });
  });

  it('Write answer quotes the headline and the rows it rests on; Wrap up counts the rows', () => {
    expect(
      tell(
        step('write-answer', {
          input: { queries: [{ rowCount: 10 }, { rowCount: 3, error: 'x' }] },
          output: { headline: 'Mbappé scored the most goals', answer: '…' },
        }),
        context(),
      ),
    ).toEqual({
      headline: 'Wrote the answer: “Mbappé scored the most goals”',
      facts: [{ label: 'Based on', values: ['10 rows from 1 query'] }],
    });
    expect(
      tell(
        step('wrap-up', {
          output: { sqlQueries: 3, failedQueries: 1, rows: 126, answer: '…' },
        }),
        context(),
      ),
    ).toEqual({
      headline: 'Finished: the answer rests on 126 rows from 3 queries.',
      stats: [{ value: '126', label: 'rows read' }],
      brief: '126 rows',
    });
  });

  it('leaves a failed step, and a step without its data, to the generic story', () => {
    expect(
      tell(step('plan', { status: 'failed', error: 'x' }), context()),
    ).toBeUndefined();
    expect(
      tell(
        step('plan', { outputTruncated: true } as Partial<StoryStep>),
        context(),
      ),
    ).toBeUndefined();
    expect(tell(step('validate'), context())).toBeUndefined();
  });
});
