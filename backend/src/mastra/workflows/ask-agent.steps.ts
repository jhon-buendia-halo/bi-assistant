/**
 * Ask one agent (workflows R40; agents.md 5.21): a follow-up run of Answer
 * a Business Question that runs the agent of one of its steps alone, over
 * the earlier run, instead of the whole workflow. The engine (`ask-agent`,
 * `ask-agent.workflow.ts`) is not a catalogue workflow: the run stays a run
 * of `answer-business-question`, and the step the engine reports carries
 * the asked step's id, so the run shows that one step `Done` and every
 * other `Skipped`. Plain data and pure code, no framework import.
 */
import type { PageRequest } from '../../modules/datasources/connectors/paged-sql.types';
import type { ExplorableQuery } from '../../modules/sessions/query-evidence/explorable-queries';
import type { ExplorerSpec } from '../agents/result-explorer.prompts';
import type {
  AnalyseQuery,
  AnalysisPlan,
  BuiltVisual,
  BusinessAnswer,
  CatalogEntity,
  FollowUpRequest,
  PagedFollowUp,
  TurnCallsOutcome,
  ValidationFinding,
} from './answer-business-question.steps';
import type { ReadImagesOutcome } from './read-images.steps';

/** The engine every single-agent follow-up runs on. */
export const ASK_AGENT_WORKFLOW_ID = 'ask-agent';

/** The run's RequestContext key holding the per-run `AskAgentRuntime`. */
export const ASK_AGENT_RUNTIME_KEY = 'ask-agent-runtime';

/**
 * The steps of Answer a Business Question whose agent can be asked alone,
 * in the workflow's order. Each is also the id of the engine's step for it.
 */
export const ASKABLE_STEP_IDS = [
  'read-images',
  'interpret-follow-up',
  'plan',
  'analyse',
  'write-answer',
  'build-visual',
] as const;

export type AskableStepId = (typeof ASKABLE_STEP_IDS)[number];

/** Whether a step id names a step whose agent can be asked alone. */
export function isAskableStep(id: unknown): id is AskableStepId {
  return (
    typeof id === 'string' &&
    (ASKABLE_STEP_IDS as readonly string[]).includes(id)
  );
}

/** The steps whose agent answers alone with its own tools (an agent turn). */
export const AGENT_TURN_ASK_STEPS: readonly AskableStepId[] = ['analyse'];

/** What the engine runs on: the follow-up's question and the asked step. */
export interface AskAgentInput {
  question: string;
  datasets: string[];
  askStep: AskableStepId;
  /** The earlier run's reference images (their stored paths), if any. */
  images?: string[];
}

/** What every branch of the engine ends with. */
export interface AskAgentOutcome {
  /** The step that answered. */
  step: AskableStepId;
  /** The answer's length, 0 when the turn was stopped before one. */
  answerLength: number;
  stopped: boolean;
  /** Build visual only: the visual Ryan built, or why there is none. */
  visual?: BuiltVisual;
}

/**
 * Write answer's inputs taken from the earlier run (agents.md 5.21): its
 * plan, its answer's queries with their rows, the checks of that attempt
 * and Zoe's notes. Read once; the earlier answer's records are carried
 * into this run's answer, so its sources open in the query inspector.
 */
export interface EarlierAnswerInput {
  plan: AnalysisPlan;
  queries: AnalyseQuery[];
  findings: ValidationFinding[];
  imageNotes: string;
}

/**
 * Build visual's inputs taken from the earlier run (agents.md 5.21): its
 * question, its answer and that answer's queries with their rows. Read
 * once; the earlier answer's records are carried into this run's answer,
 * so its sources open in the query inspector and Ryan charts their rows.
 */
export interface EarlierVisualInput {
  question: string;
  answer: string;
  queries: AnalyseQuery[];
}

/**
 * What the session code hands the engine on the RequestContext
 * (`ASK_AGENT_RUNTIME_KEY`). Every model call is the same call the
 * workflow's own step makes, recorded in the agent's thread of the run.
 */
