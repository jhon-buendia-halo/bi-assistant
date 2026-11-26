import {
  CONVERSATIONAL_BINDINGS,
  conversationalBindingOf,
  isConversationalWorkflow,
} from './conversational-agents';
import {
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
    });
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
    expect(ids).toEqual(['orchestrated-answer-michael', 'agent:insights-lead']);
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
