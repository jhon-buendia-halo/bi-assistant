// The real Agent pulls in ESM-only packages Jest cannot require. This
// stand-in keeps the config and resolves `instructions`, `skills` and
// `tools` the way @mastra/core 1.66's Agent does.
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
      constructor(readonly config: Record<string, unknown>) {}
      getInstructions({ requestContext = new Context() } = {}) {
        return resolve(this.config['instructions'], requestContext);
      }
      resolveSkills({ requestContext = new Context() } = {}) {
        return Promise.resolve(resolve(this.config['skills'], requestContext));
      }
      listTools({ requestContext = new Context() } = {}) {
        return Promise.resolve(resolve(this.config['tools'], requestContext));
      }
    },
  };
});

import type { InlineSkill } from '@mastra/core/skills';
import { builtinAgentClasses } from '../agent-factory';
import { parseLinks } from '../agent-links';
import { setAgentPromptOverrides } from '../agent-prompt-overrides';
import { AGENT_SKILLS, catalogSkills, skillReferences } from '../app-skills';
import { shippedAgentPrompt } from '../shipped-agent-prompts';
import { SOLO_REPAIR_HEADER } from '../../modules/sessions/turn/solo-turn';
import { assessReadinessTool } from '../tools/readiness.tools';
import {
  DATA_READINESS_ASSESSOR_AGENT_KEY,
  dataReadinessAssessorAgent,
  dataReadinessAssessorInstructions,
  dataReadinessAssessorTools,
} from './data-readiness-assessor.agent';
import { DATA_READINESS_ASSESSOR_TOOL_NAMES } from './data-readiness-assessor-catalog';
import {
  DATA_READINESS_ASSESSOR_INSTRUCTIONS,
  DATA_READINESS_ASSESSOR_REPAIR_RULE,
} from './data-readiness-assessor.prompts';

const SKILLS = [
  'readiness-scoping',
  'readiness-source-inventory',
  'readiness-quality-profiling',
  'readiness-freshness-reliability',
  'readiness-semantics-documentation',
  'readiness-governance-privacy',
  'readiness-ai-fitness',
  'readiness-scoring',
  'readiness-gap-remediation',
  'readiness-reporting',
];

type Built = {
  config: Record<string, unknown>;
  getInstructions(): string;
  resolveSkills(): Promise<InlineSkill[]>;
  listTools(): Promise<Record<string, unknown>>;
};
const agent = dataReadinessAssessorAgent as unknown as Built;

afterEach(() => setAgentPromptOverrides([]));

describe('Dana, the Data Readiness Assessor (plan data-readiness-assessor 2)', () => {
  it('is a person and data agent on the step model, with no memory', () => {
    expect(builtinAgentClasses()[DATA_READINESS_ASSESSOR_AGENT_KEY]).toEqual([
      'person',
      'data',
    ]);
    expect(agent.config['id']).toBe('data-readiness-assessor');
    expect(agent.config['name']).toBe('Data Readiness Assessor');
    expect(agent.config).not.toHaveProperty('memory');
    expect(typeof agent.config['model']).toBe('function');
  });

  it('has the data kit, ask_clarification and assess_readiness, in catalogue order, and no deliverable tool', async () => {
    const tools = await agent.listTools();
    expect(Object.keys(tools)).toEqual([...DATA_READINESS_ASSESSOR_TOOL_NAMES]);
    expect(tools['assess_readiness']).toBe(assessReadinessTool);
    expect(tools).not.toHaveProperty('submit_dashboard');
    expect(tools).not.toHaveProperty('export_conversation');
  });

  it('offers her ten skills on demand', async () => {
    expect(AGENT_SKILLS[DATA_READINESS_ASSESSOR_AGENT_KEY]).toEqual(SKILLS);
    const skills = await agent.resolveSkills();
    // The catalogue serves them by name.
    expect(skills.map((skill) => skill.name)).toEqual([...SKILLS].sort());
  });

  it('ships the rubric and the report template as references, each link to a tool she has', () => {
    const skills = catalogSkills(DATA_READINESS_ASSESSOR_AGENT_KEY);
    const scoring = skills.find((s) => s.name === 'readiness-scoring')!;
    const reporting = skills.find((s) => s.name === 'readiness-reporting')!;
    expect(Object.keys(skillReferences(scoring))).toEqual([
      'reference/rubric.md',
    ]);
    expect(Object.keys(skillReferences(reporting))).toEqual([
      'reference/report-template.md',
    ]);
    for (const skill of skills) {
      expect(skill.description.startsWith('Use when')).toBe(true);
      for (const tool of parseLinks(skill.document).tools) {
        expect(DATA_READINESS_ASSESSOR_TOOL_NAMES).toContain(tool);
      }
    }
  });

  it('links only her own skills and tools in her prompt', () => {
    const links = parseLinks(DATA_READINESS_ASSESSOR_INSTRUCTIONS);
    expect(new Set(links.skills)).toEqual(new Set(SKILLS));
    for (const tool of links.tools) {
      expect(DATA_READINESS_ASSESSOR_TOOL_NAMES).toContain(tool);
    }
    expect(shippedAgentPrompt(DATA_READINESS_ASSESSOR_AGENT_KEY)).toBe(
      DATA_READINESS_ASSESSOR_INSTRUCTIONS,
    );
  });

  it('serves her prompt with the tools before the working rules and the repair rule last', () => {
    const served = agent.getInstructions();
    expect(served).toBe(dataReadinessAssessorInstructions());
    expect(
      served.startsWith('You are Dana, the Data Readiness Assessor.'),
    ).toBe(true);
    const tools = served.indexOf('## Tools');
    expect(tools).toBeGreaterThan(0);
    expect(tools).toBeLessThan(served.indexOf('## Working rules'));
    for (const name of Object.keys(dataReadinessAssessorTools)) {
      expect(served.slice(tools)).toContain(name);
    }
    expect(served).not.toContain('[[');
    expect(served.trimEnd().endsWith(DATA_READINESS_ASSESSOR_REPAIR_RULE)).toBe(
      true,
    );
    expect(DATA_READINESS_ASSESSOR_REPAIR_RULE).toContain(SOLO_REPAIR_HEADER);
  });

  it('says she quotes the verdict and never computes it, and answers in the requester language', () => {
    const served = agent.getInstructions();
    expect(served).toContain(
      'You never compute, round or change the verdict, a level, a gate or the weighted score.',
    );
    expect(served).toContain('even when the requester pushes back');
    expect(served).toContain("Answer in the requester's language.");
  });

  it('serves her in-app override', () => {
    setAgentPromptOverrides([
      {
        key: DATA_READINESS_ASSESSOR_AGENT_KEY,
        prompt: 'You are Dana.\n\n## Working rules\n- Be brief.',
        baseHash: 'x',
      },
    ]);
    const served = agent.getInstructions();
    expect(served.startsWith('You are Dana.\n')).toBe(true);
    expect(served).toContain('assess_readiness');
    expect(served).not.toContain('Output contract');
  });
});
