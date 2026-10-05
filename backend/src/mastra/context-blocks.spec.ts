import {
  entityOrientationLines,
  joinHintBlock,
  referenceSuffix,
  schemaCardBlock,
  schemaSnapshotBlock,
} from './context-blocks';
import type {
  ColumnProfile,
  DatasetColumnSnapshot,
  DatasetSnapshot,
} from './tool-services';

function column(over: Partial<DatasetColumnSnapshot> = {}): DatasetColumnSnapshot {
  return {
    name: 'status',
    type: 'text',
    nullable: true,
    ...over,
  };
}

function profile(over: Partial<ColumnProfile> = {}): ColumnProfile {
  return {
    sampledRows: 1_200,
    nullRate: 0,
    distinctCount: 0,
    constant: false,
    profiledAt: '2026-09-23T00:00:00.000Z',
    ...over,
  };
}

function dataset(
  entities: { key: string; columns: DatasetColumnSnapshot[] }[],
  over: Partial<DatasetSnapshot> = {},
): DatasetSnapshot {
  return {
    name: 'health_insurance',
    tables: entities.map((e) => e.key),
    entities,
    ...over,
  };
}

describe('schemaCardBlock', () => {
  it('returns an empty string when no dataset carries a profile and no knowledge applies', () => {
    const datasets = [
      dataset([
        {
          key: 'health_insurance.claims',
          columns: [column({ name: 'id', type: 'bigint' })],
        },
      ]),
    ];
    expect(schemaCardBlock(datasets)).toBe('');
  });

  it('returns an empty string for an empty dataset list', () => {
    expect(schemaCardBlock([])).toBe('');
  });

  it('renders a full card: constant, enum values, null rate, cents magnitude and cardinality', () => {
    const entity = {
      key: 'health_insurance.claims',
      columns: [
        column({
          name: 'status',
          type: 'text',
          profile: profile({
            distinctCount: 4,
            topValues: [
              { value: 'PAID', count: 700 },
              { value: 'DENIED', count: 300 },
              { value: 'PENDING', count: 150 },
              { value: 'REVERSED', count: 50 },
            ],
          }),
        }),
        column({
          name: 'currency',
          type: 'text',
          profile: profile({
            constant: true,
            distinctCount: 1,
            topValues: [{ value: 'USD', count: 1_200 }],
          }),
        }),
        column({
          name: 'terminated_on',
          type: 'date',
          profile: profile({ nullRate: 0.62, distinctCount: 400 }),
        }),
        column({
          name: 'paid_amount_cents',
          type: 'bigint',
          profile: profile({
            distinctCount: 1_100,
            magnitude: 'cents-like',
            min: '0',
            max: '1250000',
          }),
        }),
        column({
          name: 'provider_id',
          type: 'int',
          references: {
            entity: 'health_insurance.providers',
            column: 'id',
            source: 'declared',
            cardinality: 'many-to-one',
          },
        }),
        // No profile, no reference, no knowledge — must be left off the card.
        column({ name: 'internal_notes', type: 'text' }),
      ],
    };
    const block = schemaCardBlock([dataset([entity])]);

    expect(block.startsWith('Schema cards —')).toBe(true);
    expect(block).toContain('health_insurance.claims (≈1 200 rows)');
    expect(block).toContain(
      '  status text — 4 values: PAID, DENIED, PENDING, REVERSED',
    );
    expect(block).toContain("  currency text — constant 'USD'");
    expect(block).toContain('  terminated_on date — 62% null');
    expect(block).toContain(
      '  paid_amount_cents bigint — cents (÷100 for dollars), 0…1 250 000',
    );
    expect(block).toContain(
      '  provider_id int -> health_insurance.providers.id (many-to-one)',
    );
    expect(block).not.toContain('internal_notes');
  });

  it('never emits a card for an entity with no informative column and no note', () => {
    const entity = {
      key: 'health_insurance.claims',
      columns: [column({ name: 'id', type: 'bigint' }), column({ name: 'notes', type: 'text' })],
    };
    expect(schemaCardBlock([dataset([entity])])).toBe('');
  });

  it('places inline knowledge beside the column it describes and on the entity header', () => {
    const entity = {
      key: 'health_insurance.claims',
      columns: [
        column({
          name: 'status',
          type: 'text',
          profile: profile({
            sampledRows: 1,
            distinctCount: 2,
            topValues: [
              { value: 'PAID', count: 1 },
              { value: 'DENIED', count: 1 },
            ],
          }),
        }),
        // A column with nothing but a knowledge note still earns a line.
        column({ name: 'adjuster_code', type: 'text' }),
      ],
    };
    const knowledgeByColumn = new Map<
      string,
      { kind: string; title: string; body: string }[]
    >([
      [
        'health_insurance.claims',
        [{ kind: 'instruction', title: 'Scope', body: 'US claims only.' }],
      ],
      [
        'health_insurance.claims.status',
        [{ kind: 'term', title: 'Approved', body: "'approved' means PAID." }],
      ],
      [
        'health_insurance.claims.adjuster_code',
        [{ kind: 'term', title: 'Adjuster code', body: 'Internal id, not a name.' }],
      ],
    ]);

    const block = schemaCardBlock([dataset([entity])], { knowledgeByColumn });

    expect(block).toContain(
      'health_insurance.claims (≈1 rows) — note: "Scope: US claims only."',
    );
    expect(block).toContain(
      "status text — 2 values: PAID, DENIED — note: \"Approved: 'approved' means PAID.\"",
    );
    expect(block).toContain(
      '  adjuster_code text — note: "Adjuster code: Internal id, not a name."',
    );
  });

  it('clips a knowledge body to 160 characters inline', () => {
    const longBody = 'x'.repeat(200);
    const entity = {
      key: 'health_insurance.claims',
      columns: [column({ name: 'status', type: 'text' })],
    };
    const knowledgeByColumn = new Map<
      string,
      { kind: string; title: string; body: string }[]
    >([
      [
        'health_insurance.claims.status',
        [{ kind: 'term', title: 'Long', body: longBody }],
      ],
    ]);

    const block = schemaCardBlock([dataset([entity])], { knowledgeByColumn });
    const clipped = `Long: ${'x'.repeat(160)}…`;
    expect(block).toContain(clipped);
    expect(block).not.toContain('x'.repeat(161));
  });

  it('stops at a whole card instead of cutting one short when the budget runs out', () => {
    const entityA = {
      key: 'health_insurance.claims',
      columns: [
        column({
          name: 'status',
          type: 'text',
          profile: profile({
            distinctCount: 2,
            topValues: [
              { value: 'PAID', count: 1 },
              { value: 'DENIED', count: 1 },
            ],
          }),
        }),
      ],
    };
    const entityB = {
      key: 'health_insurance.providers',
      columns: [
        column({
          name: 'status',
          type: 'text',
          profile: profile({
            distinctCount: 1,
            constant: true,
            topValues: [{ value: 'ACTIVE', count: 1 }],
          }),
        }),
      ],
    };

    // Measure card A alone (well over budget so nothing is cut), then check
    // that a budget sized to fit exactly card A — with only a couple of
    // spare characters, not the whole of card B — keeps card A intact and
    // drops card B entirely rather than truncating it mid-card.
    const onlyA = schemaCardBlock([dataset([entityA])], {
      budgetChars: 100_000,
    });
    expect(onlyA).not.toBe('');

    const trimmed = schemaCardBlock([dataset([entityA, entityB])], {
      budgetChars: onlyA.length,
    });
    expect(trimmed).toBe(onlyA);
    expect(trimmed).not.toContain('health_insurance.providers');
  });

  it('returns an empty string when the only card would not fit the budget at all', () => {
    const entity = {
      key: 'health_insurance.claims',
      columns: [
        column({
          name: 'status',
          type: 'text',
          profile: profile({
            distinctCount: 1,
            constant: true,
            topValues: [{ value: 'PAID', count: 1 }],
          }),
        }),
      ],
    };
    expect(schemaCardBlock([dataset([entity])], { budgetChars: 1 })).toBe('');
  });
});

