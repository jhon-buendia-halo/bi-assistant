import {
  NODE_CHAT_CONTEXT_CAP,
  SHORTENED_NOTE,
  nodeChatContextBlock,
} from './node-chat-context';
import type { WorkflowRunDoc } from './workflow-run-steps';

const run = (overrides: Partial<WorkflowRunDoc> = {}): WorkflowRunDoc => ({
  id: 'r-1',
  workflowId: 'qti-v2-turn',
  workflowName: 'Questions to Insights v2',
  input: { question: 'How many goals in 2022?', datasets: ['World Cup Core'] },
  status: 'success',
  steps: [
    { id: 'receive-question', title: 'Receive question', status: 'success' },
    {
      id: 'analyse',
      title: 'Analyse',
      status: 'success',
      input: {
        question: 'How many goals in 2022?',
        catalog: [{ entity: 'world_cup.goals', dataset: 'World Cup Core' }],
      },
      output: {
        calls: [{ tool: 'run_readonly_sql', rowCount: 1, failed: false }],
        stopped: false,
      },
      startedAt: '2026-11-12T10:00:01.000Z',
      endedAt: '2026-11-12T10:00:09.000Z',
      toolCalls: [
        { tool: 'list_entities' },
        {
          tool: 'run_readonly_sql',
          input: 'SELECT count(*) FROM world_cup.goals',
          rowCount: 1,
        },
        {
          tool: 'run_readonly_sql',
          input: 'SELECT nope',
          error: 'column "nope" does not exist',
        },
      ],
    },
  ],
  answer: { role: 'assistant', content: '172 goals.', at: 't' },
  question: 'How many goals in 2022?',
  datasets: ['World Cup Core'],
  startedAt: '2026-11-12T10:00:00.000Z',
  finishedAt: '2026-11-12T10:00:10.000Z',
  ...overrides,
});

describe('nodeChatContextBlock (agents.md 5.16)', () => {
  it('holds the workflow input, the step input, output, status and tool calls, and the final answer', () => {
    const block = nodeChatContextBlock(run(), 'analyse');
    expect(block).toContain('step "Analyse" (analyse) of run r-1');
    expect(block).toContain('Datasets: World Cup Core.');
    expect(block).toContain('## Workflow input');
    expect(block).toContain('"question": "How many goals in 2022?"');
    expect(block).toContain('## Step "Analyse": success');
    expect(block).toContain('"entity": "world_cup.goals"');
    expect(block).toContain('"stopped": false');
    expect(block).toContain('### Tool calls of the step (3)');
    expect(block).toContain('1. list_entities');
    expect(block).toContain(
      '2. run_readonly_sql (1 rows)\nSELECT count(*) FROM world_cup.goals',
    );
    expect(block).toContain(
      '3. run_readonly_sql (error: column "nope" does not exist)',
    );
    expect(block).toContain('## Final answer of the run\n172 goals.');
    expect(block).not.toContain(SHORTENED_NOTE);
    expect(block).not.toContain('[shortened');
  });

  it('says what the run did not keep: a too-large input, no output, no tool calls, no answer, a step error', () => {
    const block = nodeChatContextBlock(
      run({
        status: 'failed',
        error: 'Model error',
        answer: undefined,
        steps: [
          {
            id: 'analyse',
            title: 'Analyse',
            status: 'failed',
            inputTruncated: true,
            error: 'Model error',
          },
        ],
      }),
      'analyse',
    );
    expect(block).toContain('Run status: failed (error: Model error)');
    expect(block).toContain('## Step "Analyse": failed\nError: Model error');
    expect(block).toContain(
      '### Step input\n(not kept: larger than 20000 characters when the run stored it)',
    );
    expect(block).toContain('### Step output\n(none recorded)');
    expect(block).toContain('### Tool calls of the step (0)\n(none)');
    expect(block).not.toContain('Final answer');
  });

  it('stays within the cap, shortening only the long parts and saying so', () => {
    const big = 'x'.repeat(60_000);
    const block = nodeChatContextBlock(
      run({
        steps: [
          {
            id: 'analyse',
            title: 'Analyse',
            status: 'success',
            input: { question: 'Q', catalog: big },
            output: { calls: [], stopped: false },
          },
        ],
      }),
      'analyse',
    );
    expect(block.length).toBeLessThanOrEqual(NODE_CHAT_CONTEXT_CAP);
    expect(block.startsWith(SHORTENED_NOTE)).toBe(true);
    expect(block).toMatch(/\[shortened: \d+ of \d+ characters shown\]/);
    // The short parts are whole.
    expect(block).toContain('"stopped": false');
    expect(block).toContain('## Final answer of the run\n172 goals.');
    expect(block).toContain('"question": "How many goals in 2022?"');
  });

  it('shortens a block just over a small cap to fit it', () => {
    const whole = nodeChatContextBlock(run(), 'analyse').length;
    const cap = whole + 200;
    expect(nodeChatContextBlock(run(), 'analyse', cap).length).toBe(whole);
    const block = nodeChatContextBlock(run(), 'analyse', whole - 50);
    expect(block.length).toBeLessThanOrEqual(whole - 50);
    expect(block.startsWith(SHORTENED_NOTE)).toBe(true);
    expect(block).toContain('## Step "Analyse": success');
    expect(block).toContain('### Tool calls of the step (3)');
  });

  it('throws for a step the run does not have', () => {
    expect(() => nodeChatContextBlock(run(), 'nope')).toThrow(
      'Step "nope" is not in run "r-1"',
    );
  });
});
