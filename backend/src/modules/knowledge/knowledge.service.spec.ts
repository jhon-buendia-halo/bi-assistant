// `mastra.service.ts` pulls in `mastra/index.ts` (every registered agent,
// including `@mastra/core/agent`'s ESM-only transitive deps) at module
// scope; `knowledge-bootstrap.agent.ts` does the same directly for its own
// `Agent` import. Both are mocked out, same pattern as
// `sessions.service.spec.ts`, so this suite stays on Jest's CommonJS
// transform without needing the real Mastra runtime.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
// `datasources.service.ts` pulls in the Databricks connector, whose
// `@databricks/sql` -> `thrift` chain has the same ESM-under-Jest problem —
// mocked out for the same reason, same pattern as `sessions.service.spec.ts`.
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../datasets/repositories/datasets.repository', () => ({
  DatasetsRepository: class {},
}));
jest.mock('../../mastra/agents/knowledge-bootstrap.agent', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof import('zod');
  const knowledgeBootstrapOutputSchema = z.object({
    drafts: z.array(
      z.object({
        kind: z.enum(['instruction', 'term', 'default_filter']),
        title: z.string(),
        body: z.string(),
        synonyms: z.array(z.string()).optional(),
        entities: z.array(z.string()).optional(),
      }),
    ),
  });
  return { knowledgeBootstrapOutputSchema, MAX_BOOTSTRAP_DRAFTS: 15 };
});

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { matchesFilter } from '../../infrastructure/database/doc-store';
import type { DocFilter } from '../../infrastructure/database/doc-store';
import { KnowledgeService } from './knowledge.service';
import type {
  KnowledgeSnippet,
  LessonProvenance,
} from './entities/knowledge-snippet.entity';

const snippet = (
  overrides: Partial<KnowledgeSnippet> = {},
): KnowledgeSnippet => ({
  id: 'snippet-1',
  kind: 'term',
  scope: null,
  title: 'DNF',
  body: 'Did not finish',
  enabled: true,
  source: 'user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const provenanceFor = (feedbackId: string): LessonProvenance => ({
  feedbackId,
  sessionId: 'session-1',
  messageAt: '2026-09-30T00:00:00.000Z',
  block: 'sql',
  question: 'What was our net revenue in fiscal year 2025?',
  comment: 'Our fiscal year runs 1 Feb to 31 Jan.',
  vote: 'down',
  learnedAt: '2026-09-30T00:05:00.000Z',
  method: 'agent',
});

function build(
  docs: KnowledgeSnippet[] = [],
  options: {
    datasets?: {
      name: string;
      datasourceId?: string;
      datasourceKind?: string;
      tables: string[];
      entities?: unknown[];
    }[];
    defaultDatasource?: { id: string; kind: string };
    sampleRows?: { columns: string[]; rows: Record<string, unknown>[] };
    generate?: jest.Mock;
  } = {},
) {
  const repository = {
    list: jest.fn().mockResolvedValue(docs),
    get: jest
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(docs.find((d) => d.id === id) ?? null),
      ),
    insert: jest.fn().mockImplementation((doc: KnowledgeSnippet) => doc),
    update: jest
      .fn()
      .mockImplementation((id: string, patch: Partial<KnowledgeSnippet>) => {
        const existing = docs.find((d) => d.id === id);
        return Promise.resolve(existing ? { ...existing, ...patch } : null);
      }),
    delete: jest.fn().mockResolvedValue(1),
    // Real `matchesFilter` (not a stub) so `deleteLearnedFor`'s dotted-path
    // filter is exercised the same way the sqlite adapter would evaluate it,
    // and mutates the shared `docs` array so a subsequent `list()` reflects it.
    deleteMany: jest.fn().mockImplementation((filter: DocFilter) => {
      const matches = docs.filter((d) =>
        matchesFilter(d as unknown as Record<string, unknown>, filter),
      );
      for (const match of matches) {
        const idx = docs.indexOf(match);
        if (idx >= 0) docs.splice(idx, 1);
      }
      return Promise.resolve(matches.length);
    }),
  };
  const datasetsRepository = {
    getByNames: jest.fn().mockResolvedValue(options.datasets ?? []),
  };
  const datasourcesService = {
    defaultDatasource: jest.fn().mockResolvedValue(options.defaultDatasource),
    sampleRows: jest
      .fn()
      .mockResolvedValue(options.sampleRows ?? { columns: [], rows: [] }),
  };
  const mastra = {
    getAgent: jest.fn().mockReturnValue({ generate: options.generate }),
  };
  const service = new KnowledgeService(
    repository as never,
    datasetsRepository as never,
    datasourcesService as never,
    mastra as never,
  );
  return {
    service,
    repository,
    datasetsRepository,
    datasourcesService,
    mastra,
  };
}

