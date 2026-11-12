import type { WorkflowRunResult } from '../../mastra/workflows/workflow-run';
import {
  RUN_INTERRUPTED_ERROR,
  RunStepTracker,
  interruptedRunPatch,
  noteToolFrame,
  runHostDoc,
  runOfResult,
  runSummaryOf,
  runTitle,
  type WorkflowRunDoc,
} from './workflow-run-steps';

const base: WorkflowRunDoc = {
  id: 'r-1',
  workflowId: 'agent:assistant',
  workflowName: 'Assistant',
  input: { question: 'Who won?', datasets: ['World Cup Core'] },
  status: 'running',
  steps: [],
  datasets: [],
  startedAt: '2026-11-11T10:00:00.000Z',
};

describe('runTitle (plan 5.3)', () => {
  it('is the question, trimmed, at most 120 characters', () => {
    expect(runTitle({ ...base, question: '  Who won?  ' }, [])).toBe(
      'Who won?',
    );
    const long = 'x'.repeat(130);
    expect(runTitle({ ...base, question: long }, [])).toBe('x'.repeat(120));
  });

  it('else the first text or textarea input with a value', () => {
    expect(
      runTitle(
        {
          workflowName: 'Sequential test workflow',
          input: { other: 'skip me', text: '  Hello   world ' },
        },
        ['missing', 'text'],
      ),
    ).toBe('Hello   world');
  });

  it('else the workflow name', () => {
    expect(runTitle({ ...base, input: { text: '   ' } }, ['text'])).toBe(
      'Assistant',
    );
  });
});

describe('runSummaryOf (api.md 120)', () => {
  it('carries the id, workflow, status, title and times only', () => {
    expect(
      runSummaryOf(
        {
          ...base,
          status: 'success',
          question: 'Who won?',
          finishedAt: '2026-11-11T10:01:00.000Z',
          answer: { role: 'assistant', content: 'Brazil.', at: 't' },
        },
        [],
      ),
    ).toEqual({
      id: 'r-1',
      workflowId: 'agent:assistant',
      workflowName: 'Assistant',
      status: 'success',
      title: 'Who won?',
      startedAt: '2026-11-11T10:00:00.000Z',
      finishedAt: '2026-11-11T10:01:00.000Z',
    });
  });
});

describe('runHostDoc (plan 5.2: a run-backed host)', () => {
  it('shapes a stored agent run as its host: id, workspace, binding, question and answer, panel and visuals', () => {
    const answer = {
      role: 'assistant' as const,
      content: 'Brazil.',
      at: '2026-11-11T10:00:30.000Z',
    };
    const host = runHostDoc({
      ...base,
      workflowId: 'agent:rfp',
      workflowName: 'RFP Builder',
      status: 'success',
      question: 'Who won?',
      answer,
      datasets: ['World Cup Core'],
      agentKey: 'rfp',
      agentName: 'RFP Builder',
      rfpId: 'rfp-1',
      panelItems: [
        {
          id: 'p1',
          kind: 'document',
          title: 'Notes',
          markdown: '# Notes',
          shownAt: 't',
        },
      ],
      visualizations: [
        {
          id: 'v1',
          title: 'Goals',
          description: '',
          path: 'visuals/v1',
          createdAt: 't',
          updatedAt: 't',
        } as never,
      ],
      workflowState: { phases: [], updatedAt: 't' } as never,
    });
    expect(host).toEqual({
      id: 'run-r-1',
      name: 'RFP Builder',
      workspaceId: 'session-run-r-1',
      run: true,
      datasets: ['World Cup Core'],
      agentKey: 'rfp',
      agentName: 'RFP Builder',
      workflowId: 'agent:rfp',
      rfpId: 'rfp-1',
      messages: [
        { role: 'user', content: 'Who won?', at: '2026-11-11T10:00:00.000Z' },
        answer,
      ],
      panelItems: [
        {
          id: 'p1',
          kind: 'document',
          title: 'Notes',
          markdown: '# Notes',
          shownAt: 't',
        },
      ],
      visualizations: [expect.objectContaining({ id: 'v1' })],
      workflowState: { phases: [], updatedAt: 't' },
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T10:00:00.000Z',
    });
  });

  it('a run without an answer or panel has an empty transcript beyond its question', () => {
    const host = runHostDoc({ ...base, question: 'Who won?' });
    expect(host.messages).toEqual([
      { role: 'user', content: 'Who won?', at: base.startedAt },
    ]);
    expect(host.visualizations).toEqual([]);
    expect(host.panelItems).toBeUndefined();
  });
});

