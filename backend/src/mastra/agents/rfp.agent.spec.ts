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
      get id() {
        return this.config['id'];
      }
      get name() {
        return this.config['name'];
      }
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
jest.mock('@mastra/memory', () => ({
  Memory: class {
    constructor(readonly config: unknown) {}
  },
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import type { InlineSkill } from '@mastra/core/skills';
import { parseLinks, resolveLinks } from '../agent-links';
import { setAgentPromptOverrides } from '../agent-prompt-overrides';
import { shippedAgentPrompt } from '../shipped-agent-prompts';
import { toolSection, withToolSection } from '../tool-section';
import { rfpTools } from '../tools/rfp.tools';
import { rfpAgent, rfpInstructions } from './rfp.agent';
import { RFP_PROMPT } from './system-prompts';
import { parseWorkflow } from '../workflow-section';

/**
 * agents.md Appendix C, verbatim, and the served prompt: Appendix C, its
 * links resolved to plain mentions, with the `## Tools` lines of 3.10 (first sentences and input names written from the
 * spec, not from the code) inserted before `## Working rules`.
 */
const SHIPPED = readFileSync(
  join(__dirname, '__fixtures__', 'rfp-prompt.shipped.txt'),
  'utf8',
);
const GOLDEN = readFileSync(
  join(__dirname, '__fixtures__', 'rfp-prompt.full.txt'),
  'utf8',
);

const TOOL_NAMES = [
  'list_clients',
  'get_client_renewals',
  'get_client_program',
  'get_plan_design',
  'get_client_financials',
  'get_client_census',
  'get_client_commercials',
  'get_marketing_history',
  'list_reference_data',
  'list_carriers',
  'create_rfp',
  'list_rfps',
  'get_rfp',
  'update_rfp',
  'set_rfp_lines',
  'set_rfp_carriers',
  'set_rfp_requirements',
  'set_rfp_timeline',
  'export_rfp_package',
  'export_rfp_draft',
  'show_in_panel',
  'update_workflow',
  'ask_clarification',
];

/** Its stage skills, in stage order (agents.md 7.4). */
const STAGE_SKILLS = [
  'rfp-client-renewal',
  'rfp-current-program',
  'rfp-market-scope',
  'rfp-carriers',
  'rfp-requirements',
  'rfp-timeline',
  'rfp-package',
];

afterEach(() => setAgentPromptOverrides([]));

describe('the RFP Builder (agents.md 2.8)', () => {
  const config = (rfpAgent as unknown as { config: Record<string, unknown> })
    .config;

  it('is registered with its id, name and description', () => {
    expect(config['id']).toBe('rfp-builder');
    expect(config['name']).toBe('RFP Builder');
    expect(config['description']).toBe(
      'Walks a Mercer benefits consultant through building a carrier RFP for one client over the Intellify data, stage by stage, and assembles the RFP package.',
    );
  });

  it('has the 20 RFP tools, show_in_panel, update_workflow and ask_clarification, in order, and nothing else', async () => {
    expect(Object.keys(await rfpAgent.listTools())).toEqual(TOOL_NAMES);
    expect(Object.keys(rfpTools)).not.toContain('run_readonly_sql');
    // No workspace, so no workspace tools.
    expect(config['workspace']).toBeUndefined();
  });

  it('keeps the last 40 messages, with no semantic recall or titles', () => {
    expect((config['memory'] as { config: unknown }).config).toEqual({
      options: {
        lastMessages: 40,
        semanticRecall: false,
        generateTitle: false,
      },
    });
  });

  it('resolves its model at call time', () => {
    expect(typeof config['model']).toBe('function');
  });
});

describe("the RFP Builder's prompt (agents.md 2.8, Appendix C)", () => {
  it('ships Appendix C verbatim as the editable text', () => {
    expect(RFP_PROMPT).toBe(SHIPPED);
    expect(shippedAgentPrompt('rfp')).toBe(SHIPPED);
    expect(RFP_PROMPT.startsWith('You are the RFP Builder')).toBe(true);
    expect(RFP_PROMPT).not.toContain('## Tools');
  });

  it('serves Appendix C with the generated Tools section, byte for byte', async () => {
    expect(rfpInstructions()).toBe(GOLDEN);
    expect(await rfpAgent.getInstructions()).toBe(GOLDEN);
  });

  it('generates one Tools line per tool from its inputs and first sentence', () => {
    const expected = GOLDEN.split('\n');
    const start = expected.indexOf('## Tools');
    const end = expected.indexOf('## Working rules');
    expect(toolSection(rfpTools)).toEqual(expected.slice(start, end - 1));
    expect(toolSection(rfpTools)).toHaveLength(1 + TOOL_NAMES.length);
  });

  it('serves an override with the Tools section before its Working rules', () => {
    const override = [
      'You are the RFP Builder, terse.',
      '',
      '## Working rules',
      '- Be brief.',
    ].join('\n');
    setAgentPromptOverrides([{ key: 'rfp', prompt: override, baseHash: 'x' }]);

    const served = rfpInstructions();

    expect(served).toBe(
      [
        'You are the RFP Builder, terse.',
        '',
        ...toolSection(rfpTools),
        '',
        '## Working rules',
        '- Be brief.',
      ].join('\n'),
    );
  });

  it('appends the Tools section to an override without Working rules', () => {
    setAgentPromptOverrides([
      { key: 'rfp', prompt: 'You are the RFP Builder.\n', baseHash: 'x' },
    ]);

    expect(rfpInstructions()).toBe(
      `You are the RFP Builder.\n\n${toolSection(rfpTools).join('\n')}`,
    );
  });

  it("ignores another agent's override", () => {
    setAgentPromptOverrides([
      {
        key: 'assistant',
        prompt: 'You are the Questions to Insights assistant',
        baseHash: 'x',
      },
    ]);
    expect(rfpInstructions()).toBe(GOLDEN);
    expect(withToolSection(resolveLinks(RFP_PROMPT), rfpTools)).toBe(GOLDEN);
  });

  it('links its seven stage skills, in order, and the tools its working rules use (BA-228)', () => {
    const links = parseLinks(RFP_PROMPT);
    expect(links.skills).toEqual(STAGE_SKILLS);
    expect([...links.tools].sort()).toEqual(
      [
        'ask_clarification',
        'create_rfp',
        'export_rfp_draft',
        'export_rfp_package',
        'get_client_financials',
        'get_rfp',
        'set_rfp_carriers',
        'set_rfp_lines',
        'set_rfp_requirements',
        'set_rfp_timeline',
        'show_in_panel',
        'update_rfp',
        'update_workflow',
      ].sort(),
    );
    // Every link names one of its own tools.
    for (const tool of links.tools) expect(TOOL_NAMES).toContain(tool);
  });

  it('sends the model plain mentions, never link syntax', () => {
    const served = rfpInstructions();
    expect(served).not.toContain('[[');
    expect(served).toContain('the "get_rfp" tool');
    for (const [n, skill] of STAGE_SKILLS.entries()) {
      expect(served).toMatch(
        new RegExp(
          `\\n${n + 1}\\. [^\\n]+ — the "${skill}" skill: [^\\n]+\\.\\n`,
        ),
      );
    }
    expect(served).toContain(
      "Load a stage's skill before you start that stage",
    );
    // Identity, Workflow, Tools, Working rules.
    const order = ['## Workflow', '## Tools', '## Working rules'].map((h) =>
      served.indexOf(`\n${h}\n`),
    );
    expect(order[0]).toBeGreaterThan(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(served).toContain('Use the "ask_clarification" tool only when');
  });

  it('gives every workflow stage a default action for the user (BA-231)', () => {
    const phases = parseWorkflow(RFP_PROMPT);
    expect(phases.map((p) => p.skill)).toEqual(STAGE_SKILLS);
    for (const phase of phases) {
      expect(phase.action).toMatch(/^[A-Z].+\.$/);
      expect(phase.action!.length).toBeLessThanOrEqual(120);
    }
    expect(phases[2].action).toBe('Decide which lines go out to bid.');
    expect(RFP_PROMPT).toContain('and todo with the concrete action for this');
  });

  it("resolves an override's links before serving it", () => {
    setAgentPromptOverrides([
      {
        key: 'rfp',
        prompt:
          'You are the RFP Builder.\n\n## Working rules\n- Load [[skill:rfp-client-renewal]], then call [[tool:list_clients]].',
        baseHash: 'x',
      },
    ]);

    const served = rfpInstructions();

    expect(served).not.toContain('[[');
    expect(served).toContain(
      '- Load the "rfp-client-renewal" skill, then call the "list_clients" tool.',
    );
  });
});

describe("the RFP Builder's skills (agents.md 7.4)", () => {
  it('declares its seven stage skills on demand, sorted by name, with no reference files', async () => {
    const skills = await (
      rfpAgent as unknown as { resolveSkills(): Promise<InlineSkill[]> }
    ).resolveSkills();

    expect(skills.map((skill) => skill.name)).toEqual([...STAGE_SKILLS].sort());
    for (const skill of skills) {
      expect(skill.description).toMatch(/^Use when .*at stage [1-7] \(/);
      // Tool links reach the model as plain mentions (agents.md 4.1).
      expect(skill.instructions).not.toContain('[[');
      expect(skill.instructions).toMatch(/^Tools for this stage: the "/m);
      expect([...(skill.references ?? [])]).toEqual([]);
    }
    const stage1 = skills.find((skill) => skill.name === 'rfp-client-renewal');
    expect(stage1?.instructions).toContain('the "list_clients" tool');
    expect(stage1?.instructions).toContain(
      '`create_rfp(clientOneCode, planYear)`',
    );
  });
});
