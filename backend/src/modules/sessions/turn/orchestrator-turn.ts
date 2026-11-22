/**
 * Avery's turn (agents.md 2.21, 5.22): the Orchestrate step of Answer a
 * Business Question (orchestrated). Avery streams with her tools; each tool
 * calls a member of the team through the same calls Answer a Business
 * Question's steps make (`team`), with no approval gate and no question to
 * the user: only Avery talks to the user. What the team produced is kept in
 * `state`, which lives as long as the turn (a wait for the user included),
 * so a resumed Avery knows the work done so far.
 *
 * The run's answer is Jessica's written answer (its figures link to the
 * queries behind them, agent-answers R56), followed by Avery's closing
 * words; with no written answer, Avery's words alone.
 */
import { RequestContext } from '@mastra/core/request-context';
import { parseClarification } from '../../../mastra/tools/clarification.tool';
import { CHIEF_OF_STAFF_AGENT_KEY } from '../../../mastra/agent-constants';
import { runErrorMessage } from '../../../mastra/workflows/workflow-run';
import {
  analysisReview,
  analysePlanBlock,
  planReview,
} from '../../../mastra/workflows/answer-business-question.prompts';
import {
  loadCatalog,
  planCatalogBlock,
  validateAttempt,
  type AnalyseAttempt,
  type AnalyseQuery,
  type AnalysisPlan,
  type AnsweredClarification,
  type AnswerBusinessQuestionRuntime,
  type CatalogEntity,
  type EntityColumns,
  type ValidationFinding,
} from '../../../mastra/workflows/answer-business-question.steps';
import {
  ORCHESTRATOR_MAX_STEPS,
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  orchestratorTeamOf,
  teammateOfTool,
  type OrchestratorToolsRuntime,
} from '../../../mastra/workflows/orchestrated-answer.steps';
import type { ReadImagesOutcome } from '../../../mastra/workflows/read-images.steps';
import type { ExplorableQuery } from '../query-evidence/explorable-queries';
import {
  STEP_MODEL_CONTEXT_KEY,
  type StepModel,
} from '../../../mastra/step-model';
import type { StreamEvent } from './stream-events';

/** The most model steps Avery takes in one turn (defined with her catalogue data). */
export { ORCHESTRATOR_MAX_STEPS };

/** The team's calls, as the turn makes them for Answer a Business Question. */
export interface OrchestratorTeam {
  readImages(input: {
    question: string;
    images: string[];
  }): Promise<ReadImagesOutcome>;
  plan: AnswerBusinessQuestionRuntime['plan'];
  analyse: AnswerBusinessQuestionRuntime['analyse'];
  writeAnswer: AnswerBusinessQuestionRuntime['writeAnswer'];
  buildVisual?: AnswerBusinessQuestionRuntime['buildVisual'];
}

/** What the team produced so far in this turn. */
export interface OrchestratorState {
  catalog?: CatalogEntity[];
  columns?: EntityColumns[];
  imageNotes: string;
  plan?: AnalysisPlan;
  /** Analyse attempts made (Avery may call Michael at most twice). */
  attempts: number;
  queries: AnalyseQuery[];
  findings: ValidationFinding[];
  analystNote: string;
  answer?: string;
  visual?: string;
}

/** A fresh state, for a new turn. */
export function orchestratorState(): OrchestratorState {
  return {
    imageNotes: '',
    attempts: 0,
    queries: [],
    findings: [],
    analystNote: '',
  };
}

/** What Avery's turn needs from the turn engine. */
export interface OrchestratorTurnDeps {
  /** The registered agents (Avery is `chief-of-staff`). */
  getAgent(key: string): {
    stream(
      messages: unknown,
      options: Record<string, unknown>,
    ): Promise<{
      fullStream: AsyncIterable<{ type: string; payload?: unknown }>;
    }>;
  };
  team: OrchestratorTeam;
  state: OrchestratorState;
  emit(event: StreamEvent): void;
  signal: AbortSignal;
  datasets: string[];
  images: string[];
  buildsVisual: boolean;
  /** Avery's own model and effort (Opus 5.5 high), when it applies. */
  orchestratorModel?: StepModel;
  /** The provider options for that model and effort (or the turn's). */
  providerOptions?: Record<string, unknown>;
  /**
   * The conversation so far (workflows R45): its earlier questions and
   * answers, oldest first; empty on a conversation's first message.
   */
  history?: { role: 'user' | 'assistant'; content: string }[];
  /**
   * The queries behind the conversation's last answer (workflows R45): on a
   * follow-up, Michael reads them as a block and can explore their rows,
   * instead of going on from a copy of his earlier thread.
   */
  earlierQueries?: readonly Pick<
    ExplorableQuery,
    'ref' | 'sql' | 'rationale'
  >[];
  /**
   * Avery's tools in this run, her workflow's (`orchestratorTeamOf`); her
   * whole team's when absent.
   */
  tools?: readonly string[];
}

