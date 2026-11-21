/**
 * Answer a Business Question's interactive runs (agents.md 5.11, workflows
 * R44): the model its step agents run on, the approval gate that holds each
 * agent's outcome until the user approves it for the next agent, and the
 * clarifying question every step agent may ask. Plain data and functions, no
 * framework import (the session code and the tests read it without Mastra).
 *
 * Only a run of the workflow is interactive (its runtime's `interactive`):
 * a past chat's turn and an eval run are not, so their steps, requests and
 * replies are exactly what they were.
 */
import type { StepModel } from '../step-model';

/**
 * The model and reasoning effort Answer a Business Question's step agents
 * run on (agents.md 1.3), when the saved model is served as a Claude model
 * (`servesClaude`); otherwise the saved model and effort, as every agent.
 */
export const ANSWER_BUSINESS_QUESTION_MODEL: StepModel = {
  model: 'claude-opus-5-5',
  reasoningEffort: 'medium',
};

/** The option that approves an outcome on the approval gate. */
export const APPROVE_OPTION = 'Approve';

/** Whether the user's answer on an approval gate approves the outcome. */
export function isApproval(answer: string): boolean {
  return /^(approve|approved|ok|okay|yes|lgtm|aprobar|aprobado|s[ií])\.?$/i.test(
    answer.trim(),
  );
}

/** What a gated step suspends with (the run's `waitingFor`, api.md 138). */
export interface ReviewSuspension {
  kind: 'review';
  question: string;
  options: string[];
  /** The outcome in the user's words (Markdown), shown on the card. */
  review: string;
  /** The step's output, passed on unchanged once the user approves it. */
  outcome: Record<string, unknown>;
  /** The agent's reply, which a revision shows the agent again. */
  reply: string;
}

/** What a step suspends with when its agent asks the user first. */
export interface ClarifySuspension {
  kind: 'clarify';
  question: string;
  options: string[];
}

/** The question of an approval gate: whose outcome, and who gets it next. */
export function reviewQuestion(
  agent: string,
  what: string,
  next: string,
): string {
  return `${agent}'s ${what} is ready. Approve it to hand it to ${next}, or write what to change.`;
}

/**
 * The question of Ryan's approval gate (Build visual, the last agent): the
 * run ends once the visual is approved.
 */
export const VISUAL_REVIEW_QUESTION =
  "Ryan's visual is ready. Approve it to finish the run, or write what to change (a filter, another chart, a detail) and attach reference images if you want.";

/** Ryan's instruction when the user attached images and wrote nothing. */
export const VISUAL_IMAGES_INSTRUCTION =
  'Follow the reference images the user attached.';

/** Ryan's visual on his approval gate, and why a change failed, if it did. */
export function visualReview(
  visual: { title?: string; visualId?: string },
  failure?: string,
): string {
  return [
    ...(failure ? [`**The change could not be made:** ${failure}`, ''] : []),
    `**${visual.title?.trim() || 'Interactive visual'}**`,
    '',
    'Open it to check it before you approve it.',
  ].join('\n');
}

/** The gate of a step that suspended, read back on resume; else undefined. */
export function reviewOf(suspendData: unknown): ReviewSuspension | undefined {
  const data = suspendData as Partial<ReviewSuspension> | undefined;
  if (data?.kind !== 'review' || typeof data.question !== 'string') {
    return undefined;
  }
  if (!data.outcome || typeof data.outcome !== 'object') return undefined;
  return {
    kind: 'review',
    question: data.question,
    options: Array.isArray(data.options) ? data.options : [APPROVE_OPTION],
    review: typeof data.review === 'string' ? data.review : '',
    outcome: data.outcome,
    reply: typeof data.reply === 'string' ? data.reply : '',
  };
}

/** The clarifying question of a step that suspended; else undefined. */
export function askedOf(suspendData: unknown): ClarifySuspension | undefined {
  const data = suspendData as Partial<ClarifySuspension> | undefined;
  if (data?.kind !== 'clarify' || typeof data.question !== 'string') {
    return undefined;
  }
  return {
    kind: 'clarify',
    question: data.question,
    options: Array.isArray(data.options) ? data.options : [],
  };
}

/** A revision the user asked for on an approval gate. */
export interface Revision {
  /** The agent's earlier reply. */
  previous: string;
  /** What the user asked to change. */
  note: string;
}

/**
 * What ends a step agent's request after the user asked for changes on its
 * approval gate: its earlier reply and the user's words.
 */
export function revisionBlock(revision: Revision): string {
  return [
    'The user reviewed your earlier reply before it went on to the next step and asked for changes.',
    'Your earlier reply:',
    revision.previous,
    '',
    `What the user asked: ${revision.note}`,
    'Reply again in full, in the same format, with those changes.',
  ].join('\n');
}

/**
 * What ends a step agent's request in an interactive run (Read images,
 * Interpret follow-up, Write answer): it may ask the user one question
 * first, only when it cannot do its job well without the answer.
 */
