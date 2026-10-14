// The real Mastra instance pulls in ESM-only packages Jest cannot require;
// the service only needs `listAgents()`, which the test passes in.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/evals/assistant.evals', () => ({
  ASSISTANT_EVAL_SETS: [],
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { CurrentUserService, LOCAL_USER } from '../auth/current-user.service';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import type { SkillDoc } from '../skills/entities/skill.entity';
import { SkillsRepository } from '../skills/repositories/skills.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentsService } from './agents.service';

type Context = { requestContext?: { get(key: string): unknown } };

/** The tool selection a call carries, as the real assistant reads it. */
const selectionOf = (args?: Context) =>
  args?.requestContext?.get('agent-tools') as string[] | undefined;

/**
 * A registry entry with just the accessors `AgentsService` reads. Like the
 * real assistant, it drops `create_visual` and says so in its prompt when
 * the call's tool selection leaves out `visuals` (ADR-0022).
 */
function fakeAgent(name: string, tools: string[], instructions = '') {
  return {
    id: name,
    name,
    getDescription: () => `${name} description`,
    listTools: (args?: Context) =>
      Object.fromEntries(
        tools
          .filter(
            (tool) =>
              tool !== 'create_visual' ||
              !selectionOf(args) ||
              selectionOf(args)!.includes('visuals'),
          )
          .map((tool) => [tool, { description: tool }]),
      ),
    getInstructions: (args?: Context) =>
      selectionOf(args)
        ? `${instructions} [tools: ${selectionOf(args)!.join(',')}]`
        : instructions,
    getMemory: () => undefined,
    getModel: () => {
      throw new Error('no LLM settings');
    },
  };
}

/** Who the tests run as; nobody is signed in outside `runAs` (ADR-0012). */
const users = new CurrentUserService();

/** A test body run as Demo User, as a signed-in request would. */
const asDemoUser =
  <T>(fn: () => Promise<T>) =>
  (): Promise<T> =>
    users.runAs(LOCAL_USER, fn);

function build() {
  const db = new BetterSqlite3(':memory:');
  const skills = new SqliteDocStore<SkillDoc>(db, 'skills');
  const userAgents = new UserAgentsService(
    new UserAgentsRepository(new SqliteDocStore(db, 'agents')),
    new BuiltinAgentPinsRepository(new SqliteDocStore(db, 'settings'), users),
    {
      list: jest.fn().mockResolvedValue([{ name: 'World Cup Core' }]),
    } as unknown as DatasetsRepository,
    new SkillsRepository(skills),
  );
  const registry = {
    'sql-fixer': fakeAgent('sql-fixer', ['b']),
    assistant: fakeAgent(
      'assistant',
      ['run_readonly_sql', 'create_visual'],
      'You are the assistant.',
    ),
    'assistant-eval-judge': fakeAgent('assistant-eval-judge', []),
  };
  const mastra = { listAgents: () => registry } as unknown as MastraService;
  return { db, skills, service: new AgentsService(mastra, userAgents) };
}

