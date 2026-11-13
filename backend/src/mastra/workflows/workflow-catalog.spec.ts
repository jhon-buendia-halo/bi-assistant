import { readFileSync } from 'fs';
import { join } from 'path';
import { OFFICIAL_AGENT_KEYS, SYSTEM_AGENT_KEYS } from '../agent-constants';
import { AGENT_TURN_STEPS, AGENT_TURN_WORKFLOW_ID } from './agent-turn.steps';
import { agentWorkflow } from './agent-workflows';
import {
  agentRunTurn,
  agentWorkflowId,
  ASSISTANT_WORKFLOW_ID,
  ASSISTANT_WORKFLOW_NAME,
  CODE_WORKFLOWS,
  draftRunInput,
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
  it('holds one code workflow: Questions to Insights v2, run for assistant-v2 (1.23.35)', () => {
    expect(
      CODE_WORKFLOWS.map(({ id, name, primaryFor, bar, trigger }) => ({
        id,
        name,
        primaryFor,
        bar,
        trigger,
      })),
    ).toEqual([
      {
        id: 'qti-v2-turn',
        name: 'Answer a Business Question',
        primaryFor: 'assistant-v2',
        bar: 'steps',
        trigger: 'run',
      },
    ]);
    expect(CODE_WORKFLOWS[0].steps.map((step) => step.id)).toEqual([
      'receive-question',
      'load-catalog',
      'plan',
      'clarify',
      'analyse',
      'validate',
      'write-answer',
      'wrap-up',
    ]);
    // The flow is its edges (api.md 117): a branch after Plan, a loop back
    // from Clarify to Plan once answered, a loop back from Validate to
    // Analyse.
    expect(CODE_WORKFLOWS[0].edges).toHaveLength(11);
    expect(
      CODE_WORKFLOWS[0].edges.filter((edge) => edge.kind !== 'next'),
    ).toEqual([
      {
        from: 'plan',
        to: 'clarify',
        kind: 'branch',
        label: 'Needs clarification',
      },
      { from: 'clarify', to: 'plan', kind: 'loop', label: 'Answered' },
      { from: 'plan', to: 'analyse', kind: 'branch', label: 'Clear' },
      { from: 'validate', to: 'analyse', kind: 'loop', label: 'Retry once' },
    ]);
    expect(CODE_WORKFLOWS[0].description).toBe(
      'A business data analyst: answers questions over the datasets you pick with read-only SQL, checks its results and explains how it got them.',
    );
    expect(CODE_WORKFLOWS[0].input).toEqual([
      {
        name: 'question',
        label: 'Question',
        type: 'textarea',
        required: true,
        placeholder: 'Ask a question about your data',
        maxLength: 4000,
      },
      { name: 'datasets', label: 'Datasets', type: 'datasets', required: true },
    ]);
  });

  describe('removed workflows (1.23.35)', () => {
    it.each(['seq-text-demo', 'deep-analysis'])(
      'no longer parses %s: a session or run of it falls back',
      (id) => {
        expect(CODE_WORKFLOWS.map((w) => w.id)).not.toContain(id);
        expect(parseWorkflowId(id)).toBeUndefined();
        expect(sessionWorkflowId({ workflowId: id })).toBe('agent:assistant');
      },
    );
  });

  describe('the input of a draft run (Try it, api.md R12)', () => {
    it("takes a question and careful; its datasets are the draft's", () => {
      expect(draftRunInput()).toEqual([
        {
          name: 'question',
          label: 'Question',
          type: 'textarea',
          required: true,
          placeholder: 'Ask a question about your data',
        },
        {
          name: 'careful',
          label: 'Careful: cross-check the result with an independent query',
          type: 'boolean',
          required: false,
          default: false,
        },
      ]);
    });

    it('returns a copy the caller can change safely', () => {
      const first = draftRunInput();
      first[0].label = 'Changed';
      expect(draftRunInput()[0].label).toBe('Question');
      expect(CODE_WORKFLOWS[0].input[0].label).toBe('Question');
    });
  });

  describe('agentRunTurn (plan 4.2, 5.1)', () => {
    it('reads the question, the datasets, careful and nothing else', () => {
      expect(
        agentRunTurn({
          question: '  Who won?  ',
          datasets: ['World Cup Core'],
          careful: true,
        }),
      ).toEqual({
        question: 'Who won?',
        datasets: ['World Cup Core'],
        careful: true,
      });
    });

    it("the readiness run's dataset is its only dataset", () => {
      expect(
        agentRunTurn({
          dataset: 'Claims',
          question: 'Assess the readiness of this dataset',
        }),
      ).toEqual({
        question: 'Assess the readiness of this dataset',
        datasets: ['Claims'],
        careful: false,
      });
    });

    it("ignores the removed RFP Builder's message and RFP id", () => {
      expect(
        agentRunTurn({ message: 'Start Acme 2027', rfpId: 'r-1' }),
      ).toEqual({ question: '', careful: false });
    });
  });

  it("names the assistant's agent-turn binding as an old session's chip reads it", () => {
    expect(ASSISTANT_WORKFLOW_ID).toBe('agent:assistant');
    expect(ASSISTANT_WORKFLOW_NAME).toBe('Assistant');
    expect(WRAPPED_AGENT_KEYS).toEqual(['assistant', 'data-readiness']);
  });

  describe('drift (plan 4.2)', () => {
    it('reads the registered agents from mastra/index.ts', () => {
      const keys = registeredAgentKeys();
      expect(keys).toContain('assistant');
      expect(keys).toContain('assistant-v2');
      // The RFP Builder was removed.
      expect(keys).not.toContain('rfp');
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
      expect(agentWorkflowId('data-readiness')).toBe('agent:data-readiness');
      expect(agentWorkflowId('9b1c')).toBe('agent:9b1c');
    });

    it('parses a code workflow id', () => {
      expect(parseWorkflowId('qti-v2-turn')).toEqual({
        kind: 'code',
        source: CODE_WORKFLOWS[0],
      });
    });

    it.each(['assistant', 'data-readiness'])(
      'parses agent:%s as a wrapped built-in agent',
      (key) => {
        expect(parseWorkflowId(`agent:${key}`)).toEqual({
          kind: 'builtin-agent',
          agentKey: key,
        });
      },
    );

    it('no longer wraps the removed RFP Builder: agent:rfp is a user agent id the caller will not find', () => {
      expect(parseWorkflowId('agent:rfp')).toEqual({
        kind: 'user-agent',
        agentId: 'rfp',
      });
    });

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
      ['an unprefixed agent key', 'data-readiness'],
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
      [
        'agentKey rfp (the removed RFP Builder)',
        { agentKey: 'rfp' },
        'agent:assistant',
      ],
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
        { workflowId: 'old-removed-workflow', agentKey: 'data-readiness' },
        'agent:data-readiness',
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
    it('assistant-v2 is used in Questions to Insights v2', () => {
      expect(workflowsUsingAgent('assistant-v2')).toEqual([
        { id: 'qti-v2-turn', name: 'Answer a Business Question' },
      ]);
    });

    it.each([
      'assistant',
      'data-readiness',
      'rfp',
      'sql-fixer',
      'visualization',
      'u-1',
    ])('%s is used in none: agents are a library', (key) => {
      expect(workflowsUsingAgent(key)).toEqual([]);
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
          name: 'Sarah',
          role: 'Data Quality Analyst',
          tools: ['assess_data_readiness'],
          maxSteps: 10,
        }),
      ).toEqual([
        {
          id: 'answer',
          title: 'Answer',
          kind: 'agent',
          summary: 'The agent answers with its tools, streamed to the chat.',
          input: ['question', 'datasets'],
          output: ['calls', 'stopped'],
          agent: {
            name: 'Sarah',
            role: 'Data Quality Analyst',
            tools: ['assess_data_readiness'],
            maxSteps: 10,
          },
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