export interface AskAgentRuntime {
  /** Analyse or Check data quality: the bound agent alone, with its tools. */
  answer(): Promise<TurnCallsOutcome>;
  /** Read images: Zoe's one call over the run's images. */
  readImages(input: {
    question: string;
    images: string[];
  }): Promise<ReadImagesOutcome>;
  /** The earlier answer's queries, for Nathan. */
  followUp: readonly ExplorableQuery[];
  /** Interpret follow-up's model call (result-explorer). */
  interpretFollowUp(
    input: FollowUpRequest,
  ): Promise<{ spec: ExplorerSpec | null; stopped: boolean }>;
  /** Page result: the page, recorded as an `explore_result` call. */
  pageResult(input: {
    query: number;
    request: PageRequest;
    understood: string;
  }): Promise<PagedFollowUp>;
  /** Plan's model call, over the catalog block. */
  plan(input: {
    question: string;
    catalog: CatalogEntity[];
    catalogBlock: string;
    imageNotes?: string;
  }): Promise<{ plan: AnalysisPlan; stopped: boolean }>;
  /** Write answer's inputs from the earlier run (carries its records). */
  earlierAnswer(): EarlierAnswerInput;
  /** Write answer's model call; its text streams as the answer. */
  writeAnswer(input: {
    question: string;
    plan: AnalysisPlan;
    queries: AnalyseQuery[];
    findings: ValidationFinding[];
    imageNotes?: string;
  }): Promise<{ answer: BusinessAnswer; stopped: boolean }>;
  /** Build visual's inputs from the earlier run (carries its records). */
  earlierVisual(): EarlierVisualInput;
  /**
   * Build visual's designer call: Ryan designs a new visual (v1) of the
   * earlier answer, following `instruction`; it is stored with the run. A
   * design that fails comes back as `error`, never as a throw.
   */
  buildVisual(input: {
    question: string;
    answer: string;
    instruction: string;
  }): Promise<{ visual: BuiltVisual; stopped: boolean }>;
  /** A code-written answer: the run's answer text. */
  deliverAnswer(answer: string): Promise<void>;
}

/** What Nathan answers when the words ask a new question. */
export const ASK_NEW_QUESTION_REPLY =
  "That's a new question, not a page, filter or sort of the earlier result. Ask the Analyst or the whole workflow.";

/** What Nathan answers when the earlier answer ran no query. */
export const ASK_NO_RESULT_REPLY =
  'The earlier answer has no query result to page, filter or sort. Ask the Analyst or the whole workflow.';

/** What Zoe answers when the run has no reference image. */
export const ASK_NO_IMAGES_REPLY =
  'This run has no reference images to read. Attach one, or ask another agent.';

/** What Ryan answers when the earlier answer has no query rows to chart. */
export const ASK_NO_ROWS_REPLY =
  'The earlier answer has no query rows to chart. Ask the Analyst or the whole workflow.';

/** Ryan's answer once his new visual is stored (agents.md 5.21). */
export function visualAnswer(title: string): string {
  return `Here's a new visual of the earlier answer: "${title}".`;
}

/** Ryan's answer when the design failed: the run still ends done. */
export function visualFailedAnswer(reason: string): string {
  return `I couldn't build a new visual: ${reason}`;
}

function bulletList(items: readonly string[]): string[] {
  return items.map((item) => `- ${item}`);
}

/**
 * Olivia's plan as the answer (agents.md 5.21): what she would analyse and
 * how, in words; her clarifying question with its options when the
 * question leaves the metric open. No data is read.
 */
export function planAnswer(plan: AnalysisPlan): string {
  if (plan.needsClarification && plan.clarification) {
    return [
      plan.clarification.question,
      '',
      ...bulletList(plan.clarification.options),
      '',
      'Answer with one of these and ask the whole workflow to run it.',
    ].join('\n');
  }
  const lines = [`**How I would analyse it:** ${plan.question}`];
  if (plan.measures.length)
    lines.push('', 'Measures:', ...bulletList(plan.measures));
  if (plan.entities.length) {
    lines.push('', 'Tables it would read:', ...bulletList(plan.entities));
  }
  if (plan.scope) lines.push('', `Scope: ${plan.scope}`);
  if (plan.assumptions.length) {
    lines.push('', 'Assumptions:', ...bulletList(plan.assumptions));
  }
  lines.push(
    '',
    'This is a plan only: no data was read. Ask the Analyst or the whole workflow to run it.',
  );
  return lines.join('\n');
}

/**
 * Zoe's notes as the answer, or why there are none: the notes as the
 * workflow hands them to its models (`renderImageNotes`), without their
 * opening heading and the line that tells a model how to treat them.
 */
export function imageNotesAnswer(outcome: ReadImagesOutcome): string {
  const lines = outcome.imageNotes.trim().split('\n');
  if (lines[0]?.trim() === '## Reference images') lines.shift();
  if (lines[0]?.startsWith('The user attached ')) lines.shift();
  return lines.join('\n').trim() || ASK_NO_IMAGES_REPLY;
}
