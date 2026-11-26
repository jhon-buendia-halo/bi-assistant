import { z } from 'zod';
import { firstSentence, toolLines, withToolSection } from './tool-section';

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

describe('withToolSection', () => {
  it('puts the section before `## Working rules`, so the last rule stays last', () => {
    expect(
      withToolSection('Identity.\n\n## Working rules\n- Last rule.', TOOLS),
    ).toBe(
      [
        'Identity.',
        '',
        '## Tools',
        ...toolLines(TOOLS),
        '',
        '## Working rules',
        '- Last rule.',
      ].join('\n'),
    );
  });

  it('appends the section after a blank line to a prompt with no `## Working rules`', () => {
    expect(withToolSection('Identity.\n', TOOLS)).toBe(
      ['Identity.', '', '## Tools', ...toolLines(TOOLS)].join('\n'),
    );
  });
});
