import { NodeRunView } from '../models/workflow-node.model';
import {
  NARRATIVE_MAX_ROWS,
  NarrativeSource,
  buildStepNarrative,
  narrativeMarkdown,
  previewValue,
} from './workflow-step-narrative';

const LIST_SQL = 'SELECT winner, COUNT(*) FROM matches GROUP BY winner';
const WINS_SQL =
  'SELECT team, COUNT(*) AS wins FROM w GROUP BY team ORDER BY wins DESC LIMIT 5';

function analyseRun(over: Partial<NodeRunView> = {}): NodeRunView {
  return {
    status: 'success',
    durationMs: 18400,
    input: {
      question: 'Which 5 countries have won the most World Cup matches?',
      catalog: [{ entity: 'matches' }, { entity: 'teams' }],
      plan: { measures: ['wins'], entities: ['matches'] },
    },
    output: {
      text: '**Brazil** leads with 76 wins.\n\n| team | wins |\n|---|---|\n| Brazil | 76 |',
      queries: [
        {
          sql: LIST_SQL,
          rationale: 'Count wins by the winner column',
          rows: [],
          rowCount: 0,
          truncated: false,
          error: 'column "winner" does not exist',
        },
        {
          sql: WINS_SQL,
          rationale: 'Count wins from the scores of every match',
          rows: [
            { team: 'Brazil', wins: 76 },
            { team: 'Germany', wins: 68 },
            { team: 'Argentina', wins: 38 },
          ],
          rowCount: 3,
          truncated: false,
        },
      ],
      stopped: false,
    },
    toolCalls: [
      { tool: 'list_entities', durationMs: 120, finished: true },
      {
        tool: 'run_readonly_sql',
        input: LIST_SQL,
        error: 'column "winner" does not exist',
        durationMs: 80,
        finished: true,
      },
      {
        tool: 'run_readonly_sql',
        input: WINS_SQL,
        rowCount: 3,
        durationMs: 340,
        finished: true,
      },
    ],
    ...over,
  };
}

function source(over: Partial<NarrativeSource> = {}): NarrativeSource {
  return {
    title: 'Analyse',
    agentName: 'Michael',
    run: analyseRun(),
    attempt: 1,
    attempts: 1,
    duration: '18.4 s',
    ...over,
  };
}

