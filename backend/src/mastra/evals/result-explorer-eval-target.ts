import type { Agent } from '@mastra/core/agent';
import type { ResultView } from '../../modules/datasources/connectors/paged-sql.types';
import type {
  ExplorerCandidate,
  ExplorerSpec,
} from '../agents/result-explorer.prompts';
import { pageCountOf } from '../agents/result-explorer.prompts';
import { explorerAnswerText } from './result-explorer-eval-checks';
import { answerResult } from './query-explainer-eval-answer';
import { lastUserText } from './insights-analyst-workflow-target';

/**
 * The `result-explorer` eval target's turn (agents.md 8.1, 2.16): a case is
 * the user's words with the candidates and the current view they are said
 * about. A run does what the app does for the query inspector's filter in
 * words: `explorerRequest` over those, one structured model call, `specOf`
 * over the reply (`interpretResultWithModel`). The scored answer is the
 * resulting spec as JSON text (`explorerAnswerText`).
 */

/** What the explorer reads for one case (`InterpretResultInput`). */
export interface ExplorerEvalInput {
  text: string;
  candidates: ExplorerCandidate[];
  view: ResultView | null;
  pageCount: number | null;
}

/** The model call: `interpretResultWithModel`, or a stand-in. */
export type InterpretResult = (
  input: ExplorerEvalInput,
) => Promise<ExplorerSpec>;

/** The input of a case, from its words (the case's question). */
export function explorerInputOf(
  text: string,
  candidates: ExplorerCandidate[],
  view: ResultView | null,
): ExplorerEvalInput {
  return { text, candidates, view, pageCount: pageCountOf(view) };
}

/**
 * The explorer agent, its `generate` replaced by one interpretation of the
 * case the words belong to. A question no case holds fails the run. Every
 * other member is the agent's own.
 */
export function explorerTurnAgent(
  agent: Agent,
  interpret: InterpretResult,
  inputOf: (words: string) => ExplorerEvalInput | undefined,
): Agent {
  const generate = async (input: unknown) => {
    const words = lastUserText(input).trim();
    const caseInput = inputOf(words);
    if (!caseInput) {
      throw new Error(`No result-explorer case says: ${words}`);
    }
    const spec = await interpret(caseInput);
    return answerResult(input, explorerAnswerText(spec));
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
