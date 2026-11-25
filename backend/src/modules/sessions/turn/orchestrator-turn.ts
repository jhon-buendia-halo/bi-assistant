/**
 * Avery's turn (agents.md 2.21, 5.23): the Orchestrate step of Answer a
 * Business Question (Avery + Michael). Avery streams with her tools; each
 * tool calls a member of the team (`team`), with no question to the user:
 * only Avery talks to the user. What the team produced is kept in `state`,
 * which lives as long as the turn (a wait for the user included), so a
 * resumed Avery knows the work done so far.
 *
 * The run's answer is Michael's written answer (its figures link to the
 * queries behind them, agent-answers R56), followed by Avery's closing
 * words; with no written answer, Avery's words alone.
 */
import { RequestContext } from '@mastra/core/request-context';
import { parseClarification } from '../../../mastra/tools/clarification.tool';
import { CHIEF_OF_STAFF_AGENT_KEY } from '../../../mastra/agent-constants';
import { runErrorMessage } from '../../../mastra/workflows/workflow-run';
import { BUILTIN_AGENT_PERSONAS } from '../../../mastra/agent-personas';
import { ModelTimeoutError } from '../../../mastra/workflows/model-call';
import { analysisReview } from '../../../mastra/workflows/analysis.prompts';
import {
  loadCatalog,
  planCatalogBlock,
  validateAttempt,
  type AnalyseAttempt,
  type AnalyseQuery,
  type AnalysisPlan,
  type AnalyseRuntime,
  type AnsweredClarification,
  type CatalogEntity,
  type EntityColumns,
  type ValidationFinding,
} from '../../../mastra/workflows/analysis.steps';
import {
  AVERY_TEAM,
  ORCHESTRATOR_MAX_STEPS,
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  teammateOfTool,
  type OrchestratorToolsRuntime,
} from '../../../mastra/workflows/orchestrated-answer-michael.steps';
import {
  briefPlan,
  michaelAloneRequest,
  planReview,
} from '../../../mastra/workflows/orchestrated-answer-michael.prompts';
import { BUILD_DASHBOARD_MAX_CALLS } from '../../../mastra/workflows/bi-dashboard.schemas';
import {
  EXPORT_CONVERSATION_MAX_CALLS,
  exportContentTexts,
  exportFact,
  figuresNotInAnswers,
  refusedFiguresReply,
  type ExportContent,
} from '../../../mastra/workflows/export-request';
import type {
  ConversationExportRef,
  ConversationTurns,
} from '../../conversation-export/conversation-export.contract';
import { currentDashboardBlock } from '../../../mastra/workflows/bi-analyst.prompts';
import {
  EXPORT_TOOLS_RUNTIME_KEY,
  type ExportToolsRuntime,
} from '../../../mastra/tools/export.tools';
import type {
  CurrentDashboard,
  DashboardRef,
} from '../../artifacts/entities/artifact.entity';
import type { ExplorableQuery } from '../query-evidence/explorable-queries';
import {
  STEP_MODEL_CONTEXT_KEY,
  type StepModel,
} from '../../../mastra/step-model';
import type { StreamEvent } from './stream-events';

/** The most model steps Avery takes in one turn (defined with her catalogue data). */
export { ORCHESTRATOR_MAX_STEPS };

/** The team's calls, as the turn makes them (agents.md 5.23). */
export interface OrchestratorTeam {
  /** Michael's analysis: one attempt of his agent turn. */
  analyse: AnalyseRuntime['analyse'];
  /**
   * Clara's build (agents.md 2.22, 5.22): her turn on Avery's brief, the
   * host's run of her data query and the saved artifact version. `current`
   * is the dashboard she changes (its next version), absent for a new one.
   * `saved` is the version just saved, as a later call of the run changes it.
   */
  buildDashboard?(input: {
    question: string;
    brief: string;
    catalogBlock: string;
    current?: CurrentDashboard;
    earlierBlock: string;
  }): Promise<{
    dashboard?: DashboardRef;
    saved?: CurrentDashboard;
    reply: string;
    error?: string;
    stopped: boolean;
  }>;
  /**
   * The conversation's export (agents.md 3.18): the files of Avery's
   * content, or why there are none.
   */
  exportConversation?(
    content: ExportContent,
  ): Promise<{ export?: ConversationExportRef; error?: string }>;
}

/** What the team produced so far in this turn. */
export interface OrchestratorState extends ExportState {
  catalog?: CatalogEntity[];
  columns?: EntityColumns[];
  /** The plan Michael worked from: the question, nothing planned. */
  plan?: AnalysisPlan;
  /** Analyse attempts made (Avery may call Michael at most twice). */
  attempts: number;
  queries: AnalyseQuery[];
  findings: ValidationFinding[];
  analystNote: string;
  answer?: string;
  /** The dashboard Clara saved last in this turn: the answer carries it. */
  dashboard?: DashboardRef;
  /** That version, read back: a second build changes it. */
  builtDashboard?: CurrentDashboard;
  /** Clara's builds made (at most `BUILD_DASHBOARD_MAX_CALLS`). */
  dashboardCalls: number;
}

