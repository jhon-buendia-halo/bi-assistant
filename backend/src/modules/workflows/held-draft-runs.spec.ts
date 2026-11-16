import { HeldDraftRuns } from './held-draft-runs';
import type { WorkflowRun } from './workflow-run-steps';

const run = (id: string): WorkflowRun => ({
  id,
  workflowId: 'agent:a1',
  workflowName: 'Draft',
  input: {},
  status: 'success',
  steps: [],
  datasets: [],
  startedAt: 't',
});

describe('HeldDraftRuns (plan section 5: a draft run kept in memory)', () => {
  it('keeps a finished draft for 30 minutes, then forgets it', () => {
    let now = 1_000;
    const held = new HeldDraftRuns(() => now);
    held.hold(run('d1'), 'a1');

    now += 30 * 60 * 1000 - 1;
    expect(held.get('d1')).toEqual({ run: run('d1'), agentId: 'a1' });
    now += 1;
    expect(held.get('d1')).toBeUndefined();
  });

  it('holds 20 at most, the oldest dropped first', () => {
    const held = new HeldDraftRuns(() => 0);
    for (let i = 1; i <= 21; i++) held.hold(run(`d${i}`), 'a1');
    expect(held.get('d1')).toBeUndefined();
    expect(held.get('d2')).toBeDefined();
    expect(held.get('d21')).toBeDefined();
  });

  it('writes an answer into the held copy without extending its time', () => {
    let now = 0;
    const held = new HeldDraftRuns(() => now);
    held.hold(run('d1'), 'a1');
    now = 20 * 60 * 1000;
    const answer = { role: 'assistant' as const, content: 'x', at: 't' };
    expect(held.setAnswer('d1', answer)?.answer).toEqual(answer);
    expect(held.get('d1')?.run.answer).toEqual(answer);
    now = 30 * 60 * 1000;
    expect(held.get('d1')).toBeUndefined();
    expect(held.setAnswer('d1', answer)).toBeUndefined();
  });
});
