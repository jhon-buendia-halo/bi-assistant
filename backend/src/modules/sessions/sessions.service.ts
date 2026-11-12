import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { parseWorkflow } from '../../mastra/workflow-section';
import { agentPromptOverrideFor } from '../../mastra/agent-prompt-overrides';
import { assistantShippedPrompt } from '../../mastra/agents/assistant-prompt';
import { RFP_PROMPT } from '../../mastra/agents/system-prompts';
import {
  builtinAgentSession,
  builtinSessionDatasets,
  canStartBuiltinSession,
  existingDatasetsFor,
  runsOnPickedDatasets,
} from '../agents/builtin-sessions';
import { ASSISTANT_V2_AGENT_KEY } from '../../mastra/agents/assistant-v2-catalog';
import { DataReadinessService } from '../data-readiness/data-readiness.service';
import { setReadinessToolServices } from '../../mastra/readiness-tool-services';
import { ReadinessBridge } from './readiness-bridge';
import { setSyntheticDataToolServices } from '../../mastra/synthetic-data-tool-services';
import {
  SyntheticDataBridge,
  type SyntheticDataBridgeDeps,
} from './synthetic-data-bridge';
import { SYNTHETIC_DATA_SERVICE } from '../synthetic-data/synthetic-data.token';
import { RfpPackagesService } from '../rfp-packages/rfp-packages.service';
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
import { LlmService } from '../llm/llm.service';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
import { MetricsService } from '../metrics/metrics.service';
import { OntologyService } from '../ontology/ontology.service';
import { SessionsRepository } from './repositories/sessions.repository';
import { VisualizationService } from './visualization.service';
import {
  buildPanelItem,
  tableCsv,
  titleSlug,
  upsertPanelItem,
  visualItemId,
  withVisualItems,
} from './panel-items';
import { applyWorkflowUpdate, workflowViewOf } from './workflow-update';
import { workflowStepPhases } from './workflow-run-state';
import { QTI_V2_TURN_STEPS } from '../../mastra/workflows/qti-v2-turn.steps';
import {
  ASSISTANT_WORKFLOW_NAME,
  parseWorkflowId,
  sessionWorkflowId,
  workflowStartsChat,
} from '../../mastra/workflows/workflow-catalog';
import { renderPdf } from '../../common/markdown-pdf';
import {
  WorkspaceFileError,
  readWorkspaceFile,
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
  WorkflowState,
  WorkflowView,
} from './entities/session.entity';
import { SessionDatasets } from './turn/session-datasets';
import { SqlChecks } from './turn/sql-checks';
import { TurnEngine } from './turn/turn-engine';
import { TurnOptions } from './turn/turn-options';
import type { RunStepEvent, StreamEvent } from './turn/stream-events';
import {
  ASSISTANT_AGENT_KEY,
  RFP_AGENT_KEY,
  lastSuccessfulSql,
} from './turn/turn-records';
import { workflowSourceOf } from './turn/turn-workflow';

export type { RunStepEvent, StreamEvent } from './turn/stream-events';
export { toolCallInput } from './turn/turn-records';

/** Id prefix of an agent editor's preview session (agents-evals R60). */
const PREVIEW_ID_PREFIX = 'preview-';
/** Id prefix of a run host: `run-<run id>` (ADR-0041; agents.md 5.14). */
export const RUN_HOST_ID_PREFIX = 'run-';

/**
 * What a run host is created from (agents.md 5.14): the run, the workflow it
 * runs, the input's datasets and RFP, and the one earlier run given as
 * context (plan 5.4).
 */
