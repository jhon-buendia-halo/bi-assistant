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
  type OrchestratorToolsRuntime,
} from '../../../mastra/workflows/orchestrated-answer.steps';
import type { ReadImagesOutcome } from '../../../mastra/workflows/read-images.steps';
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
  if (state.answer) lines.push('Jessica already wrote the answer.');
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
  const catalogOf = async () => {
    if (!state.catalog || !state.columns) {
      const loaded = await loadCatalog(deps.datasets);
      state.catalog = loaded.catalog;
      state.columns = loaded.columns;
    }
    return { catalog: state.catalog, columns: state.columns };
  };
  const plan = async (): Promise<string> => {
    const { catalog, columns } = await catalogOf();
    const planned = await team.plan({
      question,
      catalog,
      catalogBlock: planCatalogBlock(catalog, columns, { question }),
      ...(answered ? { clarification: answered } : {}),
      imageNotes: state.imageNotes,
    });
    state.plan = planned.plan;
    return planForAvery(planned.plan);
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
    plan,
    analyse: async (brief: string) => {
      if (state.attempts >= 2) {
        return 'Michael already analysed twice in this run: write the answer from his results.';
      }
      if (!state.plan) await plan();
      const { catalog, columns } = await catalogOf();
      const current = state.plan!;
      state.attempts += 1;
      const attempt: AnalyseAttempt = await team.analyse({
        question,
        catalog,
        catalogBlock: planCatalogBlock(catalog, columns, { question }),
        plan: current,
        attempt: state.attempts,
        planBlock: [
          analysePlanBlock(current),
          '',
          `Brief from Avery, the Chief of Staff: ${brief}`,
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
      return [
        analysisReview({ queries: attempt.queries, text: attempt.text }),
        '',
        findingsForAvery(findings),
      ].join('\n');
    },
    writeAnswer: async () => {
      if (!state.plan || !state.queries.length) {
        return 'Michael has no results yet: call analyse_data first.';
      }
      const written = await team.writeAnswer({
        question,
        plan: state.plan,
        queries: state.queries,
        findings: state.findings,
        imageNotes: state.imageNotes,
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
        const brief =
          typeof payload.args?.['brief'] === 'string'
            ? payload.args['brief']
            : typeof payload.args?.['instruction'] === 'string'
              ? payload.args['instruction']
              : undefined;
        deps.emit({
          type: 'tool',
          content: JSON.stringify({
            name,
            ...(brief ? { input: brief.slice(0, 200) } : {}),
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
