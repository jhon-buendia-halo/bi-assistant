import { z } from 'zod';
import { resolveLinks } from '../agent-links';
import {
  ASSISTANT_IDENTITY,
  ASSISTANT_WORKING_RULES,
  assistantWorkingRules,
  buildAssistantInstructions,
  firstSentence,
  toolLines,
} from './assistant-prompt';

const TOOLS = {
  list_entities: {
    description: 'List the entities. With more text after.',
    inputSchema: z.object({}),
  },
  run_readonly_sql: {
    description: 'Run one statement (live)  against one datasource. Then more.',
    inputSchema: z.object({ sql: z.string(), limit: z.number().optional() }),
  },
};

describe('the Tools section', () => {
  it('gives one line per tool, in order, with its inputs and first sentence', () => {
    expect(toolLines(TOOLS)).toEqual([
      '- list_entities(): List the entities.',
      '- run_readonly_sql(sql, limit): Run one statement (live) against one datasource.',
    ]);
  });

  it('keeps a description with no sentence break whole', () => {
    expect(firstSentence('Tailor a visual, etc. Produces a new version.')).toBe(
      'Tailor a visual, etc.',
    );
    expect(firstSentence('No full stop here')).toBe('No full stop here');
    expect(firstSentence(undefined)).toBe('');
  });
});

describe('buildAssistantInstructions', () => {
  it('orders identity, Tools and Working rules, with no Skills section', () => {
    const prompt = buildAssistantInstructions(TOOLS);

    expect(prompt).toBe(
      [
        ...ASSISTANT_IDENTITY,
        '',
        '## Tools',
        ...toolLines(TOOLS),
        '',
        '## Working rules',
        ...ASSISTANT_WORKING_RULES.map(resolveLinks),
      ].join('\n'),
    );
    expect(prompt).not.toContain('[[');
    expect(prompt).toContain('Call the "ask_clarification" tool only when');
    expect(prompt).toContain(
      '[term] (see the "curated-knowledge" skill) outranks',
    );
    expect(
      prompt.startsWith('You are the Questions to Insights assistant'),
    ).toBe(true);
    expect(prompt).not.toContain('## Skills');
  });
});

/** The spec's replacement texts (agents.md 2.1), copied verbatim. */
const NO_CLARIFICATION = `You can't ask the user a question back in this session. When a question is
ambiguous — an undefined measure such as "best", "top" or "performed well",
a fuzzy scope, or a name with several plausible matches in the data — pick
the most natural reading the data supports, run the analysis over it, and
state the assumption in the answer, e.g. "Taking 'best' as most matches
won: ...". When answering every reasonable reading is cheap, cover them all
instead.`;

const NO_VISUALS = `Interactive visuals:
- You can't create or change visuals in this session. When the user asks
  for a chart or visual, say so in one short sentence and give the numbers
  in the answer instead.
- Never paste HTML, CSS or JavaScript into the chat.`;

const FULL_RULES = ASSISTANT_WORKING_RULES.join('\n');