export interface RunHostSpec {
  runId: string;
  /** `agent:assistant`, `qti-v2-turn`, `agent:<key>` or `agent:<user-agent id>`. */
  workflowId: string;
  /** The workflow's name: the host's name. */
  name: string;
  /** The input's datasets; absent for the RFP Builder and user agents. */
  datasets?: string[];
  rfpId?: string;
  /** The stage tracker an RFP Continue starts from: the earlier run's (plan 4.3). */
  workflowState?: WorkflowState;
  /** The earlier run's question and answer, put before this run's question. */
  context?: { question: string; answer: string };
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
    // The RFP Builder's REST target and package export (agents.md 3.10).
    @Optional() private readonly rfpPackages?: RfpPackagesService,
    // The Data Readiness Agent's assessments (agents.md 3.13).
    @Optional() private readonly readiness?: DataReadinessService,
    // Sampled profiles and synthetic scripts for the same agent (agents.md 3.14).
    @Optional()
    @Inject(SYNTHETIC_DATA_SERVICE)
    private readonly syntheticData?: SyntheticDataBridgeDeps['synthetic'],
  ) {
    // The turn engine (agents.md 5.1) lives in `./turn/`, built on this
    // service's own dependencies and its session reads and writes.
    this.turnDatasets = new SessionDatasets(
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
      rfpPackages,
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
      crossCheckAnswer: (session, question, data) =>
        this.crossCheckAnswer(session, question, data),
      readinessBridge: () => this.readinessBridge,
    });
  }

  /** The session's datasets, bound to their datasources. */
  private readonly turnDatasets: SessionDatasets;
  /** SQL repair, careful mode's cross-check and the Verified badge. */
  private readonly sqlChecks: SqlChecks;
  /** What reaches the model on a turn. */
  private readonly turnOptions: TurnOptions;
  /** The streamed and non-streamed turn. */
  private readonly turns: TurnEngine;

  /** The readiness tools' bridge, once installed (agents.md 3.13). */
  private readinessBridge?: ReadinessBridge;

  async onModuleInit(): Promise<void> {
    // Install the DI bridge the Mastra tools use (they load with no Nest DI).
    setDatasetToolServices({
      getDatasets: (names) => this.turnDatasets.bound(names),
      sampleRows: (datasourceId, entity, limit) =>
        this.datasourcesService.sampleRows(datasourceId, entity, limit),
      runReadOnlySql: (datasourceId, sql, limit, datasets) =>
        this.sqlChecks.runSqlWithRepair(datasourceId, sql, limit, datasets),
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
      restTarget: (datasourceId) =>
        this.requireRfpPackages().restTarget(datasourceId),
      exportRfpPackage: (sessionId, datasourceId, rfpId, options) =>
        this.requireRfpPackages().exportRfpPackage(
          sessionId,
          datasourceId,
          rfpId,
          options,
        ),
    });

    if (this.readiness) {
      this.readinessBridge = new ReadinessBridge({
        sessionDatasetNames: async (sessionId) =>
          (await this.get(sessionId)).datasets,
        datasets: (names) => this.turnDatasets.bound(names),
        datasourceName: (datasourceId) =>
          this.turnDatasets.datasourceName(datasourceId),
        readiness: this.readiness,
      });
      setReadinessToolServices(this.readinessBridge);
    }

    if (this.syntheticData) {
      setSyntheticDataToolServices(
        new SyntheticDataBridge({
          sessionDatasetNames: async (sessionId) =>
            (await this.get(sessionId)).datasets,
          datasets: (names) => this.turnDatasets.bound(names),
          synthetic: this.syntheticData,
          writeFile: (sessionId, path, text) =>
            writeWorkspaceFile(sessionId, path, text),
          showFile: async (sessionId, path, title) =>
            this.showPanelItem(sessionId, { kind: 'file', path, title }),
        }),
      );
    }

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

  /** The RFP package service, which only a unit test leaves out. */
  private requireRfpPackages(): RfpPackagesService {
    if (!this.rfpPackages) {
      throw new Error('RFP packages are not available in this process');
    }
    return this.rfpPackages;
  }

  /**
   * Same grounding for a background job (deep analysis) — tools scoped to the
   * session, the same system blocks — but **without** the conversation memory
   * thread. A job fires many internal sub-calls; writing them into the thread
   * would pollute the history the user's next chat question is answered from.
   */
  async backgroundAgentOptions(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
  ) {
    return this.turnOptions.agentContext(session, question, abortSignal);
  }

  /**
   * Append one assistant message written outside a chat turn (a deep-analysis
   * report). Re-reads the session first, so a job that finishes while the user
   * keeps chatting never overwrites the turns persisted meanwhile.
   */
  async appendAssistantMessage(
    id: string,
    message: Omit<ChatMessage, 'role' | 'at'>,
  ): Promise<SessionDoc> {
    const fresh = await this.get(id);
    const messages: ChatMessage[] = [
      ...fresh.messages,
      { role: 'assistant', at: new Date().toISOString(), ...message },
    ];
    return (await this.updateDoc(id, { messages })) ?? { ...fresh, messages };
  }

  /**
   * Careful mode's cross-check (agents.md 5.4), the seam the turn engine
   * reaches it through.
   */
  private crossCheckAnswer(
    session: SessionDoc,
    question: string,
    data: ToolDataRecord[],
  ): Promise<CrossCheck | undefined> {
    return this.sqlChecks.crossCheckAnswer(session, question, data);
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
   * Create a named session; the conversation starts empty in the chat view.
   * `agent` binds it to a built-in agent that runs on picked datasets
   * (Questions to Insights v2, api.md 3).
   */
  async create(
    name: string,
    datasets: string[],
    agent?: Pick<SessionDoc, 'agentKey' | 'agentName'>,
  ): Promise<SessionDoc> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('session name is required');
    if (!Array.isArray(datasets) || datasets.length === 0) {
      throw new BadRequestException('select at least one dataset');
    }
    return this.insertSession(trimmed, datasets, agent);
  }

  /**
   * Start chat on a Live user agent (sessions-chat R52): named after the
   * agent, over those of its Live datasets that still exist, bound to it.
   * A built-in agent that declares a dataset (the RFP Builder, R61) gets a
   * session over that dataset, bound by its registry key. A built-in agent
   * that runs on picked datasets (Questions to Insights v2) takes `name` and
   * `datasets` validated as `create` does. Any other built-in key is "not
   * found".
   */
  async createFromAgent(
    agentId: string,
    name?: string,
    pickedDatasets?: string[],
  ): Promise<SessionDoc> {
    // An optional typed name (the New conversation screen) replaces the
    // agent's default one; blank keeps the default.
    const typed = typeof name === 'string' ? name.trim().slice(0, 64) : '';
    const picked = runsOnPickedDatasets(agentId)
      ? this.mastra.listAgents()[agentId]
      : undefined;
    if (picked) {
      return this.create(name ?? '', pickedDatasets ?? [], {
        agentKey: agentId,
        agentName: picked.name ?? agentId,
      });
    }
    const builtin = this.builtinSessionAgent(agentId);
    if (builtin) {
      const declared = builtinSessionDatasets(
        builtin.session,
        await existingDatasetsFor(builtin.session, this.userAgents),
      );
      if (!canStartBuiltinSession(declared)) {
        throw new BadRequestException(builtin.session.requirement);
      }
      return this.insertSession(
        typed || builtin.session.sessionName || builtin.name,
        declared.datasets,
        { agentKey: agentId, agentName: builtin.name },
      );
    }
    const agent = await this.userAgents.get(agentId);
    if (!agent) throw new NotFoundException(`Agent "${agentId}" not found`);
    if (!agent.live) {
      throw new BadRequestException(
        `Publish "${agent.draft.name}" before starting a chat`,
      );
    }
    const datasets = await this.existingDatasets(agent.live.datasets);
    if (!datasets.length) {
      throw new BadRequestException("None of this agent's datasets exist");
    }
    return this.insertSession(typed || agent.live.name, datasets, {
      agentId,
      agentName: agent.live.name,
    });
  }

  /**
   * Start a chat on a workflow (api.md 3; workflows R4, ADR-0040).
   * `agent:assistant` creates a plain session; a code workflow creates it as
   * `agentId: <its primaryFor>` does; `agent:<key|id>` as `agentId: <key|id>`
   * does, with the same refusals. An unknown id, a draft-only or missing user
   * agent, a System agent and a code workflow's `primaryFor` agent are "not
   * found". A run workflow (`seq-text-demo`) can't start a chat (R11).
   * Resolved from the pure catalogue, never from `WorkflowsService` (its
   * module imports this one).
   */
  async createFromWorkflow(
    workflowId: string,
    name?: string,
    datasets?: string[],
  ): Promise<SessionDoc> {
    const notFound = () =>
      new NotFoundException(`Workflow "${workflowId}" not found`);
    const parsed = parseWorkflowId(workflowId);
    if (!parsed) throw notFound();
    if (parsed.kind === 'code') {
      // A run workflow runs once on a typed input, never in a chat
      // (workflows R11; api.md 118).
      if (!workflowStartsChat(parsed.source)) {
        throw new BadRequestException(
          `Workflow "${workflowId}" can't start a chat`,
        );
      }
      const primary = parsed.source.primaryFor;
      if (!primary || !this.mastra.listAgents()[primary]) throw notFound();
      return this.createFromAgent(primary, name, datasets);
    }
    if (parsed.kind === 'builtin-agent') {
      if (parsed.agentKey === ASSISTANT_AGENT_KEY) {
        return this.create(name ?? '', datasets ?? []);
      }
      if (!this.mastra.listAgents()[parsed.agentKey]) throw notFound();
      return this.createFromAgent(parsed.agentKey, name);
    }
    const agent = await this.userAgents.get(parsed.agentId);
    if (!agent?.live) throw notFound();
    return this.createFromAgent(parsed.agentId, name);
  }

  /**
   * Keeps only `datasets` among a session's datasets (agents.md 8.1): an eval
   * run bound to a built-in agent that takes every qualifying dataset (the
   * Data Readiness Agent) is narrowed to the datasets the run names, so a data
   * dir holding more samples does not make the agent ask which one. Datasets
   * the session does not have are ignored; an empty result keeps the session
   * as it was.
   */
  async narrowDatasets(
    id: string,
    datasets: string[],
  ): Promise<SessionDoc | null> {
    const session = await this.repository.get(id);
    if (!session) return null;
    const keep = session.datasets.filter((name) => datasets.includes(name));
    if (keep.length === 0 || keep.length === session.datasets.length) {
      return session;
    }
    return this.repository.update(id, { datasets: keep });
  }

  /**
   * The agent editor's preview chat (agents-evals R60, R61): an in-memory
   * session that runs the agent's saved draft, with its own memory thread
   * and workspace, never stored with the sessions.
   */
  async createPreview(agentId: string): Promise<SessionDoc> {
    const agent = await this.userAgents.get(agentId);
    if (!agent) throw new NotFoundException(`Agent "${agentId}" not found`);
    const datasets = await this.existingDatasets(agent.draft.datasets);
    if (!datasets.length) {
      throw new BadRequestException('Select at least one dataset to preview');
    }
    const id = `${PREVIEW_ID_PREFIX}${randomUUID()}`;
    const name = `Preview: ${agent.draft.name}`.slice(0, 64);
    const workspace = await this.mastra.ensureSessionWorkspace(id, name);
    const now = new Date().toISOString();
    const preview: SessionDoc = {
      id,
      name,
      workspaceId: workspace.id,
      datasets,
      agentId,
      agentName: agent.draft.name,
      workflowId: sessionWorkflowId({ agentId }),
      preview: true,
      messages: [],
      visualizations: [],
      createdAt: now,
      updatedAt: now,
    };
    this.memoryHosts.set(id, preview);
    return { ...preview };
  }

  /**
   * A run host (ADR-0041; agents.md 5.14): the in-memory session one run of
   * an agent workflow executes its agent turn on, shaped as `POST /sessions`
   * would shape a session of that workflow: bound to the workflow's agent,
   * over the input's datasets (the RFP Builder's declared dataset; a user
   * agent's Live datasets that exist), with the input's RFP and, as its
   * transcript, the earlier run's question and answer (plan 5.4). Its
   * workspace is `session-run-<run id>`, created as a session's. Never
   * stored or listed.
   */
  async createRunHost(spec: RunHostSpec): Promise<SessionDoc> {
    const notFound = () =>
      new NotFoundException(`Workflow "${spec.workflowId}" not found`);
    const parsed = parseWorkflowId(spec.workflowId);
    if (!parsed) throw notFound();
    let binding: Pick<SessionDoc, 'agentKey' | 'agentId' | 'agentName'> = {};
    let datasets = spec.datasets ?? [];
    if (parsed.kind === 'code') {
      const primary = parsed.source.primaryFor;
      const agent = primary ? this.mastra.listAgents()[primary] : undefined;
      if (!primary || !agent) throw notFound();
      binding = { agentKey: primary, agentName: agent.name ?? primary };
    } else if (parsed.kind === 'builtin-agent') {
      if (parsed.agentKey !== ASSISTANT_AGENT_KEY) {
        const agent = this.mastra.listAgents()[parsed.agentKey];
        if (!agent) throw notFound();
        binding = {
          agentKey: parsed.agentKey,
          agentName: agent.name ?? parsed.agentKey,
        };
        const builtin = this.builtinSessionAgent(parsed.agentKey);
        if (!spec.datasets && builtin) {
          const declared = builtinSessionDatasets(
            builtin.session,
            await existingDatasetsFor(builtin.session, this.userAgents),
          );
          if (!canStartBuiltinSession(declared)) {
            throw new BadRequestException(builtin.session.requirement);
          }
          datasets = declared.datasets;
        }
      }
    } else {
      const agent = await this.userAgents.get(parsed.agentId);
      if (!agent?.live) throw notFound();
      datasets = await this.existingDatasets(agent.live.datasets);
      if (!datasets.length) {
        throw new BadRequestException("None of this agent's datasets exist");
      }
      binding = { agentId: parsed.agentId, agentName: agent.live.name };
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
      workflowId: sessionWorkflowId(binding),
      ...(spec.rfpId ? { rfpId: spec.rfpId } : {}),
      ...(spec.workflowState
        ? { workflowState: { ...spec.workflowState } }
        : {}),
      run: true,
      messages: spec.context
        ? [
            { role: 'user', content: spec.context.question, at: now },
            { role: 'assistant', content: spec.context.answer, at: now },
          ]
        : [],
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
   * run goes to `onStepEvent`, whatever the workflow's bar.
   */
  async streamRunTurn(
    hostId: string,
    question: string,
    emit: (event: StreamEvent) => void,
    abortSignal: AbortSignal | undefined,
    careful: boolean,
    onStepEvent: (event: RunStepEvent) => void,
  ): Promise<void> {
    const host = this.memoryHosts.get(hostId);
    if (!host?.run) throw new NotFoundException(`Session ${hostId} not found`);
    const trimmed = (question ?? '').trim();
    if (!trimmed) throw new BadRequestException('message is required');
    await this.turns.streamTurn(
      { ...host },
      trimmed,
      emit,
      abortSignal,
      undefined,
      careful,
      onStepEvent,
    );
  }

  /**
   * End a run host (agents.md 5.14): answer it as the API shows a session
   * (its messages, derived panel items and workflow view), then delete its
   * memory thread and let it leave memory. Its workspace stays, owned by the
   * run.
   */
  async finishRunHost(hostId: string): Promise<SessionView> {
    const host = this.memoryHosts.get(hostId);
    if (!host?.run) throw new NotFoundException(`Session ${hostId} not found`);
    try {
      return await this.toView({ ...host });
    } finally {
      this.memoryHosts.delete(hostId);
      try {
        await this.mastra.deleteMemoryThread(hostId);
      } catch (error) {
        this.logger.warn(
          `Could not delete the memory thread of ${hostId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Delete a run host's workspace and memory thread (agents.md 5.14): when
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

  private async insertSession(
    name: string,
    datasets: string[],
    agent?: Pick<SessionDoc, 'agentId' | 'agentName' | 'agentKey'>,
  ): Promise<SessionDoc> {
    const id = randomUUID();
    const workspace = await this.mastra.ensureSessionWorkspace(id, name);
    return this.repository.insert({
      id,
      name: name.slice(0, 64),
      workspaceId: workspace.id,
      datasets,
      ...(agent ?? {}),
      // Every new session stores the workflow it runs (ADR-0040): the one
      // its agent fields derive (workflows R4).
      workflowId: sessionWorkflowId({
        agentKey: agent?.agentKey,
        agentId: agent?.agentId,
      }),
      messages: [],
      visualizations: [],
    });
  }

  /**
   * A session as the API returns it: the stored document plus the derived
   * `agent`, `workflow` and the full `panelItems` list (api.md 2.1). Computed
   * on every read, never stored.
   */
  async toView(session: SessionDoc): Promise<SessionView> {
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
    return sessions.map((session) => {
      if (session.agentKey) {
        return this.viewOf(session, this.builtinAgentRef(session));
      }
      if (!session.agentId) return this.viewOf(session);
      const config = agents.get(session.agentId);
      return this.viewOf(session, agentRef(session, config), config);
    });
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
   * (ADR-0029): the RFP Builder's prompt (override or shipped), a user
   * agent's Live instructions when they have the section, else the
   * assistant's prompt. `config` is the running agent version, when any.
   */
  effectiveWorkflowFor(
    session: SessionDoc,
    config?: AgentConfig,
  ): WorkflowPhase[] {
    // A workflow-backed agent's steps are its code-defined workflow's
    // (agents.md 5.11, ADR-0034).
    if (session.agentKey === ASSISTANT_V2_AGENT_KEY) {
      return workflowStepPhases(QTI_V2_TURN_STEPS);
    }
    if (session.agentKey) {
      return session.agentKey === RFP_AGENT_KEY
        ? parseWorkflow(
            agentPromptOverrideFor(RFP_AGENT_KEY)?.prompt ?? RFP_PROMPT,
          )
        : [];
    }
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
   * A registered built-in agent that declares a dataset for its sessions
   * (ADR-0028), with its name; undefined for any other key.
   */
  private builtinSessionAgent(key: string) {
    const session = builtinAgentSession(key);
    const agent = session ? this.mastra.listAgents()[key] : undefined;
    if (!session || !agent) return undefined;
    return { agent, session, name: agent.name ?? key };
  }

  /**
   * The `agent` of a session bound to a built-in agent (api.md 2.1): the
   * registered agent's name and description and its built-in starters;
   * never deleted.
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
      starterQuestions: [...(builtinAgentSession(key)?.starterQuestions ?? [])],
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

  /** Button path: generate a visual for one answer and record it in the chat. */
  async generateVisualization(
    id: string,
    sourceMessageAt: string,
  ): Promise<{ session: SessionDoc; visualization: InteractiveVisualization }> {
    const session = await this.get(id);
    const { metadata } = await this.visuals.create(
      session,
      sourceMessageAt || undefined,
    );
    const updated = await this.saveVisualMetadata(session, metadata, {
      visualId: metadata.id,
      version: 1,
      title: metadata.title,
      action: 'created',
    });
    return {
      session: updated,
      visualization: await this.visuals.load(updated, metadata.id, 1),
    };
  }

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
   * An RFP package stored in the session workspace, or one of its files
   * (api.md #105). Owner-scoped: another user's session is not found.
   */
  async downloadRfpPackage(
    id: string,
    rfpId: string,
    file?: string,
    draft = false,
  ): Promise<{ filename: string; contentType: string; body: Buffer }> {
    return this.downloadRfpPackageOf(await this.get(id), rfpId, file, draft);
  }

  /** `downloadRfpPackage` over a given session or run-backed host (api.md 127). */
  downloadRfpPackageOf(
    session: SessionDoc,
    rfpId: string,
    file?: string,
    draft = false,
  ): Promise<{ filename: string; contentType: string; body: Buffer }> {
    return this.requireRfpPackages().download(session.id, rfpId, file, draft);
  }

  async revertVisualization(
    id: string,
    visualizationId: string,
    version: number,
  ): Promise<{ session: SessionDoc; visualization: InteractiveVisualization }> {
    const session = await this.get(id);
    const metadata = await this.visuals.revert(
      session,
      visualizationId,
      version,
    );
    const updated = await this.saveVisualMetadata(session, metadata, {
      visualId: metadata.id,
      version,
      title: metadata.title,
      action: 'reverted',
    });
    return {
      session: updated,
      visualization: await this.visuals.load(updated, visualizationId, version),
    };
  }

  /**
   * Panel path: tailor an open visual from a plain-English instruction. Same
   * pipeline as the `update_visual` tool, but callable over HTTP, and it logs
   * the `updated` chat event the way the generate button logs `created`.
   */
  async tailorVisualization(
    id: string,
    visualizationId: string,
    instruction: string,
  ): Promise<{ session: SessionDoc; visualization: InteractiveVisualization }> {
    const trimmed = (instruction ?? '').trim();
    if (!trimmed) throw new BadRequestException('instruction is required');
    const session = await this.get(id);
    const { metadata } = await this.visuals.update(
      session,
      visualizationId,
      trimmed,
    );
    const version = this.visuals.currentVersion(metadata);
    const updated = await this.saveVisualMetadata(session, metadata, {
      visualId: metadata.id,
      version,
      title: metadata.title,
      action: 'updated',
    });
    return {
      session: updated,
      visualization: await this.visuals.load(updated, visualizationId, version),
    };
  }

  /**
   * Re-run the SQL behind the visual's current version and refresh its data
   * in place — no new version, no designer call, no chat event. Separates
   * the visual's data from its code: the code stays exactly as designed,
   * only the rows change.
   */
  async refreshVisualizationData(
    id: string,
    visualizationId: string,
  ): Promise<{ session: SessionDoc; visualization: InteractiveVisualization }> {
    const session = await this.get(id);
    const { metadata } = await this.visuals.refreshData(
      session,
      visualizationId,
    );
    const version = this.visuals.currentVersion(metadata);
    const updated = await this.saveVisualMetadata(session, metadata);
    return {
      session: updated,
      visualization: await this.visuals.load(updated, visualizationId, version),
    };
  }

  /**
   * Silent auto-repair of a visual that failed in the dataset. Only the
   * current version may be repaired, and only once — the version guard here
   * repeats the client's check because the client is not trusted, and
   * `VisualizationService.repair` refuses to repair an auto-repair.
   */
  async repairVisualization(
    id: string,
    visualizationId: string,
    error: string,
    version: number,
  ): Promise<{ session: SessionDoc; visualization: InteractiveVisualization }> {
    const session = await this.get(id);
    const meta = this.visuals.find(session, visualizationId);
    const current = this.visuals.currentVersion(meta);
    if (version !== current) {
      throw new BadRequestException(
        `Only the current version can be repaired (requested v${version}, current v${current})`,
      );
    }
    const { metadata } = await this.visuals.repair(
      session,
      visualizationId,
      error,
    );
    const repaired = this.visuals.currentVersion(metadata);
    // No chat event: an automatic fix is not a conversation turn.
    const updated = await this.saveVisualMetadata(session, metadata);
    return {
      session: updated,
      visualization: await this.visuals.load(
        updated,
        visualizationId,
        repaired,
      ),
    };
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

  // ---------------------------------------------------------------- chat

  /** Append a user message, run the agent over the history, persist both. */
  async sendMessage(id: string, content: string): Promise<SessionDoc> {
    const trimmed = (content ?? '').trim();
    if (!trimmed) throw new BadRequestException('message is required');
    const session = await this.get(id);
    return this.turns.generateTurn(session, trimmed);
  }

  /**
   * Streamed chat turn: emits reasoning/text/tool deltas as they arrive,
   * persists the exchange at the end, then emits `done` with the session.
   *
   * `careful` opts the turn into an independent cross-check of the answer's
   * SQL, run before `done` so the transcript the client receives already
   * carries the verdict.
   */
  async streamMessage(
    id: string,
    content: string,
    emit: (event: StreamEvent) => void,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
    careful = false,
  ): Promise<void> {
    const trimmed = (content ?? '').trim();
    if (!trimmed) throw new BadRequestException('message is required');
    const session = await this.get(id);
    await this.turns.streamTurn(
      session,
      trimmed,
      emit,
      abortSignal,
      activeVisualId,
      careful,
    );
  }

  // ------------------------------------------------------------- feedback

  /**
   * Persist a thumbs rating on one assistant answer. Thumbs-up promotes the
   * answer's question → SQL pair into the verified query library (Vanna
   * pattern) and badges the answer as verified; thumbs-down removes whatever
   * that answer contributed and clears the badge. An answer that ran no SQL
   * just records the rating.
   */
  async recordFeedback(
    id: string,
    messageAt: string,
    rating: MessageFeedback,
  ): Promise<SessionDoc> {
    const session = await this.get(id);
    const messages = await this.rateAnswer(
      session,
      messageAt,
      rating,
      { sourceSessionId: id },
      () => this.verifiedQueries.removeForMessage(id, messageAt),
    );
    const updated = await this.updateDoc(id, { messages });
    return updated ?? { ...session, messages };
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
