import BetterSqlite3 from 'better-sqlite3';
import { Logger } from '@nestjs/common';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { resolveEngineOptions } from '../engine/engine-options';
import type {
  MemorySignal,
  MemorySignalDoc,
} from './entities/memory-signal.entity';
import {
  FLUSH_DEBOUNCE_MS,
  MAX_SEND_ATTEMPTS,
  MemoryOutboxService,
} from './memory-outbox.service';
import { MemorySignalsRepository } from './repositories/memory-signals.repository';

const T0 = new Date('2026-10-05T10:00:00.000Z');

const signal = (overrides: Partial<MemorySignal> = {}): MemorySignal => ({
  id: 'sig-1',
  kind: 'verified_query',
  datasourceId: 'ds-1',
  datasetIds: ['football'],
  documentId: 'vq:abc',
  content: 'Question: Who won?\nApproved SQL: SELECT 1',
  context: 'An analyst approved this SQL answer as correct',
  occurredAt: '2026-10-01T10:00:00.000Z',
  entities: [],
  ...overrides,
});

/** The outbox over a real in-memory `SqliteDocStore`, with the memory mocked. */
function build(options: { enabled?: boolean; memory?: 'off' | 'recall' } = {}) {
  const db = new BetterSqlite3(':memory:');
  const docs = new SqliteDocStore<MemorySignalDoc>(db, 'memory_signals');
  const store = {
    enabled: options.enabled ?? true,
    retain: jest.fn().mockResolvedValue(undefined),
    recall: jest.fn(),
    mentalModels: jest.fn(),
    forget: jest.fn().mockResolvedValue(undefined),
  };
  const banks = { ensureBank: jest.fn().mockResolvedValue(undefined) };
  const engineSettings = {
    resolved: jest
      .fn()
      .mockResolvedValue(
        resolveEngineOptions({ memory: options.memory ?? 'recall' }),
      ),
  };
  const outbox = new MemoryOutboxService(
    new MemorySignalsRepository(docs),
    store,
    banks as never,
    engineSettings as never,
  );
  return { outbox, docs, store, banks, engineSettings, db };
}

describe('MemoryOutboxService', () => {
  let db: BetterSqlite3.Database | undefined;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    db?.close();
    db = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('queues a signal as pending, then sends it and marks it sent', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store, banks } = built;

    await outbox.enqueue(signal());
    expect(await docs.find({})).toEqual([
      expect.objectContaining({
        id: 'sig-1',
        documentId: 'vq:abc',
        status: 'pending',
        attempts: 0,
      }),
    ]);

    await outbox.flush();

    expect(banks.ensureBank).toHaveBeenCalledWith('ds-1');
    expect(store.retain).toHaveBeenCalledWith([signal()]);
    const [sent] = await docs.find({});
    expect(sent.status).toBe('sent');
    expect(sent.sentAt).toBe(T0.toISOString());
  });

  it('flushes on its own 2 s after the last enqueue', async () => {
    const built = build();
    db = built.db;
    const { outbox, store } = built;

    await outbox.enqueue(signal());
    await jest.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS - 1);
    expect(store.retain).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(store.retain).toHaveBeenCalledTimes(1);
  });

  it('groups one retain per datasource', async () => {
    const built = build();
    db = built.db;
    const { outbox, store } = built;
    await outbox.enqueue(signal());
    await outbox.enqueue(
      signal({ id: 'sig-2', documentId: 'vq:def', datasourceId: 'ds-2' }),
    );
    await outbox.enqueue(signal({ id: 'sig-3', documentId: 'vq:ghi' }));

    await outbox.flush();

    const batches = (store.retain.mock.calls as MemorySignal[][][]).map(
      ([batch]) => batch.map((s) => s.id),
    );
    expect(batches).toEqual([['sig-1', 'sig-3'], ['sig-2']]);
  });

  it('replaces a still-pending signal for the same document', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs } = built;

    await outbox.enqueue(signal());
    await outbox.enqueue(signal({ id: 'sig-2', content: 'newer' }));

    const rows = await docs.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({ id: 'sig-2', content: 'newer' }),
    );
  });

  it('records a failed send and backs off before the retry', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store } = built;
    store.retain.mockRejectedValueOnce(new Error('503 Service Unavailable'));
    await outbox.enqueue(signal());

    await outbox.flush();

    let [row] = await docs.find({});
    expect(row).toEqual(
      expect.objectContaining({
        status: 'pending',
        attempts: 1,
        lastError: '503 Service Unavailable',
        nextAttemptAt: new Date(T0.getTime() + 30_000).toISOString(),
      }),
    );

    // Not due yet: nothing is sent.
    await outbox.flush();
    expect(store.retain).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date(T0.getTime() + 30_000));
    await outbox.flush();
    expect(store.retain).toHaveBeenCalledTimes(2);
    [row] = await docs.find({});
    expect(row.status).toBe('sent');
    expect(row.nextAttemptAt).toBeUndefined();
  });

  it(`gives a signal up after ${MAX_SEND_ATTEMPTS} failed attempts`, async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store } = built;
    store.retain.mockRejectedValue(new Error('connection refused'));
    await outbox.enqueue(signal());

    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS + 2; attempt++) {
      await outbox.flush();
      // Past any back-off, so the next flush finds it due.
      jest.setSystemTime(Date.now() + 60 * 60_000);
    }

    expect(store.retain).toHaveBeenCalledTimes(MAX_SEND_ATTEMPTS);
    const [row] = await docs.find({});
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(MAX_SEND_ATTEMPTS);
    expect(row.lastError).toBe('connection refused');
  });

  it('queues nothing while the production memory lever is off', async () => {
    const built = build({ memory: 'off' });
    db = built.db;
    const { outbox, docs } = built;

    await outbox.enqueue(signal());

    expect(await docs.find({})).toEqual([]);
  });

  it('does nothing at all without a configured memory', async () => {
    const built = build({ enabled: false });
    db = built.db;
    const { outbox, docs, engineSettings, store } = built;

    outbox.onModuleInit();
    await outbox.enqueue(signal());
    await outbox.forget('ds-1', 'vq:abc');

    expect(engineSettings.resolved).not.toHaveBeenCalled();
    expect(store.forget).not.toHaveBeenCalled();
    expect(await docs.find({})).toEqual([]);
  });

  it('forgets a document and drops what is still queued for it', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store } = built;
    await outbox.enqueue(signal({ documentId: 'knowledge:k1' }));

    await outbox.forget('ds-1', 'knowledge:k1');
    await outbox.flush();

    expect(await docs.find({})).toEqual([]);
    expect(store.forget).toHaveBeenCalledWith('ds-1', 'knowledge:k1');
    expect(store.retain).not.toHaveBeenCalled();
  });

  it('never throws to the caller when the outbox cannot be written', async () => {
    const built = build();
    db = built.db;
    const { outbox, engineSettings } = built;
    engineSettings.resolved.mockRejectedValue(new Error('database is locked'));

    await expect(outbox.enqueue(signal())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('sends what a previous process left queued on start', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store } = built;
    await docs.insert({
      ...signal(),
      status: 'pending',
      attempts: 0,
      createdAt: T0.toISOString(),
    });

    outbox.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    outbox.onModuleDestroy();

    expect(store.retain).toHaveBeenCalledTimes(1);
  });
});
