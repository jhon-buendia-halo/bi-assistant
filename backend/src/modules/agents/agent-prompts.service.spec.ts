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
jest.mock('../knowledge/knowledge.service', () => ({
  KnowledgeService: class {},
}));
jest.mock('@mastra/core/agent', () => ({ Agent: class {} }));

import { RequestMethod } from '@nestjs/common';
import BetterSqlite3 from 'better-sqlite3';
import { AUTH_REQUIREMENT_KEY } from '../../common/decorators/auth-requirement.decorators';
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
import { CurrentUserService } from '../auth/current-user.service';
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
  'sql-verifier': { name: 'SQL Verifier' },
  'knowledge-bootstrap': { name: 'Knowledge Bootstrap' },
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
    new CurrentUserService(),
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
    // The RFP Builder, the other Official agent, links too (BA-228).
    expect(await service.view('rfp')).toMatchObject({
      editable: shippedAgentPrompt('rfp'),
      linksAllowed: true,
    });
    // Its detail shows the links as written, for the chips and the Graph tab.
    expect((await service.view('rfp'))?.editable).toContain(
      '1 client and renewal — [[skill:rfp-client-renewal]]',
    );
    expect((await service.view('rfp'))?.editable).toContain('[[tool:get_rfp]]');
    expect(await service.view('user-1')).toBeUndefined();
  });

  it('saves, serves on the next call and shows the override as the editable text', async () => {
    const { service } = build();
    const name = await service.save('sql-fixer', { prompt: '  Fix it.  ' });
    expect(name).toBe('SQL Fixer');
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
    expect(await service.reset('visualization')).toBe(
      'Interactive Visual Designer',
    );
    expect(agentPromptOverrideFor('visualization')).toBeUndefined();
    expect(await service.view('visualization')).toMatchObject({
      modified: false,
    });
    await expect(service.reset('visualization')).resolves.toBe(
      'Interactive Visual Designer',
    );
  });

  it('loads the stored overrides into the bridge on init', async () => {
    const { service, store } = build();
    await store.update(
      { key: 'sql-verifier' },
      {
        key: 'sql-verifier',
        prompt: 'Stored.',
        baseHash: 'h',
        updatedBy: 'x',
      },
      { upsert: true },
    );
    await service.onModuleInit();
    expect(agentPromptOverrideFor('sql-verifier')?.prompt).toBe('Stored.');
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

    it("the RFP Builder's identity, then skill links, then tools not its own", async () => {
      expect(await refusal('rfp', 'Be brief.')).toBe(
        'The RFP Builder\'s prompt must start with "You are the RFP Builder"',
      );
      const skillRefusal =
        "Only the RFP Builder's own skills can be linked here: this prompt is shared by every user";
      expect(
        await refusal('rfp', 'You are the RFP Builder. [[skill:x]] [[tool:x]]'),
      ).toBe(skillRefusal);
      // The assistant's built-in skill is not the RFP Builder's.
      expect(
        await refusal(
          'rfp',
          'You are the RFP Builder. [[skill:curated-knowledge]]',
        ),
      ).toBe(skillRefusal);
      expect(await refusal('rfp', 'You are the RFP Builder. [[tool:x]]')).toBe(
        'Unknown tool "x"',
      );
      // An assistant-only tool is not one of its tools.
      expect(
        await refusal(
          'rfp',
          'You are the RFP Builder. [[skill:rfp-carriers]] [[tool:run_readonly_sql]]',
        ),
      ).toBe('Unknown tool "run_readonly_sql"');
    });

    it("accepts the RFP Builder's own tools and skill in its prompt", async () => {
      const { service } = build();
      await service.save('rfp', {
        prompt:
          'You are the RFP Builder. Load [[skill:rfp-client-renewal]] and [[skill:rfp-package]], then call [[tool:list_clients]], [[tool:set_rfp_timeline]] and [[tool:ask_clarification]].',
      });
      expect(agentPromptOverrideFor('rfp')?.prompt).toContain(
        '[[skill:rfp-client-renewal]]',
      );
      // Its shipped prompt, links and all, saves as an override.
      await expect(
        service.save('rfp', { prompt: shippedAgentPrompt('rfp') }),
      ).resolves.toBe('rfp');
    });

    it("refuses the RFP Builder's tools and skill in the assistant prompt", async () => {
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
      ).resolves.toBe('SQL Fixer');
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
      ).resolves.toBe('Questions to Insights Assistant');
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
  const requirement = (method: keyof AgentsController) =>
    Reflect.getMetadata(
      AUTH_REQUIREMENT_KEY,
      // eslint-disable-next-line @typescript-eslint/unbound-method
      AgentsController.prototype[method],
    ) as unknown;
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

  it('needs edit-policies to save or reset, and keeps reading on use-agents', () => {
    const need = (permission: string) => ({ kind: 'permission', permission });
    expect(requirement('savePrompt')).toEqual(need('edit-policies'));
    expect(requirement('resetPrompt')).toEqual(need('edit-policies'));
    expect(requirement('get')).toEqual(need('use-agents'));
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
      message: 'System prompt of "SQL Fixer" saved',
      agent: { key: 'sql-fixer', name: 'SQL Fixer' },
    });
    await expect(controller.resetPrompt('sql-fixer')).resolves.toMatchObject({
      ok: true,
      message: 'System prompt of "SQL Fixer" reset',
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
