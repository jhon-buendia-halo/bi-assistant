// The turn engine (agents.md 5.1): one turn of a session or run host, from
// the user's question to the persisted answer and the `done` event.
import { randomUUID } from 'crypto';
import type { Logger } from '@nestjs/common';
import { RequestContext } from '@mastra/core/request-context';
import {
  clarificationOptions,
  parseClarification,
} from '../../../mastra/tools/clarification.tool';
import type { MastraService } from '../../../mastra/mastra.service';
import {
  ANALYSIS_PLANNER_AGENT_KEY,
  ANSWER_WRITER_AGENT_KEY,
  DASHBOARD_READER_AGENT_KEY,
  DATA_MAPPER_AGENT_KEY,
  GAP_ADVISOR_AGENT_KEY,
  IMAGE_READER_AGENT_KEY,
  LAYER_MAPPER_AGENT_KEY,
  REQUIREMENTS_ANALYST_AGENT_KEY,
  SITE_REVIEWER_AGENT_KEY,
} from '../../../mastra/agent-constants';
import { getDatasetToolServices } from '../../../mastra/tool-services';
import type { AgentExchange } from '../../../mastra/agent-threads';
import { TURN_RECORDS_CONTEXT_KEY } from '../../../mastra/tools/visual.tools';
import { readinessModelOutput } from '../../../mastra/tools/readiness.tools';
import {
  ASSESSED_REPORT_CONTEXT_KEY,
  READINESS_REPORT_EVENT,
} from '../../../mastra/readiness-tool-services';
import {
  DATA_READINESS_ASSESSMENT_RUNTIME_KEY,
  DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
  explainReportBlock,
  type DataReadinessAssessmentRuntime,
} from '../../../mastra/workflows/data-readiness-assessment.steps';
import {
  CONSUMPTION_GAP_RUNTIME_KEY,
  CONSUMPTION_GAP_WORKFLOW_ID,
  type ConsumptionGapRuntime,
  type GapQuery,
} from '../../../mastra/workflows/consumption-gap-analysis.steps';
import {
  MAP_DASHBOARD_DATA_RUNTIME_KEY,
  MAP_DASHBOARD_DATA_WORKFLOW_ID,
  type MapDashboardDataRuntime,
} from '../../../mastra/workflows/map-dashboard-data.steps';
import {
  RECREATE_DASHBOARD_RUNTIME_KEY,
  RECREATE_DASHBOARD_WORKFLOW_ID,
  type DashboardBlueprint,
  type MockBundle,
  type RecreateDashboardRuntime,
} from '../../../mastra/workflows/recreate-dashboard.steps';
import {
  REVIEW_WEBSITE_RUNTIME_KEY,
  REVIEW_WEBSITE_WORKFLOW_ID,
  reviewWebsiteInputOf,
  type ReviewWebsiteRuntime,
} from '../../../mastra/workflows/review-website.steps';
import {
  ModelTimeoutError,
  streamIdleWatch,
} from '../../../mastra/workflows/model-call';
import type { ReviewWebsiteInput } from '../../../mastra/workflows/review-website.schemas';
import type {
  SiteReviewRunIo,
  SiteReviewWork,
} from '../../site-review/site-review.service';
import type { WorkflowRunStream } from '../../../mastra/mastra.service';
import {
  ANALYSE_RETRY_MAX_STEPS,
  ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  clarifyingQuestionOf,
  keptQueryOrigins,
  planOf,
  turnSummaryOf,
  validateAttempt,
  type AnalyseQuery,
  type AnsweredClarification,
  type AnswerBusinessQuestionInput,
  type AnswerBusinessQuestionRuntime,
} from '../../../mastra/workflows/answer-business-question.steps';
import { analyseSystemBlocks } from '../../../mastra/workflows/answer-business-question.prompts';
import {
  ORCHESTRATED_ANSWER_RUNTIME_KEY,
  ORCHESTRATED_ANSWER_WORKFLOW_ID,
  ORCHESTRATOR_MODEL,
  orchestratorTeamOf,
  type OrchestratedAnswerRuntime,
} from '../../../mastra/workflows/orchestrated-answer.steps';
import {
  currentDashboardBlock,
  orchestratorState,
  runOrchestratorTurn,
  type OrchestratorTeam,
} from './orchestrator-turn';
import {
  BI_ANALYST_AGENT_KEY,
  BI_ANALYST_MAX_STEPS,
} from '../../../mastra/agents/bi-analyst-catalog';
import {
  DASHBOARD_DATA_CHAR_CAP,
  DASHBOARD_ROWS_CAP,
  SUBMIT_DASHBOARD_TOOL,
  blueprintFromDraft,
  dashboardBindingErrors,
  prepareDashboardRows,
  type DashboardDraft,
} from '../../../mastra/workflows/bi-dashboard.schemas';
import { asksForDashboard } from '../../../mastra/workflows/dashboard-request';
import {
  DASHBOARD_TOOLS_RUNTIME_KEY,
  type DashboardToolsRuntime,
} from '../../../mastra/tools/dashboard.tools';
import { runErrorMessage } from '../../../mastra/workflows/workflow-run';
import type {
  CurrentDashboard,
  DashboardQuery,
  DashboardRef,
  DashboardRow,
  DashboardVersionData,
} from '../../artifacts/entities/artifact.entity';
import type { NewDashboardVersion } from '../../artifacts/artifacts.service';
import { ANSWER_BUSINESS_QUESTION_MODEL } from '../../../mastra/workflows/answer-business-question.review';
import { resolveAgentModelConfig } from '../../../mastra/model-resolver';
import {
  STEP_MODEL_CONTEXT_KEY,
  servesClaude,
  type StepModel,
} from '../../../mastra/step-model';
import { turnProviderOptions } from './session-datasets';
import {
  READ_IMAGES_RUNTIME_KEY,
  imageNotesBlock,
  type ReadImagesRuntime,
} from '../../../mastra/workflows/read-images.steps';
import type { StepImage } from '../../../mastra/workflows/recreate-dashboard.agents';
import { withImageNotes } from './image-notes';
import {
  AGENT_TURN_RUNTIME_KEY,
  AGENT_TURN_WORKFLOW_ID,
  type AgentTurnRuntime,
} from '../../../mastra/workflows/agent-turn.steps';
import {
  AGENT_TURN_ASK_STEPS,
  ASK_AGENT_RUNTIME_KEY,
  ASK_AGENT_WORKFLOW_ID,
  type AskAgentInput,
  type AskAgentRuntime,
  type AskableStepId,
  type EarlierAnswerInput,
  type EarlierVisualInput,
} from '../../../mastra/workflows/ask-agent.steps';
import { planSchema } from '../../../mastra/workflows/answer-business-question.schemas';
import type { LlmService } from '../../llm/llm.service';
import { chatTurnError } from '../llm-error-message';
import { sourceEntities } from '../visualization-document';
import { upsertPanelItem, withVisualItems } from '../panel-items';
import { stepEventOf, workflowRunState } from '../workflow-run-state';
import {
  READINESS_REPORT_TOOLS,
  READINESS_TOOLS,
  type ReadinessAssessment,
  type ReadinessBridge,
  readinessPanelItem,
  readinessAnswerFallback,
  readinessReportIdOf,
  readinessReportOf,
  readinessReportRef,
} from '../readiness-bridge';
import {
  SYNTHETIC_DATA_TOOLS,
  syntheticPanelItemId,
} from '../synthetic-data-bridge';
import { runGapQueries } from '../gap-queries';
import {
  groundingNudge,
  statedRationale,
  synthesizeToolOnlyTurn,
  toolDataRecord,
  toolRecords,
} from '../turn-data';
import { evidenceOf } from '../query-evidence/query-evidence';
import { recordFindingSources } from '../finding-sources';
import type { ReadinessReport } from '../../data-readiness/engine/types';
import {
  EXPLORABLE_QUERIES_CONTEXT_KEY,
  explorableQueryOf,
  sessionExplorableQueries,
  withRefs,
  type ExplorableQuery,
} from '../query-evidence/explorable-queries';
import { earlyWork, memoisedBy } from './early-work';
import {
  QUERY_FACTS_CONTEXT_KEY,
  queryFactsKey,
  type QueryFactsMap,
} from '../query-evidence/query-facts';
import type { QueryFacts } from '../query-evidence/query-evidence.types';
import type {
  ChatMessage,
  CrossCheck,
  ReadinessReportRef,
  SessionDoc,
  SessionView,
  SessionVisualization,
  ToolDataRecord,
  VisualEvent,
  WorkflowPhase,
  WorkflowView,
} from '../entities/session.entity';
import {
  readinessProgressEvent,
  type RunStepEvent,
  type StreamEvent,
  type TurnResumeIo,
  type TurnSuspension,
} from './stream-events';
import {
  ASSISTANT_AGENT_KEY,
  SHOW_IN_PANEL_TOOL,
  UPDATE_WORKFLOW_TOOL,
  VISUAL_TOOLS,
  appendUserMessage,
  firstStringArgument,
  interpretationLine,
  knowledgeUsed,
  reasoningTrail,
  resultError,
  toolCallInput,
} from './turn-records';
import {
  analyseAttemptOf,
  analyseOutcomeOf,
  analyseQueriesOf,
  answeredTurnInput,
  attemptEarlierBlock,
  catalogStepId,
  clarificationOptionText,
  turnWorkflowOf,
  type TurnWorkflow,
} from './turn-workflow';
import type { TurnOptions } from './turn-options';
import type { SqlChecks } from './sql-checks';

/** The count columns of the rows behind a readiness finding (1.28.11). */
const FINDING_COUNT_COLUMNS = new Set(['matching_rows', 'occurrences']);

/**
 * What a turn runs on: the session service's dependencies and the session
 * reads and writes it owns (in-memory hosts included).
 */
export interface TurnEngineDeps {
  mastra: MastraService;
  llmService: LlmService;
  /** The session service's logger, so log lines keep their context. */
  logger: Logger;
  options: TurnOptions;
  sql: SqlChecks;
  get(id: string): Promise<SessionDoc>;
  updateDoc(id: string, patch: Partial<SessionDoc>): Promise<SessionDoc | null>;
  toView(session: SessionDoc): Promise<SessionView>;
  /** The workflow view of a stored session, for the `workflow` event. */
  workflowOf(session: SessionDoc): Promise<WorkflowView | undefined>;
  effectiveWorkflowFor(session: SessionDoc): WorkflowPhase[];
  /**
   * Careful mode's cross-check of the answer's SQL (agents.md 5.4); `signal`
   * is the turn's stop, for the verifier call and its statement.
   */
  crossCheckAnswer(
    session: SessionDoc,
    question: string,
    data: ToolDataRecord[],
    signal?: AbortSignal,
  ): Promise<CrossCheck | undefined>;
  /** The readiness tools' bridge, once installed (agents.md 3.13). */
  readinessBridge(): ReadinessBridge | undefined;
  /** A run's input image, from its host's workspace (agents.md 5.17). */
  readImage(
    sessionId: string,
    path: string,
  ): Promise<{ data: Buffer; mediaType: string }>;
  /** A saved dashboard, by its artifact's id (agents.md 5.18). */
  artifact(
    artifactId: string,
  ): Promise<{ name: string; blueprint: DashboardBlueprint }>;
  /** Save a run's dashboard, with its image, as an artifact (5.17). */
  saveArtifact(
    sessionId: string,
    blueprint: DashboardBlueprint,
    image: { data: Buffer; mediaType: string } | undefined,
  ): Promise<{ id: string; name: string }>;
  /**
   * A dashboard artifact's current version with its rows (agents.md 5.22,
   * the follow-up carry): what Clara changes. Throws when it is unknown.
   */
  dashboardVersion?(artifactId: string): Promise<DashboardVersionData>;
  /**
   * Save the dashboard Clara built (agents.md 5.22): a new artifact, or
   * the next version of `artifactId`; the run is its source.
   */
  saveDashboard?: (
    sessionId: string,
    input: Omit<NewDashboardVersion, 'source'> & { artifactId?: string },
  ) => Promise<DashboardRef>;
  /**
   * Build visual (agents.md 5.11): Ryan designs a visual from an answer not
   * stored yet; `at` is the time the answer message is stored with. With
   * an `instruction` (a follow-up that asks Build visual alone, 5.21),
   * `question` is the earlier run's and the instruction is the follow-up's.
   * `reference` is the run's image notes, the design to follow; absent
   * when the run has none.
   */
  buildVisual(
    sessionId: string,
    source: {
      question: string;
      answer: string;
      at: string;
      data: ToolDataRecord[];
      instruction?: string;
      reference?: string;
      /** The workflow's step model (agents.md 1.3), when it has one. */
      stepModel?: StepModel;
    },
    abortSignal?: AbortSignal,
  ): Promise<SessionVisualization>;
  /**
   * A new version of a visual of the session from the user's words (Build
   * visual's approval gate, workflows R44); `reference` is Zoe's notes on
   * the reference images they attached, absent without any.
   */
  reviseVisual(
    sessionId: string,
    visualId: string,
    change: { instruction: string; reference?: string; stepModel?: StepModel },
    abortSignal?: AbortSignal,
  ): Promise<SessionVisualization>;
  /** Store a drawn dashboard as a visual of the session (agents.md 5.17). */
  saveMock(
    sessionId: string,
    bundle: MockBundle,
    instruction: string,
  ): Promise<SessionVisualization>;
  /** Review a Website's browser work for one run (agents.md 5.19). */
  siteReview(io: SiteReviewRunIo): SiteReviewWork;
  /** Write a file of the session's workspace (Review a Website's findings). */
  writeFile(sessionId: string, path: string, data: string): Promise<void>;
}

