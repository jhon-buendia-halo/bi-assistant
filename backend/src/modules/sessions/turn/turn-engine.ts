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
  DATA_READINESS_AGENT_KEY,
  IMAGE_READER_AGENT_KEY,
  RESULT_EXPLORER_AGENT_KEY,
} from '../../../mastra/agent-constants';
import type { AgentExchange } from '../../../mastra/agent-threads';
import { TURN_RECORDS_CONTEXT_KEY } from '../../../mastra/tools/visual.tools';
import { pageExplorableQuery } from '../../../mastra/tools/explore-result.tool';
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
import type { WorkflowRunStream } from '../../../mastra/mastra.service';
import {
  DATA_QUALITY_CHECK,
  ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  assessable,
  clarifyingQuestionOf,
  dataQualityFailure,
  dataQualityFindings,
  turnSummaryOf,
  type AnsweredClarification,
  type QualityEngineFinding,
  type AnswerBusinessQuestionInput,
  type AnswerBusinessQuestionRuntime,
} from '../../../mastra/workflows/answer-business-question.steps';
import {
  DATA_QUALITY_FINDINGS_CAP,
  analyseSystemBlocks,
} from '../../../mastra/workflows/answer-business-question.prompts';
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
  topFindings,
} from '../readiness-bridge';
import {
  SYNTHETIC_DATA_TOOLS,
  syntheticPanelItemId,
} from '../synthetic-data-bridge';
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
  type ExplorableQuery,
} from '../query-evidence/explorable-queries';
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
  answeredTurnInput,
  catalogStepId,
  clarificationOptionText,
  turnWorkflowOf,
  type TurnWorkflow,
} from './turn-workflow';
import type { TurnOptions } from './turn-options';
import type { SqlChecks } from './sql-checks';

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
  /** Careful mode's cross-check of the answer's SQL (agents.md 5.4). */
  crossCheckAnswer(
    session: SessionDoc,
    question: string,
    data: ToolDataRecord[],
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
  /** Store a drawn dashboard as a visual of the session (agents.md 5.17). */
  saveMock(
    sessionId: string,
    bundle: MockBundle,
    instruction: string,
  ): Promise<SessionVisualization>;
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
      resume?: (answer: string) => Promise<TurnRunOutcome>;
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
    abortSignal?.addEventListener('abort', forwardAbort, { once: true });
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
    // What v2's Interpret follow-up may page (roadmap 1.27.8): the earlier
    // queries as the turn starts, before it runs any of its own.
    const followUp: readonly ExplorableQuery[] = [...explorable];
    let stream: Awaited<ReturnType<typeof agent.stream>> | undefined;

    let text = '';
    // Set inside `consume`, so typed without narrowing to the initial null.
    let clarification = null as ChatMessage['clarification'] | null;
    let visualEvent: VisualEvent | undefined;
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
    // The agent's clarifying questions this turn, each with the answer:
    // every later attempt goes on with them.
    const answers: AnsweredClarification[] = [];
    const workflow = turnWorkflowOf(session);
    // v2's answer is its Write answer step's only (agents.md 5.11).
    const v2 = workflow.engineId === ANSWER_BUSINESS_QUESTION_WORKFLOW_ID;
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
          }
        }
      } catch (error) {
        if (!turn.signal.aborted && !attemptStop?.signal.aborted) throw error;
      }
    };
    // Assess Data Readiness's assessment, once Resolve dataset started it.
    let assessment: ReadinessAssessment | undefined;
    // Its stored report, once Save report stored it (roadmap 1.27.11).
    let savedReport: ReadinessReport | undefined;
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
      const stepError = (error: unknown) =>
        chatTurnError(error, () => this.deps.llmService.getView());
      const stepModelBase = {
        abortSignal: turn.signal,
        providerOptions: options.providerOptions as
          Record<string, unknown> | undefined,
        requestContext: options.requestContext,
      };
      // A step agent of its own runs without memory; its exchange is
      // recorded in its thread on this host (agents.md 5.14), and a
      // failure to record never fails the step.
      const stepModelOf = (stepAgentKey: string) => ({
        ...stepModelBase,
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
      ran = await this.runTurnWorkflow(
        session,
        workflow,
        trimmed,
        // The current request's stream: a resumed turn reports to its own.
        (event) => emit(event),
        {
          // v2's steps (agents.md 5.11): Plan and Write answer call the
          // agent's model without tools; Analyse streams the agent itself.
          plan: async ({
            question,
            catalogBlock,
            clarification: answered,
            imageNotes,
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
            attempt,
            answered,
            imageNotes,
          }) => {
            // A resumed attempt keeps the records it made before it asked.
            if (answered) answers.push(answered);
            else attemptStart = data.length;
            // A retry, and an attempt after the user answered the agent,
            // run without the memory thread, so the question is not stored
            // twice; the plan block and the answered questions carry what
            // they need.
            const attemptOptions: typeof options = { ...options };
            if (attempt > 1 || answers.length) {
              delete (attemptOptions as { memory?: unknown }).memory;
            }
            // A clarifying question stops this attempt's stream only.
            const stop = new AbortController();
            const stopAttempt = () => stop.abort();
            turn.signal.addEventListener('abort', stopAttempt, { once: true });
            attemptStop = stop;
            notes = '';
            let attemptNotes = '';
            try {
              await consume(
                await agent.stream(
                  answers.length
                    ? (answeredTurnInput(input, trimmed, answers) as never)
                    : input,
                  {
                    ...attemptOptions,
                    abortSignal: stop.signal,
                    // The catalog and plan blocks, then Zoe's notes only
                    // when the run has images (agents.md 5.11).
                    context: [
                      ...options.context,
                      ...analyseSystemBlocks({
                        catalogBlock,
                        planBlock,
                        imageNotes,
                      }).map((content) => ({
                        role: 'system' as const,
                        content,
                      })),
                    ],
                  },
                ),
              );
            } finally {
              attemptNotes = notes ?? '';
              notes = undefined;
              attemptStop = undefined;
              turn.signal.removeEventListener('abort', stopAttempt);
            }
            // The agent asked the user: the step waits for the answer.
            const asked = turn.signal.aborted ? null : clarification;
            clarification = null;
            // Stopping the stream for the question is no model error.
            if (asked) streamError = undefined;
            // Any model error fails the step (agents.md 5.11).
            if (streamError !== undefined && !turn.signal.aborted) {
              throw await stepError(streamError);
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
          // v2's optional Check data quality (agents.md 5.11): the engine
          // assesses the tables the queries read, one assessment per
          // dataset, stored and shown as the answer's readiness card; then
          // Sarah's model picks the findings that affect the answer. A
          // check that cannot run becomes a finding, never a failed run.
          checkDataQuality: async ({ question, queries, tables }) => {
            const assessed = tables.filter(assessable);
            const skipped = tables
              .filter((table) => !assessable(table))
              .map((table) => table.entity);
            const measured = {
              tables: assessed.map((table) => table.entity),
              reportIds: [] as string[],
              findingCount: 0,
              issues: 0,
              skipped,
            };
            const stop = () => ({
              findings: [],
              dataQuality: measured,
              stopped: true,
            });
            if (assessed.length === 0) {
              return {
                findings: [
                  {
                    check: DATA_QUALITY_CHECK,
                    passed: true,
                    detail: tables.length
                      ? `No table the queries read can be assessed: only PostgreSQL and Databricks tables can (${skipped.join(', ')}).`
                      : 'The queries read no table of the catalog.',
                  },
                ],
                dataQuality: measured,
                stopped: false,
              };
            }
            const engineFindings: QualityEngineFinding[] = [];
            try {
              const bridge = this.deps.readinessBridge();
              if (!bridge) throw new Error('data readiness is not available');
              const byDataset = new Map<string, string[]>();
              for (const table of assessed) {
                byDataset.set(table.dataset, [
                  ...(byDataset.get(table.dataset) ?? []),
                  table.entity,
                ]);
              }
              for (const [dataset, entities] of byDataset) {
                const assessment = await bridge.startAssessment({
                  sessionId: id,
                  datasetName: dataset,
                  tables: entities,
                });
                await assessment.profile({ signal: turn.signal });
                if (turn.signal.aborted) return stop();
                assessment.score();
                const saved = await assessment.save();
                measured.reportIds.push(saved.report.id);
                measured.findingCount += saved.report.findings.length;
                const shown = await this.showReadinessReport(id, saved, emit);
                if (shown && !readinessReport) readinessReport = shown;
                engineFindings.push(
                  ...topFindings(saved.report.findings).map((finding) => ({
                    severity: finding.severity,
                    dimension: finding.dimension,
                    entity: finding.namespace
                      ? `${finding.namespace}.${finding.entity ?? ''}`
                      : (finding.entity ?? saved.report.datasourceName),
                    ...(finding.field ? { field: finding.field } : {}),
                    description: finding.description,
                  })),
                );
              }
              const shown = engineFindings.slice(0, DATA_QUALITY_FINDINGS_CAP);
              const reply = shown.length
                ? await this.deps.mastra.checkDataQuality(
                    {
                      question,
                      sql: queries.map((query) => query.sql),
                      tables: measured.tables,
                      findings: shown,
                    },
                    stepModelOf(DATA_READINESS_AGENT_KEY),
                  )
                : { issues: [], stopped: false };
              if (reply.stopped || turn.signal.aborted) return stop();
              const findings = dataQualityFindings({
                tables: measured.tables,
                findings: shown,
                issues: reply.issues,
              });
              measured.issues = findings.filter((f) => !f.passed).length;
              return { findings, dataQuality: measured, stopped: false };
            } catch (error) {
              if (turn.signal.aborted) return stop();
              const reason =
                error instanceof Error ? error.message : String(error);
              return {
                findings: [dataQualityFailure(reason)],
                dataQuality: { ...measured, error: reason },
                stopped: false,
              };
            }
          },
          // v2's follow-up branch (roadmap 1.27.8): the earlier queries,
          // Nathan's reading of the words, the page and the answer.
          followUp,
          interpretFollowUp: async (request) => {
            try {
              const spec = await this.deps.mastra.interpretResult(request, {
                abortSignal: turn.signal,
                onExchange: stepModelOf(RESULT_EXPLORER_AGENT_KEY).onExchange,
              });
              return { spec, stopped: turn.signal.aborted };
            } catch (error) {
              if (turn.signal.aborted) return { spec: null, stopped: true };
              // The step plans the question instead; the reason is logged.
              this.deps.logger.warn(
                `Could not read the follow-up of ${session.id}: ${error instanceof Error ? error.message : String(error)}`,
              );
              throw error;
            }
          },
          // The page is an `explore_result` call of the turn: its record
          // (the source SQL, the page's rows) and its view as evidence, so
          // the answer's query opens the inspector on that view.
          pageResult: async ({ query, request, understood }) => {
            const target = followUp[query];
            if (!target)
              throw new Error('The earlier query is no longer known');
            const args = {
              query: target.sql,
              rationale: `I read ${understood.toLowerCase() === 'all rows' ? 'the rows' : understood} of the earlier result ${target.ref}.`,
            };
            calledTools.add('explore_result');
            emit({
              type: 'tool',
              content: JSON.stringify({
                name: 'explore_result',
                rationale: args.rationale,
                input: toolCallInput('explore_result', args),
              }),
            });
            const callId = `follow-up-${randomUUID()}`;
            const result = await pageExplorableQuery(
              target,
              request,
              understood,
              options.requestContext,
              callId,
            );
            const record = toolDataRecord('explore_result', args, result);
            if (record) captureRecord(record, callId);
            if ('error' in result) throw new Error(result.error);
            return {
              title: target.rationale ?? target.ref,
              columns: result.columns,
              rows: result.rows,
              page: result.page,
              pageCount: result.pageCount,
              matchedRows: result.matchedRows,
              capped: result.capped,
              view: result.view,
              understood: result.understood,
            };
          },
          deliverAnswer: (answer) => {
            text = answer;
            emit({ type: 'text', content: answer });
            return Promise.resolve();
          },
          writeAnswer: async (written) => {
            try {
              // Zoe's notes only when the run has images (agents.md 5.11).
              const result = await this.deps.mastra.writeAnswer(
                withImageNotes(written),
                {
                  ...stepModelOf(ANSWER_WRITER_AGENT_KEY),
                  onText: (delta) => {
                    text += delta;
                    emit({ type: 'text', content: delta });
                  },
                },
              );
              // The stored answer is the step's whole answer.
              if (result.answer.answer) text = result.answer.answer;
              return {
                answer: result.answer,
                stopped: result.stopped || turn.signal.aborted,
              };
            } catch (error) {
              throw await stepError(error);
            }
          },
          answer: async () => {
            await consume(await agent.stream(input, options));
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
          profile: async () => {
            const started = startedAssessment();
            try {
              return {
                ...(await started.profile({ signal: turn.signal })),
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
            // The answer carries the report: its card, and the scorecard
            // (data-readiness R5).
            const shown = await this.showReadinessReport(id, saved, emit);
            if (shown) readinessReport = shown;
            return { reportId: saved.report.id };
          },
          // Rows behind findings (roadmap 1.27.11; data-readiness R34): the
          // rows behind each top finding become the answer's first sources,
          // each shown as a SQL call and its result. Nothing reaches the
          // agent's prompt: the records only add sources to the answer.
          findingRows: async () => {
            if (!savedReport) throw new Error('The report has not been saved');
            return recordFindingSources({
              report: savedReport,
              run: (datasourceId, sql, limit) =>
                this.deps.sql.runBuiltSql(datasourceId, sql, limit),
              signal: turn.signal,
              record: (args, result, facts) => {
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
                const record = toolDataRecord('run_readonly_sql', args, result);
                if (record) captureRecord(record, callId);
              },
            });
          },
          explain: async ({ dataset, reportId, imageNotes }) => {
            // The run has assessed: the agent reads the stored report and
            // `assess_data_readiness` refuses (agents.md 3.13, 5.13).
            options.requestContext.set(ASSESSED_REPORT_CONTEXT_KEY, reportId);
            // Zoe's notes follow the report block only when the run has
            // images (agents.md 2.15, 5.13).
            const notes = imageNotesBlock(imageNotes);
            await consume(
              await agent.stream(input, {
                ...options,
                context: [
                  ...options.context,
                  {
                    role: 'system' as const,
                    content: explainReportBlock({ dataset, reportId }),
                  },
                  ...(notes
                    ? [{ role: 'system' as const, content: notes }]
                    : []),
                ],
              }),
            );
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
          readImages: async ({ question, images }) => {
            const loaded: StepImage[] = [];
            for (const path of images) {
              const { data, mediaType } = await this.deps.readImage(id, path);
              loaded.push({ data, mediaType });
            }
            try {
              const read = await this.deps.mastra.readImages(
                { question, images: loaded },
                stepModelOf(IMAGE_READER_AGENT_KEY),
              );
              return {
                ...read,
                stopped: read.stopped || turn.signal.aborted,
              };
            } catch (error) {
              throw await stepError(error);
            }
          },
          saveMappedDashboard: async ({ bundle, answer }) => {
            const metadata = await this.deps.saveMock(id, bundle, trimmed);
            showVisual(metadata);
            // The mapping's explanation is the run's answer.
            text = answer;
            emit({ type: 'text', content: text });
            return { visualId: metadata.id, title: metadata.title };
          },
        },
        (event) => onStepEvent?.(event),
      );
    } finally {
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
            resume: async (answer: string, io: TurnResumeIo) => {
              emit = io.emit;
              abortSignal = io.abortSignal;
              onStepEvent = io.onStepEvent;
              abortSignal?.addEventListener('abort', forwardAbort, {
                once: true,
              });
              let next: TurnRunOutcome;
              try {
                next = await resumeRun(answer);
              } finally {
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
      if (!v2 && !turn.signal.aborted && !clarification && !text && stream) {
        text = ((await stream.text) ?? '').trim();
      }
      if (
        !v2 &&
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
        });
      } else if (text.trim() || visualEvent || readinessReport) {
        const interpretation = interpretationLine(data, entities);
        // Careful mode only, and only when there is a result set to corroborate.
        // The assistant's only: another agent runs no SQL to cross-check.
        const crossChecked =
          careful && isAssistant && !turn.signal.aborted
            ? await this.deps.crossCheckAnswer(session, trimmed, data)
            : undefined;
        messages.push({
          role: 'assistant',
          content:
            text.trim() ||
            (visualEvent
              ? `${visualEvent.action === 'created' ? 'Created' : 'Updated'} interactive visual "${visualEvent.title}" (v${visualEvent.version}).`
              : readinessAnswerFallback(readinessReport!)),
          at: new Date().toISOString(),
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
  private async runTurnWorkflow(
    session: SessionDoc,
    workflow: TurnWorkflow,
    question: string,
    emit: (event: StreamEvent) => void,
    runtime: AnswerBusinessQuestionRuntime &
      Required<
        Pick<
          AnswerBusinessQuestionRuntime,
          | 'checkDataQuality'
          | 'interpretFollowUp'
          | 'pageResult'
          | 'deliverAnswer'
        >
      > &
      AgentTurnRuntime &
      DataReadinessAssessmentRuntime &
      RecreateDashboardRuntime &
      MapDashboardDataRuntime &
      ReadImagesRuntime,
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
    if (workflow.engineId === AGENT_TURN_WORKFLOW_ID) {
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
        save: () => captured(() => runtime.save()),
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
    } else {
      requestContext.set(ANSWER_BUSINESS_QUESTION_RUNTIME_KEY, {
        plan: (input) => captured(() => runtime.plan(input)),
        analyse: (input) => captured(() => runtime.analyse(input)),
        // Only a run host whose input ticked it (agents.md 5.11).
        checksDataQuality: session.checkDataQuality === true,
        checkDataQuality: (input) =>
          captured(() => runtime.checkDataQuality(input)),
        writeAnswer: (input) => captured(() => runtime.writeAnswer(input)),
        // A follow-up over an earlier result (roadmap 1.27.8). Nathan's
        // failure is no step's: the run plans the question instead.
        ...(runtime.followUp ? { followUp: runtime.followUp } : {}),
        interpretFollowUp: (input) => runtime.interpretFollowUp(input),
        pageResult: (input) => captured(() => runtime.pageResult(input)),
        deliverAnswer: (answer) => runtime.deliverAnswer(answer),
      } satisfies AnswerBusinessQuestionRuntime);
    }
    // Read images, the optional first step of every workflow but the
    // agent turn and Dashboard Image to Artifact (agents.md 2.15).
    const readsImages =
      workflow.engineId !== AGENT_TURN_WORKFLOW_ID && !recreate;
    if (readsImages) {
      requestContext.set(READ_IMAGES_RUNTIME_KEY, {
        readImages: (input) => captured(() => runtime.readImages(input)),
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
    const turnInput:
      | AnswerBusinessQuestionInput
      | { question: string; dataset: string; images?: string[] }
      | { question: string; image: string }
      | {
          question: string;
          artifact: string;
          datasets: string[];
          images?: string[];
        } = recreate
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
          ...(resumeRun
            ? {
                resume: (answer: string) =>
                  drive(
                    resumeRun({
                      step: path,
                      resumeData: { answer },
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