describe('assistantWorkingRules (tool selection, ADR-0022)', () => {
  it('is the full rules for every tool', () => {
    expect(assistantWorkingRules()).toEqual([...ASSISTANT_WORKING_RULES]);
    expect(
      assistantWorkingRules(['sample_rows', 'ask_clarification', 'visuals']),
    ).toEqual([...ASSISTANT_WORKING_RULES]);
  });

  it('replaces the clarification paragraph without ask_clarification', () => {
    const rules = assistantWorkingRules(['sample_rows', 'visuals']).join('\n');

    expect(rules).toBe(
      NO_CLARIFICATION +
        FULL_RULES.slice(FULL_RULES.indexOf('\n\nFor every question:')),
    );
    expect(rules).not.toContain('ask_clarification');
    expect(rules).not.toContain('[[tool:ask_clarification]]');
    expect(rules).not.toContain('Ask at most ONE clarification');
  });

  it('replaces the Interactive visuals block without visuals', () => {
    const rules = assistantWorkingRules([
      'sample_rows',
      'ask_clarification',
    ]).join('\n');

    expect(rules).toBe(
      FULL_RULES.slice(0, FULL_RULES.indexOf('Interactive visuals:')) +
        NO_VISUALS +
        FULL_RULES.slice(FULL_RULES.indexOf('\n\nRules:')),
    );
    expect(rules).not.toMatch(/create_visual|update_visual/);
    expect(rules).toContain('[[skill:curated-knowledge]]');
  });

  it('drops the three sample_rows mentions without sample_rows', () => {
    const rules = assistantWorkingRules(['ask_clarification', 'visuals']).join(
      '\n',
    );

    expect(rules).not.toContain('sample_rows');
    expect(rules).toContain(
      '1. Map the question to concrete entities and columns ([[tool:list_entities]],\n   [[tool:describe_entity]]).\n',
    );
    expect(rules).toContain(
      'then the options must quote the actual values you found (via\n[[tool:describe_entity]]), not invented ones.',
    );
    expect(rules).toContain(
      '- [[tool:run_readonly_sql]] takes a rationale. Write it in the\n  first person',
    );
    expect(rules.split('\n')).toHaveLength(ASSISTANT_WORKING_RULES.length);
  });

  it('combines the replacements, down to no optional tool at all', () => {
    const rules = assistantWorkingRules([]).join('\n');

    expect(
      rules.startsWith(`${NO_CLARIFICATION}\n\nFor every question:\n`),
    ).toBe(true);
    expect(rules).toContain(`\n\n${NO_VISUALS}\n\nRules:\n`);
    expect(rules).toContain('   [[tool:describe_entity]]).\n');
    expect(rules).toContain('- [[tool:run_readonly_sql]] takes a rationale.');
    expect(rules).not.toMatch(
      /sample_rows|ask_clarification|create_visual|update_visual/,
    );
  });

  it('builds the prompt with the selection’s rules', () => {
    const prompt = buildAssistantInstructions(TOOLS, ['sample_rows']);

    expect(prompt).toContain(`## Working rules\n${NO_CLARIFICATION}\n`);
    expect(prompt).toContain(`\n${NO_VISUALS}\n`);
    expect(buildAssistantInstructions(TOOLS, undefined)).toBe(
      buildAssistantInstructions(TOOLS),
    );
  });
});

describe('the linked mentions (BA-224)', () => {
  it('writes every tool mention of the shipped rules as a link', () => {
    for (const tool of [
      'ask_clarification',
      'sample_rows',
      'describe_entity',
      'list_entities',
      'run_readonly_sql',
      'update_visual',
      'create_visual',
    ]) {
      expect(FULL_RULES).toContain(`[[tool:${tool}]]`);
      expect(FULL_RULES.replace(/\[\[tool:[a-z_]+\]\]/g, '')).not.toContain(
        tool,
      );
    }
    expect(FULL_RULES).toContain('[[skill:curated-knowledge]]');
  });

  it.each([
    [undefined],
    [[]],
    [['sample_rows']],
    [['visuals']],
    [['ask_clarification']],
    [['sample_rows', 'visuals']],
    [['sample_rows', 'ask_clarification']],
    [['visuals', 'ask_clarification']],
    [['sample_rows', 'visuals', 'ask_clarification']],
  ] as const)('serves no link for the selection %j', (selection) => {
    const prompt = buildAssistantInstructions(TOOLS, selection);
    expect(prompt).not.toContain('[[');
    expect(prompt).toContain('the "curated-knowledge" skill');
  });

  it('resolves the linked mentions the replacements leave', () => {
    const prompt = buildAssistantInstructions(TOOLS, ['ask_clarification']);
    expect(prompt).toContain(
      '(the "list_entities" tool,\n   the "describe_entity" tool).',
    );
    expect(prompt).toContain(
      '(via\nthe "describe_entity" tool), not invented ones.',
    );
    expect(prompt).toContain(
      '- the "run_readonly_sql" tool takes a rationale. Write it in the',
    );
  });
});
