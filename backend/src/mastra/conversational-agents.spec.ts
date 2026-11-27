import {
  CONVERSATIONAL_BINDINGS,
  conversationalBindingOf,
  deliversOf,
  isConversationalWorkflow,
} from './conversational-agents';
import {
  DATA_READINESS_ASSESSOR_AGENT_KEY,
  DATA_READINESS_ASSESSOR_MAX_STEPS,
  DATA_READINESS_ASSESSOR_NAME,
  DATA_READINESS_ASSESSOR_TOOL_NAMES,
} from './agents/data-readiness-assessor-catalog';
import {
  DATA_READINESS_ASSESSOR_EDGES,
  DATA_READINESS_ASSESSOR_ENGINE_ID,
  DATA_READINESS_ASSESSOR_STEPS,
  DATA_READINESS_ASSESSOR_WORKFLOW_ID,
  INSIGHTS_LEAD_EDGES,
  INSIGHTS_LEAD_ENGINE_ID,
  INSIGHTS_LEAD_STEPS,
  INSIGHTS_LEAD_WORKFLOW_ID,
  CONVERSATION_STEP_SCHEMAS,
} from './workflows/conversation-turn.steps';
import { ORCHESTRATED_MICHAEL_STEP_SCHEMAS } from './workflows/orchestrated-answer-michael.steps';
import {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_MAX_STEPS,
  INSIGHTS_LEAD_NAME,
  INSIGHTS_LEAD_TOOL_NAMES,
} from './agents/insights-lead-catalog';

describe('conversational bindings (plan Elena 1.2)', () => {
  it("binds Avery's workflow to her team, hosted by Michael", () => {
    expect(conversationalBindingOf('orchestrated-answer-michael')).toEqual({
      workflowId: 'orchestrated-answer-michael',
      engineId: 'orchestrated-answer-michael',
      stepId: 'orchestrate',
      agentKey: 'chief-of-staff',
      hostAgentKey: 'insights-analyst',
      kind: 'team',
      author: { name: 'Avery', role: 'Chief of Staff' },
    });
  });

  it("binds Elena's own id to her solo conversation, hosted by herself", () => {
    expect(conversationalBindingOf('agent:insights-lead')).toEqual({
      workflowId: 'agent:insights-lead',
      engineId: 'insights-lead-conversation',
      stepId: 'answer',
      agentKey: 'insights-lead',
      hostAgentKey: 'insights-lead',
      kind: 'solo',
      author: { name: 'Elena', role: 'Insights Lead' },
      deliverables: ['dashboard', 'export'],
      opus: true,
    });
  });

  it("binds Dana's own id to her solo conversation, hosted by herself, with no deliverable and no Opus", () => {
    const dana = conversationalBindingOf('agent:data-readiness-assessor');
    expect(dana).toEqual({
      workflowId: 'agent:data-readiness-assessor',
      engineId: 'data-readiness-assessor-conversation',
      stepId: 'answer',
      agentKey: 'data-readiness-assessor',
      hostAgentKey: 'data-readiness-assessor',
      kind: 'solo',
      author: { name: 'Dana', role: 'Data Readiness Assessor' },
      deliverables: [],
    });
    expect(deliversOf(dana, 'dashboard')).toBe(false);
    expect(deliversOf(dana, 'export')).toBe(false);
  });

  it("opens Elena's gates only for her deliverables, and none without a binding", () => {
    const elena = conversationalBindingOf('agent:insights-lead');
    expect(deliversOf(elena, 'dashboard')).toBe(true);
    expect(deliversOf(elena, 'export')).toBe(true);
    expect(
      deliversOf(
        conversationalBindingOf('orchestrated-answer-michael'),
        'export',
      ),
    ).toBe(false);
    expect(deliversOf(undefined, 'dashboard')).toBe(false);
  });

  it('has no binding for any other id, nor for none', () => {
    expect(
      conversationalBindingOf('data-readiness-assessment'),
    ).toBeUndefined();
    expect(conversationalBindingOf('agent:insights-analyst')).toBeUndefined();
    expect(conversationalBindingOf(undefined)).toBeUndefined();
    expect(conversationalBindingOf('')).toBeUndefined();
  });

  it('tells a conversational workflow from any other', () => {
    expect(isConversationalWorkflow('orchestrated-answer-michael')).toBe(true);
    expect(isConversationalWorkflow('agent:insights-lead')).toBe(true);
    expect(isConversationalWorkflow('answer-business-question')).toBe(false);
    expect(isConversationalWorkflow(undefined)).toBe(false);
  });

  it('lists each binding once, by workflow id', () => {
    const ids = CONVERSATIONAL_BINDINGS.map((b) => b.workflowId);
    expect(ids).toEqual([
      'orchestrated-answer-michael',
      'agent:insights-lead',
      'agent:data-readiness-assessor',
    ]);
  });
});

