// The real Mastra instance pulls in ESM-only packages Jest cannot require;
// the service only needs `listAgents()`, which the test passes in.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/evals/eval-sets', () => ({
  evalSetsFor: () => [],
}));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { BuiltinAgentPinsRepository } from '../user-agents/repositories/builtin-agent-pins.repository';
import type { SkillDoc } from '../skills/entities/skill.entity';
import { SkillsRepository } from '../skills/repositories/skills.repository';
import { UserAgentsRepository } from '../user-agents/repositories/user-agents.repository';
import { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentsService } from './agents.service';

type Context = { requestContext?: { get(key: string): unknown } };

/** The tool selection a call carries, as Elena reads it. */
const selectionOf = (args?: Context) =>
  args?.requestContext?.get('agent-tools') as string[] | undefined;

/** The dashboard gate a call carries, as Elena reads it. */
const dashboardGateOf = (args?: Context) =>
  (
    args?.requestContext?.get('conversation-gates') as
      { dashboard: boolean } | undefined
  )?.dashboard;

/**
 * A registry entry with just the accessors `AgentsService` reads. Like the
 * real Elena, who runs every user agent (ADR-0059), it drops `sample_rows`
 * when the call's tool selection leaves it out, says so in its prompt, and
 * drops `submit_dashboard` with the dashboard gate closed.
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
              (tool !== 'sample_rows' ||
                !selectionOf(args) ||
                selectionOf(args)!.includes('sample_rows')) &&
              (tool !== 'submit_dashboard' || dashboardGateOf(args) !== false),
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

/** A test body, kept as a wrapper so the cases read as before. */
const asDemoUser =
  <T>(fn: () => Promise<T>) =>
  (): Promise<T> =>
    fn();

