import BetterSqlite3 from 'better-sqlite3';
import {
  consolidateOwners,
  renameLegacyFields,
  renameLegacyTables,
} from './database.module';

/**
 * Guards the two rename migrations. `SqliteDocStore` creates a missing table
 * and every read path looks at the current key, so a miss here is silent:
 * an existing install just comes back empty.
 */
describe('legacy datastore migrations', () => {
  let db: BetterSqlite3.Database;

  const createTable = (table: string) =>
    db
      .prepare(
        `CREATE TABLE "${table}" (rid INTEGER PRIMARY KEY AUTOINCREMENT, doc TEXT NOT NULL)`,
      )
      .run();

  const insert = (table: string, doc: object) =>
    db
      .prepare(`INSERT INTO "${table}" (doc) VALUES (?)`)
      .run(JSON.stringify(doc));

  const docs = (table: string) =>
    db
      .prepare(`SELECT doc FROM "${table}"`)
      .all()
      .map(
        (r) =>
          JSON.parse((r as { doc: string }).doc) as Record<string, unknown>,
      );

  const tables = () =>
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((r) => (r as { name: string }).name);

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
  });

  afterEach(() => db.close());

  it('renames the sandbox_selections table to datasets', () => {
    createTable('sandbox_selections');
    insert('sandbox_selections', { name: 'World Cup', tables: ['a.b.c'] });

    renameLegacyTables(db);

    expect(tables()).toContain('datasets');
    expect(tables()).not.toContain('sandbox_selections');
    expect(docs('datasets')).toEqual([
      { name: 'World Cup', tables: ['a.b.c'] },
    ]);
  });

  it('leaves the legacy table alone when the new one already exists', () => {
    createTable('sandbox_selections');
    createTable('datasets');
    insert('datasets', { name: 'current' });

    renameLegacyTables(db);

    expect(tables()).toContain('sandbox_selections');
    expect(docs('datasets')).toEqual([{ name: 'current' }]);
  });

  it('rewrites the session `sandboxes` key to `datasets` as an array', () => {
    createTable('sessions');
    insert('sessions', {
      id: 's1',
      name: 'World Cup analysis',
      sandboxes: ['World Cup', 'Players'],
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    renameLegacyFields(db);

    expect(docs('sessions')).toEqual([
      {
        id: 's1',
        name: 'World Cup analysis',
        // Still an array, not the stringified `["World Cup","Players"]` that
        // `json_set` would write without the `json()` wrapper.
        datasets: ['World Cup', 'Players'],
        // Rewritten in raw SQL, so recency ordering survives the migration.
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('leaves already-migrated and unrelated sessions untouched', () => {
    createTable('sessions');
    insert('sessions', { id: 's1', datasets: ['current'] });
    insert('sessions', { id: 's2', datasets: ['new'], sandboxes: ['old'] });

    renameLegacyFields(db);

    expect(docs('sessions')).toEqual([
      { id: 's1', datasets: ['current'] },
      { id: 's2', datasets: ['new'], sandboxes: ['old'] },
    ]);
  });

  it('is a no-op when the table does not exist yet', () => {
    expect(() => renameLegacyFields(db)).not.toThrow();
    expect(() => renameLegacyTables(db)).not.toThrow();
  });

  describe('M14: one super admin owns everything (ADR-0030)', () => {
    const PRIVATE = [
      'sessions',
      'verified_queries',
      'metrics',
      'eval_runs',
      'knowledge_snippets',
      'agents',
      'skills',
    ];
    const IDENTITY = [
      'users',
      'groups',
      'group_members',
      'role_assignments',
      'group_role_mappings',
      'auth_sessions',
      'activity_events',
    ];

    it('is a no-op on a fresh database', () => {
      expect(() => consolidateOwners(db)).not.toThrow();
      expect(tables().sort()).toEqual([].sort());
    });

    it("stamps ownerId 'local' on every private document, ownerless or another user's", () => {
      for (const table of PRIVATE) {
        createTable(table);
        insert(table, { id: 'legacy', updatedAt: '2026-01-01T00:00:00.000Z' });
        insert(table, { id: 'theirs', ownerId: 'local-mark' });
        insert(table, { id: 'mine', ownerId: 'local' });
      }
      createTable('connections');
      insert('connections', { id: 'shared' });

      consolidateOwners(db);

      for (const table of PRIVATE) {
        expect(docs(table)).toEqual([
          // updatedAt is not restamped: raw SQL.
          {
            id: 'legacy',
            updatedAt: '2026-01-01T00:00:00.000Z',
            ownerId: 'local',
          },
          { id: 'theirs', ownerId: 'local' },
          { id: 'mine', ownerId: 'local' },
        ]);
      }
      // Shared collections are never owned.
      expect(docs('connections')).toEqual([{ id: 'shared' }]);
    });

    it("renames the local user's settings to the bare keys and deletes the others'", () => {
      createTable('settings');
      insert('settings', { key: 'llm', provider: 'openai' });
      insert('settings', { key: 'ui-preferences:local', theme: 'dark' });
      insert('settings', { key: 'ui-preferences:ada', theme: 'light' });
      insert('settings', {
        key: 'builtin-agent-pins:local',
        pinned: ['assistant'],
      });
      insert('settings', { key: 'builtin-agent-pins:ada', pinned: ['rfp'] });

      consolidateOwners(db);

      expect(docs('settings')).toEqual([
        { key: 'llm', provider: 'openai' },
        { key: 'ui-preferences', theme: 'dark' },
        { key: 'builtin-agent-pins', pinned: ['assistant'] },
      ]);
    });

    it('keeps an existing bare key and still deletes the suffixed copies', () => {
      createTable('settings');
      insert('settings', { key: 'ui-preferences', theme: 'dark' });
      insert('settings', { key: 'ui-preferences:local', theme: 'light' });
      insert('settings', { key: 'ui-preferences:ada', theme: 'light' });

      consolidateOwners(db);

      expect(docs('settings')).toEqual([
        { key: 'ui-preferences', theme: 'dark' },
      ]);
    });

    it('drops the seven identity tables and leaves other tables alone', () => {
      for (const table of [...IDENTITY, 'connections']) createTable(table);
      insert('users', { id: 'ada' });

      consolidateOwners(db);

      expect(tables().sort()).toEqual(
        ['connections', 'sqlite_sequence'].sort(),
      );
    });

    describe('two personas with a skill name clash', () => {
      const agent = (
        id: string,
        ownerId: string,
        draft: string,
        live?: string,
        liveSkills?: object[],
      ) => ({
        id,
        ownerId,
        draft: { name: id, instructions: draft },
        ...(live === undefined
          ? {}
          : { live: { name: id, instructions: live } }),
        ...(liveSkills ? { liveSkills } : {}),
      });

      beforeEach(() => {
        createTable('skills');
        createTable('agents');
        insert('skills', {
          id: 's-local',
          name: 'fiscal-calendar',
          ownerId: 'local',
          createdAt: '2026-01-01T00:00:00.000Z',
        });
        insert('skills', {
          id: 's-ada',
          name: 'fiscal-calendar',
          ownerId: 'ada',
          createdAt: '2026-01-02T00:00:00.000Z',
        });
        insert('skills', {
          id: 's-bob',
          name: 'fiscal-calendar',
          ownerId: 'bob',
          createdAt: '2026-01-03T00:00:00.000Z',
        });
        insert('skills', {
          id: 's-ada-2',
          name: 'glossary',
          ownerId: 'ada',
          createdAt: '2026-01-04T00:00:00.000Z',
        });
        insert(
          'agents',
          agent(
            'mine',
            'local',
            'Use [[skill:fiscal-calendar]].',
            'Use [[skill:fiscal-calendar]].',
          ),
        );
        insert(
          'agents',
          agent(
            'adas',
            'ada',
            'Use [[skill:fiscal-calendar]] and [[skill:glossary]] and [[tool:sample_rows]].',
            'Live [[skill:fiscal-calendar]].',
            [{ id: 's-ada', name: 'fiscal-calendar', body: 'b', files: [] }],
          ),
        );
        insert(
          'agents',
          agent('bobs', 'bob', 'Use [[skill:fiscal-calendar]].'),
        );
      });

      it('suffixes the clashing names in creation order and keeps the local one', () => {
        consolidateOwners(db);

        expect(docs('skills').map((d) => [d.id, d.name, d.ownerId])).toEqual([
          ['s-local', 'fiscal-calendar', 'local'],
          ['s-ada', 'fiscal-calendar-2', 'local'],
          ['s-bob', 'fiscal-calendar-3', 'local'],
          ['s-ada-2', 'glossary', 'local'],
        ]);
      });

      it("rewrites [[skill:old]] links in the former owner's agents only, draft and live", () => {
        consolidateOwners(db);

        const byId = Object.fromEntries(
          docs('agents').map((d) => [d.id as string, d]),
        );
        const text = (id: string, key: 'draft' | 'live') =>
          (byId[id][key] as { instructions: string }).instructions;
        expect(text('mine', 'draft')).toBe('Use [[skill:fiscal-calendar]].');
        expect(text('mine', 'live')).toBe('Use [[skill:fiscal-calendar]].');
        expect(text('adas', 'draft')).toBe(
          'Use [[skill:fiscal-calendar-2]] and [[skill:glossary]] and [[tool:sample_rows]].',
        );
        expect(text('adas', 'live')).toBe('Live [[skill:fiscal-calendar-2]].');
        expect(text('bobs', 'draft')).toBe('Use [[skill:fiscal-calendar-3]].');
        // The Live skill copy follows its skill's new name.
        expect(
          (byId['adas'].liveSkills as { name: string }[]).map((s) => s.name),
        ).toEqual(['fiscal-calendar-2']);
        expect(Object.values(byId).every((d) => d.ownerId === 'local')).toBe(
          true,
        );
      });

      it('is idempotent: a second run changes nothing', () => {
        consolidateOwners(db);
        const skills = docs('skills');
        const agents = docs('agents');

        consolidateOwners(db);

        expect(docs('skills')).toEqual(skills);
        expect(docs('agents')).toEqual(agents);
      });
    });

    it('leaves non-clashing skills of other users unrenamed and keeps names within 64 characters', () => {
      createTable('skills');
      const long = 'x'.repeat(64);
      insert('skills', { id: 'a', name: long, ownerId: 'local' });
      insert('skills', { id: 'b', name: long, ownerId: 'ada' });
      insert('skills', { id: 'c', name: 'unique', ownerId: 'ada' });

      consolidateOwners(db);

      const names = docs('skills').map((d) => d.name as string);
      expect(names[0]).toBe(long);
      expect(names[1]).toBe(`${'x'.repeat(62)}-2`);
      expect(names[1]).toHaveLength(64);
      expect(names[2]).toBe('unique');
    });

    it('is idempotent as a whole and skips missing tables', () => {
      createTable('sessions');
      insert('sessions', { id: 'legacy' });
      createTable('settings');
      insert('settings', { key: 'ui-preferences:local', theme: 'dark' });
      createTable('users');

      consolidateOwners(db);
      consolidateOwners(db);

      expect(docs('sessions')).toEqual([{ id: 'legacy', ownerId: 'local' }]);
      expect(docs('settings')).toEqual([
        { key: 'ui-preferences', theme: 'dark' },
      ]);
      expect(tables().sort()).toEqual(
        ['sessions', 'settings', 'sqlite_sequence'].sort(),
      );
    });
  });
});
