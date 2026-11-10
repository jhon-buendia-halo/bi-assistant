import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import { OntologyRepository } from './ontology.repository';
import type { OntologyItem } from '../entities/ontology-item.entity';

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

/** Real `SqliteDocStore` over an in-memory database, not a hand-rolled fake. */
function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<OntologyItem>(db, 'ontology_items');
  return { repository: new OntologyRepository(store), db };
}

describe('OntologyRepository', () => {
  let db: BetterSqlite3.Database;
  let repository: OntologyRepository;

  beforeEach(() => {
    ({ repository, db } = build());
  });

  afterEach(() => db.close());

  it('inserts and retrieves an item by id', async () => {
    const inserted = await repository.insert(item());

    await expect(repository.get('item-1')).resolves.toEqual(inserted);
    await expect(repository.get('missing')).resolves.toBeNull();
  });

  it('lists everything sorted by updatedAt desc', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await repository.insert(item({ id: 'older' }));
    jest.setSystemTime(new Date('2024-06-01T00:00:00.000Z'));
    await repository.insert(item({ id: 'newer' }));
    jest.useRealTimers();

    expect((await repository.list()).map((i) => i.id)).toEqual([
      'newer',
      'older',
    ]);
  });

  it('replaces the whole document: new fields set, missing fields removed, updatedAt restamped', async () => {
    await repository.insert(
      item({ synonyms: ['dns'], mappings: [{ entity: 'a.b.c' }] }),
    );

    const saved = await repository.replace('item-1', {
      id: 'item-1',
      dataset: 'World Cup',
      kind: 'concept',
      name: 'Did not finish',
      description: 'Retired before the end',
      enabled: false,
      source: 'user',
      synonyms: ['retired'],
    });

    const stored = await repository.get('item-1');
    expect(stored).toEqual(saved);
    expect(stored).toMatchObject({
      name: 'Did not finish',
      enabled: false,
      synonyms: ['retired'],
    });
    expect(stored).not.toHaveProperty('mappings');
    expect(stored!.createdAt).toEqual(expect.any(String));
    expect(stored!.updatedAt).not.toBe('2024-01-01T00:00:00.000Z');
  });

  it('returns null when replacing a missing id', async () => {
    await expect(
      repository.replace('missing', {
        id: 'missing',
        dataset: null,
        kind: 'instruction',
        name: 'x',
        description: 'y',
        enabled: true,
        source: 'user',
      }),
    ).resolves.toBeNull();
  });

  it('deletes an item, returning the removed count', async () => {
    await repository.insert(item());

    await expect(repository.delete('item-1')).resolves.toBe(1);
    await expect(repository.delete('item-1')).resolves.toBe(0);
  });
});