function build(extra: Record<string, unknown> = {}) {
  const db = new BetterSqlite3(':memory:');
  const skills = new SqliteDocStore<SkillDoc>(db, 'skills');
  const userAgents = new UserAgentsService(
    new UserAgentsRepository(new SqliteDocStore(db, 'agents')),
    new BuiltinAgentPinsRepository(new SqliteDocStore(db, 'settings')),
    {
      list: jest.fn().mockResolvedValue([{ name: 'World Cup Core' }]),
    } as unknown as DatasetsRepository,
    new SkillsRepository(skills),
  );
  const registry = {
    'sql-fixer': fakeAgent('sql-fixer', ['b']),
    'insights-lead': fakeAgent(
      'insights-lead',
      ['run_readonly_sql', 'sample_rows', 'submit_dashboard'],
      'You are Elena.',
    ),
    'assistant-eval-judge': fakeAgent('assistant-eval-judge', []),
    ...extra,
  };
  const mastra = { listAgents: () => registry } as unknown as MastraService;
  return {
    db,
    skills,
    userAgents,
    service: new AgentsService(mastra, userAgents),
  };
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
        'sql-fixer',
        'insights-lead',
        'assistant-eval-judge',
      ]);
      // Built-ins show their persona: a human name and a job title,
      // sorted by that name (David, Elena, Laura).
      expect(agents[1]).toMatchObject({
        key: 'insights-lead',
        name: 'Elena',
        role: 'Insights Lead',
        domain: 'analysis',
        kind: 'official',
        owner: 'Official',
        status: 'builtin',
        pinned: false,
        hasUnpublishedChanges: false,
        missingDatasets: [],
        datasets: [],
        starterQuestions: [], // No catalogue workflow step calls her (api.md 33).
        usedInWorkflows: [],
      });
      // And its first-person intro (agents.md 1.1).
      expect(agents[1].intro).toMatch(/^Ask me a business question/);
      expect(agents[0]).toMatchObject({
        key: 'sql-fixer',
        name: 'David',
        role: 'SQL Developer',
        domain: 'sql',
        kind: 'system',
        owner: 'System',
      });
      expect(agents[2]).toMatchObject({
        key: 'assistant-eval-judge',
        domain: 'quality',
      });
    }),
  );

  it(
    'ignores a pin saved for a removed showcase agent (1.23.8)',
    asDemoUser(async () => {
      await ctx.service.setPinned('insights-lead', true);
      // A pin left behind by an earlier version, for an agent no longer registered.
      await ctx.userAgents.setBuiltinPin('strategy', true);
      await ctx.userAgents.setBuiltinPin('assistant', true);
      const agents = await ctx.service.list();
      expect(agents.map((agent) => agent.key)).toEqual([
        'sql-fixer',
        'insights-lead',
        'assistant-eval-judge',
      ]);
      expect(
        agents.find((agent) => agent.key === 'insights-lead')?.pinned,
      ).toBe(true);
      expect(await ctx.service.get('assistant')).toBeNull();
      expect(await ctx.service.get('strategy')).toBeNull();
    }),
  );

  it(
    'lists Insights Analyst as Official, with no datasets or requirement, and details its tools (BA-320)',
    asDemoUser(async () => {
      const v2 = build({
        'insights-analyst': fakeAgent('Insights Analyst', [
          'list_entities',
          'describe_entity',
          'sample_rows',
          'run_readonly_sql',
          'ask_clarification',
        ]),
      });
      const agents = await v2.service.list();
      const entry = agents.find((agent) => agent.key === 'insights-analyst');
      expect(entry).toMatchObject({
        kind: 'official',
        owner: 'Official',
        status: 'builtin',
        tools: [
          'ask_clarification',
          'describe_entity',
          'list_entities',
          'run_readonly_sql',
          'sample_rows',
        ],
        datasets: [],
        missingDatasets: [],
        starterQuestions: [],
      });
      expect(entry).not.toHaveProperty('chatRequirement');
      const detail = await v2.service.get('insights-analyst');
      expect(detail?.toolDetails.map((tool) => tool.name)).toEqual([
        'ask_clarification',
        'describe_entity',
        'list_entities',
        'run_readonly_sql',
        'sample_rows',
      ]);
      // Its workflow, for the Graph tab (api.md 34, R108): Avery + Michael.
      expect(detail?.workflow?.id).toBe('orchestrated-answer-michael');
      expect(detail?.workflow?.steps.map((step) => step.title)).toEqual([
        'Orchestrate',
      ]);
      expect((await v2.service.get('assistant'))?.workflow).toBeUndefined();
      // Its built-in skills, on demand (agents.md 7.4).
      const skills = (await v2.service.skills('insights-analyst')).skills;
      expect(
        skills.map(({ name, level, loading }) => ({ name, level, loading })),
      ).toEqual(
        ['curated-knowledge', 'result-validation', 'sql-analysis'].map(
          (name) => ({ name, level: 'built-in', loading: 'on-demand' }),
        ),
      );
      v2.db.close();
    }),
  );

  it(
    'lists Elena as Official and gives only her the conversation she is asked in (plan Elena 1.2)',
    asDemoUser(async () => {
      const ctx = build({
        'insights-lead': fakeAgent('Insights Lead', ['run_readonly_sql']),
        'chief-of-staff': fakeAgent('Chief of Staff', []),
      });
      const entry = (await ctx.service.list()).find(
        (agent) => agent.key === 'insights-lead',
      );
      expect(entry).toMatchObject({
        kind: 'official',
        owner: 'Official',
        name: 'Elena',
        role: 'Insights Lead',
      });
      expect((await ctx.service.get('insights-lead'))?.conversation).toEqual({
        workflowId: 'agent:insights-lead',
      });
      for (const key of ['assistant', 'chief-of-staff']) {
        expect((await ctx.service.get(key))?.conversation).toBeUndefined();
      }
      ctx.db.close();
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
        role: '  Claims Analyst  ',
        description: 'Plans',
        datasets: ['World Cup Core', 'Gone'],
        starterQuestions: ['Who won?'],
      });
      const agents = await ctx.service.list();
      expect(agents.map((agent) => agent.name)).toEqual([
        'David',
        'Elena',
        'Health plan analyst',
        'Laura',
      ]);
      const user = agents.find((agent) => agent.key === created.id);
      expect(user).toEqual({
        key: created.id,
        id: created.id,
        name: 'Health plan analyst',
        role: 'Claims Analyst',
        // A user agent has no persona intro: its card shows the description.
        intro: '',
        // No domain chosen: General.
        domain: 'general',
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
        usedInWorkflows: [],
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
        name: 'Insights Analyst',
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
      const elena = await ctx.service.get('insights-lead');
      expect(elena).toMatchObject({
        key: 'insights-lead',
        kind: 'official',
        instructions: 'You are Elena.',
      });
      expect(elena).not.toHaveProperty('draft');

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
        // Elena's prompt and tools under its selection (ADR-0059).
        instructions: 'You are Elena. [tools: ]',
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
      // Elena's tools under the selection, her dashboard gate closed.
      expect(summary?.tools).toEqual(['run_readonly_sql', 'sample_rows']);
      expect(created.tools).toEqual(['run_readonly_sql', 'sample_rows']);
      let detail = await ctx.service.get(created.id);
      expect(detail?.tools).toEqual(['run_readonly_sql', 'sample_rows']);
      expect(detail?.toolDetails.map((tool) => tool.name)).toEqual([
        'run_readonly_sql',
        'sample_rows',
      ]);
      expect(detail?.instructions).toBe('You are Elena. [tools: sample_rows]');
      expect(detail?.memory).toBeNull();

      // Live with every tool (a retired tool's link is accepted), while the
      // draft goes back to one tool: Live wins.
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
      expect(summary?.tools).toEqual(['run_readonly_sql', 'sample_rows']);
      detail = await ctx.service.get(created.id);
      expect(detail?.instructions).toBe('You are Elena.');
      expect(detail?.draft?.tools).toEqual([]);

      // Elena herself is unchanged: every tool, the dashboard one too.
      expect((await ctx.service.get('insights-lead'))?.tools).toEqual([
        'run_readonly_sql',
        'sample_rows',
        'submit_dashboard',
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
      expect((await ctx.service.setPinned('insights-lead', true)).pinned).toBe(
        true,
      );
      expect((await ctx.service.setPinned(created.id, true)).pinned).toBe(true);
      const pinned = (await ctx.service.list())
        .filter((agent) => agent.pinned)
        .map((agent) => agent.key);
      expect(pinned.sort()).toEqual(['insights-lead', created.id].sort());
      expect((await ctx.service.setPinned('insights-lead', false)).pinned).toBe(
        false,
      );
      await expect(ctx.service.setPinned('nope', true)).rejects.toThrow(
        'Agent "nope" not found',
      );
    }),
  );

  it(
    "shows a built-in agent's skills, and Elena's for a user agent",
    asDemoUser(async () => {
      const names = (view: { skills: { name: string }[] }) =>
        view.skills.map((skill) => skill.name);
      const elena = await ctx.service.skills('insights-lead');
      expect(names(elena)).toEqual([
        'answer-playbooks',
        'conversation-export',
        'curated-knowledge',
        'dashboard-building',
        'result-validation',
        'sql-analysis',
      ]);
      expect(
        elena.skills.find((skill) => skill.name === 'curated-knowledge'),
      ).toEqual({
        name: 'curated-knowledge',
        description: expect.stringMatching(/^Use when /) as string,
        loading: 'on-demand',
        level: 'built-in',
        files: [expect.objectContaining({ path: 'SKILL.md' })],
      });
      expect(Object.keys(elena)).toEqual(['skills']);
      const created = await ctx.service.create({ name: 'Analyst' });
      expect(names(await ctx.service.skills(created.id))).toEqual(names(elena));
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
        'insights-lead',
        'answer-playbooks',
        'reference/ambiguous.md',
      );
      expect(file.path).toBe('reference/ambiguous.md');
      expect(file.content?.length).toBeGreaterThan(0);

      await expect(
        ctx.service.skillFile('sql-fixer', 'answer-playbooks', 'SKILL.md'),
      ).rejects.toThrow('Agent "sql-fixer" has no skill "answer-playbooks"');
      await expect(
        ctx.service.skillFile('insights-lead', 'deep-analysis', 'SKILL.md'),
      ).rejects.toThrow('Agent "insights-lead" has no skill "deep-analysis"');
      await expect(
        ctx.service.skillFile(
          'insights-lead',
          'answer-playbooks',
          '../../app-skills.ts',
        ),
      ).rejects.toThrow('Invalid skill file path "../../app-skills.ts"');
      await expect(
        ctx.service.skillFile(
          'insights-lead',
          'answer-playbooks',
          'phases/9.md',
        ),
      ).rejects.toThrow('Skill "answer-playbooks" has no file "phases/9.md"');
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
      "follows Elena's skills with the draft's current ones, then the Live copies after a publish",
      asDemoUser(async () => {
        await ctx.skills.insert(skill('s2', 'zeta', 'Z body.'));
        await ctx.skills.insert(skill('s1', 'alpha', 'A body.'));
        const created = await ctx.service.create({
          name: 'Analyst',
          datasets: ['World Cup Core'],
          instructions: 'Use [[skill:zeta]] and [[skill:alpha]].',
        });
        const inApp = (view: { skills: { level?: string; name: string }[] }) =>
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
          ctx.service.skillFile('insights-lead', 'alpha', 'SKILL.md'),
        ).rejects.toThrow('Agent "insights-lead" has no skill "alpha"');
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
          (await ctx.service.skills('insights-lead')).skills.some(
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
        // Elena's library (ADR-0059): a retired tool's link is accepted
        // but never listed.
        expect(detail?.toolLinks?.map((entry) => entry.name)).toEqual([
          'ask_clarification',
          'describe_entity',
          'explore_result',
          'list_entities',
          'run_readonly_sql',
          'sample_rows',
        ]);
        expect(link(detail, 'sample_rows')).toEqual({
          name: 'sample_rows',
          status: 'linked',
          linkedVia: { instructions: false, skills: ['alpha', 'beta'] },
        });
        expect(link(detail, 'explore_result')?.status).toBe('always-on');
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
          'You are Elena. [tools: sample_rows]',
        );
        // A built-in agent has no links.
        expect(
          (await ctx.service.get('insights-lead'))?.toolLinks,
        ).toBeUndefined();
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
      const registry = { 'insights-lead': fakeAgent('insights-lead', []) };
      const service = new AgentsService(
        { listAgents: () => registry } as unknown as MastraService,
        new UserAgentsService(
          new UserAgentsRepository(new SqliteDocStore(db, 'agents')),
          new BuiltinAgentPinsRepository(new SqliteDocStore(db, 'settings')),
          {
            list: jest.fn().mockResolvedValue([{ name: 'World Cup Core' }]),
          } as unknown as DatasetsRepository,
          new SkillsRepository(new SqliteDocStore(db, 'skills')),
        ),
        llm as never,
      );
      {
        expect((await service.get('insights-lead'))?.llm).toEqual({
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
        expect((await service.get('insights-lead'))?.llm).toEqual({
          provider: null,
          providerName: null,
          model: null,
          apiKeyConfigured: false,
          maxOutputTokens: null,
          reasoningEffort: null,
        });
      }
      db.close();
    });

    it('names GitHub Copilot and reports it as configured without a key', async () => {
      const db = new BetterSqlite3(':memory:');
      const llm = {
        getView: jest.fn().mockResolvedValue({
          provider: 'copilot',
          model: 'auto',
          baseUrl: null,
          apiKeyMasked: null,
          reasoningEffort: 'high',
          configured: true,
          apiStyle: null,
        }),
      };
      const service = new AgentsService(
        {
          listAgents: () => ({
            'insights-lead': fakeAgent('insights-lead', []),
          }),
        } as unknown as MastraService,
        new UserAgentsService(
          new UserAgentsRepository(new SqliteDocStore(db, 'agents')),
          new BuiltinAgentPinsRepository(new SqliteDocStore(db, 'settings')),
          {
            list: jest.fn().mockResolvedValue([]),
          } as unknown as DatasetsRepository,
          new SkillsRepository(new SqliteDocStore(db, 'skills')),
        ),
        llm as never,
      );
      expect((await service.get('insights-lead'))?.llm).toMatchObject({
        provider: 'copilot',
        providerName: 'GitHub Copilot',
        model: 'auto',
        apiKeyConfigured: true,
      });
      db.close();
    });

    it('names a custom endpoint and reports a saved keyless one as configured (R53)', async () => {
      const db = new BetterSqlite3(':memory:');
      const llm = {
        getView: jest.fn().mockResolvedValue({
          provider: 'custom',
          model: 'qwen3-coder',
          baseUrl: 'http://127.0.0.1:8317/v1',
          apiKeyMasked: null,
          reasoningEffort: 'medium',
          configured: true,
          apiStyle: 'openai',
        }),
      };
      const service = new AgentsService(
        {
          listAgents: () => ({
            'insights-lead': fakeAgent('insights-lead', []),
          }),
        } as unknown as MastraService,
        new UserAgentsService(
          new UserAgentsRepository(new SqliteDocStore(db, 'agents')),
          new BuiltinAgentPinsRepository(new SqliteDocStore(db, 'settings')),
          {
            list: jest.fn().mockResolvedValue([]),
          } as unknown as DatasetsRepository,
          new SkillsRepository(new SqliteDocStore(db, 'skills')),
        ),
        llm as never,
      );
      expect((await service.get('insights-lead'))?.llm).toEqual({
        provider: 'custom',
        providerName: 'Custom endpoint',
        model: 'qwen3-coder',
        apiKeyConfigured: true,
        maxOutputTokens: null,
        reasoningEffort: 'medium',
      });
      db.close();
    });
  });
});
