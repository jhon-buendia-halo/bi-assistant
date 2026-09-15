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
import { SANDBOXES_CONTEXT_KEY } from '../../mastra/tools/sandbox.tools';
import {
  ACTIVE_VISUAL_CONTEXT_KEY,
  PROJECT_ID_CONTEXT_KEY,
} from '../../mastra/tools/visual.tools';
import { PROJECT_WORKSPACE_CONTEXT_KEY } from '../../mastra/project-workspaces';
import { SandboxRepository } from '../sandbox/repositories/sandbox.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { LlmService } from '../llm/llm.service';
import { ProjectsRepository } from './repositories/projects.repository';
import { VisualizationService } from './visualization.service';
import {
  ChatMessage,
  InteractiveVisualization,
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
  ) {}

  async onModuleInit(): Promise<void> {
    // Install the DI bridge the Mastra tools use (they load with no Nest DI).
    setSandboxToolServices({
      getSandboxes: (names) => this.boundSandboxes(names),
      sampleRows: (datasourceId, entity, limit) =>
        this.datasourcesService.sampleRows(datasourceId, entity, limit),
      runReadOnlySql: (datasourceId, sql, limit) =>
        this.datasourcesService.runReadOnlySql(datasourceId, sql, limit),
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
   * the project's visuals and which one is open) in the system context, plus
   * requestContext scoping the tools to this project.
   */
  private async agentOptions(
    project: ProjectDoc,
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
      await this.agentOptions(project),
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
      await this.agentOptions(project, turn.signal, activeVisualId),
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
    if (clarification) {
      messages.push({
        role: 'assistant',
        content: clarification.question,
        at: new Date().toISOString(),
        clarification,
      });
    } else if (text.trim() || visualEvent) {
      messages.push({
        role: 'assistant',
        content:
          text.trim() ||
          `${visualEvent!.action === 'created' ? 'Created' : 'Updated'} interactive visual "${visualEvent!.title}" (v${visualEvent!.version}).`,
        at: new Date().toISOString(),
        ...(data.length ? { data } : {}),
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
  const input =
    typeof args['sql'] === 'string'
      ? args['sql']
      : typeof args['entity'] === 'string'
        ? args['entity']
        : undefined;
  const value = (result ?? {}) as {
    columns?: unknown;
    rows?: unknown;
    error?: unknown;
  };
  if (typeof value.error === 'string') {
    return { tool, input, error: value.error };
  }
  const rows = Array.isArray(value.rows)
    ? (value.rows as Record<string, unknown>[])
    : [];
  const columns = Array.isArray(value.columns)
    ? value.columns.map((c) => String(c))
    : Object.keys(rows[0] ?? {});
  return {
    tool,
    input,
    columns,
    rows: rows.slice(0, STORED_ROWS_CAP),
    rowCount: rows.length,
  };
}
