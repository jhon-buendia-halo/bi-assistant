import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { parseWorkflow } from '../../mastra/workflow-section';
import { agentPromptOverrideFor } from '../../mastra/agent-prompt-overrides';
import { assistantShippedPrompt } from '../../mastra/agents/assistant-prompt';
import { MastraService } from '../../mastra/mastra.service';
import { UserAgentsService } from '../user-agents/user-agents.service';
import type { AgentConfig } from '../user-agents/entities/user-agent.entity';
import { setDatasetToolServices } from '../../mastra/tool-services';
import type {
  PanelToolInput,
  PanelToolResult,
  DatasetToolTurnRecord,
  WorkflowToolInput,
  WorkflowToolResult,
} from '../../mastra/tool-services';
import { listSessionWorkspaceIds } from '../../mastra/session-workspaces';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { raceAbort } from '../datasources/connectors/connector';
import { LlmService } from '../llm/llm.service';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
import { MetricsService } from '../metrics/metrics.service';
import { OntologyService } from '../ontology/ontology.service';
import { SessionsRepository } from './repositories/sessions.repository';
import { VisualizationService } from './visualization.service';
import { ArtifactsService } from '../artifacts/artifacts.service';
import {
  CONVERSATION_EXPORTER,
  type ConversationExporter,
} from '../conversation-export/conversation-export.contract';
import {
  buildPanelItem,
  tableCsv,
  titleSlug,
  upsertPanelItem,
  visualItemId,
  withVisualItems,
} from './panel-items';
import { applyWorkflowUpdate, workflowViewOf } from './workflow-update';
import {
  ASSISTANT_WORKFLOW_NAME,
  REMOVED_WORKFLOW_NAMES,
  isRemovedWorkflowId,
  parseWorkflowId,
  sessionWorkflowId,
  WRAPPED_AGENT_KEYS,
} from '../../mastra/workflows/workflow-catalog';
import { renderPdf } from '../../common/markdown-pdf';
import {
  WorkspaceFileError,
  readWorkspaceFile,
  readWorkspaceImage,
  writeWorkspaceFile,
} from './workspace-files';
import {
  ChatMessage,
  CrossCheck,
  FilePanelItem,
  InteractiveVisualization,
  MessageFeedback,
  PanelItem,
  SessionAgentRef,
  SessionDoc,
  SessionView,
  SessionVisualization,
  SessionWorkflowRef,
  ToolDataRecord,
  VisualEvent,
  WorkflowPhase,
  WorkflowView,
} from './entities/session.entity';
import { QueryEvidenceService } from './query-evidence/query-evidence.service';
import type { ExplorableQuery } from './query-evidence/explorable-queries';
import { SessionDatasets } from './turn/session-datasets';
import { SqlChecks } from './turn/sql-checks';
import { TurnEngine } from './turn/turn-engine';
import { TurnOptions } from './turn/turn-options';
import type {
  RunStepEvent,
  StreamEvent,
  TurnSuspension,
} from './turn/stream-events';
import { ASSISTANT_AGENT_KEY, lastSuccessfulSql } from './turn/turn-records';
import { workflowSourceOf } from './turn/turn-workflow';

export type {
  RunStepEvent,
  StreamEvent,
  TurnResumeIo,
  TurnSuspension,
} from './turn/stream-events';
export { toolCallInput } from './turn/turn-records';

/** Id prefix of an agent editor's preview session (agents-evals R60). */
const PREVIEW_ID_PREFIX = 'preview-';
/** Id prefix of a run host: `run-<run id>` (ADR-0041; agents.md 5.14). */
export const RUN_HOST_ID_PREFIX = 'run-';

/**
 * What a run host is created from (agents.md 5.14): the run, the workflow it
 * runs, the input's datasets, and the one earlier run given as
 * context (plan 5.4).
 */
/** A visual action on a run-backed host (api.md 130-134). */
export type RunVisualAction =
  | { kind: 'create'; sourceMessageAt?: string }
  | { kind: 'tailor'; visualId: string; instruction: string }
  | { kind: 'revert'; visualId: string; version: number }
  | { kind: 'refresh'; visualId: string }
  | { kind: 'repair'; visualId: string; error: string; version: number };

/** What `runVisualAction` answers: the caller stores it on the run. */
export interface RunVisualOutcome {
  metadata: SessionVisualization;
  version: number;
  event?: VisualEvent;
  /** The host's panel items with the visual's item shown. */
  panelItems: PanelItem[];
}

export interface RunHostSpec {
  runId: string;
  /**
   * The catalogue workflow the run runs (`orchestrated-answer-michael`, ...). Unused for an agent
   * host (`agentKey`) and a draft run (`draftAgentId`).
   */
  workflowId?: string;
  /**
   * An agent host (the eval runner): the built-in agent (`assistant`)
   * whose turn the host runs on the agent-turn engine, with no catalogue
   * workflow behind it.
   */
  agentKey?: string;
  /** The workflow's or the agent's name: the host's name. */
  name: string;
  /** The input's datasets. */
  datasets?: string[];
  /** The earlier run's question and answer, put before this run's question. */
  context?: { question: string; answer: string };
  /**
   * Earlier messages put before the turn's message instead of `context`: a
   * node chat's earlier messages (agents.md 5.16).
   */
  transcript?: { role: 'user' | 'assistant'; content: string }[];
  /** A system block every turn of the host gets (agents.md 5.16). */
  contextBlock?: string;
  /**
   * The earlier queries the host's turn may explore with `explore_result`
   * (agents.md 3.15, 4.2): a follow-up run's earlier answer's, a node chat's
   * run's and earlier turns'.
   */
  contextQueries?: ExplorableQuery[];
  /**
   * Every image file of the run's input (R35): each written to the host's
   * workspace at `path` before the turn.
   */
  inputFiles?: { path: string; data: Buffer }[];
  /**
   * A message to Avery in a conversation that holds a dashboard (agents.md
   * 5.22): the artifact's id, whose current version Clara changes.
   */
  contextDashboard?: string;
  /**
   * A run of Avery's (workflows R45): its conversation, which her export
   * reads (agents.md 3.18).
   */
  conversationId?: string;
  /**
   * A follow-up run (agents.md 5.14): the earlier run's host id, whose
   * memory threads the host starts from as copies of its own.
   */
  continuesThreadsOf?: string;
  /**
   * A draft run (agents-evals R60): the user agent whose saved draft the host
   * runs, as a preview does. `workflowId` is then unused.
   */
  draftAgentId?: string;
}