describe('KnowledgeService.list', () => {
  const library = [
    snippet({ id: 'global', scope: null, kind: 'instruction' }),
    snippet({
      id: 'scoped',
      scope: { datasetId: 'World Cup' },
      kind: 'term',
      source: 'mined',
      enabled: false,
    }),
    snippet({
      id: 'other-scope',
      scope: { datasetId: 'Players' },
      kind: 'default_filter',
    }),
  ];

  it('returns everything with no filters', async () => {
    const { service } = build(library);

    expect((await service.list()).map((s) => s.id)).toEqual([
      'global',
      'scoped',
      'other-scope',
    ]);
  });

  it('scopes to a dataset plus global snippets', async () => {
    const { service } = build(library);

    const result = await service.list({ datasetId: 'World Cup' });

    expect(result.map((s) => s.id)).toEqual(['global', 'scoped']);
  });

  it('filters by kind, source and enabled', async () => {
    const { service } = build(library);

    expect((await service.list({ kind: 'term' })).map((s) => s.id)).toEqual([
      'scoped',
    ]);
    expect((await service.list({ source: 'mined' })).map((s) => s.id)).toEqual([
      'scoped',
    ]);
    expect((await service.list({ enabled: false })).map((s) => s.id)).toEqual([
      'scoped',
    ]);
  });
});

describe('KnowledgeService.create', () => {
  it('normalizes and stores a valid snippet, defaulting enabled to true', async () => {
    const { service, repository } = build();

    const saved = await service.create({
      kind: 'term',
      title: '  DNF  ',
      body: '  Did not finish  ',
      synonyms: [' dns ', ''],
      entities: [' world_cup.matches '],
    });

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'term',
        title: 'DNF',
        body: 'Did not finish',
        synonyms: ['dns'],
        entities: ['world_cup.matches'],
        scope: null,
        enabled: true,
        source: 'user',
      }),
    );
    expect(saved.id).toEqual(expect.any(String));
  });

  it('respects an explicit enabled: false and a dataset scope', async () => {
    const { service, repository } = build();

    await service.create({
      kind: 'default_filter',
      title: 'Exclude test rows',
      body: 'WHERE is_test = false',
      scope: { datasetId: 'World Cup' },
      enabled: false,
    });

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { datasetId: 'World Cup' },
        enabled: false,
      }),
    );
  });

  it.each([
    ['kind', { kind: 'bogus' }, /kind must be one of/],
    ['title', { title: '  ' }, /title is required/],
    ['body', { body: '  ' }, /body is required/],
  ])('rejects an invalid %s', async (_case, overrides, expected) => {
    const { service, repository } = build();

    await expect(
      service.create({
        kind: 'term',
        title: 'DNF',
        body: 'Did not finish',
        ...(overrides as object),
      } as never),
    ).rejects.toThrow(expected);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('stores a column when exactly one entity is given', async () => {
    const { service, repository } = build();

    await service.create({
      kind: 'term',
      title: 'Status',
      body: 'Claim status',
      entities: ['world_cup.health_insurance.claims'],
      column: 'status',
    });

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({ column: 'status' }),
    );
  });

  it('rejects a column with zero or more than one entity', async () => {
    const { service } = build();

    await expect(
      service.create({
        kind: 'term',
        title: 'Status',
        body: 'Claim status',
        column: 'status',
      }),
    ).rejects.toThrow(/exactly one entity/);

    await expect(
      service.create({
        kind: 'term',
        title: 'Status',
        body: 'Claim status',
        entities: ['a.claims', 'b.claims'],
        column: 'status',
      }),
    ).rejects.toThrow(/exactly one entity/);
  });

  it('rejects an empty or over-long column', async () => {
    const { service } = build();

    await expect(
      service.create({
        kind: 'term',
        title: 'Status',
        body: 'Claim status',
        entities: ['a.claims'],
        column: '   ',
      }),
    ).rejects.toThrow(/column must not be empty/);

    await expect(
      service.create({
        kind: 'term',
        title: 'Status',
        body: 'Claim status',
        entities: ['a.claims'],
        column: 'x'.repeat(129),
      }),
    ).rejects.toThrow(/128 characters or fewer/);
  });
});

