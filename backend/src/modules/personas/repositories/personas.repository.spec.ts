import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../../infrastructure/database/sqlite-doc-store';
import { PersonasRepository } from './personas.repository';
import type { UserPersona } from '../entities/user-persona.entity';

const persona = (overrides: Partial<UserPersona> = {}): UserPersona => ({
  id: 'p1',
  name: 'Analyst',
  role: '',
  description: '',
  goals: '',
  typicalQuestions: [],
  expertise: 'intermediate',
  answerStyle: '',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

describe('PersonasRepository', () => {
  let db: BetterSqlite3.Database;
  let repository: PersonasRepository;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    repository = new PersonasRepository(
      new SqliteDocStore<UserPersona>(db, 'user_personas'),
      new SqliteDocStore(db, 'settings'),
    );
  });

  afterEach(() => db.close());

  it('inserts, gets, lists, updates and deletes', async () => {
    await repository.insert(persona());
    await expect(repository.get('p1')).resolves.toMatchObject({
      name: 'Analyst',
    });
    await expect(repository.list()).resolves.toHaveLength(1);

    const updated = await repository.update('p1', { role: 'BI' });
    expect(updated).toMatchObject({ name: 'Analyst', role: 'BI' });

    await expect(repository.delete('p1')).resolves.toBe(1);
    await expect(repository.get('p1')).resolves.toBeNull();
  });

  it('records the seed marker in settings', async () => {
    await expect(repository.isSeeded()).resolves.toBe(false);
    await repository.markSeeded();
    await expect(repository.isSeeded()).resolves.toBe(true);
    // A second mark is an upsert, not a duplicate.
    await repository.markSeeded();
    await expect(repository.isSeeded()).resolves.toBe(true);
  });
});
