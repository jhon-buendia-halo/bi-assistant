import type { Agent } from '@mastra/core/agent';
import type { RequestContext } from '@mastra/core/request-context';
import type {
  AssistantEvalCase,
  AssistantEvalSet,
  EvalTarget,
} from './assistant.evals';
import { answerResult } from './query-explainer-eval-answer';
import { EVAL_CASE_CONTEXT_KEY, EVAL_DETAILS_KEY } from './eval-details';

/**
 * The isolated-call eval target (agents.md 8.1): each case runs ONE of the
 * app's model functions (`planWithModel`, `writeAnswerWithModel`,
 * `checkDataQualityWithModel`, `readImagesWithModel`, …) over a frozen,
 * hand-built input, so a failure belongs to that one agent and no step
 * before it.
 *
 * The case input convention: a case carries its call's input in its
 * `input` field (`isolatedCase<Input>({ …, input })` types it). The
 * case's `question` is only its label (shown in the report and the Agents
 * screen). `runAssistantEvalCase` puts the case on the requestContext
 * (`EVAL_CASE_CONTEXT_KEY`); the target's `generate` reads it there, maps
 * it with `inputOf` (default: the case's `input` as is), calls `call` once
 * and returns:
 * - `text`, the scored answer: `answerOf(output)` (default: the whole
 *   output) as pretty JSON text, which the custom checks parse;
 * - `evalDetails.output`: the call's whole output, for the checks
 *   (`details.output`);
 * - no tool call.
 * A call that throws fails the case with its error (`result.error`).
 *
 * Framework-free: the agent and the call are handed in, so Jest loads it.
 */

/** What the call gets besides its input: the case's context. */
export interface IsolatedCallOptions {
  requestContext?: RequestContext;
  providerOptions?: Record<string, unknown>;
}

export interface IsolatedCallSpec<I, O> {
  /** Registry key of the agent whose call it is (the Agents screen's page). */
  agentKey: string;
  /** The sets that run on this target. */
  sets: AssistantEvalSet[];
  /** The agent itself (`runEvals` reads its model), loaded on first use. */
  loadAgent: () => Agent;
  /** The model function: one call per case. */
  call: (input: I, options: IsolatedCallOptions) => Promise<O>;
  /** The call's input from the case; default `caseInputOf`. */
  inputOf?: (evalCase: AssistantEvalCase) => I | Promise<I>;
  /** What of the output is scored, as JSON text; default the whole output. */
  answerOf?: (output: O) => unknown;
}

/** A case with a typed frozen input (the input convention above). */
export function isolatedCase<I>(
  evalCase: Omit<AssistantEvalCase, 'input'> & { input: I },
): AssistantEvalCase {
  return evalCase;
}

/** The case's frozen `input`; throws when the case has none. */
export function caseInputOf<I>(evalCase: AssistantEvalCase): I {
  if (evalCase.input === undefined) {
    throw new Error(`Eval case "${evalCase.id}" has no input`);
  }
  return evalCase.input as I;
}

/** The scored answer of an output: pretty JSON text. */
export function isolatedCallAnswer(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

type GenerateOptions = {
  requestContext?: { get(key: string): unknown };
  providerOptions?: Record<string, unknown>;
};

/** The agent, its `generate` replaced by one call over the case's input. */
export function isolatedCallAgent<I, O>(
  agent: Agent,
  spec: Pick<IsolatedCallSpec<I, O>, 'call' | 'inputOf' | 'answerOf'>,
): Agent {
  const generate = async (input: unknown, options: GenerateOptions = {}) => {
    const evalCase = options.requestContext?.get(EVAL_CASE_CONTEXT_KEY) as
      AssistantEvalCase | undefined;
    if (!evalCase) {
      throw new Error('An isolated-call case runs with its case');
    }
    const callInput = await (spec.inputOf ?? caseInputOf<I>)(evalCase);
    const output = await spec.call(callInput, {
      requestContext: options.requestContext as RequestContext | undefined,
      ...(options.providerOptions
        ? { providerOptions: options.providerOptions }
        : {}),
    });
    const scored = spec.answerOf ? spec.answerOf(output) : output;
    return {
      ...answerResult(input, isolatedCallAnswer(scored)),
      [EVAL_DETAILS_KEY]: { output },
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

/**
 * The eval target of an isolated call: no orientation, no knowledge block,
 * no session binding; `runTarget` is the agent with `generate` replaced
 * (`isolatedCallAgent`). The agent is loaded on first use.
 */
export function isolatedCallTarget<I, O>(
  spec: IsolatedCallSpec<I, O>,
): EvalTarget {
  let agent: Agent | undefined;
  let run: Agent | undefined;
  return {
    agentKey: spec.agentKey,
    get agent(): Agent {
      agent ??= spec.loadAgent();
      return agent;
    },
    get runTarget(): Agent {
      run ??= isolatedCallAgent((agent ??= spec.loadAgent()), spec);
      return run;
    },
    sets: spec.sets,
    sendsKnowledge: false,
    orientation: () => '',
  };
}
