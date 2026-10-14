import { join } from 'path';
import { z } from 'zod';
import {
  ASSISTANT_IDENTITY,
  ASSISTANT_WORKING_RULES,
  assistantWorkingRules,
  buildAssistantInstructions,
  firstSentence,
  skillsSection,
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

const SKILL = (name: string, description: string) => ({
  name,
  description,
  dir: join('/skills', name),
});

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

describe('the Skills section', () => {
  it('is absent without on-demand skills', () => {
    expect(skillsSection([], false)).toEqual([]);
  });

  it('lists the skills by name with an escaped description and the SKILL.md path', () => {
    const lines = skillsSection(
      [
        SKILL('sql-style', 'Use when writing SQL & <checking> it.'),
        SKILL('migration-review', 'Use when migrating.'),
      ],
      false,
    );

    expect(lines.slice(0, 8)).toEqual([
      '## Skills',
      'Skills are folders of instructions, scripts and references for specific kinds',
      'of work. Below is the list of installed skills (name, description, location).',
      '',
      "Before starting any task that matches a skill's description, read that skill's",
      'SKILL.md with read_file and follow it. Several skills may apply; read each one.',
      'Read files that SKILL.md references only when the current step needs them.',
      "Bundled scripts can't be run here: don't read them into context unless SKILL.md says otherwise.",
    ]);
    expect(lines.slice(9)).toEqual([
      '<available_skills>',
      '  <skill>',
      '    <name>migration-review</name>',
      '    <description>Use when migrating.</description>',
      `    <location>${join('/skills', 'migration-review', 'SKILL.md')}</location>`,
      '  </skill>',
      '  <skill>',
      '    <name>sql-style</name>',
      '    <description>Use when writing SQL &amp; &lt;checking&gt; it.</description>',
      `    <location>${join('/skills', 'sql-style', 'SKILL.md')}</location>`,
      '  </skill>',
      '</available_skills>',
    ]);
  });

  it('points at run_skill_script when scripts can run', () => {
    expect(skillsSection([SKILL('a', 'Use when a.')], true)[7]).toBe(
      'Run bundled scripts with run_skill_script rather than reading them into context, unless SKILL.md says otherwise.',
    );
  });
});

describe('buildAssistantInstructions', () => {
  it('orders identity, Tools and Working rules, with no Skills section by default', () => {
    const prompt = buildAssistantInstructions(TOOLS, []);

    expect(prompt).toBe(
      [
        ...ASSISTANT_IDENTITY,
        '',
        '## Tools',
        ...toolLines(TOOLS),
        '',
        '## Working rules',
        ...ASSISTANT_WORKING_RULES,
      ].join('\n'),
    );
    expect(
      prompt.startsWith('You are the Questions to Insights assistant'),
    ).toBe(true);
    expect(prompt).not.toContain('## Skills');
  });

  it('ends with the Skills section when there are skills, and reads the tools for scripts', () => {
    const withScripts = { ...TOOLS, run_skill_script: { description: 'Run.' } };
    const prompt = buildAssistantInstructions(withScripts, [
      SKILL('sql-style', 'Use when writing SQL.'),
    ]);

    expect(prompt.indexOf('\n## Skills\n')).toBeGreaterThan(
      prompt.indexOf('\n## Working rules\n'),
    );
    expect(prompt.endsWith('</available_skills>')).toBe(true);
    expect(prompt).toContain('Run bundled scripts with run_skill_script');
    expect(prompt).toContain('\n- run_skill_script(): Run.');
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

describe('assistantWorkingRules (tool selection, ADR-0021)', () => {
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
  });

  it('drops the three sample_rows mentions without sample_rows', () => {
    const rules = assistantWorkingRules(['ask_clarification', 'visuals']).join(
      '\n',
    );

    expect(rules).not.toContain('sample_rows');
    expect(rules).toContain(
      '1. Map the question to concrete entities and columns (list_entities,\n   describe_entity).\n',
    );
    expect(rules).toContain(
      'then the options must quote the actual values you found (via\ndescribe_entity), not invented ones.',
    );
    expect(rules).toContain(
      '- run_readonly_sql takes a rationale. Write it in the\n  first person',
    );
    expect(rules.split('\n')).toHaveLength(ASSISTANT_WORKING_RULES.length);
  });

  it('combines the replacements, down to no optional tool at all', () => {
    const rules = assistantWorkingRules([]).join('\n');

    expect(
      rules.startsWith(`${NO_CLARIFICATION}\n\nFor every question:\n`),
    ).toBe(true);
    expect(rules).toContain(`\n\n${NO_VISUALS}\n\nRules:\n`);
    expect(rules).toContain('   describe_entity).\n');
    expect(rules).toContain('- run_readonly_sql takes a rationale.');
    expect(rules).not.toMatch(
      /sample_rows|ask_clarification|create_visual|update_visual/,
    );
  });

  it('builds the prompt with the selection’s rules', () => {
    const prompt = buildAssistantInstructions(TOOLS, [], ['sample_rows']);

    expect(prompt).toContain(`## Working rules\n${NO_CLARIFICATION}\n`);
    expect(prompt).toContain(`\n${NO_VISUALS}\n`);
    expect(buildAssistantInstructions(TOOLS, [], undefined)).toBe(
      buildAssistantInstructions(TOOLS, []),
    );
  });
});
