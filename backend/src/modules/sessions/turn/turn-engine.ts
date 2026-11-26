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
import { TURN_RECORDS_CONTEXT_KEY } from '../../../mastra/tools/visual.tools';
import {
  ModelTimeoutError,
  streamIdleWatch,
} from '../../../mastra/workflows/model-call';
import type { WorkflowRunStream } from '../../../mastra/mastra.service';
import {
  ANALYSE_RETRY_MAX_STEPS,
  clarifyingQuestionOf,
  type AnalyseRuntime,
  type AnsweredClarification,
  type QuestionInput,
} from '../../../mastra/workflows/analysis.steps';
import { analyseSystemBlocks } from '../../../mastra/workflows/analysis.prompts';
import {
  AVERY_TEAM,
  ORCHESTRATOR_MODEL,
} from '../../../mastra/workflows/orchestrated-answer-michael.steps';
import {
  CONVERSATION_TURN_RUNTIME_KEY,
  type ConversationTurnRuntime,
} from '../../../mastra/workflows/conversation-turn.steps';
import { currentEvalRunId } from '../../../mastra/evals/eval-run-scope';
import type { ExportAuthor } from '../../conversation-export/export-document';
import { runSoloTurn, type SoloTurnState } from './solo-turn';
import type { ConversationalBinding } from '../../../mastra/conversational-agents';
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
import { asksForExport } from '../../../mastra/workflows/export-request';
import type {
  ConversationExporter,
  ConversationTurns,
} from '../../conversation-export/conversation-export.contract';
import { exportBrand } from '../../conversation-export/export-brand';
import {
  CLARA_AFTER_ACCEPT,
  DASHBOARD_TOOLS_RUNTIME_KEY,
  SOLO_AFTER_ACCEPT,
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
import {
  AGENT_OVERRIDES_CONTEXT_KEY,
  type AgentOverrides,
  resolveAgentModelConfig,
} from '../../../mastra/model-resolver';
import {
  STEP_MODEL_CONTEXT_KEY,
  TEAM_STEP_MODEL,
  servesClaude,
} from '../../../mastra/step-model';
import { turnProviderOptions } from './session-datasets';
import {
  AGENT_TURN_RUNTIME_KEY,
  AGENT_TURN_WORKFLOW_ID,
  type AgentTurnRuntime,
} from '../../../mastra/workflows/agent-turn.steps';
import type { LlmService } from '../../llm/llm.service';
import { chatTurnError } from '../llm-error-message';
import { sourceEntities } from '../visualization-document';
import { withVisualItems } from '../panel-items';
import { stepEventOf, workflowRunState } from '../workflow-run-state';
import {
  groundingNudge,
  statedRationale,
  synthesizeToolOnlyTurn,
  toolDataRecord,
  toolRecords,
} from '../turn-data';
import { evidenceOf } from '../query-evidence/query-evidence';
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
  SessionDoc,
  SessionView,
  ToolDataRecord,
  VisualEvent,
  WorkflowPhase,
  WorkflowView,
} from '../entities/session.entity';
import {
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
  attemptEarlierBlock,
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
  /**
   * A dashboard artifact's current version with its rows (agents.md 5.22,
   * the follow-up carry): what Clara changes. Throws when it is unknown.
   */
  dashboardVersion?(artifactId: string): Promise<DashboardVersionData>;
  /**
   * Avery's conversation export (agents.md 3.18): the earlier turns and the
   * files. Absent when its module is not loaded (the export stays closed).
   */
  conversationExporter?: ConversationExporter;
  /**
   * Save the dashboard Clara built (agents.md 5.22): a new artifact, or
   * the next version of `artifactId`; the run is its source.
   */
  saveDashboard?: (
    sessionId: string,
    input: Omit<NewDashboardVersion, 'source'> & { artifactId?: string },
  ) => Promise<DashboardRef>;
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

/** A dashboard submission the host accepted: what is saved. */
interface AcceptedDashboard {
  draft: DashboardDraft;
  query: DashboardQuery;
  columns: string[];
  rows: DashboardRow[];
}

/**
 * The conversational binding a turn runs on its engine (plan Elena 1.3):
 * Avery's or Elena's (a user agent's draft included, ADR-0059); undefined
 * for any other turn, a node chat of the same workflow included (it runs
 * on `agent-turn`).
 */
function conversationOfTurn(
  workflow: TurnWorkflow,
): ConversationalBinding | undefined {
  return workflow.binding;
}

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
    // to (agents.md 5.1, ADR-0028). A key no longer registered (a stored
    // session of a removed agent) runs as the assistant, as it reads.
    const agentKey =
      session.agentKey && this.deps.mastra.listAgents()[session.agentKey]
        ? session.agentKey
        : ASSISTANT_AGENT_KEY;
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
    const pendingCalls = new Map<string, Record<string, unknown>>();
    // Every tool name the model actually invoked this turn — the zero-SQL-
    // turn grounding guard below fires only when this stays empty.
    const calledTools = new Set<string>();
    // The model call's own failure: Mastra reports it as a chunk, not a throw.
    let streamError: unknown;
    // While Michael's analysis or Clara's build streams: its text, kept out
    // of the answer (Avery's is the run's).
    let notes: string | undefined;
    // While Michael's analysis streams: what a clarifying question stops
    // (the attempt's agent stream, not the turn).
    let attemptStop: AbortController | undefined;
    // Where Michael's current analysis attempt's records start: a resumed
    // attempt keeps the queries it ran before it asked.
    let attemptStart = 0;
    // The agent's clarifying questions this turn, each with the answer:
    // every later attempt goes on with them.
    const answers: AnsweredClarification[] = [];
    const workflow = turnWorkflowOf(session);
    // Answer a Business Question (Avery + Michael) (agents.md 1.3, 5.23):
    // when the saved model is served as a Claude model, the agents Avery
    // calls run on the team's step model (their model functions read it
    // from the context, and every call sends its effort), and she runs on
    // Opus 5.5 high. Elena, on a run host, runs on Opus 5.5 high herself
    // (plan Elena 2.5). Opus is for runs, never for evals: an eval runs
    // either on the saved model. Otherwise the saved model and effort, as
    // every agent.
    // A user agent's model override (ADR-0059) replaces that routing; an
    // effort-only override keeps Opus with the agent's effort.
    const conversation = conversationOfTurn(workflow);
    const orchestrated = conversation?.kind === 'team';
    const claude = servesClaude(await resolveAgentModelConfig());
    const opus = claude && currentEvalRunId() === undefined;
    const stepModel = orchestrated && claude ? TEAM_STEP_MODEL : undefined;
    const agentOverrides: AgentOverrides | undefined =
      options.requestContext.get(AGENT_OVERRIDES_CONTEXT_KEY);
    const soloModel =
      conversation?.kind === 'solo' &&
      session.run &&
      opus &&
      !agentOverrides?.model
        ? {
            ...ORCHESTRATOR_MODEL,
            ...(agentOverrides?.reasoningEffort
              ? { reasoningEffort: agentOverrides.reasoningEffort }
              : {}),
          }
        : undefined;
    if (soloModel) {
      options.requestContext.set(STEP_MODEL_CONTEXT_KEY, soloModel);
      options.providerOptions = await turnProviderOptions(
        { reasoningEffort: soloModel.reasoningEffort },
        soloModel.model,
      );
    }
    if (stepModel) {
      options.requestContext.set(STEP_MODEL_CONTEXT_KEY, stepModel);
      options.providerOptions = await turnProviderOptions(
        { reasoningEffort: stepModel.reasoningEffort },
        stepModel.model,
      );
    }
    const orchestratorModel =
      orchestrated && opus ? { ...ORCHESTRATOR_MODEL } : undefined;
    const orchestratorProviderOptions = orchestratorModel
      ? await turnProviderOptions(
          { reasoningEffort: orchestratorModel.reasoningEffort },
          orchestratorModel.model,
        )
      : (options.providerOptions as Record<string, unknown> | undefined);
    // What Avery's team (or Elena) produced: it outlives a wait for the user.
    const orchState: SoloTurnState = orchestratorState();
    // Elena's dashboard submitter (plan Elena 2.4): made on her first
    // attempt, so a resumed attempt keeps its last accepted submission.
    let soloSubmitter: ReturnType<TurnEngine['dashboardSubmitter']> | undefined;
    // A conversation's answer is its agent's (Avery's: Michael's, then her
    // closing words): no synthesis replaces it.
    const codeAnswer = conversation !== undefined;
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
    // A dashboard's data query the host ran (Clara's, Elena's), recorded as
    // a `run_readonly_sql` source with its facts, held until
    // submit_dashboard's result (5.20's hold).
    const holdQuery = (
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
    // Consume one agent stream (agents.md 5.1 step 3).
    const consume = async (
      agentStream: Awaited<ReturnType<typeof agent.stream>>,
    ): Promise<void> => {
      stream = agentStream;
      try {
        for await (const chunk of agentStream.fullStream) {
          if (chunk.type === 'error') {
            streamError ??= (chunk.payload as { error?: unknown }).error;
          } else if (chunk.type === 'reasoning-delta') {
            const delta = (chunk.payload as { text?: string }).text ?? '';
            if (delta) emit({ type: 'reasoning', content: delta });
          } else if (chunk.type === 'text-delta') {
            const delta = (chunk.payload as { text?: string }).text ?? '';
            if (delta && notes !== undefined) {
              // Michael's analysis or Clara's build: a note, not the answer.
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
    let ran: TurnRunOutcome;
    try {
      // Every streamed turn is one run of the session's workflow (agents.md
      // 5.1, ADR-0040). Its agent step streams the agent through `consume`:
      // v2's Analyse step (5.11, ADR-0034) or a one-step workflow's Answer.
      // The model error a step reports, in the chat stream's words.
      // A model timeout is thrown as it is (workflows R43).
      const stepError = async (error: unknown) =>
        error instanceof ModelTimeoutError
          ? error
          : chatTurnError(error, () => this.deps.llmService.getView());
      ran = await this.runTurnWorkflow(
        session,
        workflow,
        trimmed,
        // The current request's stream: a resumed turn reports to its own.
        (event) => emit(event),
        {
          // Michael's analysis (agents.md 5.11, 5.23): one attempt of his
          // agent turn with its tools, for Avery's answer_from_data.
          analyse: async ({ catalogBlock, planBlock, attempt, answered }) => {
            // A resumed attempt keeps the records it made before it asked,
            // and is shown their queries in one block under one cap
            // (agents.md 5.11).
            if (answered) answers.push(answered);
            else attemptStart = data.length;
            const earlier = answered
              ? attemptEarlierBlock(undefined, data.slice(attemptStart))
              : undefined;
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
            if (turn.signal.aborted) stop.abort();
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
                      // The catalog block and Avery's request, then the
                      // earlier-queries block on a resume (agents.md 5.11).
                      context: [
                        ...options.context,
                        ...analyseSystemBlocks({
                          catalogBlock,
                          planBlock,
                          earlierBlock: earlier,
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
              // A dashboard query Elena's submit ran counts as hers.
              flushHeldQueries();
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
            const submitter = this.dashboardSubmitter(
              session,
              turn.signal,
              holdQuery,
              CLARA_AFTER_ACCEPT,
            );
            options.requestContext.set(
              DASHBOARD_TOOLS_RUNTIME_KEY,
              submitter.runtime,
            );
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
            const accepted = submitter.accepted();
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
            try {
              const { ref, saved } = await this.saveAccepted(
                save,
                id,
                accepted,
                current,
                brief,
              );
              return { dashboard: ref, saved, reply, stopped: false };
            } catch (error) {
              return {
                reply,
                error: `the dashboard could not be saved: ${error instanceof Error ? error.message : String(error)}`,
                stopped: false,
              };
            }
          },
          // A conversation's turn (plan Elena 1.3): Avery's (agents.md 5.23)
          // calls the team as her tools; her answer is delivered once she
          // is done (only she talks to the user).
          converse: async (input, team: OrchestratorTeam) => {
            if (!conversation) {
              throw new Error('This conversation has no turn to run');
            }
            // The export's author: the conversation's agent (plan Elena 1.3).
            const author = {
              ...conversation.author,
              team: conversation.kind === 'team',
            };
            if (conversation.kind === 'solo') {
              // Elena alone (plan Elena 2.4): her gates, her attempt through
              // the analysis consumer, one repair round, her dashboard.
              const currentDashboard = await this.currentDashboardOf(session);
              const exporting = await this.exportOf(session, trimmed, author);
              // Try it saves no dashboard: its gate stays closed (ADR-0059).
              const save = session.preview
                ? undefined
                : this.deps.saveDashboard;
              if (save && !soloSubmitter) {
                soloSubmitter = this.dashboardSubmitter(
                  session,
                  turn.signal,
                  holdQuery,
                  SOLO_AFTER_ACCEPT,
                );
              }
              const submitter = soloSubmitter;
              const done = await runSoloTurn<AcceptedDashboard>(
                {
                  analyse: (attempt) => team.analyse(attempt),
                  state: orchState,
                  datasets: session.datasets,
                  signal: turn.signal,
                  requestContext: options.requestContext,
                  message: trimmed,
                  asksForDashboard: asksForDashboard(trimmed),
                  ...(currentDashboard ? { currentDashboard } : {}),
                  ...(save && submitter
                    ? {
                        dashboard: {
                          runtime: submitter.runtime,
                          accepted: () => submitter.accepted(),
                          save: (accepted, current, instruction) =>
                            this.saveAccepted(
                              save,
                              id,
                              accepted,
                              current,
                              instruction,
                            ),
                        },
                      }
                    : {}),
                  ...(exporting ? { exporting } : {}),
                  ...(session.contextQueries?.length
                    ? { earlierQueries: session.contextQueries }
                    : {}),
                },
                input,
              );
              if (!done.clarification && done.answer) {
                text = done.answer;
                emit({ type: 'text', content: done.answer });
              }
              return done;
            }
            // The conversation's dashboard (the follow-up carry, 5.22): its
            // current version, or none when it is gone or holds no query.
            const currentDashboard = await this.currentDashboardOf(session);
            // The export gate (2.21): the message asks to export the
            // conversation, and the run knows its conversation.
            const exporting = await this.exportOf(session, trimmed, author);
            const done = await runOrchestratorTurn(
              {
                getAgent: (key) => this.deps.mastra.getAgent(key),
                team: exporting
                  ? { ...team, exportConversation: exporting.run }
                  : team,
                state: orchState,
                emit: (event) => emit(event),
                signal: turn.signal,
                datasets: session.datasets,
                // The dashboard gate (2.21): the message asks for one, or
                // the conversation has one.
                buildsDashboard:
                  asksForDashboard(trimmed) || currentDashboard !== undefined,
                ...(currentDashboard ? { currentDashboard } : {}),
                exportsConversation: exporting !== undefined,
                ...(exporting ? { earlierTurns: exporting.turns } : {}),
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
                // Her tools (agents.md 5.23).
                tools: AVERY_TEAM.tools,
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
              // A resume stopped before it got here is aborted at once.
              if (abortSignal?.aborted) forwardAbort();
              else
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
        !visualEvent
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
      // The conversation Avery exported in this turn (agents.md 3.18).
      const exported = orchState.export;
      // A conversation's checks (data-model 3.4.1): the last attempt's.
      const checks =
        conversation && orchState.findings.length
          ? orchState.findings.map((finding) => ({ ...finding }))
          : undefined;
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
          ...(dashboard ? { dashboard } : {}),
          ...(exported ? { export: exported } : {}),
        });
      } else if (text.trim() || visualEvent || dashboard || exported) {
        const interpretation = interpretationLine(data, entities);
        messages.push({
          role: 'assistant',
          content:
            text.trim() ||
            (visualEvent
              ? `${visualEvent.action === 'created' ? 'Created' : 'Updated'} interactive visual "${visualEvent.title}" (v${visualEvent.version}).`
              : dashboard
                ? `${dashboard.action === 'created' ? 'Created' : 'Updated'} dashboard "${dashboard.title}" (version ${dashboard.version}).`
                : `Exported "${exported!.title}".`),
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
          ...(dashboard ? { dashboard } : {}),
          ...(exported ? { export: exported } : {}),
          ...(checks ? { checks } : {}),
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
   * 5.12; ADR-0034, ADR-0040): a conversation's engine hands its step
   * `runtime.converse`, `agent-turn` hands its Answer step `runtime.answer`.
   * Only a workflow whose steps drive the bar (`bar: 'steps'`) writes the
   * session's workflow state from the run's step events and emits each
   * change as `workflow`; a one-step workflow never does (agent-panel R15).
   * A failed step throws its own error, so the `error` event reads as the
   * agent's; a stopped turn ends at its agent step. A run host's turn also
   * hands every step event to `onStepEvent`, whatever the bar (agents.md
   * 5.14).
   */
  /**
   * The export a message to Avery opens (agents.md 2.21, 3.18): when it
   * asks to export the conversation and the run knows its conversation,
   * the conversation's earlier turns and the team call that makes the
   * files. None otherwise, or when the turns cannot be read.
   */
  private async exportOf(
    session: SessionDoc,
    message: string,
    author?: ExportAuthor,
  ): Promise<
    | {
        turns: ConversationTurns;
        run: NonNullable<OrchestratorTeam['exportConversation']>;
      }
    | undefined
  > {
    const conversation = session.contextConversation;
    const exporter = this.deps.conversationExporter;
    if (!conversation || !exporter || !asksForExport(message)) {
      return undefined;
    }
    let turns: ConversationTurns;
    try {
      turns = await exporter.turns(
        conversation.conversationId,
        conversation.runId,
      );
    } catch (error) {
      this.deps.logger.warn(
        `The conversation ${conversation.conversationId} cannot be read for an export: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
    return {
      turns,
      run: async (content) => {
        try {
          return {
            export: await exporter.export({
              conversationId: conversation.conversationId,
              beforeRunId: conversation.runId,
              content,
              brand: exportBrand(),
              ...(author ? { author } : {}),
            }),
          };
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    };
  }

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
   * The runtime submit_dashboard calls (agents.md 5.22): the host runs the
   * dashboard's data query (up to 5,000 rows, the turn's stop), holds it as
   * a source with `hold`, checks it and keeps the last accepted submission,
   * which `accepted()` reads once the agent's stream ends. Clara's build and
   * Elena's turn share it; `afterAccept` is what the accepted text asks next.
   */
  private dashboardSubmitter(
    session: SessionDoc,
    signal: AbortSignal,
    hold: (
      args: { sql: string; rationale: string },
      result: unknown,
      facts: QueryFacts,
    ) => void,
    afterAccept?: string,
  ): {
    runtime: DashboardToolsRuntime;
    accepted(): AcceptedDashboard | undefined;
  } {
    let accepted: AcceptedDashboard | undefined;
    const runtime: DashboardToolsRuntime = {
      ...(afterAccept ? { afterAccept } : {}),
      submit: async ({ dashboard: draft, sql, datasourceId, rationale }) => {
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
            { signal, maxRows: DASHBOARD_ROWS_CAP },
          );
        } catch (error) {
          // A query the stop cut short is no failed query.
          if (signal.aborted) throw error;
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
            ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
          },
          columns,
          rows,
        };
        return { accepted: true, rowCount: rows.length, columns };
      },
    };
    return { runtime, accepted: () => accepted };
  }

  /**
   * Save an accepted submission as the conversation's dashboard (agents.md
   * 5.22): a new version of `current` when there is one, else a new
   * dashboard; its ref and what the next message carries. Throws when the
   * save fails.
   */
  private async saveAccepted(
    save: NonNullable<TurnEngineDeps['saveDashboard']>,
    sessionId: string,
    accepted: AcceptedDashboard,
    current: CurrentDashboard | undefined,
    instruction: string,
  ): Promise<{ ref: DashboardRef; saved: CurrentDashboard }> {
    const blueprint = blueprintFromDraft(accepted.draft, accepted.rows);
    const ref = await save(sessionId, {
      ...(current ? { artifactId: current.artifactId } : {}),
      blueprint,
      query: accepted.query,
      columns: accepted.columns,
      rows: accepted.rows,
      instruction,
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
    return { ref, saved };
  }

  private async runTurnWorkflow(
    session: SessionDoc,
    workflow: TurnWorkflow,
    question: string,
    emit: (event: StreamEvent) => void,
    runtime: AnalyseRuntime &
      AgentTurnRuntime & {
        /** A conversation's turn: Avery's with her team (agents.md 5.23). */
        converse: (
          input: Parameters<ConversationTurnRuntime['turn']>[0],
          team: OrchestratorTeam,
        ) => ReturnType<ConversationTurnRuntime['turn']>;
        /** Clara's build, one of Avery's team calls (agents.md 5.22). */
        buildDashboard: NonNullable<OrchestratorTeam['buildDashboard']>;
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
    if (conversationOfTurn(workflow)) {
      // A conversation's engine (plan Elena 1.3): its one step runs the
      // agent's turn. Avery (agents.md 5.23) calls Michael's analysis and
      // Clara's build as her team.
      requestContext.set(CONVERSATION_TURN_RUNTIME_KEY, {
        turn: (input) =>
          captured(() =>
            runtime.converse(input, {
              analyse: (attempt) => runtime.analyse(attempt),
              buildDashboard: (built) => runtime.buildDashboard(built),
            }),
          ),
      } satisfies ConversationTurnRuntime);
    } else if (workflow.engineId === AGENT_TURN_WORKFLOW_ID) {
      requestContext.set(AGENT_TURN_RUNTIME_KEY, {
        answer: () => captured(() => runtime.answer()),
      } satisfies AgentTurnRuntime);
    }
    const turnInput: QuestionInput = {
      question,
      datasets: session.datasets,
    };
    let state = session.workflowState;
    // A new run starts the bar over at its first step event (agent-panel
    // R8a). A resume goes on.
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
