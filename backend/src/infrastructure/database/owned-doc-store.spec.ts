import BetterSqlite3 from 'better-sqlite3';
import { OwnedDocStore } from './owned-doc-store';
import { SqliteDocStore } from './sqlite-doc-store';

interface Doc {
  id: string;
  name?: string;
  note?: string;
  ownerId?: string;
}

/**
 * Owner scoping over the real SQLite adapter (data-model 3.15). `owner` is
 * what the scope answers: a user id scopes (in both modes, including Demo
 * User's `local`), and `undefined` stands for "nobody signed in" (the scope
 * throws).
 */
function build() {
  const db = new BetterSqlite3(':memory:');
  const raw = new SqliteDocStore<Doc>(db, 'things');
  let owner: string | undefined = 'local';
  const store = new OwnedDocStore<Doc>(raw, () => {
    if (owner === undefined) throw new Error('Sign in required');
    return owner;
  });
  const as = async <T>(who: string | undefined, fn: () => Promise<T>) => {
    const previous = owner;
    owner = who;
    try {
      return await fn();
    } finally {
      owner = previous;
    }
  };
  return { db, raw, store, as };
}

describe('OwnedDocStore', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => (ctx = build()));
  afterEach(() => ctx.db.close());

  it('stamps the owner on insert, Demo User included', async () => {
    const { store, raw, as } = ctx;
    await as('a', () => store.insert({ id: '1' }));
    await as('local', () => store.insert({ id: '2' }));
    const all = await raw.find({});
    expect(all.find((d) => d.id === '1')?.ownerId).toBe('a');
    expect(all.find((d) => d.id === '2')?.ownerId).toBe('local');
  });

  it('never lets an insert claim another owner', async () => {
    const { store, raw, as } = ctx;
    await as('a', () => store.insert({ id: '1', ownerId: 'b' }));
    expect((await raw.findOne({ id: '1' }))?.ownerId).toBe('a');
  });

  it('hides one owner’s documents from another on every read', async () => {
    const { store, as } = ctx;
    await as('a', () => store.insert({ id: '1', name: 'x' }));
    await as('b', () => store.insert({ id: '2', name: 'x' }));

    expect((await as('a', () => store.find({}))).map((d) => d.id)).toEqual([
      '1',
    ]);
    expect(
      (await as('b', () => store.find({ name: 'x' }))).map((d) => d.id),
    ).toEqual(['2']);
    await expect(as('b', () => store.findOne({ id: '1' }))).resolves.toBeNull();
    // A caller cannot widen the filter by naming another owner.
    await expect(
      as('b', () => store.findOne({ id: '1', ownerId: 'a' })),
    ).resolves.toBeNull();
  });

  it('refuses to update, unset or delete another owner’s documents', async () => {
    const { store, raw, as } = ctx;
    await as('a', () => store.insert({ id: '1', note: 'keep' }));

    await expect(
      as('b', () => store.update({ id: '1' }, { note: 'gone' })),
    ).resolves.toBeNull();
    await expect(
      as('b', () => store.unset({ id: '1' }, 'note')),
    ).resolves.toBeNull();
    await expect(as('b', () => store.deleteOne({ id: '1' }))).resolves.toBe(0);
    await expect(as('b', () => store.deleteMany({}))).resolves.toBe(0);

    expect(await raw.findOne({ id: '1' })).toMatchObject({
      note: 'keep',
      ownerId: 'a',
    });
  });

  it('lets the owner update, unset and delete', async () => {
    const { store, as } = ctx;
    await as('a', () => store.insert({ id: '1', note: 'n' }));
    await expect(
      as('a', () => store.update({ id: '1' }, { name: 'y' })),
    ).resolves.toMatchObject({
      name: 'y',
      ownerId: 'a',
    });
    await expect(
      as('a', () => store.unset({ id: '1' }, 'note')),
    ).resolves.not.toHaveProperty('note');
    await expect(as('a', () => store.deleteMany({}))).resolves.toBe(1);
  });

  it('keeps an upsert inside the caller’s documents', async () => {
    const { store, raw, as } = ctx;
    await as('a', () => store.insert({ id: '1', note: 'a' }));

    await as('b', () =>
      store.update({ id: '1' }, { id: '1', note: 'b' }, { upsert: true }),
    );

    const docs = await raw.find({ id: '1' });
    expect(docs.map((d) => [d.ownerId, d.note]).sort()).toEqual([
      ['a', 'a'],
      ['b', 'b'],
    ]);
  });

  it('never moves a document to another owner through a patch', async () => {
    const { store, raw, as } = ctx;
    await as('a', () => store.insert({ id: '1' }));
    await as('a', () => store.update({ id: '1' }, { ownerId: 'b' }));
    await expect(
      as('a', () => store.unset({ id: '1' }, 'ownerId')),
    ).rejects.toThrow();
    expect((await raw.findOne({ id: '1' }))?.ownerId).toBe('a');
  });

  it('shows documents stored without an owner to nobody (M13 gives them to Demo User)', async () => {
    const { store, raw, as } = ctx;
    await raw.insert({ id: 'legacy' });

    await expect(
      as('local', () => store.findOne({ id: 'legacy' })),
    ).resolves.toBeNull();
    await expect(as('a', () => store.find({}))).resolves.toEqual([]);
    await expect(
      as('a', () => store.deleteOne({ id: 'legacy' })),
    ).resolves.toBe(0);
    // Demo User sees only their own documents, like any user.
    await as('a', () => store.insert({ id: 'theirs' }));
    await as('local', () => store.insert({ id: 'mine' }));
    expect((await as('local', () => store.find({}))).map((d) => d.id)).toEqual([
      'mine',
    ]);
  });

  it('fails closed when nobody is signed in', async () => {
    const { store, as } = ctx;
    await expect(as(undefined, () => store.find({}))).rejects.toThrow(
      'Sign in required',
    );
    await expect(
      as(undefined, () => store.insert({ id: '1' })),
    ).rejects.toThrow('Sign in required');
  });
});
