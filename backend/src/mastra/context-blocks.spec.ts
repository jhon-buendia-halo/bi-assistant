import {
  entityOrientationLines,
  knowledgeContext,
  schemaNotesBlock,
} from './context-blocks';
import type { DatasetSnapshot } from './tool-services';

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

  it('leaves sample_rows out of the hint when it is not selected (ADR-0022)', () => {
    expect(entityOrientationLines(['Core'], datasets, ['visuals']).at(-1)).toBe(
      'Use describe_entity / run_readonly_sql to inspect and query them.',
    );
  });
});

describe('schemaNotesBlock (BA-319)', () => {
  const dataset = (
    name: string,
    schemas: DatasetSnapshot['schemas'],
  ): DatasetSnapshot => ({ name, tables: [], schemas });
  const GUIDANCE =
    'When the same data exists in several layers, prefer the Consumption schema for analysis unless the user asks for another layer.';

  it('is empty when no dataset has a note', () => {
    expect(schemaNotesBlock([dataset('A', undefined)])).toBe('');
    expect(schemaNotesBlock([dataset('A', [])])).toBe('');
  });

  it('states layer and description, then the guidance line', () => {
    expect(
      schemaNotesBlock([
        dataset('Core', [
          { key: 'db.gold', layer: 'consumption', description: 'Curated.' },
        ]),
      ]),
    ).toBe(
      [
        'Schema notes (set by the dataset owner):',
        '- db.gold (dataset: Core) — layer: Consumption; Curated.',
        GUIDANCE,
      ].join('\n'),
    );
  });

  it('omits the missing part without stray separators', () => {
    const block = schemaNotesBlock([
      dataset('Core', [
        { key: 'db.a', layer: 'landing' },
        { key: 'db.b', description: 'Only text' },
      ]),
    ]);
    expect(block).toContain('- db.a (dataset: Core) — layer: Landing\n');
    expect(block).toContain('- db.b (dataset: Core) — Only text\n');
    expect(block.endsWith(GUIDANCE)).toBe(true);
  });

  it('omits the guidance when no note has a layer', () => {
    const block = schemaNotesBlock([
      dataset('Core', [{ key: 'db.b', description: 'Only text' }]),
    ]);
    expect(block).not.toContain('prefer the Consumption');
  });

  it('keeps dataset order, sorts notes by key, collapses newlines', () => {
    const lines = schemaNotesBlock([
      dataset('Z', [
        { key: 'db.b', description: 'one\ntwo\r\n  three' },
        { key: 'db.a', layer: 'normalized' },
      ]),
      dataset('A', [{ key: 'db.c', layer: 'landing' }]),
    ]).split('\n');
    expect(lines.slice(1, 4)).toEqual([
      '- db.a (dataset: Z) — layer: Normalized',
      '- db.b (dataset: Z) — one two three',
      '- db.c (dataset: A) — layer: Landing',
    ]);
  });

  it('leaves entityOrientationLines unchanged without notes, appends with them', () => {
    const base = {
      name: 'Core',
      datasourceId: 'ds-1',
      datasourceKind: 'postgres' as const,
      tables: ['db.gold.t'],
    };
    const plain = entityOrientationLines(['Core'], [base]);
    expect(
      entityOrientationLines(['Core'], [{ ...base, schemas: [] }]),
    ).toEqual(plain);
    const withNotes = entityOrientationLines(
      ['Core'],
      [{ ...base, schemas: [{ key: 'db.gold', layer: 'consumption' }] }],
    );
    expect(withNotes.slice(0, plain.length)).toEqual(plain);
    expect(withNotes[plain.length]).toBe('');
    expect(withNotes[plain.length + 1]).toMatch(
      /^Schema notes \(set by the dataset owner\):\n- db\.gold/,
    );
  });
});
