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
import { KnowledgeService } from './knowledge.service';
import type { KnowledgeSnippet } from './entities/knowledge-snippet.entity';

const snippet = (overrides: Partial<KnowledgeSnippet> = {}): KnowledgeSnippet => ({
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
        return Promise.resolve(
          existing ? { ...existing, ...patch } : null,
        );
      }),
    delete: jest.fn().mockResolvedValue(1),
  };
  const datasetsRepository = {
    getByNames: jest
      .fn()
      .mockResolvedValue(options.datasets ?? []),
  };
  const datasourcesService = {
    defaultDatasource: jest
      .fn()
      .mockResolvedValue(options.defaultDatasource),
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
  return { service, repository, datasetsRepository, datasourcesService, mastra };
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

    expect(
      (await service.list({ kind: 'term' })).map((s) => s.id),
    ).toEqual(['scoped']);
    expect(
      (await service.list({ source: 'mined' })).map((s) => s.id),
    ).toEqual(['scoped']);
    expect(
      (await service.list({ enabled: false })).map((s) => s.id),
    ).toEqual(['scoped']);
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
      body: "WHERE is_test = false",
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

    await expect(
      service.update('missing', { enabled: false }),
    ).rejects.toThrow(NotFoundException);
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

    expect(block!.indexOf('Scoped rule')).toBeLessThan(
      block!.indexOf('Global rule'),
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

    expect(block!.length).toBeLessThanOrEqual(2_200);
    expect(block).toContain('Term 0');
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
          { name: 'stage', type: 'string', nullable: true, sampleValues: ['final', 'group'] },
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
    const generate = jest.fn().mockRejectedValue(new Error('model unavailable'));
    const { service } = build([], { datasets: [dataset], generate });

    await expect(service.bootstrap('World Cup')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty datasetId', async () => {
    const { service } = build();

    await expect(service.bootstrap('')).rejects.toThrow(BadRequestException);
  });
});