export const CLARIFY_BLOCK = [
  'You may ask the user one clarifying question before you reply, only when you cannot do your job well without the answer (an ambiguity that changes your reply, never a detail you can decide yourself).',
  'To ask, reply with only this JSON object and nothing else: {"clarification": {"question": "<one short question>", "options": ["<2 to 4 short answers>"]}}.',
  'Otherwise reply as usual, with no clarification field.',
].join('\n');

/** What ends the request once the user answered the agent's question. */
export function answeredBlock(answered: {
  question: string;
  answer: string;
}): string {
  return [
    `You asked the user: ${answered.question}`,
    `They answered: ${answered.answer}`,
    'Do not ask again. Reply as usual, using their answer.',
  ].join('\n');
}

/**
 * The extra lines a step agent's request ends with in an interactive run:
 * the clarify rule until it asked, its answered question, and a revision.
 */
export function interactiveBlocks(input: {
  canAsk?: boolean;
  answered?: { question: string; answer: string };
  revision?: Revision;
}): string[] {
  return [
    ...(input.canAsk && !input.answered ? [CLARIFY_BLOCK] : []),
    ...(input.answered ? [answeredBlock(input.answered)] : []),
    ...(input.revision ? [revisionBlock(input.revision)] : []),
  ];
}

/** What an interactive step's execute receives of the engine's params. */
export interface InteractiveParams {
  resumeData?: unknown;
  suspendData?: unknown;
  suspend: (payload: Record<string, unknown>) => unknown;
}

/** What a step agent's call gives back to `interactiveStep`. */
export interface InteractiveResult<O> {
  /** The step's output. */
  output: O;
  /** The agent's reply, which a revision shows it again. */
  reply: string;
  /** The agent asked the user first (only when it was allowed to). */
  clarification?: { question: string; options: string[] };
  /** The turn was stopped: nothing waits. */
  stopped?: boolean;
}

/** How an interactive step ended: its output, or the engine's suspend. */
export type InteractiveOutcome<O> =
  | { type: 'output'; output: O; approved: boolean }
  | { type: 'suspended'; value: unknown };

/**
 * One step agent's turn in a run of Answer a Business Question (workflows
 * R44). Not interactive: the call alone, as before. Interactive: the agent
 * may ask the user one question first (the step waits, then calls it again
 * with the answer); once it has an outcome, `gate` says whether that outcome
 * goes on to another agent, and if so the step waits on its approval gate.
 * Resumed there, an approval passes the held outcome on without a new call
 * (`approved`); any other answer is the user's revision, and the agent is
 * called again with its earlier reply and the user's words, then waits on
 * the gate again.
 */
export async function interactiveStep<O>(
  params: InteractiveParams,
  interactive: boolean,
  call: {
    run(input: {
      canAsk: boolean;
      answered?: { question: string; answer: string };
      revision?: Revision;
    }): Promise<InteractiveResult<O>>;
    gate?(output: O): { question: string; review: string } | undefined;
  },
): Promise<InteractiveOutcome<O>> {
  const raw = (params.resumeData as { answer?: unknown } | undefined)?.answer;
  const answer = typeof raw === 'string' ? raw.trim() : '';
  const pending = interactive ? reviewOf(params.suspendData) : undefined;
  if (pending && answer && isApproval(answer)) {
    return { type: 'output', output: pending.outcome as O, approved: true };
  }
  const asked = interactive ? askedOf(params.suspendData) : undefined;
  const result = await call.run({
    canAsk: interactive && !pending && !asked,
    ...(asked && answer
      ? { answered: { question: asked.question, answer } }
      : {}),
    ...(pending && answer
      ? { revision: { previous: pending.reply, note: answer } }
      : {}),
  });
  if (!interactive || result.stopped) {
    return { type: 'output', output: result.output, approved: false };
  }
  if (result.clarification) {
    return {
      type: 'suspended',
      value: await params.suspend({
        kind: 'clarify',
        question: result.clarification.question,
        options: result.clarification.options,
      }),
    };
  }
  const gate = call.gate?.(result.output);
  if (!gate) return { type: 'output', output: result.output, approved: false };
  return {
    type: 'suspended',
    value: await params.suspend({
      kind: 'review',
      question: gate.question,
      options: [APPROVE_OPTION],
      review: gate.review,
      outcome: result.output,
      reply: result.reply,
    }),
  };
}

/** A clarifying question in a step agent's reply, if it asked one. */
export function clarificationIn(
  reply: unknown,
): { question: string; options: string[] } | undefined {
  let value = reply;
  if (typeof value === 'string') {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      value = JSON.parse(value.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
  const asked = (value as { clarification?: unknown } | undefined)
    ?.clarification as { question?: unknown; options?: unknown } | undefined;
  if (!asked || typeof asked.question !== 'string' || !asked.question.trim()) {
    return undefined;
  }
  const options = Array.isArray(asked.options)
    ? asked.options
        .filter((option): option is string => typeof option === 'string')
        .map((option) => option.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  return { question: asked.question.trim(), options };
}
