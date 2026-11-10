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
jest.mock('@mastra/memory', () => ({
  Memory: class {
    constructor(readonly config: unknown) {}
  },
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import type { InlineSkill } from '@mastra/core/skills';
import { parseLinks } from '../agent-links';
import { setAgentPromptOverrides } from '../agent-prompt-overrides';
import { shippedAgentPrompt } from '../shipped-agent-prompts';
import { toolSection } from '../tool-section';
import { readinessTools } from '../tools/readiness.tools';
import { describeEntityTool, runReadOnlySqlTool } from '../tools/dataset.tools';
import {
  DATA_READINESS_AGENT_KEY,
  DATA_READINESS_MAX_STEPS,
  dataReadinessAgent,
  dataReadinessInstructions,
} from './data-readiness.agent';
import { DATA_READINESS_PROMPT } from './system-prompts';

/**
 * agents.md Appendix D, verbatim, and the served prompt: Appendix D, its
 * links resolved to plain mentions, with the `## Tools` lines of 3.13 (first
 * sentences and input names written from the spec, not from the code)
 * inserted before `## Working rules`.
 */
const SHIPPED = readFileSync(
  join(__dirname, '__fixtures__', 'data-readiness-prompt.shipped.txt'),
  'utf8',
);
const GOLDEN = readFileSync(
  join(__dirname, '__fixtures__', 'data-readiness-prompt.full.txt'),
  'utf8',
);

const TOOL_NAMES = [
  'assess_data_readiness',
  'get_readiness_report',
  'list_readiness_reports',
  'describe_entity',
  'run_readonly_sql',
  'show_in_panel',
  'ask_clarification',
];

afterEach(() => setAgentPromptOverrides([]));

describe('the Data Readiness Agent (agents.md 2.10)', () => {
  const config = (
    dataReadinessAgent as unknown as { config: Record<string, unknown> }
  ).config;

  it('is registered with its key, id, name and description', () => {
    expect(DATA_READINESS_AGENT_KEY).toBe('data-readiness');
    expect(DATA_READINESS_MAX_STEPS).toBe(10);
    expect(config['id']).toBe('data-readiness-agent');
    expect(config['name']).toBe('Data Readiness Agent');
    expect(config['description']).toBe(
      'Assesses how ready a PostgreSQL or Databricks dataset is for analysis, scoring it on the DMBOK data-quality dimensions with a deterministic engine and explaining the findings.',
    );
  });

  it('has the three readiness tools, describe_entity, run_readonly_sql, show_in_panel and ask_clarification, in order, and nothing else', async () => {
    expect(Object.keys(await dataReadinessAgent.listTools())).toEqual(
      TOOL_NAMES,
    );
    // The shared read-only SQL tool for drill-down (ADR-0035), but no
    // workflow bar and no workspace (so no workspace tools).
    expect(readinessTools.run_readonly_sql).toBe(runReadOnlySqlTool);
    expect(readinessTools.describe_entity).toBe(describeEntityTool);
    expect(Object.keys(readinessTools)).not.toContain('update_workflow');
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

describe("the Data Readiness Agent's prompt (agents.md 2.10, Appendix D)", () => {
  it('ships Appendix D verbatim as the editable text', () => {
    expect(DATA_READINESS_PROMPT).toBe(SHIPPED);
    expect(shippedAgentPrompt('data-readiness')).toBe(SHIPPED);
    expect(
      DATA_READINESS_PROMPT.startsWith('You are the Data Readiness Agent'),
    ).toBe(true);
    expect(DATA_READINESS_PROMPT).not.toContain('## Tools');
    expect(DATA_READINESS_PROMPT).not.toContain('## Workflow');
  });

  it('serves Appendix D with the generated Tools section, byte for byte', async () => {
    expect(dataReadinessInstructions()).toBe(GOLDEN);
    expect(await dataReadinessAgent.getInstructions()).toBe(GOLDEN);
  });

  it('generates one Tools line per tool from its inputs and first sentence', () => {
    const expected = GOLDEN.split('\n');
    const start = expected.indexOf('## Tools');
    const end = expected.indexOf('## Working rules');
    expect(toolSection(readinessTools)).toEqual(expected.slice(start, end - 1));
  });

  it('links its own skills and the tools its working rules use', () => {
    const links = parseLinks(DATA_READINESS_PROMPT);
    expect([...links.skills]).toEqual([
      'data-readiness',
      'readiness-drilldown',
    ]);
    expect([...links.tools].sort()).toEqual(
      [
        'ask_clarification',
        'assess_data_readiness',
        'describe_entity',
        'get_readiness_report',
        'list_readiness_reports',
        'run_readonly_sql',
      ].sort(),
    );
    for (const tool of links.tools) expect(TOOL_NAMES).toContain(tool);
  });

  it('sends the model plain mentions, never link syntax', () => {
    const served = dataReadinessInstructions();
    expect(served).not.toContain('[[');
    expect(served).toContain('Load the "data-readiness" skill before');
    expect(served).toContain('ask which with the "ask_clarification" tool.');
  });

  it('serves an override with the Tools section before its Working rules, links resolved', () => {
    const override = [
      'You are the Data Readiness Agent, terse.',
      '',
      '## Working rules',
      '- Call [[tool:get_readiness_report]] first.',
    ].join('\n');
    setAgentPromptOverrides([
      { key: 'data-readiness', prompt: override, baseHash: 'x' },
    ]);

    expect(dataReadinessInstructions()).toBe(
      [
        'You are the Data Readiness Agent, terse.',
        '',
        ...toolSection(readinessTools),
        '',
        '## Working rules',
        '- Call the "get_readiness_report" tool first.',
      ].join('\n'),
    );
    setAgentPromptOverrides([]);
    expect(dataReadinessInstructions()).toBe(GOLDEN);
  });

  it("ignores another agent's override", () => {
    setAgentPromptOverrides([
      { key: 'rfp', prompt: 'You are the RFP Builder.', baseHash: 'x' },
    ]);
    expect(dataReadinessInstructions()).toBe(GOLDEN);
  });
});

describe("the Data Readiness Agent's skills (agents.md 7.4)", () => {
  it('declares the data-readiness and readiness-drilldown skills on demand, their links resolved, with no reference files', async () => {
    const skills = await (
      dataReadinessAgent as unknown as {
        resolveSkills(): Promise<InlineSkill[]>;
      }
    ).resolveSkills();

    expect(skills.map((skill) => skill.name)).toEqual([
      'data-readiness',
      'readiness-drilldown',
    ]);
    const [skill, drilldown] = skills;
    expect(skill.description).toMatch(/^Use when assessing a dataset's/);
    expect(skill.instructions).not.toContain('[[');
    expect(skill.instructions).toContain(
      'Tools for this skill: the "assess_data_readiness" tool, the "get_readiness_report" tool, the "list_readiness_reports" tool.',
    );
    expect([...(skill.references ?? [])]).toEqual([]);
    expect(drilldown.instructions).not.toContain('[[');
    expect(drilldown.instructions).toContain(
      'Tools for this skill: the "describe_entity" tool, the "run_readonly_sql" tool.',
    );
    expect([...(drilldown.references ?? [])]).toEqual([]);
  });
});
