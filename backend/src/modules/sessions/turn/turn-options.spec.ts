// What reaches Elena's model on a run host's turn (agents.md 4.1, 4.2): the
// options `TurnOptions.agentOptions` builds, read as plain data.
jest.mock('@mastra/core/request-context', () => ({
  RequestContext: class {
    readonly values = new Map<string, unknown>();
    set = (key: string, value: unknown) => {
      this.values.set(key, value);
    };
    get = (key: string) => this.values.get(key);
  },
}));
jest.mock('../../../mastra/tools/dataset.tools', () => ({
  DATASETS_CONTEXT_KEY: 'datasets',
}));
jest.mock('../../../mastra/session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace-id',
}));
jest.mock('../../../mastra/model-resolver', () => ({
  AGENT_OVERRIDES_CONTEXT_KEY: 'agent-overrides',
  resolveAgentModelConfig: jest.fn((override?: string) =>
    Promise.resolve({
      id: `openai/${override ?? 'saved-model'}`,
      apiKey: 'test',
    }),
  ),
}));

import type { Logger } from '@nestjs/common';
import type { SessionDoc } from '../entities/session.entity';
import { TurnOptions, type TurnOptionsDeps } from './turn-options';

/** The data dependencies of a turn, answering as one World Cup dataset. */
function deps(overrides: Partial<TurnOptionsDeps> = {}): TurnOptionsDeps {
  return {
    mastra: {
      ensureSessionWorkspace: jest.fn(() => Promise.resolve({ id: 'ws-1' })),
    } as unknown as TurnOptionsDeps['mastra'],
    llmService: {
      getView: jest.fn(() => Promise.resolve({ reasoningEffort: 'medium' })),
    } as unknown as TurnOptionsDeps['llmService'],
    visuals: {
      currentVersion: () => 1,
    } as unknown as TurnOptionsDeps['visuals'],
    verifiedQueries: {
      referenceBlock: jest.fn(() =>
        Promise.resolve('Verified queries:\n- Who won? → SELECT 1'),
      ),
    } as unknown as TurnOptionsDeps['verifiedQueries'],
    metrics: {
      definitionBlock: jest.fn(() =>
        Promise.resolve('Metrics:\n- goals = SUM(goals)'),
      ),
    } as unknown as TurnOptionsDeps['metrics'],
    knowledge: {
      contextFor: jest.fn(() =>
        Promise.resolve({
          block: 'Curated knowledge:\n- A final is the last match.',
          used: [{ id: 'k1', kind: 'glossary', title: 'Final' }],
        }),
      ),
    } as unknown as TurnOptionsDeps['knowledge'],
    userAgents: {
      get: jest.fn(() => Promise.resolve(null)),
      skillsFor: jest.fn(() => Promise.resolve([])),
    } as unknown as TurnOptionsDeps['userAgents'],
    datasets: {
      bound: jest.fn(() =>
        Promise.resolve([
          {
            name: 'World Cup',
            datasourceId: 'ds-pg',
            datasourceKind: 'postgres',
            tables: ['wc.public.matches', 'wc.public.teams'],
          },
        ]),
      ),
    } as unknown as TurnOptionsDeps['datasets'],
    logger: { warn: jest.fn() } as unknown as Logger,
    existingDatasets: jest.fn((names: string[]) => Promise.resolve(names)),
    updateDoc: jest.fn(() => Promise.resolve(undefined)),
    ...overrides,
  };
}

/** A run host of Elena's conversation (agents.md 5.14), no user agent. */
function elenaHost(patch: Partial<SessionDoc> = {}): SessionDoc {
  return {
    id: 'run-r1',
    name: 'Run r1',
    datasets: ['World Cup'],
    agentKey: 'insights-lead',
    workflowId: 'agent:insights-lead',
    run: true,
    messages: [],
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    ...patch,
  } as SessionDoc;
}

/** The options as plain data: every requestContext key and value. */
function plain(options: Awaited<ReturnType<TurnOptions['agentOptions']>>) {
  const { requestContext, abortSignal, ...rest } = options as typeof options & {
    requestContext: { values: Map<string, unknown> };
  };
  void abortSignal;
  return {
    ...rest,
    requestContext: Object.fromEntries(requestContext.values.entries()),
  };
}

describe("TurnOptions: Elena's options on a run host (agents.md 4.1, 4.2)", () => {
  it('a plain run host (no user agent) gets the context blocks, keys, budget and provider options of the snapshot', async () => {
    const options = await new TurnOptions(deps()).agentOptions(
      elenaHost(),
      'Who won?',
    );

    expect(plain(options)).toMatchSnapshot();
  });
});