describe('runOfResult (api.md 118 stores a code-only run)', () => {
  it('projects a WorkflowRunResult into the stored run', () => {
    const result: WorkflowRunResult = {
      workflowId: 'seq-text-demo',
      status: 'failed',
      steps: [
        {
          id: 'clean-text',
          title: 'Clean text',
          status: 'failed',
          error: 'The text is empty',
        },
        { id: 'count-words', title: 'Count words', status: 'skipped' },
      ],
      error: 'The text is empty',
    };
    expect(runOfResult(result, '2026-11-11T10:00:01.000Z')).toEqual({
      status: 'failed',
      steps: result.steps,
      error: 'The text is empty',
      finishedAt: '2026-11-11T10:00:01.000Z',
    });
  });

  it('caps a step output larger than 20 000 JSON characters', () => {
    const big = { text: 'x'.repeat(20_001) };
    const patch = runOfResult(
      {
        workflowId: 'seq-text-demo',
        status: 'success',
        steps: [{ id: 'a', title: 'A', status: 'success', output: big }],
        output: { summary: 'ok' },
      },
      't',
    );
    expect(patch.steps).toEqual([
      { id: 'a', title: 'A', status: 'success', outputTruncated: true },
    ]);
    expect(patch.output).toEqual({ summary: 'ok' });
  });
});

describe('interruptedRunPatch (plan 5.1 step 5)', () => {
  it('fails a run the app stopped in, and any step still running', () => {
    expect(
      interruptedRunPatch(
        {
          ...base,
          steps: [
            { id: 'a', title: 'A', status: 'success' },
            { id: 'b', title: 'B', status: 'running' },
          ],
        },
        '2026-11-11T11:00:00.000Z',
      ),
    ).toEqual({
      status: 'failed',
      error: RUN_INTERRUPTED_ERROR,
      steps: [
        { id: 'a', title: 'A', status: 'success' },
        { id: 'b', title: 'B', status: 'failed', error: RUN_INTERRUPTED_ERROR },
      ],
      finishedAt: '2026-11-11T11:00:00.000Z',
    });
    expect(RUN_INTERRUPTED_ERROR).toBe(
      'The app stopped before the run finished',
    );
  });
});

/** A clock the test moves by hand, from 2026-11-12T10:00:00Z. */
function fakeClock() {
  const start = Date.UTC(2026, 10, 12, 10, 0, 0);
  let elapsed = 0;
  return {
    now: () => new Date(start + elapsed),
    advance: (ms: number) => {
      elapsed += ms;
    },
    at: (ms: number) => new Date(start + ms).toISOString(),
  };
}

const STEPS = [
  { id: 'load', title: 'Load', kind: 'code' as const },
  { id: 'answer', title: 'Answer', kind: 'agent' as const },
  { id: 'wrap', title: 'Wrap up', kind: 'code' as const },
];

const start = (id: string, payload?: unknown) => ({
  type: 'workflow-step-start',
  payload: { id, status: 'running', payload },
});

const result = (id: string, output: unknown, status = 'success') => ({
  type: 'workflow-step-result',
  payload: { id, status, output },
});