/** A fresh state, for a new turn. */
export function orchestratorState(): OrchestratorState {
  return {
    attempts: 0,
    queries: [],
    findings: [],
    analystNote: '',
    dashboardCalls: 0,
    exportCalls: 0,
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
  /**
   * The dashboard gate (agents.md 2.21): the user asked for a dashboard or
   * the conversation has one. Closed, build_dashboard is hidden and the
   * run's facts say nothing of dashboards.
   */
  buildsDashboard: boolean;
  /** The conversation's dashboard (its current version), on a follow-up. */
  currentDashboard?: CurrentDashboard;
  /**
   * The export gate (agents.md 2.21): the user asked to export the
   * conversation. Closed, export_conversation is hidden and the run's facts
   * say nothing of an export.
   */
  exportsConversation: boolean;
  /**
   * The conversation's ended turns before this run, with the gate open: the
   * questions Avery's facts list and the answers the figure check reads.
   */
  earlierTurns?: ConversationTurns;
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
  /** Avery's tools in this run; all of hers (`AVERY_TEAM.tools`) when absent. */
  tools?: readonly string[];
}

/**
 * What one of Avery's calls is about, for its `tool` event: her brief or
 * instruction to a teammate, the skill she loads (`skill { name }`), the
 * file she reads in it (`skill_read { path }`) or the title of her export.
 */
function averyToolInput(
  args: Record<string, unknown> | undefined,
): string | undefined {
  for (const key of [
    'brief',
    'instruction',
    'path',
    'name',
    'query',
    'title',
  ]) {
    const value = args?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * The most a team call's brief or its teammate's reply keeps in a tool event,
 * as a run stores a call's input (`TOOL_CALL_INPUT_CAP`, api.md 3.1).
 */
export const TEAM_EVENT_TEXT_CAP = 2_000;

/** A tool's result as text: `{ result }` (the team tools'), or a string. */
function toolResultText(result: unknown): string | undefined {
  if (typeof result === 'string') return result;
  const text = (result as { result?: unknown } | null)?.result;
  return typeof text === 'string' ? text : undefined;
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
    // Unchanged since her whole team's workflow: no run builds a visual.
    'The run builds no visual.',
    ...conversationFacts(deps, 'build_dashboard'),
  ].join('\n');
}

/**
 * A conversation's facts about its gates (agents.md 2.21), Avery's and
 * Elena's: only with a gate open, so a run that is not about a dashboard or
 * an export sends what it sent before. `dashboardTool` is the tool that
 * builds it (Avery's `build_dashboard`, Elena's `submit_dashboard`).
 */
export function conversationFacts(
  gates: Pick<
    OrchestratorTurnDeps,
    | 'buildsDashboard'
    | 'currentDashboard'
    | 'exportsConversation'
    | 'earlierTurns'
  >,
  dashboardTool: string,
): string[] {
  return [
    ...(gates.buildsDashboard
      ? [dashboardFact(gates.currentDashboard, dashboardTool)]
      : []),
    ...(gates.exportsConversation
      ? [exportFact(gates.earlierTurns?.questions ?? [])]
      : []),
  ];
}

/** The run's dashboard fact, when the gate is open (agents.md 2.21). */
function dashboardFact(
  current: CurrentDashboard | undefined,
  tool: string,
): string {
  return current
    ? `The conversation has a dashboard: "${current.title}", version ${current.version} (${current.widgetCount} widgets, ${current.filterCount} filters). ${tool} changes it into version ${current.version + 1}.`
    : `The user asked for a dashboard: ${tool} is available.`;
}

export { currentDashboardBlock };

/** The work done so far, for a resumed Avery. */
function workSoFar(state: OrchestratorState): string | undefined {
  const lines: string[] = [];
  // Michael's plan, the question with nothing planned, in the words Avery
  // read before her whole team's workflow was removed.
  if (state.plan)
    lines.push('Michael worked from this plan:', planReview(state.plan));
  if (state.queries.length) {
    lines.push(
      `Michael already ran ${state.attempts} analysis attempt(s):`,
      analysisReview({ queries: state.queries, text: state.analystNote }),
    );
  }
  if (state.answer) lines.push('The answer the user reads is already written.');
  if (state.dashboard) {
    lines.push(
      `Clara already built the dashboard "${state.dashboard.title}", version ${state.dashboard.version}.`,
    );
  }
  if (state.export) {
    lines.push(
      `You already exported the conversation: "${state.export.title}".`,
    );
  }
  return lines.length
    ? ['Work done so far in this run (do not redo it):', ...lines].join('\n')
    : undefined;
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

/**
 * A model error of Michael's (agents.md 5.23): it fails Orchestrate, named
 * as his, e.g. `Michael (Insights Analyst) could not answer: <message>`. A
 * model timeout is thrown as it is (workflows R43).
 */
export function michaelFailure(error: unknown): Error {
  if (error instanceof ModelTimeoutError) return error;
  const { name, role } = BUILTIN_AGENT_PERSONAS['insights-analyst'];
  return new Error(
    `${name} (${role}) could not answer: ${runErrorMessage(error)}`,
  );
}

/** The tools' runtime: each tool calls one member of the team. */
export function orchestratorTools(
  deps: OrchestratorTurnDeps,
  question: string,
  answered: AnsweredClarification | undefined,
  /** Michael's own words for Avery, which his team call hands back (ui.md 4.4b). */
  said?: (reply: string) => void,
  /**
   * Michael's model failed (not a Stop): the turn fails with it. His tool
   * throws it as well, so no caller reads it as an answer.
   */
  failed?: (error: Error) => void,
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
  /**
   * One answer by Michael on his own (agents.md 5.23): no plan but Avery's
   * brief, and his reply is the answer the user reads.
   */
  const answerFromData = async (brief: string): Promise<string> => {
    if (state.attempts >= 2) {
      return 'Michael already answered twice in this run: close from his answer.';
    }
    const { catalog, columns } = await catalogOf();
    const current = (state.plan ??= briefPlan(question));
    state.attempts += 1;
    // His model's error fails the turn: inside her tool it would only be a
    // tool error she reads, and the run would end with no answer. A Stop is
    // no failure (it answers stopped); a retry's error is no throw, its
    // `retryError` keeps his first answer (5.11).
    const fail = (error: unknown): Error => {
      const named = michaelFailure(error);
      failed?.(named);
      return named;
    };
    let attempt: AnalyseAttempt;
    try {
      attempt = await team.analyse({
        question,
        catalog,
        catalogBlock: planCatalogBlock(catalog, columns, { question }),
        plan: current,
        attempt: state.attempts,
        planBlock: michaelAloneRequest(brief, earlier),
        ...(answered ? { answered } : {}),
        // No reference images reach Michael here: the run's input has none.
        imageNotes: '',
      });
    } catch (error) {
      if (deps.signal.aborted) throw error;
      throw fail(error);
    }
    if (attempt.clarification) {
      said?.(
        `Needs an answer before going on: ${attempt.clarification.question}`,
      );
      return [
        `Michael needs an answer before he can go on: ${attempt.clarification.question}`,
        ...attempt.clarification.options.map((option) => `- ${option}`),
      ].join('\n');
    }
    // The catalog and the question too: the data-date check reads them.
    const { findings } = validateAttempt({
      plan: current,
      calls: attempt.calls,
      queries: attempt.queries,
      catalog,
      question,
    });
    // The kept queries: this attempt's, after any earlier one's.
    state.queries = [...state.queries, ...attempt.queries];
    state.findings = findings;
    state.analystNote = attempt.text;
    if (attempt.text.trim()) said?.(attempt.text);
    // His reply is the run's answer (the last one he wrote).
    if (attempt.text.trim()) state.answer = attempt.text;
    return [
      analysisReview({ queries: attempt.queries, text: attempt.text }),
      '',
      findingsForAvery(findings),
      '',
      state.answer
        ? "Michael's reply above is the answer the user reads: do not repeat it."
        : 'Michael wrote no answer.',
    ].join('\n');
  };
  return {
    tools: deps.tools ?? AVERY_TEAM.tools,
    answerFromData,
    buildsDashboard: deps.buildsDashboard && !!team.buildDashboard,
    // Clara (agents.md 2.22, 5.22): at most twice per run; a second build
    // changes the version the first one saved.
    buildDashboard: async (brief: string) => {
      if (!deps.buildsDashboard || !team.buildDashboard) {
        return 'This run builds no dashboard.';
      }
      if (state.dashboardCalls >= BUILD_DASHBOARD_MAX_CALLS) {
        return 'Clara already built twice in this run: close from the dashboard she has.';
      }
      state.dashboardCalls += 1;
      const { catalog, columns } = await catalogOf();
      const current = state.builtDashboard ?? deps.currentDashboard;
      const built = await team.buildDashboard({
        question,
        brief,
        catalogBlock: planCatalogBlock(catalog, columns, { question }),
        ...(current ? { current } : {}),
        earlierBlock: earlier,
      });
      if (built.reply.trim()) said?.(built.reply);
      if (built.stopped) return 'The run was stopped.';
      if (!built.dashboard) {
        return `Clara built no dashboard: ${built.error ?? 'she submitted none'}`;
      }
      const ref = built.dashboard;
      state.dashboard = ref;
      if (built.saved) state.builtDashboard = built.saved;
      return [
        `Built dashboard "${ref.title}", version ${ref.version} (${ref.action}): ${ref.widgetCount} widgets, ${ref.filterCount} filters, ${ref.rowCount} rows.`,
        ...(built.saved?.columns.length
          ? [`Its columns: ${built.saved.columns.join(', ')}.`]
          : []),
        'The user sees the dashboard with the answer: do not describe it in figures.',
      ].join('\n');
    },
    ...exportRuntime(
      state,
      deps.earlierTurns,
      deps.exportsConversation ? team : undefined,
    ),
  };
}

/** What a conversation's export keeps in its turn (agents.md 3.18). */
export interface ExportState {
  /** The conversation's export made in this turn: the answer carries it. */
  export?: ConversationExportRef;
  /** export_conversation calls made (at most `EXPORT_CONVERSATION_MAX_CALLS`). */
  exportCalls: number;
}

/**
 * The runtime export_conversation calls (agents.md 3.18), Avery's and
 * Elena's: offered when the turn has an `exporter` (the gate is open); at most
 * twice per turn; every figure the agent wrote is checked against the
 * conversation's answers (`turns`) before anything is drawn; the export
 * made is kept on `state`.
 */
export function exportRuntime(
  state: ExportState,
  turns: ConversationTurns | undefined,
  exporter: Pick<OrchestratorTeam, 'exportConversation'> | undefined,
): ExportToolsRuntime {
  return {
    exportsConversation: !!exporter?.exportConversation,
    exportConversation: async (content: ExportContent) => {
      if (!exporter?.exportConversation) return 'This run exports nothing.';
      if (state.exportCalls >= EXPORT_CONVERSATION_MAX_CALLS) {
        return 'export_conversation already ran twice in this run: close from what it said.';
      }
      state.exportCalls += 1;
      const refused = figuresNotInAnswers(
        exportContentTexts(content),
        turns?.answers ?? [],
      );
      if (refused.length) return refusedFiguresReply(refused);
      const made = await exporter.exportConversation(content);
      if (!made.export) {
        return `The conversation was not exported: ${made.error ?? 'no file was made'}`;
      }
      state.export = made.export;
      return exportedReply(made.export);
    },
  };
}

/** What Avery reads once the files are made (agents.md 3.18). */
export function exportedReply(made: ConversationExportRef): string {
  const files = made.files.map((file) =>
    file.format === 'pdf'
      ? `PDF (${file.pages ?? 0} pages)`
      : `PowerPoint (${file.slides ?? 0} slides)`,
  );
  return `Exported "${made.title}": ${files.join(', ')}. The user sees the download card with the answer: do not repeat the summary.`;
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
  const tools = orchestratorTools(
    deps,
    question,
    answered,
    (reply) => {
      said = reply;
    },
    // Michael's model failed: her stream ends there, and the turn fails.
    (error) => {
      failure ??= error;
      stop.abort();
    },
  );
  requestContext.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, tools);
  // export_conversation reads its own key (agents.md 3.18).
  requestContext.set(EXPORT_TOOLS_RUNTIME_KEY, {
    exportsConversation: tools.exportsConversation,
    exportConversation: (content) => tools.exportConversation(content),
  } satisfies ExportToolsRuntime);
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
  // A listener added to an aborted signal never fires: a Stop already in.
  if (deps.signal.aborted) stop.abort();
  let closing = '';
  let asked: { question: string; options: string[] } | undefined;
  let failure: unknown;
  const names = new Map<string, string>();
  // What the teammate of the call under way said, in their own words.
  let said: string | undefined;
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
        // Words before a call are her notes on what to do next ("Score 0–1,
        // brief Michael"), not her closing: only what follows her last call
        // reaches the user (agents.md 5.23).
        closing = '';
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
            ...(input ? { input: input.slice(0, TEAM_EVENT_TEXT_CAP) } : {}),
            agent: CHIEF_OF_STAFF_AGENT_KEY,
            ...(teammate ? { teammate } : {}),
          }),
        });
      } else if (chunk.type === 'tool-result') {
        const name =
          payload.toolName ??
          (payload.toolCallId ? names.get(payload.toolCallId) : undefined) ??
          'tool';
        // A team call's result: what the teammate handed back (ui.md 4.4b).
        const reply = teammateOfTool(name)
          ? (said ?? toolResultText(payload.result))
          : undefined;
        said = undefined;
        deps.emit({
          type: 'tool-result',
          content: JSON.stringify({
            tool: name,
            ...(reply?.trim()
              ? { reply: reply.trim().slice(0, TEAM_EVENT_TEXT_CAP) }
              : {}),
          }),
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
