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

  const column = (name: string, type: string) => ({
    name,
    type,
    nullable: true,
  });

  it('lists every entity’s columns and types, views included, with no sample values (BA-242 round 5)', () => {
    const lines = entityOrientationLines(
      ['Core'],
      [
        {
          ...datasets[0],
          tables: ['db.world_cup.matches', 'db.world_cup.v_matches'],
          entities: [
            {
              key: 'db.world_cup.matches',
              columns: [
                { ...column('id', 'bigint'), sampleValues: ['1', '2'] },
                column('kicked_off_at', 'timestamp without time zone'),
                column('stage', 'character varying'),
              ],
            },
            {
              key: 'db.world_cup.v_matches',
              columns: [
                column('updated_at', 'timestamp with time zone'),
                column('xg', 'double precision'),
              ],
            },
          ],
        },
      ],
    );
    expect(lines).toContain(
      '- db.world_cup.matches (dataset: Core; datasource: postgres ds-1): id bigint, kicked_off_at timestamp, stage varchar',
    );
    expect(lines).toContain(
      '- db.world_cup.v_matches (dataset: Core; datasource: postgres ds-1): updated_at timestamptz, xg double',
    );
    expect(lines.join('\n')).not.toContain('e.g.');
  });

  it('cuts each entity to an equal share past 5,000 characters, so none goes bare', () => {
    const tables = Array.from({ length: 20 }, (_, i) => `db.wide.t${i}`);
    const lines = entityOrientationLines(
      ['Wide'],
      [
        {
          ...datasets[0],
          name: 'Wide',
          tables,
          entities: tables.map((key) => ({
            key,
            columns: Array.from({ length: 40 }, (_, c) =>
              column(`a_fairly_long_column_name_${c}`, 'text'),
            ),
          })),
        },
      ],
    );
    const entityLines = lines.filter((line) => line.startsWith('- db.wide.'));
    expect(entityLines).toHaveLength(20);
    for (const line of entityLines) {
      expect(line).toMatch(
        /\): a_fairly_long_column_name_0 text, .*, … \+\d+ more$/,
      );
    }
    const listed = entityLines.map((line) => line.split('): ')[1]).join('');
    expect(listed.length).toBeLessThanOrEqual(5_000 + 20 * 20);
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