describe('RunStepTracker: input and times (api.md 3.6 `step`)', () => {
  it('records what a step received and when it started, then merges its result and end', () => {
    const clock = fakeClock();
    const tracker = new RunStepTracker(STEPS, clock.now);
    expect(tracker.apply(start('load', { text: 'Hi' }))).toEqual({
      id: 'load',
      title: 'Load',
      status: 'running',
      input: { text: 'Hi' },
      startedAt: clock.at(0),
    });
    clock.advance(1500);
    expect(tracker.apply(result('load', { words: 1 }))).toEqual({
      id: 'load',
      title: 'Load',
      status: 'success',
      input: { text: 'Hi' },
      output: { words: 1 },
      startedAt: clock.at(0),
      endedAt: clock.at(1500),
    });
  });

  it('marks an input larger than 20 000 JSON characters instead of carrying it, and ignores a non-object input', () => {
    const tracker = new RunStepTracker(STEPS, fakeClock().now);
    const big = tracker.apply(start('load', { text: 'x'.repeat(20_001) }));
    expect(big).toMatchObject({ inputTruncated: true });
    expect(big).not.toHaveProperty('input');
    const odd = tracker.apply(start('answer', 'not an object'));
    expect(odd).not.toHaveProperty('input');
    expect(odd).not.toHaveProperty('inputTruncated');
  });

  it('a failed result keeps the input and start, and adds its error and end', () => {
    const clock = fakeClock();
    const tracker = new RunStepTracker(STEPS, clock.now);
    tracker.apply(start('load', { text: ' ' }));
    clock.advance(10);
    expect(
      tracker.apply({
        type: 'workflow-step-result',
        payload: { id: 'load', status: 'failed', error: 'The text is empty' },
      }),
    ).toEqual({
      id: 'load',
      title: 'Load',
      status: 'failed',
      input: { text: ' ' },
      error: 'The text is empty',
      startedAt: clock.at(0),
      endedAt: clock.at(10),
    });
  });

  it('finish keeps the input and start, and sets the end on the steps it ends; a skipped step has none', () => {
    const clock = fakeClock();
    const tracker = new RunStepTracker(STEPS, clock.now);
    tracker.apply(start('load', { text: 'Hi' }));
    clock.advance(5);
    tracker.apply(result('load', { words: 1 }));
    tracker.apply(start('answer', { words: 1 }));
    clock.advance(20);
    const { steps, changed } = tracker.finish('stopped');
    expect(steps).toEqual([
      {
        id: 'load',
        title: 'Load',
        status: 'success',
        input: { text: 'Hi' },
        output: { words: 1 },
        startedAt: clock.at(0),
        endedAt: clock.at(5),
      },
      {
        id: 'answer',
        title: 'Answer',
        status: 'stopped',
        input: { words: 1 },
        startedAt: clock.at(5),
        endedAt: clock.at(25),
      },
      { id: 'wrap', title: 'Wrap up', status: 'skipped' },
    ]);
    expect(changed.map((step) => step.id)).toEqual(['answer', 'wrap']);
    const failed = new RunStepTracker(STEPS, clock.now);
    failed.apply(start('load', { text: 'Hi' }));
    expect(failed.finish('failed', 'boom').steps[0]).toEqual({
      id: 'load',
      title: 'Load',
      status: 'failed',
      input: { text: 'Hi' },
      error: 'boom',
      startedAt: clock.at(25),
      endedAt: clock.at(25),
    });
  });
});

