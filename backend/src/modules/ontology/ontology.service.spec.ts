// Same isolation as the sessions specs: the real classes are only injected
// collaborators here, replaced by plain fakes below.
jest.mock('../metrics/metrics.service', () => ({ MetricsService: class {} }));
jest.mock('../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { legacySnippetToOntologyItem } from '../../infrastructure/database/database.module';
import { OntologyService } from './ontology.service';
import type {
  KnowledgeUse,
  OntologyItem,
} from './entities/ontology-item.entity';

const item = (overrides: Partial<OntologyItem> = {}): OntologyItem => ({
  id: 'item-1',
  dataset: 'World Cup',
  kind: 'concept',
  name: 'DNF',
  description: 'Did not finish',
  enabled: true,
  source: 'user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const WORLD_CUP_TABLES = ['wc.core.matches', 'wc.core.teams'];

/** An in-memory repository with the real one's contract (list newest first). */
function fakeRepository(seed: OntologyItem[]) {
  let docs = seed.map((d) => ({ ...d }));
  let clock = 0;
  const stamp = () =>
    new Date(Date.UTC(2030, 0, 1, 0, 0, clock++)).toISOString();
  return {
    docs: () => docs,
    list: jest.fn(() =>
      Promise.resolve(
        [...docs].sort((a, b) =>
          a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
        ),
      ),
    ),
    get: jest.fn((id: string) =>
      Promise.resolve(docs.find((d) => d.id === id) ?? null),
    ),
    insert: jest.fn((doc: OntologyItem) => {
      docs.push(doc);
      return Promise.resolve(doc);
    }),
    replace: jest.fn(
      (id: string, next: Omit<OntologyItem, 'createdAt' | 'updatedAt'>) => {
        const existing = docs.find((d) => d.id === id);
        if (!existing) return Promise.resolve(null);
        const saved: OntologyItem = {
          ...next,
          createdAt: existing.createdAt,
          updatedAt: stamp(),
        };
        docs = docs.map((d) => (d.id === id ? saved : d));
        return Promise.resolve(saved);
      },
    ),
    delete: jest.fn((id: string) => {
      const before = docs.length;
      docs = docs.filter((d) => d.id !== id);
      return Promise.resolve(before - docs.length);
    }),
  };
}

function build(
  docs: OntologyItem[] = [],
  options: {
    datasets?: { name: string; tables: string[] }[];
    metrics?: { id: string; name: string; label: string; entity: string }[];
  } = {},
) {
  const repository = fakeRepository(docs);
  const datasets = options.datasets ?? [
    { name: 'World Cup', tables: WORLD_CUP_TABLES },
    { name: 'Players', tables: ['p.core.players'] },
  ];
  const datasetsRepository = {
    getByNames: jest.fn((names: string[]) =>
      Promise.resolve(datasets.filter((d) => names.includes(d.name))),
    ),
  };
  const metrics = {
    list: jest.fn().mockResolvedValue(
      options.metrics ?? [
        {
          id: 'm-goals',
          name: 'goals_per_match',
          label: 'Goals per match',
          entity: 'wc.core.matches',
        },
      ],
    ),
  };
  const service = new OntologyService(
    repository as never,
    datasetsRepository as never,
    metrics as never,
  );
  return { service, repository, datasetsRepository, metrics };
}

describe('OntologyService.list', () => {
  const library = [
    item({
      id: 'shared',
      dataset: null,
      kind: 'instruction',
      updatedAt: '2024-03-01T00:00:00.000Z',
    }),
    item({
      id: 'mine',
      kind: 'concept',
      source: 'mined',
      enabled: false,
      updatedAt: '2024-02-01T00:00:00.000Z',
    }),
    item({
      id: 'other',
      dataset: 'Players',
      kind: 'constraint',
      predicate: 'x = 1',
      updatedAt: '2024-04-01T00:00:00.000Z',
    }),
  ];

  it("returns the dataset's items plus the shared ones, newest first", async () => {
    const { service } = build(library);

    expect((await service.list('World Cup')).map((i) => i.id)).toEqual([
      'shared',
      'mine',
    ]);
    expect((await service.list('Players')).map((i) => i.id)).toEqual([
      'other',
      'shared',
    ]);
  });

  it('filters by kind, source and enabled', async () => {
    const { service } = build(library);

    const ids = async (query: object) =>
      (await service.list('World Cup', query)).map((i) => i.id);
    expect(await ids({ kind: 'concept' })).toEqual(['mine']);
    expect(await ids({ source: 'mined' })).toEqual(['mine']);
    expect(await ids({ enabled: true })).toEqual(['shared']);
  });

  it('404s an unknown dataset', async () => {
    const { service } = build(library);

    await expect(service.list('Nope')).rejects.toThrow(
      new NotFoundException('Dataset "Nope" not found'),
    );
  });
});

describe('OntologyService.create', () => {
  it('stores a trimmed concept in the dataset, enabled by default, source user', async () => {
    const { service, repository } = build();

    const saved = await service.create('World Cup', {
      kind: 'concept',
      name: '  DNF  ',
      description: '  Did not finish  ',
      synonyms: [' dns ', '', 3],
      mappings: [
        { entity: ' wc.core.matches ', column: ' status ', expression: '' },
      ],
    });

    expect(saved).toMatchObject({
      dataset: 'World Cup',
      kind: 'concept',
      name: 'DNF',
      description: 'Did not finish',
      synonyms: ['dns'],
      mappings: [{ entity: 'wc.core.matches', column: 'status' }],
      enabled: true,
      source: 'user',
    });
    expect(saved.id).toEqual(expect.any(String));
    expect(repository.insert).toHaveBeenCalledTimes(1);
  });

  it('shares an item with every dataset, accepting any entity, and keeps an explicit enabled: false', async () => {
    const { service } = build();

    const saved = await service.create('World Cup', {
      kind: 'concept',
      name: 'Team',
      description: 'A national side',
      mappings: [{ entity: 'anywhere.else.teams' }],
      shared: true,
      enabled: false,
    });

    expect(saved).toMatchObject({ dataset: null, enabled: false });
  });

  it('drops the fields that do not belong to the kind', async () => {
    const { service } = build();

    const saved = await service.create('World Cup', {
      kind: 'instruction',
      name: 'Coverage',
      description: '2018 and 2022 only',
      entities: ['wc.core.matches', ' '],
      synonyms: ['x'],
      mappings: [{ entity: 'wc.core.matches' }],
      predicate: 'a = 1',
      from: 'c1',
      type: 'is-a',
      metricId: 'm-goals',
    });

    expect(Object.keys(saved).sort()).toEqual(
      [
        'id',
        'dataset',
        'kind',
        'name',
        'description',
        'enabled',
        'source',
        'entities',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
    expect(saved).toMatchObject({
      dataset: 'World Cup',
      kind: 'instruction',
      name: 'Coverage',
      description: '2018 and 2022 only',
      enabled: true,
      source: 'user',
      entities: ['wc.core.matches'],
    });
  });

  it('stores a constraint with an optional description and concept', async () => {
    const { service } = build([item({ id: 'c-match' })]);

    const saved = await service.create('World Cup', {
      kind: 'constraint',
      name: 'Finals only',
      predicate: " stage = 'final' ",
      conceptId: 'c-match',
      synonyms: ['dropped'],
    });

    expect(saved).toMatchObject({
      kind: 'constraint',
      description: '',
      predicate: "stage = 'final'",
      conceptId: 'c-match',
    });
    expect(saved).not.toHaveProperty('synonyms');
  });

  it('stores a relation between concepts, named after its endpoints when no name is given', async () => {
    const { service } = build([
      item({ id: 'c-match', name: 'Match' }),
      item({ id: 'c-goal', name: 'Goal', dataset: null }),
    ]);

    const saved = await service.create('World Cup', {
      kind: 'relation',
      from: 'c-match',
      type: 'has-many',
      to: 'c-goal',
      metricId: 'm-goals',
    });

    expect(saved).toMatchObject({
      kind: 'relation',
      name: 'Match has-many Goal',
      description: '',
      from: 'c-match',
      type: 'has-many',
      to: 'c-goal',
    });
    expect(saved).not.toHaveProperty('metricId');
  });

  it('stores a measured-by relation with a metric and no `to`', async () => {
    const { service } = build([item({ id: 'c-match', name: 'Match' })]);

    const saved = await service.create('World Cup', {
      kind: 'relation',
      from: 'c-match',
      type: 'measured-by',
      to: 'c-match',
      metricId: 'm-goals',
    });

    expect(saved).toMatchObject({
      name: 'Match measured-by Goals per match',
      metricId: 'm-goals',
    });
    expect(saved).not.toHaveProperty('to');
  });

  const concepts = [
    item({ id: 'c-match', name: 'Match' }),
    item({ id: 'c-player', name: 'Player', dataset: 'Players' }),
    item({ id: 'i-rule', kind: 'instruction', name: 'Rule' }),
  ];

  it.each<[string, Record<string, unknown>, string]>([
    [
      'an unknown kind',
      { kind: 'term', name: 'x', description: 'y' },
      'kind must be one of: concept, relation, constraint, instruction',
    ],
    [
      'a missing name',
      { kind: 'concept', name: '  ', description: 'y' },
      'name is required',
    ],
    [
      'a concept without description',
      { kind: 'concept', name: 'x' },
      'description is required',
    ],
    [
      'an instruction without description',
      { kind: 'instruction', name: 'x', description: ' ' },
      'description is required',
    ],
    [
      'a constraint without predicate',
      { kind: 'constraint', name: 'x' },
      'predicate is required',
    ],
    [
      'a mapping without entity',
      {
        kind: 'concept',
        name: 'x',
        description: 'y',
        mappings: [{ column: 'c' }],
      },
      'each mapping needs an entity',
    ],
    [
      'a mapping to an entity outside the dataset',
      {
        kind: 'concept',
        name: 'x',
        description: 'y',
        mappings: [{ entity: 'p.core.players' }],
      },
      'Entity "p.core.players" is not in dataset "World Cup"',
    ],
    [
      'a relation without from',
      { kind: 'relation', type: 'is-a', to: 'c-match' },
      'from is required',
    ],
    [
      'a relation of an unknown type',
      { kind: 'relation', from: 'c-match', type: 'owns', to: 'c-match' },
      'type must be one of: is-a, part-of, has-many, related-to, measured-by',
    ],
    [
      'a relation without to',
      { kind: 'relation', from: 'c-match', type: 'is-a' },
      'to is required',
    ],
    [
      'a measured-by relation without metric',
      { kind: 'relation', from: 'c-match', type: 'measured-by' },
      'metricId is required for measured-by',
    ],
    [
      'a relation from a concept of another dataset',
      { kind: 'relation', from: 'c-player', type: 'is-a', to: 'c-match' },
      'Concept "c-player" is not in this ontology',
    ],
    [
      'a relation to an item that is not a concept',
      { kind: 'relation', from: 'c-match', type: 'is-a', to: 'i-rule' },
      'Concept "i-rule" is not in this ontology',
    ],
    [
      'a relation to an unknown id',
      { kind: 'relation', from: 'c-match', type: 'is-a', to: 'ghost' },
      'Concept "ghost" is not in this ontology',
    ],
    [
      'an unknown metric',
      {
        kind: 'relation',
        from: 'c-match',
        type: 'measured-by',
        metricId: 'm-ghost',
      },
      'Metric "m-ghost" not found',
    ],
  ])('rejects %s', async (_case, input, message) => {
    const { service, repository } = build(concepts);

    await expect(service.create('World Cup', input)).rejects.toThrow(
      new BadRequestException(message),
    );
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('only lets a shared relation link shared concepts', async () => {
    const { service } = build(concepts);

    await expect(
      service.create('World Cup', {
        kind: 'relation',
        from: 'c-match',
        type: 'is-a',
        to: 'c-match',
        shared: true,
      }),
    ).rejects.toThrow('Concept "c-match" is not in this ontology');
  });

  it('404s an unknown dataset', async () => {
    const { service } = build();

    await expect(
      service.create('Nope', {
        kind: 'instruction',
        name: 'x',
        description: 'y',
      }),
    ).rejects.toThrow(new NotFoundException('Dataset "Nope" not found'));
  });
});

describe('OntologyService.update', () => {
  it('applies only the fields present and restamps updatedAt', async () => {
    const { service } = build([
      item({ synonyms: ['dns'], mappings: [{ entity: 'wc.core.matches' }] }),
    ]);

    const saved = await service.update('item-1', { enabled: false });

    expect(saved).toMatchObject({
      name: 'DNF',
      description: 'Did not finish',
      synonyms: ['dns'],
      mappings: [{ entity: 'wc.core.matches' }],
      enabled: false,
      createdAt: '2024-01-01T00:00:00.000Z',
    });
    expect(saved.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
  });

  it('clears a list when it is set to an empty array', async () => {
    const { service } = build([item({ synonyms: ['dns'] })]);

    const saved = await service.update('item-1', { synonyms: [] });

    expect(saved).not.toHaveProperty('synonyms');
  });

  it('drops fields of another kind sent on the patch', async () => {
    const { service } = build([
      item({ id: 'i', kind: 'instruction', name: 'Rule', description: 'Do' }),
    ]);

    const saved = await service.update('i', {
      predicate: 'x = 1',
      synonyms: ['a'],
      entities: ['wc.core.matches'],
    });

    expect(saved).not.toHaveProperty('predicate');
    expect(saved).not.toHaveProperty('synonyms');
    expect(saved.entities).toEqual(['wc.core.matches']);
  });

  it('accepts the same kind and rejects a different one', async () => {
    const { service } = build([item()]);

    await expect(
      service.update('item-1', { kind: 'concept', name: 'Retired' }),
    ).resolves.toMatchObject({ kind: 'concept', name: 'Retired' });
    await expect(
      service.update('item-1', { kind: 'instruction' }),
    ).rejects.toThrow(new BadRequestException('kind cannot be changed'));
    await expect(service.update('item-1', { kind: 'bogus' })).rejects.toThrow(
      'kind must be one of: concept, relation, constraint, instruction',
    );
  });

  it.each<[string, OntologyItem, Record<string, unknown>, string]>([
    ['an empty name', item(), { name: ' ' }, 'name must not be empty'],
    [
      'an empty concept description',
      item(),
      { description: '' },
      'description must not be empty',
    ],
    [
      'an empty instruction description',
      item({ kind: 'instruction' }),
      { description: ' ' },
      'description must not be empty',
    ],
    [
      'an empty predicate',
      item({ kind: 'constraint', predicate: 'a = 1' }),
      { predicate: '' },
      'predicate must not be empty',
    ],
    [
      'a mapping outside the dataset',
      item(),
      { mappings: [{ entity: 'x.y.z' }] },
      'Entity "x.y.z" is not in dataset "World Cup"',
    ],
    [
      'a switch to measured-by without a metric',
      item({
        kind: 'relation',
        name: 'r',
        from: 'item-1',
        type: 'is-a',
        to: 'item-1',
      }),
      { type: 'measured-by' },
      'metricId is required for measured-by',
    ],
  ])('rejects %s', async (_case, stored, patch, message) => {
    const { service } = build([item({ id: 'item-1' }), { ...stored, id: 'x' }]);

    await expect(service.update('x', patch)).rejects.toThrow(
      new BadRequestException(message),
    );
  });

  it('lets a constraint keep an empty description', async () => {
    const { service } = build([
      item({ kind: 'constraint', predicate: 'a = 1', description: 'when x' }),
    ]);

    await expect(
      service.update('item-1', { description: '' }),
    ).resolves.toMatchObject({ description: '', predicate: 'a = 1' });
  });

  it('switching a relation to measured-by drops `to` and renames it', async () => {
    const { service } = build([
      item({ id: 'c-match', name: 'Match' }),
      item({
        id: 'r',
        kind: 'relation',
        name: 'Match is-a Match',
        description: '',
        from: 'c-match',
        type: 'is-a',
        to: 'c-match',
      }),
    ]);

    const saved = await service.update('r', {
      type: 'measured-by',
      metricId: 'm-goals',
    });

    expect(saved).toMatchObject({
      type: 'measured-by',
      metricId: 'm-goals',
      name: 'Match measured-by Goals per match',
    });
    expect(saved).not.toHaveProperty('to');
  });

  it('does not re-check a stored reference when only toggling', async () => {
    // The mapping's table has since left the dataset.
    const { service } = build([
      item({ mappings: [{ entity: 'gone.from.dataset' }] }),
    ]);

    await expect(
      service.update('item-1', { enabled: false }),
    ).resolves.toMatchObject({ enabled: false });
  });

  it('404s an unknown id', async () => {
    const { service } = build();

    await expect(service.update('missing', { enabled: false })).rejects.toThrow(
      new NotFoundException('Ontology item missing not found'),
    );
  });
});

describe('OntologyService.delete', () => {
  it('returns the removed item', async () => {
    const { service, repository } = build([
      item({ id: 'i', kind: 'instruction' }),
    ]);

    await expect(service.delete('i')).resolves.toMatchObject({ id: 'i' });
    expect(repository.docs()).toEqual([]);
  });

  it("deleting a concept deletes its relations and clears constraints' conceptId", async () => {
    const { service, repository } = build([
      item({ id: 'c-match', name: 'Match' }),
      item({ id: 'c-goal', name: 'Goal' }),
      item({ id: 'c-team', name: 'Team' }),
      item({
        id: 'r-from',
        kind: 'relation',
        from: 'c-match',
        type: 'has-many',
        to: 'c-goal',
      }),
      item({
        id: 'r-to',
        kind: 'relation',
        from: 'c-team',
        type: 'related-to',
        to: 'c-match',
      }),
      item({
        id: 'r-other',
        kind: 'relation',
        from: 'c-team',
        type: 'has-many',
        to: 'c-goal',
      }),
      item({
        id: 'k',
        kind: 'constraint',
        predicate: 'a = 1',
        conceptId: 'c-match',
      }),
    ]);

    await service.delete('c-match');

    const docs = repository.docs();
    expect(docs.map((d) => d.id).sort()).toEqual(
      ['c-goal', 'c-team', 'k', 'r-other'].sort(),
    );
    const constraint = docs.find((d) => d.id === 'k');
    expect(constraint).not.toHaveProperty('conceptId');
    expect(constraint).toMatchObject({ predicate: 'a = 1' });
  });

  it('404s an unknown id', async () => {
    const { service } = build();

    await expect(service.delete('missing')).rejects.toThrow(
      new NotFoundException('Ontology item missing not found'),
    );
  });
});

describe('OntologyService.definitionBlock', () => {
  it('is empty when nothing is enabled or nothing exists', async () => {
    await expect(
      build([item({ enabled: false })]).service.definitionBlock(['World Cup']),
    ).resolves.toBe('');
    await expect(build([]).service.definitionBlock([])).resolves.toBe('');
  });

  it("includes shared items always and a dataset's items only when it is in the session", async () => {
    const { service } = build([
      item({ id: 'shared', dataset: null, name: 'Shared rule' }),
      item({ id: 'scoped', name: 'Scoped rule' }),
      item({ id: 'off', dataset: null, name: 'Disabled rule', enabled: false }),
    ]);

    const inScope = await service.definitionBlock(['World Cup']);
    expect(inScope).toContain('Shared rule');
    expect(inScope).toContain('Scoped rule');
    expect(inScope).not.toContain('Disabled rule');

    const outOfScope = await service.definitionBlock(['Other']);
    expect(outOfScope).toContain('Shared rule');
    expect(outOfScope).not.toContain('Scoped rule');
  });

  it('orders dataset items before shared ones, newest first within each', async () => {
    const { service } = build([
      item({
        id: 'shared',
        dataset: null,
        name: 'Shared rule',
        updatedAt: '2024-06-01T00:00:00.000Z',
      }),
      item({
        id: 'old',
        name: 'Older rule',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
      item({
        id: 'new',
        name: 'Newer rule',
        updatedAt: '2024-02-01T00:00:00.000Z',
      }),
    ]);

    const block = await service.definitionBlock(['World Cup']);

    expect(block.indexOf('Newer rule')).toBeLessThan(
      block.indexOf('Older rule'),
    );
    expect(block.indexOf('Older rule')).toBeLessThan(
      block.indexOf('Shared rule'),
    );
  });

  it('renders one line per kind', async () => {
    const { service } = build([
      item({
        id: 'c-match',
        name: 'Match',
        description: 'One game',
        synonyms: ['game', 'fixture'],
        mappings: [
          { entity: 'wc.core.matches', column: 'match_id' },
          { entity: 'wc.core.matches', expression: 'COUNT(*)' },
          {
            entity: 'wc.core.teams',
            column: 'team_id',
            expression: 'DISTINCT team_id',
          },
          { entity: 'wc.core.teams' },
        ],
        updatedAt: '2024-01-07T00:00:00.000Z',
      }),
      item({
        id: 'c-goal',
        name: 'Goal',
        description: 'A score',
        updatedAt: '2024-01-06T00:00:00.000Z',
      }),
      item({
        id: 'k',
        kind: 'constraint',
        name: 'Finals',
        description: 'questions about finals',
        predicate: "stage = 'final'",
        entities: ['wc.core.matches'],
        updatedAt: '2024-01-05T00:00:00.000Z',
      }),
      item({
        id: 'i',
        kind: 'instruction',
        name: 'Coverage',
        description: '2018 and 2022 only',
        entities: ['wc.core.matches'],
        updatedAt: '2024-01-04T00:00:00.000Z',
      }),
      item({
        id: 'r1',
        kind: 'relation',
        name: 'r1',
        description: 'via match_id',
        from: 'c-match',
        type: 'has-many',
        to: 'c-goal',
        updatedAt: '2024-01-03T00:00:00.000Z',
      }),
      item({
        id: 'r2',
        kind: 'relation',
        name: 'r2',
        description: '',
        from: 'c-match',
        type: 'measured-by',
        metricId: 'm-goals',
        updatedAt: '2024-01-02T00:00:00.000Z',
      }),
      item({
        id: 'r-dangling',
        kind: 'relation',
        name: 'r3',
        from: 'c-match',
        type: 'is-a',
        to: 'c-gone',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    ]);

    const { block, used } = await service.contextFor(['World Cup']);

    expect(block.split('\n')).toEqual([
      'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):',
      '- [term] Match: One game; synonyms: game, fixture; entities: wc.core.matches, wc.core.teams; maps to: wc.core.matches.match_id, COUNT(*), DISTINCT team_id (wc.core.teams.team_id)',
      '- [term] Goal: A score',
      "- [default_filter] Finals: stage = 'final'; when: questions about finals; entities: wc.core.matches",
      '- [instruction] Coverage: 2018 and 2022 only; entities: wc.core.matches',
      '- [relation] Match has-many Goal: via match_id',
      '- [relation] Match measured-by Goals per match',
    ]);
    expect(used.map((u) => [u.kind, u.title, u.body])).toEqual([
      ['term', 'Match', 'One game'],
      ['term', 'Goal', 'A score'],
      ['default_filter', 'Finals', "stage = 'final'"],
      ['instruction', 'Coverage', '2018 and 2022 only'],
      ['relation', 'r1', 'Match has-many Goal'],
      ['relation', 'r2', 'Match measured-by Goals per match'],
    ]);
  });

  it('stops at the first line that does not fit the 2,000-character budget', async () => {
    const many = Array.from({ length: 100 }, (_, n) =>
      item({
        id: `s${n}`,
        dataset: null,
        name: `Term ${n}`,
        description: 'x'.repeat(200),
      }),
    );
    const { service } = build(many);

    const { block, used } = await service.contextFor([]);

    const header = block.split('\n')[0];
    expect(block.length - header.length).toBeLessThanOrEqual(
      2_000 + used.length,
    );
    expect(used.length).toBeLessThan(many.length);
    for (const entry of used) expect(block).toContain(entry.title);
  });
});

describe('OntologyService.contextFor', () => {
  it('records id, kind, title, body and dataset of each item in the block', async () => {
    const { service } = build([
      item({
        id: 'k1',
        name: 'DNF',
        description: 'Did not finish',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
      item({
        id: 'k2',
        kind: 'instruction',
        dataset: null,
        name: 'Coverage',
        description: '2018 and 2022 only',
        updatedAt: '2024-06-01T00:00:00.000Z',
      }),
    ]);

    const { block, used } = await service.contextFor(['World Cup']);

    expect(used).toEqual<KnowledgeUse[]>([
      {
        id: 'k1',
        kind: 'term',
        title: 'DNF',
        body: 'Did not finish',
        datasetId: 'World Cup',
      },
      {
        id: 'k2',
        kind: 'instruction',
        title: 'Coverage',
        body: '2018 and 2022 only',
      },
    ]);
    expect(block.indexOf('DNF')).toBeLessThan(block.indexOf('Coverage'));
  });

  it('records nothing when no item applies', async () => {
    const { service } = build([item({ enabled: false })]);

    await expect(service.contextFor(['World Cup'])).resolves.toEqual({
      block: '',
      used: [],
    });
  });

  it('reads metrics only when a measured-by relation is in scope', async () => {
    const { service, metrics } = build([item()]);

    await service.contextFor(['World Cup']);

    expect(metrics.list).not.toHaveBeenCalled();
  });
});

/**
 * Context equality across the migration: the old `KnowledgeService`
 * (`git show 8bd60c3:backend/src/modules/knowledge/knowledge.service.ts`)
 * and the new `OntologyService`, fed the same library (old shape, then
 * through M15's mapping), must hand the model the same block and record the
 * same `used`.
 */
describe('context equality with the old KnowledgeService after M15', () => {
  interface OldSnippet {
    id: string;
    kind: 'instruction' | 'term' | 'default_filter';
    scope: { datasetId?: string; datasourceId?: string } | null;
    title: string;
    body: string;
    synonyms?: string[];
    entities?: string[];
    enabled: boolean;
    source: 'user' | 'mined';
    ownerId?: string;
    createdAt: string;
    updatedAt: string;
  }

  const old = (
    o: Partial<OldSnippet> & Pick<OldSnippet, 'id'>,
  ): OldSnippet => ({
    kind: 'term',
    scope: null,
    title: 'T',
    body: 'B',
    enabled: true,
    source: 'user',
    ownerId: 'local',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...o,
  });

  /** The old `KnowledgeService.contextFor`, verbatim apart from typing. */
  function oldContextFor(all: OldSnippet[], datasetIds: string[]) {
    const sorted = [...all].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
    );
    const scope = new Set(datasetIds);
    const applicable = sorted.filter(
      (s) =>
        s.enabled &&
        (s.scope == null ||
          (s.scope.datasetId !== undefined && scope.has(s.scope.datasetId))),
    );
    if (!applicable.length) return { block: '', used: [] };
    const rank = (s: OldSnippet) => (s.scope?.datasetId ? 0 : 1);
    const ordered = [...applicable].sort((a, b) => rank(a) - rank(b));
    const lines = [
      'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):',
    ];
    const used: KnowledgeUse[] = [];
    let budget = 2_000;
    for (const s of ordered) {
      const synonyms = s.synonyms?.length
        ? `; synonyms: ${s.synonyms.join(', ')}`
        : '';
      const entities = s.entities?.length
        ? `; entities: ${s.entities.join(', ')}`
        : '';
      const entry = `- [${s.kind}] ${s.title}: ${s.body}${synonyms}${entities}`;
      if (entry.length > budget) break;
      budget -= entry.length;
      lines.push(entry);
      used.push({
        id: s.id,
        kind: s.kind,
        title: s.title,
        body: s.body,
        ...(s.scope?.datasetId ? { datasetId: s.scope.datasetId } : {}),
      });
    }
    return used.length
      ? { block: lines.join('\n'), used }
      : { block: '', used: [] };
  }

  const library: OldSnippet[] = [
    old({
      id: 'term-scoped',
      kind: 'term',
      scope: { datasetId: 'World Cup' },
      title: 'Host',
      body: 'the country that staged the tournament',
      synonyms: ['organiser', 'host nation'],
      entities: ['wc.core.tournaments', 'wc.core.matches'],
      updatedAt: '2024-05-01T00:00:00.000Z',
    }),
    old({
      id: 'filter-scoped',
      kind: 'default_filter',
      scope: { datasetId: 'World Cup' },
      title: 'Men only',
      body: "tournament_type = 'men'",
      entities: ['wc.core.tournaments'],
      updatedAt: '2024-04-01T00:00:00.000Z',
    }),
    old({
      id: 'instruction-global',
      kind: 'instruction',
      scope: null,
      title: 'Coverage',
      body: '2018 and 2022 only',
      updatedAt: '2024-06-01T00:00:00.000Z',
    }),
    old({
      id: 'term-global',
      kind: 'term',
      scope: null,
      title: 'DNF',
      body: 'Did not finish',
      updatedAt: '2024-03-01T00:00:00.000Z',
    }),
    old({
      id: 'filter-global',
      kind: 'default_filter',
      scope: null,
      title: 'No tests',
      body: 'is_test = false',
      updatedAt: '2024-02-01T00:00:00.000Z',
    }),
    old({
      id: 'disabled',
      kind: 'instruction',
      scope: { datasetId: 'World Cup' },
      title: 'Off',
      body: 'never shown',
      enabled: false,
      updatedAt: '2024-07-01T00:00:00.000Z',
    }),
    old({
      id: 'other-dataset',
      kind: 'term',
      scope: { datasetId: 'Players' },
      title: 'Cap',
      body: 'an international appearance',
      updatedAt: '2024-08-01T00:00:00.000Z',
    }),
    old({
      id: 'datasource-only',
      kind: 'instruction',
      scope: { datasourceId: 'ds-1' },
      title: 'Datasource rule',
      body: 'never shown either',
      updatedAt: '2024-09-01T00:00:00.000Z',
    }),
  ];

  const migrated = () =>
    library.map(
      (s) =>
        legacySnippetToOntologyItem(
          s as unknown as Record<string, unknown>,
        ) as unknown as OntologyItem,
    );

  it.each([[['World Cup']], [['Players']], [['World Cup', 'Players']], [[]]])(
    'matches the old block and used for datasets %j',
    async (datasets) => {
      const { service } = build(migrated());

      await expect(service.contextFor(datasets)).resolves.toEqual(
        oldContextFor(library, datasets),
      );
    },
  );

  it('produces the exact strings the old service produced', async () => {
    const { service } = build(migrated());

    const { block, used } = await service.contextFor(['World Cup']);

    expect(block).toBe(
      [
        'Curated dataset knowledge (user-authored — treat as authoritative over anything you infer from schema):',
        '- [term] Host: the country that staged the tournament; synonyms: organiser, host nation; entities: wc.core.tournaments, wc.core.matches',
        "- [default_filter] Men only: tournament_type = 'men'; entities: wc.core.tournaments",
        '- [instruction] Coverage: 2018 and 2022 only',
        '- [term] DNF: Did not finish',
        '- [default_filter] No tests: is_test = false',
      ].join('\n'),
    );
    expect(used).toEqual([
      {
        id: 'term-scoped',
        kind: 'term',
        title: 'Host',
        body: 'the country that staged the tournament',
        datasetId: 'World Cup',
      },
      {
        id: 'filter-scoped',
        kind: 'default_filter',
        title: 'Men only',
        body: "tournament_type = 'men'",
        datasetId: 'World Cup',
      },
      {
        id: 'instruction-global',
        kind: 'instruction',
        title: 'Coverage',
        body: '2018 and 2022 only',
      },
      {
        id: 'term-global',
        kind: 'term',
        title: 'DNF',
        body: 'Did not finish',
      },
      {
        id: 'filter-global',
        kind: 'default_filter',
        title: 'No tests',
        body: 'is_test = false',
      },
    ]);
  });

  it('matches the old budget cut-off', async () => {
    const big = Array.from({ length: 40 }, (_, n) =>
      old({
        id: `b${n}`,
        title: `Term ${n}`,
        body: 'y'.repeat(90 + n),
        updatedAt: new Date(Date.UTC(2024, 0, 1 + n)).toISOString(),
      }),
    );
    const mapped = big.map(
      (s) =>
        legacySnippetToOntologyItem(
          s as unknown as Record<string, unknown>,
        ) as unknown as OntologyItem,
    );
    const { service } = build(mapped);

    await expect(service.contextFor([])).resolves.toEqual(
      oldContextFor(big, []),
    );
  });
});
