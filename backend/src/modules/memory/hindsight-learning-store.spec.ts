import { Logger } from '@nestjs/common';
import type { MemorySignal } from './entities/memory-signal.entity';
import {
  HindsightLearningStore,
  bankIdFor,
  batchOperationId,
  memoryTags,
} from './hindsight-learning-store';

/** The client methods the store calls, as jest doubles. */
function clientDouble() {
  return {
    retainBatch: jest.fn().mockResolvedValue({ success: true }),
    recall: jest.fn().mockResolvedValue({ results: [] }),
    listMentalModels: jest.fn().mockResolvedValue({ items: [] }),
    deleteDocument: jest.fn().mockResolvedValue(undefined),
  };
}

const signal = (overrides: Partial<MemorySignal> = {}): MemorySignal => ({
  id: '0b9a4c1e-2f3d-4a5b-8c6d-7e8f9a0b1c2d',
  kind: 'verified_query',
  datasourceId: 'ds-1',
  datasetIds: ['football'],
  documentId: 'vq:abc',
  content: 'Question: Who won?\nApproved SQL: SELECT 1',
  context: 'An analyst approved this SQL answer as correct',
  occurredAt: '2026-10-01T10:00:00.000Z',
  entities: ['main.football.matches'],
  ...overrides,
});

