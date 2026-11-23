// The Agent class pulls in ESM-only dependencies; these specs read her
// instructions and skills functions alone.
jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));

import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { RequestContext } from '@mastra/core/request-context';
import { askClarificationTool } from '../tools/clarification.tool';
import { orchestratorTools } from '../tools/orchestrator.tools';
import { contractJsonSchema } from '../workflows/workflow-contract';
import { setAgentPromptOverrides } from '../agent-prompt-overrides';
import {
  AVERY_TEAM,
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../workflows/orchestrated-answer-michael.steps';
import {
  EXPORT_RULE,
  EXPORT_TEAM_LINE,
  ORCHESTRATOR_MICHAEL_INSTRUCTIONS,
  withExportInstructions,
} from '../workflows/orchestrated-answer-michael.prompts';
import {
  chiefOfStaffInstructions,
  chiefOfStaffSkills,
} from './chief-of-staff.agent';

function contextWith(
  overrides: Partial<OrchestratorToolsRuntime>,
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, {
    tools: AVERY_TEAM.tools,
    exportsConversation: false,
    ...overrides,
  });
  return requestContext;
}

describe("Avery's export gate on her instructions and skills (agents.md 2.21, 7.4)", () => {
  it('with the gate closed: her job description and skills are what they were before the export', () => {
    expect(chiefOfStaffInstructions(contextWith({}))).toBe(
      ORCHESTRATOR_MICHAEL_INSTRUCTIONS,
    );
    expect(chiefOfStaffSkills(contextWith({})).map((s) => s.name)).toEqual([
      'avery-playbooks',
    ]);
  });

  it('with the gate open: the team line before ask_clarification, the rule last, and the skill', () => {
    const text = chiefOfStaffInstructions(
      contextWith({ exportsConversation: true }),
    );
    const lines = text.trimEnd().split('\n');
    const team = lines.indexOf(EXPORT_TEAM_LINE);
    expect(lines[team + 1]).toMatch(/^- ask_clarification:/);
    expect(lines.at(-1)).toBe(EXPORT_RULE);
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
    expect(chiefOfStaffInstructions(undefined)).toBe(
      ORCHESTRATOR_MICHAEL_INSTRUCTIONS,
    );
  });

  it('runs on her in-app override of the shipped prompt (ADR-0026), the export added when open', () => {
    setAgentPromptOverrides([
      {
        key: 'chief-of-staff',
        prompt: 'You are Avery, edited.\n- ask_clarification: asks.\n',
        baseHash: 'h',
        updatedAt: '2026-11-23T00:00:00.000Z',
      },
    ]);
    try {
      expect(chiefOfStaffInstructions(contextWith({}))).toBe(
        'You are Avery, edited.\n- ask_clarification: asks.\n',
      );
      expect(
        chiefOfStaffInstructions(contextWith({ exportsConversation: true })),
      ).toBe(
        `You are Avery, edited.\n${EXPORT_TEAM_LINE}\n- ask_clarification: asks.\n${EXPORT_RULE}\n`,
      );
    } finally {
      setAgentPromptOverrides([]);
    }
  });

  it('adds both lines at the end of an edited prompt with no ask_clarification line', () => {
    expect(withExportInstructions('You are Avery.\n')).toBe(
      `You are Avery.\n${EXPORT_TEAM_LINE}\n${EXPORT_RULE}\n`,
    );
  });
});

/**
 * What Avery receives in Answer a Business Question (Avery + Michael)
 * (agents.md 5.23), pinned to its value before the two other Answer a
 * Business Question workflows were removed: her job description, her
 * skills and her tools (id, description, input schema), with every gate
 * closed and each one open. A change here is a change of her prompt.
 */
describe('Avery + Michael: what Avery receives is pinned', () => {
  const AVERY_MICHAEL_TOOLS = [
    'answer_from_data',
    'build_dashboard',
    'export_conversation',
    'ask_clarification',
  ];

  function received(overrides: Record<string, unknown>) {
    const requestContext = new RequestContext();
    requestContext.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, {
      tools: AVERY_MICHAEL_TOOLS,
      buildsDashboard: false,
      exportsConversation: false,
      ...overrides,
    });
    const tools = {
      ...orchestratorTools(requestContext),
      ask_clarification: askClarificationTool,
    } as Record<
      string,
      { id: string; description: string; inputSchema?: unknown }
    >;
    return {
      instructions: chiefOfStaffInstructions(requestContext),
      skills: chiefOfStaffSkills(requestContext).map((skill) => skill.name),
      tools: Object.entries(tools).map(([key, tool]) => ({
        key,
        id: tool.id,
        description: tool.description,
        input: tool.inputSchema
          ? contractJsonSchema(tool.inputSchema as never, 'input')
          : null,
      })),
    };
  }

  it('her instructions, skills and tools hash to the base value', () => {
    const cases = [
      received({}),
      received({ buildsDashboard: true }),
      received({ exportsConversation: true }),
      received({ buildsDashboard: true, exportsConversation: true }),
    ];
    expect(cases[0].tools.map((tool) => tool.key)).toEqual([
      'answer_from_data',
      'ask_clarification',
    ]);
    expect(cases[3].tools.map((tool) => tool.key)).toEqual(AVERY_MICHAEL_TOOLS);
    expect(cases[0].tools[0].input).toMatchObject({
      properties: { brief: { type: 'string' } },
    });
    expect(cases[0].instructions).toContain('- answer_from_data: Michael');
    const digest = createHash('sha256')
      .update(JSON.stringify(cases))
      .digest('hex');
    // Re-pinned on 2026-11-23: her job description no longer routes playbook
    // steps for Olivia and Jessica (removed with the whole-team mode).
    expect(digest).toBe(
      '9c4ae187b7bd1e37ed453850f5356013fff5ef200be1e29f86cb83d7f147e36b',
    );
  });
});

/**
 * Avery's playbooks (agents.md 5.23) name only the tools she has in Avery +
 * Michael and the one teammate behind them: a playbook that sends her to a
 * removed tool or teammate is a prompt that cannot be followed.
 */
describe("Avery's playbooks name only her own tools", () => {
  const dir = join(__dirname, '..', 'skills', 'avery-playbooks');
  const files = [
    join(dir, 'SKILL.md'),
    ...readdirSync(join(dir, 'reference')).map((name) =>
      join(dir, 'reference', name),
    ),
  ];
  const TOOLS = [
    'answer_from_data',
    'build_dashboard',
    'export_conversation',
    'ask_clarification',
  ];

  it.each(files.map((file) => [file.slice(dir.length + 1), file]))(
    '%s',
    (_name, file) => {
      const text = readFileSync(file, 'utf8');
      const links = [...text.matchAll(/\[\[tool:([a-z_]+)\]\]/g)].map(
        (m) => m[1],
      );
      expect(links.filter((tool) => !TOOLS.includes(tool))).toEqual([]);
      expect(text).not.toMatch(
        /plan_analysis|analyse_data|write_answer|build_visual|read_reference_images|\bOlivia\b|\bJessica\b|\bRyan\b|\bZoe\b/,
      );
    },
  );
});
