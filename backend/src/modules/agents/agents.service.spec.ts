// The real Mastra instance pulls in ESM-only packages Jest cannot require;
// the service only needs `listAgents()`, which the test passes in.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/evals/assistant.evals', () => ({
  ASSISTANT_EVAL_SETS: [],
}));

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { CurrentUserService, LOCAL_USER } from '../auth/current-user.service';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentsService } from './agents.service';

/** A registry entry with just the accessors `AgentsService` reads. */
function fakeAgent(name: string, tools: string[], instructions = '') {
  return {
    id: name,
    name,
    getDescription: () => `${name} description`,
    listTools: () =>
      Object.fromEntries(tools.map((tool) => [tool, { description: tool }])),
    getInstructions: () => instructions,
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
  const userAgents = new UserAgentsService(
    new UserAgentsRepository(new SqliteDocStore(db, 'agents')),
    new BuiltinAgentPinsRepository(new SqliteDocStore(db, 'settings'), users),
    {
      list: jest.fn().mockResolvedValue([{ name: 'World Cup Core' }]),
    } as unknown as DatasetsRepository,
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
  return { db, service: new AgentsService(mastra, userAgents) };
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
        tools: ['create_visual', 'run_readonly_sql'],
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
        instructions: 'You are the assistant.',
        draft: { instructions: 'Focus on plans' },
        live: { instructions: 'Focus on plans' },
        model: null,
      });
      expect(detail?.toolDetails.map((tool) => tool.name)).toEqual([
        'create_visual',
        'run_readonly_sql',
      ]);
      expect(await ctx.service.get('unknown')).toBeNull();
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
        loading: 'harness',
      });

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
});
