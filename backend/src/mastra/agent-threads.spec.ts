import {
  agentThreadId,
  copiedThreadId,
  exchangeMessages,
  runHostThreadId,
} from './agent-threads';

describe('the memory threads of a run (agents.md 5.14)', () => {
  it("names a run's own thread and its step agents' threads on its host", () => {
    expect(runHostThreadId('r-1')).toBe('run-r-1');
    expect(agentThreadId('run-r-1', 'insights-analyst')).toBe(
      'run-r-1:insights-analyst',
    );
  });

  it('maps a thread of one host to the same thread of another, and nothing else', () => {
    expect(copiedThreadId('run-a', 'run-a', 'run-b')).toBe('run-b');
    expect(copiedThreadId('run-a:insights-analyst', 'run-a', 'run-b')).toBe(
      'run-b:insights-analyst',
    );
    // A node chat's thread and another run's are not the host's.
    expect(copiedThreadId('run-a-node-analyse', 'run-a', 'run-b')).toBe(
      undefined,
    );
    expect(copiedThreadId('run-ab:insights-analyst', 'run-a', 'run-b')).toBe(
      undefined,
    );
  });

  it('records an exchange as the request then the reply, in that order, in the thread', () => {
    const at = new Date('2026-11-15T10:00:00.000Z');
    const messages = exchangeMessages(
      { request: 'Plan this.', reply: '{"measures":[]}' },
      { threadId: 'run-r-1:insights-analyst', resourceId: 'run-r-1' },
      ['m1', 'm2'],
      at,
    );
    expect(messages).toEqual([
      {
        id: 'm1',
        role: 'user',
        createdAt: at,
        threadId: 'run-r-1:insights-analyst',
        resourceId: 'run-r-1',
        type: 'v2',
        content: { format: 2, parts: [{ type: 'text', text: 'Plan this.' }] },
      },
      {
        id: 'm2',
        role: 'assistant',
        createdAt: new Date(at.getTime() + 1),
        threadId: 'run-r-1:insights-analyst',
        resourceId: 'run-r-1',
        type: 'v2',
        content: {
          format: 2,
          parts: [{ type: 'text', text: '{"measures":[]}' }],
        },
      },
    ]);
  });
});
