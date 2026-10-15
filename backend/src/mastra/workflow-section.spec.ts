import { parseWorkflow } from './workflow-section';

describe('parseWorkflow', () => {
  it('reads the numbered phases of the section with their skill links', () => {
    const prompt = [
      'You are an agent.',
      '',
      '## Workflow',
      '1. Client and renewal — [[skill:rfp-client-renewal]]',
      '2) Lines of coverage - [[skill:rfp-lines]]',
      'Load a stage skill first.',
      '3. Review',
      '',
      '## Working rules',
      '1. Not a phase',
    ].join('\n');
    expect(parseWorkflow(prompt)).toEqual([
      { number: 1, title: 'Client and renewal', skill: 'rfp-client-renewal' },
      { number: 2, title: 'Lines of coverage', skill: 'rfp-lines' },
      { number: 3, title: 'Review' },
    ]);
  });

  it('numbers by position, ignoring the written number', () => {
    expect(parseWorkflow('## Workflow  \n5. One\n9. Two')).toEqual([
      { number: 1, title: 'One' },
      { number: 2, title: 'Two' },
    ]);
  });

  it('returns nothing without the exact heading', () => {
    expect(parseWorkflow('## Workflow steps\n1. One')).toEqual([]);
    expect(parseWorkflow('1. One')).toEqual([]);
    expect(parseWorkflow('')).toEqual([]);
  });

  it('clips long titles to 80 characters and keeps at most 20 phases', () => {
    const long = 'x'.repeat(120);
    const many = Array.from({ length: 25 }, (_, i) => `${i + 2}. P${i}`);
    const phases = parseWorkflow(
      ['## Workflow', `1. ${long}`, ...many].join('\n'),
    );
    expect(phases).toHaveLength(20);
    expect(phases[0].title).toHaveLength(80);
  });

  it('reads the default action after the title or the skill link (BA-231)', () => {
    const phases = parseWorkflow(
      [
        '## Workflow',
        '1. Plain',
        '2. Analyse: Run the queries and compare the results.',
        '3. Scope — [[skill:rfp-market-scope]]: Decide which lines go out to bid.',
        '4. Linked — [[skill:a-b]]',
        '5. Colon: Ask: "which one?" and note: both',
        '6. Empty:',
        `7. Long: ${'y'.repeat(150)}`,
      ].join('\n'),
    );
    expect(phases[0]).toEqual({ number: 1, title: 'Plain' });
    expect(phases[1]).toEqual({
      number: 2,
      title: 'Analyse',
      action: 'Run the queries and compare the results.',
    });
    expect(phases[2]).toEqual({
      number: 3,
      title: 'Scope',
      skill: 'rfp-market-scope',
      action: 'Decide which lines go out to bid.',
    });
    expect(phases[3]).toEqual({ number: 4, title: 'Linked', skill: 'a-b' });
    expect(phases[4].action).toBe('Ask: "which one?" and note: both');
    expect(phases[5]).toEqual({ number: 6, title: 'Empty:' });
    expect(phases[6].action).toHaveLength(120);
  });
});
