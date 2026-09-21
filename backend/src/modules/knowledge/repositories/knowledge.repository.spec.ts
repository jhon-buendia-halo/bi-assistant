import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import { KnowledgeRepository } from './knowledge.repository';
import type { KnowledgeSnippet } from '../entities/knowledge-snippet.entity';

const snippet = (overrides: Partial<KnowledgeSnippet> = {}): KnowledgeSnippet => ({
  id: 'snippet-1',
  kind: 'term',
  scope: { datasetId: 'World Cup' },
  title: 'DNF',
  body: 'Did not finish',
  enabled: true,
  source: 'user',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

/** Real `SqliteDocStore` over an in-memory database — CRUD against the
 * actual adapter, same spirit as `database.module.spec.ts`'s migration
 * tests, rather than a hand-rolled fake. */
function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<KnowledgeSnippet>(db, 'knowledge_snippets');
  const repository = new KnowledgeRepository(store);
  return { repository, db };
}

describe('KnowledgeRepository', () => {
  let db: BetterSqlite3.Database;
  let repository: KnowledgeRepository;

  beforeEach(() => {
    ({ repository, db } = build());
  });

  afterEach(() => db.close());

  it('inserts and retrieves a snippet by id', async () => {
    const inserted = await repository.insert(snippet());

    expect(inserted.id).toBe('snippet-1');
    await expect(repository.get('snippet-1')).resolves.toEqual(inserted);
  });

  it('returns null for a missing id', async () => {
    await expect(repository.get('missing')).resolves.toBeNull();
  });

  it('lists everything sorted by updatedAt desc', async () => {
    // `SqliteDocStore.insert` always stamps its own `now` (ignoring any
    // createdAt/updatedAt on the doc), so the real system clock has to move
    // between inserts for this to be meaningful.
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await repository.insert(snippet({ id: 'older' }));
    jest.setSystemTime(new Date('2024-06-01T00:00:00.000Z'));
    await repository.insert(snippet({ id: 'newer' }));
    jest.useRealTimers();

    const all = await repository.list();

    expect(all.map((s) => s.id)).toEqual(['newer', 'older']);
  });

  it('partially merges a patch, bumping updatedAt', async () => {
    await repository.insert(snippet({ enabled: false }));

    const updated = await repository.update('snippet-1', { enabled: true });

    expect(updated).toMatchObject({
      id: 'snippet-1',
      title: 'DNF',
      enabled: true,
    });
    expect(updated!.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
  });

  it('returns null when updating a missing id', async () => {
    await expect(
      repository.update('missing', { enabled: true }),
    ).resolves.toBeNull();
  });

  it('deletes a snippet, returning the removed count', async () => {
    await repository.insert(snippet());

    await expect(repository.delete('snippet-1')).resolves.toBe(1);
    await expect(repository.get('snippet-1')).resolves.toBeNull();
    await expect(repository.delete('snippet-1')).resolves.toBe(0);
  });
});