describe('joinHintBlock cardinality', () => {
  it('appends the known cardinality to a reference line', () => {
    const entity = {
      key: 'health_insurance.claims',
      columns: [
        column({
          name: 'provider_id',
          type: 'int',
          references: {
            entity: 'health_insurance.providers',
            column: 'id',
            source: 'declared',
            cardinality: 'many-to-one',
          },
        }),
      ],
    };
    const block = joinHintBlock([dataset([entity])]);
    expect(block).toContain(
      '- health_insurance.claims.provider_id -> health_insurance.providers.id (many-to-one)',
    );
  });

  it("leaves today's text unchanged when cardinality is unknown or absent", () => {
    const entityUnknown = {
      key: 'health_insurance.claims',
      columns: [
        column({
          name: 'provider_id',
          type: 'int',
          references: {
            entity: 'health_insurance.providers',
            column: 'id',
            source: 'declared',
            cardinality: 'unknown',
          },
        }),
      ],
    };
    const entityAbsent = {
      key: 'health_insurance.claims',
      columns: [
        column({
          name: 'provider_id',
          type: 'int',
          references: {
            entity: 'health_insurance.providers',
            column: 'id',
            source: 'declared',
          },
        }),
      ],
    };
    const expected =
      '- health_insurance.claims.provider_id -> health_insurance.providers.id';
    expect(joinHintBlock([dataset([entityUnknown])])).toContain(expected);
    expect(joinHintBlock([dataset([entityAbsent])])).toContain(expected);
  });
});

