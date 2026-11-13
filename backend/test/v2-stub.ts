/**
 * Questions to Insights v2's two tool-less steps (agents.md 5.11) on the
 * shared stub model: the stub recognises Plan and Write answer by their
 * instructions' first lines (`frontend/e2e/helpers/v2-steps.ts`) and answers
 * them with `stub.plan` / `stub.answer`, never with `stub.reply`. These
 * helpers script both for a backend spec, and tell a recorded request's step.
 */
import {
  messageText,
  STUB_ANSWER,
  type LlmStub,
  type StubReply,
  type StubRequest,
} from '../../frontend/e2e/helpers/llm-stub';
import {
  answerFrom,
  v2StepOf,
  type V2Plan,
} from '../../frontend/e2e/helpers/v2-steps';
import {
  PLAN_FIRST_LINE,
  WRITE_ANSWER_FIRST_LINE,
} from '../src/mastra/workflows/qti-v2-turn.prompts';

export { PLAN_FIRST_LINE, WRITE_ANSWER_FIRST_LINE };

type Recorded = Pick<StubRequest, 'messages'>;

/** The v2 step a request (or a recorded copy of it) belongs to, if any. */
function stepOf(req: Recorded) {
  return v2StepOf(
    req.messages
      .filter((message) => message.role === 'system')
      .map(messageText),
  );
}

/** Whether a request is v2's Plan step's. */
export const isPlanRequest = (req: Recorded) => stepOf(req) === 'plan';

/** Whether a request is v2's Write answer step's. */
export const isWriteAnswerRequest = (req: Recorded) => stepOf(req) === 'answer';

/** Whether a request is v2's Analyse step's (the agent with its tools). */
export const isAnalyseRequest = (req: Recorded) => {
  const system = req.messages.find((message) => message.role === 'system');
  return (
    !!system && messageText(system).startsWith('You are Questions to Insights')
  );
};

/** A plan that analyses the question as asked. */
export function stubPlan(
  question = 'The question.',
  overrides: Partial<V2Plan> = {},
): V2Plan {
  return {
    question,
    measures: [],
    entities: [],
    scope: 'Everything in the data.',
    assumptions: [],
    needsClarification: false,
    clarification: null,
    ...overrides,
  };
}

/** What Plan and Write answer return, when a spec sets them. */
export interface V2StepReplies {
  /** The plan for a Plan request; the default plans the question as asked. */
  plan?: (req: StubRequest) => V2Plan;
  /** The answer's Markdown; the default is `STUB_ANSWER`. */
  answer?: (req: StubRequest) => string;
}

/**
 * Script a spec's stub: `reply` answers every other call (Analyse, a node
 * chat), Plan returns `steps.plan` (a clear plan by default) and Write
 * answer `steps.answer` (`STUB_ANSWER` by default, whatever Analyse said).
 */
export function useV2Steps(
  stub: LlmStub,
  reply: (req: StubRequest) => StubReply,
  steps: V2StepReplies = {},
): void {
  stub.reply = reply;
  stub.plan = (req) => steps.plan?.(req) ?? stubPlan();
  stub.answer = (req) => answerFrom(steps.answer?.(req) ?? STUB_ANSWER);
}
