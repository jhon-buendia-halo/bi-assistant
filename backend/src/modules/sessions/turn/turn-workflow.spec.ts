import type { SessionDoc, ToolDataRecord } from '../entities/session.entity';
import {
  ATTEMPT_ROWS_CAP,
  analyseAttemptOf,
  attemptEarlierBlock,
  analyseQueriesOf,
  answeredTurnInput,
  catalogStepId,
  clarificationOptionText,
  clarifyingQuestionText,
  turnWorkflowOf,
} from './turn-workflow';
import {
  EARLIER_BLOCK_CAP,
  EARLIER_BLOCK_HEADER,
} from '../../../mastra/workflows/answer-business-question.prompts';

const session = (partial: Partial<SessionDoc> = {}): SessionDoc => ({
  id: 's-1',
  name: 'Run',
  datasets: ['World Cup'],
  agentKey: 'insights-analyst',
  messages: [],
  visualizations: [],
  createdAt: 't',
  updatedAt: 't',
  ...partial,
});

describe('turnWorkflowOf (agents.md 5.11, 5.16)', () => {
  it("runs a v2 session's turn as answer-business-question, its steps driving the bar", () => {
    expect(turnWorkflowOf(session())).toMatchObject({
      id: 'answer-business-question',
      engineId: 'answer-business-question',
      bar: 'steps',
      stepIds: [
        // Optional: taken only when the run has reference images (R35).
        'read-images',
        'receive-question',
        'load-catalog',
        'interpret-follow-up',
        'plan',
        'clarify',
        'analyse',
        'validate',
        'write-answer',
        'build-visual',
        'wrap-up',
        'page-result',
        'page-answer',
      ],
    });
  });

  it("runs a node chat's turn as its step's agent alone, on agent-turn", () => {
    expect(
      turnWorkflowOf(session({ run: true, contextBlock: 'NODE CHAT' })),
    ).toMatchObject({ engineId: 'agent-turn', bar: 'agent' });
  });

  it('runs a follow-up that asks one agent on ask-agent, its one step the asked one (agents.md 5.21)', () => {
    expect(
      turnWorkflowOf(
        session({
          run: true,
          ask: { step: 'write-answer' },
          contextBlock: 'STEP',
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        engineId: 'ask-agent',
        bar: 'agent',
        stepIds: ['write-answer'],
      }),
    );
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
      rows: Array.from({ length: 260 }, (_, n) => ({ n })),
      rowCount: 260,
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
      rowCount: 260,
      truncated: true,
    });
    // Plan 1.25.6: an attempt passes on up to 200 rows, so the answer can list them.
    expect(ATTEMPT_ROWS_CAP).toBe(200);
    expect(queries[0].rows).toHaveLength(ATTEMPT_ROWS_CAP);
    expect(queries[1]).toEqual({
      sql: 'SELECT nope',
      rows: [],
      rowCount: 0,
      truncated: false,
      error: 'no column',
    });
  });

  it("gives an attempt resumed after the agent's question the queries it ran before it asked, after a retry's own block (agents.md 5.11)", () => {
    const before: ToolDataRecord[] = [
      { tool: 'list_entities', input: '' },
      {
        tool: 'run_readonly_sql',
        input: 'SELECT stage FROM wc.matches GROUP BY stage',
        rationale: 'I list the stages.',
        rows: [{ stage: 'final' }],
        rowCount: 1,
      },
    ];
    const own = attemptEarlierBlock(undefined, before)!;
    expect(own.split('\n')).toEqual([
      EARLIER_BLOCK_HEADER,
      '1. I list the stages. | SQL: SELECT stage FROM wc.matches GROUP BY stage | coverage: whole-table | 1 rows | first rows: [{"stage":"final"}]',
    ]);
    // A resume within a retry: one block, attempt 1's queries then the
    // resumed attempt's, under one header, one numbering and one cap.
    const earlier = {
      queries: [
        {
          sql: 'SELECT count(*) FROM wc.goals',
          rows: [{ count: 24 }],
          rowCount: 1,
          truncated: false,
        },
      ],
      findings: [],
    };
    expect(attemptEarlierBlock(earlier, before)!.split('\n')).toEqual([
      EARLIER_BLOCK_HEADER,
      expect.stringMatching(
        /^1\. .*SELECT count\(\*\) FROM wc\.goals/,
      ) as string,
      expect.stringMatching(/^2\. I list the stages\./) as string,
    ]);
    const wide = Array.from({ length: 5 }, () => ({ note: 'x'.repeat(400) }));
    const many = Array.from({ length: 12 }, (_, n) => ({
      sql: `SELECT ${n} AS n`,
      rows: wide,
      rowCount: 5,
      truncated: false,
    }));
    const manyRecords: ToolDataRecord[] = many.map((query) => ({
      tool: 'run_readonly_sql',
      input: query.sql,
      rows: query.rows,
      rowCount: 5,
    }));
    expect(
      attemptEarlierBlock({ queries: many, findings: [] }, manyRecords)!.length,
    ).toBeLessThanOrEqual(EARLIER_BLOCK_CAP);
    // A retry not resumed: attempt 1's queries alone.
    expect(attemptEarlierBlock(earlier, [])).toBe(
      attemptEarlierBlock(earlier, undefined),
    );
    expect(attemptEarlierBlock(earlier, undefined)).toContain(
      'SELECT count(*) FROM wc.goals',
    );
    // Neither a retry nor a resume with queries: no block at all.
    expect(attemptEarlierBlock(undefined, undefined)).toBeUndefined();
    expect(attemptEarlierBlock(undefined, [before[0]])).toBeUndefined();
  });

  it('gives the calls, queries, the trimmed note and whether it stopped', () => {
    expect(analyseAttemptOf(records, false, '  A note. ')).toMatchObject({
      calls: [
        { tool: 'list_entities', failed: false },
        { tool: 'run_readonly_sql', rowCount: 260, failed: false },
        { tool: 'run_readonly_sql', failed: true },
      ],
      text: 'A note.',
      stopped: false,
    });
  });
});