describe('KnowledgeService.update', () => {
  it('applies only the fields present, leaving the rest untouched', async () => {
    const { service, repository } = build([snippet({ enabled: true })]);

    await service.update('snippet-1', { enabled: false });

    expect(repository.update).toHaveBeenCalledWith('snippet-1', {
      enabled: false,
    });
  });

  it('clears synonyms/entities when explicitly set to an empty array', async () => {
    const { service, repository } = build([
      snippet({ synonyms: ['dns'], entities: ['a.b.c'] }),
    ]);

    await service.update('snippet-1', { synonyms: [], entities: [] });

    expect(repository.update).toHaveBeenCalledWith('snippet-1', {
      synonyms: [],
      entities: [],
    });
  });

  it('rejects an empty title/body when explicitly provided', async () => {
    const { service } = build([snippet()]);

    await expect(service.update('snippet-1', { title: '  ' })).rejects.toThrow(
      /title must not be empty/,
    );
  });

  it('throws NotFoundException for an unknown id', async () => {
    const { service } = build();

    await expect(service.update('missing', { enabled: false })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('accepts a column when the existing snippet already names exactly one entity', async () => {
    const { service, repository } = build([
      snippet({ entities: ['a.claims'] }),
    ]);

    await service.update('snippet-1', { column: 'status' });

    expect(repository.update).toHaveBeenCalledWith('snippet-1', {
      column: 'status',
    });
  });

  it('rejects a column when the existing snippet has no single entity', async () => {
    const { service } = build([snippet({ entities: undefined })]);

    await expect(
      service.update('snippet-1', { column: 'status' }),
    ).rejects.toThrow(/exactly one entity/);
  });

  it('rejects a column paired in the same patch with more than one entity', async () => {
    const { service } = build([snippet({ entities: ['a.claims'] })]);

    await expect(
      service.update('snippet-1', {
        entities: ['a.claims', 'b.claims'],
        column: 'status',
      }),
    ).rejects.toThrow(/exactly one entity/);
  });

  it('accepts a column paired in the same patch with exactly one entity', async () => {
    const { service, repository } = build([snippet({ entities: undefined })]);

    await service.update('snippet-1', {
      entities: ['a.claims'],
      column: 'status',
    });

    expect(repository.update).toHaveBeenCalledWith('snippet-1', {
      entities: ['a.claims'],
      column: 'status',
    });
  });

  it('ignores source and provenance even when a client sends them', async () => {
    const { service, repository } = build([
      snippet({ source: 'feedback', provenance: provenanceFor('fb-1') }),
    ]);

    await service.update('snippet-1', {
      enabled: false,
      source: 'user',
      provenance: undefined,
    } as never);

    expect(repository.update).toHaveBeenCalledWith('snippet-1', {
      enabled: false,
    });
  });
});

describe('KnowledgeService.delete', () => {
  it('returns the removed snippet', async () => {
    const { service, repository } = build([snippet()]);

    await expect(service.delete('snippet-1')).resolves.toMatchObject({
      id: 'snippet-1',
    });
    expect(repository.delete).toHaveBeenCalledWith('snippet-1');
  });

  it('throws NotFoundException for an unknown id', async () => {
    const { service } = build();

    await expect(service.delete('missing')).rejects.toThrow(NotFoundException);
  });
});

describe('KnowledgeService.definitionBlock', () => {
  it('is empty when nothing is enabled', async () => {
    const { service } = build([snippet({ enabled: false })]);

    await expect(service.definitionBlock(['World Cup'])).resolves.toBe('');
  });

  it('is empty with no snippets at all', async () => {
    const { service } = build([]);

    await expect(service.definitionBlock([])).resolves.toBe('');
  });

  it('excludes disabled snippets', async () => {
    const { service } = build([
      snippet({ id: 'on', enabled: true, title: 'Enabled term' }),
      snippet({ id: 'off', enabled: false, title: 'Disabled term' }),
    ]);

    const block = await service.definitionBlock([]);

    expect(block).toContain('Enabled term');
    expect(block).not.toContain('Disabled term');
  });

  it('includes global snippets regardless of dataset scope, and dataset-scoped ones only in scope', async () => {
    const { service } = build([
      snippet({ id: 'global', scope: null, title: 'Global rule' }),
      snippet({
        id: 'scoped',
        scope: { datasetId: 'World Cup' },
        title: 'Scoped rule',
      }),
    ]);

    const inScope = await service.definitionBlock(['World Cup']);
    expect(inScope).toContain('Global rule');
    expect(inScope).toContain('Scoped rule');

    const outOfScope = await service.definitionBlock(['Other']);
    expect(outOfScope).toContain('Global rule');
    expect(outOfScope).not.toContain('Scoped rule');
  });

  it('orders dataset-scoped snippets before global ones', async () => {
    const { service } = build([
      snippet({
        id: 'global',
        scope: null,
        title: 'Global rule',
        updatedAt: '2024-06-01T00:00:00.000Z',
      }),
      snippet({
        id: 'scoped',
        scope: { datasetId: 'World Cup' },
        title: 'Scoped rule',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    ]);

    const block = await service.definitionBlock(['World Cup']);

    expect(block.indexOf('Scoped rule')).toBeLessThan(
      block.indexOf('Global rule'),
    );
  });

  it('renders the header, kind tag, title, body, synonyms and entities', async () => {
    const { service } = build([
      snippet({
        kind: 'term',
        title: 'DNF',
        body: 'Did not finish',
        synonyms: ['dns'],
        entities: ['world_cup.matches'],
      }),
    ]);

    const block = await service.definitionBlock([]);

    expect(block).toContain('Curated dataset knowledge');
    expect(block).toContain('[term] DNF: Did not finish');
    expect(block).toContain('synonyms: dns');
    expect(block).toContain('entities: world_cup.matches');
  });

  it('stops at the character budget', async () => {
    const many = Array.from({ length: 100 }, (_, n) =>
      snippet({
        id: `s${n}`,
        scope: null,
        title: `Term ${n}`,
        body: 'x'.repeat(200),
      }),
    );
    const { service } = build(many);

    const block = await service.definitionBlock([]);

    expect(block.length).toBeLessThanOrEqual(8_200);
    expect(block).toContain('Term 0');
  });

  it('skips an entry that does not fit and keeps filling', async () => {
    // A single oversized entry sits between two small ones — the old
    // `break` would have stopped at it and silently dropped "Fits 2" too.
    const { service } = build([
      snippet({ id: 'fits-1', scope: null, title: 'Fits 1', body: 'x'.repeat(100) }),
      snippet({ id: 'too-big', scope: null, title: 'Too big', body: 'y'.repeat(9_000) }),
      snippet({ id: 'fits-2', scope: null, title: 'Fits 2', body: 'z'.repeat(100) }),
    ]);

    const block = await service.definitionBlock([]);

    expect(block).toContain('Fits 1');
    expect(block).toContain('Fits 2');
    expect(block).not.toContain('Too big');
  });
});

describe('KnowledgeService.contextFor', () => {
  it('records nothing when no snippet applies', async () => {
    const { service } = build([snippet({ enabled: false })]);

    await expect(service.contextFor(['World Cup'])).resolves.toEqual({
      block: '',
      used: [],
    });
  });

  it('records id, kind, title, body and dataset scope of each snippet in the block', async () => {
    const { service } = build([
      snippet({
        id: 'k1',
        kind: 'term',
        scope: { datasetId: 'World Cup' },
        title: 'DNF',
        body: 'Did not finish',
      }),
      snippet({
        id: 'k2',
        kind: 'instruction',
        scope: null,
        title: 'Coverage',
        body: '2018 and 2022 only',
      }),
    ]);

    const { block, used } = await service.contextFor(['World Cup']);

    expect(used).toEqual([
      {
        id: 'k1',
        kind: 'term',
        title: 'DNF',
        body: 'Did not finish',
        source: 'user',
        datasetId: 'World Cup',
      },
      {
        id: 'k2',
        kind: 'instruction',
        title: 'Coverage',
        body: '2018 and 2022 only',
        source: 'user',
      },
    ]);
    // Same order as the rendered block, so the two can never disagree.
    expect(block.indexOf('DNF')).toBeLessThan(block.indexOf('Coverage'));
  });

  it('omits snippets the character budget dropped, so it never claims knowledge the model never saw', async () => {
    const many = Array.from({ length: 100 }, (_, n) =>
      snippet({
        id: `s${n}`,
        scope: null,
        title: `Term ${n}`,
        body: 'x'.repeat(200),
      }),
    );
    const { service } = build(many);

    const { block, used } = await service.contextFor([]);

    expect(used.length).toBeLessThan(many.length);
    for (const entry of used) expect(block).toContain(entry.title);
  });

  it('pins default filters first and skips, not stops at, an entry that does not fit', async () => {
    // The 2026-09-28 genomics regression: newest-first filling stopped at the
    // first snippet over budget, so an older default filter vanished from
    // every turn once a dataset's knowledge outgrew the block.
    const filter = snippet({
      id: 'filter',
      kind: 'default_filter',
      scope: { datasetId: 'Genomics' },
      title: 'Exclude control samples',
      body: 'Exclude samples where is_control = true.',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    const newer = Array.from({ length: 20 }, (_, n) =>
      snippet({
        id: `t${n}`,
        kind: 'term',
        scope: { datasetId: 'Genomics' },
        title: `Term ${n}`,
        body: 'x'.repeat(250),
        updatedAt: `2024-06-${String(n + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const oversized = snippet({
      id: 'huge',
      kind: 'term',
      scope: { datasetId: 'Genomics' },
      title: 'Huge',
      body: 'x'.repeat(9_000),
      updatedAt: '2024-12-31T00:00:00.000Z',
    });
    const tiny = snippet({
      id: 'tiny',
      kind: 'term',
      scope: { datasetId: 'Genomics' },
      title: 'Tiny',
      body: 'small',
      updatedAt: '2023-01-01T00:00:00.000Z',
    });
    const { service } = build([oversized, ...newer.reverse(), filter, tiny]);

    const { used } = await service.contextFor(['Genomics']);
    const ids = used.map((u) => u.id);

    expect(ids[0]).toBe('filter');
    expect(ids).not.toContain('huge');
    expect(ids).toContain('tiny');
    expect(ids).toContain('t0');
  });

  it('excludes disabled and out-of-scope snippets', async () => {
    const { service } = build([
      snippet({ id: 'off', enabled: false, scope: null, title: 'Disabled' }),
      snippet({
        id: 'other',
        scope: { datasetId: 'Other' },
        title: 'Elsewhere',
      }),
      snippet({
        id: 'on',
        scope: { datasetId: 'World Cup' },
        title: 'Applies',
      }),
    ]);

    const { used } = await service.contextFor(['World Cup']);

    expect(used.map((u) => u.id)).toEqual(['on']);
  });

  it('is byte-identical to the newest-first path when ranked is explicitly false', async () => {
    const library = [
      snippet({
        id: 'global',
        scope: null,
        title: 'Global rule',
        updatedAt: '2024-06-01T00:00:00.000Z',
      }),
      snippet({
        id: 'scoped',
        scope: { datasetId: 'World Cup' },
        title: 'Scoped rule',
        updatedAt: '2024-01-01T00:00:00.000Z',
      }),
    ];
    const { service: unranked } = build(library);
    const { service: rankedFalse } = build(library);

    const a = await unranked.contextFor(['World Cup']);
    const b = await rankedFalse.contextFor(['World Cup'], {
      ranked: false,
      question: 'irrelevant, ignored when ranked is false',
      budgetChars: 1,
    });

    expect(b).toEqual(a);
  });

  describe('ranked', () => {
    it('ranks the net-paid term and the test-claims default filter above an unrelated genomics term for a health-insurance question', async () => {
      const netPaidTerm = snippet({
        id: 'net-paid',
        kind: 'term',
        scope: { datasetId: 'Health Insurance' },
        title: 'Net paid',
        body: 'Net paid is paid minus reversed amounts by region.',
        entities: ['world_cup.health_insurance.claims'],
      });
      const testClaimsFilter = snippet({
        id: 'test-claims',
        kind: 'default_filter',
        scope: { datasetId: 'Health Insurance' },
        title: 'Exclude test claims',
        body: 'Exclude claims where is_test = true.',
        entities: ['world_cup.health_insurance.claims'],
      });
      const genotypeTerm = snippet({
        id: 'genotype',
        kind: 'term',
        scope: null,
        title: 'Genotype 0/0',
        body: 'Homozygous reference is not a carrier.',
        entities: ['world_cup.genomics.variant_calls'],
      });
      const { service } = build([genotypeTerm, testClaimsFilter, netPaidTerm]);

      const { used } = await service.contextFor(['Health Insurance'], {
        ranked: true,
        question: 'net paid by region in 2024',
      });

      const ids = used.map((u) => u.id);
      expect(ids.indexOf('net-paid')).toBeLessThan(ids.indexOf('genotype'));
      expect(ids.indexOf('test-claims')).toBeLessThan(ids.indexOf('genotype'));
    });

    it('fills the budget best-first, skipping a higher-ranked entry that does not fit', async () => {
      const bigButRelevant = snippet({
        id: 'big',
        title: 'net paid net paid net paid net paid',
        body: 'x'.repeat(8_990),
      });
      const smallLessRelevant = snippet({
        id: 'small',
        title: 'Other',
        body: 'small',
      });
      const { service } = build([smallLessRelevant, bigButRelevant]);

      const { used } = await service.contextFor([], {
        ranked: true,
        question: 'net paid',
      });

      // The big, higher-scored entry does not fit; best-first fill still
      // picks up the smaller one instead of stopping outright.
      expect(used.map((u) => u.id)).toEqual(['small']);
    });

    it('fills the default budget (8000) and honours an explicit budgetChars override', async () => {
      const many = Array.from({ length: 100 }, (_, n) =>
        snippet({
          id: `s${n}`,
          scope: null,
          title: `Term ${n}`,
          body: 'x'.repeat(200),
        }),
      );
      const { service: defaultBudget } = build(many);
      const { service: customBudget } = build(many);

      const a = await defaultBudget.contextFor([], { ranked: true });
      expect(a.block.length).toBeLessThanOrEqual(8_200);
      expect(a.used.length).toBeGreaterThan(30);

      const b = await customBudget.contextFor([], {
        ranked: true,
        budgetChars: 500,
      });
      expect(b.block.length).toBeLessThanOrEqual(700);
    });

    it('never drops an in-scope default_filter snippet even under heavy competition for budget', async () => {
      const filter = snippet({
        id: 'default-filter',
        kind: 'default_filter',
        scope: null,
        title: 'Exclude test claims',
        body: 'Exclude claims where is_test = true.',
      });
      const noise = Array.from({ length: 50 }, (_, n) =>
        snippet({
          id: `noise-${n}`,
          kind: 'term',
          scope: null,
          title: `Term ${n}`,
          body: 'irrelevant filler text',
        }),
      );
      const { service } = build([...noise, filter]);

      const { used } = await service.contextFor([], {
        ranked: true,
        question: 'something entirely unrelated',
      });

      expect(used.map((u) => u.id)).toContain('default-filter');
    });
  });

  it('pins default_filter snippets first, ahead of everything else', async () => {
    const { service } = build([
      snippet({ id: 'term', kind: 'term', scope: null, title: 'Term rule' }),
      snippet({
        id: 'learned',
        kind: 'instruction',
        source: 'feedback',
        scope: { datasetId: 'Retail' },
        title: 'Fiscal year',
        provenance: provenanceFor('fb-1'),
      }),
      snippet({
        id: 'filter',
        kind: 'default_filter',
        scope: { datasetId: 'Retail' },
        title: 'Completed orders only',
      }),
    ]);

    const { used } = await service.contextFor(['Retail']);

    expect(used.map((u) => u.id)).toEqual(['filter', 'learned', 'term']);
  });

  it('orders feedback-sourced lessons before user/mined snippets of the same kind', async () => {
    const { service } = build([
      snippet({ id: 'mined', kind: 'term', source: 'mined', scope: null, title: 'Mined term' }),
      snippet({ id: 'user', kind: 'term', source: 'user', scope: null, title: 'User term' }),
      snippet({
        id: 'learned',
        kind: 'term',
        source: 'feedback',
        scope: null,
        title: 'Learned term',
        provenance: provenanceFor('fb-1'),
      }),
    ]);

    const { used } = await service.contextFor([]);

    expect(used.map((u) => u.id)).toEqual(['learned', 'mined', 'user']);
  });

  describe('ranked, composed with the tiers', () => {
    // The tiers are a guarantee, ranking is an order: with `ranked` on,
    // relevance re-orders snippets *within* each tier (default filters,
    // then lessons, then the rest) but never moves one across a tier.
    it('keeps a learned lesson ahead of a more relevant hand-written snippet', async () => {
      const { service } = build([
        snippet({
          id: 'user-relevant',
          kind: 'term',
          source: 'user',
          scope: null,
          title: 'Net revenue',
          body: 'Net revenue is merchandise net of returns by region.',
        }),
        snippet({
          id: 'lesson-unrelated',
          kind: 'instruction',
          source: 'feedback',
          scope: null,
          title: 'Fiscal year',
          body: 'The fiscal year runs 1 Feb to 31 Jan.',
          provenance: provenanceFor('fb-1'),
        }),
        snippet({
          id: 'filter',
          kind: 'default_filter',
          scope: null,
          title: 'Completed orders only',
          body: "status = 'completed'",
        }),
      ]);

      const { used } = await service.contextFor([], {
        ranked: true,
        question: 'net revenue by region',
      });

      expect(used.map((u) => u.id)).toEqual([
        'filter',
        'lesson-unrelated',
        'user-relevant',
      ]);
    });

    it('ranks by relevance inside each tier', async () => {
      const { service } = build([
        snippet({
          id: 'lesson-unrelated',
          kind: 'term',
          source: 'feedback',
          scope: null,
          title: 'Genotype',
          body: 'Homozygous reference is not a carrier.',
          provenance: provenanceFor('fb-1'),
        }),
        snippet({
          id: 'lesson-relevant',
          kind: 'term',
          source: 'feedback',
          scope: null,
          title: 'Net revenue',
          body: 'Net revenue excludes tax and shipping.',
          provenance: provenanceFor('fb-2'),
        }),
        snippet({
          id: 'user-unrelated',
          kind: 'term',
          source: 'user',
          scope: null,
          title: 'Carrier',
          body: 'A heterozygous call.',
        }),
        snippet({
          id: 'user-relevant',
          kind: 'term',
          source: 'user',
          scope: null,
          title: 'Region',
          body: 'Revenue region is the store region.',
        }),
      ]);

      const { used } = await service.contextFor([], {
        ranked: true,
        question: 'net revenue by region',
      });

      expect(used.map((u) => u.id)).toEqual([
        'lesson-relevant',
        'lesson-unrelated',
        'user-relevant',
        'user-unrelated',
      ]);
    });

    it('records the same KnowledgeUse shape, source included, on the ranked path', async () => {
      const { service } = build([
        snippet({
          id: 'learned',
          kind: 'term',
          source: 'feedback',
          scope: { datasetId: 'Retail' },
          title: 'Fiscal year',
          provenance: provenanceFor('fb-1'),
        }),
      ]);

      const ranked = await service.contextFor(['Retail'], {
        ranked: true,
        question: 'fiscal year revenue',
      });
      const plain = await service.contextFor(['Retail']);

      expect(ranked).toEqual(plain);
      expect(ranked.used[0]).toEqual(
        expect.objectContaining({ id: 'learned', source: 'feedback' }),
      );
    });
  });
});

describe('KnowledgeService.knowledgeByColumn', () => {
  it('keys a single-entity, no-column snippet by its normalized entity', async () => {
    const { service } = build([
      snippet({
        id: 's1',
        title: 'Claims',
        body: 'About claims',
        entities: ['world_cup.health_insurance.claims'],
      }),
    ]);

    const map = await service.knowledgeByColumn([]);

    expect(map.get('health_insurance.claims')).toEqual([
      { kind: 'term', title: 'Claims', body: 'About claims' },
    ]);
  });

  it('keys a column-scoped snippet by <entity>.<column>', async () => {
    const { service } = build([
      snippet({
        id: 's1',
        title: 'Status',
        body: 'PAID/DENIED/PENDING/REVERSED',
        entities: ['world_cup.health_insurance.claims'],
        column: 'status',
      }),
    ]);

    const map = await service.knowledgeByColumn([]);

    expect(map.get('health_insurance.claims.status')).toEqual([
      { kind: 'term', title: 'Status', body: 'PAID/DENIED/PENDING/REVERSED' },
    ]);
    expect(map.has('health_insurance.claims')).toBe(false);
  });

  it('files a multi-entity snippet under every one of its entity keys', async () => {
    const { service } = build([
      snippet({
        id: 's1',
        title: 'Join note',
        body: 'claims join lines',
        entities: ['a.claims', 'b.lines'],
      }),
    ]);

    const map = await service.knowledgeByColumn([]);

    expect(map.get('a.claims')?.[0]?.title).toBe('Join note');
    expect(map.get('b.lines')?.[0]?.title).toBe('Join note');
  });

  it('excludes disabled and out-of-scope snippets, and snippets with no entities', async () => {
    const { service } = build([
      snippet({ id: 'off', enabled: false, entities: ['a.b'] }),
      snippet({
        id: 'other-scope',
        scope: { datasetId: 'Other' },
        entities: ['a.b'],
      }),
      snippet({ id: 'no-entities', entities: undefined }),
      snippet({
        id: 'in-scope',
        scope: { datasetId: 'World Cup' },
        entities: ['a.b'],
      }),
    ]);

    const map = await service.knowledgeByColumn(['World Cup']);

    expect([...map.values()].flat().map((e) => e.title)).toEqual(['DNF']);
  });
});

describe('KnowledgeService.lookup', () => {
  const claims = snippet({
    id: 'claims-term',
    kind: 'term',
    title: 'Claims overview',
    body: 'net paid claims',
    entities: ['world_cup.health_insurance.claims'],
  });
  const status = snippet({
    id: 'claims-status',
    kind: 'term',
    title: 'Status',
    body: 'PAID/DENIED',
    entities: ['world_cup.health_insurance.claims'],
    column: 'status',
  });
  const genomics = snippet({
    id: 'genomics-term',
    kind: 'term',
    title: 'Genotype',
    body: 'homozygous reference',
    entities: ['world_cup.genomics.variant_calls'],
  });

  it('filters by entity (last-two-segment match)', async () => {
    const { service } = build([claims, status, genomics]);

    const results = await service.lookup([], {
      entity: 'health_insurance.claims',
    });

    expect(results.map((r) => r.title).sort()).toEqual([
      'Claims overview',
      'Status',
    ]);
  });

  it('filters by column', async () => {
    const { service } = build([claims, status, genomics]);

    const results = await service.lookup([], {
      entity: 'health_insurance.claims',
      column: 'status',
    });

    expect(results.map((r) => r.title)).toEqual(['Status']);
  });

  it('ranks results by phrase', async () => {
    const { service } = build([genomics, claims]);

    const results = await service.lookup([], { phrase: 'net paid claims' });

    expect(results[0].title).toBe('Claims overview');
  });

  it('returns at most 8 results', async () => {
    const many = Array.from({ length: 20 }, (_, n) =>
      snippet({ id: `s${n}`, title: `Term ${n}`, entities: ['a.b'] }),
    );
    const { service } = build(many);

    const results = await service.lookup([], {});

    expect(results.length).toBeLessThanOrEqual(8);
  });

  it('scopes to the given datasets plus global, same as contextFor', async () => {
    const { service } = build([
      snippet({
        id: 'scoped',
        scope: { datasetId: 'World Cup' },
        title: 'Scoped',
      }),
      snippet({ id: 'other', scope: { datasetId: 'Other' }, title: 'Other' }),
      snippet({ id: 'global', scope: null, title: 'Global' }),
    ]);

    const results = await service.lookup(['World Cup'], {});

    expect(results.map((r) => r.title).sort()).toEqual(['Global', 'Scoped']);
  });
});

describe('KnowledgeService.createLearned', () => {
  const provenance = provenanceFor('fb-1');

  it('stores the snippet with source feedback and the given provenance, reusing create validation', async () => {
    const { service, repository } = build();

    const saved = await service.createLearned(
      {
        kind: 'term',
        title: '  Fiscal year  ',
        body: '  Runs 1 Feb to 31 Jan  ',
        scope: { datasetId: 'Retail' },
      },
      provenance,
    );

    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'term',
        title: 'Fiscal year',
        body: 'Runs 1 Feb to 31 Jan',
        scope: { datasetId: 'Retail' },
        source: 'feedback',
        provenance,
        enabled: true,
      }),
    );
    expect(saved.provenance).toEqual(provenance);
    expect(saved.source).toBe('feedback');
  });

  it('rejects an invalid snippet the same way create does', async () => {
    const { service, repository } = build();

    await expect(
      service.createLearned(
        { kind: 'term', title: '', body: 'x' } as never,
        provenance,
      ),
    ).rejects.toThrow(/title is required/);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('surfaces the source on contextFor\'s used list', async () => {
    const learned = snippet({
      id: 'learned',
      kind: 'term',
      source: 'feedback',
      scope: { datasetId: 'Retail' },
      title: 'Fiscal year',
      provenance,
    });
    const { service } = build([learned]);

    const { used } = await service.contextFor(['Retail']);

    expect(used).toEqual([
      expect.objectContaining({ id: 'learned', source: 'feedback' }),
    ]);
  });
});

describe('KnowledgeService.deleteLearnedFor', () => {
  it('removes only the lessons learned from the given feedback doc', async () => {
    const learnedA = snippet({
      id: 'a',
      source: 'feedback',
      provenance: provenanceFor('fb-1'),
    });
    const learnedB = snippet({
      id: 'b',
      source: 'feedback',
      provenance: provenanceFor('fb-1'),
    });
    const otherFeedback = snippet({
      id: 'c',
      source: 'feedback',
      provenance: provenanceFor('fb-2'),
    });
    const userSnippet = snippet({ id: 'd', source: 'user' });
    const { service, repository } = build([
      learnedA,
      learnedB,
      otherFeedback,
      userSnippet,
    ]);

    const count = await service.deleteLearnedFor('fb-1');

    expect(count).toBe(2);
    expect(repository.deleteMany).toHaveBeenCalledWith({
      'provenance.feedbackId': 'fb-1',
    });
    const remaining = await service.list();
    expect(remaining.map((s) => s.id)).toEqual(['c', 'd']);
  });

  it('is a no-op when nothing was learned from that feedback', async () => {
    const { service } = build([snippet({ id: 'a', source: 'user' })]);

    await expect(service.deleteLearnedFor('missing')).resolves.toBe(0);
  });
});

describe('KnowledgeService.listLearned', () => {
  it('returns only enabled feedback lessons in scope of the given datasets', async () => {
    const { service } = build([
      snippet({
        id: 'learned-retail',
        source: 'feedback',
        scope: { datasetId: 'Retail' },
        provenance: provenanceFor('fb-1'),
      }),
      snippet({
        id: 'learned-disabled',
        source: 'feedback',
        scope: { datasetId: 'Retail' },
        enabled: false,
        provenance: provenanceFor('fb-2'),
      }),
      snippet({
        id: 'learned-other-dataset',
        source: 'feedback',
        scope: { datasetId: 'World Cup' },
        provenance: provenanceFor('fb-3'),
      }),
      snippet({ id: 'user-snippet', source: 'user', scope: { datasetId: 'Retail' } }),
    ]);

    const learned = await service.listLearned(['Retail']);

    expect(learned.map((s) => s.id)).toEqual(['learned-retail']);
  });
});

describe('KnowledgeService.bootstrap', () => {
  const dataset = {
    name: 'World Cup',
    datasourceId: 'ds-1',
    datasourceKind: 'databricks',
    tables: ['world_cup.matches'],
    entities: [
      {
        key: 'world_cup.matches',
        columns: [
          {
            name: 'stage',
            type: 'string',
            nullable: true,
            sampleValues: ['final', 'group'],
          },
        ],
      },
    ],
  };

  it('persists drafts as mined and disabled, scoped to the dataset', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: {
        drafts: [
          { kind: 'term', title: 'Stage', body: 'Round of the tournament' },
        ],
      },
    });
    const { service, repository } = build([], {
      datasets: [dataset],
      sampleRows: { columns: ['stage'], rows: [{ stage: 'final' }] },
      generate,
    });

    const created = await service.bootstrap('World Cup');

    expect(created).toHaveLength(1);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'term',
        title: 'Stage',
        scope: { datasetId: 'World Cup' },
        enabled: false,
        source: 'mined',
      }),
    );
  });

  it('skips drafts whose title matches an existing snippet in the same scope (case-insensitive)', async () => {
    const existing = snippet({
      id: 'existing',
      title: 'stage',
      scope: { datasetId: 'World Cup' },
    });
    const generate = jest.fn().mockResolvedValue({
      object: {
        drafts: [
          { kind: 'term', title: 'Stage', body: 'Round of the tournament' },
          { kind: 'term', title: 'Venue', body: 'Where the match was played' },
        ],
      },
    });
    const { service, repository } = build([existing], {
      datasets: [dataset],
      generate,
    });

    const created = await service.bootstrap('World Cup');

    expect(created.map((s) => s.title)).toEqual(['Venue']);
    expect(repository.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown dataset with a BadRequestException', async () => {
    const { service } = build([], { datasets: [] });

    await expect(service.bootstrap('Missing')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('wraps an agent failure in a BadRequestException instead of crashing', async () => {
    const generate = jest
      .fn()
      .mockRejectedValue(new Error('model unavailable'));
    const { service } = build([], { datasets: [dataset], generate });

    await expect(service.bootstrap('World Cup')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty datasetId', async () => {
    const { service } = build();

    await expect(service.bootstrap('')).rejects.toThrow(BadRequestException);
  });

  it('reports each stage through onProgress, in order', async () => {
    const generate = jest.fn().mockResolvedValue({
      object: {
        drafts: [
          { kind: 'term', title: 'Stage', body: 'Round of the tournament' },
        ],
      },
    });
    const { service } = build([], {
      datasets: [dataset],
      sampleRows: { columns: ['stage'], rows: [{ stage: 'final' }] },
      generate,
    });
    const progress: { key: string; message: string }[] = [];

    await service.bootstrap('World Cup', (p) => progress.push(p));

    expect(progress.map((p) => p.key)).toEqual([
      'dataset',
      'schema',
      'sample',
      'draft',
      'save',
    ]);
    expect(progress[0].message).toContain('World Cup');
    expect(progress[1].message).toContain('1 table');
    expect(progress[2].message).toContain('1 of 1 table');
    expect(progress[4].message).toContain('1 draft');
  });
});