describe('legacy byte-identity without the new data', () => {
  const entity = {
    key: 'health_insurance.claims',
    columns: [
      column({
        name: 'provider_id',
        type: 'int',
        sampleValues: ['1', '2', '3'],
        references: {
          entity: 'health_insurance.providers',
          column: 'id',
          source: 'declared',
        },
      }),
      column({ name: 'status', type: 'text', sampleValues: ['PAID', 'DENIED'] }),
    ],
  };
  const datasets = [dataset([entity])];

  it('entityOrientationLines is unaffected by profile/cardinality data being absent', () => {
    expect(entityOrientationLines(['health_insurance'], datasets)).toEqual([
      'Datasets for this session: health_insurance.',
      'Entities available (fully-qualified catalog.schema.table):',
      '- health_insurance.claims (dataset: health_insurance; datasource: unknown )',
      'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
      '',
      [
        'How these entities join (-> declared by the datasource, ~> inferred from',
        'naming; join on these columns rather than guessing a key name):',
        '- health_insurance.claims.provider_id -> health_insurance.providers.id',
      ].join('\n'),
    ]);
  });

  it('schemaSnapshotBlock output is byte-identical whether or not `profiles` is passed', () => {
    const withoutOption = schemaSnapshotBlock(datasets);
    const explicitFalse = schemaSnapshotBlock(datasets, { profiles: false });
    expect(explicitFalse).toBe(withoutOption);
    expect(withoutOption).toBe(
      'health_insurance.claims(provider_id int [e.g. 1, 2, 3] -> health_insurance.providers.id, status text [e.g. PAID, DENIED])',
    );
  });

  it('referenceSuffix is unaffected by an unknown/absent cardinality', () => {
    expect(
      referenceSuffix(
        column({
          references: {
            entity: 'health_insurance.providers',
            column: 'id',
            source: 'inferred',
          },
        }),
      ),
    ).toBe(' ~> health_insurance.providers.id');
  });
});

describe('schemaSnapshotBlock with profiles', () => {
  it('appends distinct counts, constant flags and top values when `profiles` is true', () => {
    const entity = {
      key: 'health_insurance.claims',
      columns: [
        column({
          name: 'currency',
          type: 'text',
          profile: profile({
            constant: true,
            distinctCount: 1,
            topValues: [{ value: 'USD', count: 1_200 }],
          }),
        }),
        column({
          name: 'status',
          type: 'text',
          profile: profile({
            distinctCount: 4,
            topValues: [
              { value: 'PAID', count: 1 },
              { value: 'DENIED', count: 1 },
              { value: 'PENDING', count: 1 },
              { value: 'REVERSED', count: 1 },
            ],
          }),
        }),
        column({
          name: 'claim_id',
          type: 'bigint',
          profile: profile({ distinctCount: 50_000 }),
        }),
      ],
    };
    const block = schemaSnapshotBlock([dataset([entity])], { profiles: true });

    expect(block).toContain("currency text {constant 'USD'}");
    expect(block).toContain('status text {4 distinct: PAID, DENIED, PENDING, REVERSED}');
    expect(block).toContain('claim_id bigint {50000 distinct}');
  });

  it('does not append anything for columns without a profile even when `profiles` is true', () => {
    const entity = {
      key: 'health_insurance.claims',
      columns: [column({ name: 'status', type: 'text' })],
    };
    const block = schemaSnapshotBlock([dataset([entity])], { profiles: true });
    expect(block).toBe('health_insurance.claims(status text)');
  });
});

describe('schemaCardBlock knowledge keys', () => {
  it('matches knowledge keyed by schema.table against a catalog.schema.table snapshot', () => {
    const block = schemaCardBlock(
      [
        {
          name: 'Health Insurance',
          tables: ['world_cup.health_insurance.claims'],
          entities: [
            {
              key: 'world_cup.health_insurance.claims',
              columns: [{ name: 'status', type: 'text', nullable: false }],
            },
          ],
        } as never,
      ],
      {
        knowledgeByColumn: new Map([
          [
            'health_insurance.claims.status',
            [{ kind: 'term', title: 'Approved', body: "'approved' means PAID." }],
          ],
          [
            'health_insurance.claims',
            [{ kind: 'default_filter', title: 'Exclude test claims', body: 'is_test = false' }],
          ],
        ]),
      },
    );
    expect(block).toContain('status text — note: "Approved');
    expect(block).toContain('Exclude test claims');
  });
});
