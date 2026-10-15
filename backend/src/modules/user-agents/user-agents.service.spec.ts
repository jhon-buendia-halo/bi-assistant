import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { BuiltinAgentPinsRepository } from './repositories/builtin-agent-pins.repository';
import { SkillsRepository } from '../skills/repositories/skills.repository';
import type { SkillDoc } from '../skills/entities/skill.entity';
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
  const skills = new SqliteDocStore<SkillDoc>(db, 'skills');
  const service = new UserAgentsService(
    new UserAgentsRepository(agents),
    new BuiltinAgentPinsRepository(settings),
    datasets,
    new SkillsRepository(skills),
  );
  return { db, service, settings, skills };
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

  it('ignores the tools and skills of the request (derived from the links, ADR-0024)', () => {
    const config = normalizeAgentConfig({
      name: 'A',
      tools: ['visuals'],
      skills: ['a'],
    });
    expect(config).not.toHaveProperty('tools');
    expect(config).not.toHaveProperty('skills');
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

  it('compares tool selections, reading an absent list as every tool', () => {
    const all = ['sample_rows', 'ask_clarification', 'visuals'] as const;
    expect(
      hasUnpublishedChanges({
        draft: { ...draft, tools: [...all] },
        live: draft,
      }),
    ).toBe(false);
    expect(
      hasUnpublishedChanges({
        draft: { ...draft, tools: ['sample_rows'] },
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

  it('derives the tool selection from the instructions and publishes it with the rest', async () => {
    const agent = await ctx.service.create({
      name: 'Analyst',
      datasets: ['World Cup Core'],
      instructions:
        'Try [[tool:create_visual]], [[tool:sample_rows]], [[tool:update_visual]], [[tool:run_readonly_sql]].',
      // Ignored: the links decide.
      tools: ['ask_clarification'],
    });
    expect(agent.draft.tools).toEqual(['sample_rows', 'visuals']);
    expect(agent.draft.skills).toEqual([]);
    const published = await ctx.service.publish(agent.id);
    expect(published.live?.tools).toEqual(['sample_rows', 'visuals']);
    const edited = await ctx.service.saveDraft(agent.id, {
      name: 'Analyst',
      datasets: ['World Cup Core'],
    });
    expect(edited.draft.tools).toEqual([]);
    expect(edited.live?.tools).toEqual(['sample_rows', 'visuals']);
    await expect(
      ctx.service.saveDraft(agent.id, {
        name: 'Analyst',
        instructions: '[[tool:charts]]',
      }),
    ).rejects.toThrow('Unknown tool "charts"');
    expect((await ctx.service.get(agent.id))?.draft.tools).toEqual([]);
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

describe('user agent skills (ADR-0022; R43, R44, R60)', () => {
  let ctx: ReturnType<typeof build>;
  const skill = (id: string, body = 'Body.'): SkillDoc => ({
    id,
    name: `skill-${id}`,
    description: 'Use when needed.',
    body,
    files: [{ path: 'references/a.md', content: 'A' }],
  });

  beforeEach(async () => {
    ctx = build();
    for (const id of ['a', 'b']) await ctx.skills.insert(skill(id));
  });
  afterEach(() => ctx.db.close());

  const base = { name: 'Analyst', datasets: ['World Cup Core'] };

  const link = (...ids: string[]) =>
    ids.map((id) => `[[skill:skill-${id}]]`).join(' ');

  it('derives skill ids from the links, distinct and in order, ignoring the request', async () => {
    const agent = await ctx.service.create({
      ...base,
      instructions: `${link('b', 'a', 'b')}`,
      skills: ['zzz'],
    });
    expect(agent.draft.skills).toEqual(['b', 'a']);
  });

  it('accepts a built-in on-demand skill link without counting it as a skill', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
    for (const id of ids) await ctx.skills.insert(skill(id));
    const agent = await ctx.service.create({
      ...base,
      instructions: `[[skill:curated-knowledge]] ${link(...ids)}`,
    });
    expect(agent.draft.skills).toEqual(ids);
    const only = await ctx.service.create({
      ...base,
      name: 'Other',
      instructions: 'See [[skill:curated-knowledge]].',
    });
    expect(only.draft.skills).toEqual([]);
  });

  it('refuses an unknown skill, more than ten skills, then an unknown tool, by name', async () => {
    await expect(
      ctx.service.create({
        ...base,
        instructions: `${link('a')} [[skill:zzz]] [[tool:nope]]`,
      }),
    ).rejects.toThrow('Unknown skill "zzz"');
    await expect(
      ctx.service.create({ ...base, instructions: '[[tool:nope]]' }),
    ).rejects.toThrow('Unknown tool "nope"');
    const ids = Array.from({ length: 11 }, (_, i) => `s${i}`);
    for (const id of ids) await ctx.skills.insert(skill(id));
    await expect(
      ctx.service.create({ ...base, instructions: link(...ids) }),
    ).rejects.toThrow('An agent can have at most 10 skills');
    const agent = await ctx.service.create({
      ...base,
      instructions: link(...ids.slice(0, 10)),
    });
    await expect(
      ctx.service.saveDraft(agent.id, { ...base, instructions: link(...ids) }),
    ).rejects.toThrow('An agent can have at most 10 skills');
    await expect(
      ctx.service.saveDraft(agent.id, {
        ...base,
        instructions: '[[skill:nope]]',
      }),
    ).rejects.toThrow('Unknown skill "nope"');
  });

  it('publishes copies of the draft skills into liveSkills, in order', async () => {
    const agent = await ctx.service.create({
      ...base,
      instructions: link('b', 'a'),
    });
    expect(agent.liveSkills).toBeUndefined();
    const published = await ctx.service.publish(agent.id);
    expect(published.live?.skills).toEqual(['b', 'a']);
    expect(published.liveSkills).toEqual([
      {
        id: 'b',
        name: 'skill-b',
        description: 'Use when needed.',
        body: 'Body.',
        files: [{ path: 'references/a.md', content: 'A' }],
      },
      expect.objectContaining({ id: 'a' }),
    ]);
    expect(published.liveSkills![0]).not.toHaveProperty('createdAt');
  });

  it('publishes no liveSkills for an agent without skills, and an empty list on a republish without', async () => {
    const plain = await ctx.service.create(base);
    expect(await ctx.service.publish(plain.id)).not.toHaveProperty(
      'liveSkills',
    );

    const agent = await ctx.service.create({
      ...base,
      name: 'B',
      instructions: link('a'),
    });
    await ctx.service.publish(agent.id);
    await ctx.service.saveDraft(agent.id, { ...base, name: 'B' });
    const republished = await ctx.service.publish(agent.id);
    expect(republished.liveSkills).toEqual([]);
    expect(republished.live?.skills).toEqual([]);
  });

  it('keeps the copies when a skill is edited, until the next publish', async () => {
    const agent = await ctx.service.create({
      ...base,
      instructions: link('a'),
    });
    const published = await ctx.service.publish(agent.id);
    let byId = await ctx.service.skillsById();
    expect(hasUnpublishedChanges(published, byId)).toBe(false);

    await ctx.skills.update({ id: 'a' }, { body: 'Edited.' });
    byId = await ctx.service.skillsById();
    const afterEdit = (await ctx.service.get(agent.id))!;
    expect(afterEdit.liveSkills![0].body).toBe('Body.');
    expect(hasUnpublishedChanges(afterEdit, byId)).toBe(true);

    const republished = await ctx.service.publish(agent.id);
    expect(republished.liveSkills![0].body).toBe('Edited.');
    expect(hasUnpublishedChanges(republished, byId)).toBe(false);
  });

  it('has unpublished changes when the skill list differs or a named skill has no copy', async () => {
    const agent = await ctx.service.create({
      ...base,
      instructions: link('a'),
    });
    const published = await ctx.service.publish(agent.id);
    expect(
      hasUnpublishedChanges({
        ...published,
        draft: { ...published.draft, skills: ['a', 'b'] },
      }),
    ).toBe(true);
    // An absent skills list reads as an empty one.
    const noSkills = normalizeAgentConfig({ name: 'A' });
    expect(
      hasUnpublishedChanges({
        draft: noSkills,
        live: { ...noSkills, skills: [] },
      }),
    ).toBe(false);
    expect(
      hasUnpublishedChanges({
        draft: { ...published.draft },
        live: { ...published.draft },
        liveSkills: [],
      }),
    ).toBe(true);
  });

  it('gives a preview the current skills its draft names, skipping deleted ones', async () => {
    const found = await ctx.service.skillsFor(['b', 'gone', 'a']);
    expect(found.map((doc) => doc.id)).toEqual(['b', 'a']);
    expect(await ctx.service.skillsFor(undefined)).toEqual([]);
  });

  it('names the agents whose draft links a skill, sorted; Live copies do not count', async () => {
    const one = await ctx.service.create({
      ...base,
      name: 'Zed',
      instructions: link('a'),
    });
    await ctx.service.create({
      ...base,
      name: 'Amy',
      instructions: link('a', 'b'),
    });
    await ctx.service.publish(one.id);
    await ctx.service.saveDraft(one.id, { ...base, name: 'Zed' });
    expect(await ctx.service.draftsLinking('skill-a')).toEqual(['Amy']);
    expect(await ctx.service.draftsLinking('skill-b')).toEqual(['Amy']);
    expect(await ctx.service.draftsLinking('other')).toEqual([]);
    const after = (await ctx.service.get(one.id))!;
    expect(after.live?.skills).toEqual(['a']);
    expect(after.liveSkills).toHaveLength(1);
  });
});
