// The real Agent pulls in ESM-only packages Jest cannot require. This stand-in
// resolves `instructions` the way @mastra/core's Agent does: a function is
// called with the request context, anything else is used as is.
jest.mock('@mastra/core/agent', () => ({
  Agent: class {
    constructor(private readonly config: { instructions: unknown }) {}
    getInstructions() {
      return typeof this.config.instructions === 'function'
        ? (this.config.instructions as () => unknown)()
        : this.config.instructions;
    }
  },
}));
jest.mock('../session-workspaces', () => ({
  SESSION_WORKSPACE_CONTEXT_KEY: 'session-workspace-id',
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import { setAgentPromptOverrides } from '../agent-prompt-overrides';
import { shippedAgentPrompt } from '../shipped-agent-prompts';
import { SYSTEM_AGENT_KEYS } from '../agent-constants';
import { BI_ANALYST_INSTRUCTIONS } from '../workflows/bi-analyst.prompts';
import { BUILTIN_AGENT_PERSONAS } from '../agent-personas';
import { biAnalystAgent } from './bi-analyst.agent';
import {
  BI_ANALYST_MAX_STEPS,
  BI_ANALYST_TOOL_NAMES,
} from './bi-analyst-catalog';
import { evalJudgeAgent } from './eval-judge.agent';
import { knowledgeBootstrapAgent } from './knowledge-bootstrap.agent';
import { sqlFixerAgent } from './sql-fixer.agent';
import { sqlVerifierAgent } from './sql-verifier.agent';
import { visualizationAgent } from './visualization.agent';

/**
 * Each fixture is the agent's instructions as they were before ADR-0026
 * (the static array joined with `\n`), so no override means no change.
 */
const AGENTS = {
  visualization: visualizationAgent,
  'sql-fixer': sqlFixerAgent,
  'sql-verifier': sqlVerifierAgent,
  'knowledge-bootstrap': knowledgeBootstrapAgent,
  'assistant-eval-judge': evalJudgeAgent,
} as const;

const fixture = (key: string) =>
  readFileSync(
    join(__dirname, '__fixtures__', `system-prompt.${key}.txt`),
    'utf8',
  );

const served = (key: keyof typeof AGENTS) =>
  (AGENTS[key] as unknown as { getInstructions(): unknown }).getInstructions();

afterEach(() => setAgentPromptOverrides([]));

describe.each(Object.keys(AGENTS) as (keyof typeof AGENTS)[])(
  'System agent %s (ADR-0026)',
  (key) => {
    it('serves its shipped prompt byte for byte with no override', () => {
      expect(served(key)).toBe(fixture(key));
      expect(shippedAgentPrompt(key)).toBe(fixture(key));
    });

    it("serves an override's text on the next call, and the shipped one after a reset", () => {
      setAgentPromptOverrides([
        { key, prompt: `Edited ${key} prompt.`, baseHash: 'h' },
      ]);
      expect(served(key)).toBe(`Edited ${key} prompt.`);
      setAgentPromptOverrides([]);
      expect(served(key)).toBe(fixture(key));
    });

    it("ignores another agent's override", () => {
      setAgentPromptOverrides([
        { key: 'assistant', prompt: 'Other.', baseHash: 'h' },
      ]);
      expect(served(key)).toBe(fixture(key));
    });
  },
);

describe('System agent bi-analyst (plan bi-dashboard; ADR-0026)', () => {
  const agent = biAnalystAgent as unknown as {
    getInstructions(): unknown;
    config: {
      id: string;
      name: string;
      tools: Record<string, unknown>;
      memory?: unknown;
    };
  };

  it('is Clara, a System agent with her five tools and no memory', () => {
    expect(SYSTEM_AGENT_KEYS).toContain('bi-analyst');
    expect(agent.config).toMatchObject({
      id: 'bi-analyst',
      name: 'Business Intelligence Analyst',
    });
    expect(Object.keys(agent.config.tools)).toEqual([...BI_ANALYST_TOOL_NAMES]);
    expect(agent.config.memory).toBeUndefined();
    expect(BI_ANALYST_MAX_STEPS).toBeLessThanOrEqual(14);
    expect(BUILTIN_AGENT_PERSONAS['bi-analyst']).toMatchObject({
      name: 'Clara',
      role: 'Business Intelligence Analyst',
    });
    // No other persona shares her name or her initial.
    const others = Object.entries(BUILTIN_AGENT_PERSONAS).filter(
      ([key]) => key !== 'bi-analyst',
    );
    expect(others.filter(([, p]) => p.name.startsWith('C'))).toEqual([]);
  });

  it('serves the shipped instructions, or their override', () => {
    expect(shippedAgentPrompt('bi-analyst')).toBe(BI_ANALYST_INSTRUCTIONS);
    expect(agent.getInstructions()).toBe(BI_ANALYST_INSTRUCTIONS);
    setAgentPromptOverrides([
      { key: 'bi-analyst', prompt: 'Edited.', baseHash: 'h' },
    ]);
    expect(agent.getInstructions()).toBe('Edited.');
    setAgentPromptOverrides([]);
    expect(agent.getInstructions()).toBe(BI_ANALYST_INSTRUCTIONS);
  });

  it('tells her to submit one query at the grain, bound, and to keep ids on a change', () => {
    expect(BI_ANALYST_INSTRUCTIONS).toContain('Write ONE data query');
    expect(BI_ANALYST_INSTRUCTIONS).toContain('at most 5000 rows');
    expect(BI_ANALYST_INSTRUCTIONS).toContain('snake_case alias');
    expect(BI_ANALYST_INSTRUCTIONS).toContain('Bind every field');
    expect(BI_ANALYST_INSTRUCTIONS).toContain('fix exactly what it says');
    expect(BI_ANALYST_INSTRUCTIONS).toContain('keep every id');
  });
});