/**
 * What one of Avery's calls is about, for its `tool` event: her brief or
 * instruction to a teammate, the skill she loads (`skill { name }`) or the
 * file she reads in it (`skill_read { path }`).
 */
function averyToolInput(
  args: Record<string, unknown> | undefined,
): string | undefined {
  for (const key of ['brief', 'instruction', 'path', 'name', 'query']) {
    const value = args?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/** Michael on his own (Avery + Michael): told he plans and writes the answer. */
export const MICHAEL_ALONE_LINE =
  'You work alone with Avery in this run: no one plans before you and no one writes after you. Plan the analysis yourself from her brief, and write your reply as the answer the user reads.';

/** The plan Michael works from on his own: the user's question, nothing planned. */
function briefPlan(question: string): AnalysisPlan {
  return {
    question,
    measures: [],
    entities: [],
    scope: '',
    assumptions: [],
    needsClarification: false,
    clarification: null,
  };
}

/** At most this many earlier queries, each SQL cut at this length, reach Michael. */
const EARLIER_QUERIES_MAX = 8;
const EARLIER_SQL_MAX = 1500;

/**
 * The conversation's earlier queries for Michael (workflows R45): what they
 * were for and their SQL, so a follow-up changes them rather than starting
 * over; '' when there are none.
 */
export function conversationQueriesBlock(
  queries: OrchestratorTurnDeps['earlierQueries'],
): string {
  if (!queries?.length) return '';
  const shown = queries.slice(-EARLIER_QUERIES_MAX);
  return [
    'Queries behind the answer the user just read (reuse or change them rather than starting over; explore_result reads their rows by ref):',
    ...shown.map((query) =>
      [
        `- ${query.ref}: ${query.rationale?.trim() || '(no rationale given)'}`,
        `  SQL: ${query.sql.length > EARLIER_SQL_MAX ? `${query.sql.slice(0, EARLIER_SQL_MAX)} …` : query.sql}`,
      ].join('\n'),
    ),
  ].join('\n');
}

/** The most messages of the conversation so far Avery reads (20 turns). */
export const ORCHESTRATOR_HISTORY_MESSAGES = 40;

/** The run's facts, Avery's first system block. */
function runFacts(deps: OrchestratorTurnDeps): string {
  return [
    `Run facts: datasets ${deps.datasets.length ? deps.datasets.join(', ') : 'none'}.`,
    deps.images.length
      ? `The run has ${deps.images.length} reference image(s).`
      : 'The run has no reference images.',
    deps.buildsVisual
      ? 'The run builds a visual (build_visual is available).'
      : 'The run builds no visual.',
  ].join('\n');
}

/** The work done so far, for a resumed Avery. */
function workSoFar(state: OrchestratorState): string | undefined {
  const lines: string[] = [];
  if (state.imageNotes.trim()) lines.push('Zoe already read the images.');
  if (state.plan) lines.push('Olivia already planned:', planReview(state.plan));
  if (state.queries.length) {
    lines.push(
      `Michael already ran ${state.attempts} analysis attempt(s):`,
      analysisReview({ queries: state.queries, text: state.analystNote }),
    );
  }
  if (state.answer) lines.push('The answer the user reads is already written.');
  if (state.visual) lines.push(`Ryan: ${state.visual}`);
  return lines.length
    ? ['Work done so far in this run (do not redo it):', ...lines].join('\n')
    : undefined;
}

/** A plan for Avery, with Olivia's question when she has one. */
function planForAvery(plan: AnalysisPlan): string {
  const asked =
    plan.needsClarification && plan.clarification
      ? [
          '',
          `Olivia says the question can be read more than one way: ${plan.clarification.question}`,
          ...plan.clarification.options.map((option) => `- ${option}`),
          'Ask the user only if the choice changes the answer; else go on with the plan.',
        ]
      : [];
  return [planReview(plan), ...asked].join('\n');
}

/** Checks for Avery: each failed one, or that they all passed. */
function findingsForAvery(findings: readonly ValidationFinding[]): string {
  const failed = findings.filter((finding) => !finding.passed);
  return failed.length
    ? [
        'Checks that did not pass:',
        ...failed.map((finding) => `- ${finding.check}: ${finding.detail}`),
      ].join('\n')
    : 'Every check passed.';
}

/** The tools' runtime: each tool calls one member of the team. */
export function orchestratorTools(
  deps: OrchestratorTurnDeps,
  question: string,
  answered: AnsweredClarification | undefined,
): OrchestratorToolsRuntime {
  const { state, team } = deps;
  const earlier = conversationQueriesBlock(deps.earlierQueries);
  const catalogOf = async () => {
    if (!state.catalog || !state.columns) {
      const loaded = await loadCatalog(deps.datasets);
      state.catalog = loaded.catalog;
      state.columns = loaded.columns;
    }
    return { catalog: state.catalog, columns: state.columns };
  };
  const plan = async (brief?: string): Promise<string> => {
    const { catalog, columns } = await catalogOf();
    const planned = await team.plan({
      question,
      catalog,
      catalogBlock: planCatalogBlock(catalog, columns, { question }),
      ...(answered ? { clarification: answered } : {}),
      imageNotes: state.imageNotes,
      // Avery's request: the question restated to stand alone (R45).
      ...(brief?.trim() ? { brief } : {}),
    });
    state.plan = planned.plan;
    return planForAvery(planned.plan);
  };
  /**
   * One analysis by Michael. With the team, he follows Olivia's plan (made
   * first when there is none) and Jessica writes the answer. `alone` (Avery
   * + Michael, agents.md 5.23): no plan but Avery's brief, and his reply is
   * the answer the user reads.
   */
  const analysis = async (brief: string, alone: boolean): Promise<string> => {
    if (state.attempts >= 2) {
      return alone
        ? 'Michael already answered twice in this run: close from his answer.'
        : 'Michael already analysed twice in this run: write the answer from his results.';
    }
    if (!alone && !state.plan) await plan();
    const { catalog, columns } = await catalogOf();
    const current = alone ? (state.plan ??= briefPlan(question)) : state.plan!;
    state.attempts += 1;
    const attempt: AnalyseAttempt = await team.analyse({
      question,
      catalog,
      catalogBlock: planCatalogBlock(catalog, columns, { question }),
      plan: current,
      attempt: state.attempts,
      planBlock: [
        ...(alone ? [] : [analysePlanBlock(current), '']),
        `Brief from Avery, the Chief of Staff: ${brief}`,
        ...(alone ? ['', MICHAEL_ALONE_LINE] : []),
        ...(earlier ? ['', earlier] : []),
      ].join('\n'),
      ...(answered ? { answered } : {}),
      imageNotes: state.imageNotes,
    });
    if (attempt.clarification) {
      return [
        `Michael needs an answer before he can go on: ${attempt.clarification.question}`,
        ...attempt.clarification.options.map((option) => `- ${option}`),
      ].join('\n');
    }
    const { findings } = validateAttempt({
      plan: current,
      calls: attempt.calls,
      queries: attempt.queries,
    });
    // The kept queries: this attempt's, after any earlier one's.
    state.queries = [...state.queries, ...attempt.queries];
    state.findings = findings;
    state.analystNote = attempt.text;
    // On his own, his reply is the run's answer (the last one he wrote).
    if (alone && attempt.text.trim()) state.answer = attempt.text;
    return [
      analysisReview({ queries: attempt.queries, text: attempt.text }),
      '',
      findingsForAvery(findings),
      ...(alone
        ? [
            '',
            state.answer
              ? "Michael's reply above is the answer the user reads: do not repeat it."
              : 'Michael wrote no answer.',
          ]
        : []),
    ].join('\n');
  };
  return {
    hasImages: deps.images.length > 0,
    buildsVisual: deps.buildsVisual,
    readImages: async () => {
      if (!deps.images.length) return 'The run has no reference images.';
      const read = await team.readImages({ question, images: deps.images });
      state.imageNotes = read.stopped ? '' : read.imageNotes;
      return state.imageNotes || 'Zoe found nothing to describe.';
    },
    tools: deps.tools ?? orchestratorTeamOf(undefined).tools,
    plan: (brief?: string) => plan(brief),
    analyse: (brief: string) => analysis(brief, false),
    answerFromData: (brief: string) => analysis(brief, true),
    writeAnswer: async (brief?: string) => {
      if (!state.plan || !state.queries.length) {
        return 'Michael has no results yet: call analyse_data first.';
      }
      const written = await team.writeAnswer({
        question,
        plan: state.plan,
        queries: state.queries,
        findings: state.findings,
        imageNotes: state.imageNotes,
        // Avery's request: the question restated, what the user knows (R45).
        ...(brief?.trim() ? { brief } : {}),
        // The answer is delivered once Avery is done (only she talks to
        // the user): it is not streamed as it is written.
        quiet: true,
      });
      state.answer = written.answer.answer;
      return `Jessica wrote the answer. Its headline: ${written.answer.headline || '(none)'}`;
    },
    buildVisual: async (instruction: string) => {
      if (!deps.buildsVisual || !team.buildVisual) {
        return 'This run builds no visual.';
      }
      if (!state.answer) return 'No answer yet: call write_answer first.';
      const built = await team.buildVisual({
        question: `${question}\n\nWhat the chart should show: ${instruction}`,
        answer: state.answer,
        queries: state.queries,
        ...(state.imageNotes.trim() ? { imageNotes: state.imageNotes } : {}),
      });
      state.visual = built.visual.visualId
        ? `Ryan built the visual "${built.visual.title ?? 'Interactive visual'}".`
        : `Ryan built no visual: ${built.visual.error ?? built.visual.skipped ?? 'no reason given'}`;
      return state.visual;
    },
  };
}

/**
 * Avery's turn: her stream, her tools' events shown as the step's activity,
 * and the run's answer. Her `ask_clarification` ends her stream with the
 * question (the step waits for the user).
 */
export async function runOrchestratorTurn(
  deps: OrchestratorTurnDeps,
  input: { question: string; answered?: AnsweredClarification },
): Promise<{
  answer: string;
  stopped: boolean;
  clarification?: { question: string; options: string[] };
}> {
  const { question, answered } = input;
  const requestContext = new RequestContext();
  requestContext.set(
    ORCHESTRATOR_TOOLS_RUNTIME_KEY,
    orchestratorTools(deps, question, answered),
  );
  if (deps.orchestratorModel) {
    requestContext.set(STEP_MODEL_CONTEXT_KEY, deps.orchestratorModel);
  }
  const done = workSoFar(deps.state);
  const history = (deps.history ?? []).slice(-ORCHESTRATOR_HISTORY_MESSAGES);
  const messages = answered
    ? [
        ...history,
        { role: 'user', content: question },
        {
          role: 'assistant',
          content: [
            answered.question,
            ...answered.options.map((o) => `- ${o}`),
          ].join('\n'),
        },
        { role: 'user', content: answered.answer },
      ]
    : [...history, { role: 'user', content: question }];
  // Her own stop: a question to the user ends her stream, not the turn.
  const stop = new AbortController();
  const forward = () => stop.abort();
  deps.signal.addEventListener('abort', forward, { once: true });
  let closing = '';
  let asked: { question: string; options: string[] } | undefined;
  let failure: unknown;
  const names = new Map<string, string>();
  try {
    const stream = await deps
      .getAgent(CHIEF_OF_STAFF_AGENT_KEY)
      .stream(messages, {
        maxSteps: ORCHESTRATOR_MAX_STEPS,
        abortSignal: stop.signal,
        requestContext,
        ...(deps.providerOptions
          ? { providerOptions: deps.providerOptions }
          : {}),
        context: [
          { role: 'system', content: runFacts(deps) },
          ...(done ? [{ role: 'system', content: done }] : []),
        ],
      });
    for await (const chunk of stream.fullStream) {
      const payload = (chunk.payload ?? {}) as {
        text?: string;
        error?: unknown;
        toolName?: string;
        toolCallId?: string;
        args?: Record<string, unknown>;
        result?: unknown;
      };
      if (chunk.type === 'error') {
        failure ??= payload.error;
      } else if (chunk.type === 'text-delta') {
        closing += payload.text ?? '';
      } else if (chunk.type === 'tool-call') {
        const name = payload.toolName ?? 'tool';
        if (name === 'ask_clarification') {
          const parsed = parseClarification(payload.args);
          if (parsed) {
            asked = {
              question: parsed.question,
              options: parsed.options.map((o) =>
                o.description ? `${o.label} — ${o.description}` : o.label,
              ),
            };
            stop.abort();
            break;
          }
        }
        if (payload.toolCallId) names.set(payload.toolCallId, name);
        const input = averyToolInput(payload.args);
        const teammate = teammateOfTool(name);
        // Her own call, signed (ui.md 4.4b *relay*): the calls that follow
        // a team tool's, unsigned, are that teammate's.
        deps.emit({
          type: 'tool',
          content: JSON.stringify({
            name,
            ...(input ? { input: input.slice(0, 200) } : {}),
            agent: CHIEF_OF_STAFF_AGENT_KEY,
            ...(teammate ? { teammate } : {}),
          }),
        });
      } else if (chunk.type === 'tool-result') {
        const name =
          payload.toolName ??
          (payload.toolCallId ? names.get(payload.toolCallId) : undefined) ??
          'tool';
        deps.emit({
          type: 'tool-result',
          content: JSON.stringify({ tool: name }),
        });
      }
    }
  } catch (error) {
    if (!stop.signal.aborted) failure ??= error;
  } finally {
    deps.signal.removeEventListener('abort', forward);
  }
  if (deps.signal.aborted) {
    return { answer: deps.state.answer ?? closing.trim(), stopped: true };
  }
  if (asked) return { answer: '', stopped: false, clarification: asked };
  if (failure !== undefined) {
    throw failure instanceof Error
      ? failure
      : new Error(runErrorMessage(failure));
  }
  const words = closing.trim();
  const answer = deps.state.answer
    ? words
      ? `${deps.state.answer}\n\n${words}`
      : deps.state.answer
    : words;
  return { answer, stopped: false };
}
