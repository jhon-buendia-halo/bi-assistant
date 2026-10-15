import {
  LINKABLE_TOOLS,
  chipClass,
  knownLinks,
  linkedNames,
  promptLink,
  promptSegments,
  withLegacyLinks,
} from './prompt-links';

describe('prompt links', () => {
  it('formats and parses [[skill:…]] and [[tool:…]]', () => {
    expect(promptLink('skill', 'a-b_1')).toBe('[[skill:a-b_1]]');
    const text = 'Use [[skill:planner]] then [[tool:sample_rows]] [[skill:planner]].';
    expect(linkedNames(text, 'skill')).toEqual(['planner']);
    expect(linkedNames(text, 'tool')).toEqual(['sample_rows']);
    expect(promptSegments(text)).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'skill', name: 'planner' },
      { kind: 'text', text: ' then ' },
      { kind: 'tool', name: 'sample_rows' },
      { kind: 'text', text: ' ' },
      { kind: 'skill', name: 'planner' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('ignores text that is not a link', () => {
    expect(promptSegments('[[skill:bad name]] [[other:x]] [skill:x]')).toEqual([
      { kind: 'text', text: '[[skill:bad name]] [[other:x]] [skill:x]' },
    ]);
    expect(promptSegments('')).toEqual([]);
  });

  it('lists the eight library tools without read_file', () => {
    expect(LINKABLE_TOOLS.map((t) => t.name).sort()).toEqual([
      'ask_clarification',
      'create_visual',
      'describe_entity',
      'list_entities',
      'run_readonly_sql',
      'sample_rows',
      'show_in_panel',
      'update_visual',
    ]);
  });

  it('colours a chip by kind, and danger when it does not exist', () => {
    const known = knownLinks([{ name: 'planner' }]);
    expect(chipClass('skill', 'planner', known)).toBe('chip chip-info');
    expect(chipClass('tool', 'sample_rows', known)).toBe('chip chip-neutral');
    expect(chipClass('skill', 'gone', known)).toBe('chip chip-danger');
    expect(chipClass('tool', 'nope', known)).toBe('chip chip-danger');
  });

  it('appends a last line of links for what the instructions miss', () => {
    expect(withLegacyLinks('Hi', ['sample_rows'], ['planner'])).toBe(
      'Hi\nTools and skills: [[skill:planner]] [[tool:sample_rows]]',
    );
    expect(withLegacyLinks('', ['sample_rows'], [])).toBe(
      'Tools and skills: [[tool:sample_rows]]',
    );
    expect(
      withLegacyLinks('[[tool:sample_rows]]', ['sample_rows'], []),
    ).toBeNull();
  });
});
