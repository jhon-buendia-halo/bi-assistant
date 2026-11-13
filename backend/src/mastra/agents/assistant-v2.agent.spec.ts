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
import { AGENT_SKILLS } from '../app-skills';
import { shippedAgentPrompt } from '../shipped-agent-prompts';
import { datasetTools } from '../tools/dataset.tools';
import { askClarificationTool } from '../tools/clarification.tool';
import { toolSection } from '../tool-section';
import {
  ASSISTANT_V2_AGENT_KEY,
  ASSISTANT_V2_MAX_STEPS,
  assistantV2Agent,
  assistantV2Instructions,
  assistantV2Tools,
} from './assistant-v2.agent';
import { ASSISTANT_V2_TOOL_NAMES } from './assistant-v2-catalog';
import { ASSISTANT_V2_PROMPT } from './system-prompts';

/**
 * agents.md Appendix E, verbatim, and the served prompt: Appendix E, its
 * links resolved to plain mentions, with the `## Tools` lines of 3.1, 3.2,
 * 3.3, 3.4 and 3.5 inserted before `## Working rules`.
 */
// A Windows checkout may turn the fixtures' LF into CRLF.
const SHIPPED = readFileSync(
  join(__dirname, '__fixtures__', 'assistant-v2-prompt.shipped.txt'),
  'utf8',
).replace(/\r\n/g, '\n');
const GOLDEN = readFileSync(
  join(__dirname, '__fixtures__', 'assistant-v2-prompt.full.txt'),
  'utf8',
).replace(/\r\n/g, '\n');

/** The `## Tools` lines of 3.1-3.5, as the assistant's prompt has them. */
const TOOLS_SECTION = [
  '## Tools',
  "- list_entities(): List the entities (fully-qualified catalog.schema.table) available in this session's datasets, with the datasource (id and kind: databricks or postgres) each one lives in.",
  '- describe_entity(entity, datasourceId): Describe one dataset entity: its columns with types, nullability, and — when captured at save time — a description and real sample values per column.',
  '- sample_rows(entity, datasourceId, limit, rationale): Fetch up to 100 sample rows from one dataset entity.',
  '- run_readonly_sql(sql, datasourceId, limit, rationale): Run a single read-only SELECT/WITH statement (live) against one datasource.',
  '- ask_clarification(question, options): Ask the user ONE clarifying question with 2-4 concrete answer options, either before starting an analysis when their question is ambiguous (unclear scope, metric, timeframe, or entity), or mid-analysis when the data itself is ambiguous — a filter value, member/entity name or timeframe with several plausible matches.',
];

const TOOL_NAMES = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'ask_clarification',
];

