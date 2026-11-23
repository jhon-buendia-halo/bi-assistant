// The Agent class pulls in ESM-only dependencies; these specs read her
// instructions and skills functions alone.
jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));

import { RequestContext } from '@mastra/core/request-context';
import {
  ORCHESTRATOR_TEAMS,
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../workflows/orchestrated-answer.steps';
import {
  EXPORT_RULE,
  EXPORT_TEAM_LINE,
  ORCHESTRATOR_INSTRUCTIONS,
  ORCHESTRATOR_MICHAEL_INSTRUCTIONS,
  withExportInstructions,
} from '../workflows/orchestrated-answer.prompts';
import {
  chiefOfStaffInstructions,
  chiefOfStaffSkills,
} from './chief-of-staff.agent';

function contextWith(
  overrides: Partial<OrchestratorToolsRuntime>,
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, {
    tools: ORCHESTRATOR_TEAMS['orchestrated-answer'].tools,
    exportsConversation: false,
    ...overrides,
  });
  return requestContext;
}

describe("Avery's export gate on her instructions and skills (agents.md 2.21, 7.4)", () => {
  it('with the gate closed: her job description and skills are what they were before the export', () => {
    expect(chiefOfStaffInstructions(contextWith({}))).toBe(
      ORCHESTRATOR_INSTRUCTIONS,
    );
    expect(
      chiefOfStaffInstructions(
        contextWith({
          tools: ORCHESTRATOR_TEAMS['orchestrated-answer-michael'].tools,
        }),
      ),
    ).toBe(ORCHESTRATOR_MICHAEL_INSTRUCTIONS);
    expect(chiefOfStaffSkills(contextWith({})).map((s) => s.name)).toEqual([
      'avery-playbooks',
    ]);
  });

  it('with the gate open: the team line before ask_clarification, the rule last, and the skill', () => {
    for (const id of ['orchestrated-answer', 'orchestrated-answer-michael']) {
      const text = chiefOfStaffInstructions(
        contextWith({
          tools: ORCHESTRATOR_TEAMS[id].tools,
          exportsConversation: true,
        }),
      );
      const lines = text.trimEnd().split('\n');
      const team = lines.indexOf(EXPORT_TEAM_LINE);
      expect(lines[team + 1]).toMatch(/^- ask_clarification:/);
      expect(lines.at(-1)).toBe(EXPORT_RULE);
    }
    expect(
      chiefOfStaffSkills(contextWith({ exportsConversation: true })).map(
        (s) => s.name,
      ),
    ).toEqual(['avery-playbooks', 'conversation-export']);
  });

  it('lists every skill with no run (her agent page)', () => {
    expect(chiefOfStaffSkills(new RequestContext()).map((s) => s.name)).toEqual(
      ['avery-playbooks', 'conversation-export'],
    );
    expect(chiefOfStaffInstructions(undefined)).toBe(ORCHESTRATOR_INSTRUCTIONS);
  });

  it('adds both lines at the end of an edited prompt with no ask_clarification line', () => {
    expect(withExportInstructions('You are Avery.\n')).toBe(
      `You are Avery.\n${EXPORT_TEAM_LINE}\n${EXPORT_RULE}\n`,
    );
  });
});
