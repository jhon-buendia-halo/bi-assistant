/**
 * The stub model's answers to the two tool-less steps of Questions to
 * Insights v2 (agents.md 5.11): a request is Plan's or Write answer's by its
 * system prompt's first line (the instructions' fixed first lines), and is
 * answered with a plan or an answer as JSON; any other request (Analyse, a
 * node chat) is left to the spec's own reply.
 */
import {
  messageText,
  STUB_ANSWER,
  type StubReply,
  type StubRequest,
} from '../../frontend/e2e/helpers/llm-stub';
import {
  PLAN_FIRST_LINE,
  WRITE_ANSWER_FIRST_LINE,
} from '../src/mastra/workflows/qti-v2-turn.prompts';

export { PLAN_FIRST_LINE, WRITE_ANSWER_FIRST_LINE };

/** The first line of a request's first system message. */
export function systemFirstLine(req: StubRequest): string {
  const system = req.messages.find((message) => message.role === 'system');
  return system ? messageText(system).split('\n')[0].trim() : '';
}

/** Whether a request is v2's Plan step's. */
export const isPlanRequest = (req: StubRequest) =>
  systemFirstLine(req) === PLAN_FIRST_LINE;

/** Whether a request is v2's Write answer step's. */
export const isWriteAnswerRequest = (req: StubRequest) =>
  systemFirstLine(req) === WRITE_ANSWER_FIRST_LINE;

/** Whether a request is v2's Analyse step's (the agent with its tools). */
export const isAnalyseRequest = (req: StubRequest) =>
  systemFirstLine(req).startsWith('You are Questions to Insights v2');

/** A plan that analyses the question as asked. */
export function stubPlan(question = 'The question.', overrides: object = {}) {
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

/** What the stub's Plan and Write answer reply, when a spec sets them. */
export interface V2StepReplies {
  /** The plan for a Plan request; the default plans the question as asked. */
  plan?: (req: StubRequest) => object;
  /** The answer's Markdown; the default is `STUB_ANSWER`. */
  answer?: (req: StubRequest) => string;
}

/**
 * The spec's reply with v2's Plan and Write answer routed first: a plan or
 * an answer as JSON, by the request's system prompt's first line.
 */
export function withV2Steps(
  reply: (req: StubRequest) => StubReply,
  steps: V2StepReplies = {},
): (req: StubRequest) => StubReply {
  return (req) => {
    if (isPlanRequest(req)) {
      return { text: JSON.stringify(steps.plan?.(req) ?? stubPlan()) };
    }
    if (isWriteAnswerRequest(req)) {
      const answer = steps.answer?.(req) ?? STUB_ANSWER;
      return {
        text: JSON.stringify({ headline: answer.split('\n')[0], answer }),
      };
    }
    return reply(req);
  };
}
