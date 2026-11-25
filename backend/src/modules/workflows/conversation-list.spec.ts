import { conversationSummaries } from './conversation-list';
import type { WorkflowRunDoc } from './workflow-run-steps';

const run = (overrides: Partial<WorkflowRunDoc> = {}): WorkflowRunDoc => ({
  id: 'r1',
  workflowId: 'agent:insights-lead',
  workflowName: 'Elena',
  input: {},
  status: 'success',
  steps: [],
  datasets: [],
  startedAt: '2026-11-01T10:00:00.000Z',
  ...overrides,
});

describe('conversationSummaries (api.md 168)', () => {
  it('groups runs by conversationId into one row', () => {
    const rows = conversationSummaries([
      run({ id: 'a1', conversationId: 'a', question: 'First' }),
      run({
        id: 'a2',
        conversationId: 'a',
        question: 'Second',
        startedAt: '2026-11-01T11:00:00.000Z',
      }),
      run({ id: 'b1', conversationId: 'b', question: 'Other' }),
    ]);
    expect(rows.map((r) => [r.id, r.runCount])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('titles from the first run, trimmed and cut to 120 characters', () => {
    const [row] = conversationSummaries([
      run({
        id: 'a2',
        conversationId: 'a',
        question: 'later',
        startedAt: '2026-11-01T11:00:00.000Z',
      }),
      run({ id: 'a1', conversationId: 'a', question: `  ${'x'.repeat(200)} ` }),
    ]);
    expect(row.title).toBe('x'.repeat(120));
  });

  it('unions datasets in first-seen order without repeats', () => {
    const [row] = conversationSummaries([
      run({ id: 'a1', conversationId: 'a', datasets: ['B', 'A'] }),
      run({
        id: 'a2',
        conversationId: 'a',
        datasets: ['A', 'C'],
        startedAt: '2026-11-01T11:00:00.000Z',
      }),
    ]);
    expect(row.datasets).toEqual(['B', 'A', 'C']);
  });

  it('takes lastActivityAt, lastRunId and status from the newest runs, newest conversation first', () => {
    const rows = conversationSummaries([
      run({
        id: 'a1',
        conversationId: 'a',
        finishedAt: '2026-11-01T10:05:00.000Z',
      }),
      run({
        id: 'a2',
        conversationId: 'a',
        status: 'failed',
        startedAt: '2026-11-01T11:00:00.000Z',
      }),
      run({
        id: 'b1',
        conversationId: 'b',
        startedAt: '2026-11-01T10:30:00.000Z',
        finishedAt: '2026-11-01T10:40:00.000Z',
      }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({
      lastActivityAt: '2026-11-01T11:00:00.000Z',
      lastRunId: 'a2',
      status: 'failed',
    });
  });

  it('carries archivedAt when the runs are archived', () => {
    const [row] = conversationSummaries([
      run({ conversationId: 'a', archivedAt: '2026-11-02T00:00:00.000Z' }),
    ]);
    expect(row.archivedAt).toBe('2026-11-02T00:00:00.000Z');
  });

  it('filters by q over questions and answers, trimmed and case-insensitive', () => {
    const runs = [
      run({ id: 'a1', conversationId: 'a', question: 'Top SCORERS?' }),
      run({
        id: 'b1',
        conversationId: 'b',
        question: 'Hello',
        answer: { role: 'assistant', content: 'The Scorers table', at: 'x' },
      }),
      run({ id: 'c1', conversationId: 'c', question: 'Nothing' }),
    ];
    expect(
      conversationSummaries(runs, '  scorers ')
        .map((r) => r.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(conversationSummaries(runs, '   ')).toHaveLength(3);
  });
});
