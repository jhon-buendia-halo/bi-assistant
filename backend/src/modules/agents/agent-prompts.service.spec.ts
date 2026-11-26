// The real Mastra instance and the services around the controller pull in
// ESM-only packages Jest cannot require; these tests only need the shapes.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
jest.mock('../../mastra/evals/assistant.evals', () => ({
  ASSISTANT_EVAL_SETS: [],
}));
jest.mock('../../mastra/evals/eval-sets', () => ({ evalSetsFor: () => [] }));
jest.mock('../llm/llm.service', () => ({ LlmService: class {} }));
jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
}));
jest.mock('../ontology/ontology.service', () => ({
  OntologyService: class {},
}));
jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));

import { RequestMethod } from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import {
  agentPromptOverrideFor,
  setAgentPromptOverrides,
} from '../../mastra/agent-prompt-overrides';
import type { MastraService } from '../../mastra/mastra.service';
import {
  agentPromptHash,
  shippedAgentPrompt,
} from '../../mastra/shipped-agent-prompts';
import type { UserAgentsService } from '../user-agents/user-agents.service';
import { AgentPromptsService } from './agent-prompts.service';
import { AgentsController } from './agents.controller';
import type { AgentPromptOverrideDoc } from './entities/agent-prompt-override.entity';
import { AgentPromptOverridesRepository } from './repositories/agent-prompt-overrides.repository';

const IDENTITY = 'You are the Questions to Insights assistant';
const REGISTRY = {
  assistant: { name: 'Questions to Insights Assistant' },
  visualization: { name: 'Interactive Visual Designer' },
  'sql-fixer': { name: 'SQL Fixer' },
  'assistant-eval-judge': { name: 'Assistant Eval Judge' },
};

function build() {
  const db = new BetterSqlite3(':memory:');
  const store = new SqliteDocStore<AgentPromptOverrideDoc>(
    db,
    'agent_prompt_overrides',
  );
  const service = new AgentPromptsService(
    new AgentPromptOverridesRepository(store),
    { listAgents: () => REGISTRY } as unknown as MastraService,
    {
      get: (id: string) => Promise.resolve(id === 'user-1' ? { id } : null),
    } as unknown as UserAgentsService,
  );
  return { store, service };
}

afterEach(() => setAgentPromptOverrides([]));

