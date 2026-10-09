import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { BuiltinAgentPinsRepository } from './repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from './repositories/user-agents.repository';
import {
  hasUnpublishedChanges,
  missingDatasets,
  normalizeAgentConfig,
  UserAgentsService,
} from './user-agents.service';
import type {
  BuiltinAgentPinsDoc,
  UserAgentDoc,
} from './entities/user-agent.entity';

/** Real `SqliteDocStore`s over an in-memory database, as in the knowledge
 * repository spec; only the dataset catalogue is stubbed. */
function build(datasetNames: string[] = ['World Cup Core']) {
  const db = new BetterSqlite3(':memory:');
  const agents = new SqliteDocStore<UserAgentDoc>(db, 'agents');
  const settings = new SqliteDocStore<BuiltinAgentPinsDoc>(db, 'settings');
  const datasets = {
    list: jest.fn().mockResolvedValue(datasetNames.map((name) => ({ name }))),
  } as unknown as DatasetsRepository;
  const service = new UserAgentsService(
    new UserAgentsRepository(agents),
    new BuiltinAgentPinsRepository(settings),
    datasets,
  );
  return { db, service, settings };
}

describe('normalizeAgentConfig', () => {
  it('trims and clips text to the R43 limits', () => {
    const config = normalizeAgentConfig({
      name: `  ${'n'.repeat(80)}  `,
      description: 'd'.repeat(300),
      instructions: 'i'.repeat(4100),
    });
    expect(config.name).toHaveLength(64);
    expect(config.description).toHaveLength(280);
    expect(config.instructions).toHaveLength(4000);
  });

  it('de-duplicates datasets and keeps at most five non-blank starter questions', () => {
    const config = normalizeAgentConfig({
      name: 'Analyst',
      datasets: [' World Cup Core ', 'World Cup Core', '', 'Stats'],
      starterQuestions: [
        'q1',
        ' ',
        'q1',
        'q2',
        'q3',
        'q4',
        'q5',
        'q6',
        'x'.repeat(250),
      ],
    });
    expect(config.datasets).toEqual(['World Cup Core', 'Stats']);
    expect(config.starterQuestions).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
  });

  it('clips a long starter question to 200 characters', () => {
    const config = normalizeAgentConfig({
      name: 'Analyst',
      starterQuestions: ['x'.repeat(250)],
    });
    expect(config.starterQuestions).toEqual(['x'.repeat(200)]);
  });

  it('keeps model and a known reasoning effort, drops blanks and unknowns', () => {
    expect(
      normalizeAgentConfig({
        name: 'A',
        model: ' gpt-5 ',
        reasoningEffort: 'low',
      }),
    ).toMatchObject({ model: 'gpt-5', reasoningEffort: 'low' });
    const config = normalizeAgentConfig({
      name: 'A',
      model: '  ',
      reasoningEffort: 'extreme' as never,
    });
    expect(config).not.toHaveProperty('model');
    expect(config).not.toHaveProperty('reasoningEffort');
  });
});

describe('hasUnpublishedChanges / missingDatasets', () => {
  const draft = normalizeAgentConfig({ name: 'A', datasets: ['Core'] });

  it('is false for a draft-only agent and for a Live agent equal to its draft', () => {
    expect(hasUnpublishedChanges({ draft })).toBe(false);
    expect(hasUnpublishedChanges({ draft, live: { ...draft } })).toBe(false);
  });

  it('is true when the Live version differs from the draft', () => {
    expect(
      hasUnpublishedChanges({
        draft: { ...draft, instructions: 'new' },
        live: draft,
      }),
    ).toBe(true);
  });

  it('lists the configured dataset names that no longer exist', () => {
    expect(
      missingDatasets(
        { ...draft, datasets: ['Core', 'Gone'] },
        new Set(['Core']),
      ),
    ).toEqual(['Gone']);
  });
});

