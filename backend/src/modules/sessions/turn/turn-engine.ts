// The turn engine (agents.md 5.1): one turn of a session or run host, from
// the user's question to the persisted answer and the `done` event.
import type { Logger } from '@nestjs/common';
import { RequestContext } from '@mastra/core/request-context';
import { parseClarification } from '../../../mastra/tools/clarification.tool';
import type { MastraService } from '../../../mastra/mastra.service';
import { TURN_RECORDS_CONTEXT_KEY } from '../../../mastra/tools/visual.tools';
import { READINESS_REPORT_EVENT } from '../../../mastra/readiness-tool-services';
import {
  QTI_V2_TURN_RUNTIME_KEY,
  type QtiV2TurnInput,
  type QtiV2TurnRuntime,
} from '../../../mastra/workflows/qti-v2-turn.steps';
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
import {
  groundingNudge,
  statedRationale,
  synthesizeToolOnlyTurn,
  toolDataRecord,
  toolRecords,
} from '../turn-data';
import type {
  ChatMessage,
  CrossCheck,
  ReadinessReportRef,
  SessionDoc,
  SessionView,
  ToolDataRecord,
  VisualEvent,
  WorkflowPhase,
  WorkflowView,
} from '../entities/session.entity';
import {
  readinessProgressEvent,
  type RunStepEvent,
  type StreamEvent,
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
  analyseOutcomeOf,
  isTurnSummary,
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
}

export class TurnEngine {
  constructor(private readonly deps: TurnEngineDeps) {}

  /** The streamed turn itself, once the request reached the assistant. */
  async streamTurn(
    session: SessionDoc,
    trimmed: string,
    emit: (event: StreamEvent) => void,
    abortSignal: AbortSignal | undefined,
    activeVisualId: string | undefined,
    careful: boolean,
    onStepEvent?: (event: RunStepEvent) => void,
  ): Promise<void> {
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
            if (delta) {
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
              turn.abort();
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
            if (record) {
              data.push(record);
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
            }
          }
        }
      } catch (error) {
        if (!turn.signal.aborted) throw error;
      }
    };
    try {
      // Every streamed turn is one run of the session's workflow (agents.md
      // 5.1, ADR-0040). Its agent step streams the agent through `consume`:
      // v2's Analyse step (5.11, ADR-0034) or a one-step workflow's Answer.
      await this.runTurnWorkflow(
        session,
        turnWorkflowOf(session),
        trimmed,
        emit,
        {
          analyse: async ({ catalogBlock }) => {
            await consume(
              await agent.stream(input, {
                ...options,
                context: [
                  ...options.context,
                  { role: 'system' as const, content: catalogBlock },
                ],
              }),
            );
            // Any model error fails the step (agents.md 5.11).
            if (streamError !== undefined && !turn.signal.aborted) {
              throw await chatTurnError(streamError, () =>
                this.deps.llmService.getView(),
              );
            }
            return analyseOutcomeOf(data, turn.signal.aborted);
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
        },
        onStepEvent,
      );
    } finally {
      abortSignal?.removeEventListener('abort', forwardAbort);
    }
    if (!turn.signal.aborted && !clarification && !text && stream) {
      text = ((await stream.text) ?? '').trim();
    }
    if (
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
    if (clarification) {
      // The turn stops here, but the schema/sample work done before the
      // question is real work — keep it on the card instead of dropping it.
      messages.push({
        role: 'assistant',
        content: clarification.question,
        at: new Date().toISOString(),
        clarification,
        ...(data.length ? { data } : {}),
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
      emit({ type: 'done', session: await this.deps.toView(updated ?? fresh) });
    }
  }

  /**
   * Run one turn as a run of the session's workflow (agents.md 5.1, 5.11,
   * 5.12; ADR-0034, ADR-0040): `qti-v2-turn` hands its Analyse step
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
    runtime: QtiV2TurnRuntime & AgentTurnRuntime,
    onStepEvent?: (event: RunStepEvent) => void,
  ): Promise<void> {
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
    if (workflow.engineId === AGENT_TURN_WORKFLOW_ID) {
      requestContext.set(AGENT_TURN_RUNTIME_KEY, {
        answer: () => captured(() => runtime.answer()),
      } satisfies AgentTurnRuntime);
    } else {
      requestContext.set(QTI_V2_TURN_RUNTIME_KEY, {
        analyse: (input) => captured(() => runtime.analyse(input)),
      } satisfies QtiV2TurnRuntime);
    }
    const turnInput: QtiV2TurnInput = {
      question,
      datasets: session.datasets,
    };
    const run = await this.deps.mastra.streamWorkflow(
      workflow.engineId,
      turnInput,
      requestContext,
    );
    let state = session.workflowState;
    for await (const event of run.fullStream) {
      if (onStepEvent && stepEventOf(event)) onStepEvent(event);
      if (workflow.bar !== 'steps') continue;
      const stepEvent = stepEventOf(event);
      if (!stepEvent) continue;
      const next = workflowRunState(state, stepEvent, workflow.stepIds);
      if (!next) continue;
      state = next;
      await this.deps.updateDoc(session.id, { workflowState: state });
      session.workflowState = state;
      await this.emitWorkflow(session.id, emit);
    }
    const result = await run.result;
    if (result.status === 'failed') {
      const failure: unknown =
        stepError ?? result.error ?? new Error('The turn failed');
      throw failure;
    }
    if (result.status === 'success' && isTurnSummary(result.result)) {
      this.deps.logger.log(
        `Questions to Insights v2 turn in session ${session.id}: ${JSON.stringify(result.result)}`,
      );
    }
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