@Injectable()
export class SessionsService implements OnModuleInit {
  private readonly logger = new Logger(SessionsService.name);

  /**
   * The sessions held in memory only and never in the sessions collection:
   * the agent editor's previews (agents-evals R61, data-model 3.12) and run
   * hosts (agents.md 5.14).
   */
  private readonly memoryHosts = new Map<string, SessionDoc>();

  constructor(
    private readonly repository: SessionsRepository,
    private readonly mastra: MastraService,
    private readonly datasetsRepository: DatasetsRepository,
    private readonly datasourcesService: DatasourcesService,
    private readonly llmService: LlmService,
    private readonly visuals: VisualizationService,
    private readonly verifiedQueries: VerifiedQueriesService,
    private readonly metrics: MetricsService,
    // The dataset ontology, rendered as the curated-knowledge block.
    private readonly knowledge: OntologyService,
    private readonly userAgents: UserAgentsService,
    // The saved dashboards a run takes and Clara's dashboards (agents.md
    // 5.20, 5.22).
    @Optional() private readonly artifacts?: ArtifactsService,
    // Avery's conversation export (agents.md 3.18), a global module's.
    @Optional()
    @Inject(CONVERSATION_EXPORTER)
    private readonly conversationExporter?: ConversationExporter,
  ) {
    // The turn engine (agents.md 5.1) lives in `./turn/`, built on this
    // service's own dependencies and its session reads and writes.
    this.turnDatasets = new SessionDatasets(
      datasetsRepository,
      datasourcesService,
    );
    this.queryEvidence = new QueryEvidenceService(
      datasetsRepository,
      datasourcesService,
    );
    this.sqlChecks = new SqlChecks({
      mastra,
      datasourcesService,
      llmService,
      verifiedQueries,
      datasets: this.turnDatasets,
      logger: this.logger,
    });
    this.turnOptions = new TurnOptions({
      mastra,
      llmService,
      visuals,
      verifiedQueries,
      metrics,
      knowledge,
      userAgents,
      datasets: this.turnDatasets,
      logger: this.logger,
      existingDatasets: (names) => this.existingDatasets(names),
      updateDoc: (id, patch) => this.updateDoc(id, patch),
    });
    this.turns = new TurnEngine({
      mastra,
      llmService,
      logger: this.logger,
      options: this.turnOptions,
      sql: this.sqlChecks,
      get: (id) => this.get(id),
      updateDoc: (id, patch) => this.updateDoc(id, patch),
      toView: (session) => this.toView(session),
      workflowOf: (session) => this.workflowOf(session),
      effectiveWorkflowFor: (session) => this.effectiveWorkflowFor(session),
      crossCheckAnswer: (session, question, data, signal) =>
        this.crossCheckAnswer(session, question, data, signal),
      dashboardVersion: (artifactId) => {
        if (!this.artifacts) throw new Error('Artifacts are not available');
        return this.artifacts.dashboardVersion(artifactId);
      },
      ...(conversationExporter ? { conversationExporter } : {}),
      // Clara's dashboard (agents.md 5.22): the conversation's first one is
      // a new artifact, a later one the next version of the same artifact.
      saveDashboard: async (sessionId, { artifactId, ...version }) => {
        if (!this.artifacts) throw new Error('Artifacts are not available');
        const session = await this.get(sessionId);
        // A run host is `run-<run id>`: the version names its run.
        const input = {
          ...version,
          ...(sessionId.startsWith(RUN_HOST_ID_PREFIX)
            ? {
                source: {
                  runId: sessionId.slice(RUN_HOST_ID_PREFIX.length),
                  workflowId: session.workflowId ?? '',
                },
              }
            : {}),
        };
        return artifactId
          ? this.artifacts.addDashboardVersion(artifactId, input)
          : this.artifacts.createDashboard(input);
      },
    });
  }

  /** The session's datasets, bound to their datasources. */
  private readonly turnDatasets: SessionDatasets;
  /** The query inspector's page path, which `explore_result` pages through. */
  private readonly queryEvidence: QueryEvidenceService;
  /** SQL repair, careful mode's cross-check and the Verified badge. */
  private readonly sqlChecks: SqlChecks;
  /** What reaches the model on a turn. */
  private readonly turnOptions: TurnOptions;
  /** The streamed and non-streamed turn. */
  private readonly turns: TurnEngine;