describe('the turn after a clarifying question (agents.md 5.11, ADR-0043)', () => {
  const answered = {
    question: 'Which tournament?',
    options: ['2018 — Russia', '2022 — Qatar'],
    answer: '2022 — Qatar',
  };

  it('writes an option as one line, and the question as the assistant asked it', () => {
    expect(clarificationOptionText({ label: '2018' })).toBe('2018');
    expect(
      clarificationOptionText({ label: '2018', description: 'Russia' }),
    ).toBe('2018 — Russia');
    expect(clarifyingQuestionText(answered)).toBe(
      'Which tournament?\n- 2018 — Russia\n- 2022 — Qatar',
    );
  });

  it('hands the agent the turn input, its question and the answer: a bare question becomes its user message', () => {
    const tail = [
      {
        role: 'assistant',
        content: 'Which tournament?\n- 2018 — Russia\n- 2022 — Qatar',
      },
      { role: 'user', content: '2022 — Qatar' },
    ];
    expect(answeredTurnInput('Who won?', 'Who won?', [answered])).toEqual([
      { role: 'user', content: 'Who won?' },
      ...tail,
    ]);
    const transcript = [
      { role: 'user', content: 'Earlier' },
      { role: 'assistant', content: 'Reply' },
      { role: 'user', content: 'Who won?' },
    ];
    expect(answeredTurnInput(transcript, 'Who won?', [answered])).toEqual([
      ...transcript,
      ...tail,
    ]);
  });

  it('carries every answer of the turn, in order', () => {
    const second = { question: 'Which stage?', options: [], answer: 'Final' };
    expect(
      answeredTurnInput('Who won?', 'Who won?', [answered, second]).slice(1),
    ).toEqual([
      {
        role: 'assistant',
        content: 'Which tournament?\n- 2018 — Russia\n- 2022 — Qatar',
      },
      { role: 'user', content: '2022 — Qatar' },
      { role: 'assistant', content: 'Which stage?' },
      { role: 'user', content: 'Final' },
    ]);
  });
});
