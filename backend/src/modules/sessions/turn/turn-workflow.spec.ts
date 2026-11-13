import type { SessionDoc, ToolDataRecord } from '../entities/session.entity';
import {
  ATTEMPT_ROWS_CAP,
  analyseAttemptOf,
  analyseQueriesOf,
  catalogStepId,
  turnWorkflowOf,
} from './turn-workflow';

const session = (partial: Partial<SessionDoc> = {}): SessionDoc => ({
  id: 's-1',
  name: 'Run',
  datasets: ['World Cup'],
  agentKey: 'assistant-v2',
  messages: [],
  visualizations: [],
  createdAt: 't',
  updatedAt: 't',
  ...partial,
});

describe('turnWorkflowOf (agents.md 5.11, 5.16)', () => {
  it("runs a v2 session's turn as qti-v2-turn, its steps driving the bar", () => {
    expect(turnWorkflowOf(session())).toMatchObject({
      id: 'qti-v2-turn',
      engineId: 'qti-v2-turn',
      bar: 'steps',
      stepIds: [
        'receive-question',
        'load-catalog',
        'plan',
        'clarify',
        'analyse',
        'validate',
        'write-answer',
        'wrap-up',
      ],
    });
  });

  it("runs a node chat's turn as its step's agent alone, on agent-turn", () => {
    expect(
      turnWorkflowOf(session({ run: true, contextBlock: 'NODE CHAT' })),
    ).toMatchObject({ engineId: 'agent-turn', bar: 'agent' });
  });
});

describe('catalogStepId (agents.md 5.11)', () => {
  it("is a nested workflow step's own id, the last segment of its path", () => {
    expect(catalogStepId('analysis-path.analysis-attempt.analyse')).toBe(
      'analyse',
    );
    expect(catalogStepId('plan')).toBe('plan');
  });
});

describe('an analysis attempt from its data records (agents.md 5.11)', () => {
  const records: ToolDataRecord[] = [
    { tool: 'list_entities', input: 'World Cup' },
    {
      tool: 'run_readonly_sql',
      input: 'SELECT n FROM t',
      rationale: 'I count.',
      rows: Array.from({ length: 60 }, (_, n) => ({ n })),
      rowCount: 60,
      truncated: true,
    },
    { tool: 'run_readonly_sql', input: 'SELECT nope', error: 'no column' },
  ];

  it('keeps each SQL query with its rationale, capped rows, count, cut and error', () => {
    const queries = analyseQueriesOf(records);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toMatchObject({
      sql: 'SELECT n FROM t',
      rationale: 'I count.',
      rowCount: 60,
      truncated: true,
    });
    expect(queries[0].rows).toHaveLength(ATTEMPT_ROWS_CAP);
    expect(queries[1]).toEqual({
      sql: 'SELECT nope',
      rows: [],
      rowCount: 0,
      truncated: false,
      error: 'no column',
    });
  });

  it('gives the calls, queries, the trimmed note and whether it stopped', () => {
    expect(analyseAttemptOf(records, false, '  A note. ')).toMatchObject({
      calls: [
        { tool: 'list_entities', failed: false },
        { tool: 'run_readonly_sql', rowCount: 60, failed: false },
        { tool: 'run_readonly_sql', failed: true },
      ],
      text: 'A note.',
      stopped: false,
    });
  });
});
