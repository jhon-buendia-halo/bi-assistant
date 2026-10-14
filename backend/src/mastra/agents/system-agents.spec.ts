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
import { evalJudgeAgent } from './eval-judge.agent';
import { knowledgeBootstrapAgent } from './knowledge-bootstrap.agent';
import { sqlFixerAgent } from './sql-fixer.agent';
import { sqlVerifierAgent } from './sql-verifier.agent';
import { visualizationAgent } from './visualization.agent';

/**
 * Each fixture is the agent's instructions as they were before ADR-0025
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
  'System agent %s (ADR-0025)',
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