describe('AgentPromptsService (ADR-0026)', () => {
  it('shows the shipped prompt of every built-in agent, unmodified', async () => {
    const { service } = build();
    for (const key of Object.keys(REGISTRY)) {
      const view = await service.view(key);
      expect(view).toEqual({
        editable: shippedAgentPrompt(key),
        shipped: shippedAgentPrompt(key),
        modified: false,
        builtInChanged: false,
        linksAllowed: key === 'assistant',
        updatedAt: null,
      });
    }
    expect(await service.view('user-1')).toBeUndefined();
  });

  it('ignores a prompt override saved for a removed showcase agent (1.23.8)', async () => {
    const { service, store } = build();
    await store.insert({
      key: 'strategy',
      prompt: 'Old text.',
      baseHash: 'x',
      updatedBy: 'u',
    });
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(await service.view('strategy')).toBeUndefined();
    await expect(service.save('strategy', { prompt: 'x' })).rejects.toThrow(
      'Agent "strategy" not found',
    );
    // The other agents still read their own prompts.
    expect(await service.view('sql-fixer')).toMatchObject({ modified: false });
  });

  it.each([
    ['the removed RFP Builder', 'rfp', 'You are the RFP Builder. Old text.'],
    [
      'the removed Data Readiness Agent',
      'data-readiness',
      'You are the Data Readiness Agent. Old text.',
    ],
  ])('ignores a prompt override saved for %s', async (_label, key, prompt) => {
    const { service, store } = build();
    await store.insert({ key, prompt, baseHash: 'x', updatedBy: 'u' });
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(shippedAgentPrompt(key)).toBeUndefined();
    expect(await service.view(key)).toBeUndefined();
    await expect(service.save(key, { prompt: 'x' })).rejects.toThrow(
      `Agent "${key}" not found`,
    );
    await expect(service.reset(key)).rejects.toThrow(
      `Agent "${key}" not found`,
    );
    expect(await service.view('sql-fixer')).toMatchObject({ modified: false });
  });

  it('saves, serves on the next call and shows the override as the editable text', async () => {
    const { service } = build();
    const name = await service.save('sql-fixer', { prompt: '  Fix it.  ' });
    expect(name).toBe('David');
    // Trimmed, and mirrored into the bridge the agent reads per call.
    expect(agentPromptOverrideFor('sql-fixer')?.prompt).toBe('Fix it.');
    const view = await service.view('sql-fixer');
    expect(view).toMatchObject({
      editable: 'Fix it.',
      shipped: shippedAgentPrompt('sql-fixer'),
      modified: true,
      builtInChanged: false,
    });
    expect(view?.updatedAt).toEqual(expect.any(String));
  });

  it('flags drift when the shipped text no longer matches the saved hash', async () => {
    const { service, store } = build();
    await service.save('sql-fixer', { prompt: 'Fix it.' });
    const saved = await store.findOne({ key: 'sql-fixer' });
    await store.update(
      { key: 'sql-fixer' },
      { ...saved!, baseHash: agentPromptHash('an older shipped text') },
    );
    expect(await service.view('sql-fixer')).toMatchObject({
      modified: true,
      builtInChanged: true,
    });
  });

  it('resets, also when there was no override', async () => {
    const { service } = build();
    await service.save('visualization', { prompt: 'Edited.' });
    expect(await service.reset('visualization')).toBe('Ryan');
    expect(agentPromptOverrideFor('visualization')).toBeUndefined();
    expect(await service.view('visualization')).toMatchObject({
      modified: false,
    });
    await expect(service.reset('visualization')).resolves.toBe('Ryan');
  });

  it('loads the stored overrides into the bridge on init', async () => {
    const { service, store } = build();
    await store.update(
      { key: 'sql-fixer' },
      {
        key: 'sql-fixer',
        prompt: 'Stored.',
        baseHash: 'h',
        updatedBy: 'x',
      },
      { upsert: true },
    );
    await service.onModuleInit();
    expect(agentPromptOverrideFor('sql-fixer')?.prompt).toBe('Stored.');
  });

  describe('refusals, first that applies', () => {
    const refusal = async (key: string, prompt: unknown) => {
      const { service } = build();
      const error = await service.save(key, { prompt }).then(
        () => null,
        (e: Error) => e.message,
      );
      expect(agentPromptOverrideFor(key)).toBeUndefined();
      return error;
    };

    it('an unknown key, then a user agent, before the prompt is read', async () => {
      expect(await refusal('nope', '')).toBe('Agent "nope" not found');
      expect(await refusal('user-1', '')).toBe(
        "Only built-in agents have a shared system prompt; edit a user agent's instructions instead",
      );
      const { service } = build();
      await expect(service.reset('nope')).rejects.toThrow(
        'Agent "nope" not found',
      );
      await expect(service.reset('user-1')).rejects.toThrow(
        "Only built-in agents have a shared system prompt; edit a user agent's instructions instead",
      );
    });

    it("Insights Analyst's identity, then skills not its own, then tools not its own (BA-320)", async () => {
      const identity = 'You are Questions to Insights';
      expect(await refusal('insights-analyst', 'Be brief.')).toBe(
        `The Insights Analyst prompt must start with "${identity}"`,
      );
      // The assistant's identity is not v2's.
      expect(await refusal('insights-analyst', `${IDENTITY}.`)).toBe(
        `The Insights Analyst prompt must start with "${identity}"`,
      );
      const skillRefusal =
        "Only Insights Analyst's own skills can be linked here: this prompt is shared by every user";
      for (const skill of ['x', 'avery-playbooks', 'dashboard-building']) {
        expect(
          await refusal(
            'insights-analyst',
            `${identity}. [[skill:${skill}]] [[tool:x]]`,
          ),
        ).toBe(skillRefusal);
      }
      // Neither the assistant's other tools nor another agent's.
      for (const tool of [
        'x',
        'create_visual',
        'update_visual',
        'show_in_panel',
        'update_workflow',
        'answer_from_data',
        'get_rfp',
      ]) {
        expect(
          await refusal(
            'insights-analyst',
            `${identity}. [[skill:sql-analysis]] [[tool:${tool}]]`,
          ),
        ).toBe(`Unknown tool "${tool}"`);
      }
    });

    it("accepts Insights Analyst's own tools and skills in its prompt, and shows it with links allowed", async () => {
      const { service } = build();
      expect(await service.view('insights-analyst')).toEqual({
        editable: shippedAgentPrompt('insights-analyst'),
        shipped: shippedAgentPrompt('insights-analyst'),
        modified: false,
        builtInChanged: false,
        linksAllowed: true,
        updatedAt: null,
      });
      await service.save('insights-analyst', {
        prompt:
          'You are Questions to Insights. Call [[tool:list_entities]], [[tool:describe_entity]], [[tool:sample_rows]], [[tool:run_readonly_sql]] and [[tool:ask_clarification]]. Load [[skill:curated-knowledge]], [[skill:sql-analysis]] and [[skill:result-validation]].',
      });
      expect(agentPromptOverrideFor('insights-analyst')?.prompt).toContain(
        '[[skill:result-validation]]',
      );
      await expect(
        service.save('insights-analyst', {
          prompt: shippedAgentPrompt('insights-analyst'),
        }),
      ).resolves.toBe('Michael');
    });

    it("Elena's prompt with its shipped tool links saves, and Reset restores it", async () => {
      const { service } = build();
      expect(await service.view('insights-lead')).toMatchObject({
        shipped: shippedAgentPrompt('insights-lead'),
        linksAllowed: true,
      });
      const shipped = shippedAgentPrompt('insights-lead');
      const edited = `${shipped}\n- Also see [[tool:create_visual]] (retired).`;
      await expect(
        service.save('insights-lead', { prompt: edited }),
      ).resolves.toBe('Elena');
      expect(agentPromptOverrideFor('insights-lead')?.prompt).toBe(edited);
      await expect(service.reset('insights-lead')).resolves.toBe('Elena');
      expect(agentPromptOverrideFor('insights-lead')).toBeUndefined();
      expect(await service.view('insights-lead')).toMatchObject({
        editable: shipped,
        modified: false,
      });
    });

    it("refuses a tool or skill in Elena's prompt that is not hers", async () => {
      const { service } = build();
      await expect(
        service.save('insights-lead', {
          prompt: 'You are Elena. Load [[skill:avery-playbooks]].',
        }),
      ).rejects.toThrow(
        "Only Elena's own skills can be linked here: this prompt is shared by every user",
      );
      await expect(
        service.save('insights-lead', {
          prompt: 'You are Elena. Call [[tool:answer_from_data]].',
        }),
      ).rejects.toThrow('Unknown tool "answer_from_data"');
    });

    it("refuses another agent's skill in the assistant prompt", async () => {
      expect(
        await refusal('assistant', `${IDENTITY}. [[skill:avery-playbooks]]`),
      ).toBe(
        'Only built-in skills can be linked here: this prompt is shared by every user',
      );
    });

    it("refuses the removed RFP Builder's tools and skill in the assistant prompt", async () => {
      expect(
        await refusal('assistant', `${IDENTITY}. [[skill:rfp-timeline]]`),
      ).toBe(
        'Only built-in skills can be linked here: this prompt is shared by every user',
      );
      expect(
        await refusal('assistant', `${IDENTITY}. [[tool:list_clients]]`),
      ).toBe('Unknown tool "list_clients"');
    });

    it('an empty prompt, then one over 20,000 characters', async () => {
      expect(await refusal('sql-fixer', '  \n ')).toBe('The prompt is empty');
      expect(await refusal('sql-fixer', undefined)).toBe('The prompt is empty');
      expect(await refusal('sql-fixer', 'x'.repeat(20001))).toBe(
        'The prompt is at most 20,000 characters',
      );
      const { service } = build();
      await expect(
        service.save('sql-fixer', { prompt: 'x'.repeat(20000) }),
      ).resolves.toBe('David');
    });

    it("the assistant's identity, then skill links, then unknown tools", async () => {
      expect(await refusal('assistant', 'Be brief.')).toBe(
        `The assistant's prompt must start with "${IDENTITY}"`,
      );
      expect(
        await refusal('assistant', `${IDENTITY}. [[skill:x]] [[tool:nope]]`),
      ).toBe(
        'Only built-in skills can be linked here: this prompt is shared by every user',
      );
      expect(
        await refusal(
          'assistant',
          `${IDENTITY}. [[skill:curated-knowledge]] [[tool:nope]]`,
        ),
      ).toBe('Unknown tool "nope"');
      expect(await refusal('assistant', `${IDENTITY}. [[tool:nope]]`)).toBe(
        'Unknown tool "nope"',
      );
    });

    it('accepts a built-in on-demand skill link in the assistant prompt', async () => {
      const { service } = build();
      await expect(
        service.save('assistant', {
          prompt: `${IDENTITY}. See [[skill:curated-knowledge]] and [[tool:sample_rows]].`,
        }),
      ).resolves.toBe('Emily');
    });

    it('any link in a System agent prompt', async () => {
      expect(await refusal('sql-fixer', 'See [[tool:run_readonly_sql]].')).toBe(
        "This agent's prompt can't contain links",
      );
      expect(await refusal('visualization', 'a [[x]] b')).toBe(
        "This agent's prompt can't contain links",
      );
    });

    it('accepts library tool links in the assistant prompt', async () => {
      const { service } = build();
      await service.save('assistant', {
        prompt: `${IDENTITY}.\n\nPrefer [[tool:sample_rows]].`,
      });
      expect(agentPromptOverrideFor('assistant')?.prompt).toContain(
        '[[tool:sample_rows]]',
      );
    });
  });
});