const SKILL_NAMES = ['curated-knowledge', 'result-validation', 'sql-analysis'];

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
      'A business data analyst: answers questions over the datasets you pick with read-only SQL, checks its results and explains how it got them.',
    );
  });

  it("has the assistant's data tools, sample_rows and ask_clarification, the same instances, in order", async () => {
    const tools = await assistantV2Agent.listTools();
    expect(Object.keys(tools)).toEqual(TOOL_NAMES);
    expect(ASSISTANT_V2_TOOL_NAMES).toEqual(TOOL_NAMES);
    expect(tools).toBe(assistantV2Tools);
    for (const name of TOOL_NAMES.slice(0, 4)) {
      expect(assistantV2Tools[name as keyof typeof assistantV2Tools]).toBe(
        datasetTools[name as keyof typeof datasetTools],
      );
    }
    expect(assistantV2Tools.ask_clarification).toBe(askClarificationTool);
  });

  it('has no visual, panel or workflow tool and no workspace', async () => {
    const tools = Object.keys(await assistantV2Agent.listTools());
    for (const name of [
      'create_visual',
      'update_visual',
      'show_in_panel',
      'update_workflow',
    ]) {
      expect(tools).not.toContain(name);
    }
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
    expect(
      ASSISTANT_V2_PROMPT.startsWith('You are Questions to Insights'),
    ).toBe(true);
    expect(ASSISTANT_V2_PROMPT).not.toContain('## Tools');
    expect(ASSISTANT_V2_PROMPT).not.toContain('## Workflow');
  });

  it('serves Appendix E with the generated Tools section before Working rules, byte for byte', async () => {
    expect(assistantV2Instructions()).toBe(GOLDEN);
    expect(await assistantV2Agent.getInstructions()).toBe(GOLDEN);
    const lines = GOLDEN.split('\n');
    const start = lines.indexOf('## Tools');
    const end = lines.indexOf('## Working rules');
    expect(lines.slice(start, end - 1)).toEqual(TOOLS_SECTION);
    expect(toolSection(assistantV2Tools)).toEqual(TOOLS_SECTION);
  });

  it('links only its own tools and skills', () => {
    const links = parseLinks(ASSISTANT_V2_PROMPT);
    expect([...links.tools].sort()).toEqual([...TOOL_NAMES].sort());
    expect([...links.skills].sort()).toEqual(SKILL_NAMES);
  });

  it('sends the model plain mentions, never link syntax', () => {
    const served = assistantV2Instructions();
    expect(served).not.toContain('[[');
    expect(served).toContain('load the "sql-analysis" skill.');
    expect(served).toContain('Call the "ask_clarification" tool only when');
  });

  it('works as an analyst: method, grounding, ambiguity, SQL practice, rationale and answer format', () => {
    const served = assistantV2Instructions();
    for (const heading of [
      'Method, for every question:',
      'Grounding:',
      'Ambiguity:',
      'SQL practice:',
      'Say why, every time:',
      'Answer format:',
    ]) {
      expect(served.split('\n')).toContain(heading);
    }
    // Grounding: every fact from a query result of this turn, nothing added
    // from general knowledge, and a partial coverage stated, then stop.
    expect(served).toContain(
      '- Every number, name, date and comparison in your answer must come from a\n  query result of this turn',
    );
    expect(served).toContain('- Add nothing from general knowledge:');
    expect(served).toContain('"for reference" facts');
    expect(served).toContain('say what IS covered, from the data, and stop');
    // At most one clarification; a fuzzy scope is assumed, not asked.
    expect(served).toContain('Ask at most ONE clarification per question.');
    expect(served).toContain('do NOT ask: answer over the\n  full scope');
    // The answer: headline, table, how, assumptions and caveats.
    expect(served).toContain(
      '- Start with a one-line headline that states the key number.',
    );
    expect(served).toContain('- With three or more values, add a compact');
    expect(served).toContain('"How I got this": 1-3 bullets');
    expect(served).toContain('"Assumptions" and "Caveats", each only when');
    // It never proposes deep analysis, visuals or the panel (2.11).
    expect(served).not.toMatch(/deep analysis|create_visual|show_in_panel/);
  });

  it('serves an override with the Tools section before its Working rules, links resolved', () => {
    const override = [
      'You are Questions to Insights, terse.',
      '',
      '## Working rules',
      '- Call [[tool:list_entities]] first.',
    ].join('\n');
    setAgentPromptOverrides([
      { key: 'assistant-v2', prompt: override, baseHash: 'x' },
    ]);
    expect(assistantV2Instructions()).toBe(
      [
        'You are Questions to Insights, terse.',
        '',
        ...TOOLS_SECTION,
        '',
        '## Working rules',
        '- Call the "list_entities" tool first.',
      ].join('\n'),
    );
    setAgentPromptOverrides([]);
    expect(assistantV2Instructions()).toBe(GOLDEN);
  });

  it('appends the Tools section to an override without Working rules', () => {
    setAgentPromptOverrides([
      {
        key: 'assistant-v2',
        prompt: 'You are Questions to Insights. Be brief.',
        baseHash: 'x',
      },
    ]);
    expect(assistantV2Instructions()).toBe(
      ['You are Questions to Insights. Be brief.', '', ...TOOLS_SECTION].join(
        '\n',
      ),
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
    expect(assistantV2Instructions()).toBe(GOLDEN);
  });
});

describe("Questions to Insights v2's skills (agents.md 7.4)", () => {
  it('declares curated-knowledge, result-validation and sql-analysis on demand', async () => {
    expect([...AGENT_SKILLS['assistant-v2']].sort()).toEqual(SKILL_NAMES);
    const skills = await (
      assistantV2Agent as unknown as {
        resolveSkills(): Promise<InlineSkill[]>;
      }
    ).resolveSkills();
    expect(skills.map((skill) => skill.name)).toEqual(SKILL_NAMES);
    for (const skill of skills) {
      expect(skill.description).toMatch(/^Use when /);
      expect(skill.instructions).not.toContain('[[');
      expect([...(skill.references ?? [])]).toEqual([]);
    }
  });

  it('sql-analysis covers ties, ratios, period comparisons, distinct counts, NULLs and the three dialects', async () => {
    const skills = await (
      assistantV2Agent as unknown as {
        resolveSkills(): Promise<InlineSkill[]>;
      }
    ).resolveSkills();
    const sql = skills.find((skill) => skill.name === 'sql-analysis')!;
    for (const heading of [
      '## Top-N and ties',
      '## Ratios and shares',
      '## Period over period',
      '## Distinct counts and join fan-out',
      '## NULLs',
      '## Dialects',
    ]) {
      expect(sql.instructions).toContain(heading);
    }
    expect(sql.instructions).toMatch(/PostgreSQL/);
    expect(sql.instructions).toMatch(/Databricks/);
    expect(sql.instructions).toMatch(/SQLite/);
  });

  it('result-validation covers empty and partial results, totals, join duplicates, outliers and coverage', async () => {
    const skills = await (
      assistantV2Agent as unknown as {
        resolveSkills(): Promise<InlineSkill[]>;
      }
    ).resolveSkills();
    const checks = skills.find((skill) => skill.name === 'result-validation')!;
    for (const heading of [
      '## Empty or partial results',
      '## Totals that should reconcile',
      '## Duplicates from joins',
      '## Outliers and constant values',
      '## Coverage',
    ]) {
      expect(checks.instructions).toContain(heading);
    }
  });

  it("leaves the assistant's skills unchanged: curated-knowledge only", () => {
    expect(AGENT_SKILLS['assistant']).toEqual(['curated-knowledge']);
  });
});
