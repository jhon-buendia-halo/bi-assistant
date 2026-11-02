// The lever-off proof below runs a real `MastraLearningStore`, which loads
// the framework; see mastra-learning-store.spec.ts for these stand-ins.
jest.mock('@sindresorhus/slugify', () => ({
  __esModule: true,
  default: (text: string) => text.toLowerCase(),
}));
jest.mock('p-map', () => ({
  __esModule: true,
  default: (items: Iterable<unknown>, map: (item: unknown) => unknown) =>
    Promise.all([...items].map(map)),
}));
jest.mock('tokenx', () => ({
  estimateTokenCount: (text: string) => Math.ceil((text ?? '').length / 4),
}));

import { BadRequestException, Logger } from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MemorySignalDoc } from './entities/memory-signal.entity';
import type { LearningStore, RecalledSignal } from './learning-store.port';
import { LEARNED_BLOCK_HEADING } from './learned-block';
import { MastraLearningStore } from './mastra-learning-store';
import { MemoryOutboxService } from './memory-outbox.service';
import {
  MemoryService,
  type RatingInput,
  TURN_RECALL_TIMEOUT_MS,
} from './memory.service';
import { MemorySettingsRepository } from './repositories/memory-settings.repository';
import { MemorySignalsRepository } from './repositories/memory-signals.repository';

const ANSWER_AT = '2026-10-05T10:00:03.000Z';

const rating = (overrides: Partial<RatingInput> = {}): RatingInput => ({
  sessionId: 's1',
  messageAt: ANSWER_AT,
  rating: 'up',
  question: 'How many goals did Lionel Messi score in 2022?',
  sql: "SELECT count(*) FROM goals WHERE player = 'Lionel Messi' AND type <> 'own_goal' AND scorer_email = 'leo@example.com'",
  datasourceId: 'ds-1',
  datasetIds: ['football'],
  entities: ['main.football.goals'],
  ...overrides,
});

function fakeStore() {
  return {
    retain: jest.fn().mockResolvedValue(undefined),
    recall: jest.fn().mockResolvedValue([]),
    mentalModels: jest.fn().mockResolvedValue(null),
    forget: jest.fn().mockResolvedValue(undefined),
    items: jest.fn().mockResolvedValue([]),
    settle: jest.fn().mockResolvedValue(undefined),
    onUsage: jest.fn().mockReturnValue(() => undefined),
  };
}