/**
 * How a turn's workflow run (or one resume of it) ended: done (a success or
 * a stop), or suspended at a catalogue step on a clarifying question
 * (ADR-0043), with `resume` when the engine can go on with an answer and
 * `discard` to drop the run's snapshot.
 */
type TurnRunOutcome =
  | { status: 'done' }
  | {
      status: 'suspended';
      stepId: string;
      question: string;
      options: string[];
      review?: string;
      visualId?: string;
      resume?: (answer: string, images?: string[]) => Promise<TurnRunOutcome>;
      discard: () => Promise<void>;
    };

export class TurnEngine {
  constructor(private readonly deps: TurnEngineDeps) {}

  /**
   * The streamed turn itself, once the request reached the assistant. A
   * turn whose workflow run waits for the user (Clarify, or Analyse's
   * clarifying question; ADR-0043) answers a `TurnSuspension` when
   * `suspendable` (a run host's turn): the turn is not over, and its
   * `resume` goes on with the answer, reporting to the new request's
   * stream. Otherwise (a session's) the question ends the turn as a
   * clarification card, as it always has, and the workflow run is dropped.
   */
  async streamTurn(
    session: SessionDoc,
    trimmed: string,
    firstEmit: (event: StreamEvent) => void,
    firstAbortSignal: AbortSignal | undefined,
    activeVisualId: string | undefined,
    careful: boolean,
    firstOnStepEvent?: (event: RunStepEvent) => void,
    suspendable = false,
  ): Promise<TurnSuspension | undefined> {
    // Where the turn reports to: a resumed turn reports to its new request.
    let emit = firstEmit;
    let abortSignal = firstAbortSignal;
    let onStepEvent = firstOnStepEvent;
    const id = session.id;
    appendUserMessage(session, trimmed);
    // Persist the prompt before model startup. A user can stop while the
    // provider is still connecting, and that turn should survive a reload.
    await this.deps.updateDoc(id, { messages: session.messages });

    // The session's agent: the assistant, or the built-in agent it is bound
    // to (agents.md 5.1, ADR-0028).
    const agentKey = session.agentKey ?? ASSISTANT_AGENT_KEY;
    const isAssistant = agentKey === ASSISTANT_AGENT_KEY;
    const agent = this.deps.mastra.getAgent(agentKey);
    const input = await this.deps.options.agentInput(agent, session);
    // Own controller so a clarification can end the model turn without the
    // client having disconnected.
    const turn = new AbortController();
    const forwardAbort = () => turn.abort();
    // A listener added to an aborted signal never fires: a Stop that landed
    // while the question was stored or the input built aborts the turn now.
    if (abortSignal?.aborted) forwardAbort();
    else abortSignal?.addEventListener('abort', forwardAbort, { once: true });
    const options = await this.deps.options.agentOptions(
      session,
      trimmed,
      turn.signal,
      activeVisualId,
    );
    // A node chat's context block (agents.md 5.16), after the agent's own.
    if (session.contextBlock) {
      options.context.push({
        role: 'system' as const,
        content: session.contextBlock,
      });
    }
    // A live reference to this turn's captured records, handed to the visual
    // tools via requestContext so create_visual/update_visual called later in
    // the same turn can see SQL the turn already ran (drill-down queries a
    // tailored visual needs but that never touched the source answer). Fresh
    // RequestContext + array per call — no leakage across turns or sessions.
    const data: ToolDataRecord[] = [];
    // The visual tools and `show_in_panel` read them, for every agent (agents.md 4.2).
    options.requestContext.set(TURN_RECORDS_CONTEXT_KEY, data);
    // What the data tools knew about each call, written beside the result
    // (never into it) and matched to the records as they are captured; at
    // persist it becomes the answer's `evidence` (plan m1-25 1.25.1).
    const queryFacts: QueryFactsMap = new Map();
    const recordFacts = new Map<ToolDataRecord, QueryFacts>();
    options.requestContext.set(QUERY_FACTS_CONTEXT_KEY, queryFacts);
    const factsOf = (record: ToolDataRecord) =>
      recordFacts.get(record) ??
      queryFacts.get(queryFactsKey(record.tool, record.input));
    // What `explore_result` may page (agents.md 3.15, 4.2): the host's
    // context queries and the session's earlier answers' queries, then each
    // successful query of this turn as it is captured.
    const explorable: ExplorableQuery[] = sessionExplorableQueries(
      session.contextQueries,
      session.messages,
    );
    options.requestContext.set(EXPLORABLE_QUERIES_CONTEXT_KEY, explorable);
    let stream: Awaited<ReturnType<typeof agent.stream>> | undefined;

    let text = '';
    // Set inside `consume`, so typed without narrowing to the initial null.
    let clarification = null as ChatMessage['clarification'] | null;
    let visualEvent: VisualEvent | undefined;
    // The answer's time, fixed early when Build visual names it as the source.
    let answerAt: string | undefined;
    // The last report a readiness tool returned this turn (Data Readiness Agent).
    let readinessReport: ReadinessReportRef | undefined;
    const pendingCalls = new Map<string, Record<string, unknown>>();
    // Every tool name the model actually invoked this turn — the zero-SQL-
    // turn grounding guard below fires only when this stays empty.
    const calledTools = new Set<string>();
    // The model call's own failure: Mastra reports it as a chunk, not a throw.
    let streamError: unknown;
    // While v2's Analyse step streams: its text, kept out of the answer.
    let notes: string | undefined;
    // While v2's Analyse step streams: what a clarifying question stops (the
    // attempt's agent stream, not the turn: the step waits for the answer).
    let attemptStop: AbortController | undefined;
    // Where v2's current analysis attempt's records start: a resumed
    // attempt keeps the queries it ran before it asked.
    let attemptStart = 0;
    // Where each of v2's analysis attempts started, by attempt number: after
    // a retry, Build visual takes the records of the kept queries.
    const attemptStarts = new Map<number, number>();
    // The agent's clarifying questions this turn, each with the answer:
    // every later attempt goes on with them.
    const answers: AnsweredClarification[] = [];
    const workflow = turnWorkflowOf(session);
    // v2's answer is its Write answer step's only (agents.md 5.11).
    const v2 = workflow.engineId === ANSWER_BUSINESS_QUESTION_WORKFLOW_ID;
    // v2 runs its step agents on its own model and effort (agents.md 1.3)
    // when the saved model is served as a Claude model: its agents read it
    // from the context, and every step call and Analyse's turn send its
    // effort. Otherwise the saved model and effort, as every agent.
    // Answer a Business Question (orchestrated): Avery calls the same
    // agents as her tools, on the same model; she runs on Opus 5.5 high
    // (agents.md 5.22).
    const orchestrated = workflow.engineId === ORCHESTRATED_ANSWER_WORKFLOW_ID;
    const claude = servesClaude(await resolveAgentModelConfig());
    const stepModel =
      (v2 || orchestrated) && claude
        ? ANSWER_BUSINESS_QUESTION_MODEL
        : undefined;
    if (stepModel) {
      options.requestContext.set(STEP_MODEL_CONTEXT_KEY, stepModel);
      options.providerOptions = await turnProviderOptions(
        { reasoningEffort: stepModel.reasoningEffort },
        stepModel.model,
      );
    }
    const orchestratorModel =
      orchestrated && claude ? { ...ORCHESTRATOR_MODEL } : undefined;
    const orchestratorProviderOptions = orchestratorModel
      ? await turnProviderOptions(
          { reasoningEffort: orchestratorModel.reasoningEffort },
          orchestratorModel.model,
        )
      : (options.providerOptions as Record<string, unknown> | undefined);
    // What Avery's team produced: it outlives a wait for the user.
    const orchState = orchestratorState();
    // A follow-up that asks one agent (agents.md 5.21): only the Analyst
    // and Sarah answer as an agent turn; every other asked step's answer is
    // its model call's or the code's, which no synthesis replaces.
    const asked =
      workflow.engineId === ASK_AGENT_WORKFLOW_ID
        ? (session.ask?.step as AskableStepId | undefined)
        : undefined;
    // Answer a Business Question (orchestrated) writes its answer by code
    // until its orchestrator is built (agents.md 5.22).
    const codeAnswer =
      v2 ||
      workflow.engineId === ORCHESTRATED_ANSWER_WORKFLOW_ID ||
      (asked !== undefined && !AGENT_TURN_ASK_STEPS.includes(asked));
    // A query record of the turn: kept for the answer with its facts,
    // explorable from then on, and shown as its call's result.
    const captureRecord = (record: ToolDataRecord, callId?: string) => {
      data.push(record);
      const facts = callId ? queryFacts.get(callId) : undefined;
      if (facts) recordFacts.set(record, facts);
      const known = factsOf(record);
      const query = explorableQueryOf(record, `Q${explorable.length + 1}`, {
        datasourceId: known?.datasourceId,
        view: known?.view,
      });
      if (query) explorable.push(query);
      emit({
        type: 'tool-result',
        content: JSON.stringify({
          tool: record.tool,
          input: record.input,
          rowCount: record.rowCount,
          error: record.error,
          rationale: record.rationale,
        }),
      });
    };
    // The host's run of Clara's data query (agents.md 5.22): recorded once
    // her submit_dashboard has its result, so the activity pairs (the gap
    // queries' hold, 5.20).
    const heldQueries: (() => void)[] = [];
    const flushHeldQueries = () => {
      for (const replay of heldQueries.splice(0)) replay();
    };
    // A follow-up that asks Write answer or Build visual alone (agents.md
    // 5.21): the earlier answer's records join this turn's, each with the
    // facts its evidence kept, so the answer's sources keep their coverage
    // and view. Once per turn, however many times a step reads them.
    let carried: ToolDataRecord[] | undefined;
    const carryEarlierRecords = (): ToolDataRecord[] => {
      if (carried) return carried;
      const earlier = session.ask?.earlier;
      carried = earlier?.records ?? [];
      carried.forEach((record, index) => {
        data.push(record);
        const known = earlier?.evidence.find((entry) => entry.index === index);
        if (!known) return;
        recordFacts.set(record, {
          ...(known.datasourceId ? { datasourceId: known.datasourceId } : {}),
          ...(known.totalRows !== undefined
            ? { totalRows: known.totalRows }
            : {}),
          ...(known.rowLimit !== undefined ? { rowLimit: known.rowLimit } : {}),
          ...(known.view ? { view: known.view } : {}),
        });
      });
      return carried;
    };
    // Consume one agent stream (agents.md 5.1 step 3).
    const consume = async (
      agentStream: Awaited<ReturnType<typeof agent.stream>>,
    ): Promise<void> => {
      stream = agentStream;
      try {
        for await (const chunk of agentStream.fullStream) {
          const progress = readinessProgressEvent(chunk);
          if (progress) {
            emit(progress);
            continue;
          }
          if (chunk.type === 'error') {
            streamError ??= (chunk.payload as { error?: unknown }).error;
          } else if (chunk.type === 'reasoning-delta') {
            const delta = (chunk.payload as { text?: string }).text ?? '';
            if (delta) emit({ type: 'reasoning', content: delta });
          } else if (chunk.type === 'text-delta') {
            const delta = (chunk.payload as { text?: string }).text ?? '';
            if (delta && notes !== undefined) {
              // v2's Analyse step: its text is a note, not the answer.
              notes += delta;
            } else if (delta) {
              text += delta;
              emit({ type: 'text', content: delta });
            }
          } else if (chunk.type === 'tool-call') {
            const payload = chunk.payload as {
              toolCallId?: string;
              toolName?: string;
              args?: Record<string, unknown>;
            };
            if (payload.toolName) calledTools.add(payload.toolName);
            // A valid clarification ends the turn — the card renders in the UI
            // and the user's pick arrives as the next message. Abort so the
            // model does not keep analysing (and spending) behind the card. A
            // malformed one runs like any tool: the model gets the validation
            // error and asks again (agents.md 3.5, 5.1).
            const asked =
              payload.toolName === 'ask_clarification'
                ? parseClarification(payload.args)
                : undefined;
            if (asked) {
              clarification = asked;
              (attemptStop ?? turn).abort();
              break;
            }
            if (payload.toolCallId) {
              pendingCalls.set(payload.toolCallId, payload.args ?? {});
            }
            // The client shows the reason before the result arrives, so the
            // rationale travels with the call, not with its rows.
            const rationale = statedRationale(
              (payload.args ?? {})['rationale'],
            );
            // What the call is about, shown while it runs: the skill a skill
            // tool loads, else the call's first text argument (api.md 3.1).
            const input = toolCallInput(
              payload.toolName ?? 'tool',
              payload.args ?? {},
            );
            emit({
              type: 'tool',
              content: JSON.stringify({
                name: payload.toolName ?? 'tool',
                ...(rationale ? { rationale } : {}),
                ...(input ? { input } : {}),
              }),
            });
          } else if (chunk.type === 'tool-result') {
            const payload = chunk.payload as {
              toolCallId?: string;
              toolName?: string;
              result?: unknown;
              args?: Record<string, unknown>;
            };
            const toolName = payload.toolName ?? 'tool';
            const args =
              payload.args ??
              (payload.toolCallId
                ? pendingCalls.get(payload.toolCallId)
                : {}) ??
              {};
            if (VISUAL_TOOLS.has(toolName)) {
              const result = (payload.result ?? {}) as {
                visualId?: string;
                version?: number;
                title?: string;
                error?: string;
              };
              if (result.visualId && result.version) {
                visualEvent = {
                  visualId: result.visualId,
                  version: result.version,
                  title: result.title ?? 'Interactive visual',
                  action: toolName === 'create_visual' ? 'created' : 'updated',
                };
                emit({
                  type: 'visual-updated',
                  content: JSON.stringify(visualEvent),
                });
              }
              emit({
                type: 'tool-result',
                content: JSON.stringify({
                  tool: toolName,
                  input:
                    typeof args['instruction'] === 'string'
                      ? args['instruction']
                      : undefined,
                  error: result.error,
                }),
              });
              continue;
            }
            if (toolName === SHOW_IN_PANEL_TOOL) {
              const result = (payload.result ?? {}) as {
                id?: string;
                kind?: string;
                title?: string;
                error?: string;
              };
              if (!result.error && result.id) {
                await this.emitPanelItem(id, result.id, emit);
              }
              emit({
                type: 'tool-result',
                content: JSON.stringify({
                  tool: toolName,
                  input:
                    result.title ??
                    (typeof args['title'] === 'string'
                      ? args['title']
                      : undefined),
                  error: result.error,
                }),
              });
              continue;
            }
            if (toolName === UPDATE_WORKFLOW_TOOL) {
              const error = resultError(payload.result);
              if (!error) await this.emitWorkflow(id, emit);
              emit({
                type: 'tool-result',
                content: JSON.stringify({
                  tool: toolName,
                  input:
                    typeof args['note'] === 'string'
                      ? args['note'].slice(0, 80)
                      : undefined,
                  error,
                }),
              });
              continue;
            }
            if (!isAssistant && READINESS_TOOLS.has(toolName)) {
              // Each readiness tool shows its step; a report shows the
              // scorecard first (api.md 3.1, data-readiness R5).
              const error = resultError(payload.result);
              if (!error && READINESS_REPORT_TOOLS.has(toolName)) {
                const shown = await this.showReadinessReport(
                  id,
                  payload.result,
                  emit,
                );
                if (shown) readinessReport = shown;
              }
              emit({
                type: 'tool-result',
                content: JSON.stringify({
                  tool: toolName,
                  input: firstStringArgument(args),
                  error,
                }),
              });
              continue;
            }
            if (!isAssistant && SYNTHETIC_DATA_TOOLS.has(toolName)) {
              // Each synthetic-data tool shows its step; a script opens in
              // the panel as `show_in_panel` does (agents.md 3.14).
              const error = resultError(payload.result);
              const itemId = syntheticPanelItemId(payload.result);
              if (!error && itemId) await this.emitPanelItem(id, itemId, emit);
              emit({
                type: 'tool-result',
                content: JSON.stringify({
                  tool: toolName,
                  input: firstStringArgument(args),
                  error,
                }),
              });
              continue;
            }
            const record = toolDataRecord(toolName, args, payload.result);
            if (record) captureRecord(record, payload.toolCallId);
            else {
              // Every call ends with its result, so the client never leaves
              // a lookup (describe_entity, skill…) spinning (api.md 3.1).
              const error = resultError(payload.result);
              emit({
                type: 'tool-result',
                content: JSON.stringify({
                  tool: toolName,
                  ...(error ? { error } : {}),
                }),
              });
            }
            // Clara's submit ran her data query: it follows the result.
            if (toolName === SUBMIT_DASHBOARD_TOOL) flushHeldQueries();
          }
        }
      } catch (error) {
        if (!turn.signal.aborted && !attemptStop?.signal.aborted) throw error;
      }
    };
    // Work a step starts and a later step takes (agents.md 5.13, 5.20):
    // Zoe's notes and the rows behind findings in Assess Data Readiness,
    // the lineage checks in Consumption Gap Analysis. Settled when the run
    // ends, fails or is stopped, before the answer is persisted.
    const early = earlyWork(turn.signal);
    // Whether Resolve dataset started Zoe's notes (Read images' condition).
    let readingImages = false;
    // Where the rows behind findings go: the answer's records and the
    // explorable queries as Save report left them, ahead of the agent's.
    let findingSlot: { data: number; explorable: number } | undefined;
    // How many lineage checks Load layer catalogs started (Infer lineage's
    // progress lines).
    let lineageCount = 0;
    // Assess Data Readiness's assessment, once Resolve dataset started it.
    let assessment: ReadinessAssessment | undefined;
    // Its stored report, once Save report stored it (roadmap 1.28.11).
    let savedReport: ReadinessReport | undefined;
    // What get_readiness_report hands the model for it: Explain report's
    // block carries it (data-readiness R4, agents.md 5.13).
    let savedSummary: unknown;
    const startedAssessment = (): ReadinessAssessment => {
      if (!assessment) throw new Error('No assessment has been started');
      return assessment;
    };
    // Dashboard Image to Artifact's image, once Load image read it (agents.md 5.17).
    let dashboardImage: { data: Buffer; mediaType: string } | undefined;
    const loadedImage = async (path: string) => {
      dashboardImage ??= await this.deps.readImage(id, path);
      return dashboardImage;
    };
    // Review a Website's browser work, once a step asks for it (agents.md 5.19).
    let siteWork: SiteReviewWork | undefined;
    // The answer carries a stored dashboard, as a turn's visual does.
    const showVisual = (metadata: SessionVisualization) => {
      visualEvent = {
        visualId: metadata.id,
        version: 1,
        title: metadata.title,
        action: 'created',
      };
      emit({ type: 'visual-updated', content: JSON.stringify(visualEvent) });
    };
    let ran: TurnRunOutcome;
    try {
      // Every streamed turn is one run of the session's workflow (agents.md
      // 5.1, ADR-0040). Its agent step streams the agent through `consume`:
      // v2's Analyse step (5.11, ADR-0034) or a one-step workflow's Answer.
      // The model error a step reports, in the chat stream's words.
      // A model timeout (Iris's included) is thrown as it is (workflows R43).
      const stepError = async (error: unknown) =>
        error instanceof ModelTimeoutError
          ? error
          : chatTurnError(error, () => this.deps.llmService.getView());
      const stepModelBase = {
        abortSignal: turn.signal,
        providerOptions: options.providerOptions as
          Record<string, unknown> | undefined,
        requestContext: options.requestContext,
      };
      // A step agent of its own runs without memory; its exchange is
      // recorded in its thread on this host (agents.md 5.14), and a
      // failure to record never fails the step.
      // A retry of its call (workflows R43) is a reasoning line of the step.
      const stepModelOf = (stepAgentKey: string) => ({
        ...stepModelBase,
        onRetry: (line: string) =>
          emit({ type: 'reasoning', content: `${line}\n` }),
        onExchange: async (exchange: AgentExchange) => {
          try {
            await this.deps.mastra.recordAgentExchange(
              session.id,
              stepAgentKey,
              exchange,
            );
          } catch (error) {
            this.deps.logger.warn(
              `Could not record the ${stepAgentKey} exchange of ${session.id}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        },
      });
      // Plan has no memory: on a host that continues an earlier run's
      // threads, `input` is only the latest messages, so Plan reads the
      // whole conversation as text, as it did before the threads were
      // copied (agents.md 5.14).
      const planInput = session.continuesThreads
        ? this.deps.options.transcriptInput(session)
        : input;
      // Read images (agents.md 2.15): the run's stored images, loaded from
      // its workspace in order, described by Zoe in one model call recorded
      // in her thread, stopped with `signal` (the turn's, or an early job's
      // own). A model error fails the step with its own message.
      const readImagesOn = async (
        {
          question,
          images,
          ...interactive
        }: {
          question: string;
          images: string[];
          canAsk?: boolean;
          answered?: { question: string; answer: string };
          revision?: { previous: string; note: string };
        },
        signal: AbortSignal,
      ) => {
        const loaded: StepImage[] = [];
        for (const path of images) {
          const { data, mediaType } = await this.deps.readImage(id, path);
          loaded.push({ data, mediaType });
        }
        try {
          // An interactive run's extras (workflows R44), only when given.
          const read = await this.deps.mastra.readImages(
            { question, images: loaded, ...interactive },
            { ...stepModelOf(IMAGE_READER_AGENT_KEY), abortSignal: signal },
          );
          return { ...read, stopped: read.stopped || signal.aborted };
        } catch (error) {
          throw await stepError(error);
        }
      };
      // Resolve layers and Load layer catalogs both read the datasets'
      // layers: fetched once per run (agents.md 5.20).
      const datasetLayers = memoisedBy(
        async ({ datasets }: { datasets: string[] }) =>
          (await getDatasetToolServices().getDatasets(datasets)).map(
            (dataset) => ({
              dataset: dataset.name,
              datasourceId: dataset.datasourceId ?? null,
              datasourceKind: dataset.datasourceKind ?? null,
              schemas: (dataset.schemas ?? []).map((note) => ({
                ...note,
              })),
              entities: dataset.tables.map((key) => {
                const known = dataset.entities?.find(
                  (entity) => entity.key === key,
                )?.columns;
                return {
                  key,
                  columns: known
                    ? known.map((column) => ({
                        name: column.name,
                        type: column.type ?? '',
                      }))
                    : null,
                };
              }),
            }),
          ),
        ({ datasets }) => JSON.stringify(datasets),
      );
      // Infer lineage and Probe evidence (ADR-0051): each statement on the
      // guarded read-only path with `signal`, four at a time, recorded in
      // query order through `hold` (at once, or held for the step that
      // takes them) as a `run_readonly_sql` source, as Rows behind findings
      // does (agent-answers R67-R78). A failed one is a result.
      const gapQueriesOn = (
        queries: GapQuery[],
        signal: AbortSignal,
        hold: (replay: () => void) => void,
      ) =>
        runGapQueries({
          queries,
          run: (datasourceId, sql, limit, sqlOptions) =>
            this.deps.sql.runBuiltSql(datasourceId, sql, limit, sqlOptions),
          signal,
          record: (args, result, facts) =>
            hold(() => {
              emit({
                type: 'tool',
                content: JSON.stringify({
                  name: 'run_readonly_sql',
                  rationale: args.rationale,
                  input: toolCallInput('run_readonly_sql', args),
                }),
              });
              const callId = `gap-query-${randomUUID()}`;
              queryFacts.set(callId, facts);
              const record = toolDataRecord('run_readonly_sql', args, result);
              if (record) captureRecord(record, callId);
            }),
        });
      ran = await this.runTurnWorkflow(
        session,
        workflow,
        trimmed,
        // The current request's stream: a resumed turn reports to its own.
        (event) => emit(event),
        {
          // A run of v2 whose input ticked Approve each step is interactive
          // (workflows R44): its step agents may ask first, and each outcome
          // waits for the user's approval. A past chat's turn never is: it
          // cannot wait.
          ...(v2 && suspendable && session.approveSteps === true
            ? { interactive: true }
            : {}),
          // v2's steps (agents.md 5.11): Plan and Write answer call the
          // agent's model without tools; Analyse streams the agent itself.
          plan: async ({
            question,
            catalogBlock,
            clarification: answered,
            imageNotes,
            revision,
            brief,
          }) => {
            try {
              // After Clarify, Plan plans with its question and the answer;
              // with reference images, with Zoe's notes (agents.md 2.15).
              const planned = await this.deps.mastra.planAnalysis(
                withImageNotes({
                  messages: planInput,
                  question,
                  catalogBlock,
                  ...(answered ? { answered } : {}),
                  ...(revision ? { revision } : {}),
                  // Avery's request, in the orchestrated workflow only.
                  ...(brief ? { brief } : {}),
                  imageNotes,
                }),
                stepModelOf(ANALYSIS_PLANNER_AGENT_KEY),
              );
              return {
                plan: planned.plan,
                stopped: planned.stopped || turn.signal.aborted,
              };
            } catch (error) {
              throw await stepError(error);
            }
          },
          analyse: async ({
            catalogBlock,
            planBlock,
            earlierBlock,
            earlier: earlierAttempt,
            attempt,
            answered,
            imageNotes,
            visualFollows,
          }) => {
            // A resumed attempt keeps the records it made before it asked,
            // and is shown their queries after the earlier attempt's, in
            // one block under one cap (agents.md 5.11).
            if (answered) answers.push(answered);
            else attemptStart = data.length;
            attemptStarts.set(attempt, attemptStart);
            const earlier = answered
              ? attemptEarlierBlock(earlierAttempt, data.slice(attemptStart))
              : earlierBlock;
            // A retry, and an attempt after the user answered the agent,
            // run without the memory thread, so the question is not stored
            // twice; the plan block and the answered questions carry what
            // they need. A retry runs with its own, smaller step budget.
            const attemptOptions: typeof options = { ...options };
            if (attempt > 1 || answers.length) {
              delete (attemptOptions as { memory?: unknown }).memory;
            }
            if (attempt > 1) attemptOptions.maxSteps = ANALYSE_RETRY_MAX_STEPS;
            // A retry's failure that is not a Stop (a model error, the idle
            // deadline) keeps attempt 1 (agents.md 5.11): the step ends with
            // `retryError`, never failed. Attempt 1's still fails the step.
            let retryFailure: unknown;
            const failRetry = (error: unknown): void => {
              if (attempt > 1 && !turn.signal.aborted) retryFailure ??= error;
              else throw error;
            };
            // A clarifying question stops this attempt's stream only.
            const stop = new AbortController();
            const stopAttempt = () => stop.abort();
            turn.signal.addEventListener('abort', stopAttempt, { once: true });
            attemptStop = stop;
            notes = '';
            let attemptNotes = '';
            // No chunk for five minutes while no tool executes fails the
            // step (workflows R43); the attempt's stop is never a timeout.
            const idle = streamIdleWatch(stop.signal);
            try {
              await consume(
                idle.watch(
                  await agent.stream(
                    answers.length
                      ? (answeredTurnInput(input, trimmed, answers) as never)
                      : input,
                    {
                      ...attemptOptions,
                      abortSignal: idle.signal,
                      // The catalog and plan blocks, the earlier-queries
                      // block on a retry or a resume, then Zoe's notes
                      // only when the run has images (agents.md 5.11), and
                      // last the line saying a visual follows, only when
                      // one does.
                      context: [
                        ...options.context,
                        ...analyseSystemBlocks({
                          catalogBlock,
                          planBlock,
                          earlierBlock: earlier,
                          imageNotes,
                          visualFollows,
                        }).map((content) => ({
                          role: 'system' as const,
                          content,
                        })),
                      ],
                    },
                  ),
                ),
              );
            } catch (error) {
              // What the timeout's abort threw is the timeout, below.
              if (!idle.timedOut()) failRetry(error);
            } finally {
              idle.dispose();
              attemptNotes = notes ?? '';
              notes = undefined;
              attemptStop = undefined;
              turn.signal.removeEventListener('abort', stopAttempt);
            }
            try {
              idle.check('Analyse');
            } catch (error) {
              failRetry(error);
            }
            // The agent asked the user: the step waits for the answer.
            const asked = turn.signal.aborted ? null : clarification;
            clarification = null;
            // Stopping the stream for the question is no model error.
            if (asked) {
              streamError = undefined;
              retryFailure = undefined;
            }
            // Any model error fails the step (agents.md 5.11), but a
            // retry's: the turn-scoped error is cleared, its records kept.
            if (streamError !== undefined && !turn.signal.aborted) {
              failRetry(await stepError(streamError));
            }
            if (retryFailure !== undefined) {
              streamError = undefined;
              return {
                ...analyseAttemptOf(
                  data.slice(attemptStart),
                  false,
                  attemptNotes,
                ),
                retryError:
                  retryFailure instanceof Error
                    ? retryFailure.message
                    : JSON.stringify(retryFailure),
              };
            }
            return {
              ...analyseAttemptOf(
                data.slice(attemptStart),
                turn.signal.aborted,
                attemptNotes,
              ),
              ...(asked
                ? {
                    clarification: {
                      question: asked.question,
                      options: asked.options.map(clarificationOptionText),
                    },
                  }
                : {}),
            };
          },
          // Build visual (agents.md 5.11, workflows R41): Ryan designs an
          // interactive visual from the written answer and the rows the
          // turn's queries returned. The answer message is stored later
          // with the same time, so the visual's later actions find it. A
          // visual that cannot be built is reported, never a failed run.
          // Asked alone (agents.md 5.21), Ryan designs from the earlier
          // question and answer, the follow-up as his instruction.
          // Zoe's notes, when the run has some, are Ryan's reference.
          // After a retry Ryan is given only the kept queries' records, in
          // the kept set's order (keptRecords); the answer's sources stay
          // every record of both attempts.
          buildVisual: async ({
            question,
            answer,
            queries,
            instruction,
            imageNotes,
          }: {
            question: string;
            answer: string;
            queries?: readonly AnalyseQuery[];
            instruction?: string;
            imageNotes?: string;
          }) => {
            const stop = () => ({ visual: {}, stopped: true });
            if (turn.signal.aborted) return stop();
            answerAt ??= new Date().toISOString();
            // A kept query is its attempt's n-th `run_readonly_sql` record,
            // as `analyseAttemptOf` built it from that attempt's records.
            // No retry, or a set no merge keeps: every record, as before.
            const keptRecords = (
              kept: readonly AnalyseQuery[] | undefined,
            ): ToolDataRecord[] => {
              const first = attemptStarts.get(1);
              const second = attemptStarts.get(2);
              if (!kept || first === undefined || second === undefined) {
                return data;
              }
              const attempts = [
                data.slice(first, second),
                data.slice(second),
              ].map((records) =>
                records.filter((record) => record.tool === 'run_readonly_sql'),
              );
              const origins = keptQueryOrigins(
                attempts.map((records) => analyseQueriesOf(records)),
                kept,
              );
              return origins
                ? origins.map(
                    ({ attempt, index }) => attempts[attempt - 1][index],
                  )
                : data;
            };
            try {
              // The turn's stop reaches the designer: a call in flight is
              // aborted and no further attempt starts (the catch below).
              const metadata = await this.deps.buildVisual(
                id,
                {
                  question,
                  answer,
                  at: answerAt,
                  data: keptRecords(queries),
                  ...(instruction !== undefined ? { instruction } : {}),
                  ...(imageNotes?.trim() ? { reference: imageNotes } : {}),
                  // Ryan on v2's own model and effort (agents.md 1.3).
                  ...(stepModel ? { stepModel } : {}),
                },
                turn.signal,
              );
              // Stored before the stop: the step still names it, so the run
              // logs it and it stays one click away.
              return {
                visual: { visualId: metadata.id, title: metadata.title },
                stopped: turn.signal.aborted,
              };
            } catch (error) {
              if (turn.signal.aborted) return stop();
              return {
                visual: {
                  error: error instanceof Error ? error.message : String(error),
                },
                stopped: false,
              };
            }
          },
          // A change asked on Ryan's approval gate (workflows R44): Zoe reads
          // any new reference images, then Ryan makes a new version of the
          // visual from the user's words and her notes. Never a failed run.
          reviseVisual: async ({ visualId, instruction, images }) => {
            const stop = () => ({ visual: {}, stopped: true });
            if (turn.signal.aborted) return stop();
            try {
              const notes = images?.length
                ? (
                    await readImagesOn(
                      { question: instruction, images },
                      turn.signal,
                    )
                  ).imageNotes
                : '';
              if (turn.signal.aborted) return stop();
              const metadata = await this.deps.reviseVisual(
                id,
                visualId,
                {
                  instruction,
                  ...(notes.trim() ? { reference: notes } : {}),
                  ...(stepModel ? { stepModel } : {}),
                },
                turn.signal,
              );
              return {
                visual: { visualId: metadata.id, title: metadata.title },
                stopped: turn.signal.aborted,
              };
            } catch (error) {
              if (turn.signal.aborted) return stop();
              return {
                visual: {
                  error: error instanceof Error ? error.message : String(error),
                },
                stopped: false,
              };
            }
          },
          // Clara's build (agents.md 2.22, 5.22): her turn inside this
          // turn's stream, through the same consumer as Michael's, without
          // memory and with her text kept out of the answer. Her
          // submit_dashboard reaches the runtime below: the host runs her
          // data query (up to 5,000 rows, the turn's stop), checks it and
          // keeps the last accepted submission, which is saved once her
          // stream ends. Never a failed run: a problem is told to Avery.
          buildDashboard: async ({
            question,
            brief,
            catalogBlock,
            current,
            earlierBlock,
          }) => {
            if (turn.signal.aborted) return { reply: '', stopped: true };
            const save = this.deps.saveDashboard;
            if (!save) {
              return {
                reply: '',
                error: 'Dashboards are not available.',
                stopped: false,
              };
            }
            let accepted:
              | {
                  draft: DashboardDraft;
                  query: DashboardQuery;
                  columns: string[];
                  rows: DashboardRow[];
                }
              | undefined;
            // The host's run, recorded as a `run_readonly_sql` source with
            // its facts, held until submit_dashboard's result (5.20's hold).
            const hold = (
              args: { sql: string; rationale: string },
              result: unknown,
              facts: QueryFacts,
            ) =>
              heldQueries.push(() => {
                emit({
                  type: 'tool',
                  content: JSON.stringify({
                    name: 'run_readonly_sql',
                    ...(statedRationale(args.rationale)
                      ? { rationale: statedRationale(args.rationale) }
                      : {}),
                    input: toolCallInput('run_readonly_sql', args),
                  }),
                });
                const callId = `dashboard-query-${randomUUID()}`;
                queryFacts.set(callId, facts);
                const record = toolDataRecord('run_readonly_sql', args, result);
                if (record) captureRecord(record, callId);
              });
            const submitter: DashboardToolsRuntime = {
              submit: async ({
                dashboard: draft,
                sql,
                datasourceId,
                rationale,
              }) => {
                const args = { sql, rationale };
                const facts: QueryFacts = {
                  datasourceId,
                  rowLimit: DASHBOARD_ROWS_CAP,
                };
                let ran: Awaited<ReturnType<SqlChecks['runSqlWithRepair']>>;
                try {
                  ran = await this.deps.sql.runSqlWithRepair(
                    datasourceId,
                    sql,
                    DASHBOARD_ROWS_CAP,
                    session.datasets,
                    { signal: turn.signal, maxRows: DASHBOARD_ROWS_CAP },
                  );
                } catch (error) {
                  // A query the stop cut short is no failed query.
                  if (turn.signal.aborted) throw error;
                  const message =
                    error instanceof Error ? error.message : String(error);
                  hold(args, { error: message }, facts);
                  return {
                    accepted: false,
                    error: `The query failed: ${message}`,
                  };
                }
                const { totalRows, ...result } = ran;
                hold(args, result, {
                  ...facts,
                  ...(typeof totalRows === 'number' ? { totalRows } : {}),
                });
                if (ran.truncated) {
                  return {
                    accepted: false,
                    error: `More than ${DASHBOARD_ROWS_CAP.toLocaleString('en-US')} rows: group the query to the grain the widgets need`,
                  };
                }
                if (!ran.rows.length) {
                  return {
                    accepted: false,
                    error:
                      'The query returned no rows: check its filters, then submit again.',
                  };
                }
                const unbound = dashboardBindingErrors(draft, ran.columns);
                if (unbound.length) {
                  return { accepted: false, error: unbound.join('\n') };
                }
                const rows = prepareDashboardRows(ran.rows, draft);
                if (JSON.stringify(rows).length > DASHBOARD_DATA_CHAR_CAP) {
                  return {
                    accepted: false,
                    error: `The rows are more than ${DASHBOARD_DATA_CHAR_CAP.toLocaleString('en-US')} characters: group the query further or drop the columns no widget reads.`,
                  };
                }
                const columns = draft.columns.map((column) => column.name);
                // The last accepted submission is the one saved.
                accepted = {
                  draft,
                  query: {
                    sql: ran.correctedSql ?? sql,
                    datasourceId,
                    ...(rationale.trim()
                      ? { rationale: rationale.trim() }
                      : {}),
                  },
                  columns,
                  rows,
                };
                return { accepted: true, rowCount: rows.length, columns };
              },
            };
            options.requestContext.set(DASHBOARD_TOOLS_RUNTIME_KEY, submitter);
            // Her own stop: the turn's, or five idle minutes (workflows R43).
            const idle = streamIdleWatch(turn.signal);
            const claraOptions: typeof options = { ...options };
            delete (claraOptions as { memory?: unknown }).memory;
            let failure: unknown;
            let reply = '';
            notes = '';
            try {
              await consume(
                idle.watch(
                  await this.deps.mastra
                    .getAgent(BI_ANALYST_AGENT_KEY)
                    .stream([{ role: 'user', content: question }] as never, {
                      ...claraOptions,
                      maxSteps: BI_ANALYST_MAX_STEPS,
                      abortSignal: idle.signal,
                      // The catalog, then Avery's brief with the dashboard
                      // to change and the queries behind the last answer.
                      context: [
                        ...options.context,
                        ...[
                          catalogBlock,
                          [
                            `Brief from Avery, the Chief of Staff: ${brief}`,
                            ...(current
                              ? ['', currentDashboardBlock(current)]
                              : []),
                            ...(earlierBlock ? ['', earlierBlock] : []),
                          ].join('\n'),
                        ]
                          .filter((content) => content.trim())
                          .map((content) => ({
                            role: 'system' as const,
                            content,
                          })),
                      ],
                    }),
                ),
              );
            } catch (error) {
              if (!idle.timedOut()) failure = error;
            } finally {
              idle.dispose();
              reply = (notes ?? '').trim();
              notes = undefined;
              flushHeldQueries();
            }
            try {
              idle.check('Build dashboard');
            } catch (error) {
              failure ??= error;
            }
            // Her model error is told to Avery, never the turn's.
            if (streamError !== undefined) {
              failure ??= streamError;
              streamError = undefined;
            }
            if (turn.signal.aborted) return { reply, stopped: true };
            if (!accepted) {
              return {
                reply,
                error:
                  failure !== undefined
                    ? runErrorMessage(failure)
                    : 'she submitted no dashboard the run could accept.',
                stopped: false,
              };
            }
            const blueprint = blueprintFromDraft(accepted.draft, accepted.rows);
            try {
              const ref = await save(id, {
                ...(current ? { artifactId: current.artifactId } : {}),
                blueprint,
                query: accepted.query,
                columns: accepted.columns,
                rows: accepted.rows,
                instruction: brief,
              });
              const saved: CurrentDashboard = {
                artifactId: ref.artifactId,
                version: ref.version,
                title: ref.title,
                blueprint,
                query: accepted.query,
                columns: accepted.columns,
                rowCount: ref.rowCount,
                widgetCount: ref.widgetCount,
                filterCount: ref.filterCount,
              };
              return { dashboard: ref, saved, reply, stopped: false };
            } catch (error) {
              return {
                reply,
                error: `the dashboard could not be saved: ${error instanceof Error ? error.message : String(error)}`,
                stopped: false,
              };
            }
          },
          deliverAnswer: (answer) => {
            text = answer;
            emit({ type: 'text', content: answer });
            return Promise.resolve();
          },
          // Avery's turn (agents.md 5.22): the team as her tools; her answer
          // is delivered once she is done (only she talks to the user).
          orchestrate: async (input, team: OrchestratorTeam) => {
            // The conversation's dashboard (the follow-up carry, 5.22): its
            // current version, or none when it is gone or holds no query.
            const currentDashboard = await this.currentDashboardOf(session);
            const done = await runOrchestratorTurn(
              {
                getAgent: (key) => this.deps.mastra.getAgent(key),
                team,
                state: orchState,
                emit: (event) => emit(event),
                signal: turn.signal,
                datasets: session.datasets,
                images: [...(session.inputImages ?? [])],
                buildsVisual: session.buildVisual === true,
                // The dashboard gate (2.21): the message asks for one, or
                // the conversation has one.
                buildsDashboard:
                  asksForDashboard(trimmed) || currentDashboard !== undefined,
                ...(currentDashboard ? { currentDashboard } : {}),
                // The conversation so far (workflows R45): the host's
                // transcript before this message.
                history: session.messages
                  .slice(0, -1)
                  .filter(
                    (message) =>
                      (message.role === 'user' ||
                        message.role === 'assistant') &&
                      typeof message.content === 'string' &&
                      message.content.trim() !== '',
                  )
                  .map((message) => ({
                    role: message.role,
                    content: message.content,
                  })),
                // The last answer's queries, for Michael on a follow-up.
                ...(session.contextQueries?.length
                  ? { earlierQueries: session.contextQueries }
                  : {}),
                // Her team in this workflow (Avery + Michael: Michael alone).
                tools: orchestratorTeamOf(workflow.id).tools,
                ...(orchestratorModel ? { orchestratorModel } : {}),
                ...(orchestratorProviderOptions
                  ? { providerOptions: orchestratorProviderOptions }
                  : {}),
              },
              input,
            );
            if (!done.clarification && done.answer) {
              text = done.answer;
              emit({ type: 'text', content: done.answer });
            }
            return done;
          },
          // A follow-up that asks Write answer alone (agents.md 5.21): the
          // earlier answer's records come into this answer with their
          // evidence, so its sources stay one click from its figures; the
          // checks are those records' own, plus the earlier quality ones.
          earlierAnswer: (): EarlierAnswerInput => {
            const earlier = session.ask?.earlier;
            const records = carryEarlierRecords();
            const stored = planSchema.safeParse(earlier?.plan);
            const plan = stored.success
              ? stored.data
              : planOf(undefined, trimmed);
            const queries = analyseQueriesOf(records);
            const { findings } = validateAttempt({
              plan,
              calls: analyseOutcomeOf(records, false).calls,
              queries,
            });
            return {
              plan,
              queries,
              findings: [...findings, ...(earlier?.qualityFindings ?? [])],
              imageNotes: earlier?.imageNotes ?? '',
            };
          },
          // A follow-up that asks Build visual alone (agents.md 5.21): the
          // earlier answer's records come into this answer as for Write
          // answer, and Ryan charts their rows.
          earlierVisual: (): EarlierVisualInput => {
            const earlier = session.ask?.earlier;
            return {
              question: earlier?.question || trimmed,
              answer: earlier?.answer ?? '',
              queries: analyseQueriesOf(carryEarlierRecords()),
              imageNotes: earlier?.imageNotes ?? '',
            };
          },
          writeAnswer: async ({ quiet, ...written }) => {
            try {
              // Zoe's notes only when the run has images (agents.md 5.11).
              // An answer that waits on its approval gate is not streamed:
              // the step delivers it once approved (workflows R44).
              const result = await this.deps.mastra.writeAnswer(
                withImageNotes(written),
                {
                  ...stepModelOf(ANSWER_WRITER_AGENT_KEY),
                  ...(quiet
                    ? {}
                    : {
                        onText: (delta: string) => {
                          text += delta;
                          emit({ type: 'text', content: delta });
                        },
                      }),
                },
              );
              // The stored answer is the step's whole answer.
              if (result.answer.answer) text = result.answer.answer;
              return {
                answer: result.answer,
                stopped: result.stopped || turn.signal.aborted,
                ...(result.clarification
                  ? { clarification: result.clarification }
                  : {}),
              };
            } catch (error) {
              throw await stepError(error);
            }
          },
          answer: async () => {
            // The idle deadline (workflows R43): a Stop is never a timeout.
            const idle = streamIdleWatch(turn.signal);
            try {
              await consume(
                idle.watch(
                  await agent.stream(input, {
                    ...options,
                    abortSignal: idle.signal,
                  }),
                ),
              );
            } catch (error) {
              if (!idle.timedOut()) throw error;
            } finally {
              idle.dispose();
            }
            idle.check('Answer');
            if (streamError !== undefined && !turn.signal.aborted) {
              // A custom endpoint's failure fails the turn in R50's words
              // (R51); any other keeps today's handling.
              const failure = await chatTurnError(streamError, () =>
                this.deps.llmService.getView(),
              );
              if (failure !== streamError) throw failure;
            }
            return analyseOutcomeOf(data, turn.signal.aborted);
          },
          // Assess Data Readiness (agents.md 5.13): the code steps run one
          // assessment of the run's dataset phase by phase; Explain report
          // streams the agent over the stored report.
          resolve: async ({ dataset }) => {
            const bridge = this.deps.readinessBridge();
            if (!bridge) throw new Error('Data readiness is not available');
            assessment = await bridge.startAssessment({
              sessionId: id,
              datasetName: dataset,
            });
            return {
              dataset: assessment.dataset,
              datasourceName: assessment.datasourceName,
              datasourceKind: assessment.datasourceKind,
              tableCount: assessment.tableCount,
            };
          },
          // Its progress goes out as the readiness tool's does, a
          // `tool-progress` event (never to the model, never stored), so
          // a long profile is not taken for a stalled run (workflows spec).
          profile: async () => {
            const started = startedAssessment();
            let profiling = true;
            try {
              return {
                ...(await started.profile({
                  signal: turn.signal,
                  onProgress: (progress) => {
                    if (!profiling || turn.signal.aborted) return;
                    const event = readinessProgressEvent({
                      type: 'data-readiness-progress',
                      data: progress,
                    });
                    if (event) emit(event);
                  },
                })),
                stopped: false,
              };
            } catch (error) {
              if (!turn.signal.aborted) throw error;
              return {
                entityCount: 0,
                relationshipCount: 0,
                notProfiledCount: 0,
                stopped: true,
              };
            } finally {
              // Nothing is reported once the step ended.
              profiling = false;
            }
          },
          score: () => {
            const summary = startedAssessment().score();
            return {
              overallScore: summary.overallScore,
              maturity: summary.maturity,
              findingCount: summary.findingCount,
              dimensionScores: summary.dimensionScores.map((d) => ({
                dimension: d.dimension,
                score: d.score,
                assessed: d.assessed,
                findingCount: d.findingCount,
              })),
            };
          },
          save: async () => {
            const saved = await startedAssessment().save();
            savedReport = saved.report;
            savedSummary = readinessModelOutput(saved);
            // The answer carries the report: its card, and the scorecard
            // (data-readiness R5).
            const shown = await this.showReadinessReport(id, saved, emit);
            if (shown) readinessReport = shown;
            return { reportId: saved.report.id };
          },
          // Rows behind findings (roadmap 1.28.11; data-readiness R34): the
          // rows behind each top finding become the answer's first sources,
          // each shown as a SQL call and its result. Nothing reaches the
          // agent's prompt: the records only add sources to the answer.
          // Save report starts the queries, which run while the agent
          // explains the report; their records are held until Rows behind
          // findings takes them (agents.md 5.13).
          startFindingRows: () => {
            if (!savedReport) throw new Error('The report has not been saved');
            const report = savedReport;
            findingSlot = { data: data.length, explorable: explorable.length };
            early.start('finding-rows', (signal, hold) =>
              recordFindingSources({
                report,
                // Each statement gets the turn's stop (datasources R38).
                run: (datasourceId, sql, limit, sqlOptions) =>
                  this.deps.sql.runBuiltSql(
                    datasourceId,
                    sql,
                    limit,
                    sqlOptions,
                  ),
                signal,
                record: (args, result, facts) =>
                  hold(() => {
                    emit({
                      type: 'tool',
                      content: JSON.stringify({
                        name: 'run_readonly_sql',
                        rationale: args.rationale,
                        input: toolCallInput('run_readonly_sql', args),
                      }),
                    });
                    const callId = `finding-rows-${randomUUID()}`;
                    queryFacts.set(callId, facts);
                    const record = toolDataRecord(
                      'run_readonly_sql',
                      args,
                      result,
                    );
                    if (record) {
                      // Only its count links a figure (agent-answers R69):
                      // the raw cells would match the report's numbers by
                      // chance.
                      const counts = (record.columns ?? []).filter((c) =>
                        FINDING_COUNT_COLUMNS.has(c),
                      );
                      captureRecord(
                        record.error
                          ? record
                          : { ...record, figureColumns: counts },
                        callId,
                      );
                    }
                  }),
              }),
            );
          },
          // The rows Save report started: replayed, then placed first
          // among the answer's records and explorable queries (where Save
          // report left them, ahead of the agent's), refs numbered again.
          // While the step waits, each query done is a reasoning line of
          // the step (agents.md 5.13), so the run is never silent.
          findingRows: async () => {
            const slot = findingSlot;
            const before = { data: data.length, explorable: explorable.length };
            try {
              return await early.take<
                Awaited<ReturnType<typeof recordFindingSources>>
              >('finding-rows', (done) =>
                emit({
                  type: 'reasoning',
                  content: `Read the rows behind ${done} finding${done === 1 ? '' : 's'}\n`,
                }),
              );
            } finally {
              if (slot) {
                data.splice(slot.data, 0, ...data.splice(before.data));
                explorable.splice(
                  slot.explorable,
                  0,
                  ...explorable.splice(before.explorable),
                );
                explorable.splice(
                  0,
                  explorable.length,
                  ...withRefs(explorable),
                );
              }
            }
          },
          explain: async ({ dataset, reportId, imageNotes }) => {
            // The run has assessed: the block carries the stored report's
            // summary and `assess_data_readiness` refuses (agents.md 3.13,
            // 5.13).
            if (savedSummary === undefined) {
              throw new Error('The report has not been saved');
            }
            options.requestContext.set(ASSESSED_REPORT_CONTEXT_KEY, reportId);
            // Zoe's notes follow the report block only when the run has
            // images (agents.md 2.15, 5.13).
            const notes = imageNotesBlock(imageNotes);
            // The idle deadline (workflows R43): a Stop is never a timeout.
            const idle = streamIdleWatch(turn.signal);
            try {
              await consume(
                idle.watch(
                  await agent.stream(input, {
                    ...options,
                    abortSignal: idle.signal,
                    context: [
                      ...options.context,
                      {
                        role: 'system' as const,
                        content: explainReportBlock({
                          dataset,
                          reportId,
                          summary: savedSummary,
                        }),
                      },
                      ...(notes
                        ? [{ role: 'system' as const, content: notes }]
                        : []),
                    ],
                  }),
                ),
              );
            } catch (error) {
              if (!idle.timedOut()) throw error;
            } finally {
              idle.dispose();
            }
            idle.check('Explain report');
            if (streamError !== undefined && !turn.signal.aborted) {
              throw await chatTurnError(streamError, () =>
                this.deps.llmService.getView(),
              );
            }
            if (!turn.signal.aborted && !clarification && !text && stream) {
              text = ((await stream.text) ?? '').trim();
            }
            return {
              answer: text.trim(),
              stopped: turn.signal.aborted || clarification !== null,
            };
          },
          // Dashboard Image to Artifact (agents.md 5.17): Read dashboard calls its
          // agent's model with the image, which the run keeps meanwhile.
          loadImage: async ({ image }) => {
            const loaded = await loadedImage(image);
            return {
              mediaType: loaded.mediaType,
              sizeBytes: loaded.data.byteLength,
            };
          },
          readDashboard: async ({ question, image }) => {
            try {
              const read = await this.deps.mastra.readDashboard(
                { question, image: await loadedImage(image) },
                stepModelOf(DASHBOARD_READER_AGENT_KEY),
              );
              return {
                blueprint: read.blueprint,
                stopped: read.stopped || turn.signal.aborted,
              };
            } catch (error) {
              throw await stepError(error);
            }
          },
          saveDashboard: async ({ blueprint, bundle, answer }) => {
            const metadata = await this.deps.saveMock(id, bundle, trimmed);
            const artifact = await this.deps.saveArtifact(
              id,
              blueprint,
              dashboardImage,
            );
            showVisual(metadata);
            // The answer says where the dashboard was saved.
            text = answer(artifact.name);
            emit({ type: 'text', content: text });
            return {
              visualId: metadata.id,
              artifactId: artifact.id,
              artifactName: artifact.name,
            };
          },
          // Map a Dashboard to Data (agents.md 5.18): Map data calls its
          // agent's model with the saved dashboard and the catalog.
          loadDashboard: ({ artifact }) => this.deps.artifact(artifact),
          mapData: async (input) => {
            try {
              // Zoe's notes only when the run has images (agents.md 5.18).
              const mapped = await this.deps.mastra.mapData(
                withImageNotes(input),
                stepModelOf(DATA_MAPPER_AGENT_KEY),
              );
              return {
                mapping: mapped.mapping,
                stopped: mapped.stopped || turn.signal.aborted,
              };
            } catch (error) {
              throw await stepError(error);
            }
          },
          // Read images (agents.md 2.15), the optional first step of Answer
          // a Business Question, Assess Data Readiness and Map a Dashboard
          // to Data: the run's stored images, loaded from its workspace in
          // order, described by Zoe in one model call recorded in her
          // thread. A model error fails the step with its own message.
          readImages: (input) => readImagesOn(input, turn.signal),
          // Assess Data Readiness: Zoe reads the images from Resolve
          // dataset on, on her own stop; Read images takes her notes.
          startImageNotes: (input) => {
            readingImages = true;
            early.start('image-notes', (signal) => readImagesOn(input, signal));
          },
          readsImages: () => readingImages,
          imageNotes: () =>
            early.take<Awaited<ReturnType<typeof readImagesOn>>>('image-notes'),
          saveMappedDashboard: async ({ bundle, answer }) => {
            const metadata = await this.deps.saveMock(id, bundle, trimmed);
            showVisual(metadata);
            // The mapping's explanation is the run's answer.
            text = answer;
            emit({ type: 'text', content: text });
            return { visualId: metadata.id, title: metadata.title };
          },
          // Review a Website (agents.md 5.19): the browser work, its
          // progress shown as the run's thinking, then the report.
          ...this.siteReviewRuntime({
            work: () =>
              (siteWork ??= this.deps.siteReview({
                sessionId: id,
                signal: turn.signal,
                progress: (line) =>
                  emit({ type: 'reasoning', content: `${line}\n` }),
              })),
            saveReport: async ({ bundle, findings, answer }) => {
              const metadata = await this.deps.saveMock(id, bundle, trimmed);
              const reportFile = 'site-review/findings.json';
              await this.deps.writeFile(id, reportFile, findings);
              showVisual(metadata);
              text = answer;
              emit({ type: 'text', content: text });
              return { visualId: metadata.id, reportFile };
            },
            showAnswer: (answer) => {
              text = answer;
              emit({ type: 'text', content: text });
              return Promise.resolve();
            },
            // Review templates (agents.md 5.19): Iris over one template's
            // shots, on the app's model, recorded as text only.
            reviewTemplate: async ({ template, shots, measured }) => {
              const work = (siteWork ??= this.deps.siteReview({
                sessionId: id,
                signal: turn.signal,
                progress: (line) =>
                  emit({ type: 'reasoning', content: `${line}\n` }),
              }));
              const images = await work.shotImages(shots);
              try {
                // Iris's call has its one deadline, two minutes per try, in
                // her guarded call (agents.md 5.19; workflows R43).
                const reviewed = await this.deps.mastra.reviewTemplate(
                  {
                    url: template.representative,
                    template,
                    shots: images,
                    measured,
                  },
                  stepModelOf(SITE_REVIEWER_AGENT_KEY),
                );
                return {
                  ...reviewed,
                  stopped: reviewed.stopped || turn.signal.aborted,
                };
              } catch (error) {
                throw await stepError(error);
              }
            },
            progress: (line) =>
              emit({ type: 'reasoning', content: `${line}\n` }),
          }),
          // Consumption Gap Analysis (agents.md 5.20): its model steps on
          // their own agents, its read-only queries recorded as sources.
          consumptionGap: {
            // Read dashboards: Grace over each stored image, one call each,
            // all at the same time; `signal` ends one when another failed.
            readDashboard: async ({ image, signal }) => {
              try {
                const read = await this.deps.mastra.readDashboard(
                  {
                    question: 'Read this reference dashboard',
                    image: await this.deps.readImage(id, image),
                  },
                  {
                    ...stepModelOf(DASHBOARD_READER_AGENT_KEY),
                    abortSignal: signal
                      ? AbortSignal.any([turn.signal, signal])
                      : turn.signal,
                  },
                );
                return {
                  blueprint: read.blueprint,
                  stopped: read.stopped || turn.signal.aborted,
                };
              } catch (error) {
                throw await stepError(error);
              }
            },
            loadDashboard: ({ artifact }) => this.deps.artifact(artifact),
            // Resolve layers and Load layer catalogs: the dataset tools'
            // own services (names, types and schema notes; no rows).
            datasetLayers,
            // Probe evidence: recorded at once.
            runQueries: ({ queries }) =>
              gapQueriesOn(queries, turn.signal, (replay) => replay()),
            // Infer lineage: started at Load layer catalogs, on its own
            // stop, its sources held until Infer lineage takes them; while
            // it waits, each statement done is a reasoning line of the step
            // (agents.md 5.20), so a slow warehouse is never a silent run.
            startLineage: ({ queries }) => {
              lineageCount = queries.length;
              early.start('lineage', (signal, hold) =>
                gapQueriesOn(queries, signal, hold),
              );
            },
            takeLineage: () =>
              early.take<Awaited<ReturnType<typeof gapQueriesOn>>>(
                'lineage',
                (done) =>
                  emit({
                    type: 'reasoning',
                    content: `Checked ${done} of ${lineageCount} lineage queries\n`,
                  }),
              ),
            deriveRequirements: async (input) => {
              try {
                const derived = await this.deps.mastra.deriveRequirements(
                  input,
                  stepModelOf(REQUIREMENTS_ANALYST_AGENT_KEY),
                );
                return {
                  ...derived,
                  stopped: derived.stopped || turn.signal.aborted,
                };
              } catch (error) {
                throw await stepError(error);
              }
            },
            // Confirm requirements: the same agent applies the user's edits.
            reviseRequirements: async (input) => {
              try {
                const revised = await this.deps.mastra.reviseRequirements(
                  input,
                  stepModelOf(REQUIREMENTS_ANALYST_AGENT_KEY),
                );
                return {
                  ...revised,
                  stopped: revised.stopped || turn.signal.aborted,
                };
              } catch (error) {
                throw await stepError(error);
              }
            },
            mapRequirements: async (input) => {
              try {
                const mapped = await this.deps.mastra.mapRequirements(
                  input,
                  stepModelOf(LAYER_MAPPER_AGENT_KEY),
                );
                return {
                  ...mapped,
                  stopped: mapped.stopped || turn.signal.aborted,
                };
              } catch (error) {
                throw await stepError(error);
              }
            },
            recommendFixes: async (input) => {
              try {
                const advised = await this.deps.mastra.recommendFixes(
                  input,
                  stepModelOf(GAP_ADVISOR_AGENT_KEY),
                );
                return {
                  ...advised,
                  stopped: advised.stopped || turn.signal.aborted,
                };
              } catch (error) {
                throw await stepError(error);
              }
            },
            // Render report: the drawn report is the run's visual, and the
            // answer built in code is its answer.
            saveReport: async ({ bundle, answer, title }) => {
              const metadata = await this.deps.saveMock(
                id,
                { ...bundle, title },
                trimmed,
              );
              showVisual(metadata);
              text = answer;
              emit({ type: 'text', content: text });
              return { visualId: metadata.id, title: metadata.title };
            },
          },
        },
        (event) => onStepEvent?.(event),
      );
    } finally {
      // The run ended, failed, was stopped or waits: work no step took is
      // aborted and awaited, its records dropped, before anything persists.
      await early.settle();
      abortSignal?.removeEventListener('abort', forwardAbort);
    }
    // The workflow run waits for the user (ADR-0043). A run host's turn
    // hands back its suspension: `resume` reports to the new request and
    // goes on with the answer. A session's turn ends on the question, as a
    // clarification card (agents.md 5.1), and its workflow run is dropped.
    const settle = async (
      outcome: TurnRunOutcome,
    ): Promise<TurnSuspension | undefined> => {
      if (outcome.status === 'suspended') {
        if (suspendable && outcome.resume) {
          const resumeRun = outcome.resume;
          return {
            stepId: outcome.stepId,
            question: outcome.question,
            options: outcome.options,
            ...(outcome.review ? { review: outcome.review } : {}),
            ...(outcome.visualId ? { visualId: outcome.visualId } : {}),
            resume: async (answer: string, io: TurnResumeIo) => {
              emit = io.emit;
              abortSignal = io.abortSignal;
              onStepEvent = io.onStepEvent;
              // A resume stopped before it got here is aborted at once.
              if (abortSignal?.aborted) forwardAbort();
              else
                abortSignal?.addEventListener('abort', forwardAbort, {
                  once: true,
                });
              let next: TurnRunOutcome;
              try {
                next = await resumeRun(answer, io.images);
              } finally {
                await early.settle();
                abortSignal?.removeEventListener('abort', forwardAbort);
              }
              return settle(next);
            },
            discard: outcome.discard,
          };
        }
        await outcome.discard();
        clarification = {
          question: outcome.question,
          options: clarificationOptions(outcome.options),
        };
      }
      await finishTurn();
      return undefined;
    };
    const finishTurn = async (): Promise<void> => {
      // v2's answer is its Write answer step's text only (agents.md 5.11):
      // its Analyse stream's text is a note, and no synthesis replaces it.
      if (
        !codeAnswer &&
        !turn.signal.aborted &&
        !clarification &&
        !text &&
        stream
      ) {
        text = ((await stream.text) ?? '').trim();
      }
      if (
        !codeAnswer &&
        !turn.signal.aborted &&
        !clarification &&
        !text.trim() &&
        !visualEvent &&
        !readinessReport
      ) {
        // A model can spend every allowed step on tools and finish without a
        // user-facing answer. Give it one tool-disabled pass to turn the data it
        // already collected into prose; never let a completed turn disappear.
        text = await synthesizeToolOnlyTurn(
          agent,
          trimmed,
          data,
          turn.signal,
          options.providerOptions,
          this.deps.logger,
          options.requestContext,
        );
        if (turn.signal.aborted) return;
        if (text) emit({ type: 'text', content: text });
      }

      // Zero-SQL-turn grounding guard: the system prompt already forbids
      // answering data questions from parametric memory, but prompt-only
      // enforcement missed cases in evals (e.g. "Who won the 2022 World Cup?"
      // answered with no tool calls at all). This is the runtime backstop —
      // one corrective pass, tools allowed, at most once per turn. Text is
      // streamed to the client incrementally above, before this guard can
      // even run, so there is nothing to "un-stream"; the client's source of
      // truth is the persisted message delivered with `done` below (see
      // `SessionChat` — it replaces its whole message list from that event,
      // it does not keep the streamed deltas), so overwriting `text` here is
      // enough to make the corrected answer the one the user ends up seeing.
      if (
        isAssistant &&
        !turn.signal.aborted &&
        !clarification &&
        text.trim() &&
        calledTools.size === 0
      ) {
        const corrected = await this.runGroundingGuard(
          agent,
          trimmed,
          text,
          options,
          data,
          turn.signal,
        );
        if (corrected) text = corrected;
      }

      // Visual tools persist metadata mid-turn; reload so this write keeps it.
      const fresh = await this.deps.get(id);
      const messages = fresh.messages;
      const entities = sourceEntities(data);
      const reasoning = reasoningTrail(data);
      const knowledge = knowledgeUsed(options.requestContext);
      // One entry per query record, beside `data` (never on a record).
      const evidence = evidenceOf(data, factsOf);
      // The dashboard Clara saved in this turn (agents.md 5.22).
      const dashboard = orchState.dashboard;
      if (clarification) {
        // The turn stops here, but the schema/sample work done before the
        // question is real work — keep it on the card instead of dropping it.
        messages.push({
          role: 'assistant',
          content: clarification.question,
          at: new Date().toISOString(),
          clarification,
          ...(data.length ? { data } : {}),
          ...(evidence.length ? { evidence } : {}),
          ...(entities.length ? { entities } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...(knowledge ? { knowledge } : {}),
          ...(readinessReport ? { readinessReport } : {}),
          ...(dashboard ? { dashboard } : {}),
        });
      } else if (text.trim() || visualEvent || readinessReport || dashboard) {
        const interpretation = interpretationLine(data, entities);
        // Careful mode only, and only when there is a result set to corroborate.
        // The assistant's only: another agent runs no SQL to cross-check.
        const crossChecked =
          careful && isAssistant && !turn.signal.aborted
            ? await this.deps.crossCheckAnswer(
                session,
                trimmed,
                data,
                turn.signal,
              )
            : undefined;
        messages.push({
          role: 'assistant',
          content:
            text.trim() ||
            (visualEvent
              ? `${visualEvent.action === 'created' ? 'Created' : 'Updated'} interactive visual "${visualEvent.title}" (v${visualEvent.version}).`
              : dashboard
                ? `${dashboard.action === 'created' ? 'Created' : 'Updated'} dashboard "${dashboard.title}" (version ${dashboard.version}).`
                : readinessAnswerFallback(readinessReport!)),
          at: answerAt ?? new Date().toISOString(),
          ...(data.length ? { data } : {}),
          ...(evidence.length ? { evidence } : {}),
          ...(entities.length ? { entities } : {}),
          ...(interpretation ? { interpretation } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...(knowledge ? { knowledge } : {}),
          ...((await this.deps.sql.matchesVerifiedQuery(session, data))
            ? { verified: true }
            : {}),
          ...(visualEvent ? { visual: visualEvent } : {}),
          ...(dashboard ? { dashboard } : {}),
          ...(crossChecked ? { crossCheck: crossChecked } : {}),
          ...(readinessReport ? { readinessReport } : {}),
        });
      }
      const updated = await this.deps.updateDoc(id, { messages });
      if (!turn.signal.aborted || clarification) {
        emit({
          type: 'done',
          session: await this.deps.toView(updated ?? fresh),
        });
      }
    };
    return settle(ran);
  }

  /**
   * Run one turn as a run of the session's workflow (agents.md 5.1, 5.11,
   * 5.12; ADR-0034, ADR-0040): `answer-business-question` hands its Analyse step
   * `runtime.analyse`, `agent-turn` hands its Answer step `runtime.answer`.
   * Only a workflow whose steps drive the bar (`bar: 'steps'`) writes the
   * session's workflow state from the run's step events and emits each
   * change as `workflow`; a one-step workflow never does (agent-panel R15).
   * A failed step throws its own error, so the `error` event reads as the
   * agent's; a stopped turn ends at its agent step. A run host's turn also
   * hands every step event to `onStepEvent`, whatever the bar (agents.md
   * 5.14).
   */
  /**
   * The conversation's dashboard, as a message to Avery changes it
   * (agents.md 5.22, the follow-up carry): the current version of the
   * host's `contextDashboard`. None when the host carries none, the
   * artifact is gone, or its version holds no data query (a dashboard
   * read from an image).
   */
  private async currentDashboardOf(
    session: SessionDoc,
  ): Promise<CurrentDashboard | undefined> {
    const artifactId = session.contextDashboard;
    if (!artifactId || !this.deps.dashboardVersion) return undefined;
    let shown: DashboardVersionData;
    try {
      shown = await this.deps.dashboardVersion(artifactId);
    } catch (error) {
      this.deps.logger.warn(
        `The dashboard ${artifactId} of ${session.id} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
    if (!shown.query) return undefined;
    return {
      artifactId: shown.artifactId,
      version: shown.version,
      title: shown.title,
      blueprint: shown.blueprint,
      query: shown.query,
      columns: shown.columns,
      rowCount: shown.rowCount,
      widgetCount: shown.widgetCount,
      filterCount: shown.filterCount,
    };
  }

  /**
   * Review a Website's runtime (agents.md 5.19): the browser work of the
   * run, taken when a step first asks for it, and the run's report and
   * answer.
   */
  private siteReviewRuntime(parts: {
    work: () => SiteReviewWork;
    saveReport: ReviewWebsiteRuntime['saveReport'];
    showAnswer: ReviewWebsiteRuntime['showAnswer'];
    reviewTemplate: ReviewWebsiteRuntime['reviewTemplate'];
    progress: ReviewWebsiteRuntime['progress'];
  }): ReviewWebsiteRuntime {
    return {
      checkSignIn: (input) => parts.work().checkSignIn(input),
      openSignIn: (input) => parts.work().openSignIn(input),
      finishSignIn: (input) => parts.work().finishSignIn(input),
      discoverPages: (input) => parts.work().discoverPages(input),
      captureAndCheck: (input) => parts.work().captureAndCheck(input),
      loadReportImages: (paths) => parts.work().loadReportImages(paths),
      saveReport: parts.saveReport,
      showAnswer: parts.showAnswer,
      reviewTemplate: parts.reviewTemplate,
      progress: parts.progress,
    };
  }

  private async runTurnWorkflow(
    session: SessionDoc,
    workflow: TurnWorkflow,
    question: string,
    emit: (event: StreamEvent) => void,
    runtime: AnswerBusinessQuestionRuntime &
      Required<
        Pick<
          AnswerBusinessQuestionRuntime,
          'buildVisual' | 'reviseVisual' | 'deliverAnswer'
        >
      > &
      AgentTurnRuntime &
      DataReadinessAssessmentRuntime &
      RecreateDashboardRuntime &
      MapDashboardDataRuntime &
      ReadImagesRuntime &
      ReviewWebsiteRuntime & {
        /** Its names overlap the others' (readDashboard, saveReport): kept apart. */
        consumptionGap: ConsumptionGapRuntime;
        /** A follow-up that asks Write answer alone (agents.md 5.21). */
        earlierAnswer: () => EarlierAnswerInput;
        /** Avery's turn, with her team (agents.md 5.22). */
        orchestrate: (
          input: Parameters<OrchestratedAnswerRuntime['orchestrate']>[0],
          team: OrchestratorTeam,
        ) => ReturnType<OrchestratedAnswerRuntime['orchestrate']>;
        /** Clara's build, one of Avery's team calls (agents.md 5.22). */
        buildDashboard: NonNullable<OrchestratorTeam['buildDashboard']>;
        /** A follow-up that asks Build visual alone (agents.md 5.21). */
        earlierVisual: () => EarlierVisualInput;
        /** Its designer call, the follow-up as Ryan's instruction. */
        buildVisual: AskAgentRuntime['buildVisual'];
      },
    onStepEvent?: (event: RunStepEvent) => void,
  ): Promise<TurnRunOutcome> {
    // The agent step's own failure, kept so the turn reports it as is.
    let stepError: unknown;
    const captured = async <T>(step: () => Promise<T>): Promise<T> => {
      try {
        return await step();
      } catch (error) {
        stepError = error;
        throw error;
      }
    };
    const requestContext = new RequestContext();
    const readiness =
      workflow.engineId === DATA_READINESS_ASSESSMENT_WORKFLOW_ID;
    const recreate = workflow.engineId === RECREATE_DASHBOARD_WORKFLOW_ID;
    const mapping = workflow.engineId === MAP_DASHBOARD_DATA_WORKFLOW_ID;
    const review = workflow.engineId === REVIEW_WEBSITE_WORKFLOW_ID;
    const gap = workflow.engineId === CONSUMPTION_GAP_WORKFLOW_ID;
    const ask = workflow.engineId === ASK_AGENT_WORKFLOW_ID;
    const orchestrated = workflow.engineId === ORCHESTRATED_ANSWER_WORKFLOW_ID;
    if (orchestrated) {
      // Answer a Business Question (orchestrated): Avery calls the team
      // through the same calls Answer a Business Question's steps make.
      requestContext.set(ORCHESTRATED_ANSWER_RUNTIME_KEY, {
        orchestrate: (input) =>
          captured(() =>
            runtime.orchestrate(input, {
              readImages: (read) => runtime.readImages(read),
              plan: (planned) => runtime.plan(planned),
              analyse: (attempt) => runtime.analyse(attempt),
              writeAnswer: (written) => runtime.writeAnswer(written),
              buildVisual: (built) => runtime.buildVisual(built),
              buildDashboard: (built) => runtime.buildDashboard(built),
            }),
          ),
      } satisfies OrchestratedAnswerRuntime);
    } else if (ask) {
      // A follow-up that asks one agent (agents.md 5.21): the same calls
      // the workflow's own steps make, on this turn's records.
      requestContext.set(ASK_AGENT_RUNTIME_KEY, {
        answer: () => captured(() => runtime.answer()),
        readImages: (input) => captured(() => runtime.readImages(input)),
        plan: (input) => captured(() => runtime.plan(input)),
        earlierAnswer: () => runtime.earlierAnswer(),
        writeAnswer: (input) => captured(() => runtime.writeAnswer(input)),
        earlierVisual: () => runtime.earlierVisual(),
        buildVisual: (input: Parameters<AskAgentRuntime['buildVisual']>[0]) =>
          captured(() => runtime.buildVisual(input)),
        deliverAnswer: (answer) => runtime.deliverAnswer(answer),
      } satisfies AskAgentRuntime);
    } else if (workflow.engineId === AGENT_TURN_WORKFLOW_ID) {
      requestContext.set(AGENT_TURN_RUNTIME_KEY, {
        answer: () => captured(() => runtime.answer()),
      } satisfies AgentTurnRuntime);
    } else if (readiness) {
      requestContext.set(DATA_READINESS_ASSESSMENT_RUNTIME_KEY, {
        resolve: (input) => captured(() => runtime.resolve(input)),
        profile: () => captured(() => runtime.profile()),
        // Synchronous: a throw is the step's own, kept as the turn's error.
        score: () => {
          try {
            return runtime.score();
          } catch (error) {
            stepError = error;
            throw error;
          }
        },
        // Early work (agents.md 5.13): a start is no step's failure; the
        // step that takes the work reports its error.
        startImageNotes: (input) => runtime.startImageNotes(input),
        readsImages: () => runtime.readsImages(),
        imageNotes: () => captured(() => runtime.imageNotes()),
        save: () => captured(() => runtime.save()),
        startFindingRows: () => runtime.startFindingRows(),
        findingRows: () => captured(() => runtime.findingRows()),
        explain: (input) => captured(() => runtime.explain(input)),
      } satisfies DataReadinessAssessmentRuntime);
    } else if (recreate) {
      requestContext.set(RECREATE_DASHBOARD_RUNTIME_KEY, {
        loadImage: (input) => captured(() => runtime.loadImage(input)),
        readDashboard: (input) => captured(() => runtime.readDashboard(input)),
        saveDashboard: (input) => captured(() => runtime.saveDashboard(input)),
      } satisfies RecreateDashboardRuntime);
    } else if (mapping) {
      requestContext.set(MAP_DASHBOARD_DATA_RUNTIME_KEY, {
        loadDashboard: (input) => captured(() => runtime.loadDashboard(input)),
        mapData: (input) => captured(() => runtime.mapData(input)),
        saveMappedDashboard: (input) =>
          captured(() => runtime.saveMappedDashboard(input)),
      } satisfies MapDashboardDataRuntime);
    } else if (review) {
      // Review templates handles each template's failure itself and fails,
      // with the first, only when no template was reviewed (workflows R43;
      // agents.md 5.19): the turn keeps that first one, and lets it go once
      // a template is reviewed, so a handled failure is never the turn's.
      let templateError: unknown;
      let templateReviewed = false;
      const reviewTemplate: ReviewWebsiteRuntime['reviewTemplate'] = async (
        input,
      ) => {
        try {
          const reviewed = await runtime.reviewTemplate(input);
          templateReviewed = true;
          if (templateError !== undefined && stepError === templateError) {
            stepError = undefined;
          }
          return reviewed;
        } catch (error) {
          if (!templateReviewed && templateError === undefined) {
            templateError = error;
            stepError = error;
          }
          throw error;
        }
      };
      requestContext.set(REVIEW_WEBSITE_RUNTIME_KEY, {
        checkSignIn: (input) => captured(() => runtime.checkSignIn(input)),
        openSignIn: (input) => captured(() => runtime.openSignIn(input)),
        finishSignIn: (input) => captured(() => runtime.finishSignIn(input)),
        discoverPages: (input) => captured(() => runtime.discoverPages(input)),
        captureAndCheck: (input) =>
          captured(() => runtime.captureAndCheck(input)),
        loadReportImages: (paths) =>
          captured(() => runtime.loadReportImages(paths)),
        saveReport: (input) => captured(() => runtime.saveReport(input)),
        showAnswer: (text) => captured(() => runtime.showAnswer(text)),
        reviewTemplate,
        // Synchronous and never throws: a progress line only.
        progress: (line) => runtime.progress(line),
      } satisfies ReviewWebsiteRuntime);
    } else if (gap) {
      const parts = runtime.consumptionGap;
      requestContext.set(CONSUMPTION_GAP_RUNTIME_KEY, {
        // The reads run together: the first failure is the step's, not a
        // read its abort then ended (its signal is aborted by then).
        readDashboard: async (input) => {
          try {
            return await parts.readDashboard(input);
          } catch (error) {
            if (!input.signal?.aborted) stepError = error;
            throw error;
          }
        },
        loadDashboard: (input) => captured(() => parts.loadDashboard(input)),
        datasetLayers: (input) => captured(() => parts.datasetLayers(input)),
        runQueries: (input) => captured(() => parts.runQueries(input)),
        // Early work (agents.md 5.20): Infer lineage reports its error.
        startLineage: (input) => parts.startLineage(input),
        takeLineage: () => captured(() => parts.takeLineage()),
        deriveRequirements: (input) =>
          captured(() => parts.deriveRequirements(input)),
        reviseRequirements: (input) =>
          captured(() => parts.reviseRequirements(input)),
        mapRequirements: (input) =>
          captured(() => parts.mapRequirements(input)),
        recommendFixes: (input) => captured(() => parts.recommendFixes(input)),
        saveReport: (input) => captured(() => parts.saveReport(input)),
      } satisfies ConsumptionGapRuntime);
    } else {
      requestContext.set(ANSWER_BUSINESS_QUESTION_RUNTIME_KEY, {
        // A run host's turn (workflows R44): its agents ask and wait.
        ...(runtime.interactive ? { interactive: true } : {}),
        plan: (input) => captured(() => runtime.plan(input)),
        analyse: (input) => captured(() => runtime.analyse(input)),
        // Only a run host whose input ticked it (agents.md 5.11).
        buildsVisual: session.buildVisual === true,
        buildVisual: (input) => captured(() => runtime.buildVisual(input)),
        reviseVisual: (input) => captured(() => runtime.reviseVisual(input)),
        writeAnswer: (input) => captured(() => runtime.writeAnswer(input)),
        deliverAnswer: (answer) => runtime.deliverAnswer(answer),
      } satisfies AnswerBusinessQuestionRuntime);
    }
    // Read images, the optional first step of every workflow but the
    // agent turn, Dashboard Image to Artifact and Consumption Gap Analysis,
    // whose Read dashboards hands its images to Grace (agents.md 2.15, 5.20).
    const readsImages =
      workflow.engineId !== AGENT_TURN_WORKFLOW_ID && !recreate && !gap;
    if (readsImages) {
      requestContext.set(READ_IMAGES_RUNTIME_KEY, {
        readImages: (input) => captured(() => runtime.readImages(input)),
        // Only a run of Answer a Business Question waits on Zoe (R44).
        ...(runtime.interactive &&
        workflow.engineId === ANSWER_BUSINESS_QUESTION_WORKFLOW_ID
          ? { interactive: true }
          : {}),
      } satisfies ReadImagesRuntime);
    }
    // The run's reference images (their stored paths), only when it has
    // some: without them the engine's input is what it was before.
    const images =
      readsImages && session.inputImages?.length
        ? { images: [...session.inputImages] }
        : {};
    // Assess Data Readiness runs on the run's one dataset (agents.md 5.13).
    // Dashboard Image to Artifact runs on the run's image (agents.md 5.17); Map a
    // Dashboard to Data on a saved dashboard and the run's datasets (5.18).
    // Consumption Gap Analysis on the run's questions and datasets, its
    // saved dashboard ('' when none) and its reference dashboards (5.20).
    const turnInput:
      | AnswerBusinessQuestionInput
      | AskAgentInput
      | { question: string; dataset: string; images?: string[] }
      | { question: string; image: string }
      | {
          question: string;
          artifact: string;
          datasets: string[];
          images?: string[];
        }
      | ReviewWebsiteInput = ask
      ? // The asked step, over the run's datasets and images (5.21).
        {
          question,
          datasets: session.datasets,
          askStep: session.ask?.step as AskableStepId,
          ...images,
        }
      : review
        ? // Review a Website reads the whole form (agents.md 5.19).
          reviewWebsiteInputOf(session.inputValues ?? { url: question })
        : gap
          ? {
              question,
              datasets: session.datasets,
              artifact: session.inputArtifact ?? '',
              images: [...(session.inputImages ?? [])],
            }
          : recreate
            ? { question, image: session.inputImage ?? '' }
            : mapping
              ? {
                  question,
                  artifact: session.inputArtifact ?? '',
                  datasets: session.datasets,
                  ...images,
                }
              : readiness
                ? { question, dataset: session.datasets[0] ?? '', ...images }
                : { question, datasets: session.datasets, ...images };
    let state = session.workflowState;
    // A new run starts the bar over at its first step event, whichever step
    // that is: Read images, step 1, is optional, so a run without images
    // starts at Receive question (agent-panel R8a). A resume goes on.
    let startsOver = true;
    // Drive one stream of the run (its start, or a resume) to its outcome.
    const drive = async (
      run: WorkflowRunStream,
      resumed = false,
    ): Promise<TurnRunOutcome> => {
      // Drop the run's snapshot (ADR-0043): it is written only while the
      // run waits, so a resumed run that ends leaves it behind otherwise.
      const discard = async () => {
        try {
          await run.discard?.();
        } catch (error) {
          this.deps.logger.warn(
            `Could not discard the suspended turn of ${session.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      };
      // The last catalogue step that suspended, with what it asked.
      let waiting: { stepId: string; payload: unknown } | undefined;
      for await (const engineEvent of run.fullStream) {
        // A nested workflow's step is `<workflow>.<step>`: the step's own id.
        const event = engineEvent.payload?.id
          ? {
              ...engineEvent,
              payload: {
                ...engineEvent.payload,
                id: catalogStepId(engineEvent.payload.id),
              },
            }
          : engineEvent;
        const stepId = event.payload?.id;
        if (
          event.type === 'workflow-step-suspended' &&
          stepId &&
          workflow.stepIds.includes(stepId)
        ) {
          waiting = { stepId, payload: event.payload?.suspendPayload };
        }
        if (onStepEvent && stepEventOf(event)) onStepEvent(event);
        if (workflow.bar !== 'steps') continue;
        const stepEvent = stepEventOf(event);
        if (!stepEvent) continue;
        const next = workflowRunState(
          startsOver && !resumed ? undefined : state,
          stepEvent,
          workflow.stepIds,
        );
        if (!next) continue;
        startsOver = false;
        state = next;
        await this.deps.updateDoc(session.id, { workflowState: state });
        session.workflowState = state;
        await this.emitWorkflow(session.id, emit);
      }
      const result = await run.result;
      if (resumed && result.status !== 'suspended') await discard();
      if (result.status === 'failed') {
        const failure: unknown =
          stepError ?? result.error ?? new Error('The turn failed');
        throw failure;
      }
      if (result.status === 'suspended') {
        // The path is handed back to the engine unchanged (ADR-0043).
        const path = result.suspended?.[0] ?? [];
        const stepId = waiting?.stepId ?? catalogStepId(path.at(-1) ?? '');
        const asked = clarifyingQuestionOf(
          waiting?.payload ?? result.steps?.[path[0] ?? '']?.suspendPayload,
        );
        if (!asked) {
          await discard();
          throw new Error(`The ${stepId} step waited with no question`);
        }
        const resumeRun = run.resume;
        return {
          status: 'suspended',
          stepId,
          question: asked.question,
          options: asked.options,
          ...(asked.review ? { review: asked.review } : {}),
          ...(asked.visualId ? { visualId: asked.visualId } : {}),
          ...(resumeRun
            ? {
                resume: (answer: string, images?: string[]) =>
                  drive(
                    resumeRun({
                      step: path,
                      // Reference images only with a change to Ryan's visual.
                      resumeData: {
                        answer,
                        ...(images?.length ? { images } : {}),
                      },
                      requestContext,
                    }),
                    true,
                  ),
              }
            : {}),
          discard,
        };
      }
      const summary =
        result.status === 'success' ? turnSummaryOf(result.result) : undefined;
      if (summary) {
        const { answer, ...counts } = summary;
        this.deps.logger.log(
          `Insights Analyst turn in session ${session.id}: ${JSON.stringify({ ...counts, answerLength: answer.length })}`,
        );
      }
      return { status: 'done' };
    };
    return drive(
      await this.deps.mastra.streamWorkflow(
        workflow.engineId,
        turnInput,
        requestContext,
      ),
    );
  }

  /**
   * Runtime backstop for the grounding rule in the system prompt: a turn
   * that produced a non-empty answer without calling a single tool gets one
   * corrective pass, tools allowed, before it is accepted. Called at most
   * once per turn by `streamTurn`.
   *
   * Deliberately memory-free. `agentInput` shows that once a session has a
   * memory thread, the turn's `input` is just the latest user message —
   * memory itself replays the rest of the history. Calling `agent.generate`
   * again with that same question string and the same `{ thread, resource }`
   * would hand memory a second "new" user turn with identical content,
   * duplicating the question in the persisted conversation. So this pass
   * gets its own compact, self-contained context instead: the same per-turn
   * system blocks already built for the turn (dataset orientation, curated
   * metrics, verified-query references) plus the nudge below, which carries
   * the model's own ungrounded answer so it has something concrete to keep,
   * correct or retract — never the full thread.
   *
   * Tool calls made during the corrective pass are extracted from the
   * `generate()` result (there is no stream to read chunks off of) and
   * pushed onto the same live `data` array the turn already collects into,
   * so a corrected answer's SQL still ends up in the persisted `data`,
   * `entities`, `interpretation` and verified-badge logic below.
   */
  private async runGroundingGuard(
    agent: ReturnType<MastraService['getAgent']>,
    question: string,
    originalAnswer: string,
    turnOptions: {
      context?: { role: 'system'; content: string }[];
      memory?: unknown;
      [key: string]: unknown;
    },
    data: ToolDataRecord[],
    abortSignal: AbortSignal,
  ): Promise<string | undefined> {
    const correctiveOptions: Record<string, unknown> = { ...turnOptions };
    delete correctiveOptions['memory'];
    correctiveOptions['context'] = [
      ...(turnOptions.context ?? []),
      {
        role: 'system' as const,
        content: groundingNudge(originalAnswer),
      },
    ];
    try {
      const result = await agent.generate(question, correctiveOptions);
      const corrected = ((result as { text?: string }).text ?? '').trim();
      if (!corrected) return undefined;
      data.push(...toolRecords(result));
      return corrected;
    } catch (error) {
      if (abortSignal.aborted) return undefined;
      this.deps.logger.warn(
        `Grounding guard corrective pass failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }

  /** Emit the `workflow` event: the session's current workflow view (api.md 3.1). */
  private async emitWorkflow(
    sessionId: string,
    emit: (event: StreamEvent) => void,
  ): Promise<void> {
    const workflow = await this.deps.workflowOf(await this.deps.get(sessionId));
    if (workflow) {
      emit({ type: 'workflow', content: JSON.stringify(workflow) });
    }
  }

  /**
   * A readiness tool's report reaches the client (agents.md 2.10, api.md
   * 3.1): its `readiness` panel item is stored on the session (upserted) and
   * the `readiness-report` event carries the full report with that item. The
   * model only saw the summary; the full report is the one the bridge
   * resolved for the same id. Returns the answer's reference.
   */
  private async showReadinessReport(
    sessionId: string,
    result: unknown,
    emit: (event: StreamEvent) => void,
  ): Promise<ReadinessReportRef | undefined> {
    // The tool's raw result carries the full report (only its summary
    // reaches the model); the bridge's copy covers any other shape.
    const reportId = readinessReportIdOf(result);
    const bridge = this.deps.readinessBridge();
    const report =
      readinessReportOf(result) ??
      (reportId && bridge ? await bridge.reportFor(reportId) : undefined);
    if (!report) return undefined;
    const panelItem = readinessPanelItem(report);
    const session = await this.deps.get(sessionId);
    await this.deps.updateDoc(sessionId, {
      panelItems: upsertPanelItem(session.panelItems ?? [], panelItem),
    });
    emit({
      type: READINESS_REPORT_EVENT,
      content: JSON.stringify({ report, panelItem }),
    });
    return readinessReportRef(report);
  }

  /** Emit the `panel-item` event for a stored item (api.md 3.1). */
  private async emitPanelItem(
    sessionId: string,
    itemId: string,
    emit: (event: StreamEvent) => void,
  ): Promise<void> {
    const session = await this.deps.get(sessionId);
    const item = withVisualItems(session).find((i) => i.id === itemId);
    if (!item) return;
    emit({ type: 'panel-item', content: JSON.stringify({ item }) });
  }
}
