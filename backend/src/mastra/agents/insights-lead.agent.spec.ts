// The real Agent pulls in ESM-only packages Jest cannot require. This
// stand-in keeps the config and resolves `instructions`, `skills` and
// `tools` the way @mastra/core 1.66's Agent does.
jest.mock('@mastra/core/agent', () => {
  const { RequestContext: Context } = jest.requireActual<
    typeof import('@mastra/core/request-context')
  >('@mastra/core/request-context');
  type Resolver = (args: { requestContext: unknown }) => unknown;
  const resolve = (value: unknown, requestContext: unknown) =>
    typeof value === 'function'
      ? (value as Resolver)({ requestContext })
      : value;
  return {
    Agent: class {
      constructor(readonly config: Record<string, unknown>) {}
      getInstructions({ requestContext = new Context() } = {}) {
        return resolve(this.config['instructions'], requestContext);
      }
      resolveSkills({ requestContext = new Context() } = {}) {
        return Promise.resolve(resolve(this.config['skills'], requestContext));
      }
      listTools({ requestContext = new Context() } = {}) {
        return Promise.resolve(resolve(this.config['tools'], requestContext));
      }
    },
  };
});
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));

import { RequestContext } from '@mastra/core/request-context';
import type { InlineSkill } from '@mastra/core/skills';
import { parseLinks } from '../agent-links';
import { setAgentPromptOverrides } from '../agent-prompt-overrides';
import { AGENT_SKILLS } from '../app-skills';
import { shippedAgentPrompt } from '../shipped-agent-prompts';
import { askClarificationTool } from '../tools/clarification.tool';
import { submitDashboardTool } from '../tools/dashboard.tools';
import { datasetTools } from '../tools/dataset.tools';
import { exportConversationTool } from '../tools/export.tools';
import {
  CONVERSATION_GATES_CONTEXT_KEY,
  type ConversationGates,
} from '../workflows/conversation-turn.steps';
import {
  INSIGHTS_LEAD_INSTRUCTIONS,
  INSIGHTS_LEAD_NO_CLARIFICATION_RULE,
  INSIGHTS_LEAD_REPAIR_RULE,
} from '../workflows/insights-lead.prompts';
import type { AgentSkill } from '../agent-skills';
import {
  INSIGHTS_LEAD_AGENT_KEY,
  INSIGHTS_LEAD_DESCRIPTION,
  INSIGHTS_LEAD_NAME,
  INSIGHTS_LEAD_TOOL_NAMES,
} from './insights-lead-catalog';
import {
  insightsLeadAgent,
  insightsLeadInstructions,
  insightsLeadSkills,
  insightsLeadTools,
} from './insights-lead.agent';

const ALWAYS = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'explore_result',
  'ask_clarification',
];

const ALL_SKILLS = [
  'answer-playbooks',
  'conversation-export',
  'curated-knowledge',
  'dashboard-building',
  'result-validation',
  'sql-analysis',
];

/** A call's context with the turn's gates set, as the solo turn sets them. */
function gated(gates: ConversationGates): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(CONVERSATION_GATES_CONTEXT_KEY, gates);
  return requestContext;
}

const CLOSED = gated({ dashboard: false, export: false });
const DASHBOARD = gated({ dashboard: true, export: false });
const EXPORT = gated({ dashboard: false, export: true });

async function skillNames(requestContext: RequestContext): Promise<string[]> {
  const skills = await (
    insightsLeadAgent as unknown as {
      resolveSkills(args: {
        requestContext: RequestContext;
      }): Promise<InlineSkill[]>;
    }
  ).resolveSkills({ requestContext });
  return skills.map((skill) => skill.name);
}

async function toolNames(requestContext: RequestContext): Promise<string[]> {
  return Object.keys(await insightsLeadAgent.listTools({ requestContext }));
}

function instructionsFor(requestContext?: RequestContext): string {
  return insightsLeadAgent.getInstructions(
    requestContext ? { requestContext } : {},
  ) as unknown as string;
}

afterEach(() => setAgentPromptOverrides([]));

describe('Elena, the Insights Lead (plan Elena 2)', () => {
  const config = (
    insightsLeadAgent as unknown as { config: Record<string, unknown> }
  ).config;

  it('is registered with her key, name and description, and no memory', () => {
    expect(config['id']).toBe(INSIGHTS_LEAD_AGENT_KEY);
    expect(config['id']).toBe('insights-lead');
    expect(config['name']).toBe(INSIGHTS_LEAD_NAME);
    expect(config['description']).toBe(INSIGHTS_LEAD_DESCRIPTION);
    // The host sends the conversation as a transcript (plan Elena 2.3).
    expect(config['memory']).toBeUndefined();
    expect(config['workspace']).toBeUndefined();
  });

  it('ships her prompt as her editable text (ADR-0026)', () => {
    expect(shippedAgentPrompt(INSIGHTS_LEAD_AGENT_KEY)).toBe(
      INSIGHTS_LEAD_INSTRUCTIONS,
    );
  });
});

