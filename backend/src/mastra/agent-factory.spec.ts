// The real Agent pulls in ESM-only packages Jest cannot require; this
// stand-in keeps the config it is built with.
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(readonly config: Record<string, unknown>) {}
  },
}));
jest.mock('./model-resolver', () => ({
  resolveAgentModel: jest.fn((model?: string) =>
    Promise.resolve(`model:${model ?? 'saved'}`),
  ),
  modelOverrideFrom: (context?: { get(key: string): unknown }) =>
    (context?.get('agent-overrides') as { model?: string } | undefined)?.model,
}));

import { RequestContext } from '@mastra/core/request-context';
import { setAgentPromptOverrides } from './agent-prompt-overrides';
import {
  builtinAgentClasses,
  defineBuiltinAgent,
  servedPromptWithTools,
} from './agent-factory';

type Config = Record<string, unknown>;
const configOf = (agent: unknown) => (agent as { config: Config }).config;
type Resolver = (args?: { requestContext?: RequestContext }) => unknown;
const call = (config: Config, key: string, requestContext?: RequestContext) =>
  (config[key] as Resolver)({ requestContext });

const context = (entries: Record<string, unknown>) => {
  const requestContext = new RequestContext();
  for (const [key, value] of Object.entries(entries)) {
    requestContext.set(key, value);
  }
  return requestContext;
};

describe('defineBuiltinAgent (agents.md 1.1)', () => {
  beforeEach(() => setAgentPromptOverrides([]));

  it('serves a shipped prompt, or its in-app override once one is saved', () => {
    const config = configOf(
      defineBuiltinAgent({
        key: 'factory-probe',
        name: 'Probe',
        description: 'A probe.',
        classes: ['single-step'],
        instructions: 'Shipped prompt.',
        model: 'saved',
      }),
    );
    expect(call(config, 'instructions')).toBe('Shipped prompt.');
    setAgentPromptOverrides([
      { key: 'factory-probe', prompt: 'Edited prompt.', baseHash: 'h' },
    ]);
    expect(call(config, 'instructions')).toBe('Edited prompt.');
  });

  it("hands a prompt function the call's context", () => {
    const config = configOf(
      defineBuiltinAgent({
        key: 'factory-context',
        name: 'Probe',
        description: 'A probe.',
        classes: ['person'],
        instructions: (requestContext) =>
          `for ${String(requestContext?.get('who'))}`,
        model: 'saved',
      }),
    );
    expect(call(config, 'instructions', context({ who: 'Ana' }))).toBe(
      'for Ana',
    );
  });

  it.each([
    ['saved', {}, 'model:saved'],
    ['saved', { 'step-model': { model: 'opus' } }, 'model:saved'],
    ['step-model', {}, 'model:saved'],
    ['step-model', { 'step-model': { model: 'opus' } }, 'model:opus'],
    ['user-override', { 'step-model': { model: 'opus' } }, 'model:saved'],
    ['user-override', { 'agent-overrides': { model: 'mine' } }, 'model:mine'],
  ] as const)(
    'resolves the %s policy on the call (agents.md 1.3)',
    async (model, entries, expected) => {
      const config = configOf(
        defineBuiltinAgent({
          key: `factory-model-${model}`,
          name: 'Probe',
          description: 'A probe.',
          classes: ['single-step'],
          instructions: 'Prompt.',
          model,
        }),
      );
      await expect(call(config, 'model', context(entries))).resolves.toBe(
        expected,
      );
    },
  );

  it('leaves out what the spec does not give and keeps the Mastra id apart from the key', () => {
    const config = configOf(
      defineBuiltinAgent({
        key: 'factory-bare',
        id: 'factory-bare-agent',
        name: 'Probe',
        description: 'A probe.',
        classes: ['single-step'],
        instructions: 'Prompt.',
        model: 'saved',
      }),
    );
    expect(config['id']).toBe('factory-bare-agent');
    for (const key of ['tools', 'skills', 'memory', 'workspace']) {
      expect(key in config).toBe(false);
    }
    setAgentPromptOverrides([
      { key: 'factory-bare', prompt: 'By key.', baseHash: 'h' },
    ]);
    expect(call(config, 'instructions')).toBe('By key.');
  });

  it('records the classes each agent declares', () => {
    defineBuiltinAgent({
      key: 'factory-classes',
      name: 'Probe',
      description: 'A probe.',
      classes: ['person', 'data'],
      instructions: 'Prompt.',
      model: 'saved',
    });
    expect(builtinAgentClasses()['factory-classes']).toEqual([
      'person',
      'data',
    ]);
  });
});

describe('servedPromptWithTools (agents.md 2.8)', () => {
  beforeEach(() => setAgentPromptOverrides([]));

  const tools = {
    list_entities: {
      description: 'List the entities. More text.',
      inputSchema: undefined,
    },
  };

  it('lists the tools before the working rules, in the override too', () => {
    const shipped = 'Intro.\n\n## Working rules\n\n- Be exact.';
    const served = servedPromptWithTools('factory-tools', shipped, tools);
    expect(served.indexOf('## Tools')).toBeGreaterThan(-1);
    expect(served.indexOf('## Tools')).toBeLessThan(
      served.indexOf('## Working rules'),
    );
    setAgentPromptOverrides([
      {
        key: 'factory-tools',
        prompt: 'Edited [[tool:list_entities]].',
        baseHash: 'h',
      },
    ]);
    const edited = servedPromptWithTools('factory-tools', shipped, tools);
    expect(edited.startsWith('Edited the "list_entities" tool.')).toBe(true);
    expect(edited).toContain('## Tools');
  });
});