describe('UserAgentsService', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  afterEach(() => ctx.db.close());

  it('creates an unpinned draft with a generated id', async () => {
    const agent = await ctx.service.create({
      name: ' Health plan analyst ',
      datasets: ['World Cup Core'],
    });
    expect(agent.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(agent.pinned).toBe(false);
    expect(agent.live).toBeUndefined();
    expect(agent.draft.name).toBe('Health plan analyst');
    expect(await ctx.service.get(agent.id)).toMatchObject({ id: agent.id });
  });

  it('requires a name', async () => {
    await expect(ctx.service.create({ name: '   ' })).rejects.toThrow(
      'Agent name is required',
    );
  });

  it('refuses a name already used by another user agent, ignoring case', async () => {
    const first = await ctx.service.create({ name: 'Health plan analyst' });
    await expect(
      ctx.service.create({ name: 'health plan analyst' }),
    ).rejects.toThrow('An agent named "health plan analyst" already exists');
    const other = await ctx.service.create({ name: 'Other' });
    await expect(
      ctx.service.saveDraft(other.id, { name: 'HEALTH PLAN ANALYST' }),
    ).rejects.toThrow('An agent named "HEALTH PLAN ANALYST" already exists');
    // Re-saving an agent under its own name is fine.
    await expect(
      ctx.service.saveDraft(first.id, { name: 'Health Plan Analyst' }),
    ).resolves.toMatchObject({ draft: { name: 'Health Plan Analyst' } });
  });

  it('publishes by copying the draft to Live and stamping publishedAt', async () => {
    const agent = await ctx.service.create({
      name: 'Analyst',
      instructions: 'v1',
      datasets: ['World Cup Core'],
    });
    const published = await ctx.service.publish(agent.id);
    expect(published.live).toEqual(published.draft);
    expect(published.publishedAt).toEqual(expect.any(String));
    expect(hasUnpublishedChanges(published)).toBe(false);
  });

  it('keeps the Live version when the draft changes, until the next publish', async () => {
    const agent = await ctx.service.create({
      name: 'Analyst',
      instructions: 'v1',
      datasets: ['World Cup Core'],
    });
    await ctx.service.publish(agent.id);
    const edited = await ctx.service.saveDraft(agent.id, {
      name: 'Analyst',
      instructions: 'v2',
      datasets: ['World Cup Core'],
    });
    expect(edited.live?.instructions).toBe('v1');
    expect(edited.draft.instructions).toBe('v2');
    expect(hasUnpublishedChanges(edited)).toBe(true);
    const republished = await ctx.service.publish(agent.id);
    expect(republished.live?.instructions).toBe('v2');
  });

  it('refuses to publish without a dataset', async () => {
    const agent = await ctx.service.create({ name: 'Analyst' });
    await expect(ctx.service.publish(agent.id)).rejects.toThrow(
      'Select at least one dataset to publish',
    );
  });

  it('answers "not found" for an unknown id on every mutation', async () => {
    const message = 'Agent "nope" not found';
    await expect(ctx.service.saveDraft('nope', { name: 'A' })).rejects.toThrow(
      message,
    );
    await expect(ctx.service.publish('nope')).rejects.toThrow(message);
    await expect(ctx.service.delete('nope')).rejects.toThrow(message);
    await expect(ctx.service.setPinned('nope', true)).rejects.toThrow(message);
  });

  it('pins and unpins a user agent and deletes it', async () => {
    const agent = await ctx.service.create({ name: 'Analyst' });
    expect((await ctx.service.setPinned(agent.id, true)).pinned).toBe(true);
    expect((await ctx.service.setPinned(agent.id, false)).pinned).toBe(false);
    const deleted = await ctx.service.delete(agent.id);
    expect(deleted.draft.name).toBe('Analyst');
    expect(await ctx.service.get(agent.id)).toBeNull();
    expect(await ctx.service.list()).toEqual([]);
  });

  it('stores built-in pins in one settings document without touching the LLM one', async () => {
    await ctx.settings.insert({ key: 'llm' } as never);
    expect(await ctx.service.builtinPins()).toEqual([]);
    await ctx.service.setBuiltinPin('assistant', true);
    await ctx.service.setBuiltinPin('sql-fixer', true);
    await ctx.service.setBuiltinPin('assistant', true);
    expect(await ctx.service.builtinPins()).toEqual(['assistant', 'sql-fixer']);
    await ctx.service.setBuiltinPin('assistant', false);
    expect(await ctx.service.builtinPins()).toEqual(['sql-fixer']);
    const docs = await ctx.settings.find();
    expect(docs.map((doc) => doc.key).sort()).toEqual([
      'builtin-agent-pins',
      'llm',
    ]);
  });

  it('reports the dataset names that exist', async () => {
    expect(await ctx.service.datasetNames()).toEqual(
      new Set(['World Cup Core']),
    );
  });
});
