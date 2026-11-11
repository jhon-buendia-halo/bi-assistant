import { readFileSync } from 'fs';
import { join } from 'path';
import { OFFICIAL_AGENT_KEYS, SYSTEM_AGENT_KEYS } from '../agent-constants';
import { AGENT_TURN_STEPS, AGENT_TURN_WORKFLOW_ID } from './agent-turn.steps';
import { agentWorkflow } from './agent-workflows';
import {
  agentWorkflowId,
  ASSISTANT_WORKFLOW_DESCRIPTION,
  ASSISTANT_WORKFLOW_ID,
  ASSISTANT_WORKFLOW_NAME,
  CODE_WORKFLOWS,
  oneStepWorkflowSteps,
  parseWorkflowId,
  sessionWorkflowId,
  wrappedAgentMaxSteps,
  workflowsUsingAgent,
  WRAPPED_AGENT_KEYS,
} from './workflow-catalog';

/**
 * The keys `src/mastra/index.ts` registers under `agents: { … }`, read from
 * its source so the test never loads Mastra (Jest cannot load its ESM).
 */
function registeredAgentKeys(): string[] {
  const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
  const block = /\bagents:\s*\{([^}]*)\}/.exec(source)?.[1] ?? '';
  return [...block.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:/gm)].map(
    (match) => match[1] ?? match[2],
  );
}

