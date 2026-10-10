import {
  Session,
  SessionAgent,
  sessionAgentLabel,
  sessionListSubtitle,
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

  it("leads with the agent's name for a session bound to an agent (R57)", () => {
    expect(sessionListSubtitle(session({ agentId: agent.id, agent }))).toBe(
      'Cup historian · World Cup Core · Players',
    );
  });

  it('reads "<name> · agent deleted" once the agent is gone (R59)', () => {
    expect(
      sessionListSubtitle(
        session({ agentId: agent.id, agent: { ...agent, deleted: true } }),
      ),
    ).toBe('Cup historian · agent deleted');
  });
});
