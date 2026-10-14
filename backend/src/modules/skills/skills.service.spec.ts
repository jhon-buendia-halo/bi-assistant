import BetterSqlite3 from 'better-sqlite3';
import { OwnedDocStore } from '../../infrastructure/database/owned-doc-store';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import { CurrentUserService, LOCAL_USER } from '../auth/current-user.service';
import type { CurrentUser } from '../auth/entities/current-user.entity';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { UserAgentDoc } from '../user-agents/entities/user-agent.entity';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import { UserAgentsService } from '../user-agents/user-agents.service';
import type { SkillDoc } from './entities/skill.entity';
import { SkillsRepository } from './repositories/skills.repository';
import { SkillsService } from './skills.service';

const user = (id: string): CurrentUser => ({
  id,
  displayName: id,
  email: `${id}@contoso.test`,
  initials: id.slice(0, 1).toUpperCase(),
  roles: [{ role: 'user', source: 'implicit' }],
  permissions: ['use-agents', 'create-agents'],
});
const ADA = user('ada');
const BOB = user('bob');

/** The real owner-scoped stores over in-memory SQLite, users switched by `as`. */
function build() {
  const db = new BetterSqlite3(':memory:');
  const users = new CurrentUserService();
  const scope = () => users.ownerScope();
  const skillsStore = new OwnedDocStore(
    new SqliteDocStore<SkillDoc>(db, 'skills'),
    scope,
  );
  const agentsStore = new OwnedDocStore(
    new SqliteDocStore<UserAgentDoc>(db, 'agents'),
    scope,
  );
  const skills = new SkillsRepository(skillsStore);
  const userAgents = new UserAgentsService(
    new UserAgentsRepository(agentsStore),
    new BuiltinAgentPinsRepository(new SqliteDocStore(db, 'settings'), users),
    {
      list: jest.fn().mockResolvedValue([{ name: 'World Cup Core' }]),
    } as unknown as DatasetsRepository,
    skills,
  );
  return {
    db,
    userAgents,
    service: new SkillsService(skills, userAgents),
    as: <T>(who: CurrentUser, fn: () => Promise<T>) => users.runAs(who, fn),
  };
}

const valid = {
  name: 'fiscal-calendar',
  description: 'Use when a question names a fiscal year.',
  body: 'Our fiscal year starts on 1 July.',
};