describe('the workflow catalogue (agents.md 5.12; workflows R1, R2)', () => {
  it('holds one code workflow today: Questions to Insights v2 for assistant-v2', () => {
    expect(
      CODE_WORKFLOWS.map(({ id, name, primaryFor, bar }) => ({
        id,
        name,
        primaryFor,
        bar,
      })),
    ).toEqual([
      {
        id: 'qti-v2-turn',
        name: 'Questions to Insights v2',
        primaryFor: 'assistant-v2',
        bar: 'steps',
      },
    ]);
    expect(CODE_WORKFLOWS[0].steps.map((step) => step.id)).toEqual([
      'receive-question',
      'load-catalog',
      'analyse',
      'wrap-up',
    ]);
    expect(CODE_WORKFLOWS[0].description).toBe(
      'A slimmed-down data analyst under construction: answers questions over the datasets you pick using only the core data tools.',
    );
  });

  it('names the assistant workflow as the picker does', () => {
    expect(ASSISTANT_WORKFLOW_ID).toBe('agent:assistant');
    expect(ASSISTANT_WORKFLOW_NAME).toBe('Assistant');
    expect(ASSISTANT_WORKFLOW_DESCRIPTION).toBe(
      'Answers questions over the datasets you pick.',
    );
    expect(WRAPPED_AGENT_KEYS).toEqual(['assistant', 'rfp', 'data-readiness']);
  });

  describe('drift (plan 4.2)', () => {
    it('reads the registered agents from mastra/index.ts', () => {
      const keys = registeredAgentKeys();
      expect(keys).toContain('assistant');
      expect(keys).toContain('assistant-v2');
      expect(keys).toContain('rfp');
    });

    it('knows every registered agent as Official or System, and nothing else', () => {
      expect([...registeredAgentKeys()].sort()).toEqual(
        [...OFFICIAL_AGENT_KEYS, ...SYSTEM_AGENT_KEYS].sort(),
      );
    });

    it("wraps every registered Official agent, or runs it as a code workflow's primaryFor", () => {
      const primary = CODE_WORKFLOWS.map((source) => source.primaryFor);
      const registered = registeredAgentKeys().filter((key) =>
        OFFICIAL_AGENT_KEYS.includes(key),
      );
      expect(registered.length).toBeGreaterThan(0);
      for (const key of registered) {
        expect({
          key,
          covered: WRAPPED_AGENT_KEYS.includes(key) || primary.includes(key),
        }).toEqual({ key, covered: true });
      }
    });

    it('never wraps a code workflow’s primaryFor agent, nor a System agent', () => {
      for (const source of CODE_WORKFLOWS) {
        expect(WRAPPED_AGENT_KEYS).not.toContain(source.primaryFor);
      }
      for (const key of SYSTEM_AGENT_KEYS) {
        expect(WRAPPED_AGENT_KEYS).not.toContain(key);
      }
    });
  });

  describe('agentWorkflowId and parseWorkflowId (R2)', () => {
    it('prefixes a key or an id with agent:', () => {
      expect(agentWorkflowId('rfp')).toBe('agent:rfp');
      expect(agentWorkflowId('9b1c')).toBe('agent:9b1c');
    });

    it('parses a code workflow id', () => {
      expect(parseWorkflowId('qti-v2-turn')).toEqual({
        kind: 'code',
        source: CODE_WORKFLOWS[0],
      });
    });

    it.each(['assistant', 'rfp', 'data-readiness'])(
      'parses agent:%s as a wrapped built-in agent',
      (key) => {
        expect(parseWorkflowId(`agent:${key}`)).toEqual({
          kind: 'builtin-agent',
          agentKey: key,
        });
      },
    );

    it('parses any other agent: id as a user agent, for the caller to check', () => {
      expect(parseWorkflowId('agent:0b5e-4f')).toEqual({
        kind: 'user-agent',
        agentId: '0b5e-4f',
      });
    });

    it.each([
      ['a System key', 'agent:sql-fixer'],
      ['another System key', 'agent:visualization'],
      ["a code workflow's primaryFor key", 'agent:assistant-v2'],
      ['an unknown id', 'nope'],
      ['an unprefixed agent key', 'rfp'],
      ['an empty agent id', 'agent:'],
      ['the engine id', AGENT_TURN_WORKFLOW_ID],
      ['an empty id', ''],
      ['an inherited property name', 'constructor'],
    ])('refuses %s (%p)', (_label, id) => {
      expect(parseWorkflowId(id)).toBeUndefined();
    });

    it('refuses every System key', () => {
      for (const key of SYSTEM_AGENT_KEYS) {
        expect(parseWorkflowId(agentWorkflowId(key))).toBeUndefined();
      }
    });
  });

  describe('sessionWorkflowId (plan 4.3; R4)', () => {
    it.each([
      [
        'a stored, resolvable workflowId',
        { workflowId: 'qti-v2-turn' },
        'qti-v2-turn',
      ],
      [
        "a stored user agent's workflowId",
        { workflowId: 'agent:u-1', agentId: 'u-1' },
        'agent:u-1',
      ],
      ['agentKey assistant-v2', { agentKey: 'assistant-v2' }, 'qti-v2-turn'],
      ['agentKey rfp', { agentKey: 'rfp' }, 'agent:rfp'],
      [
        'agentKey data-readiness',
        { agentKey: 'data-readiness' },
        'agent:data-readiness',
      ],
      [
        'an agentId (the agent exists or was deleted)',
        { agentId: 'u-1' },
        'agent:u-1',
      ],
      ['neither', {}, 'agent:assistant'],
      [
        'an unresolvable stored id, falling back to agentKey',
        { workflowId: 'old-removed-workflow', agentKey: 'rfp' },
        'agent:rfp',
      ],
      [
        'an unresolvable stored id, falling back to agentId',
        { workflowId: 'agent:sql-fixer', agentId: 'u-2' },
        'agent:u-2',
      ],
      [
        'an unresolvable stored id with no agent fields',
        { workflowId: 'gone' },
        'agent:assistant',
      ],
      ['an unknown agentKey', { agentKey: 'benchmarking' }, 'agent:assistant'],
    ])('derives from %s', (_label, session, expected) => {
      expect(sessionWorkflowId(session)).toBe(expected);
    });
  });

  describe('workflowsUsingAgent (api.md 34 usedInWorkflows)', () => {
    it.each([
      ['assistant', ['agent:assistant']],
      ['assistant-v2', ['qti-v2-turn']],
      ['rfp', ['agent:rfp']],
      ['data-readiness', ['agent:data-readiness']],
      ['sql-fixer', []],
      ['visualization', []],
    ])('%s is used in %p', (key, ids) => {
      expect(workflowsUsingAgent(key, { builtin: true })).toEqual(ids);
    });

    it('a Live user agent is used in its one-step workflow; a draft-only one in none', () => {
      expect(
        workflowsUsingAgent('u-1', { builtin: false, userAgentLive: true }),
      ).toEqual(['agent:u-1']);
      expect(
        workflowsUsingAgent('u-1', { builtin: false, userAgentLive: false }),
      ).toEqual([]);
      expect(workflowsUsingAgent('u-1', { builtin: false })).toEqual([]);
    });
  });

  describe('the one-step workflow (agent-turn)', () => {
    it('has one Answer agent step', () => {
      expect(AGENT_TURN_WORKFLOW_ID).toBe('agent-turn');
      expect(AGENT_TURN_STEPS).toEqual([
        {
          id: 'answer',
          title: 'Answer',
          kind: 'agent',
          summary: 'The agent answers with its tools, streamed to the chat.',
          input: ['question', 'datasets'],
          output: ['calls', 'stopped'],
          exits: [
            { label: 'Model error', outcome: 'fails' },
            { label: 'Stop', outcome: 'stops' },
          ],
        },
      ]);
    });

    it('gives the step its agent', () => {
      expect(
        oneStepWorkflowSteps({
          name: 'RFP Builder',
          tools: ['create_rfp'],
          maxSteps: 15,
        }),
      ).toEqual([
        {
          id: 'answer',
          title: 'Answer',
          kind: 'agent',
          summary: 'The agent answers with its tools, streamed to the chat.',
          input: ['question', 'datasets'],
          output: ['calls', 'stopped'],
          agent: { name: 'RFP Builder', tools: ['create_rfp'], maxSteps: 15 },
          exits: [
            { label: 'Model error', outcome: 'fails' },
            { label: 'Stop', outcome: 'stops' },
          ],
        },
      ]);
    });

    it('adds the Clarifying question exit when the agent can ask one', () => {
      const [step] = oneStepWorkflowSteps({
        name: 'Questions to Insights Assistant',
        tools: ['ask_clarification', 'run_readonly_sql'],
        maxSteps: 15,
      });
      expect(step.exits).toEqual([
        { label: 'Model error', outcome: 'fails' },
        { label: 'Stop', outcome: 'stops' },
        { label: 'Clarifying question', outcome: 'stops' },
      ]);
    });

    it('returns a copy the caller can change safely', () => {
      const tools = ['a'];
      const [first] = oneStepWorkflowSteps({ name: 'x', tools, maxSteps: 1 });
      first.input.push('y');
      first.agent!.tools.push('b');
      expect(tools).toEqual(['a']);
      expect(AGENT_TURN_STEPS[0].input).toEqual(['question', 'datasets']);
    });

    it.each([
      ['assistant', 15],
      ['rfp', 15],
      ['data-readiness', 10],
    ])("%s's step allows %d tool steps", (key, steps) => {
      expect(wrappedAgentMaxSteps(key)).toBe(steps);
    });

    it("a user agent's step allows the assistant's 15", () => {
      expect(wrappedAgentMaxSteps('some-user-agent-id')).toBe(15);
    });
  });

  it("qti-v2-turn's steps are agentWorkflow('assistant-v2')'s, written once", () => {
    expect(agentWorkflow('assistant-v2')?.id).toBe(CODE_WORKFLOWS[0].id);
    expect(
      agentWorkflow('assistant-v2')?.steps.map(({ id, title }) => [id, title]),
    ).toEqual(CODE_WORKFLOWS[0].steps.map(({ id, title }) => [id, title]));
  });
});