describe("Dana's conversation contract (plan data-readiness-assessor 2)", () => {
  it("names her workflow id and engine: one Answer step with a solo step's schemas", () => {
    expect(DATA_READINESS_ASSESSOR_WORKFLOW_ID).toBe(
      'agent:data-readiness-assessor',
    );
    expect(DATA_READINESS_ASSESSOR_ENGINE_ID).toBe(
      'data-readiness-assessor-conversation',
    );
    expect(DATA_READINESS_ASSESSOR_STEPS).toHaveLength(1);
    expect(DATA_READINESS_ASSESSOR_STEPS[0]).toMatchObject({
      id: 'answer',
      title: 'Answer',
      kind: 'agent',
      input: INSIGHTS_LEAD_STEPS[0].input,
      output: INSIGHTS_LEAD_STEPS[0].output,
    });
    expect(DATA_READINESS_ASSESSOR_EDGES).toEqual(INSIGHTS_LEAD_EDGES);
  });

  it('catalogues Dana: key, name, budget and tools', () => {
    expect(DATA_READINESS_ASSESSOR_AGENT_KEY).toBe('data-readiness-assessor');
    expect(DATA_READINESS_ASSESSOR_NAME).toBe('Data Readiness Assessor');
    expect(DATA_READINESS_ASSESSOR_MAX_STEPS).toBe(20);
    expect(DATA_READINESS_ASSESSOR_TOOL_NAMES).toEqual([
      'list_entities',
      'describe_entity',
      'run_readonly_sql',
      'sample_rows',
      'explore_result',
      'ask_clarification',
      'assess_readiness',
    ]);
  });
});

describe("Elena's conversation contract (plan Elena 1.2)", () => {
  it('names her workflow id and engine', () => {
    expect(INSIGHTS_LEAD_WORKFLOW_ID).toBe('agent:insights-lead');
    expect(INSIGHTS_LEAD_ENGINE_ID).toBe('insights-lead-conversation');
  });

  it("shares Avery's step schemas, so her contract hash is unchanged", () => {
    expect(CONVERSATION_STEP_SCHEMAS).toBe(
      ORCHESTRATED_MICHAEL_STEP_SCHEMAS.orchestrate,
    );
  });

  it('has one Answer step, Start → Answer → End', () => {
    expect(INSIGHTS_LEAD_STEPS).toHaveLength(1);
    expect(INSIGHTS_LEAD_STEPS[0]).toMatchObject({
      id: 'answer',
      title: 'Answer',
      kind: 'agent',
    });
    expect(INSIGHTS_LEAD_STEPS[0].exits?.map((e) => e.outcome)).toEqual([
      'fails',
      'stops',
      'waits',
    ]);
    expect(INSIGHTS_LEAD_EDGES).toEqual([
      { from: 'start', to: 'answer', kind: 'next' },
      { from: 'answer', to: 'end', kind: 'next' },
    ]);
  });

  it('catalogues Elena: key, name, budget and tools', () => {
    expect(INSIGHTS_LEAD_AGENT_KEY).toBe('insights-lead');
    expect(INSIGHTS_LEAD_NAME).toBe('Insights Lead');
    expect(INSIGHTS_LEAD_MAX_STEPS).toBe(24);
    expect(INSIGHTS_LEAD_TOOL_NAMES).toEqual([
      'list_entities',
      'describe_entity',
      'sample_rows',
      'run_readonly_sql',
      'explore_result',
      'ask_clarification',
      'submit_dashboard',
      'export_conversation',
    ]);
  });
});
