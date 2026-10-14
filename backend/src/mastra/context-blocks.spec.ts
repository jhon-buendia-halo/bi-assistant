import { entityOrientationLines, knowledgeContext } from './context-blocks';

const BLOCK =
  'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):\n- [term] Host: the country that staged the tournament.';

describe('knowledgeContext (agents.md 4.1 Block 3, 7.4)', () => {
  it('sends the block alone: its rules are the on-demand skill (ADR-0020)', () => {
    expect(knowledgeContext(BLOCK)).toEqual([
      { role: 'system', content: BLOCK },
    ]);
  });

  it('sends nothing when no knowledge applies', () => {
    expect(knowledgeContext(undefined)).toEqual([]);
    expect(knowledgeContext('')).toEqual([]);
    expect(knowledgeContext('  \n ')).toEqual([]);
  });
});

describe('entityOrientationLines (agents.md 4.1 Block 1)', () => {
  const datasets = [
    {
      name: 'Core',
      datasourceId: 'ds-1',
      datasourceKind: 'postgres' as const,
      tables: ['db.world_cup.matches'],
    },
  ];

  it('names sample_rows in the hint when every tool is offered', () => {
    expect(entityOrientationLines(['Core'], datasets)).toEqual([
      'Datasets for this session: Core.',
      'Entities available (fully-qualified catalog.schema.table):',
      '- db.world_cup.matches (dataset: Core; datasource: postgres ds-1)',
      'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
    ]);
    expect(
      entityOrientationLines(['Core'], datasets, ['sample_rows']).at(-1),
    ).toBe(
      'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
    );
  });

  it('leaves sample_rows out of the hint when it is not selected (ADR-0021)', () => {
    expect(entityOrientationLines(['Core'], datasets, ['visuals']).at(-1)).toBe(
      'Use describe_entity / run_readonly_sql to inspect and query them.',
    );
  });
});
