import { RunView, WorkflowDetail } from '../models/workflow.model';
import {
  NodeInspectionSource,
  buildNodeInspections,
  durationMs,
  formatDuration,
  nodeStatuses,
  workflowStateSummary,
} from './workflow-node-inspection';

const WORKFLOW = {
  id: 'agent:assistant',
  name: 'Assistant',
  description: 'Answers questions.',
  agents: [{ key: 'assistant', name: 'Assistant', model: 'openai/gpt-5' }],
  steps: [
    { id: 'prepare', title: 'Prepare', kind: 'code', summary: 'Prepares.', input: ['question'], output: ['prompt'], exits: [] },
    {
      id: 'answer',
      title: 'Answer',
      kind: 'agent',
      summary: 'Answers.',
      input: ['prompt'],
      output: ['answer'],
      agent: { key: 'assistant', name: 'Assistant', tools: ['run_readonly_sql'], maxSteps: 8 },
      exits: [],
    },
  ],
} as unknown as WorkflowDetail;

function src(run: RunView | null, extra: Partial<NodeInspectionSource> = {}): NodeInspectionSource {
  return { workflow: WORKFLOW, run, liveToolCalls: [], running: false, ...extra };
}

const STORED: RunView = {
  status: 'success',
  runId: 'run-1',
  input: { question: 'Q' },
  startedAt: '2026-11-11T10:00:00.000Z',
  finishedAt: '2026-11-11T10:00:14.000Z',
  output: { answer: 'A' },
  steps: [
    { id: 'prepare', title: 'Prepare', kind: 'code', status: 'success', input: { question: 'Q' }, output: { prompt: 'P' }, startedAt: '2026-11-11T10:00:00.000Z', endedAt: '2026-11-11T10:00:00.002Z' },
    {
      id: 'answer', title: 'Answer', kind: 'agent', status: 'success', output: { answer: 'A' },
      startedAt: '2026-11-11T10:00:00.002Z', endedAt: '2026-11-11T10:00:13.902Z',
      toolCalls: [{ tool: 'run_readonly_sql', input: 'select 1', rowCount: 1, durationMs: 40 }],
    },
  ],
};