  async onModuleInit(): Promise<void> {
    // Install the DI bridge the Mastra tools use (they load with no Nest DI).
    setDatasetToolServices({
      getDatasets: (names) => this.turnDatasets.bound(names),
      // The tool call's stop (agents.md 3.3): `sampleRows` takes no signal,
      // so the call ends at once and the capped sample is left to finish.
      sampleRows: (datasourceId, entity, limit, options) => {
        const sample = this.datasourcesService.sampleRows(
          datasourceId,
          entity,
          limit,
        );
        return options?.signal ? raceAbort(sample, options.signal) : sample;
      },
      // The statement and its repair get the tool call's stop (agents.md 3.4).
      runReadOnlySql: (datasourceId, sql, limit, datasets, options) =>
        options
          ? this.sqlChecks.runSqlWithRepair(
              datasourceId,
              sql,
              limit,
              datasets,
              options,
            )
          : this.sqlChecks.runSqlWithRepair(datasourceId, sql, limit, datasets),
      // `explore_result` (agents.md 3.15): the inspector's own page path.
      // `pageOf` takes no signal, so the tool call's stop ends the call at
      // once and the page statement is left to finish (agents.md 3.3).
      pageQuery: (source, datasets, request, options) => {
        const page = this.queryEvidence.pageOf(source, datasets, request);
        return options?.signal ? raceAbort(page, options.signal) : page;
      },
      interpretResult: (input, options) =>
        options?.abortSignal
          ? this.mastra.interpretResult(input, {
              abortSignal: options.abortSignal,
            })
          : this.mastra.interpretResult(input),
      createVisual: async (
        sessionId,
        sourceMessageAt,
        instruction,
        turnRecords,
      ) => {
        const session = await this.get(sessionId);
        const { metadata } = await this.visuals.create(
          session,
          sourceMessageAt,
          instruction,
          turnRecords,
        );
        await this.saveVisualMetadata(session, metadata);
        return this.toolResult(metadata);
      },
      updateVisual: async (sessionId, visualId, instruction, turnRecords) => {
        const session = await this.get(sessionId);
        const { metadata } = await this.visuals.update(
          session,
          visualId,
          instruction,
          turnRecords,
        );
        await this.saveVisualMetadata(session, metadata);
        return this.toolResult(metadata);
      },
      showPanelItem: (sessionId, input, turnRecords) =>
        this.showPanelItem(sessionId, input, turnRecords),
      updateWorkflow: (sessionId, input) =>
        this.updateWorkflow(sessionId, input),
    });

    // A preview or a run host left when the app stopped has no session left
    // to own its memory and workspace (agents-evals R61; agents.md 5.14).
    await this.sweepMemoryHosts();

    // Backfill workspaces for sessions created before workspace support and
    // restore their registrations after every process restart.
    const sessions = await this.repository.listAll();
    await Promise.all(
      sessions.map(async (session) => {
        const workspace = await this.mastra.ensureSessionWorkspace(
          session.id,
          session.name,
        );
        if (session.workspaceId !== workspace.id) {
          await this.repository.setWorkspaceId(session.id, workspace.id);
        }
      }),
    );
  }

  /**
   * Careful mode's cross-check (agents.md 5.4), the seam the turn engine
   * reaches it through; `signal` is the turn's stop.
   */
  private crossCheckAnswer(
    session: SessionDoc,
    question: string,
    data: ToolDataRecord[],
    signal?: AbortSignal,
  ): Promise<CrossCheck | undefined> {
    return this.sqlChecks.crossCheckAnswer(session, question, data, signal);
  }

  list(): Promise<SessionDoc[]> {
    return this.repository.list();
  }

  /**
   * The current user's session (or preview) with this id. Another user's
   * answers as not found (admin R30); every route and tool that reaches a
   * session's memory thread or workspace goes through here first.
   */
  async get(id: string): Promise<SessionDoc> {
    const held = this.memoryHosts.get(id);
    if (held) return { ...held };
    const session = await this.repository.get(id);
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return session;
  }

  /**
   * Write message `index` of session `id` back (api.md 144-146: the query
   * evidence a past chat caches). The session is re-read first; a stored
   * session keeps its `updatedAt`, so the past chats keep their order. The
   * caller serialises writes to one session.
   */
  async saveMessage(
    id: string,
    index: number,
    message: ChatMessage,
  ): Promise<void> {
    const session = await this.get(id);
    const messages = session.messages.map((m, i) =>
      i === index ? message : m,
    );
    if (this.memoryHosts.has(id)) {
      await this.updateDoc(id, { messages });
      return;
    }
    await this.repository.updateMessages(id, messages);
  }

  /** Delete a session and all Mastra state owned exclusively by it. */
  async delete(id: string): Promise<SessionDoc> {
    const session = await this.get(id);
    await this.mastra.deleteSessionResources(id);
    if (this.memoryHosts.has(id)) {
      this.memoryHosts.delete(id);
      return session;
    }
    const removed = await this.repository.delete(id);
    if (removed === 0) throw new NotFoundException(`Session ${id} not found`);
    return session;
  }