describe('RunStepTracker: tool calls of an agent step (agents.md 5.14)', () => {
  it('attaches each call to the running agent step, its result to the first unfinished call of that name, with its duration', () => {
    const clock = fakeClock();
    const tracker = new RunStepTracker(STEPS, clock.now);
    tracker.apply(start('load', {}));
    // No agent step runs yet: a call has nowhere to go.
    tracker.noteTool('run_readonly_sql');
    tracker.apply(result('load', {}));
    tracker.apply(start('answer', {}));
    tracker.noteTool('run_readonly_sql', 'goals by team');
    clock.advance(100);
    tracker.noteTool('run_readonly_sql', 'matches by year');
    tracker.noteTool('list_entities');
    clock.advance(200);
    tracker.noteToolResult({
      tool: 'run_readonly_sql',
      input: 'SELECT team, SUM(goals) FROM goals GROUP BY team',
      rowCount: 32,
    });
    clock.advance(50);
    tracker.noteToolResult({
      tool: 'run_readonly_sql',
      input: 'SELECT year FROM matches',
      error: 'relation "matches" does not exist',
    });
    const done = tracker.apply(result('answer', { calls: [] }));
    expect(done?.toolCalls).toEqual([
      {
        tool: 'run_readonly_sql',
        input: 'SELECT team, SUM(goals) FROM goals GROUP BY team',
        rowCount: 32,
        durationMs: 300,
      },
      {
        tool: 'run_readonly_sql',
        input: 'SELECT year FROM matches',
        error: 'relation "matches" does not exist',
        durationMs: 250,
      },
      // A call whose tool sends no result has no duration.
      { tool: 'list_entities' },
    ]);
    expect(tracker.finish('success').steps[1].toolCalls).toHaveLength(3);
    expect(tracker.finish('success').steps[0]).not.toHaveProperty('toolCalls');
  });

  it("keeps the call's own input when its result has none, and a result without a call as a call", () => {
    const tracker = new RunStepTracker(STEPS, fakeClock().now);
    tracker.apply(start('answer', {}));
    tracker.noteTool('create_rfp', 'Acme');
    tracker.noteToolResult({ tool: 'create_rfp' });
    tracker.noteToolResult({ tool: 'show_in_panel', input: 'Draft' });
    expect(tracker.finish('success').steps[1].toolCalls).toEqual([
      { tool: 'create_rfp', input: 'Acme', durationMs: 0 },
      { tool: 'show_in_panel', input: 'Draft' },
    ]);
  });

  it('caps a step at 50 calls and a call input at 2 000 characters', () => {
    const tracker = new RunStepTracker(STEPS, fakeClock().now);
    tracker.apply(start('answer', {}));
    for (let i = 0; i < 60; i++) tracker.noteTool(`tool_${i}`);
    tracker.noteToolResult({ tool: 'tool_0', input: 'S'.repeat(2_500) });
    const calls = tracker.finish('success').steps[1].toolCalls!;
    expect(calls).toHaveLength(50);
    expect(calls.at(-1)?.tool).toBe('tool_49');
    expect(calls[0].input).toHaveLength(2_000);
  });

  it('a step started again starts with no calls; the steps it returns are copies', () => {
    const tracker = new RunStepTracker(STEPS, fakeClock().now);
    tracker.apply(start('answer', {}));
    tracker.noteTool('a');
    const before = tracker.finish('success').steps[1];
    before.toolCalls!.push({ tool: 'mutated' });
    expect(tracker.finish('success').steps[1].toolCalls).toEqual([
      { tool: 'a' },
    ]);
    tracker.apply(start('answer', {}));
    expect(tracker.finish('success').steps[1]).not.toHaveProperty('toolCalls');
  });
});

describe('noteToolFrame (api.md 3.1 `tool`, `tool-result`)', () => {
  it('feeds the JSON tool events, and a bare legacy tool name, to the tracker; other events change nothing', () => {
    const tracker = new RunStepTracker(STEPS, fakeClock().now);
    tracker.apply(start('answer', {}));
    noteToolFrame(tracker, {
      type: 'tool',
      content: JSON.stringify({
        name: 'run_readonly_sql',
        rationale: 'Count',
        input: 'count',
      }),
    });
    noteToolFrame(tracker, {
      type: 'tool-result',
      content: JSON.stringify({
        tool: 'run_readonly_sql',
        input: 'SELECT 1',
        rowCount: 1,
        rationale: 'Count',
      }),
    });
    noteToolFrame(tracker, { type: 'tool', content: 'describe_entity' });
    noteToolFrame(tracker, { type: 'text', content: 'Brazil' });
    noteToolFrame(tracker, { type: 'tool-result', content: '{"oops"' });
    noteToolFrame(tracker, { type: 'tool' });
    expect(tracker.finish('success').steps[1].toolCalls).toEqual([
      {
        tool: 'run_readonly_sql',
        input: 'SELECT 1',
        rowCount: 1,
        durationMs: 0,
      },
      { tool: 'describe_entity' },
    ]);
  });
});