describe('AgentsService (built-in and user agents)', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  afterEach(() => ctx.db.close());

  it(
    'lists built-in agents with kind, owner and status',
    asDemoUser(async () => {
      const agents = await ctx.service.list();
      expect(agents.map((agent) => agent.key)).toEqual([
        'assistant',
        'assistant-eval-judge',
        'sql-fixer',
      ]);
      expect(agents[0]).toMatchObject({
        kind: 'official',
        owner: 'Official',
        status: 'builtin',
        pinned: false,
        hasUnpublishedChanges: false,
        missingDatasets: [],
        datasets: [],
        starterQuestions: [],
      });
      expect(agents[2]).toMatchObject({ kind: 'system', owner: 'System' });
    }),
  );

  it(
    "adds the editable prompt to a built-in agent's detail only (ADR-0026)",
    asDemoUser(async () => {
      const view = {
        editable: 'E',
        shipped: 'S',
        modified: true,
        builtInChanged: false,
        linksAllowed: false,
        updatedAt: null,
      };
      const prompts = {
        view: jest.fn((key: string) =>
          Promise.resolve(key === 'sql-fixer' ? view : undefined),
        ),
      };
      const service = new AgentsService(
        (ctx.service as unknown as { mastra: MastraService }).mastra,
        (ctx.service as unknown as { userAgents: UserAgentsService })
          .userAgents,
        undefined,
        prompts as never,
      );
      expect((await service.get('sql-fixer'))?.prompt).toEqual(view);
      const user = await service.create({ name: 'Mine' });
      expect(await service.get(user.id)).not.toHaveProperty('prompt');
    }),
  );

  it(
    'merges user agents into the catalogue, sorted by name',
    asDemoUser(async () => {
      const created = await ctx.service.create({
        name: 'Health plan analyst',
        description: 'Plans',
        datasets: ['World Cup Core', 'Gone'],
        starterQuestions: ['Who won?'],
      });
      const agents = await ctx.service.list();
      expect(agents.map((agent) => agent.name)).toEqual([
        'assistant',
        'assistant-eval-judge',
        'Health plan analyst',
        'sql-fixer',
      ]);
      const user = agents.find((agent) => agent.key === created.id);
      expect(user).toEqual({
        key: created.id,
        id: created.id,
        name: 'Health plan analyst',
        description: 'Plans',
        // No links: only the always-on tools (ADR-0024).
        tools: ['run_readonly_sql'],
        kind: 'user',
        status: 'draft',
        pinned: false,
        owner: 'You',
        hasUnpublishedChanges: false,
        missingDatasets: ['Gone'],
        datasets: ['World Cup Core', 'Gone'],
        starterQuestions: ['Who won?'],
      });
    }),
  );

  it(
    'shows the Live version in the catalogue while the draft has unpublished changes',
    asDemoUser(async () => {
      const created = await ctx.service.create({
        name: 'Analyst',
        datasets: ['World Cup Core'],
      });
      await ctx.service.publish(created.id);
      await ctx.service.saveDraft(created.id, {
        name: 'Analyst v2',
        datasets: ['World Cup Core'],
      });
      const user = (await ctx.service.list()).find(
        (agent) => agent.key === created.id,
      );
      expect(user).toMatchObject({
        name: 'Analyst',
        status: 'live',
        hasUnpublishedChanges: true,
      });
    }),
  );

  it(
    'resolves a registry key first, then a user-agent id',
    asDemoUser(async () => {
      const assistant = await ctx.service.get('assistant');
      expect(assistant).toMatchObject({
        key: 'assistant',
        kind: 'official',
        instructions: 'You are the assistant.',
      });
      expect(assistant).not.toHaveProperty('draft');

      const created = await ctx.service.create({
        name: 'Analyst',
        instructions: 'Focus on plans',
        datasets: ['World Cup Core'],
      });
      await ctx.service.publish(created.id);
      const detail = await ctx.service.get(created.id);
      expect(detail).toMatchObject({
        key: created.id,
        kind: 'user',
        status: 'live',
        instructions: 'You are the assistant. [tools: ]',
        draft: { instructions: 'Focus on plans' },
        live: { instructions: 'Focus on plans' },
        model: null,
      });
      expect(detail?.toolDetails.map((tool) => tool.name)).toEqual([
        'run_readonly_sql',
      ]);
      expect(await ctx.service.get('unknown')).toBeNull();
    }),
  );

  it(
    "shows the tools and prompt a user agent's selection gives it, Live else draft (R49)",
    asDemoUser(async () => {
      const created = await ctx.service.create({
        name: 'KPI lookup',
        datasets: ['World Cup Core'],
        instructions: 'Look at [[tool:sample_rows]].',
      });

      // Draft only: the draft's selection.
      let summary = (await ctx.service.list()).find(
        (agent) => agent.key === created.id,
      );
      expect(summary?.tools).toEqual(['run_readonly_sql']);
      expect(created.tools).toEqual(['run_readonly_sql']);
      let detail = await ctx.service.get(created.id);
      expect(detail?.tools).toEqual(['run_readonly_sql']);
      expect(detail?.toolDetails.map((tool) => tool.name)).toEqual([
        'run_readonly_sql',
      ]);
      expect(detail?.instructions).toBe(
        'You are the assistant. [tools: sample_rows]',
      );

      // Live with every tool, while the draft goes back to one tool: Live wins.
      await ctx.service.saveDraft(created.id, {
        name: 'KPI lookup',
        datasets: ['World Cup Core'],
        instructions:
          '[[tool:sample_rows]] [[tool:ask_clarification]] [[tool:create_visual]]',
      });
      await ctx.service.publish(created.id);
      await ctx.service.saveDraft(created.id, {
        name: 'KPI lookup',
        datasets: ['World Cup Core'],
      });
      summary = (await ctx.service.list()).find(
        (agent) => agent.key === created.id,
      );
      expect(summary?.tools).toEqual(['create_visual', 'run_readonly_sql']);
      detail = await ctx.service.get(created.id);
      expect(detail?.instructions).toBe('You are the assistant.');
      expect(detail?.draft?.tools).toEqual([]);

      // The built-in assistant is unchanged.
      expect((await ctx.service.get('assistant'))?.tools).toEqual([
        'create_visual',
        'run_readonly_sql',
      ]);
    }),
  );

  it('refuses to edit, publish or delete a built-in agent', async () => {
    await expect(
      ctx.service.saveDraft('sql-fixer', { name: 'Mine' }),
    ).rejects.toThrow("Built-in agents can't be edited");
    await expect(ctx.service.publish('sql-fixer')).rejects.toThrow(
      "Built-in agents can't be edited",
    );
    await expect(ctx.service.delete('sql-fixer')).rejects.toThrow(
      "Built-in agents can't be deleted",
    );
  });

  it(
    'pins built-in and user agents',
    asDemoUser(async () => {
      const created = await ctx.service.create({ name: 'Analyst' });
      expect((await ctx.service.setPinned('assistant', true)).pinned).toBe(
        true,
      );
      expect((await ctx.service.setPinned(created.id, true)).pinned).toBe(true);
      const pinned = (await ctx.service.list())
        .filter((agent) => agent.pinned)
        .map((agent) => agent.key);
      expect(pinned.sort()).toEqual(['assistant', created.id].sort());
      expect((await ctx.service.setPinned('assistant', false)).pinned).toBe(
        false,
      );
      await expect(ctx.service.setPinned('nope', true)).rejects.toThrow(
        'Agent "nope" not found',
      );
    }),
  );

  it(
    "shows a built-in agent's skills, and the assistant's for a user agent",
    asDemoUser(async () => {
      const names = (view: { skills: { name: string }[] }) =>
        view.skills.map((skill) => skill.name);
      const assistant = await ctx.service.skills('assistant');
      expect(names(assistant)).toEqual(['curated-knowledge', 'deep-analysis']);
      expect(assistant.skills[0]).toMatchObject({
        level: 'built-in',
        loading: 'on-demand',
      });
      expect(assistant.skills[1]).toMatchObject({ loading: 'harness' });

      const created = await ctx.service.create({ name: 'Analyst' });
      expect(names(await ctx.service.skills(created.id))).toEqual(
        names(assistant),
      );
      expect((await ctx.service.skills('sql-fixer')).skills).toEqual([]);
      await expect(ctx.service.skills('nope')).rejects.toThrow(
        'Agent "nope" not found',
      );
    }),
  );

  it(
    "serves a skill file and refuses what is not one of the agent's files",
    asDemoUser(async () => {
      const file = await ctx.service.skillFile(
        'assistant',
        'deep-analysis',
        'phases/1-plan.md',
      );
      expect(file.path).toBe('phases/1-plan.md');
      expect(file.content).toContain('{{');

      await expect(
        ctx.service.skillFile('sql-fixer', 'deep-analysis', 'SKILL.md'),
      ).rejects.toThrow('Agent "sql-fixer" has no skill "deep-analysis"');
      await expect(
        ctx.service.skillFile(
          'assistant',
          'deep-analysis',
          '../../app-skills.ts',
        ),
      ).rejects.toThrow('Invalid skill file path "../../app-skills.ts"');
      await expect(
        ctx.service.skillFile('assistant', 'deep-analysis', 'phases/9.md'),
      ).rejects.toThrow('Skill "deep-analysis" has no file "phases/9.md"');
    }),
  );
  describe("a user agent's in-app skills (ADR-0022; api.md 34a, 34b)", () => {
    const skill = (id: string, name: string, body: string): SkillDoc => ({
      id,
      name,
      description: `Use when ${name}.`,
      body,
      files: [{ path: 'references/q.md', content: 'Q1 is July.' }],
    });

    it(
      "follows the assistant's skills with the draft's current ones, then the Live copies after a publish",
      asDemoUser(async () => {
        await ctx.skills.insert(skill('s2', 'zeta', 'Z body.'));
        await ctx.skills.insert(skill('s1', 'alpha', 'A body.'));
        const created = await ctx.service.create({
          name: 'Analyst',
          datasets: ['World Cup Core'],
          instructions: 'Use [[skill:zeta]] and [[skill:alpha]].',
        });
        const inApp = (view: { skills: { level: string; name: string }[] }) =>
          view.skills.filter((entry) => entry.level === 'in-app');

        const draftView = await ctx.service.skills(created.id);
        expect(draftView.skills.map((s) => s.name).slice(-2)).toEqual([
          'alpha',
          'zeta',
        ]);
        expect(inApp(draftView)[0]).toMatchObject({
          name: 'alpha',
          description: 'Use when alpha.',
          level: 'in-app',
          loading: 'on-demand',
          overrides: [],
          warnings: [],
          files: [
            {
              path: 'SKILL.md',
              size: Buffer.byteLength(
                '---\nname: alpha\ndescription: Use when alpha.\n---\n\nA body.',
              ),
            },
            { path: 'references/q.md', size: 11 },
          ],
        });
        // The levels row never lists in-app.
        expect(draftView.levels.map((l) => l.level)).toEqual([
          'built-in',
          'user',
          'project',
        ]);

        await ctx.service.publish(created.id);
        await ctx.skills.update({ id: 's1' }, { body: 'Edited.' });
        const skillMd = await ctx.service.skillFile(
          created.id,
          'alpha',
          'SKILL.md',
        );
        expect(skillMd.content).toBe(
          '---\nname: alpha\ndescription: Use when alpha.\n---\n\nA body.',
        );
        expect(
          (await ctx.service.skillFile(created.id, 'alpha', 'references/q.md'))
            .content,
        ).toBe('Q1 is July.');
        await expect(
          ctx.service.skillFile(created.id, 'alpha', 'references/nope.md'),
        ).rejects.toThrow('Skill "alpha" has no file "references/nope.md"');
        // Another agent's skill is not this agent's.
        await expect(
          ctx.service.skillFile('assistant', 'alpha', 'SKILL.md'),
        ).rejects.toThrow('Agent "assistant" has no skill "alpha"');
      }),
    );

    it(
      'flags unpublished changes when a skill is edited after the publish, and shows no in-app skills for built-ins',
      asDemoUser(async () => {
        await ctx.skills.insert(skill('s1', 'alpha', 'A body.'));
        const created = await ctx.service.create({
          name: 'Analyst',
          datasets: ['World Cup Core'],
          instructions: 'Use [[skill:alpha]].',
        });
        const published = await ctx.service.publish(created.id);
        expect(published.hasUnpublishedChanges).toBe(false);
        await ctx.skills.update({ id: 's1' }, { body: 'Edited.' });
        const listed = (await ctx.service.list()).find(
          (agent) => agent.key === created.id,
        );
        expect(listed?.hasUnpublishedChanges).toBe(true);
        expect(
          (await ctx.service.skills('assistant')).skills.some(
            (s) => s.level === 'in-app',
          ),
        ).toBe(false);
      }),
    );
  });

  describe('links (ADR-0024; api.md 34)', () => {
    const skill = (name: string, body: string): SkillDoc => ({
      id: `id-${name}`,
      name,
      description: `Use when ${name}.`,
      body,
      files: [],
    });
    const link = (
      detail: { toolLinks?: { name: string; status?: string }[] } | null,
      name: string,
    ) => detail?.toolLinks?.find((entry) => entry.name === name);

    it(
      'adds the tools a linked skill links to the selection and reports where each link comes from',
      asDemoUser(async () => {
        await ctx.skills.insert(skill('alpha', 'Use [[tool:sample_rows]].'));
        await ctx.skills.insert(skill('beta', 'Also [[tool:sample_rows]].'));
        const created = await ctx.service.create({
          name: 'Analyst',
          datasets: ['World Cup Core'],
          instructions:
            'Use [[skill:alpha]], [[skill:beta]] and [[tool:update_visual]] and [[tool:run_readonly_sql]].',
        });
        const detail = await ctx.service.get(created.id);
        expect(detail?.toolLinks?.map((entry) => entry.name)).toEqual([
          'ask_clarification',
          'create_visual',
          'describe_entity',
          'list_entities',
          'run_readonly_sql',
          'sample_rows',
          'update_visual',
        ]);
        expect(link(detail, 'sample_rows')).toEqual({
          name: 'sample_rows',
          status: 'linked',
          linkedVia: { instructions: false, skills: ['alpha', 'beta'] },
        });
        // The pair: linking one gives both.
        expect(link(detail, 'update_visual')).toMatchObject({
          status: 'linked',
          linkedVia: { instructions: true, skills: [] },
        });
        expect(link(detail, 'create_visual')).toMatchObject({
          status: 'linked',
        });
        expect(link(detail, 'ask_clarification')).toEqual({
          name: 'ask_clarification',
          status: 'not-linked',
          linkedVia: { instructions: false, skills: [] },
        });
        expect(link(detail, 'run_readonly_sql')).toEqual({
          name: 'run_readonly_sql',
          status: 'always-on',
          linkedVia: { instructions: true, skills: [] },
        });
        expect(link(detail, 'list_entities')?.status).toBe('always-on');
        // sample_rows comes only through the skills, yet the agent has it.
        expect(detail?.instructions).toBe(
          'You are the assistant. [tools: sample_rows,visuals]',
        );
        // A built-in agent has no links.
        expect((await ctx.service.get('assistant'))?.toolLinks).toBeUndefined();
      }),
    );

    it(
      'reads toolLinks from the Live version and its copies, not the draft',
      asDemoUser(async () => {
        await ctx.skills.insert(skill('alpha', 'Use [[tool:sample_rows]].'));
        const created = await ctx.service.create({
          name: 'Analyst',
          datasets: ['World Cup Core'],
          instructions: 'Use [[skill:alpha]].',
        });
        await ctx.service.publish(created.id);
        await ctx.skills.update({ id: 'id-alpha' }, { body: 'No tools.' });
        await ctx.service.saveDraft(created.id, {
          name: 'Analyst',
          datasets: ['World Cup Core'],
          instructions: 'Nothing linked.',
        });
        const detail = await ctx.service.get(created.id);
        expect(link(detail, 'sample_rows')).toMatchObject({
          status: 'linked',
          linkedVia: { instructions: false, skills: ['alpha'] },
        });
      }),
    );

    it('serves the LLM settings of any agent without the key', async () => {
      const db = new BetterSqlite3(':memory:');
      const llm = {
        getView: jest.fn().mockResolvedValue({
          provider: 'openai',
          model: 'gpt-5',
          baseUrl: null,
          apiKeyMasked: '••••••••1234',
          reasoningEffort: 'high',
          configured: true,
        }),
      };
      const registry = { assistant: fakeAgent('assistant', []) };
      const service = new AgentsService(
        { listAgents: () => registry } as unknown as MastraService,
        new UserAgentsService(
          new UserAgentsRepository(new SqliteDocStore(db, 'agents')),
          new BuiltinAgentPinsRepository(
            new SqliteDocStore(db, 'settings'),
            users,
          ),
          {
            list: jest.fn().mockResolvedValue([{ name: 'World Cup Core' }]),
          } as unknown as DatasetsRepository,
          new SkillsRepository(new SqliteDocStore(db, 'skills')),
        ),
        llm as never,
      );
      await users.runAs(LOCAL_USER, async () => {
        expect((await service.get('assistant'))?.llm).toEqual({
          provider: 'openai',
          providerName: 'OpenAI',
          model: 'gpt-5',
          apiKeyConfigured: true,
          maxOutputTokens: null,
          reasoningEffort: 'high',
        });
        const created = await service.create({
          name: 'Fast',
          datasets: ['World Cup Core'],
          model: 'gpt-5.1',
          reasoningEffort: 'low',
        });
        const detail = await service.get(created.id);
        expect(detail?.llm).toMatchObject({
          model: 'gpt-5.1',
          reasoningEffort: 'low',
        });
        expect(JSON.stringify(detail)).not.toContain('1234');
        llm.getView.mockResolvedValue({
          provider: null,
          model: null,
          baseUrl: null,
          apiKeyMasked: null,
          reasoningEffort: 'high',
          configured: false,
        });
        expect((await service.get('assistant'))?.llm).toEqual({
          provider: null,
          providerName: null,
          model: null,
          apiKeyConfigured: false,
          maxOutputTokens: null,
          reasoningEffort: null,
        });
      });
      db.close();
    });
  });
});
