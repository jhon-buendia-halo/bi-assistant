import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestContext } from '@mastra/core/request-context';
import { MastraService } from '../../mastra/mastra.service';
import { setSandboxToolServices } from '../../mastra/tool-services';
import type { SandboxSnapshot, SqlRunResult } from '../../mastra/tool-services';
import { sqlFixOutputSchema } from '../../mastra/agents/sql-fixer.agent';
import { SANDBOXES_CONTEXT_KEY } from '../../mastra/tools/sandbox.tools';
import {
  ACTIVE_VISUAL_CONTEXT_KEY,
  PROJECT_ID_CONTEXT_KEY,
} from '../../mastra/tools/visual.tools';
import { PROJECT_WORKSPACE_CONTEXT_KEY } from '../../mastra/project-workspaces';
import { SandboxRepository } from '../sandbox/repositories/sandbox.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { LlmService } from '../llm/llm.service';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
import { ProjectsRepository } from './repositories/projects.repository';
import { VisualizationService } from './visualization.service';
import { sourceEntities } from './visualization-document';
import {
  ChatMessage,
  InteractiveVisualization,
  MessageFeedback,
  ProjectDoc,
  ProjectVisualization,
  ToolDataRecord,
  VisualEvent,
} from './entities/project.entity';

const STORED_ROWS_CAP = 200;
const SYNTHESIS_ROWS_CAP = 50;
const EMPTY_RESPONSE_FALLBACK =
  'I completed the data analysis but could not produce a final response. Please retry your question.';
const VISUAL_TOOLS = new Set(['create_visual', 'update_visual']);
/** Repair attempts allowed per failed statement (3 executions at most). */
const SQL_REPAIR_ATTEMPTS = 2;
const SQL_REPAIRED_NOTE =
  'original query failed and was auto-corrected — cite the corrected SQL';
const EMPTY_ROWS_NOTE =
  'query returned 0 rows — verify filters/values before concluding';
const limitReachedNote = (limit: number) =>
  `row limit ${limit} reached — results may be incomplete; aggregate or narrow the query for exact totals`;
/** Character budget for the schema block handed to the fixer. */
const FIXER_SCHEMA_CHARS = 4_000;

export type StreamEvent = {
  type:
    'reasoning' | 'text' | 'tool' | 'tool-result' | 'visual-updated' | 'done';
  content?: string;
  project?: ProjectDoc;
};