describe("Elena's tools by the turn's gates (plan Elena 2.3)", () => {
  it('with both gates closed: the dataset tools, explore_result and ask_clarification only', async () => {
    expect(await toolNames(CLOSED)).toEqual(ALWAYS);
  });

  it('with the dashboard gate open: submit_dashboard too', async () => {
    expect(await toolNames(DASHBOARD)).toEqual([...ALWAYS, 'submit_dashboard']);
  });

  it('with the export gate open: export_conversation too', async () => {
    expect(await toolNames(EXPORT)).toEqual([...ALWAYS, 'export_conversation']);
  });

  it('with no gates key (her agent page, tool details): every tool, in catalogue order', async () => {
    expect(await toolNames(new RequestContext())).toEqual([
      ...INSIGHTS_LEAD_TOOL_NAMES,
    ]);
  });

  it('uses the same tool instances as Michael and Clara', () => {
    const tools = insightsLeadTools(undefined) as Record<string, unknown>;
    for (const name of ALWAYS.slice(0, 5)) {
      expect(tools[name]).toBe(datasetTools[name as keyof typeof datasetTools]);
    }
    expect(tools['ask_clarification']).toBe(askClarificationTool);
    expect(tools['submit_dashboard']).toBe(submitDashboardTool);
    expect(tools['export_conversation']).toBe(exportConversationTool);
  });
});

describe("Elena's skills by the turn's gates (plan Elena 2.1, 2.3)", () => {
  it('declares her six on-demand skills', () => {
    expect([...AGENT_SKILLS[INSIGHTS_LEAD_AGENT_KEY]].sort()).toEqual(
      ALL_SKILLS,
    );
  });

  it('with both gates closed: neither dashboard-building nor conversation-export', async () => {
    expect(await skillNames(CLOSED)).toEqual([
      'answer-playbooks',
      'curated-knowledge',
      'result-validation',
      'sql-analysis',
    ]);
  });

  it('with the dashboard gate open: dashboard-building', async () => {
    expect(await skillNames(DASHBOARD)).toEqual([
      'answer-playbooks',
      'curated-knowledge',
      'dashboard-building',
      'result-validation',
      'sql-analysis',
    ]);
  });

  it('with the export gate open: conversation-export', async () => {
    expect(await skillNames(EXPORT)).toEqual([
      'answer-playbooks',
      'conversation-export',
      'curated-knowledge',
      'result-validation',
      'sql-analysis',
    ]);
  });

  it('with no gates key: every skill', async () => {
    expect(await skillNames(new RequestContext())).toEqual(ALL_SKILLS);
    expect(insightsLeadSkills(undefined).map((s) => s.name)).toEqual(
      ALL_SKILLS,
    );
  });

  it('serves the playbooks with their references and no link syntax', async () => {
    const skills = await (
      insightsLeadAgent as unknown as {
        resolveSkills(): Promise<InlineSkill[]>;
      }
    ).resolveSkills();
    for (const skill of skills) {
      expect(skill.description).toMatch(/^Use when /);
      expect(skill.instructions).not.toContain('[[');
    }
    const playbooks = skills.find((s) => s.name === 'answer-playbooks');
    expect(Object.keys(playbooks?.references ?? {}).length).toBe(5);
    const dashboard = skills.find((s) => s.name === 'dashboard-building');
    expect(Object.keys(dashboard?.references ?? {}).length).toBe(1);
  });
});

