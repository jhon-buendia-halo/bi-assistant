import BetterSqlite3 from 'better-sqlite3';
import { OwnedDocStore } from '../../infrastructure/database/owned-doc-store';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { EvalRunsRepository } from '../agents/repositories/eval-runs.repository';
import type { EvalRunView } from '../agents/eval-runs.service';
import { KnowledgeRepository } from '../knowledge/repositories/knowledge.repository';
import type { KnowledgeSnippet } from '../knowledge/entities/knowledge-snippet.entity';
import { MetricsRepository } from '../metrics/repositories/metrics.repository';
import type { MetricDoc } from '../metrics/entities/metric.entity';
import { SessionsRepository } from '../sessions/repositories/sessions.repository';
import type { SessionDoc } from '../sessions/entities/session.entity';
import { UiPreferencesRepository } from '../ui-preferences/repositories/ui-preferences.repository';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import type { UserAgentDoc } from '../user-agents/entities/user-agent.entity';
import { VerifiedQueriesRepository } from '../verified-queries/repositories/verified-queries.repository';
import type { VerifiedQueryDoc } from '../verified-queries/entities/verified-query.entity';
import { CurrentUserService, LOCAL_USER } from './current-user.service';
import type { CurrentUser } from './entities/current-user.entity';

/**
 * Two owners per private collection (admin R29-R31, R33; data-model 3.15).
 * Every repository runs over the real SQLite adapter wrapped the way the
 * auth module wires it, with users switched through `CurrentUserService`.
 * Local mode scopes exactly like an org server (ADR-0012): Demo User (id
 * `local`) is one more owner, and nothing runs outside a signed-in user.
 */
const user = (id: string): CurrentUser => ({
  id,
  displayName: id,
  email: `${id}@contoso.test`,
  initials: id.slice(0, 1).toUpperCase(),
  roles: [{ role: 'user', source: 'implicit' }],
  permissions: ['use-agents'],
});
const ADA = user('ada');
const BOB = user('bob');

let db: BetterSqlite3.Database;
let users: CurrentUserService;

function stores<T extends object>(table: string) {
  const raw = new SqliteDocStore<T>(db, table);
  return { raw, owned: new OwnedDocStore<T>(raw, () => users.ownerScope()) };
}

const as = <T>(who: CurrentUser, fn: () => Promise<T>): Promise<T> =>
  users.runAs(who, fn);

beforeEach(() => {
  db = new BetterSqlite3(':memory:');
  users = new CurrentUserService();
});
afterEach(() => db.close());

/**
 * The shared contract: Bob can't read, list, change or delete Ada's item;
 * an item stored without an owner is nobody's (M13 gives local ones to Demo
 * User at startup), and nobody reads anything outside a signed-in user.
 */
async function expectPrivate<T extends object>(options: {
  raw: SqliteDocStore<T>;
  create: () => Promise<unknown>;
  legacy: T;
  list: () => Promise<unknown[]>;
  get: () => Promise<unknown>;
  /** Absent where the repository only upserts (eval runs, checked below). */
  update?: () => Promise<unknown>;
  remove: () => Promise<number>;
}) {
  await as(ADA, options.create);
  await options.raw.insert(options.legacy);

  // Bob sees nothing and can change nothing.
  await expect(as(BOB, options.list)).resolves.toEqual([]);
  await expect(as(BOB, options.get)).resolves.toBeNull();
  if (options.update) {
    await expect(as(BOB, options.update)).resolves.toBeNull();
  }
  await expect(as(BOB, options.remove)).resolves.toBe(0);

  // Ada sees her own item only, not the legacy one.
  await expect(as(ADA, options.list)).resolves.toHaveLength(1);
  await expect(as(ADA, options.get)).resolves.not.toBeNull();

  // Demo User is scoped like anyone: neither Ada's item nor the legacy one.
  await expect(as(LOCAL_USER, options.list)).resolves.toEqual([]);
  // Outside a request nobody is signed in, in local mode too.
  await expect(options.list()).rejects.toThrow('Sign in required');

  await expect(as(ADA, options.remove)).resolves.toBe(1);
}