describe('AgentsController prompt routes (api.md 103-104)', () => {
  const route = (method: keyof AgentsController) => ({
    path: Reflect.getMetadata(
      'path',
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AgentsController.prototype[method],
    ) as unknown,
    verb: Reflect.getMetadata(
      'method',
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AgentsController.prototype[method],
    ) as unknown,
  });

  it('declares PUT and DELETE :key/prompt', () => {
    expect(route('savePrompt')).toEqual({
      path: ':key/prompt',
      verb: RequestMethod.PUT,
    });
    expect(route('resetPrompt')).toEqual({
      path: ':key/prompt',
      verb: RequestMethod.DELETE,
    });
  });

  it('answers Style A with the agent, or the refusal', async () => {
    const { service } = build();
    const agents = {
      get: jest.fn((key: string) =>
        Promise.resolve({ key, name: REGISTRY['sql-fixer'].name }),
      ),
    };
    const controller = new AgentsController(
      agents as never,
      {} as never,
      service,
    );
    await expect(
      controller.savePrompt('sql-fixer', { prompt: 'Fix it.' }),
    ).resolves.toEqual({
      ok: true,
      message: 'Job description of "David" saved',
      agent: { key: 'sql-fixer', name: 'SQL Fixer' },
    });
    await expect(controller.resetPrompt('sql-fixer')).resolves.toMatchObject({
      ok: true,
      message: 'Job description of "David" reset',
    });
    await expect(
      controller.savePrompt('sql-fixer', { prompt: '' }),
    ).resolves.toEqual({ ok: false, message: 'The prompt is empty' });
    await expect(controller.resetPrompt('nope')).resolves.toEqual({
      ok: false,
      message: 'Agent "nope" not found',
    });
  });
});