function fakeMaintenance() {
  return {
    compact: jest.fn().mockResolvedValue(undefined),
    scopesHolding: jest.fn().mockResolvedValue([]),
    holdsScope: jest.fn().mockResolvedValue(false),
    removeEvalScopes: jest.fn().mockResolvedValue(0),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * The service over real in-memory collections; the store, the upkeep and
 * the key faked unless given.
 */
function build(
  options: {
    enabled?: boolean;
    store?: LearningStore;
    maintenance?: ReturnType<typeof fakeMaintenance>;
    keySource?: 'llm-settings' | 'environment' | 'none';
  } = {},
) {
  const db = new BetterSqlite3(':memory:');
  const settingsDocs = new SqliteDocStore<Record<string, unknown>>(
    db,
    'settings',
  );
  const signalDocs = new SqliteDocStore<MemorySignalDoc>(db, 'memory_signals');
  const settings = new MemorySettingsRepository(settingsDocs as never);
  const signals = new MemorySignalsRepository(signalDocs);
  // The fake's mocks stay reachable whatever store the service is given.
  const fake = fakeStore();
  const outbox = new MemoryOutboxService(signals, options.store ?? fake);
  const maintenance = options.maintenance ?? fakeMaintenance();
  const appStore = { compact: jest.fn().mockResolvedValue(undefined) };
  const keys = {
    resolve: jest
      .fn()
      .mockResolvedValue({ source: options.keySource ?? 'environment' }),
  };
  const service = new MemoryService(
    settings,
    signals,
    outbox,
    options.store ?? fake,
    maintenance,
    appStore,
    keys,
  );
  const ready = options.enabled ? settings.setEnabled(true) : Promise.resolve();
  return {
    service,
    settings,
    settingsDocs,
    signalDocs,
    outbox,
    store: fake,
    maintenance,
    appStore,
    db,
    ready,
  };
}

describe('MemoryService', () => {
  let db: BetterSqlite3.Database | undefined;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    db?.close();
    db = undefined;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('the lever (api.md 108, 109; knowledge R30)', () => {
    it('reads off when no settings document exists', async () => {
      const built = build({ keySource: 'llm-settings' });
      db = built.db;

      await expect(built.service.view()).resolves.toEqual({
        enabled: false,
        embeddingModel: 'text-embedding-3-small',
        embeddingKey: 'llm-settings',
      });
    });

    it('saves the lever as the `memory` settings document', async () => {
      const built = build({ keySource: 'none' });
      db = built.db;

      await expect(built.service.setEnabled(true)).resolves.toEqual({
        enabled: true,
        embeddingModel: 'text-embedding-3-small',
        embeddingKey: 'none',
      });
      expect(await built.settingsDocs.find({ key: 'memory' })).toEqual([
        expect.objectContaining({ key: 'memory', enabled: true }),
      ]);
      await built.service.setEnabled(false);
      expect(await built.settingsDocs.find({ key: 'memory' })).toHaveLength(1);
      expect((await built.service.view()).enabled).toBe(false);
    });

    it('refuses anything but true or false', async () => {
      const built = build();
      db = built.db;

      for (const value of ['true', 1, null, undefined]) {
        await expect(built.service.setEnabled(value)).rejects.toThrow(
          new BadRequestException('enabled must be true or false'),
        );
      }
    });
  });

  describe('with the lever off (knowledge R30)', () => {
    it('neither builds nor calls a memory for a rating, a turn or a flush', async () => {
      const backend = jest.fn();
      const raw = {
        execute: jest.fn().mockResolvedValue({ rows: [] }),
        close: jest.fn(),
      };
      const store = new MastraLearningStore({
        backend,
        client: () => Promise.resolve(raw as never),
        embedder: {
          specificationVersion: 'v2',
          provider: 'openai',
          modelId: 'text-embedding-3-small',
          maxEmbeddingsPerCall: 1,
          supportsParallelCalls: true,
          doEmbed: jest.fn(),
        },
        hasEmbeddingKey: jest.fn().mockResolvedValue(true),
        summaryModel: { generate: jest.fn() },
      });
      const built = build({ store });
      db = built.db;

      await built.service.recordRating(rating());
      await built.service.recordRating(
        rating({ rating: 'down', note: 'Wrong player.' }),
      );
      await built.service.idle();
      const learned = await built.service.learnedContext(
        ['ds-1'],
        'Goals in 2022?',
      );
      await built.outbox.flush();

      expect(learned).toBeUndefined();
      expect(await built.signalDocs.find({})).toEqual([]);
      expect(backend).not.toHaveBeenCalled();
    });

    it('recalls nothing and sends no block', async () => {
      const built = build();
      db = built.db;

      expect(
        await built.service.learnedContext(['ds-1'], 'Goals?'),
      ).toBeUndefined();
      expect(built.store.recall).not.toHaveBeenCalled();
      expect(built.store.mentalModels).not.toHaveBeenCalled();
    });

    it('forgets what an earlier rating of the answer retained, without compacting', async () => {
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;
      await built.service.recordRating(rating());
      await built.outbox.flush();
      await built.settings.setEnabled(false);

      await built.service.recordRating(rating({ rating: 'down' }));
      await built.service.idle();

      expect(await built.signalDocs.find({})).toEqual([]);
      expect(built.store.forget).toHaveBeenCalledWith(
        'ds-1',
        `rating:s1:${ANSWER_AT}`,
      );
      expect(built.maintenance.compact).not.toHaveBeenCalled();
    });
  });

  describe('with the lever on, a rating (knowledge R31 to R33, R39)', () => {
    it('writes an approval for a thumbs-up, its SQL redacted', async () => {
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;

      await built.service.recordRating(rating());

      const [row] = await built.signalDocs.find({});
      expect(row).toEqual(
        expect.objectContaining({
          documentId: `rating:s1:${ANSWER_AT}`,
          kind: 'verified_query',
          datasourceId: 'ds-1',
          datasetIds: ['football'],
          entities: ['main.football.goals'],
          occurredAt: ANSWER_AT,
          status: 'pending',
          content: [
            '[verified_query · 2026-10-05]',
            'Question: How many goals did Lionel Messi score in 2022?',
            "Approved SQL: SELECT count(*) FROM goals WHERE player = 'Lionel Messi' AND type <> 'own_goal' AND scorer_email = '?'",
          ].join('\n'),
        }),
      );
    });

    it('writes a rejection for a thumbs-down, with its note only when it has one', async () => {
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;

      await built.service.recordRating(
        rating({ rating: 'down', note: 'It counted own goals.' }),
      );
      let [row] = await built.signalDocs.find({});
      expect(row.kind).toBe('rejection');
      expect(row.content.split('\n').slice(2)).toEqual([
        expect.stringMatching(/^Rejected SQL \(do not reuse\): /),
        'Analyst note: It counted own goals.',
      ]);

      await built.service.recordRating(rating({ rating: 'down' }));
      [row] = await built.signalDocs.find({});
      expect(row.content).not.toContain('Analyst note');
    });

    it('replaces the answer’s one row when it is rated again', async () => {
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;

      await built.service.recordRating(rating());
      await built.service.recordRating(rating({ rating: 'down' }));
      await built.service.recordRating(rating({ rating: 'up' }));

      const rows = await built.signalDocs.find({});
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe('verified_query');
    });

    it('retains nothing without one datasource, a question or SQL', async () => {
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;

      await built.service.recordRating(rating({ datasourceId: undefined }));
      await built.service.recordRating(rating({ sql: undefined }));
      await built.service.recordRating(rating({ question: '  ' }));
      await built.service.idle();

      expect(await built.signalDocs.find({})).toEqual([]);
    });
  });

  describe('the learned block of a turn (agents.md 4.1)', () => {
    const signal = (id: string, day: string): RecalledSignal => ({
      documentId: id,
      kind: 'verified_query',
      content: `[verified_query · ${day}]\nQuestion: q ${id}\nApproved SQL: SELECT 1`,
      occurredAt: `${day}T10:00:00.000Z`,
    });

    it('recalls each datasource once and builds the block', async () => {
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;
      built.store.recall.mockImplementation((scope: string) =>
        Promise.resolve(
          scope === 'ds-1' ? [signal('rating:a:1', '2026-10-01')] : [],
        ),
      );
      built.store.mentalModels.mockImplementation((scope: string) =>
        Promise.resolve(scope === 'ds-2' ? 'Known pitfalls\n- x' : null),
      );

      const learned = await built.service.learnedContext(
        ['ds-1', 'ds-2', 'ds-1'],
        'Goals?',
      );

      expect(built.store.recall.mock.calls).toEqual([
        ['ds-1', 'Goals?'],
        ['ds-2', 'Goals?'],
      ]);
      expect(
        learned?.block.startsWith(
          `${LEARNED_BLOCK_HEADING}\nSummary:\nKnown pitfalls`,
        ),
      ).toBe(true);
      expect(learned?.used.map((u) => u.id)).toEqual([
        'summary:ds-2',
        'rating:a:1',
      ]);
    });

    it('leaves out a memory that does not answer within 2.5 seconds', async () => {
      jest.useFakeTimers();
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;
      built.store.recall.mockImplementation((scope: string) =>
        scope === 'ds-1'
          ? Promise.resolve([signal('rating:a:1', '2026-10-01')])
          : new Promise(() => undefined),
      );

      const learned = built.service.learnedContext(['ds-1', 'ds-2'], 'Goals?');
      await jest.advanceTimersByTimeAsync(TURN_RECALL_TIMEOUT_MS);

      expect((await learned)?.used.map((u) => u.id)).toEqual(['rating:a:1']);
    });

    it('sends no block when nothing was recalled', async () => {
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;

      expect(
        await built.service.learnedContext(['ds-1'], 'Goals?'),
      ).toBeUndefined();
    });
  });

  describe('Forget (api.md 110, knowledge R40)', () => {
    it('refuses an id that is not a signal’s', async () => {
      const built = build();
      db = built.db;

      await expect(built.service.forgetSignal('knowledge:k1')).rejects.toThrow(
        new BadRequestException('Unknown memory signal id'),
      );
    });

    it('deletes the outbox rows, then the store’s copies, then compacts both files', async () => {
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;
      await built.service.recordRating(rating());
      await built.outbox.flush();
      const order: string[] = [];
      built.store.forget.mockImplementation(async () => {
        const rows = await built.signalDocs.find({});
        order.push(`forget with ${rows.length} row(s)`);
      });
      built.maintenance.compact.mockImplementation(() => {
        order.push('compact mastra.sqlite');
        return Promise.resolve();
      });
      built.appStore.compact.mockImplementation(() => {
        order.push('compact app.sqlite');
        return Promise.resolve();
      });

      await built.service.forgetSignal(`rating:s1:${ANSWER_AT}`);

      expect(built.store.forget).toHaveBeenCalledWith(
        'ds-1',
        `rating:s1:${ANSWER_AT}`,
      );
      expect(order).toEqual([
        'forget with 0 row(s)',
        'compact mastra.sqlite',
        'compact app.sqlite',
      ]);
      expect(await built.settings.compactionPending()).toBe(false);
    });

    it('also forgets a copy the store holds with no outbox row', async () => {
      const built = build();
      db = built.db;
      built.maintenance.scopesHolding.mockResolvedValue(['ds-7']);

      await built.service.forgetSignal('rating:s9:x');

      expect(built.store.forget).toHaveBeenCalledWith('ds-7', 'rating:s9:x');
      expect(built.maintenance.compact).toHaveBeenCalled();
    });

    it('changes nothing for an unknown or already forgotten id', async () => {
      const built = build();
      db = built.db;

      await built.service.forgetSignal('rating:none:x');

      expect(built.store.forget).not.toHaveBeenCalled();
      expect(built.maintenance.compact).not.toHaveBeenCalled();
    });

    it('runs a failed compaction again at the next start', async () => {
      const built = build();
      db = built.db;
      built.maintenance.scopesHolding.mockResolvedValue(['ds-1']);
      built.maintenance.compact.mockRejectedValueOnce(
        new Error('database is locked'),
      );

      await built.service.forgetSignal('rating:s1:x');
      expect(await built.settings.compactionPending()).toBe(true);

      built.service.onApplicationBootstrap();
      await built.service.idle();

      expect(built.maintenance.compact).toHaveBeenCalledTimes(2);
      expect(built.appStore.compact).toHaveBeenCalledTimes(1);
      expect(await built.settings.compactionPending()).toBe(false);
    });
  });

  describe('a deleted datasource (knowledge R41)', () => {
    it('forgets its rows and its whole learning memory, then compacts', async () => {
      const built = build({ enabled: true });
      db = built.db;
      await built.ready;
      await built.service.recordRating(rating());
      await built.service.recordRating(
        rating({ sessionId: 's2', datasourceId: 'ds-2' }),
      );
      built.maintenance.holdsScope.mockResolvedValue(true);

      await built.service.forgetDatasource('ds-1');

      expect(
        (await built.signalDocs.find({})).map((r) => r.datasourceId),
      ).toEqual(['ds-2']);
      expect(built.store.forget).toHaveBeenCalledWith('ds-1');
      expect(built.maintenance.compact).toHaveBeenCalled();
      expect(built.appStore.compact).toHaveBeenCalled();
    });

    it('does nothing for a datasource the memory never held', async () => {
      const built = build();
      db = built.db;

      await built.service.forgetDatasource('ds-1');

      expect(built.store.forget).not.toHaveBeenCalled();
      expect(built.maintenance.compact).not.toHaveBeenCalled();
    });

    it('never throws', async () => {
      const built = build();
      db = built.db;
      built.maintenance.holdsScope.mockRejectedValue(
        new Error('disk I/O error'),
      );

      await expect(
        built.service.forgetDatasource('ds-1'),
      ).resolves.toBeUndefined();
    });
  });

  it('removes the scopes a stopped eval run left at start-up', async () => {
    const built = build();
    db = built.db;

    built.service.onApplicationBootstrap();
    await built.service.idle();

    expect(built.maintenance.removeEvalScopes).toHaveBeenCalledTimes(1);
  });
});
