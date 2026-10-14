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
import { AGENT_SKILLS_CONTEXT_KEY, type AgentSkill } from '../agent-skills';
import { setSkillOverrides } from '../skill-overrides';
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

describe("an agent's in-app skills in the catalog (ADR-0021, agents.md 7.3)", () => {
  const fiscal: AgentSkill = {
    id: 's1',
    name: 'fiscal-calendar',
    description: 'Use when a question names a fiscal year.',
    body: 'Our fiscal year starts on 1 July.',
    files: [],
  };
  const aaa: AgentSkill = { ...fiscal, id: 's2', name: 'aaa-first' };

  async function promptWith(
    skills?: AgentSkill[],
    tools?: string[],
  ): Promise<string> {
    const requestContext = contextWith(tools);
    if (skills) requestContext.set(AGENT_SKILLS_CONTEXT_KEY, skills);
    return (await assistantAgent.getInstructions({ requestContext })) as string;
  }

  it('is byte-identical to today without skills, even with an empty list', async () => {
    expect(portable(await promptWith(undefined))).toBe(GOLDEN);
    expect(portable(await promptWith([]))).toBe(GOLDEN);
  });

  it('lists the agent skills with their virtual location, sorted with the built-in ones', async () => {
    const text = await promptWith([fiscal, aaa]);
    const names = [...text.matchAll(/<name>(.+?)<\/name>/g)].map((m) => m[1]);
    expect(names).toEqual([
      'aaa-first',
      'curated-knowledge',
      'fiscal-calendar',
    ]);
    expect(text).toContain(
      '    <name>fiscal-calendar</name>\n    <description>Use when a question names a fiscal year.</description>\n    <location>/in-app-skills/fiscal-calendar/SKILL.md</location>',
    );
    // Only the Skills section changes.
    const before = (await promptWith(undefined)).split('## Skills')[0];
    expect(text.split('## Skills')[0]).toBe(before);
  });

  it('keeps the tools, and the selection wording, with skills', async () => {
    expect(
      Object.keys(
        await assistantAgent.listTools({
          requestContext: (() => {
            const context = contextWith(['sample_rows']);
            context.set(AGENT_SKILLS_CONTEXT_KEY, [fiscal]);
            return context;
          })(),
        }),
      ),
    ).toEqual(await toolNames(['sample_rows']));
    expect(await promptWith([fiscal], ['sample_rows'])).toContain(
      "- You can't create or change visuals in this session.",
    );
  });

  it('does not cache the skills case, and keeps the base variants cached', () => {
    expect(assistantVariant(undefined, [fiscal])).not.toBe(
      assistantVariant(undefined, [fiscal]),
    );
    expect(assistantVariant(undefined, [fiscal]).tools).toBe(
      assistantVariant().tools,
    );
    expect(assistantVariant(undefined, [])).toBe(assistantVariant());
  });
});

describe('assistant prompt with an in-app override of a built-in skill (ADR-0022)', () => {
  afterEach(() => setSkillOverrides([]));

  it('rebuilds the cached variants when an override changes, and restores the golden prompt on reset', async () => {
    const cached = assistantVariant();
    setSkillOverrides([
      {
        name: 'curated-knowledge',
        description: 'Use when the edited description applies.',
        body: 'Edited body.',
        files: [],
        baseHash: 'h',
      },
    ]);
    const changed = assistantVariant();
    expect(changed).not.toBe(cached);
    expect(changed.instructions).toContain(
      'Use when the edited description applies.',
    );
    expect(await prompt()).toContain(
      'Use when the edited description applies.',
    );
    // The same version is cached again.
    expect(assistantVariant()).toBe(changed);

    setSkillOverrides([]);
    expect(portable(await prompt())).toBe(GOLDEN);
    expect(Object.keys(await assistantAgent.listTools())).toEqual(FULL_TOOLS);
  });
});
