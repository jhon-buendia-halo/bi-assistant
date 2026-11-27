import {
  agentKeyOfBinding,
  bindingOfAgent,
  isConversationalAgentWorkflow,
} from './conversation.model';

describe('conversational agent bindings (ADR-0058)', () => {
  it("knows Elena's and Dana's conversations, and no other workflow", () => {
    expect(isConversationalAgentWorkflow('agent:insights-lead')).toBe(true);
    expect(isConversationalAgentWorkflow('agent:data-readiness-assessor')).toBe(
      true,
    );
    expect(isConversationalAgentWorkflow('orchestrated-answer-michael')).toBe(
      false,
    );
    expect(isConversationalAgentWorkflow('agent:agent-1')).toBe(false);
  });

  it("opens Dana's run on her own page", () => {
    expect(agentKeyOfBinding('agent:data-readiness-assessor')).toBe(
      'data-readiness-assessor',
    );
    expect(bindingOfAgent('data-readiness-assessor')).toBe(
      'agent:data-readiness-assessor',
    );
  });
});
