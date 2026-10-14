import {
  effectiveOptionalTools,
  isLibraryTool,
  LIBRARY_TOOLS,
  optionalToolOf,
  optionalToolsOf,
  parseLinks,
  resolveLinks,
} from './agent-links';

describe('agent links (ADR-0023, agents.md 4.3)', () => {
  it('parses skill and tool links, distinct and in order of appearance', () => {
    expect(
      parseLinks(
        'Use [[skill:b-skill]], [[tool:sample_rows]], [[skill:a]], [[skill:b-skill]] and [[tool:sample_rows]].',
      ),
    ).toEqual({ skills: ['b-skill', 'a'], tools: ['sample_rows'] });
    expect(parseLinks('')).toEqual({ skills: [], tools: [] });
  });

  it('ignores text that only looks like a link', () => {
    expect(
      parseLinks('[[other:x]] [[skill:]] [skill:x] [[tool:a b]] [[skill:x'),
    ).toEqual({ skills: [], tools: [] });
  });

  it('resolves every link to a plain mention and leaves the rest alone', () => {
    const text =
      'Read [[skill:fiscal-calendar]] then [[tool:sample_rows]] (a [[b]]).';
    expect(resolveLinks(text)).toBe(
      'Read the "fiscal-calendar" skill then the "sample_rows" tool (a [[b]]).',
    );
    expect(resolveLinks('[[tool:x]][[tool:y]]')).toBe(
      'the "x" toolthe "y" tool',
    );
  });

  it('knows the library and the optional group of each tool', () => {
    expect(LIBRARY_TOOLS).toHaveLength(7);
    expect(isLibraryTool('update_visual')).toBe(true);
    expect(isLibraryTool('read_file')).toBe(false);
    expect(optionalToolOf('create_visual')).toBe('visuals');
    expect(optionalToolOf('run_readonly_sql')).toBeUndefined();
    expect(
      optionalToolsOf([
        'update_visual',
        'ask_clarification',
        'create_visual',
        'list_entities',
      ]),
    ).toEqual(['ask_clarification', 'visuals']);
  });

  it('unions the direct tools with those the skills link; absent means every tool', () => {
    expect(
      effectiveOptionalTools(
        ['ask_clarification'],
        [{ body: 'x [[tool:sample_rows]] [[tool:run_readonly_sql]]' }],
      ),
    ).toEqual(['sample_rows', 'ask_clarification']);
    expect(
      effectiveOptionalTools([], [{ body: '[[tool:update_visual]]' }]),
    ).toEqual(['visuals']);
    expect(effectiveOptionalTools([], undefined)).toEqual([]);
    expect(effectiveOptionalTools(undefined, [])).toEqual([
      'sample_rows',
      'ask_clarification',
      'visuals',
    ]);
  });
});
