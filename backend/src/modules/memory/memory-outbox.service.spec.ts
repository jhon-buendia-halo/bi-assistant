import BetterSqlite3 from 'better-sqlite3';
import { Logger } from '@nestjs/common';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type {
  MemorySignalDoc,
  MemorySignalInput,
} from './entities/memory-signal.entity';
import type { LearningSignal } from './learning-store.port';
import {
  FLUSH_DEBOUNCE_MS,
  FLUSH_INTERVAL_MS,
  MAX_STORE_ATTEMPTS,
  MemoryOutboxService,
} from './memory-outbox.service';
import { MemorySignalsRepository } from './repositories/memory-signals.repository';

const T0 = new Date('2026-10-05T10:00:00.000Z');

const signal = (
  overrides: Partial<MemorySignalInput> = {},
): MemorySignalInput => ({
  documentId: 'rating:s1:2026-10-01T10:00:00.000Z',
  kind: 'verified_query',
  datasourceId: 'ds-1',
  datasetIds: ['football'],
  content:
    '[verified_query · 2026-10-01]\nQuestion: Who won?\nApproved SQL: SELECT 1',
  occurredAt: '2026-10-01T10:00:00.000Z',
  entities: ['main.football.matches'],
  ...overrides,
});

/** The outbox over a real in-memory `SqliteDocStore`, the store mocked. */
function build() {
  const db = new BetterSqlite3(':memory:');
  const docs = new SqliteDocStore<MemorySignalDoc>(db, 'memory_signals');
  const store = {
    retain: jest.fn().mockResolvedValue(undefined),
    recall: jest.fn(),
    mentalModels: jest.fn(),
    forget: jest.fn().mockResolvedValue(undefined),
    items: jest.fn(),
    settle: jest.fn(),
    onUsage: jest.fn(),
  };
  const outbox = new MemoryOutboxService(
    new MemorySignalsRepository(docs),
    store,
  );
  return { outbox, docs, store, db };
}

