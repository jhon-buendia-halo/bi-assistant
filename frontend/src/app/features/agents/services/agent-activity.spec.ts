import { WorkflowRunSummary } from '../../workflows/models/workflow.model';
import { agentActivity } from './agent-activity';

const ABQ = {
  id: 'answer-business-question',
  name: 'Answer a Business Question',
};

function run(
  id: string,
  status: WorkflowRunSummary['status'],
  workflowId = ABQ.id,
): WorkflowRunSummary {
  return {
    id,
    workflowId,
    workflowName: 'Answer a Business Question',
    status,
    title: `Question ${id}`,
    startedAt: '2026-11-15T10:00:00Z',
  };
}

describe('agentActivity (ui.md 4.4)', () => {
  const michael = { usedInWorkflows: [ABQ] };

  it('is available when no run of its workflows is in progress', () => {
    expect(agentActivity(michael, [run('r1', 'success')])).toEqual({
      state: 'available',
      label: 'Available',
    });
  });

  it('works on the newest running run of a workflow that calls it', () => {
    const runs = [
      run('r3', 'running'),
      run('r2', 'running'),
      run('r1', 'failed'),
    ];
    expect(agentActivity(michael, runs)).toEqual({
      state: 'working',
      label: 'Working on “Question r3”',
      runId: 'r3',
    });
  });

  it('waits while the run waits for the user', () => {
    expect(agentActivity(michael, [run('r1', 'suspended')])).toEqual({
      state: 'waiting',
      label: 'Waiting for your answer on “Question r1”',
      runId: 'r1',
    });
  });

  it("ignores another workflow's runs and agents no workflow calls", () => {
    const runs = [run('r1', 'running', 'data-readiness-assessment')];
    expect(agentActivity(michael, runs).state).toBe('available');
    expect(agentActivity({}, [run('r2', 'running')]).state).toBe('available');
  });
});
