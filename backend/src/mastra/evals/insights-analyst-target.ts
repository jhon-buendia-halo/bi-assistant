import type { Agent } from '@mastra/core/agent';
import {
  loadCatalog,
  planCatalogBlock,
  type ClarifyingQuestion,
} from '../workflows/analysis.steps';
import { analyseSystemBlocks } from '../workflows/analysis.prompts';
import { michaelAloneRequest } from '../workflows/orchestrated-answer-michael.prompts';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import { parseClarification } from '../tools/clarification.tool';
import { EVAL_DETAILS_KEY, type EvalRunDetails } from './eval-details';

/**
 * The `insights-analyst` eval target's turn (agents.md 8.1): every case runs
 * Michael as Answer a Business Question (Avery + Michael) runs him when
 * Avery calls `answer_from_data` (5.23), not the agent alone. `runEvals`
 * calls the agent's `generate`; this target is the agent with `generate`
 * replaced by that one call:
 * - the case's options (its orientation, knowledge, step budget and scorer
 *   data) plus the turn engine's blocks: the catalog with its columns, then
 *   Michael's request on his own (`michaelAloneRequest`), the case's
 *   question as Avery's brief;
 * - one attempt: Avery's second call (her brief of what to fix) is hers, so
 *   no case retries;
 * - the scored answer is his reply, the answer the user reads; when he asks
 *   a clarifying question (`ask_clarification`), the question with its
 *   options, one per line (`- <option>`).
 */

/** What the target runs on; tests stand in for the catalog read. */
export interface MichaelTargetParts {
  loadCatalog: typeof loadCatalog;
}

/** The text of the last user message of an agent input. */
export function lastUserText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (!Array.isArray(input)) return '';
  for (const message of [...(input as unknown[])].reverse()) {
    const entry = message as { role?: unknown; content?: unknown };
    if (entry?.role !== 'user') continue;
    if (typeof entry.content === 'string') return entry.content;
    if (Array.isArray(entry.content)) {
      return entry.content
        .map((part) =>
          typeof (part as { text?: unknown })?.text === 'string'
            ? (part as { text: string }).text
            : '',
        )
        .join('');
    }
  }
  return '';
}

/** A clarifying question as the scored answer: the question, then each option. */
export function clarificationAnswer(asked: ClarifyingQuestion): string {
  return [asked.question, ...asked.options.map((option) => `- ${option}`)].join(
    '\n',
  );
}

/** The first valid `ask_clarification` call of an agent result's steps. */
function askedInResult(result: unknown): ClarifyingQuestion | undefined {
  const steps = (result as { steps?: unknown })?.steps;
  for (const step of Array.isArray(steps) ? steps : [result]) {
    const calls = (step as { toolCalls?: unknown })?.toolCalls;
    for (const call of Array.isArray(calls) ? calls : []) {
      const payload = ((call as { payload?: unknown })?.payload ?? call) as {
        toolName?: string;
        args?: unknown;
      };
      if (payload.toolName !== 'ask_clarification') continue;
      const asked = parseClarification(payload.args);
      if (!asked) continue;
      return {
        question: asked.question,
        options: asked.options.map((option) =>
          option.description
            ? `${option.label} — ${option.description}`
            : option.label,
        ),
      };
    }
  }
  return undefined;
}

type GenerateOptions = {
  context?: { role: 'system'; content: string }[];
  requestContext?: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  [key: string]: unknown;
};

/**
 * The agent, its `generate` running Michael as `answer_from_data` runs him
 * (above). Every other member is the agent's own.
 */
export function michaelTurnAgent(
  agent: Agent,
  parts: MichaelTargetParts = { loadCatalog },
): Agent {
  const generate = async (input: unknown, options: GenerateOptions = {}) => {
    const requestContext = options.requestContext;
    if (!requestContext) throw new Error('An eval case runs with a context');
    const given = requestContext.get(DATASETS_CONTEXT_KEY);
    const datasets = Array.isArray(given) ? (given as string[]) : [];
    const question = lastUserText(input).trim();
    // The catalog block the turn engine builds for him (agents.md 5.11).
    const { catalog, columns } = await parts.loadCatalog(datasets);
    const catalogBlock = planCatalogBlock(catalog, columns, { question });
    const result = (await agent.generate(
      input as never,
      {
        ...options,
        context: [
          ...(options.context ?? []),
          ...analyseSystemBlocks({
            catalogBlock,
            planBlock: michaelAloneRequest(question),
          }).map((content) => ({ role: 'system' as const, content })),
        ],
      } as never,
    )) as Record<string, unknown>;
    const asked = askedInResult(result);
    const text = typeof result['text'] === 'string' ? result['text'] : '';
    return {
      ...result,
      text: asked ? clarificationAnswer(asked) : text,
      // The judge sees the catalogue he worked from (agents.md 8.1).
      [EVAL_DETAILS_KEY]: {
        judgeContext: catalogBlock,
      } satisfies EvalRunDetails,
    };
  };
  return new Proxy(agent, {
    get(target, property): unknown {
      if (property === 'generate') return generate;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