describe('MemoryOutboxService (data-model 3.15)', () => {
  let db: BetterSqlite3.Database | undefined;

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    db?.close();
    db = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('writes a pending row, then stores it and marks it stored', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store } = built;

    await outbox.enqueue(signal());
    expect(await docs.find({})).toEqual([
      expect.objectContaining({
        documentId: 'rating:s1:2026-10-01T10:00:00.000Z',
        status: 'pending',
        attempts: 0,
      }),
    ]);

    await outbox.flush();

    expect(store.retain).toHaveBeenCalledWith('ds-1', [
      {
        documentId: 'rating:s1:2026-10-01T10:00:00.000Z',
        kind: 'verified_query',
        content: signal().content,
        occurredAt: '2026-10-01T10:00:00.000Z',
        metadata: {
          datasourceId: 'ds-1',
          datasetIds: ['football'],
          entities: ['main.football.matches'],
        },
      },
    ]);
    const [stored] = await docs.find({});
    expect(stored.status).toBe('stored');
    expect(stored.storedAt).toBe(T0.toISOString());
  });

  it('flushes on its own 2 s after the last write', async () => {
    const built = build();
    db = built.db;
    const { outbox, store } = built;

    await outbox.enqueue(signal());
    await jest.advanceTimersByTimeAsync(FLUSH_DEBOUNCE_MS - 1);
    expect(store.retain).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(store.retain).toHaveBeenCalledTimes(1);
  });

  it('flushes at start-up and every 30 s', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store } = built;
    await docs.insert({
      id: 'left-over',
      ...signal(),
      status: 'pending',
      attempts: 0,
    });

    outbox.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);
    expect(store.retain).toHaveBeenCalledTimes(1);

    await docs.insert({
      id: 'later',
      ...signal({ documentId: 'rating:s2:x' }),
      status: 'pending',
      attempts: 0,
    });
    await jest.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    outbox.onModuleDestroy();

    expect(store.retain).toHaveBeenCalledTimes(2);
  });

  it('hands each learning memory its rows in one retain', async () => {
    const built = build();
    db = built.db;
    const { outbox, store } = built;
    await outbox.enqueue(signal({ documentId: 'rating:a:1' }));
    await outbox.enqueue(
      signal({ documentId: 'rating:b:1', datasourceId: 'ds-2' }),
    );
    await outbox.enqueue(signal({ documentId: 'rating:c:1' }));

    await outbox.flush();

    const batches = (
      store.retain.mock.calls as [string, LearningSignal[]][]
    ).map(([scope, batch]) => [scope, batch.map((s) => s.documentId)]);
    expect(batches).toEqual([
      ['ds-1', ['rating:a:1', 'rating:c:1']],
      ['ds-2', ['rating:b:1']],
    ]);
  });

  it('replaces the row of a document id whatever its state', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store } = built;
    store.retain.mockRejectedValue(new Error('no key'));
    await outbox.enqueue(signal());
    for (let attempt = 0; attempt < MAX_STORE_ATTEMPTS; attempt++) {
      await outbox.flush();
      jest.setSystemTime(Date.now() + 60 * 60_000);
    }
    expect((await docs.find({}))[0].status).toBe('failed');

    await outbox.enqueue(
      signal({ kind: 'rejection', content: 'a rejection now' }),
    );

    const rows = await docs.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        kind: 'rejection',
        content: 'a rejection now',
        status: 'pending',
        attempts: 0,
      }),
    );
    expect(rows[0]).not.toHaveProperty('lastError');
    expect(rows[0]).not.toHaveProperty('nextAttemptAt');
  });

  it('retries after 30 s, doubling, and gives a row up after the 5th failure', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store } = built;
    store.retain.mockRejectedValue(new Error('connection refused'));
    await outbox.enqueue(signal());

    await outbox.flush();
    let [row] = await docs.find({});
    expect(row).toEqual(
      expect.objectContaining({
        status: 'pending',
        attempts: 1,
        lastError: 'connection refused',
        nextAttemptAt: new Date(T0.getTime() + 30_000).toISOString(),
      }),
    );

    // Not due yet: nothing is retried.
    await outbox.flush();
    expect(store.retain).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date(T0.getTime() + 30_000));
    await outbox.flush();
    [row] = await docs.find({});
    expect(row.nextAttemptAt).toBe(
      new Date(T0.getTime() + 30_000 + 60_000).toISOString(),
    );

    for (let attempt = 0; attempt < MAX_STORE_ATTEMPTS; attempt++) {
      jest.setSystemTime(Date.now() + 60 * 60_000);
      await outbox.flush();
    }
    expect(store.retain).toHaveBeenCalledTimes(MAX_STORE_ATTEMPTS);
    [row] = await docs.find({});
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(MAX_STORE_ATTEMPTS);
    expect(row).not.toHaveProperty('nextAttemptAt');
  });

  it('keeps a row replaced during a flush pending for the next one', async () => {
    const built = build();
    db = built.db;
    const { outbox, docs, store } = built;
    await outbox.enqueue(signal());
    store.retain.mockImplementationOnce(async () => {
      await outbox.enqueue(signal({ content: 'replaced meanwhile' }));
    });

    await outbox.flush();

    const [row] = await docs.find({});
    expect(row.status).toBe('pending');
    expect(row.content).toBe('replaced meanwhile');
  });

  it('never runs a forget while a flush is storing', async () => {
    const built = build();
    db = built.db;
    const { outbox, store } = built;
    const order: string[] = [];
    let release!: () => void;
    store.retain.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          order.push('retain started');
          release = () => {
            order.push('retain done');
            resolve();
          };
        }),
    );
    await outbox.enqueue(signal());

    const flushed = outbox.flush();
    await jest.advanceTimersByTimeAsync(0);
    const forgotten = outbox.exclusive(() => {
      order.push('forget');
      return Promise.resolve();
    });
    await jest.advanceTimersByTimeAsync(0);
    release();
    await Promise.all([flushed, forgotten]);

    expect(order).toEqual(['retain started', 'retain done', 'forget']);
  });
});