describe('SkillsService (api.md 94-98; agents-evals R68-R74)', () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => {
    t = build();
  });
  afterEach(() => t.db.close());

  const asAda = <T>(fn: () => Promise<T>) => t.as(ADA, fn);

  describe('create', () => {
    it('stores a skill, trimming name and description, and answers it in full', () =>
      asAda(async () => {
        const skill = await t.service.create({
          ...valid,
          name: '  fiscal-calendar ',
          description: `  ${valid.description} `,
          files: [{ path: 'reference/quarters.md', content: 'Q1 is July.' }],
        });
        expect(skill).toMatchObject({
          name: 'fiscal-calendar',
          description: valid.description,
          body: valid.body,
          fileCount: 1,
          agents: [],
          files: [{ path: 'reference/quarters.md', content: 'Q1 is July.' }],
        });
        expect(skill.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(skill).not.toHaveProperty('ownerId');
        expect(await t.service.get(skill.id)).toEqual(skill);
      }));

    // Each row is one refusal of api.md 96, in the documented order: every
    // case is invalid in this way and in every later one, so it proves the
    // earlier checks win.
    const refusals: [string, Record<string, unknown>, string][] = [
      ['a missing name', { name: '  ' }, 'Skill name is required'],
      [
        'capitals',
        { name: 'Fiscal' },
        'Use lowercase letters, digits and single hyphens in a skill name',
      ],
      [
        'a double hyphen',
        { name: 'fiscal--calendar' },
        'Use lowercase letters, digits and single hyphens in a skill name',
      ],
      [
        'a long name',
        { name: 'a'.repeat(65) },
        'A skill name is at most 64 characters',
      ],
      [
        'a built-in name',
        { name: 'curated-knowledge' },
        '"curated-knowledge" is the name of a built-in skill',
      ],
      [
        'a description not starting with Use when',
        { description: 'Fiscal calendar rules.' },
        'The description must start with "Use when"',
      ],
      [
        'a long description',
        { description: `Use when ${'x'.repeat(300)}` },
        'The description is at most 300 characters',
      ],
      ['an empty body', { body: '  \n ' }, 'The body is empty'],
      [
        'a long body',
        { body: 'x'.repeat(20_001) },
        'The body is at most 20,000 characters',
      ],
      [
        'eleven files',
        {
          files: Array.from({ length: 11 }, (_, i) => ({
            path: `reference/f${i}.md`,
            content: '',
          })),
        },
        'A skill has at most 10 reference files',
      ],
      [
        'a path outside reference/',
        { files: [{ path: 'scripts/run.js', content: '' }] },
        'Name reference files reference/<file name>',
      ],
      [
        'a bad file name',
        { files: [{ path: 'reference/.hidden', content: '' }] },
        'Name reference files reference/<file name>',
      ],
      [
        'a nested file name',
        { files: [{ path: 'reference/a/b.md', content: '' }] },
        'Name reference files reference/<file name>',
      ],
      [
        'a duplicate path',
        {
          files: [
            { path: 'reference/a.md', content: '' },
            { path: 'reference/a.md', content: '' },
          ],
        },
        'Two reference files are named "reference/a.md"',
      ],
      [
        'a long file',
        { files: [{ path: 'reference/a.md', content: 'x'.repeat(20_001) }] },
        '"reference/a.md" is at most 20,000 characters',
      ],
      [
        'a body naming a missing file',
        { body: 'See reference/quarters.md.' },
        "The body names reference/quarters.md, which this skill doesn't have",
      ],
      [
        'a body naming a missing file that is not markdown',
        { body: 'Rates are in reference/rates.csv, by quarter.' },
        "The body names reference/rates.csv, which this skill doesn't have",
      ],
    ];

    it.each(refusals)('refuses %s', (_label, change, message) =>
      asAda(async () => {
        await expect(t.service.create({ ...valid, ...change })).rejects.toThrow(
          message,
        );
      }),
    );

    it('links tools only in a body', () =>
      asAda(async () => {
        await expect(
          t.service.create({ ...valid, body: 'See [[skill:other]].' }),
        ).rejects.toThrow('Skills can link tools only');
        await expect(
          t.service.create({ ...valid, body: 'Use [[tool:nope]].' }),
        ).rejects.toThrow('Unknown tool "nope"');
        await expect(
          t.service.create({ ...valid, body: 'Use [[tool:sample_rows]].' }),
        ).resolves.toMatchObject({ tools: ['sample_rows'] });
      }));

    it('reports the first failing check when several apply', () =>
      asAda(async () => {
        await expect(
          t.service.create({
            name: 'Curated Knowledge',
            description: 'nope',
            body: '',
          }),
        ).rejects.toThrow('Use lowercase letters, digits and single hyphens');
        await expect(
          t.service.create({
            name: 'curated-knowledge',
            description: 'nope',
            body: '',
          }),
        ).rejects.toThrow('is the name of a built-in skill');
        await expect(
          t.service.create({ name: 'ok-name', description: 'nope', body: '' }),
        ).rejects.toThrow('The description must start with "Use when"');
      }));

    it('refuses a name the caller already has, but not one another user has', () =>
      asAda(async () => {
        await t.service.create(valid);
        await expect(t.service.create(valid)).rejects.toThrow(
          'A skill named "fiscal-calendar" already exists',
        );
        await t.as(BOB, async () => {
          await expect(t.service.create(valid)).resolves.toMatchObject({
            name: 'fiscal-calendar',
          });
        });
      }));
  });

  describe('save', () => {
    it('replaces the whole skill and keeps its id; its own name is not a clash', () =>
      asAda(async () => {
        const created = await t.service.create({
          ...valid,
          files: [{ path: 'reference/a.md', content: 'A' }],
        });
        const saved = await t.service.save(created.id, {
          ...valid,
          body: 'Our fiscal year starts on 1 April.',
        });
        expect(saved).toMatchObject({
          id: created.id,
          body: 'Our fiscal year starts on 1 April.',
          files: [],
          fileCount: 0,
        });
      }));

    it('refuses to rename a skill a draft links, but saves other changes', () =>
      asAda(async () => {
        const skill = await t.service.create(valid);
        await t.userAgents.create({
          name: 'Analyst',
          instructions: '[[skill:fiscal-calendar]]',
        });
        await expect(
          t.service.save(skill.id, { ...valid, name: 'calendar' }),
        ).rejects.toThrow(
          '"fiscal-calendar" is linked by Analyst. Unlink it first.',
        );
        await expect(
          t.service.save(skill.id, { ...valid, body: 'New body.' }),
        ).resolves.toMatchObject({ name: 'fiscal-calendar' });
      }));

    it('refuses an unknown id and a name another skill of the caller has', () =>
      asAda(async () => {
        await expect(t.service.save('nope', valid)).rejects.toThrow(
          'Skill "nope" not found',
        );
        await t.service.create(valid);
        const other = await t.service.create({ ...valid, name: 'other' });
        await expect(t.service.save(other.id, valid)).rejects.toThrow(
          'A skill named "fiscal-calendar" already exists',
        );
      }));
  });

  describe('ownership (data-model 3.15)', () => {
    it("answers another user's skill as not found for every operation, and lists only the caller's", async () => {
      const ada = await asAda(() => t.service.create(valid));
      await t.as(BOB, async () => {
        expect(await t.service.list()).toEqual([]);
        await expect(t.service.get(ada.id)).rejects.toThrow(
          `Skill "${ada.id}" not found`,
        );
        await expect(t.service.save(ada.id, valid)).rejects.toThrow(
          'not found',
        );
        await expect(t.service.delete(ada.id)).rejects.toThrow('not found');
      });
      expect(await asAda(() => t.service.get(ada.id))).toMatchObject({
        body: valid.body,
      });
    });

    it("refuses another user's skill id in an agent", async () => {
      await asAda(() => t.service.create(valid));
      await t.as(BOB, async () => {
        await expect(
          t.userAgents.create({
            name: 'Mine',
            instructions: '[[skill:fiscal-calendar]]',
          }),
        ).rejects.toThrow('Unknown skill "fiscal-calendar"');
      });
    });
  });

  describe('list', () => {
    it('is sorted by name and names the agents whose draft or Live version use each skill', () =>
      asAda(async () => {
        await t.service.create({ ...valid, name: 'b-skill' });
        await t.service.create({
          ...valid,
          name: 'a-skill',
          body: 'Use [[tool:sample_rows]] and [[tool:create_visual]] and [[tool:sample_rows]].',
        });
        await t.userAgents.create({
          name: 'Zed',
          datasets: ['World Cup Core'],
          instructions: '[[skill:a-skill]]',
        });
        const live = await t.userAgents.create({
          name: 'Amy',
          datasets: ['World Cup Core'],
          instructions: '[[skill:a-skill]] [[skill:b-skill]]',
        });
        await t.userAgents.publish(live.id);
        // The draft drops b, but the Live version still names it.
        await t.userAgents.saveDraft(live.id, {
          name: 'Amy',
          datasets: ['World Cup Core'],
          instructions: '[[skill:a-skill]]',
        });

        const list = await t.service.list();
        expect(list.map((s) => s.name)).toEqual(['a-skill', 'b-skill']);
        expect(list[0].agents).toEqual(['Amy', 'Zed']);
        expect(list[1].agents).toEqual(['Amy']);
        expect(list[0].tools).toEqual(['create_visual', 'sample_rows']);
        expect(list[1].tools).toEqual([]);
        expect(list[0]).toMatchObject({
          fileCount: 0,
          updatedAt: expect.any(String) as string,
        });
      }));
  });

  describe('delete', () => {
    it('refuses while a draft links the skill, naming the agents, then deletes once unlinked; Live copies stay', () =>
      asAda(async () => {
        const skill = await t.service.create(valid);
        const agent = await t.userAgents.create({
          name: 'Analyst',
          datasets: ['World Cup Core'],
          instructions: '[[skill:fiscal-calendar]]',
        });
        await t.userAgents.create({
          name: 'Alpha',
          instructions: '[[skill:fiscal-calendar]]',
        });
        await t.userAgents.publish(agent.id);

        await expect(t.service.delete(skill.id)).rejects.toThrow(
          '"fiscal-calendar" is linked by Alpha, Analyst. Unlink it first.',
        );
        await expect(t.service.get(skill.id)).resolves.toBeDefined();

        // Unlinked from every draft: the Live copy alone does not block.
        for (const name of ['Analyst', 'Alpha']) {
          const doc = (await t.userAgents.list()).find(
            (d) => d.draft.name === name,
          )!;
          await t.userAgents.saveDraft(doc.id, {
            name,
            datasets: ['World Cup Core'],
          });
        }
        const deleted = await t.service.delete(skill.id);
        expect(deleted.name).toBe('fiscal-calendar');
        const after = (await t.userAgents.get(agent.id))!;
        expect(after.live?.skills).toEqual([skill.id]);
        expect(after.liveSkills?.map((s) => s.name)).toEqual([
          'fiscal-calendar',
        ]);
        await expect(t.service.get(skill.id)).rejects.toThrow('not found');
      }));

    it("does not touch another user's agents", async () => {
      const ada = await asAda(() => t.service.create(valid));
      const bobAgent = await t.as(BOB, () =>
        t.userAgents.create({ name: 'Bobs' }),
      );
      await asAda(() => t.service.delete(ada.id));
      expect(
        (await t.as(BOB, () => t.userAgents.get(bobAgent.id)))?.draft,
      ).toMatchObject({ name: 'Bobs' });
    });
  });

  it('runs as the local persona too (ADR-0012)', async () => {
    const skill = await t.as(LOCAL_USER, () => t.service.create(valid));
    await expect(
      t.as(LOCAL_USER, () => t.service.get(skill.id)),
    ).resolves.toMatchObject({ name: 'fiscal-calendar' });
  });
});