describe('buildNodeInspections', () => {
  it('lists Start, the steps in order, End with kinds, titles and numbers', () => {
    const n = buildNodeInspections(src(null));
    expect(n.map((x) => [x.nodeId, x.kind, x.title, x.number])).toEqual([
      ['start', 'trigger', 'Start', null],
      ['prepare', 'code', 'Prepare', 1],
      ['answer', 'agent', 'Answer', 2],
      ['end', 'output', 'End', null],
    ]);
    expect(n[0].summary).toBe('Answers questions.');
    expect(n[3].summary).toBe('');
    expect(n.every((x) => x.run === null)).toBeTrue();
    expect(n[2].agent?.model).toBe('openai/gpt-5');
  });

  it('shows a stored successful run', () => {
    const n = buildNodeInspections(src(STORED));
    expect(n[0].run).toEqual(jasmine.objectContaining({ status: 'success', input: { question: 'Q' }, output: { question: 'Q' } }));
    expect(n[1].run?.durationMs).toBe(2);
    expect(n[2].run?.toolCalls).toEqual([
      { tool: 'run_readonly_sql', input: 'select 1', rowCount: 1, durationMs: 40, finished: true },
    ]);
    expect(n[2].context).toEqual({
      workflowInput: { question: 'Q' },
      earlierSteps: [{ id: 'prepare', title: 'Prepare', status: 'success' }],
      agent: { key: 'assistant', name: 'Assistant', model: 'openai/gpt-5', tools: ['run_readonly_sql'] },
    });
    expect(n[3].run).toEqual(jasmine.objectContaining({ status: 'success', input: { answer: 'A' }, output: { answer: 'A' } }));
  });

  it('marks End skipped on a failed run and stopped on a stopped run', () => {
    const failed: RunView = { ...STORED, status: 'failed', error: 'boom', output: undefined,
      steps: [STORED.steps[0], { id: 'answer', title: 'Answer', kind: 'agent', status: 'failed', error: 'boom' }] };
    const f = buildNodeInspections(src(failed));
    expect(f[3].run?.status).toBe('skipped');
    expect(f[3].run?.error).toBe('boom');
    expect(f[2].run?.status).toBe('failed');
    const s = buildNodeInspections(src({ ...STORED, status: 'stopped' }));
    expect(s[3].run?.status).toBe('stopped');
  });

  it('feeds the running agent step the live tool calls, and End has no run', () => {
    const live: RunView = {
      status: 'running', runId: 'run-2', input: { question: 'Q' },
      steps: [
        STORED.steps[0],
        { id: 'answer', title: 'Answer', kind: 'agent', status: 'running' },
      ],
    };
    const n = buildNodeInspections(
      src(live, {
        running: true,
        liveToolCalls: [
          { name: 'run_readonly_sql', input: 'select 1', rowCount: 3, finished: true },
          { name: 'other', error: 'bad', finished: false },
        ],
      }),
    );
    expect(n[2].run?.toolCalls).toEqual([
      { tool: 'run_readonly_sql', input: 'select 1', rowCount: 3, finished: true },
      { tool: 'other', error: 'bad', finished: false },
    ]);
    expect(n[1].run?.toolCalls).toEqual([]);
    expect(n[3].run).toBeNull();
    const idle = buildNodeInspections(src(live, { running: false, liveToolCalls: [{ name: 'x', finished: true }] }));
    expect(idle[2].run?.toolCalls).toEqual([]);
  });

  it('treats a step without status as not run', () => {
    const r: RunView = { status: 'running', steps: [{ id: 'prepare', title: 'Prepare', kind: 'code', status: null }] };
    const n = buildNodeInspections(src(r));
    expect(n[1].run).toBeNull();
    expect(n[2].context?.earlierSteps[0].status).toBeNull();
    expect(n[0].run?.status).toBe('success');
  });

  it('copes with an old run without input, timestamps and tool calls', () => {
    const old: RunView = {
      status: 'success',
      output: { answer: 'A' },
      steps: [
        { id: 'prepare', title: 'Prepare', kind: 'code', status: 'success', output: { prompt: 'P' } },
        { id: 'answer', title: 'Answer', kind: 'agent', status: 'success', output: { answer: 'A' } },
      ],
    };
    const n = buildNodeInspections(src(old));
    expect(n[0].run?.input).toBeUndefined();
    expect(n[2].run?.durationMs).toBeNull();
    expect(n[2].run?.toolCalls).toEqual([]);
    expect(n[2].context?.workflowInput).toBeNull();
    const sum = workflowStateSummary(src(old), n);
    expect(sum.durationMs).toBeNull();
    expect(sum.runId).toBeNull();
    expect(JSON.stringify(n)).not.toMatch(/undefined|NaN/);
    expect(formatDuration(n[2].run!.durationMs)).toBe('—');
  });

  it('falls back to the agent name when the step has no key', () => {
    const w = {
      ...WORKFLOW,
      steps: [{ ...WORKFLOW.steps[1], agent: { name: 'Assistant', tools: [], maxSteps: 1 } }],
    } as unknown as WorkflowDetail;
    const n = buildNodeInspections({ ...src(null), workflow: w });
    expect(n[1].agent?.key).toBe('assistant');
  });
});

describe('workflowStateSummary and nodeStatuses', () => {
  it('counts nodes that ran and maps statuses', () => {
    const s = src(STORED);
    const n = buildNodeInspections(s);
    expect(workflowStateSummary(s, n)).toEqual({ status: 'success', ran: 4, total: 4, durationMs: 14000, runId: 'run-1' });
    expect(nodeStatuses(n)).toEqual({ start: 'success', prepare: 'success', answer: 'success', end: 'success' });
  });

  it('counts a running run partially and an empty page as null', () => {
    const live: RunView = { status: 'running', runId: 'r', steps: [STORED.steps[0], { id: 'answer', title: 'Answer', kind: 'agent', status: 'running' }] };
    const n = buildNodeInspections(src(live));
    expect(workflowStateSummary(src(live), n).ran).toBe(2);
    expect(nodeStatuses(n)['answer']).toBe('running');
    const none = buildNodeInspections(src(null));
    expect(workflowStateSummary(src(null), none)).toEqual({ status: null, ran: 0, total: 4, durationMs: null, runId: null });
    expect(nodeStatuses(none)).toEqual({});
  });
});

describe('durationMs and formatDuration', () => {
  it('computes and guards durations', () => {
    expect(durationMs('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.500Z')).toBe(1500);
    expect(durationMs(undefined, 'x')).toBeNull();
    expect(durationMs('nope', '2026-01-01T00:00:00.000Z')).toBeNull();
  });
  it('formats', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(NaN)).toBe('—');
    expect(formatDuration(0)).toBe('0 ms');
    expect(formatDuration(2)).toBe('2 ms');
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(13900)).toBe('13.9 s');
    expect(formatDuration(59960)).toBe('1 min 0 s');
    expect(formatDuration(64000)).toBe('1 min 4 s');
    expect(formatDuration(3_700_000)).toBe('61 min 40 s');
  });
});