describe("Elena's prompt (plan Elena 2.2)", () => {
  it('measures 5,000 to 6,000 characters as served, with the generated tool section', () => {
    const served = instructionsFor();
    expect(served.length).toBeGreaterThanOrEqual(5000);
    expect(served.length).toBeLessThanOrEqual(6000);
    expect(served).toContain('## Tools');
    for (const name of INSIGHTS_LEAD_TOOL_NAMES) {
      expect(served).toContain(`- ${name}(`);
    }
  });

  it('lists only the tools the call is offered', () => {
    const served = instructionsFor(CLOSED);
    expect(served).not.toContain('- submit_dashboard(');
    expect(served).not.toContain('- export_conversation(');
    expect(instructionsFor(DASHBOARD)).toContain('- submit_dashboard(');
    expect(instructionsFor(EXPORT)).toContain('- export_conversation(');
  });

  it('puts the cue-fired repair rule last', () => {
    for (const context of [undefined, CLOSED, DASHBOARD, EXPORT]) {
      const lines = instructionsFor(context).trimEnd().split('\n');
      expect(lines.at(-1)).toBe(INSIGHTS_LEAD_REPAIR_RULE);
    }
    expect(INSIGHTS_LEAD_REPAIR_RULE).toContain(
      'Checks on your answer failed:',
    );
  });

  it('speaks to one agent: no team, no briefs', () => {
    // The shipped text, and what the model reads with her own tools.
    for (const text of [INSIGHTS_LEAD_INSTRUCTIONS, instructionsFor(CLOSED)]) {
      expect(text).not.toMatch(/\bAvery\b/);
      expect(text).not.toMatch(/\bMichael\b/);
      expect(text).not.toMatch(/\bClara\b/);
      expect(text).not.toMatch(/\bbriefs?\b/i);
    }
    expect(INSIGHTS_LEAD_INSTRUCTIONS).toMatch(
      /^You are Elena, the Insights Lead/,
    );
  });

  it('links only her own tools and skills, and sends plain mentions', () => {
    const links = parseLinks(INSIGHTS_LEAD_INSTRUCTIONS);
    for (const tool of links.tools) {
      expect(INSIGHTS_LEAD_TOOL_NAMES).toContain(tool);
    }
    expect([...links.skills].sort()).toEqual(ALL_SKILLS);
    expect(instructionsFor()).not.toContain('[[');
  });

  it('serves an in-app override with her tool section, the repair rule as written', () => {
    setAgentPromptOverrides([
      {
        key: INSIGHTS_LEAD_AGENT_KEY,
        prompt: 'You are Elena, edited.\n\n## Working rules\n- One rule.',
        baseHash: 'edited',
      },
    ]);
    const served = insightsLeadInstructions(CLOSED);
    expect(served.startsWith('You are Elena, edited.\n\n## Tools\n')).toBe(
      true,
    );
    expect(served.trimEnd().endsWith('- One rule.')).toBe(true);
  });
});

/** A call of a user agent's run: its selection, skills and the turn's gates. */
function userAgentCall(entries: {
  tools?: string[];
  skills?: AgentSkill[];
  gates?: ConversationGates;
}): RequestContext {
  const requestContext = gated(
    entries.gates ?? { dashboard: false, export: false },
  );
  if (entries.tools) requestContext.set('agent-tools', entries.tools);
  if (entries.skills) requestContext.set('agent-skills', entries.skills);
  return requestContext;
}

const inApp = (name: string, description = `Use for ${name}.`): AgentSkill => ({
  id: `skill-${name}`,
  name,
  description,
  body: `The ${name} body, with [[tool:run_readonly_sql]].`,
  files: [],
});

describe("Elena runs a user agent's definition (ADR-0059)", () => {
  it('offers sample_rows and ask_clarification only when the selection has them, in the same key order', async () => {
    expect(
      await toolNames(userAgentCall({ tools: ['ask_clarification'] })),
    ).toEqual([
      'list_entities',
      'describe_entity',
      'run_readonly_sql',
      'explore_result',
      'ask_clarification',
    ]);
    expect(await toolNames(userAgentCall({ tools: ['sample_rows'] }))).toEqual([
      'list_entities',
      'describe_entity',
      'sample_rows',
      'run_readonly_sql',
      'explore_result',
    ]);
    expect(
      await toolNames(
        userAgentCall({ tools: ['sample_rows', 'ask_clarification'] }),
      ),
    ).toEqual(ALWAYS);
  });

  it('without ask_clarification: the no-clarification rule replaces the asking rule, and the repair cue stays last', () => {
    const served = instructionsFor(userAgentCall({ tools: ['sample_rows'] }));
    expect(served).not.toContain('Ask at most one question');
    expect(served).toContain(INSIGHTS_LEAD_NO_CLARIFICATION_RULE);
    expect(served).not.toContain('- ask_clarification(');
    expect(served.trimEnd().split('\n').at(-1)).toBe(INSIGHTS_LEAD_REPAIR_RULE);
    // With it, her shipped asking rule as always.
    expect(instructionsFor(CLOSED)).toContain('- Ask at most one question');
    expect(instructionsFor(CLOSED)).not.toContain(
      INSIGHTS_LEAD_NO_CLARIFICATION_RULE,
    );
  });

  it("puts the agent's in-app skills after her catalogue, one of the same name replacing hers", async () => {
    const skills = await (
      insightsLeadAgent as unknown as {
        resolveSkills(args: {
          requestContext: RequestContext;
        }): Promise<InlineSkill[]>;
      }
    ).resolveSkills({
      requestContext: userAgentCall({
        skills: [inApp('zeta'), inApp('sql-analysis', 'Our own SQL rules.')],
      }),
    });
    expect(skills.map((skill) => skill.name)).toEqual([
      'answer-playbooks',
      'curated-knowledge',
      'result-validation',
      'zeta',
      'sql-analysis',
    ]);
    expect(skills.at(-1)?.description).toBe('Our own SQL rules.');
    expect(skills.at(-2)?.instructions).toBe(
      'The zeta body, with the "run_readonly_sql" tool.',
    );
  });

  it('keeps her catalogue skills as they are when the call carries no in-app skills', async () => {
    expect(await skillNames(CLOSED)).toEqual(
      await skillNames(userAgentCall({ skills: [] })),
    );
  });
});
