import { ChatMessage } from '../../sessions/models/session.model';
import { WorkflowRunStep } from '../models/workflow.model';
import { workSummaryOf } from './work-summary';

function step(over: Partial<WorkflowRunStep> = {}): WorkflowRunStep {
  return {
    id: 'answer',
    title: 'Answer',
    status: 'success',
    startedAt: '2026-11-25T10:00:00.000Z',
    endedAt: '2026-11-25T10:00:48.400Z',
    ...over,
  };
}

function answer(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    role: 'assistant',
    content: 'Done',
    at: '2026-11-25T10:00:48Z',
    ...over,
  };
}

describe('workSummaryOf', () => {
  it('reads the duration from the step start to its end', () => {
    const summary = workSummaryOf({ steps: [step()], answer: answer() });
    expect(summary.seconds).toBe(48);
    expect(summary.durationLabel).toBe('Worked for 48 s');
  });

  it('has no duration while a step has not ended', () => {
    const summary = workSummaryOf({
      steps: [step({ endedAt: undefined })],
      answer: answer(),
    });
    expect(summary.seconds).toBeNull();
    expect(summary.durationLabel).toBeNull();
  });

  it('lists the skills the step loaded, once each', () => {
    const summary = workSummaryOf({
      steps: [
        step({
          toolCalls: [
            { tool: 'skill', input: 'sql-analysis' },
            { tool: 'run_readonly_sql', input: 'select 1' },
            { tool: 'skill', input: '{"name":"result-validation"}' },
            { tool: 'skill', input: 'sql-analysis' },
          ],
        }),
      ],
      answer: answer(),
    });
    expect(summary.skills).toEqual(['sql-analysis', 'result-validation']);
    expect(summary.skillsLabel).toBe('Loaded sql-analysis, result-validation');
  });

  it('hides the skills part when none was loaded', () => {
    const summary = workSummaryOf({ steps: [step()], answer: answer() });
    expect(summary.skillsLabel).toBeNull();
  });

  it('counts the distinct tables read and the queries run', () => {
    const summary = workSummaryOf({
      steps: [step()],
      answer: answer({
        data: [
          {
            tool: 'run_readonly_sql',
            input: 'select a',
            rationale: 'Total by team',
            rowCount: 8,
          },
          { tool: 'describe_entity' },
          { tool: 'run_readonly_sql', input: 'select b', rowCount: 1 },
        ],
        evidence: [
          {
            index: 0,
            tables: [
              { entity: 'c.s.a', rows: 10 },
              { entity: 'c.s.b', rows: 3 },
            ],
          },
          {
            index: 2,
            tables: [
              { entity: 'c.s.a', rows: 10 },
              { entity: 'c.s.c', rows: null },
            ],
          },
        ],
      }),
    });
    expect(summary.tablesLabel).toBe('Read 3 tables');
    expect(summary.queriesLabel).toBe('Ran 2 queries');
    expect(summary.queries.map((q) => q.index)).toEqual([0, 2]);
    expect(summary.queries[0]).toEqual({
      index: 0,
      rationale: 'Total by team',
      rows: 8,
    });
  });

  it('uses the singular for one table and one query', () => {
    const summary = workSummaryOf({
      steps: [step()],
      answer: answer({
        data: [{ tool: 'run_readonly_sql', input: 'select 1' }],
        evidence: [{ index: 0, tables: [{ entity: 'c.s.a', rows: 1 }] }],
      }),
    });
    expect(summary.tablesLabel).toBe('Read 1 table');
    expect(summary.queriesLabel).toBe('Ran 1 query');
  });

  it('counts passed checks and stays neutral when all hold', () => {
    const summary = workSummaryOf({
      steps: [step()],
      answer: answer({
        checks: [
          { check: 'Figures from queries', passed: true, detail: '' },
          { check: 'Data end date', passed: true, detail: '' },
        ],
      }),
    });
    expect(summary.checksLabel).toBe('2 of 2 checks passed');
    expect(summary.checksWarning).toBe(false);
  });

  it('turns to a warning when a non-warning check failed', () => {
    const summary = workSummaryOf({
      steps: [step()],
      answer: answer({
        checks: [
          { check: 'Figures from queries', passed: false, detail: 'x' },
          { check: 'Measures', passed: true, detail: '' },
          { check: 'Rows (warning only)', passed: false, detail: '' },
        ],
      }),
    });
    expect(summary.checksLabel).toBe('1 of 3 checks passed');
    expect(summary.checksWarning).toBe(true);
  });

  it('a failed warning-only check alone does not turn it to a warning', () => {
    const summary = workSummaryOf({
      steps: [step()],
      answer: answer({
        checks: [{ check: 'Rows (warning only)', passed: false, detail: '' }],
      }),
    });
    expect(summary.checksWarning).toBe(false);
  });

  it('hides the checks part without checks', () => {
    const summary = workSummaryOf({ steps: [step()], answer: answer() });
    expect(summary.checksLabel).toBeNull();
  });

  it('is empty for a run with no answer yet', () => {
    const summary = workSummaryOf({ steps: [] });
    expect(summary.queries).toEqual([]);
    expect(summary.queriesLabel).toBeNull();
    expect(summary.tablesLabel).toBeNull();
    expect(summary.durationLabel).toBeNull();
  });
});
