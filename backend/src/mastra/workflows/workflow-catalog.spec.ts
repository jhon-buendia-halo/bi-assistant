import { edgeFlow } from './workflow-contract';
import { readFileSync } from 'fs';
import { join } from 'path';
import { OFFICIAL_AGENT_KEYS, SYSTEM_AGENT_KEYS } from '../agent-constants';
import { CONVERSATIONAL_BINDINGS } from '../conversational-agents';
import { AGENT_TURN_STEPS, AGENT_TURN_WORKFLOW_ID } from './agent-turn.steps';
import { agentWorkflow } from './agent-workflows';
import { conversationalBindingOf } from '../conversational-agents';
import {
  agentRunTurn,
  agentWorkflowId,
  ASSISTANT_WORKFLOW_ID,
  ASSISTANT_WORKFLOW_NAME,
  CODE_WORKFLOWS,
  draftRunInput,
  oneStepWorkflowSteps,
  parseWorkflowId,
  REMOVED_WORKFLOW_IDS,
  REMOVED_WORKFLOW_NAMES,
  sessionWorkflowId,
  stepAgentKey,
  wrappedAgentMaxSteps,
  workflowsUsingAgent,
  WRAPPED_AGENT_KEYS,
} from './workflow-catalog';
import { inputFieldsWithUsage } from './workflow-input';

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
  it('holds two code workflows: Avery + Michael (5.23) and Assess Data Readiness (agents.md 5.13)', () => {
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
        id: 'orchestrated-answer-michael',
        name: 'Answer a Business Question (Avery + Michael)',
        primaryFor: 'insights-analyst',
        bar: 'steps',
        trigger: 'run',
      },
      {
        id: 'data-readiness-assessment',
        name: 'Assess Data Readiness',
        primaryFor: 'data-readiness',
        bar: 'steps',
        trigger: 'run',
      },
    ]);
    // Avery + Michael: Avery's one step on its own engine, Start to End.
    const [avery] = CODE_WORKFLOWS;
    expect(avery.steps.map((step) => step.id)).toEqual(['orchestrate']);
    expect(stepAgentKey(avery, 'orchestrate')).toBe('chief-of-staff');
    expect(avery.edges.map(edgeFlow)).toEqual([
      { from: 'start', to: 'orchestrate', kind: 'next' },
      { from: 'orchestrate', to: 'end', kind: 'next' },
    ]);
    expect(avery).not.toHaveProperty('engine');
    expect(avery.input).toEqual([
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

  it('lists none of the removed workflows, and names them for a past chat (data-model 3.16 M18)', () => {
    expect(REMOVED_WORKFLOW_IDS).toEqual([
      'answer-business-question',
      'orchestrated-answer',
      'recreate-dashboard',
      'map-dashboard-data',
      'review-website',
      'consumption-gap-analysis',
    ]);
    for (const id of REMOVED_WORKFLOW_IDS) {
      expect(CODE_WORKFLOWS.some((workflow) => workflow.id === id)).toBe(false);
      expect(parseWorkflowId(id)).toBeUndefined();
    }
    expect(REMOVED_WORKFLOW_NAMES).toEqual({
      'answer-business-question': 'Answer a Business Question',
      'orchestrated-answer': 'Answer a Business Question (orchestrated)',
      'recreate-dashboard': 'Dashboard Image to Artifact',
      'map-dashboard-data': 'Map a Dashboard to Data',
      'review-website': 'Review a Website',
      'consumption-gap-analysis': 'Consumption Gap Analysis',
    });
  });

  it('files every workflow under one category, the Workflows sections (workflows R5)', () => {
    expect(CODE_WORKFLOWS.map(({ id, category }) => [id, category])).toEqual([
      ['orchestrated-answer-michael', 'data-analytics'],
      ['data-readiness-assessment', 'data-engineering'],
    ]);
  });

  it('explains every labelled connector of every workflow in a note (workflows R42)', () => {
    const labelled = CODE_WORKFLOWS.flatMap((workflow) =>
      workflow.edges
        .filter((edge) => edge.label)
        .map((edge) => ({ workflow: workflow.id, ...edge })),
    );
    // No workflow labels a connector today; the rule holds for the next.
    expect(
      labelled
        .filter((edge) => !edge.note?.trim())
        .map((edge) => `${edge.workflow}: ${edge.from} -> ${edge.to}`),
    ).toEqual([]);
    for (const edge of labelled) {
      expect(edge.note!.length).toBeLessThanOrEqual(100);
      expect(edge.note).toMatch(/\.$/);
    }
  });

  describe('the inputs', () => {
    const byId = (id: string) =>
      CODE_WORKFLOWS.find((workflow) => workflow.id === id)!;

    it('takes no image in any workflow', () => {
      expect(
        CODE_WORKFLOWS.flatMap((workflow) =>
          workflow.input
            .filter(
              (field) => field.type === 'image' || field.type === 'images',
            )
            .map((field) => `${workflow.id}.${field.name}`),
        ),
      ).toEqual([]);
    });

    it('says which steps read each field as api.md 116 lists them', () => {
      const usedBy = (id: string) =>
        Object.fromEntries(
          inputFieldsWithUsage(byId(id)).map((field) => [
            field.name,
            field.usedBy,
          ]),
        );
      expect(usedBy('orchestrated-answer-michael')).toEqual({
        question: ['orchestrate'],
        datasets: ['orchestrate'],
      });
      expect(usedBy('data-readiness-assessment')).toEqual({
        dataset: ['resolve-dataset'],
        question: ['resolve-dataset'],
      });
    });
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

    it.each(['answer-business-question', 'orchestrated-answer'])(
      'keeps %s on a past chat that ran it (M18): it is listed nowhere, its id stays',
      (id) => {
        expect(parseWorkflowId(id)).toBeUndefined();
        expect(
          sessionWorkflowId({ workflowId: id, agentKey: 'insights-analyst' }),
        ).toBe(id);
      },
    );

    it.each([
      ['recreate-dashboard', 'dashboard-reader'],
      ['map-dashboard-data', 'data-mapper'],
      ['review-website', 'site-reviewer'],
    ])(
      'keeps %s on a past chat of its removed agent %s; without it, the chat is the Assistant',
      (id, agentKey) => {
        expect(parseWorkflowId(id)).toBeUndefined();
        expect(sessionWorkflowId({ workflowId: id, agentKey })).toBe(id);
        expect(sessionWorkflowId({ agentKey })).toBe('agent:assistant');
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
      expect(keys).toContain('insights-analyst');
      // The RFP Builder was removed.
      expect(keys).not.toContain('rfp');
    });

    it('knows every registered agent as Official or System, and nothing else', () => {
      expect([...registeredAgentKeys()].sort()).toEqual(
        [...OFFICIAL_AGENT_KEYS, ...SYSTEM_AGENT_KEYS].sort(),
      );
    });

    it("wraps every registered Official agent, runs it as a code workflow's primaryFor, or talks to it in its own conversation", () => {
      const primary = [
        ...CODE_WORKFLOWS.map((source) => source.primaryFor),
        // Elena, asked in her own conversation (plan Elena 1.2).
        ...CONVERSATIONAL_BINDINGS.filter(
          (binding) => binding.kind === 'solo',
        ).map((binding) => binding.agentKey),
      ];
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

    it('wraps no code workflow’s primaryFor agent but the Data Readiness Agent, and no System agent', () => {
      // The Data Readiness Agent runs Assess Data Readiness's Explain report
      // step and keeps its own agent turn for its sessions and its evals.
      for (const source of CODE_WORKFLOWS) {
        expect({
          key: source.primaryFor,
          wrapped: WRAPPED_AGENT_KEYS.includes(source.primaryFor),
        }).toEqual({
          key: source.primaryFor,
          wrapped: source.primaryFor === 'data-readiness',
        });
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
      expect(parseWorkflowId('orchestrated-answer-michael')).toEqual({
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

    it("parses Elena's agent:insights-lead as a conversational binding, before the user-agent fallback", () => {
      expect(parseWorkflowId('agent:insights-lead')).toEqual({
        kind: 'conversation',
        binding: conversationalBindingOf('agent:insights-lead'),
      });
    });

    it("keeps Avery's conversational workflow a code workflow", () => {
      expect(parseWorkflowId('orchestrated-answer-michael')?.kind).toBe('code');
    });

    it('keeps a host stored on agent:insights-lead on it', () => {
      expect(
        sessionWorkflowId({
          workflowId: 'agent:insights-lead',
          agentKey: 'insights-lead',
        }),
      ).toBe('agent:insights-lead');
    });

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
      ["a code workflow's primaryFor key", 'agent:insights-analyst'],
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
        { workflowId: 'orchestrated-answer-michael' },
        'orchestrated-answer-michael',
      ],
      [
        "an Avery + Michael run host's workflowId",
        {
          workflowId: 'orchestrated-answer-michael',
          agentKey: 'insights-analyst',
        },
        'orchestrated-answer-michael',
      ],
      [
        "a removed workflow's stored id (a past chat)",
        { workflowId: 'orchestrated-answer', agentKey: 'insights-analyst' },
        'orchestrated-answer',
      ],
      [
        "a stored user agent's workflowId",
        { workflowId: 'agent:u-1', agentId: 'u-1' },
        'agent:u-1',
      ],
      [
        "agentKey insights-analyst (Michael's past chat: the removed workflow it ran)",
        { agentKey: 'insights-analyst' },
        'answer-business-question',
      ],
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
      [
        "the Data Readiness Agent's agentKey: its agent turn, not Assess Data Readiness",
        { agentKey: 'data-readiness' },
        'agent:data-readiness',
      ],
      [
        'a stored Assess Data Readiness id',
        { workflowId: 'data-readiness-assessment', agentKey: 'data-readiness' },
        'data-readiness-assessment',
      ],
    ])('derives from %s', (_label, session, expected) => {
      expect(sessionWorkflowId(session)).toBe(expected);
    });
  });

  describe('workflowsUsingAgent (api.md 34 usedInWorkflows)', () => {
    it.each(['insights-analyst', 'chief-of-staff'])(
      '%s is used in Avery + Michael only',
      (key) => {
        expect(workflowsUsingAgent(key)).toEqual([
          {
            id: 'orchestrated-answer-michael',
            name: 'Answer a Business Question (Avery + Michael)',
          },
        ]);
      },
    );

    it('data-readiness is used in Assess Data Readiness only', () => {
      expect(workflowsUsingAgent('data-readiness')).toEqual([
        { id: 'data-readiness-assessment', name: 'Assess Data Readiness' },
      ]);
    });

    it.each([
      'assistant',
      'rfp',
      'sql-fixer',
      'u-1',
      // Olivia, Jessica and Ryan stay in the library, in no workflow.
      'analysis-planner',
      'answer-writer',
      'visualization',
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
            { label: 'the model returns an error', outcome: 'fails' },
            { label: 'you stop it', outcome: 'stops' },
          ],
        },
      ]);
    });

    it('gives the step its agent', () => {
      expect(
        oneStepWorkflowSteps({
          key: 'data-readiness',
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
            key: 'data-readiness',
            name: 'Sarah',
            role: 'Data Quality Analyst',
            tools: ['assess_data_readiness'],
            maxSteps: 10,
          },
          exits: [
            { label: 'the model returns an error', outcome: 'fails' },
            { label: 'you stop it', outcome: 'stops' },
          ],
        },
      ]);
    });

    it('adds the exit of a clarifying question when the agent can ask one', () => {
      const [step] = oneStepWorkflowSteps({
        key: 'assistant',
        name: 'Emily',
        tools: ['ask_clarification', 'run_readonly_sql'],
        maxSteps: 15,
      });
      expect(step.exits).toEqual([
        { label: 'the model returns an error', outcome: 'fails' },
        { label: 'you stop it', outcome: 'stops' },
        { label: 'it asks you a question', outcome: 'stops' },
      ]);
    });

    it('returns a copy the caller can change safely', () => {
      const tools = ['a'];
      const [first] = oneStepWorkflowSteps({
        key: 'x',
        name: 'x',
        tools,
        maxSteps: 1,
      });
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

  it("answer-business-question's steps are agentWorkflow('insights-analyst')'s, written once", () => {
    expect(agentWorkflow('insights-analyst')?.id).toBe(CODE_WORKFLOWS[0].id);
    expect(
      agentWorkflow('insights-analyst')?.steps.map(({ id, title }) => [
        id,
        title,
      ]),
    ).toEqual(CODE_WORKFLOWS[0].steps.map(({ id, title }) => [id, title]));
  });
});