@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly repository: ProjectsRepository,
    private readonly mastra: MastraService,
    private readonly sandboxRepository: SandboxRepository,
    private readonly datasourcesService: DatasourcesService,
    private readonly llmService: LlmService,
    private readonly visuals: VisualizationService,
    private readonly verifiedQueries: VerifiedQueriesService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Install the DI bridge the Mastra tools use (they load with no Nest DI).
    setSandboxToolServices({
      getSandboxes: (names) => this.boundSandboxes(names),
      sampleRows: (datasourceId, entity, limit) =>
        this.datasourcesService.sampleRows(datasourceId, entity, limit),
      runReadOnlySql: (datasourceId, sql, limit, sandboxes) =>
        this.runSqlWithRepair(datasourceId, sql, limit, sandboxes),
      createVisual: async (projectId, sourceMessageAt, instruction) => {
        const project = await this.get(projectId);
        const { metadata } = await this.visuals.create(
          project,
          sourceMessageAt,
          instruction,
        );
        await this.saveVisualMetadata(project, metadata);
        return this.toolResult(metadata);
      },
      updateVisual: async (projectId, visualId, instruction) => {
        const project = await this.get(projectId);
        const { metadata } = await this.visuals.update(
          project,
          visualId,
          instruction,
        );
        await this.saveVisualMetadata(project, metadata);
        return this.toolResult(metadata);
      },
    });

    // Backfill workspaces for projects created before workspace support and
    // restore their registrations after every process restart.
    const projects = await this.repository.list();
    await Promise.all(
      projects.map(async (project) => {
        const workspace = await this.mastra.ensureProjectWorkspace(
          project.id,
          project.name,
        );
        if (project.workspaceId !== workspace.id) {
          await this.repository.update(project.id, {
            workspaceId: workspace.id,
          });
        }
      }),
    );
  }

  /**
   * Hybrid context: a cheap orientation block (sandbox names + entity keys,
   * the project's visuals and which one is open) plus any user-approved
   * question → SQL pairs resembling `question`, in the system context, and
   * requestContext scoping the tools to this project.
   */
  private async agentOptions(
    project: ProjectDoc,
    question?: string,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
  ) {
    const sandboxes = await this.boundSandboxes(project.sandboxes);
    const entityLines = sandboxes.flatMap((s) =>
      s.tables.map(
        (t) =>
          `- ${t} (sandbox: ${s.name}; datasource: ${s.datasourceKind ?? 'unknown'} ${s.datasourceId ?? ''})`,
      ),
    );
    const visualLines = (project.visualizations ?? []).map(
      (v) =>
        `- ${v.id} — "${v.title}" v${this.visuals.currentVersion(v)} (from the answer at ${v.sourceMessageAt})`,
    );
    const requestContext = new RequestContext();
    requestContext.set(SANDBOXES_CONTEXT_KEY, project.sandboxes);
    requestContext.set(PROJECT_ID_CONTEXT_KEY, project.id);
    if (activeVisualId) {
      requestContext.set(ACTIVE_VISUAL_CONTEXT_KEY, activeVisualId);
    }
    const workspace = await this.mastra.ensureProjectWorkspace(
      project.id,
      project.name,
    );
    requestContext.set(PROJECT_WORKSPACE_CONTEXT_KEY, workspace.id);
    const { reasoningEffort } = await this.llmService.getView();
    const verified = question
      ? await this.verifiedQueries.referenceBlock(question)
      : undefined;
    return {
      // Analysis often chains several schema + SQL tool calls per turn.
      maxSteps: 15,
      // The user-configured reasoning effort (Low/Medium/High chip).
      providerOptions: { openai: { reasoningEffort } },
      context: [
        {
          role: 'system' as const,
          content: [
            `Data sandboxes for this project: ${project.sandboxes.join(', ')}.`,
            'Entities available (fully-qualified catalog.schema.table):',
            ...(entityLines.length
              ? entityLines
              : ['(none — the sandboxes are empty)']),
            'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
            '',
            'Interactive visuals in this project (id — title, current version):',
            ...(visualLines.length ? visualLines : ['(none yet)']),
            activeVisualId
              ? `Visual currently open in the right panel: ${activeVisualId}.`
              : 'No visual is open in the right panel.',
          ].join('\n'),
        },
        ...(verified ? [{ role: 'system' as const, content: verified }] : []),
      ],
      requestContext,
      abortSignal,
      // Each project is an isolated, persistent Mastra conversation.
      memory: { thread: project.id, resource: project.id },
    };
  }

  /**
   * Sandboxes created before datasources existed carry no binding — attach
   * the preferred saved datasource so tools can still run.
   */
  private async boundSandboxes(names: string[]) {
    const sandboxes = await this.sandboxRepository.getByNames(names);
    if (sandboxes.every((s) => s.datasourceId)) return sandboxes;
    const fallback = await this.datasourcesService.defaultDatasource();
    return sandboxes.map((s) =>
      s.datasourceId || !fallback
        ? s
        : {
            ...s,
            datasourceId: fallback.id,
            datasourceKind: fallback.kind,
          },
    );
  }

  // ----------------------------------------------------- SQL self-correction

  /**
   * Execution-guided repair: when a statement fails to execute, hand it plus
   * the engine error and the schema in scope to the `sql-fixer` agent and
   * re-run, up to `SQL_REPAIR_ATTEMPTS` times. Empty result sets are not
   * errors — they get a note, never an LLM call. The last error propagates so
   * the tool reports it to the agent as before.
   */
  private async runSqlWithRepair(
    datasourceId: string,
    sql: string,
    limit: number,
    sandboxNames: string[],
  ): Promise<SqlRunResult> {
    let statement = sql;
    let fixerContext: { dialect: string; schema: string } | undefined;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.datasourcesService.runReadOnlySql(
          datasourceId,
          statement,
          limit,
        );
        const repaired = statement !== sql;
        // A full page of rows means the connector clipped the result set —
        // the model must aggregate or caveat rather than treat it as total.
        const truncated = result.rows.length >= limit;
        const notes = [
          ...(repaired ? [SQL_REPAIRED_NOTE] : []),
          ...(result.rows.length ? [] : [EMPTY_ROWS_NOTE]),
          ...(truncated ? [limitReachedNote(limit)] : []),
        ];
        return {
          ...result,
          ...(repaired ? { correctedSql: statement } : {}),
          ...(truncated ? { truncated: true } : {}),
          ...(notes.length ? { note: notes.join('; ') } : {}),
        };
      } catch (error) {
        if (attempt >= SQL_REPAIR_ATTEMPTS) throw error;
        const message = error instanceof Error ? error.message : String(error);
        fixerContext ??= await this.sqlFixerContext(sandboxNames, datasourceId);
        const corrected = await this.repairSql(
          statement,
          message,
          fixerContext,
        );
        if (!corrected || corrected === statement) throw error;
        this.logger.warn(
          `Repairing failed SQL (attempt ${attempt + 1}): ${message}`,
        );
        statement = corrected;
      }
    }
  }

  /** Dialect + a capped `entity(column type, …)` block for the fixer prompt. */
  private async sqlFixerContext(
    sandboxNames: string[],
    datasourceId: string,
  ): Promise<{ dialect: string; schema: string }> {
    const sandboxes = await this.boundSandboxes(sandboxNames);
    const onDatasource = sandboxes.filter(
      (s) => s.datasourceId === datasourceId,
    );
    const inScope: SandboxSnapshot[] = onDatasource.length
      ? onDatasource
      : sandboxes;
    const dialect =
      inScope.find((s) => s.datasourceKind)?.datasourceKind ?? 'databricks';
    const lines: string[] = [];
    let budget = FIXER_SCHEMA_CHARS;
    for (const sandbox of inScope) {
      for (const key of sandbox.tables) {
        const columns =
          sandbox.entities?.find((e) => e.key === key)?.columns ?? [];
        const line = `${key}(${columns.map((c) => `${c.name} ${c.type}`).join(', ')})`;
        if (line.length > budget) return { dialect, schema: lines.join('\n') };
        budget -= line.length;
        lines.push(line);
      }
    }
    return { dialect, schema: lines.join('\n') };
  }

  /** One fixer pass; returns undefined when it produced nothing usable. */
  private async repairSql(
    sql: string,
    error: string,
    context: { dialect: string; schema: string },
  ): Promise<string | undefined> {
    try {
      const result = await this.mastra
        .getAgent('sql-fixer')
        .generate(
          [
            `Dialect: ${context.dialect}`,
            '',
            '<available-entities>',
            context.schema || '(no schema snapshot stored for this project)',
            '</available-entities>',
            '',
            '<failed-sql>',
            sql,
            '</failed-sql>',
            '',
            '<error>',
            error,
            '</error>',
          ].join('\n'),
          {
            maxSteps: 1,
            toolChoice: 'none',
            // A syntax/column fix does not benefit from hidden reasoning tokens.
            providerOptions: { openai: { reasoningEffort: 'low' } },
            structuredOutput: {
              schema: sqlFixOutputSchema,
              jsonPromptInjection: 'inline',
            },
          },
        );
      const parsed = sqlFixOutputSchema.safeParse(
        result.object ?? parseJsonObject(result.text),
      );
      if (!parsed.success) return undefined;
      const corrected = parsed.data.sql
        .trim()
        .replace(/^```(?:sql)?\s*/i, '')
        .replace(/\s*```$/, '')
        .replace(/;+\s*$/, '')
        .trim();
      // The connector rejects anything else anyway — keep the original error
      // instead of burning another round-trip on it.
      return /^(select|with)\b/i.test(corrected) ? corrected : undefined;
    } catch (err) {
      this.logger.warn(
        `SQL repair attempt failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  // --------------------------------------------------------------- internals

  /**
   * Mastra stores new turns itself once a project thread exists. For projects
   * created before memory was enabled, bootstrap the thread once from the
   * already-persisted project transcript.
   */
  private async agentInput(
    agent: ReturnType<MastraService['getAgent']>,
    project: ProjectDoc,
  ) {
    const memory = await agent.getMemory();
    const thread = await memory?.getThreadById({ threadId: project.id });
    const latest = project.messages.at(-1);
    const previous = project.messages.at(-2);
    if (thread && latest?.role === 'user') {
      // A clarification ends its turn before memory sees the question, so
      // replay it alongside the user's answer.
      if (previous?.role === 'assistant' && previous.clarification) {
        return [
          { role: 'assistant' as const, content: previous.content },
          { role: 'user' as const, content: latest.content },
        ];
      }
      return latest.content;
    }

    return project.messages.map((message) =>
      message.role === 'user'
        ? { role: 'user' as const, content: message.content }
        : { role: 'assistant' as const, content: message.content },
    );
  }

  list(): Promise<ProjectDoc[]> {
    return this.repository.list();
  }

  async get(id: string): Promise<ProjectDoc> {
    const project = await this.repository.get(id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  /** Delete a project and all Mastra state owned exclusively by it. */
  async delete(id: string): Promise<ProjectDoc> {
    const project = await this.get(id);
    await this.mastra.deleteProjectResources(id);
    const removed = await this.repository.delete(id);
    if (removed === 0) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  /** Create a named project; the conversation starts empty in the chat view. */
  async create(name: string, sandboxes: string[]): Promise<ProjectDoc> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('project name is required');
    if (!Array.isArray(sandboxes) || sandboxes.length === 0) {
      throw new BadRequestException('select at least one sandbox');
    }
    const id = randomUUID();
    const workspace = await this.mastra.ensureProjectWorkspace(id, trimmed);
    return this.repository.insert({
      id,
      name: trimmed.slice(0, 64),
      workspaceId: workspace.id,
      sandboxes,
      messages: [],
      visualizations: [],
    });
  }

  // ------------------------------------------------------------- visuals

  /** Button path: generate a visual for one answer and record it in the chat. */
  async generateVisualization(
    id: string,
    sourceMessageAt: string,
  ): Promise<{ project: ProjectDoc; visualization: InteractiveVisualization }> {
    const project = await this.get(id);
    const { metadata } = await this.visuals.create(
      project,
      sourceMessageAt || undefined,
    );
    const updated = await this.saveVisualMetadata(project, metadata, {
      visualId: metadata.id,
      version: 1,
      title: metadata.title,
      action: 'created',
    });
    return {
      project: updated,
      visualization: await this.visuals.load(updated, metadata.id, 1),
    };
  }

  async getVisualization(
    id: string,
    visualizationId: string,
    version?: number,
  ): Promise<InteractiveVisualization> {
    return this.visuals.load(await this.get(id), visualizationId, version);
  }

  async downloadVisualization(
    id: string,
    visualizationId: string,
    version?: number,
  ): Promise<{ filename: string; archive: Buffer }> {
    return this.visuals.download(await this.get(id), visualizationId, version);
  }

  async revertVisualization(
    id: string,
    visualizationId: string,
    version: number,
  ): Promise<{ project: ProjectDoc; visualization: InteractiveVisualization }> {
    const project = await this.get(id);
    const metadata = await this.visuals.revert(
      project,
      visualizationId,
      version,
    );
    const updated = await this.saveVisualMetadata(project, metadata, {
      visualId: metadata.id,
      version,
      title: metadata.title,
      action: 'reverted',
    });
    return {
      project: updated,
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
  ): Promise<{ project: ProjectDoc; visualization: InteractiveVisualization }> {
    const trimmed = (instruction ?? '').trim();
    if (!trimmed) throw new BadRequestException('instruction is required');
    const project = await this.get(id);
    const { metadata } = await this.visuals.update(
      project,
      visualizationId,
      trimmed,
    );
    const version = this.visuals.currentVersion(metadata);
    const updated = await this.saveVisualMetadata(project, metadata, {
      visualId: metadata.id,
      version,
      title: metadata.title,
      action: 'updated',
    });
    return {
      project: updated,
      visualization: await this.visuals.load(updated, visualizationId, version),
    };
  }

  /**
   * Silent auto-repair of a visual that failed in the sandbox. Only the
   * current version may be repaired, and only once — the version guard here
   * repeats the client's check because the client is not trusted, and
   * `VisualizationService.repair` refuses to repair an auto-repair.
   */
  async repairVisualization(
    id: string,
    visualizationId: string,
    error: string,
    version: number,
  ): Promise<{ project: ProjectDoc; visualization: InteractiveVisualization }> {
    const project = await this.get(id);
    const meta = this.visuals.find(project, visualizationId);
    const current = this.visuals.currentVersion(meta);
    if (version !== current) {
      throw new BadRequestException(
        `Only the current version can be repaired (requested v${version}, current v${current})`,
      );
    }
    const { metadata } = await this.visuals.repair(
      project,
      visualizationId,
      error,
    );
    const repaired = this.visuals.currentVersion(metadata);
    // No chat event: an automatic fix is not a conversation turn.
    const updated = await this.saveVisualMetadata(project, metadata);
    return {
      project: updated,
      visualization: await this.visuals.load(
        updated,
        visualizationId,
        repaired,
      ),
    };
  }

  /** Upsert visual metadata on the project, optionally logging a chat event. */
  private async saveVisualMetadata(
    project: ProjectDoc,
    metadata: ProjectVisualization,
    event?: VisualEvent,
  ): Promise<ProjectDoc> {
    const fresh = await this.get(project.id);
    const others = (fresh.visualizations ?? []).filter(
      (v) => v.id !== metadata.id,
    );
    const patch: Partial<ProjectDoc> = {
      visualizations: [...others, metadata],
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
    return (await this.repository.update(project.id, patch)) ?? fresh;
  }

  private toolResult(metadata: ProjectVisualization) {
    return {
      visualId: metadata.id,
      version: this.visuals.currentVersion(metadata),
      title: metadata.title,
      description: metadata.description,
    };
  }

  // ---------------------------------------------------------------- chat

  /** Append a user message, run the agent over the history, persist both. */
  async sendMessage(id: string, content: string): Promise<ProjectDoc> {
    const trimmed = (content ?? '').trim();
    if (!trimmed) throw new BadRequestException('message is required');
    const project = await this.get(id);
    this.appendUserMessage(project, trimmed);
    const agent = this.mastra.getAgent('assistant');
    const input = await this.agentInput(agent, project);
    const result = await agent.generate(
      input,
      await this.agentOptions(project, trimmed),
    );
    project.messages.push({
      role: 'assistant',
      content: (result.text ?? '').trim(),
      at: new Date().toISOString(),
    });
    const updated = await this.repository.update(id, {
      messages: project.messages,
    });
    return updated ?? project;
  }

  /**
   * Streamed chat turn: emits reasoning/text/tool deltas as they arrive,
   * persists the exchange at the end, then emits `done` with the project.
   */
  async streamMessage(
    id: string,
    content: string,
    emit: (event: StreamEvent) => void,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
  ): Promise<void> {
    const trimmed = (content ?? '').trim();
    if (!trimmed) throw new BadRequestException('message is required');
    const project = await this.get(id);
    this.appendUserMessage(project, trimmed);
    // Persist the prompt before model startup. A user can stop while the
    // provider is still connecting, and that turn should survive a reload.
    await this.repository.update(id, { messages: project.messages });

    const agent = this.mastra.getAgent('assistant');
    const input = await this.agentInput(agent, project);
    // Own controller so a clarification can end the model turn without the
    // client having disconnected.
    const turn = new AbortController();
    const forwardAbort = () => turn.abort();
    abortSignal?.addEventListener('abort', forwardAbort, { once: true });
    const stream = await agent.stream(
      input,
      await this.agentOptions(project, trimmed, turn.signal, activeVisualId),
    );

    let text = '';
    let clarification: ChatMessage['clarification'] | null = null;
    let visualEvent: VisualEvent | undefined;
    const data: ToolDataRecord[] = [];
    const pendingCalls = new Map<string, Record<string, unknown>>();
    try {
      for await (const chunk of stream.fullStream) {
        if (chunk.type === 'reasoning-delta') {
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
          if (payload.toolName === 'ask_clarification') {
            // Clarification ends the turn — the card renders in the UI and the
            // user's pick arrives as the next message. Abort so the model
            // does not keep analysing (and spending) behind the card.
            const args = payload.args ?? {};
            clarification = {
              question: String(args['question'] ?? 'Can you clarify?'),
              options: Array.isArray(args['options'])
                ? (args['options'] as { label: string; description?: string }[])
                : [],
            };
            turn.abort();
            break;
          }
          if (payload.toolCallId) {
            pendingCalls.set(payload.toolCallId, payload.args ?? {});
          }
          emit({ type: 'tool', content: payload.toolName ?? 'tool' });
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
            (payload.toolCallId ? pendingCalls.get(payload.toolCallId) : {}) ??
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
              }),
            });
          }
        }
      }
    } catch (error) {
      if (!turn.signal.aborted) throw error;
    } finally {
      abortSignal?.removeEventListener('abort', forwardAbort);
    }
    if (!turn.signal.aborted && !clarification && !text) {
      text = ((await stream.text) ?? '').trim();
    }
    if (
      !turn.signal.aborted &&
      !clarification &&
      !text.trim() &&
      !visualEvent
    ) {
      // A model can spend every allowed step on tools and finish without a
      // user-facing answer. Give it one tool-disabled pass to turn the data it
      // already collected into prose; never let a completed turn disappear.
      text = await this.synthesizeToolOnlyTurn(
        agent,
        trimmed,
        data,
        turn.signal,
      );
      if (turn.signal.aborted) return;
      if (text) emit({ type: 'text', content: text });
    }

    // Visual tools persist metadata mid-turn; reload so this write keeps it.
    const fresh = await this.get(id);
    const messages = fresh.messages;
    const entities = sourceEntities(data);
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
      });
    } else if (text.trim() || visualEvent) {
      const interpretation = interpretationLine(data, entities);
      messages.push({
        role: 'assistant',
        content:
          text.trim() ||
          `${visualEvent!.action === 'created' ? 'Created' : 'Updated'} interactive visual "${visualEvent!.title}" (v${visualEvent!.version}).`,
        at: new Date().toISOString(),
        ...(data.length ? { data } : {}),
        ...(entities.length ? { entities } : {}),
        ...(interpretation ? { interpretation } : {}),
        ...((await this.matchesVerifiedQuery(project, data))
          ? { verified: true }
          : {}),
        ...(visualEvent ? { visual: visualEvent } : {}),
      });
    }
    const updated = await this.repository.update(id, { messages });
    if (!turn.signal.aborted || clarification) {
      emit({ type: 'done', project: updated ?? fresh });
    }
  }

  private async synthesizeToolOnlyTurn(
    agent: ReturnType<MastraService['getAgent']>,
    question: string,
    data: ToolDataRecord[],
    abortSignal: AbortSignal,
  ): Promise<string> {
    if (!data.length) return EMPTY_RESPONSE_FALLBACK;

    const compactData = data.map((record) => ({
      ...record,
      rows: record.rows?.slice(0, SYNTHESIS_ROWS_CAP),
    }));
    try {
      const { reasoningEffort } = await this.llmService.getView();
      const result = await agent.generate(
        [
          'Answer the original user question using only the tool results below.',
          'Give concrete findings, comparisons, a short takeaway, and name the source entities from the SQL where possible.',
          'Do not call tools and do not mention internal step limits.',
          '',
          `Original question: ${question}`,
          '',
          `Tool results: ${JSON.stringify(compactData)}`,
        ].join('\n'),
        {
          instructions:
            'You are a data analyst writing the final answer from completed query results.',
          maxSteps: 1,
          toolChoice: 'none',
          abortSignal,
          providerOptions: { openai: { reasoningEffort } },
        },
      );
      return (result.text ?? '').trim() || EMPTY_RESPONSE_FALLBACK;
    } catch (error) {
      if (abortSignal.aborted) return '';
      this.logger.warn(
        `Final synthesis failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return EMPTY_RESPONSE_FALLBACK;
    }
  }

  /**
   * Does this turn's final statement reproduce a query the user already
   * approved? Drives the "Verified" badge — a library miss is not an error,
   * so a failing lookup just leaves the answer unbadged.
   */
  private async matchesVerifiedQuery(
    project: ProjectDoc,
    data: ToolDataRecord[],
  ): Promise<boolean> {
    const sql = lastSuccessfulSql(data);
    if (!sql) return false;
    try {
      return await this.verifiedQueries.isVerifiedSql(
        sql,
        await this.soleDatasourceId(project),
      );
    } catch (error) {
      this.logger.warn(
        `Verified query lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
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
  ): Promise<ProjectDoc> {
    if (rating !== 'up' && rating !== 'down') {
      throw new BadRequestException("rating must be 'up' or 'down'");
    }
    if (!messageAt) throw new BadRequestException('messageAt is required');
    const project = await this.get(id);
    const index = project.messages.findIndex(
      (m) => m.role === 'assistant' && m.at === messageAt,
    );
    if (index < 0) {
      throw new NotFoundException(`No assistant message at ${messageAt}`);
    }
    const messages = [...project.messages];
    const answer: ChatMessage = { ...messages[index], feedback: rating };
    // The rating is the authority on the badge: approving an answer verifies
    // it, rejecting it takes the badge away even if the SQL is still stored.
    if (rating === 'up') answer.verified = true;
    else delete answer.verified;
    messages[index] = answer;

    if (rating === 'down') {
      await this.verifiedQueries.removeForMessage(id, messageAt);
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
          datasourceId: await this.soleDatasourceId(project),
          entities: answer.entities ?? [],
          sourceProjectId: id,
          sourceMessageAt: messageAt,
        });
      }
    }
    const updated = await this.repository.update(id, { messages });
    return updated ?? { ...project, messages };
  }

  /** The project's datasource when it is unambiguous — provenance only. */
  private async soleDatasourceId(
    project: ProjectDoc,
  ): Promise<string | undefined> {
    const sandboxes = await this.boundSandboxes(project.sandboxes);
    const ids = new Set(
      sandboxes.map((s) => s.datasourceId).filter((id): id is string => !!id),
    );
    return ids.size === 1 ? Array.from(ids)[0] : undefined;
  }

  /**
   * Append the user's prompt — unless the transcript already ends with that
   * exact unanswered prompt (a retry after a failed turn), in which case reuse
   * it instead of duplicating the bubble.
   */
  private appendUserMessage(project: ProjectDoc, content: string): void {
    const latest = project.messages.at(-1);
    if (latest?.role === 'user' && latest.content === content) return;
    project.messages.push({
      role: 'user',
      content,
      at: new Date().toISOString(),
    });
  }
}

/** Turn a data-bearing tool result into a compact, storable record. */
function toolDataRecord(
  tool: string,
  args: Record<string, unknown>,
  result: unknown,
): ToolDataRecord | null {
  if (tool !== 'run_readonly_sql' && tool !== 'sample_rows') return null;
  const value = (result ?? {}) as {
    columns?: unknown;
    rows?: unknown;
    error?: unknown;
    correctedSql?: unknown;
    truncated?: unknown;
  };
  // Show the statement that actually ran, so the answer and any visual cite
  // the repaired SQL rather than the one that failed.
  const input =
    typeof value.correctedSql === 'string'
      ? value.correctedSql
      : typeof args['sql'] === 'string'
        ? args['sql']
        : typeof args['entity'] === 'string'
          ? args['entity']
          : undefined;
  if (typeof value.error === 'string') {
    return { tool, input, error: value.error };
  }
  const rows = Array.isArray(value.rows)
    ? (value.rows as Record<string, unknown>[])
    : [];
  const columns = Array.isArray(value.columns)
    ? value.columns.map((c) => String(c))
    : Object.keys(rows[0] ?? {});
  // Clipped either by the query's own row limit (flagged by the bridge) or by
  // what we keep in the transcript.
  const truncated = value.truncated === true || rows.length > STORED_ROWS_CAP;
  return {
    tool,
    input,
    columns,
    rows: rows.slice(0, STORED_ROWS_CAP),
    rowCount: rows.length,
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Successful SQL runs behind an answer, oldest first. */
function successfulSqlRuns(data: ToolDataRecord[] | undefined) {
  return (data ?? []).filter(
    (record) =>
      record.tool === 'run_readonly_sql' &&
      !record.error &&
      record.input?.trim(),
  );
}

/** The SQL behind an answer: its last `run_readonly_sql` that did not fail. */
function lastSuccessfulSql(
  data: ToolDataRecord[] | undefined,
): string | undefined {
  return successfulSqlRuns(data).at(-1)?.input?.trim();
}

/**
 * Deterministic one-line provenance summary shown above an answer's data
 * expandables. Built from the captured records only — no model involved, so
 * the claim can never drift from what actually ran.
 */
function interpretationLine(
  data: ToolDataRecord[] | undefined,
  entities: string[],
): string | undefined {
  const runs = successfulSqlRuns(data);
  if (!runs.length) return undefined;
  const rows = runs.reduce(
    (total, record) => total + (record.rowCount ?? record.rows?.length ?? 0),
    0,
  );
  const queries = `${runs.length} quer${runs.length === 1 ? 'y' : 'ies'}`;
  const over = entities.length ? ` over ${entities.join(', ')}` : '';
  return `Computed from ${queries}${over} — ${rows} row${rows === 1 ? '' : 's'} analyzed.`;
}

/** Parse a model's JSON reply, tolerating a markdown fence around it. */
function parseJsonObject(text: string | undefined): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    );
  } catch {
    return undefined;
  }
}
