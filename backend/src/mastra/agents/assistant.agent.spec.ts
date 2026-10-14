// The real Agent pulls in ESM-only packages Jest cannot require. This
// stand-in resolves `instructions` and `tools` the way @mastra/core 1.66's
// Agent does: a function is called with `{ requestContext, mastra }`, and the
// requestContext defaults to an empty one when the caller passes none.
jest.mock('@mastra/core/agent', () => {
  const { RequestContext: Context } = jest.requireActual<
    typeof import('@mastra/core/request-context')
  >('@mastra/core/request-context');
  type Resolver = (args: { requestContext: unknown }) => unknown;
  const resolve = (value: unknown, requestContext: unknown) =>
    typeof value === 'function'
      ? (value as Resolver)({ requestContext })
      : value;
  return {
    Agent: class {
      constructor(
        private readonly config: { instructions: unknown; tools: unknown },
      ) {}
      getInstructions({ requestContext = new Context() } = {}) {
        return resolve(this.config.instructions, requestContext);
      }
      listTools({ requestContext = new Context() } = {}) {
        return Promise.resolve(resolve(this.config.tools, requestContext));
      }
    },
  };
});
jest.mock('@mastra/memory', () => ({ Memory: class {} }));
jest.mock('../session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace-id',
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { RequestContext } from '@mastra/core/request-context';
import { catalogSkills } from '../app-skills';
import { AGENT_TOOLS_CONTEXT_KEY } from '../agent-tools';
import { assistantAgent, assistantVariant } from './assistant.agent';

/**
 * The full prompt captured from the assistant before tool selection existed
 * (BA-217), with each skill's folder written as `<skills>/<name>`. Every tool
 * selected, or none on the context, must still produce it byte for byte.
 */
const GOLDEN = readFileSync(
  join(__dirname, '__fixtures__', 'assistant-prompt.full.txt'),
  'utf8',
);

/** The prompt with this machine's skill folders replaced as in GOLDEN. */
function portable(prompt: string): string {
  return catalogSkills('assistant').reduce(
    (text, skill) =>
      text
        .split(join(skill.dir, 'SKILL.md'))
        .join(`<skills>/${skill.name}/SKILL.md`),
    prompt,
  );
}

function contextWith(tools?: string[]): RequestContext {
  const requestContext = new RequestContext();
  if (tools) requestContext.set(AGENT_TOOLS_CONTEXT_KEY, tools);
  return requestContext;
}

const FULL_TOOLS = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'create_visual',
  'update_visual',
  'ask_clarification',
  'read_file',
];

/** The assistant's prompt for a call; it is always a plain string. */
async function prompt(tools?: string[]): Promise<string> {
  return (await assistantAgent.getInstructions({
    requestContext: contextWith(tools),
  })) as string;
}

async function toolNames(tools?: string[]): Promise<string[]> {
  return Object.keys(
    await assistantAgent.listTools({ requestContext: contextWith(tools) }),
  );
}

describe('assistant tool selection (ADR-0021, agents.md 2.1)', () => {
  it('gives the unchanged full prompt and tools with no selection', async () => {
    expect(portable((await assistantAgent.getInstructions()) as string)).toBe(
      GOLDEN,
    );
    expect(portable(await prompt())).toBe(GOLDEN);
    expect(Object.keys(await assistantAgent.listTools())).toEqual(FULL_TOOLS);
  });

  it('gives the unchanged full prompt and tools with all three selected', async () => {
    const all = ['visuals', 'ask_clarification', 'sample_rows'];
    expect(portable(await prompt(all))).toBe(GOLDEN);
    expect(await toolNames(all)).toEqual(FULL_TOOLS);
  });

  it('offers only the always-given tools and the selected ones, in order', async () => {
    expect(await toolNames(['sample_rows'])).toEqual([
      'list_entities',
      'describe_entity',
      'sample_rows',
      'run_readonly_sql',
      'read_file',
    ]);
    expect(await toolNames(['visuals'])).toEqual([
      'list_entities',
      'describe_entity',
      'run_readonly_sql',
      'create_visual',
      'update_visual',
      'read_file',
    ]);
    expect(await toolNames([])).toEqual([
      'list_entities',
      'describe_entity',
      'run_readonly_sql',
      'read_file',
    ]);
  });

  it('lists only the offered tools and the matching rules in the prompt', async () => {
    const text = await prompt(['sample_rows']);
    const tools = text.slice(
      text.indexOf('## Tools'),
      text.indexOf('## Working rules'),
    );

    expect(tools).toContain('\n- sample_rows(');
    expect(tools).not.toMatch(/ask_clarification|create_visual|update_visual/);
    expect(tools).toContain('\n- read_file(path)');
    expect(text).toContain(
      "## Working rules\nYou can't ask the user a question back in this session.",
    );
    expect(text).toContain(
      "- You can't create or change visuals in this session.",
    );
    expect(text).toContain('<available_skills>');
  });

  it('builds each selection once', () => {
    expect(assistantVariant(['sample_rows'])).toBe(
      assistantVariant(['sample_rows']),
    );
    expect(assistantVariant()).not.toBe(assistantVariant([]));
  });
});