describe('HindsightLearningStore', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('names one bank per datasource', () => {
    expect(bankIdFor('ds-1')).toBe('halo-ds-ds-1');
  });

  it('tags a memory by dataset, kind and entity — scope:global without datasets', () => {
    expect(memoryTags(signal())).toEqual([
      'dataset:football',
      'kind:verified_query',
      'entity:main.football.matches',
    ]);
    expect(
      memoryTags(signal({ datasetIds: [], entities: [], kind: 'knowledge' })),
    ).toEqual(['scope:global', 'kind:knowledge']);
  });

  it('retains one async batch per bank, one item per signal', async () => {
    const client = clientDouble();
    const store = new HindsightLearningStore(client as never);
    const second = signal({
      id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      documentId: 'corr:s:t:answer',
      kind: 'correction',
    });
    const otherBank = signal({
      id: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
      datasourceId: 'ds-2',
    });

    await store.retain([signal(), second, otherBank]);

    expect(client.retainBatch).toHaveBeenCalledTimes(2);
    const [bank, items, options] = client.retainBatch.mock.calls[0] as [
      string,
      unknown[],
      { async: boolean; operationId: string },
    ];
    expect(bank).toBe('halo-ds-ds-1');
    expect(items).toEqual([
      {
        content: 'Question: Who won?\nApproved SQL: SELECT 1',
        context: 'An analyst approved this SQL answer as correct',
        timestamp: '2026-10-01T10:00:00.000Z',
        document_id: 'vq:abc',
        tags: [
          'dataset:football',
          'kind:verified_query',
          'entity:main.football.matches',
        ],
        metadata: { kind: 'verified_query', datasourceId: 'ds-1' },
      },
      expect.objectContaining({
        document_id: 'corr:s:t:answer',
        tags: expect.arrayContaining(['kind:correction']) as string[],
      }),
    ]);
    expect(options.async).toBe(true);
    expect(options.operationId).toBe(batchOperationId([signal(), second]));
    // A lone signal is sent under its own id.
    const [loneBank, , loneOptions] = client.retainBatch.mock
      .calls[1] as unknown[];
    expect(loneBank).toBe('halo-ds-ds-2');
    expect(loneOptions).toEqual({
      async: true,
      operationId: otherBank.id,
    });
  });

  it('derives a stable UUID per batch, whatever the order', () => {
    const a = signal();
    const b = signal({ id: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f' });
    const id = batchOperationId([a, b]);
    expect(id).toBe(batchOperationId([b, a]));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('lets a refused retain throw so the outbox retries', async () => {
    const client = clientDouble();
    client.retainBatch.mockRejectedValue(new Error('503'));
    const store = new HindsightLearningStore(client as never);

    await expect(store.retain([signal()])).rejects.toThrow('503');
  });

  it('recalls with the dataset tags and maps the snake_case results', async () => {
    const client = clientDouble();
    client.recall.mockResolvedValue({
      results: [
        {
          id: 'obs-1',
          text: ' Revenue uses net_amount. ',
          type: 'observation',
          entities: ['orders'],
          source_fact_ids: ['f1', 'f2', 'f3'],
          document_id: null,
        },
        {
          id: 'exp-1',
          text: 'Rejected a gross revenue answer.',
          type: 'experience',
          occurred_start: '2026-09-28T10:00:00Z',
          document_id: 'corr:s:t:answer',
        },
        {
          id: 'w-1',
          text: 'Fiscal year starts in February.',
          type: 'something-new',
          mentioned_at: '2026-09-01T00:00:00Z',
        },
        { id: 'blank', text: '  ', type: 'world' },
      ],
    });
    const store = new HindsightLearningStore(client as never);

    const recalled = await store.recall({
      datasourceId: 'ds-1',
      datasetIds: ['football', 'cups'],
      question: 'net revenue by team?',
      maxTokens: 1200,
      timeoutMs: 800,
    });

    const [bank, query, options] = client.recall.mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(bank).toBe('halo-ds-ds-1');
    expect(query).toBe('net revenue by team?');
    expect(options).toEqual(
      expect.objectContaining({
        types: ['observation', 'experience', 'world'],
        budget: 'low',
        maxTokens: 1200,
        tags: ['dataset:football', 'dataset:cups', 'scope:global'],
        tagsMatch: 'any',
        preferObservations: true,
      }),
    );
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(recalled).toEqual([
      {
        id: 'obs-1',
        type: 'observation',
        text: 'Revenue uses net_amount.',
        entities: ['orders'],
        evidenceCount: 3,
      },
      {
        id: 'exp-1',
        type: 'experience',
        text: 'Rejected a gross revenue answer.',
        occurredAt: '2026-09-28T10:00:00Z',
        documentId: 'corr:s:t:answer',
        entities: [],
      },
      {
        id: 'w-1',
        type: 'world',
        text: 'Fiscal year starts in February.',
        occurredAt: '2026-09-01T00:00:00Z',
        entities: [],
      },
    ]);
  });

  it('returns no memories when recall times out, and aborts the request', async () => {
    jest.useFakeTimers();
    try {
      const client = clientDouble();
      let aborted = false;
      client.recall.mockImplementation(
        (_bank: string, _q: string, options: { signal: AbortSignal }) =>
          new Promise((resolve) => {
            options.signal.addEventListener('abort', () => {
              aborted = true;
            });
            setTimeout(() => resolve({ results: [] }), 5_000);
          }),
      );
      const store = new HindsightLearningStore(client as never);

      const pending = store.recall({
        datasourceId: 'ds-1',
        datasetIds: [],
        question: 'q',
        maxTokens: 1200,
        timeoutMs: 800,
      });
      await jest.advanceTimersByTimeAsync(800);

      await expect(pending).resolves.toEqual([]);
      expect(aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns no memories when recall fails', async () => {
    const client = clientDouble();
    client.recall.mockRejectedValue(new Error('connection refused'));
    const store = new HindsightLearningStore(client as never);

    await expect(
      store.recall({
        datasourceId: 'ds-1',
        datasetIds: [],
        question: 'q',
        maxTokens: 1200,
        timeoutMs: 800,
      }),
    ).resolves.toEqual([]);
  });

  it('lists mental models with content only', async () => {
    const client = clientDouble();
    client.listMentalModels.mockResolvedValue({
      items: [
        { id: 'known-pitfalls', name: 'Errores conocidos', content: ' - net ' },
        { id: 'table-guide', name: 'Guía de tablas', content: null },
        { id: 'learned-glossary', name: 'Glosario aprendido', content: '' },
      ],
    });
    const store = new HindsightLearningStore(client as never);

    await expect(store.mentalModels('ds-1', 800)).resolves.toEqual([
      { id: 'known-pitfalls', name: 'Errores conocidos', content: '- net' },
    ]);
    expect(client.listMentalModels).toHaveBeenCalledWith(
      'halo-ds-ds-1',
      expect.objectContaining({ detail: 'content' }),
    );
  });

  it('forgets a document and swallows a failure', async () => {
    const client = clientDouble();
    const store = new HindsightLearningStore(client as never);

    await store.forget('ds-1', 'knowledge:k1');
    expect(client.deleteDocument).toHaveBeenCalledWith(
      'halo-ds-ds-1',
      'knowledge:k1',
    );

    client.deleteDocument.mockRejectedValue(new Error('404'));
    await expect(store.forget('ds-1', 'knowledge:k2')).resolves.toBeUndefined();
  });
});
