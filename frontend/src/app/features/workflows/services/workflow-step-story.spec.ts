import { answerQueryIndex, storyMarkdown } from './workflow-step-story';

describe('answerQueryIndex', () => {
  const data = [
    { tool: 'list_entities', input: 'matches' },
    { tool: 'run_readonly_sql', input: 'SELECT 1' },
    { tool: 'sample_rows', input: 'SELECT 1' },
    { tool: 'run_readonly_sql', input: 'SELECT\n  1;' },
  ];

  it('finds the last SQL record that ran the statement, whitespace and a final semicolon aside', () => {
    expect(answerQueryIndex(data, 'SELECT 1')).toBe(3);
    expect(answerQueryIndex(data, 'select 2')).toBeNull();
  });

  it('has no index without the answer, nor for an empty statement', () => {
    expect(answerQueryIndex(null, 'SELECT 1')).toBeNull();
    expect(answerQueryIndex(data, '  ')).toBeNull();
  });

  it('matches a long statement kept clipped by its start, never a short one', () => {
    const long = `SELECT ${'a, '.repeat(800)}b FROM t`;
    const kept = [{ tool: 'run_readonly_sql', input: long }];
    expect(answerQueryIndex(kept, long.slice(0, 2000))).toBe(0);
    expect(answerQueryIndex(kept, 'SELECT a')).toBeNull();
  });
});

describe('storyMarkdown', () => {
  it('writes the headline, the facts with verdicts and code, and what came next', () => {
    expect(
      storyMarkdown('How Validate ran', {
        headline: '1 of 2 checks failed.',
        facts: [
          { label: 'A query ran', values: ['yes'], verdict: 'passed' },
          { label: 'Tables', values: ['goals', 'players'], code: true },
        ],
        next: 'Analyse tried once more.',
        source: 'step',
      }),
    ).toBe(
      [
        '## How Validate ran',
        '',
        '1 of 2 checks failed.',
        '',
        '- ✓ **A query ran:** yes',
        '- **Tables:** `goals`, `players`',
        '',
        'Analyse tried once more.',
      ].join('\n'),
    );
  });
});
