import {
  Session,
  SessionAgent,
  SessionWorkflowRef,
  sessionAgentLabel,
  sessionListSubtitle,
  sessionListWorkflow,
  sessionWorkflowLabel,
} from './session.model';

const agent: SessionAgent = {
  id: 'u-historian',
  name: 'Cup historian',
  deleted: false,
  description: '',
  starterQuestions: [],
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Cup historian',
    datasets: ['World Cup Core', 'Players'],
    messages: [],
    ...overrides,
  };
}

describe('sessionAgentLabel', () => {
  it("shows the agent's name, marked once the agent is deleted", () => {
    expect(sessionAgentLabel(agent)).toBe('Cup historian');
    expect(sessionAgentLabel({ ...agent, deleted: true })).toBe(
      'Cup historian · agent deleted',
    );
  });
});

describe('sessionListSubtitle', () => {
  it('lists the datasets of a plain session', () => {
    expect(sessionListSubtitle(session())).toBe('World Cup Core · Players');
    expect(sessionListSubtitle(session({ datasets: [] }))).toBe('');
  });

  it('lists only the datasets for a session bound to an agent (R63)', () => {
    expect(sessionListSubtitle(session({ agentId: agent.id, agent }))).toBe(
      'World Cup Core · Players',
    );
  });
});

describe('sessionWorkflowLabel', () => {
  const ref: SessionWorkflowRef = {
    id: 'agent:u-historian',
    name: 'Cup historian',
    kind: 'agent',
    deleted: false,
  };

  it("names the session's workflow (R57)", () => {
    expect(sessionWorkflowLabel(ref)).toBe('Cup historian');
    expect(
      sessionWorkflowLabel({
        id: 'qti-v2-turn',
        name: 'Questions to Insights v2',
        kind: 'code',
        deleted: false,
      }),
    ).toBe('Questions to Insights v2');
  });

  it('reads "<name> · agent deleted" once the agent is gone (R59)', () => {
    expect(sessionWorkflowLabel({ ...ref, deleted: true })).toBe(
      'Cup historian · agent deleted',
    );
  });
});

describe('sessionListWorkflow', () => {
  it("names the session's workflow from its workflowRef (R63)", () => {
    expect(
      sessionListWorkflow(
        session({
          agentKey: 'rfp',
          workflowRef: {
            id: 'agent:rfp',
            name: 'RFP Builder',
            kind: 'agent',
            deleted: false,
          },
        }),
      ),
    ).toBe('RFP Builder');
    expect(
      sessionListWorkflow(
        session({
          workflowRef: {
            id: 'agent:u-historian',
            name: 'Cup historian',
            kind: 'agent',
            deleted: true,
          },
        }),
      ),
    ).toBe('Cup historian · agent deleted');
  });

  it('falls back to Assistant when the backend sent no workflowRef', () => {
    expect(sessionListWorkflow(session())).toBe('Assistant');
  });
});
