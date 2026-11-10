// The real Agent pulls in ESM-only packages Jest cannot require. This
// stand-in keeps the config and resolves `instructions` and `tools` the way
// @mastra/core 1.66's Agent does.
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

import { setAgentPromptOverrides } from '../agent-prompt-overrides';
import { shippedAgentPrompt } from '../shipped-agent-prompts';
import { datasetTools } from '../tools/dataset.tools';
import {
  ASSISTANT_V2_AGENT_KEY,
  ASSISTANT_V2_MAX_STEPS,
  assistantV2Agent,
  assistantV2Instructions,
  assistantV2Tools,
} from './assistant-v2.agent';
import { ASSISTANT_V2_TOOL_NAMES } from './assistant-v2-catalog';
import { ASSISTANT_V2_PROMPT } from './system-prompts';

/** agents.md Appendix E, verbatim. */
const SHIPPED = [
  'You are Questions to Insights v2 — a data analyst working over the catalogs,',
  "schemas and entities in the user's session datasets. Answer the user's",
  'question from the data: find the entities, run read-only SQL, and give the',
  'numbers you found.',
].join('\n');

/** The `## Tools` lines of 3.1, 3.2 and 3.4, as the assistant's prompt has them. */
const TOOLS_SECTION = [
  '## Tools',
  "- list_entities(): List the entities (fully-qualified catalog.schema.table) available in this session's datasets, with the datasource (id and kind: databricks or postgres) each one lives in.",
  '- describe_entity(entity, datasourceId): Describe one dataset entity: its columns with types, nullability, and — when captured at save time — a description and real sample values per column.',
  '- run_readonly_sql(sql, datasourceId, limit, rationale): Run a single read-only SELECT/WITH statement (live) against one datasource.',
];

/** What the model receives: Appendix E, a blank line, then `## Tools`. */
const SERVED = [SHIPPED, '', ...TOOLS_SECTION].join('\n');

const TOOL_NAMES = ['list_entities', 'describe_entity', 'run_readonly_sql'];

afterEach(() => setAgentPromptOverrides([]));

describe('Questions to Insights v2 (agents.md 2.11)', () => {
  const config = (
    assistantV2Agent as unknown as { config: Record<string, unknown> }
  ).config;

  it('is registered with its key, id, name, description and step budget', () => {
    expect(ASSISTANT_V2_AGENT_KEY).toBe('assistant-v2');
    expect(ASSISTANT_V2_MAX_STEPS).toBe(15);
    expect(config['id']).toBe('questions-to-insights-v2');
    expect(config['name']).toBe('Questions to Insights v2');
    expect(config['description']).toBe(
      'A slimmed-down data analyst under construction: answers questions over the datasets you pick using only the core data tools.',
    );
  });

  it("has exactly the assistant's three core data tools, the same instances, in order", async () => {
    const tools = await assistantV2Agent.listTools();
    expect(Object.keys(tools)).toEqual(TOOL_NAMES);
    expect(ASSISTANT_V2_TOOL_NAMES).toEqual(TOOL_NAMES);
    expect(tools).toBe(assistantV2Tools);
    for (const name of TOOL_NAMES) {
      expect(assistantV2Tools[name as keyof typeof assistantV2Tools]).toBe(
        datasetTools[name as keyof typeof datasetTools],
      );
    }
  });

  it('has no skills and no workspace', () => {
    expect(config['skills']).toBeUndefined();
    expect(config['workspace']).toBeUndefined();
  });

  it("keeps the assistant's memory: last 40 messages, no semantic recall, working memory or titles", () => {
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

describe("Questions to Insights v2's prompt (agents.md 2.11, Appendix E)", () => {
  it('ships Appendix E verbatim as the editable text', () => {
    expect(ASSISTANT_V2_PROMPT).toBe(SHIPPED);
    expect(shippedAgentPrompt('assistant-v2')).toBe(SHIPPED);
    expect(ASSISTANT_V2_PROMPT).not.toContain('## Tools');
    expect(ASSISTANT_V2_PROMPT).not.toContain('[[');
  });

  it('serves Appendix E with the generated Tools section appended', async () => {
    expect(assistantV2Instructions()).toBe(SERVED);
    expect(await assistantV2Agent.getInstructions()).toBe(SERVED);
  });

  it('serves an override with the Tools section before its Working rules, links resolved', () => {
    const override = [
      'You are Questions to Insights v2, terse.',
      '',
      '## Working rules',
      '- Call [[tool:list_entities]] first.',
    ].join('\n');
    setAgentPromptOverrides([
      { key: 'assistant-v2', prompt: override, baseHash: 'x' },
    ]);
    expect(assistantV2Instructions()).toBe(
      [
        'You are Questions to Insights v2, terse.',
        '',
        ...TOOLS_SECTION,
        '',
        '## Working rules',
        '- Call the "list_entities" tool first.',
      ].join('\n'),
    );
    setAgentPromptOverrides([]);
    expect(assistantV2Instructions()).toBe(SERVED);
  });

  it('appends the Tools section to an override without Working rules', () => {
    setAgentPromptOverrides([
      {
        key: 'assistant-v2',
        prompt: 'You are Questions to Insights v2. Be brief.',
        baseHash: 'x',
      },
    ]);
    expect(assistantV2Instructions()).toBe(
      [
        'You are Questions to Insights v2. Be brief.',
        '',
        ...TOOLS_SECTION,
      ].join('\n'),
    );
  });

  it("ignores the assistant's override", () => {
    setAgentPromptOverrides([
      {
        key: 'assistant',
        prompt: 'You are the Questions to Insights assistant.',
        baseHash: 'x',
      },
    ]);
    expect(assistantV2Instructions()).toBe(SERVED);
  });
});