  /**
   * A run host (ADR-0041; agents.md 5.14): the in-memory session one run
   * executes its agent turn on, shaped as `POST /sessions` would shape a
   * session of it: bound to the catalogue workflow's agent (`workflowId`)
   * or, for the eval runner, to a built-in agent directly (`agentKey`: the
   * assistant over the given datasets), with, as its transcript, the earlier
   * run's question and answer (plan 5.4). 404 for a workflow the catalogue
   * does not hold (an `agent:` id, `seq-text-demo`, `deep-analysis`) or an
   * agent that has no agent-turn binding. Its workspace is
   * `session-run-<run id>`, created as a session's. Never stored or listed.
   */
  async createRunHost(spec: RunHostSpec): Promise<SessionDoc> {
    if (spec.draftAgentId) return this.createDraftRunHost(spec);
    let binding: Pick<SessionDoc, 'agentKey' | 'agentId' | 'agentName'> = {};
    let codeWorkflowId: string | undefined;
    const datasets = spec.datasets ?? [];
    if (spec.agentKey !== undefined) {
      const key = spec.agentKey;
      const agent = WRAPPED_AGENT_KEYS.includes(key)
        ? this.mastra.listAgents()[key]
        : undefined;
      if (!agent) throw new NotFoundException(`Agent "${key}" not found`);
      if (key !== ASSISTANT_AGENT_KEY) {
        binding = { agentKey: key, agentName: agent.name ?? key };
      }
    } else {
      const parsed = spec.workflowId
        ? parseWorkflowId(spec.workflowId)
        : undefined;
      // A code workflow runs for its `primaryFor` agent; a built-in agent's
      // conversation (plan Elena 1.3) on its binding's host agent.
      const primary =
        parsed?.kind === 'code'
          ? parsed.source.primaryFor
          : parsed?.kind === 'conversation'
            ? parsed.binding.hostAgentKey
            : undefined;
      const agent = primary ? this.mastra.listAgents()[primary] : undefined;
      if (!primary || !agent) {
        throw new NotFoundException(`Workflow "${spec.workflowId}" not found`);
      }
      binding = { agentKey: primary, agentName: agent.name ?? primary };
      // The run's own workflow: an agent can run more than one.
      codeWorkflowId =
        parsed?.kind === 'code'
          ? parsed.source.id
          : parsed?.kind === 'conversation'
            ? parsed.binding.workflowId
            : undefined;
    }
    const id = `${RUN_HOST_ID_PREFIX}${spec.runId}`;
    const name = spec.name.slice(0, 64);
    const workspace = await this.mastra.ensureSessionWorkspace(id, name);
    const now = new Date().toISOString();
    const host: SessionDoc = {
      id,
      name,
      workspaceId: workspace.id,
      datasets,
      ...binding,
      workflowId: codeWorkflowId ?? sessionWorkflowId(binding),
      run: true,
      messages: spec.transcript
        ? spec.transcript.map((message) => ({ ...message, at: now }))
        : spec.context
          ? [
              { role: 'user', content: spec.context.question, at: now },
              { role: 'assistant', content: spec.context.answer, at: now },
            ]
          : [],
      ...(spec.contextBlock ? { contextBlock: spec.contextBlock } : {}),
      ...(spec.contextQueries?.length
        ? { contextQueries: spec.contextQueries }
        : {}),
      ...(spec.contextDashboard
        ? { contextDashboard: spec.contextDashboard }
        : {}),
      ...(spec.conversationId
        ? {
            contextConversation: {
              conversationId: spec.conversationId,
              runId: spec.runId,
            },
          }
        : {}),
      visualizations: [],
      createdAt: now,
      updatedAt: now,
    };
    for (const { path, data } of spec.inputFiles ?? []) {
      await writeWorkspaceFile(id, path, data);
    }
    if (spec.continuesThreadsOf) {
      try {
        const copied = await this.mastra.copyMemoryResource(
          spec.continuesThreadsOf,
          id,
        );
        if (copied > 0) host.continuesThreads = true;
      } catch (error) {
        // The run still goes on, from the earlier run's transcript alone.
        this.logger.warn(
          `Could not copy the memory threads of ${spec.continuesThreadsOf} to ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    this.memoryHosts.set(id, host);
    return { ...host };
  }

  /**
   * What a draft run (api.md R12) runs on: the user agent's saved draft, its
   * name and the datasets of it that exist. 404 for an unknown agent; 400
   * `Select at least one dataset to preview` when none exists.
   */
  async draftRunTarget(
    agentId: string,
  ): Promise<{ name: string; role: string; datasets: string[] }> {
    const agent = await this.userAgents.get(agentId);
    if (!agent) throw new NotFoundException(`Agent "${agentId}" not found`);
    const datasets = await this.existingDatasets(agent.draft.datasets);
    if (!datasets.length) {
      throw new BadRequestException('Select at least one dataset to preview');
    }
    return { name: agent.draft.name, role: agent.draft.role ?? '', datasets };
  }

  /**
   * The run host of a draft run: a preview-shaped session (it runs the
   * draft's instructions, model, tools and skills) that is also a run host,
   * so the turn path and its clean-up are a run's. Never stored or listed.
   */
  private async createDraftRunHost(spec: RunHostSpec): Promise<SessionDoc> {
    const agentId = spec.draftAgentId as string;
    const target = await this.draftRunTarget(agentId);
    const id = `${RUN_HOST_ID_PREFIX}${spec.runId}`;
    const name = spec.name.slice(0, 64);
    const workspace = await this.mastra.ensureSessionWorkspace(id, name);
    const now = new Date().toISOString();
    const host: SessionDoc = {
      id,
      name,
      workspaceId: workspace.id,
      datasets: target.datasets,
      agentId,
      agentName: target.name,
      workflowId: sessionWorkflowId({ agentId }),
      preview: true,
      run: true,
      messages: [],
      ...(spec.contextQueries?.length
        ? { contextQueries: spec.contextQueries }
        : {}),
      visualizations: [],
      createdAt: now,
      updatedAt: now,
    };
    this.memoryHosts.set(id, host);
    return { ...host };
  }

  /**
   * The run host's agent turn (agents.md 5.14): today's streamed turn,
   * unchanged (5.1), on the host. Every step event of the turn's workflow
   * run goes to `onStepEvent`, whatever the workflow's bar. A turn whose
   * workflow waits for the user (ADR-0043) answers its suspension: the host
   * stays in memory until the turn is resumed or discarded.
   */
  async streamRunTurn(
    hostId: string,
    question: string,
    emit: (event: StreamEvent) => void,
    abortSignal: AbortSignal | undefined,
    careful: boolean,
    onStepEvent: (event: RunStepEvent) => void,
  ): Promise<TurnSuspension | undefined> {
    const host = this.memoryHosts.get(hostId);
    if (!host?.run) throw new NotFoundException(`Session ${hostId} not found`);
    const trimmed = (question ?? '').trim();
    if (!trimmed) throw new BadRequestException('message is required');
    return this.turns.streamTurn(
      { ...host },
      trimmed,
      emit,
      abortSignal,
      undefined,
      careful,
      onStepEvent,
      true,
    );
  }

  /**
   * A run host as the API shows a session, while its run waits for the
   * user (ADR-0043): the host stays in memory.
   */
  async runHostView(hostId: string): Promise<SessionView> {
    const host = this.memoryHosts.get(hostId);
    if (!host?.run) throw new NotFoundException(`Session ${hostId} not found`);
    return this.toView({ ...host });
  }

  /**
   * End a run host (agents.md 5.14): answer it as the API shows a session
   * (its messages, derived panel items and workflow view) and let it leave
   * memory. Its workspace and its memory threads stay, owned by the run,
   * until the run is deleted (`deleteRunHostResources`).
   */
  async finishRunHost(hostId: string): Promise<SessionView> {
    const host = this.memoryHosts.get(hostId);
    if (!host?.run) throw new NotFoundException(`Session ${hostId} not found`);
    try {
      return await this.toView({ ...host });
    } finally {
      this.memoryHosts.delete(hostId);
    }
  }

  /**
   * Start a run host's memory thread as a copy of another thread (a node
   * chat about the step that ran on its run's host, agents.md 5.16). False
   * when there was nothing to copy or the copy failed; the turn then starts
   * from its transcript alone.
   */
  async startRunHostThreadFrom(
    hostId: string,
    sourceThreadId: string,
  ): Promise<boolean> {
    try {
      return await this.mastra.copyMemoryThread(sourceThreadId, hostId);
    } catch (error) {
      this.logger.warn(
        `Could not copy the memory thread ${sourceThreadId} to ${hostId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Delete a run host's workspace only (a node chat's turn, agents.md 5.16):
   * its memory thread stays for the chat's next turn.
   */
  async deleteRunHostWorkspace(hostId: string): Promise<void> {
    if (!hostId.startsWith(RUN_HOST_ID_PREFIX)) return;
    this.memoryHosts.delete(hostId);
    await this.mastra.deleteSessionWorkspace(hostId);
  }

  /**
   * A run's input image, from its host's workspace (api.md 151): what a
   * follow-up run reads to run on the same image.
   */
  async runHostImage(
    hostId: string,
    path: string,
  ): Promise<{ data: Buffer; mediaType: string }> {
    return readWorkspaceImage(hostId, path);
  }

  /**
   * Write a file into a run host's workspace: a queued run's input images,
   * as 119 accepts it (read back when it starts, `runHostImage`).
   */
  async writeRunHostFile(
    hostId: string,
    path: string,
    data: Buffer,
  ): Promise<void> {
    await writeWorkspaceFile(hostId, path, data);
  }

  /**
   * Delete a run host's workspace and memory threads (agents.md 5.14): when
   * its run is deleted, or at start-up for a workspace no stored run owns.
   */
  async deleteRunHostResources(hostId: string): Promise<void> {
    if (!hostId.startsWith(RUN_HOST_ID_PREFIX)) return;
    this.memoryHosts.delete(hostId);
    await this.mastra.deleteSessionResources(hostId);
  }

  /**
   * The run host ids (`run-<run id>`) that have a workspace on disk, for
   * the runs' start-up recovery (agents.md 5.14). Throws when the
   * workspaces directory can't be read.
   */
  runHostWorkspaceIds(): string[] {
    return listSessionWorkspaceIds().filter((id) =>
      id.startsWith(RUN_HOST_ID_PREFIX),
    );
  }

  /**
   * Discard what previews (R61) left behind when the app last stopped: their
   * memory threads and workspaces. A run host's workspace belongs to its
   * stored run (data-model 3.16), so it is never swept here; the runs'
   * start-up recovery deletes the ones no run owns.
   */
  private async sweepMemoryHosts(): Promise<void> {
    let ids: string[] = [];
    try {
      ids = listSessionWorkspaceIds().filter((id) =>
        id.startsWith(PREVIEW_ID_PREFIX),
      );
    } catch {
      return;
    }
    for (const id of ids) {
      try {
        await this.mastra.deleteSessionResources(id);
      } catch (error) {
        this.logger.warn(
          `Could not discard the in-memory session ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /** `names` without the datasets that no longer exist, in order. */
  private async existingDatasets(names: string[]): Promise<string[]> {
    const existing = await this.userAgents.datasetNames();
    return names.filter((name) => existing.has(name));
  }

  /** Persist a patch: in memory for a preview or a run host, else in the sessions store. */
  private async updateDoc(
    id: string,
    patch: Partial<SessionDoc>,
  ): Promise<SessionDoc | null> {
    const held = this.memoryHosts.get(id);
    if (!held) return this.repository.update(id, patch);
    const updated = {
      ...held,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.memoryHosts.set(id, updated);
    return { ...updated };
  }

  /**
   * A session as the API returns it: the stored document plus the derived
   * `agent`, `workflow` and the full `panelItems` list (api.md 2.1). Computed
   * on every read, never stored.
   */
  async toView(stored: SessionDoc): Promise<SessionView> {
    const session = this.readable(stored);
    if (session.agentKey) {
      return this.viewOf(session, this.builtinAgentRef(session));
    }
    if (!session.agentId) return this.viewOf(session);
    const doc = await this.userAgents.get(session.agentId);
    // A preview shows the draft it runs (api.md 2.1).
    const config = session.preview ? doc?.draft : doc?.live;
    return this.viewOf(session, agentRef(session, config), config);
  }

  /** `toView` for a list, reading the agents once. */
  async toViews(sessions: SessionDoc[]): Promise<SessionView[]> {
    const agents = sessions.some((session) => session.agentId)
      ? new Map((await this.userAgents.list()).map((doc) => [doc.id, doc.live]))
      : new Map<string, AgentConfig | undefined>();
    return sessions.map((stored) => {
      const session = this.readable(stored);
      if (session.agentKey) {
        return this.viewOf(session, this.builtinAgentRef(session));
      }
      if (!session.agentId) return this.viewOf(session);
      const config = agents.get(session.agentId);
      return this.viewOf(session, agentRef(session, config), config);
    });
  }

  /**
   * A stored session as this version reads it: a built-in agent key that is
   * no longer registered (the removed RFP Builder, `rfp`) is ignored with its
   * name and its one-step workflow id, and a legacy `rfpId` is dropped, so the
   * session reads as a plain Assistant session. The readiness report an
   * answer of the removed Data Readiness Agent carried (`readinessReport`)
   * is dropped too. Nothing is rewritten in the store.
   */
  private readable(session: SessionDoc): SessionDoc {
    const legacy = session as SessionDoc & { rfpId?: unknown };
    const key = session.agentKey;
    const orphan = !!key && !this.mastra.listAgents()[key];
    const hasReport = (message: ChatMessage) => 'readinessReport' in message;
    const reports = session.messages.some(hasReport);
    if (!orphan && legacy.rfpId === undefined && !reports) return session;
    const copy: SessionDoc & { rfpId?: unknown } = { ...session };
    delete copy.rfpId;
    if (reports) {
      copy.messages = session.messages.map((message) => {
        if (!hasReport(message)) return message;
        const rest: ChatMessage & { readinessReport?: unknown } = {
          ...message,
        };
        delete rest.readinessReport;
        return rest;
      });
    }
    if (orphan) {
      delete copy.agentKey;
      delete copy.agentName;
      if (copy.workflowId === `agent:${key}`) delete copy.workflowId;
    }
    return copy;
  }

  private viewOf(
    session: SessionDoc,
    agent?: SessionAgentRef,
    config?: AgentConfig,
  ): SessionView {
    const workflow = workflowViewOf(
      this.effectiveWorkflowFor(session, config),
      session.workflowState,
      workflowSourceOf(session),
    );
    return {
      ...session,
      ...(agent ? { agent } : {}),
      workflowRef: this.workflowRefOf(session, config),
      panelItems: withVisualItems(session),
      ...(workflow ? { workflow } : {}),
    };
  }

  /**
   * The workflow a session runs, as the API shows it (api.md 2.1): its
   * stored or derived id (agents.md 5.12) and the catalogue name. A user
   * agent's workflow takes the running version's name (Live; a preview's
   * draft); once the agent is deleted, the stored `agentName`, with
   * `deleted: true`. `config` is the running agent version, when any.
   */
  private workflowRefOf(
    session: SessionDoc,
    config?: AgentConfig,
  ): SessionWorkflowRef {
    const id = sessionWorkflowId(session);
    const parsed = parseWorkflowId(id);
    if (parsed?.kind === 'code') {
      return { id, name: parsed.source.name, kind: 'code', deleted: false };
    }
    // A past chat of a removed workflow keeps its name on the chip.
    if (isRemovedWorkflowId(id)) {
      return {
        id,
        name: REMOVED_WORKFLOW_NAMES[id],
        kind: 'code',
        deleted: false,
      };
    }
    // A built-in agent's conversation (plan Elena 1.3): her own name.
    if (parsed?.kind === 'conversation') {
      const key = parsed.binding.agentKey;
      const name =
        this.mastra.listAgents()[key]?.name ?? session.agentName ?? key;
      return { id, name, kind: 'agent', deleted: false };
    }
    if (parsed?.kind === 'builtin-agent') {
      const name =
        parsed.agentKey === ASSISTANT_AGENT_KEY
          ? ASSISTANT_WORKFLOW_NAME
          : (this.mastra.listAgents()[parsed.agentKey]?.name ??
            session.agentName ??
            parsed.agentKey);
      return { id, name, kind: 'agent', deleted: false };
    }
    return config
      ? { id, name: config.name, kind: 'agent', deleted: false }
      : { id, name: session.agentName ?? '', kind: 'agent', deleted: true };
  }

  /**
   * The phases of the `## Workflow` section of the prompt the session runs
   * (ADR-0029): none for a built-in agent bound by key, a user
   * agent's Live instructions when they have the section, else the
   * assistant's prompt. `config` is the running agent version, when any.
   */
  effectiveWorkflowFor(
    session: SessionDoc,
    config?: AgentConfig,
  ): WorkflowPhase[] {
    // A built-in agent's steps are its workflow's run events, never a
    // prompt's: Michael's (Avery + Michael, or a past chat of a removed
    // workflow) included.
    if (session.agentKey) return [];
    const own = config ? parseWorkflow(config.instructions) : [];
    if (own.length) return own;
    return parseWorkflow(
      agentPromptOverrideFor(ASSISTANT_AGENT_KEY)?.prompt ??
        assistantShippedPrompt(),
    );
  }

  /** The agent version a session's turns run (its Live version; a preview's draft). */
  private async runningConfig(
    session: SessionDoc,
  ): Promise<AgentConfig | undefined> {
    if (!session.agentId) return undefined;
    const doc = await this.userAgents.get(session.agentId);
    return session.preview ? doc?.draft : doc?.live;
  }

  /**
   * The `agent` of a session bound to a built-in agent (api.md 2.1): the
   * registered agent's name and description; never deleted.
   */
  private builtinAgentRef(session: SessionDoc): SessionAgentRef {
    const key = session.agentKey ?? '';
    const agent = this.mastra.listAgents()[key];
    let description = '';
    try {
      description = agent?.getDescription() ?? '';
    } catch {
      description = '';
    }
    return {
      id: key,
      name: agent?.name ?? session.agentName ?? key,
      deleted: false,
      description,
      starterQuestions: [],
    };
  }

  // --------------------------------------------------------- panel items

  /**
   * The `show_in_panel` bridge (agents.md 3.11): validate the call, store the
   * item on the session and return the summary the model sees. Throws the
   * message the tool answers with.
   */
  private async showPanelItem(
    sessionId: string,
    input: PanelToolInput,
    turnRecords?: DatasetToolTurnRecord[],
  ): Promise<PanelToolResult> {
    const session = await this.get(sessionId);
    const { item, summary } = await buildPanelItem(input, {
      session,
      turnRecords,
    });
    await this.updateDoc(session.id, {
      panelItems: upsertPanelItem(session.panelItems ?? [], item),
    });
    return summary;
  }

  /**
   * The `update_workflow` bridge (agents.md 3.11): validate the call against
   * the session's steps, save the state and return the summary the model sees.
   * Throws the message the tool answers with.
   */
  private async updateWorkflow(
    sessionId: string,
    input: WorkflowToolInput,
  ): Promise<WorkflowToolResult> {
    const session = await this.get(sessionId);
    const promptSteps = this.effectiveWorkflowFor(
      session,
      await this.runningConfig(session),
    ).length;
    const { state, result } = applyWorkflowUpdate(input, {
      promptSteps,
      state: session.workflowState,
    });
    await this.updateDoc(session.id, { workflowState: state });
    return result;
  }

  /** The workflow view of a stored session, for the `workflow` event. */
  private async workflowOf(
    session: SessionDoc,
  ): Promise<WorkflowView | undefined> {
    return workflowViewOf(
      this.effectiveWorkflowFor(session, await this.runningConfig(session)),
      session.workflowState,
      workflowSourceOf(session),
    );
  }

  private requirePanelItem(session: SessionDoc, itemId: string): PanelItem {
    const item = withVisualItems(session).find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundException(`Panel item "${itemId}" not found`);
    }
    return item;
  }

  /** A file item's text, read from the session workspace (api.md #106). */
  async panelItemFile(
    id: string,
    itemId: string,
  ): Promise<{ item: FilePanelItem; contentType: string; text: string }> {
    return this.panelItemFileOf(await this.get(id), itemId);
  }

  /**
   * `panelItemFile` over a given session: a stored run's run-backed host
   * (api.md 125) as well as a session.
   */
  async panelItemFileOf(
    session: SessionDoc,
    itemId: string,
  ): Promise<{ item: FilePanelItem; contentType: string; text: string }> {
    const item = this.requirePanelItem(session, itemId);
    if (item.kind !== 'file') {
      throw new BadRequestException(`Panel item "${itemId}" is not a file`);
    }
    try {
      const file = await readWorkspaceFile(session.id, item.path);
      return { item, contentType: file.contentType, text: file.text };
    } catch (error) {
      throw panelFileException(error);
    }
  }

  /** A file, document or table item as an attachment (api.md #107). */
  async downloadPanelItem(
    id: string,
    itemId: string,
    format?: 'pdf' | 'md' | 'csv',
  ): Promise<{ filename: string; contentType: string; body: Buffer }> {
    return this.downloadPanelItemOf(await this.get(id), itemId, format);
  }

  /** `downloadPanelItem` over a given session or run-backed host (api.md 126). */
  async downloadPanelItemOf(
    session: SessionDoc,
    itemId: string,
    format?: 'pdf' | 'md' | 'csv',
  ): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const item = this.requirePanelItem(session, itemId);
    if (format === 'pdf') {
      const cantPdf = () =>
        new BadRequestException(
          `Panel item "${itemId}" can't be downloaded as PDF`,
        );
      let markdown: string;
      let filename: string;
      if (item.kind === 'document') {
        markdown = item.markdown;
        filename = `${titleSlug(item.title) || 'document'}.pdf`;
      } else if (item.kind === 'file' && /\.md$/i.test(item.path)) {
        try {
          markdown = (await readWorkspaceFile(session.id, item.path)).text;
        } catch (error) {
          throw panelFileException(error);
        }
        const base = item.path.split('/').pop() ?? item.path;
        filename = base.replace(/\.md$/i, '.pdf');
      } else {
        throw cantPdf();
      }
      return {
        filename,
        contentType: 'application/pdf',
        body: await renderPdf(markdown, {
          title: item.title,
          createdAt: new Date(),
          author: 'Questions to Insights',
        }),
      };
    }
    switch (item.kind) {
      case 'file':
        try {
          const file = await readWorkspaceFile(session.id, item.path);
          return {
            filename: item.path.split('/').pop() ?? item.path,
            contentType: file.contentType,
            body: file.body,
          };
        } catch (error) {
          throw panelFileException(error);
        }
      case 'document':
        return {
          filename: `${titleSlug(item.title) || 'document'}.md`,
          contentType: 'text/markdown',
          body: Buffer.from(item.markdown, 'utf8'),
        };
      case 'table':
        return {
          filename: `${titleSlug(item.title) || 'table'}.csv`,
          contentType: 'text/csv',
          body: Buffer.from(tableCsv(item.columns, item.rows), 'utf8'),
        };
      default:
        throw new BadRequestException(
          `Panel item "${itemId}" can't be downloaded`,
        );
    }
  }

  // ------------------------------------------------------------- visuals

  async getVisualization(
    id: string,
    visualizationId: string,
    version?: number,
  ): Promise<InteractiveVisualization> {
    return this.getVisualizationOf(
      await this.get(id),
      visualizationId,
      version,
    );
  }

  /** `getVisualization` over a given session or run-backed host (api.md 123). */
  getVisualizationOf(
    session: SessionDoc,
    visualizationId: string,
    version?: number,
  ): Promise<InteractiveVisualization> {
    return this.visuals.load(session, visualizationId, version);
  }

  async downloadVisualization(
    id: string,
    visualizationId: string,
    version?: number,
  ): Promise<{ filename: string; archive: Buffer }> {
    return this.downloadVisualizationOf(
      await this.get(id),
      visualizationId,
      version,
    );
  }

  /** `downloadVisualization` over a given session or run-backed host (api.md 124). */
  downloadVisualizationOf(
    session: SessionDoc,
    visualizationId: string,
    version?: number,
  ): Promise<{ filename: string; archive: Buffer }> {
    return this.visuals.download(session, visualizationId, version);
  }

  /**
   * A visual action on a run-backed host (api.md 130-134): the same
   * pipeline as the session routes above, but nothing is persisted here:
   * the caller stores the metadata and the event on the stored run.
   * Returns the new metadata, the version to show and, for create, tailor
   * and revert, the event card to log (repair and refresh log none).
   */
  async runVisualAction(
    host: SessionDoc,
    action: RunVisualAction,
  ): Promise<RunVisualOutcome> {
    const outcome = await this.runVisualStep(host, action);
    return {
      ...outcome,
      // The visual joins the panel history, newest shown (ADR-0029).
      panelItems: upsertPanelItem(host.panelItems ?? [], {
        id: visualItemId(outcome.metadata.id),
        kind: 'visual',
        title: outcome.metadata.title,
        shownAt: new Date().toISOString(),
        visualId: outcome.metadata.id,
      }),
    };
  }

  private async runVisualStep(
    host: SessionDoc,
    action: RunVisualAction,
  ): Promise<{
    metadata: SessionVisualization;
    version: number;
    event?: VisualEvent;
  }> {
    switch (action.kind) {
      case 'create': {
        const { metadata } = await this.visuals.create(
          host,
          action.sourceMessageAt || undefined,
        );
        return {
          metadata,
          version: 1,
          event: {
            visualId: metadata.id,
            version: 1,
            title: metadata.title,
            action: 'created',
          },
        };
      }
      case 'tailor': {
        const instruction = (action.instruction ?? '').trim();
        if (!instruction) {
          throw new BadRequestException('instruction is required');
        }
        const { metadata } = await this.visuals.update(
          host,
          action.visualId,
          instruction,
        );
        const version = this.visuals.currentVersion(metadata);
        return {
          metadata,
          version,
          event: {
            visualId: metadata.id,
            version,
            title: metadata.title,
            action: 'updated',
          },
        };
      }
      case 'revert': {
        const metadata = await this.visuals.revert(
          host,
          action.visualId,
          action.version,
        );
        return {
          metadata,
          version: action.version,
          event: {
            visualId: metadata.id,
            version: action.version,
            title: metadata.title,
            action: 'reverted',
          },
        };
      }
      case 'refresh': {
        const { metadata } = await this.visuals.refreshData(
          host,
          action.visualId,
        );
        return { metadata, version: this.visuals.currentVersion(metadata) };
      }
      case 'repair': {
        const meta = this.visuals.find(host, action.visualId);
        const current = this.visuals.currentVersion(meta);
        if (action.version !== current) {
          throw new BadRequestException(
            `Only the current version can be repaired (requested v${action.version}, current v${current})`,
          );
        }
        const { metadata } = await this.visuals.repair(
          host,
          action.visualId,
          action.error,
        );
        return { metadata, version: this.visuals.currentVersion(metadata) };
      }
    }
  }

  /** Upsert visual metadata on the session, optionally logging a chat event. */
  private async saveVisualMetadata(
    session: SessionDoc,
    metadata: SessionVisualization,
    event?: VisualEvent,
  ): Promise<SessionDoc> {
    const fresh = await this.get(session.id);
    const others = (fresh.visualizations ?? []).filter(
      (v) => v.id !== metadata.id,
    );
    const patch: Partial<SessionDoc> = {
      visualizations: [...others, metadata],
      // The visual joins the panel history, newest shown (ADR-0029).
      panelItems: upsertPanelItem(fresh.panelItems ?? [], {
        id: visualItemId(metadata.id),
        kind: 'visual',
        title: metadata.title,
        shownAt: new Date().toISOString(),
        visualId: metadata.id,
      }),
    };
    if (event) {
      const verb =
        event.action === 'created'
          ? 'Created'
          : event.action === 'updated'
            ? 'Updated'
            : 'Reverted';
      patch.messages = [
        ...fresh.messages,
        {
          role: 'assistant',
          content: `${verb} interactive visual "${event.title}" (v${event.version}).`,
          at: new Date().toISOString(),
          visual: event,
        },
      ];
    }
    return (await this.updateDoc(session.id, patch)) ?? fresh;
  }

  private toolResult(metadata: SessionVisualization) {
    return {
      visualId: metadata.id,
      version: this.visuals.currentVersion(metadata),
      title: metadata.title,
      description: metadata.description,
    };
  }

  /**
   * The same rating on a stored workflow run's answer (verified-queries R1-R7;
   * api.md 128): `host` is the run's run-backed host. Returns the rated answer
   * for the caller to store; the pair is keyed by `runId`, not by a session.
   */
  async rateRunAnswer(
    runId: string,
    host: SessionDoc,
    messageAt: string,
    rating: MessageFeedback,
  ): Promise<ChatMessage> {
    const messages = await this.rateAnswer(
      host,
      messageAt,
      rating,
      { sourceRunId: runId },
      () => this.verifiedQueries.removeForRun(runId),
    );
    return messages.find(
      (m) => m.role === 'assistant' && m.at === messageAt,
    ) as ChatMessage;
  }

  /** Rate one answer of `session`: the new messages, the library updated. */
  private async rateAnswer(
    session: SessionDoc,
    messageAt: string,
    rating: MessageFeedback,
    source: { sourceSessionId: string } | { sourceRunId: string },
    removePair: () => Promise<unknown>,
  ): Promise<ChatMessage[]> {
    if (rating !== 'up' && rating !== 'down') {
      throw new BadRequestException("rating must be 'up' or 'down'");
    }
    if (!messageAt) throw new BadRequestException('messageAt is required');
    const index = session.messages.findIndex(
      (m) => m.role === 'assistant' && m.at === messageAt,
    );
    if (index < 0) {
      throw new NotFoundException(`No assistant message at ${messageAt}`);
    }
    const messages = [...session.messages];
    const answer: ChatMessage = { ...messages[index], feedback: rating };
    // The rating is the authority on the badge: approving an answer verifies
    // it, rejecting it takes the badge away even if the SQL is still stored.
    if (rating === 'up') answer.verified = true;
    else delete answer.verified;
    messages[index] = answer;

    if (rating === 'down') {
      await removePair();
    } else {
      const sql = lastSuccessfulSql(answer.data);
      const question = messages
        .slice(0, index)
        .reverse()
        .find((m) => m.role === 'user');
      if (sql && question?.content.trim()) {
        await this.verifiedQueries.save({
          question: question.content,
          sql,
          datasourceId: await this.turnDatasets.soleDatasourceId(session),
          entities: answer.entities ?? [],
          ...source,
          sourceMessageAt: messageAt,
        });
      }
    }
    return messages;
  }
}

/** A workspace file error as the API answers it: 404 for a missing file, else 400. */
function panelFileException(error: unknown): Error {
  if (error instanceof WorkspaceFileError) {
    return error.reason === 'missing'
      ? new NotFoundException(error.message)
      : new BadRequestException(error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** A session's `agent`: its Live version, or the stored name once deleted. */
function agentRef(
  session: SessionDoc,
  live: AgentConfig | undefined,
): SessionAgentRef {
  const id = session.agentId ?? '';
  return live
    ? {
        id,
        name: live.name,
        deleted: false,
        description: live.description,
        starterQuestions: live.starterQuestions,
      }
    : {
        id,
        name: session.agentName ?? '',
        deleted: true,
        description: '',
        starterQuestions: [],
      };
}
