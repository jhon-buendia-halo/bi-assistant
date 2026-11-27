import {
  ALWAYS_ON_TOOLS,
  effectiveOptionalTools,
  isLibraryTool,
  LIBRARY_TOOLS,
  RETIRED_LINK_TOOLS,
  optionalToolOf,
  optionalToolsOf,
  parseLinks,
  resolveLinks,
} from './agent-links';

describe('agent links (ADR-0024, agents.md 4.3)', () => {
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

  it("lists Elena's tools as the library, the always-on ones apart (ADR-0059)", () => {
    expect([...LIBRARY_TOOLS]).toEqual([
      'ask_clarification',
      'describe_entity',
      'explore_result',
      'list_entities',
      'run_readonly_sql',
      'sample_rows',
    ]);
    expect([...ALWAYS_ON_TOOLS]).toEqual([
      'describe_entity',
      'explore_result',
      'list_entities',
      'run_readonly_sql',
    ]);
  });

  it('accepts a retired tool in a link, never lists it, and resolves it to a plain mention', () => {
    expect([...RETIRED_LINK_TOOLS]).toEqual([
      'create_visual',
      'update_visual',
      'show_in_panel',
      'update_workflow',
    ]);
    for (const name of RETIRED_LINK_TOOLS) {
      expect(isLibraryTool(name)).toBe(true);
      expect(LIBRARY_TOOLS).not.toContain(name);
      expect(resolveLinks(`[[tool:${name}]]`)).toBe(`the "${name}" tool`);
    }
  });

  it('knows the optional group of each tool', () => {
    expect(optionalToolOf('update_workflow')).toBeUndefined();
    expect(optionalToolOf('show_in_panel')).toBeUndefined();
    expect(isLibraryTool('update_visual')).toBe(true);
    expect(isLibraryTool('read_file')).toBe(false);
    // A retired tool stands for no optional tool (ADR-0059).
    expect(optionalToolOf('create_visual')).toBeUndefined();
    expect(optionalToolOf('run_readonly_sql')).toBeUndefined();
    expect(
      optionalToolsOf([
        'update_visual',
        'ask_clarification',
        'create_visual',
        'list_entities',
      ]),
    ).toEqual(['ask_clarification']);
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
    ).toEqual([]);
    expect(effectiveOptionalTools([], undefined)).toEqual([]);
    expect(effectiveOptionalTools(undefined, [])).toEqual([
      'sample_rows',
      'ask_clarification',
    ]);
  });
});
