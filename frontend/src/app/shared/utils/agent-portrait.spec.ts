import {
  BUILTIN_PORTRAITS,
  CLEAR_GLASSES,
  SEEDED_HAIR,
  agentPortrait,
  portraitInitial,
  portraitOptions,
} from './agent-portrait';

describe('agent portraits (ui.md 4.4)', () => {
  it('draws a built-in agent with its chosen look, no beard, no gesture', () => {
    const david = portraitOptions('sql-fixer');
    expect(david['seed']).toBe('sql-fixer');
    expect(david['hair']).toEqual(['variant06']);
    expect(david['glasses']).toEqual(['variant08']);
    expect(david['glassesProbability']).toBe(100);
    expect(david['beardProbability']).toBe(0);
    expect(david['gestureProbability']).toBe(0);
    // Emily wears no glasses.
    expect(portraitOptions('assistant')['glassesProbability']).toBe(0);
  });

  it('draws a user agent from its key, without hats or sunglasses', () => {
    const options = portraitOptions('8f1c-user-agent');
    expect(options['seed']).toBe('8f1c-user-agent');
    expect(options['hair']).toEqual([...SEEDED_HAIR]);
    expect(SEEDED_HAIR).not.toContain('hat');
    expect(SEEDED_HAIR).not.toContain('variant14');
    expect(options['glasses']).toEqual([...CLEAR_GLASSES]);
  });

  it('only gives built-in agents clear glasses', () => {
    for (const look of Object.values(BUILTIN_PORTRAITS)) {
      if (look.glasses) expect(CLEAR_GLASSES).toContain(look.glasses);
    }
  });

  it("falls back to the name's initial", () => {
    expect(portraitInitial('grace')).toBe('G');
    expect(portraitInitial('  ')).toBe('?');
  });

  it('renders the same SVG for the same key', async () => {
    const first = await agentPortrait('sql-fixer');
    expect(first).toMatch(/^data:image\/svg\+xml/);
    expect(await agentPortrait('sql-fixer')).toBe(first);
    expect(await agentPortrait('sql-verifier')).not.toBe(first);
  });
});