describe('buildStepNarrative', () => {
  it('heads the report with the question and a meta line', () => {
    const n = buildStepNarrative(source({ attempt: 2, attempts: 2 }));
    expect(n.heading).toBe(
      'Which 5 countries have won the most World Cup matches?',
    );
    expect(n.meta).toBe(
      'Michael · attempt 2 of 2 · 18.4 s · 3 tool calls · 1 failed',
    );
    expect(n.status).toBe('success');
  });

  it("tells each tool call in order, with its query's rationale when it kept one", () => {
    const n = buildStepNarrative(source());
    expect(
      n.actions.map((a) => [a.index, a.tool, a.text, a.detail, a.error]),
    ).toEqual([
      [
        1,
        'list_entities',
        'Listed the entities of the datasets',
        '120 ms',
        null,
      ],
      [
        2,
        'run_readonly_sql',
        'Count wins by the winner column',
        '80 ms',
        'column "winner" does not exist',
      ],
      [
        3,
        'run_readonly_sql',
        'Count wins from the scores of every match',
        '3 rows · 340 ms',
        null,
      ],
    ]);
    expect(n.actions[2].sql).toBe(WINS_SQL);
    expect(n.actions[0].sql).toBeNull();
  });

  it('matches a call whose SQL was cut at 2 000 characters to its query', () => {
    const long = `SELECT 1 /* ${'x'.repeat(2100)} */`;
    const run = analyseRun({
      output: {
        queries: [
          {
            sql: long,
            rationale: 'A long one',
            rows: [],
            rowCount: 0,
            truncated: false,
          },
        ],
      },
      toolCalls: [
        {
          tool: 'run_readonly_sql',
          input: long.slice(0, 2000),
          finished: true,
        },
      ],
    });
    expect(buildStepNarrative(source({ run })).actions[0].text).toBe(
      'A long one',
    );
  });

  it('keeps the last query that returned rows as a table with bars for its measure', () => {
    const table = buildStepNarrative(source()).table!;
    expect(table.columns).toEqual(['team', 'wins']);
    expect(table.rows).toEqual([
      ['Brazil', '76'],
      ['Germany', '68'],
      ['Argentina', '38'],
    ]);
    expect(table.barColumn).toBe(1);
    expect(table.bars).toEqual([1, 68 / 76, 0.5]);
    expect(table.truncated).toBeFalse();
  });

  it(`shows at most ${NARRATIVE_MAX_ROWS} rows and says the table was cut`, () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ n: `r${i}`, v: i }));
    const run = analyseRun({
      output: {
        queries: [{ sql: 'SELECT', rows, rowCount: 120, truncated: true }],
      },
    });
    const table = buildStepNarrative(source({ run })).table!;
    expect(table.rows.length).toBe(NARRATIVE_MAX_ROWS);
    expect(table.rowCount).toBe(120);
    expect(table.truncated).toBeTrue();
  });

  it('draws no bars when no column after the first is numeric', () => {
    const run = analyseRun({
      output: {
        queries: [
          {
            sql: 'SELECT',
            rows: [{ a: 'x', b: 'y' }],
            rowCount: 1,
            truncated: false,
          },
        ],
      },
    });
    const table = buildStepNarrative(source({ run })).table!;
    expect(table.barColumn).toBeNull();
    expect(table.bars).toEqual([]);
  });

  it("uses the step's own words: a headline first, then its notes, then an answer", () => {
    const words = (output: Record<string, unknown>) =>
      buildStepNarrative(source({ run: analyseRun({ output }) })).summary;
    expect(words({ headline: 'H', text: 'T', answer: 'A' })).toBe('H');
    expect(words({ text: 'T', answer: 'A' })).toBe('T');
    expect(words({ answer: 'A' })).toBe('A');
    expect(words({ plan: {} })).toBeNull();
  });

  it('reads each received field in one short line', () => {
    expect(buildStepNarrative(source()).received).toEqual([
      {
        name: 'question',
        value: 'Which 5 countries have won the most World Cup matches?',
      },
      { name: 'catalog', value: '2 items' },
      { name: 'plan', value: 'measures, entities' },
    ]);
    expect(previewValue('x'.repeat(200)).length).toBe(140);
    expect(previewValue(null)).toBe('None');
    expect(previewValue([1])).toBe('1 item');
  });

  it('lists the returned fields and a failed step’s error', () => {
    const n = buildStepNarrative(
      source({ run: analyseRun({ status: 'failed', error: 'Model error' }) }),
    );
    expect(n.returned).toEqual(['text', 'queries', 'stopped']);
    expect(n.error).toBe('Model error');
  });

  it('is only a heading for a step that has not run', () => {
    const n = buildStepNarrative(source({ run: null, duration: '' }));
    expect(n.heading).toBe('Analyse');
    expect(n.meta).toBe('Michael');
    expect(n.status).toBeNull();
    expect(n.actions).toEqual([]);
    expect(n.table).toBeNull();
    expect(n.returned).toEqual([]);
  });

  it('marks a call still running', () => {
    const run = analyseRun({
      status: 'running',
      toolCalls: [{ tool: 'sample_rows', finished: false }],
    });
    const [action] = buildStepNarrative(source({ run })).actions;
    expect(action.running).toBeTrue();
    expect(action.text).toBe('Looked at sample rows');
  });
});

describe('narrativeMarkdown', () => {
  it('writes the Preview as Markdown, its SQL fenced and its result as a table', () => {
    const md = narrativeMarkdown(
      'How Analyse ran',
      buildStepNarrative(source()),
    );
    expect(md).toContain(
      '# Which 5 countries have won the most World Cup matches?',
    );
    expect(md).toContain(
      '_How Analyse ran · Michael · 18.4 s · 3 tool calls · 1 failed_',
    );
    expect(md).toContain(
      '2. Count wins by the winner column (`run_readonly_sql` · 80 ms · failed: column "winner" does not exist)',
    );
    expect(md).toContain('   ```sql');
    expect(md).toContain('| team | wins |');
    expect(md).toContain('| Brazil | 76 |');
    expect(md).toContain('## What it returned');
  });
});