describe('owner scoping of private collections', () => {
  it('sessions', async () => {
    const { raw, owned } = stores<SessionDoc>('sessions');
    const repo = new SessionsRepository(owned, raw);
    const session = (id: string): SessionDoc => ({
      id,
      name: id,
      datasets: ['World Cup'],
      messages: [],
      visualizations: [],
    });
    await expectPrivate({
      raw,
      create: () => repo.insert(session('s1')),
      legacy: session('legacy'),
      list: () => repo.list(),
      get: () => repo.get('s1'),
      update: () => repo.update('s1', { name: 'renamed' }),
      remove: () => repo.delete('s1'),
    });
  });

  it('sessions: startup work reads across owners', async () => {
    const { raw, owned } = stores<SessionDoc>('sessions');
    const repo = new SessionsRepository(owned, raw);
    const base = { datasets: [], messages: [], visualizations: [] };
    await as(ADA, () => repo.insert({ id: 'a', name: 'a', ...base }));
    await as(BOB, () => repo.insert({ id: 'b', name: 'b', ...base }));

    expect((await repo.listAllOwners()).map((s) => s.id).sort()).toEqual([
      'a',
      'b',
    ]);
    await repo.setWorkspaceIdAnyOwner('b', 'session-b');
    expect(await raw.findOne({ id: 'b' })).toMatchObject({
      workspaceId: 'session-b',
      ownerId: 'bob',
    });
  });

  it('agents', async () => {
    const { raw, owned } = stores<UserAgentDoc>('agents');
    const repo = new UserAgentsRepository(owned);
    const agent = (id: string): UserAgentDoc => ({
      id,
      pinned: false,
      draft: {
        name: 'Analyst',
        description: '',
        instructions: '',
        datasets: [],
        starterQuestions: [],
      },
    });
    await expectPrivate({
      raw,
      create: () => repo.insert(agent('a1')),
      legacy: agent('legacy'),
      list: () => repo.list(),
      get: () => repo.get('a1'),
      update: () => repo.update('a1', { pinned: true }),
      remove: () => repo.delete('a1'),
    });
  });

  it('knowledge snippets', async () => {
    const { raw, owned } = stores<KnowledgeSnippet>('knowledge_snippets');
    const repo = new KnowledgeRepository(owned);
    const snippet = (id: string): KnowledgeSnippet => ({
      id,
      kind: 'term',
      scope: { datasetId: 'World Cup' },
      title: 'DNF',
      body: 'Did not finish',
      enabled: true,
      source: 'user',
      createdAt: '2026-10-10T00:00:00.000Z',
      updatedAt: '2026-10-10T00:00:00.000Z',
    });
    await expectPrivate({
      raw,
      create: () => repo.insert(snippet('k1')),
      legacy: snippet('legacy'),
      list: () => repo.list(),
      get: () => repo.get('k1'),
      update: () => repo.update('k1', { enabled: false }),
      remove: () => repo.delete('k1'),
    });
  });

  it('metrics, with names unique per owner', async () => {
    const { raw, owned } = stores<MetricDoc>('metrics');
    const repo = new MetricsRepository(owned);
    const metric = (id: string): MetricDoc => ({
      id,
      name: 'goals',
      label: 'Goals',
      entity: 'wc.public.matches',
      expression: 'SUM(goals)',
      description: 'All goals',
    });
    await expectPrivate({
      raw,
      create: () => repo.insert(metric('m1')),
      legacy: metric('legacy'),
      list: () => repo.list(),
      get: () => repo.get('m1'),
      update: () => repo.update('m1', { label: 'x' }, ['description']),
      remove: () => repo.delete('m1'),
    });

    await as(ADA, () => repo.insert(metric('m2')));
    await expect(as(BOB, () => repo.findByName('goals'))).resolves.toBeNull();
    await expect(
      as(ADA, () => repo.findByName('goals')),
    ).resolves.toMatchObject({ id: 'm2' });
  });

  it('verified queries, deduped per owner', async () => {
    const { raw, owned } = stores<VerifiedQueryDoc>('verified_queries');
    const repo = new VerifiedQueriesRepository(owned, raw);
    const pair = (id: string, question = 'q'): VerifiedQueryDoc => ({
      id,
      question,
      sql: 'SELECT 1',
      entities: [],
      sourceSessionId: 's1',
      sourceMessageAt: 't1',
    });
    await as(ADA, () => repo.save(pair('v1', 'Ada asks')));
    // Bob's thumbs-up on the same key forks into his own document instead
    // of overwriting Ada's.
    await as(BOB, () => repo.save(pair('v2', 'Bob asks')));
    await raw.insert({ ...pair('legacy'), sourceMessageAt: 't0' });

    expect((await as(ADA, () => repo.list())).map((v) => v.question)).toEqual([
      'Ada asks',
    ]);
    expect((await as(BOB, () => repo.list())).map((v) => v.question)).toEqual([
      'Bob asks',
    ]);
    expect(await raw.find({})).toHaveLength(3);
    await expect(as(LOCAL_USER, () => repo.list())).resolves.toEqual([]);

    await expect(
      as(BOB, () => repo.deleteForMessage('s1', 't1')),
    ).resolves.toBe(1);
    expect((await as(ADA, () => repo.list())).map((v) => v.question)).toEqual([
      'Ada asks',
    ]);
  });

  it('verified queries: the startup migration rewrites every owner’s documents', async () => {
    const { raw, owned } = stores<VerifiedQueryDoc>('verified_queries');
    await raw.insert({
      id: 'old',
      question: 'q',
      sql: 'SELECT 1',
      entities: [],
      sourceProjectId: 'p1',
      ownerId: 'bob',
    } as unknown as VerifiedQueryDoc);
    const repo = new VerifiedQueriesRepository(owned, raw);

    await repo.onModuleInit();

    const migrated = await raw.findOne({ id: 'old' });
    expect(migrated).toMatchObject({ sourceSessionId: 'p1', ownerId: 'bob' });
    expect(migrated).not.toHaveProperty('sourceProjectId');
  });

  it('eval runs', async () => {
    const { raw, owned } = stores<EvalRunView>('eval_runs');
    const repo = new EvalRunsRepository(owned);
    const run = (jobId: string): EvalRunView => ({
      jobId,
      agentKey: 'assistant',
      datasourceId: 'wc',
      datasets: ['World Cup'],
      caseIds: ['champion-2022'],
      status: 'completed',
      results: [],
      totalCases: 0,
      startedAt: '2026-10-10T00:00:00.000Z',
    });
    await expectPrivate({
      raw,
      create: () => repo.insert(run('j1')),
      legacy: run('legacy'),
      list: () => repo.list('assistant'),
      get: () => repo.get('j1'),
      remove: () => repo.delete('j1'),
    });

    // Bob saving a run with Ada's job id never touches Ada's run.
    await as(ADA, () => repo.insert(run('j2')));
    await as(BOB, () => repo.save({ ...run('j2'), status: 'failed' }));
    await expect(as(ADA, () => repo.get('j2'))).resolves.toMatchObject({
      status: 'completed',
    });
    await expect(
      as(ADA, () =>
        repo.mostRecentCompleted(
          'assistant',
          'x',
          'wc',
          ['World Cup'],
          ['champion-2022'],
        ),
      ),
    ).resolves.toMatchObject({ jobId: 'j2' });
    await expect(
      as(BOB, () =>
        repo.mostRecentCompleted(
          'assistant',
          'x',
          'wc',
          ['World Cup'],
          ['champion-2022'],
        ),
      ),
    ).resolves.toBeNull();
  });

  it('built-in agent pins are kept per user', async () => {
    const settings = new SqliteDocStore<Record<string, unknown>>(
      db,
      'settings',
    );
    const repo = new BuiltinAgentPinsRepository(settings as never, users);

    await as(ADA, () => repo.save(['assistant']));
    await expect(as(BOB, () => repo.get())).resolves.toEqual([]);
    await expect(as(ADA, () => repo.get())).resolves.toEqual(['assistant']);

    await as(LOCAL_USER, () => repo.save(['sql-fixer']));
    await expect(as(LOCAL_USER, () => repo.get())).resolves.toEqual([
      'sql-fixer',
    ]);
    await expect(as(ADA, () => repo.get())).resolves.toEqual(['assistant']);
    await expect(async () => repo.get()).rejects.toThrow('Sign in required');

    // Demo User's key is suffixed like everyone's (M13 renamed the old one).
    expect(await settings.findOne({ key: 'builtin-agent-pins' })).toBeNull();
    expect(
      await settings.findOne({ key: 'builtin-agent-pins:local' }),
    ).toMatchObject({ pinned: ['sql-fixer'] });
    expect(
      await settings.findOne({ key: 'builtin-agent-pins:ada' }),
    ).toMatchObject({
      pinned: ['assistant'],
    });
  });

  it('UI preferences are kept per user, Demo User under ui-preferences:local', async () => {
    const settings = new SqliteDocStore<Record<string, unknown>>(
      db,
      'settings',
    );
    const repo = new UiPreferencesRepository(settings as never, users);

    await as(LOCAL_USER, () => repo.patch({ theme: 'dark' }));
    await as(ADA, () => repo.patch({ theme: 'light' }));
    await expect(as(BOB, () => repo.get())).resolves.toBeNull();
    await expect(as(LOCAL_USER, () => repo.get())).resolves.toMatchObject({
      key: 'ui-preferences:local',
      theme: 'dark',
    });
    await expect(as(ADA, () => repo.get())).resolves.toMatchObject({
      key: 'ui-preferences:ada',
      theme: 'light',
    });
    await expect(async () => repo.get()).rejects.toThrow('Sign in required');
    expect(await settings.findOne({ key: 'ui-preferences' })).toBeNull();
  });
});
