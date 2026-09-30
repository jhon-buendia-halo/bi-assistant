import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import { ReasoningFeedbackRepository } from './reasoning-feedback.repository';
import type {
  ReasoningBlock,
  ReasoningFeedbackDoc,
} from '../entities/reasoning-trace.entity';

const SQL_BLOCK: ReasoningBlock = {
  kind: 'sql',
  sql: 'SELECT 1',
  annotations: [],
  confidence: { score: 0.9, band: 'high', signals: [] },
};

const key = (block: ReasoningBlock['kind'] = 'sql', sessionId = 's-1') => ({
  sessionId,
  messageAt: '2026-09-29T10:00:00.000Z',
  block,
});

const context = {
  traceId: 'trace-1',
  question: 'How many employees?',
  blockSnapshot: SQL_BLOCK,
};

/** Real `SqliteDocStore` over an in-memory database, as the knowledge repo spec does. */
function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<ReasoningFeedbackDoc>(
    db,
    'reasoning_feedback',
  );
  return { repository: new ReasoningFeedbackRepository(store), db };
}

describe('ReasoningFeedbackRepository', () => {
  let db: BetterSqlite3.Database;
  let repository: ReasoningFeedbackRepository;

  beforeEach(() => {
    ({ repository, db } = build());
  });

  afterEach(() => {
    jest.useRealTimers();
    db.close();
  });

  it('inserts a rating with the question and the rated block copied in', async () => {
    const saved = await repository.upsert(key(), context, { vote: 'up' });

    expect(saved).toEqual(
      expect.objectContaining({
        sessionId: 's-1',
        messageAt: '2026-09-29T10:00:00.000Z',
        block: 'sql',
        traceId: 'trace-1',
        vote: 'up',
        question: 'How many employees?',
        blockSnapshot: SQL_BLOCK,
      }),
    );
    expect(saved.id).toEqual(expect.any(String));
    expect(saved.createdAt).toEqual(expect.any(String));
    await expect(repository.get(key())).resolves.toEqual(saved);
  });

  it('upserts by (session, message, block) — re-rating never forks', async () => {
    const first = await repository.upsert(key(), context, { vote: 'up' });
    const second = await repository.upsert(key(), context, { vote: 'down' });

    expect(second.id).toBe(first.id);
    expect(second.vote).toBe('down');
    await expect(repository.list()).resolves.toHaveLength(1);
    // A different block of the same answer is its own rating.
    await repository.upsert(key('metric'), context, { vote: 'up' });
    await expect(repository.list()).resolves.toHaveLength(2);
  });

  it('changes only the fields sent (PATCH semantics)', async () => {
    await repository.upsert(key(), context, { vote: 'up' });

    const commented = await repository.upsert(key(), context, {
      comment: '  Should exclude contractors.  ',
    });

    expect(commented).toEqual(
      expect.objectContaining({
        vote: 'up',
        comment: 'Should exclude contractors.',
      }),
    );
  });

  it('clears the vote on null and the comment on null or empty', async () => {
    await repository.upsert(key(), context, { vote: 'down', comment: 'Wrong' });

    const unvoted = await repository.upsert(key(), context, { vote: null });
    expect(unvoted).not.toHaveProperty('vote');
    expect(unvoted.comment).toBe('Wrong');

    const cleared = await repository.upsert(key(), context, { comment: '' });
    expect(cleared).not.toHaveProperty('comment');
    const stored = await repository.get(key());
    expect(stored).not.toHaveProperty('vote');
    expect(stored).not.toHaveProperty('comment');
  });

  it('lists newest first, optionally for one session', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    await repository.upsert(key('sql', 's-1'), context, { vote: 'up' });
    jest.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
    await repository.upsert(key('sql', 's-2'), context, { vote: 'down' });
    jest.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
    await repository.upsert(key('metric', 's-1'), context, { vote: 'up' });

    const all = await repository.list();
    expect(all.map((d) => `${d.sessionId}/${d.block}`)).toEqual([
      's-1/metric',
      's-2/sql',
      's-1/sql',
    ]);
    const one = await repository.list('s-1');
    expect(one.map((d) => d.block)).toEqual(['metric', 'sql']);
  });
});
