import { WorkflowTeamMember } from '../models/workflow.model';
import { ActivityStep } from './agent-activity';
import { RelayHandOff, relayOf } from './team-relay';

const CLARA: WorkflowTeamMember = {
  tool: 'build_dashboard',
  key: 'bi-analyst',
  name: 'Clara',
  role: 'BI Developer',
};

const step = (over: Partial<ActivityStep>): ActivityStep => ({
  label: over.tool ?? 'step',
  state: 'done',
  rows: null,
  query: false,
  tool: 'tool',
  detail: '',
  ...over,
});

describe('relayOf, the dashboard hand-off', () => {
  it('asks Clara for a dashboard', () => {
    const items = relayOf(
      [
        step({
          tool: 'build_dashboard',
          agent: 'chief-of-staff',
          teammate: 'bi-analyst',
          state: 'current',
        }),
      ],
      [CLARA],
    );
    expect(items[0].kind === 'step' && items[0].step.label).toBe(
      'Asking Clara for a dashboard',
    );
  });

  it('labels what Clara hands back', () => {
    const items = relayOf(
      [
        step({
          tool: 'build_dashboard',
          agent: 'chief-of-staff',
          teammate: 'bi-analyst',
          state: 'done',
        }),
      ],
      [CLARA],
    );
    const clara = items.find((i) => i.kind === 'teammate') as RelayHandOff;
    expect(clara.steps.map((s) => s.label)).toContain('Built the dashboard');
  });
});
