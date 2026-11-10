import { legacyTagLabel, mappingLabel } from './ontology.model';

describe('ontology model', () => {
  it('labels the per-turn legacy tags with the ontology kinds', () => {
    expect(legacyTagLabel('term')).toBe('Concept');
    expect(legacyTagLabel('default_filter')).toBe('Constraint');
    expect(legacyTagLabel('instruction')).toBe('Instruction');
    expect(legacyTagLabel('relation')).toBe('Relation');
    expect(legacyTagLabel('other')).toBe('other');
  });

  it('renders a concept mapping like the per-turn line does', () => {
    expect(mappingLabel({ entity: 'a.b.c', column: 'x' })).toBe('a.b.c.x');
    expect(mappingLabel({ entity: 'a.b.c', expression: 'x > 1' })).toBe('x > 1');
    expect(
      mappingLabel({ entity: 'a.b.c', column: 'x', expression: 'x > 1' }),
    ).toBe('x > 1 (a.b.c.x)');
    expect(mappingLabel({ entity: 'a.b.c' })).toBe('a.b.c');
  });
});
