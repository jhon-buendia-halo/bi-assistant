import { join } from 'path';
import { z } from 'zod';
import {
  ASSISTANT_IDENTITY,
  ASSISTANT_WORKING_RULES,
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
