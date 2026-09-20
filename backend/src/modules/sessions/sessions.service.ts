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
import type {
  SandboxColumnSnapshot,
  SandboxSnapshot,
  SqlRunResult,
} from '../../mastra/tool-services';
import { sqlFixOutputSchema } from '../../mastra/agents/sql-fixer.agent';
import { sqlVerifyOutputSchema } from '../../mastra/agents/sql-verifier.agent';
import { SANDBOXES_CONTEXT_KEY } from '../../mastra/tools/sandbox.tools';
import {
  ACTIVE_VISUAL_CONTEXT_KEY,
  SESSION_ID_CONTEXT_KEY,
  TURN_RECORDS_CONTEXT_KEY,
} from '../../mastra/tools/visual.tools';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../../mastra/session-workspaces';
import { SandboxRepository } from '../sandbox/repositories/sandbox.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { LlmService } from '../llm/llm.service';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
import { MetricsService } from '../metrics/metrics.service';
import { SessionsRepository } from './repositories/sessions.repository';
import { VisualizationService } from './visualization.service';
import { sourceEntities } from './visualization-document';
import { compareResults } from './result-compare';
import {
  ChatMessage,
  CrossCheck,
  InteractiveVisualization,
  MessageFeedback,
  SessionDoc,
  SessionVisualization,
  ReasoningStep,
  ToolDataRecord,
  VisualEvent,
} from './entities/session.entity';

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
/** Character budget for the richer (sample-value bearing) verifier schema. */
const VERIFIER_SCHEMA_CHARS = 6_000;
/** Join hints shown up front to the assistant — enough for a wide sandbox. */
const JOIN_HINT_CHARS = 1_500;
/** Sample values shown per column to the verifier — value matching, not data. */
const VERIFIER_SAMPLE_VALUES = 3;
/** Longest cross-check note persisted on a message (tooltip-sized). */
const CROSS_CHECK_NOTE_CHARS = 220;
const CROSS_CHECK_AGREE_NOTE =
  'independent re-derivation returned the same results';
/** Agreement on the figures where the two queries projected different columns. */
const CROSS_CHECK_AGREE_SHAPE_NOTE =
  'independent re-derivation returned the same figures, over different columns';
const CROSS_CHECK_DISAGREE_NOTE = 'results differ — treat with care';
/** Rows the cross-check query may return — matches what the answer stored. */
const CROSS_CHECK_ROW_LIMIT = STORED_ROWS_CAP;
/** Longest rationale kept per step — a sentence or two, never an essay. */
const RATIONALE_CHARS = 400;

export type StreamEvent = {
  type:
    'reasoning' | 'text' | 'tool' | 'tool-result' | 'visual-updated' | 'done';
  content?: string;
  session?: SessionDoc;
};

@Injectable()
export class SessionsService implements OnModuleInit {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly repository: SessionsRepository,
    private readonly mastra: MastraService,
    private readonly sandboxRepository: SandboxRepository,
    private readonly datasourcesService: DatasourcesService,
    private readonly llmService: LlmService,
    private readonly visuals: VisualizationService,
    private readonly verifiedQueries: VerifiedQueriesService,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Install the DI bridge the Mastra tools use (they load with no Nest DI).
    setSandboxToolServices({
      getSandboxes: (names) => this.boundSandboxes(names),
      sampleRows: (datasourceId, entity, limit) =>
        this.datasourcesService.sampleRows(datasourceId, entity, limit),
      runReadOnlySql: (datasourceId, sql, limit, sandboxes) =>
        this.runSqlWithRepair(datasourceId, sql, limit, sandboxes),
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
    });

    // Backfill workspaces for sessions created before workspace support and
    // restore their registrations after every process restart.
    const sessions = await this.repository.list();
    await Promise.all(
      sessions.map(async (session) => {
        const workspace = await this.mastra.ensureSessionWorkspace(
          session.id,
          session.name,
        );
        if (session.workspaceId !== workspace.id) {
          await this.repository.update(session.id, {
            workspaceId: workspace.id,
          });
        }
      }),
    );
  }

  /**
   * Hybrid context: a cheap orientation block (sandbox names + entity keys,
   * the session's visuals and which one is open), the curated metric
   * definitions covering those entities, plus any user-approved question → SQL
   * pairs resembling `question`, in the system context, and requestContext
   * scoping the tools to this session.
   *
   * Memory-free on purpose — `agentOptions` adds the session's conversation
   * thread, `backgroundAgentOptions` deliberately does not.
   */
  private async agentContext(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
  ) {
    const sandboxes = await this.boundSandboxes(session.sandboxes);
    const entityLines = sandboxes.flatMap((s) =>
      s.tables.map(
        (t) =>
          `- ${t} (sandbox: ${s.name}; datasource: ${s.datasourceKind ?? 'unknown'} ${s.datasourceId ?? ''})`,
      ),
    );
    const joinHints = joinHintBlock(sandboxes);
    const visualLines = (session.visualizations ?? []).map(
      (v) =>
        `- ${v.id} — "${v.title}" v${this.visuals.currentVersion(v)} (from the answer at ${v.sourceMessageAt})`,
    );
    const requestContext = new RequestContext();
    requestContext.set(SANDBOXES_CONTEXT_KEY, session.sandboxes);
    requestContext.set(SESSION_ID_CONTEXT_KEY, session.id);
    if (activeVisualId) {
      requestContext.set(ACTIVE_VISUAL_CONTEXT_KEY, activeVisualId);
    }
    const workspace = await this.mastra.ensureSessionWorkspace(
      session.id,
      session.name,
    );
    requestContext.set(SESSION_WORKSPACE_CONTEXT_KEY, workspace.id);
    const { reasoningEffort } = await this.llmService.getView();
    const verified = question
      ? await this.verifiedQueries.referenceBlock(question)
      : undefined;
    // Curated semantics for the entities this session can see — the one
    // definition of each business number, never re-derived per turn.
    const metrics = await this.metrics.definitionBlock(
      sandboxes.flatMap((s) => s.tables ?? []),
    );
    return {
      // Analysis often chains several schema + SQL tool calls per turn.
      maxSteps: 15,
      // The user-configured reasoning effort (Low/Medium/High chip).
      providerOptions: { openai: { reasoningEffort } },
      context: [
        {
          role: 'system' as const,
          content: [
            `Data sandboxes for this session: ${session.sandboxes.join(', ')}.`,
            'Entities available (fully-qualified catalog.schema.table):',
            ...(entityLines.length
              ? entityLines
              : ['(none — the sandboxes are empty)']),
            'Use describe_entity / sample_rows / run_readonly_sql to inspect and query them.',
            ...(joinHints ? ['', joinHints] : []),
            '',
            'Interactive visuals in this session (id — title, current version):',
            ...(visualLines.length ? visualLines : ['(none yet)']),
            activeVisualId
              ? `Visual currently open in the right panel: ${activeVisualId}.`
              : 'No visual is open in the right panel.',
          ].join('\n'),
        },
        ...(metrics ? [{ role: 'system' as const, content: metrics }] : []),
        ...(verified ? [{ role: 'system' as const, content: verified }] : []),
      ],
      requestContext,
      abortSignal,
    };
  }

  /** Chat turns: the shared grounding plus this session's memory thread. */
  private async agentOptions(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
  ) {
    return {
      ...(await this.agentContext(
        session,
        question,
        abortSignal,
        activeVisualId,
      )),
      // Each session is an isolated, persistent Mastra conversation.
      memory: { thread: session.id, resource: session.id },
    };
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
    return this.agentContext(session, question, abortSignal);
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
    return (
      (await this.repository.update(id, { messages })) ?? { ...fresh, messages }
    );
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
            context.schema || '(no schema snapshot stored for this session)',
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
      // The connector rejects anything but a read-only statement anyway — keep
      // the original error instead of burning another round-trip on it.
      return parsed.success ? readOnlyStatement(parsed.data.sql) : undefined;
    } catch (err) {
      this.logger.warn(
        `SQL repair attempt failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  // ------------------------------------------------------- careful mode

  /**
   * Careful mode's cross-check: a second agent re-derives the question's SQL
   * without ever seeing the statement the analysis agent ran, that statement is
   * executed once, and the two result sets are compared as multisets. Agreement
   * is therefore corroboration, not an echo of the first answer.
   *
   * Never throws — a check that cannot run reports `error`, because failing to
   * verify must not lose the answer it was verifying.
   */
  private async crossCheckAnswer(
    session: SessionDoc,
    question: string,
    data: ToolDataRecord[],
  ): Promise<CrossCheck | undefined> {
    const record = successfulSqlRuns(data).at(-1);
    // Nothing was executed — there is no result set to corroborate.
    if (!record?.input?.trim()) return undefined;
    try {
      if (record.truncated) {
        this.logger.warn('Cross-check skipped: answer hit the row cap');
        return crossCheck(
          'error',
          "the answer's result set hit the row cap — a partial result cannot be compared",
        );
      }
      const context = await this.verifierContext(session);
      if (!context) {
        this.logger.warn('Cross-check skipped: no datasource bound');
        return crossCheck(
          'error',
          'no datasource is bound to this session, so the query could not be re-run',
        );
      }
      const sql = await this.deriveIndependentSql(question, context);
      if (!sql) {
        this.logger.warn('Cross-check skipped: verifier produced no usable query');
        return crossCheck(
          'error',
          'the independent check did not produce a usable query',
        );
      }
      const result = await this.datasourcesService.runReadOnlySql(
        context.datasourceId,
        sql,
        CROSS_CHECK_ROW_LIMIT,
      );
      // Width tolerance matters here: the verifier is told to project nothing
      // beyond the question while the analysis agent selects the figures its
      // answer needs, so equal facts routinely arrive at different widths.
      const { match, reason, shapeDiffers } = compareResults(
        record.rows ?? [],
        result.rows,
        { widthTolerant: true },
      );
      // Logged so the agree / shape / disagree / error split is measurable
      // rather than anecdotal — `npm run eval` reports the same verdicts.
      this.logger.log(
        `Cross-check ${match ? (shapeDiffers ? 'agree (shape differs)' : 'agree') : 'disagree'}${
          match ? '' : `: ${reason}`
        }`,
      );
      if (match) {
        return crossCheck(
          'agree',
          shapeDiffers ? CROSS_CHECK_AGREE_SHAPE_NOTE : CROSS_CHECK_AGREE_NOTE,
        );
      }
      return crossCheck(
        'disagree',
        `${CROSS_CHECK_DISAGREE_NOTE} — ${reason || 'the independent query returned something else'}`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Cross-check failed: ${detail}`);
      return crossCheck('error', `the check could not complete — ${detail}`);
    }
  }

  /** Dialect, datasource and a sample-value bearing schema for the verifier. */
  private async verifierContext(session: SessionDoc): Promise<
    | {
        dialect: string;
        schema: string;
        datasourceId: string;
      }
    | undefined
  > {
    const sandboxes = await this.boundSandboxes(session.sandboxes);
    const datasourceId =
      (await this.soleDatasourceId(session)) ??
      sandboxes.find((s) => s.datasourceId)?.datasourceId;
    if (!datasourceId) return undefined;
    const inScope = sandboxes.filter((s) => s.datasourceId === datasourceId);
    return {
      dialect:
        inScope.find((s) => s.datasourceKind)?.datasourceKind ?? 'databricks',
      datasourceId,
      schema: verifierSchema(inScope),
    };
  }

  /**
   * One verifier pass. It gets the question, the schema with sample values and
   * the user-approved reference pairs — deliberately not the original SQL.
   */
  private async deriveIndependentSql(
    question: string,
    context: { dialect: string; schema: string },
  ): Promise<string | undefined> {
    let verified: string | undefined;
    try {
      verified = await this.verifiedQueries.referenceBlock(question);
    } catch {
      verified = undefined;
    }
    // A second opinion should think as hard as the answer it is checking.
    const { reasoningEffort } = await this.llmService.getView();
    const result = await this.mastra
      .getAgent('sql-verifier')
      .generate(
        [
          `Dialect: ${context.dialect}`,
          '',
          '<available-entities>',
          context.schema || '(no schema snapshot stored for this session)',
          '</available-entities>',
          ...(verified
            ? [
                '',
                '<verified-reference-queries>',
                verified,
                '</verified-reference-queries>',
              ]
            : []),
          '',
          '<question>',
          question,
          '</question>',
        ].join('\n'),
        {
          maxSteps: 1,
          toolChoice: 'none',
          providerOptions: { openai: { reasoningEffort } },
          structuredOutput: {
            schema: sqlVerifyOutputSchema,
            jsonPromptInjection: 'inline',
          },
        },
      );
    const parsed = sqlVerifyOutputSchema.safeParse(
      result.object ?? parseJsonObject(result.text),
    );
    return parsed.success ? readOnlyStatement(parsed.data.sql) : undefined;
  }

  // --------------------------------------------------------------- internals

  /**
   * Mastra stores new turns itself once a session thread exists. For sessions
   * created before memory was enabled, bootstrap the thread once from the
   * already-persisted session transcript.
   */
  private async agentInput(
    agent: ReturnType<MastraService['getAgent']>,
    session: SessionDoc,
  ) {
    const memory = await agent.getMemory();
    const thread = await memory?.getThreadById({ threadId: session.id });
    const latest = session.messages.at(-1);
    const previous = session.messages.at(-2);
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

    return session.messages.map((message) =>
      message.role === 'user'
        ? { role: 'user' as const, content: message.content }
        : { role: 'assistant' as const, content: message.content },
    );
  }

  list(): Promise<SessionDoc[]> {
    return this.repository.list();
  }

  async get(id: string): Promise<SessionDoc> {
    const session = await this.repository.get(id);
    if (!session) throw new NotFoundException(`Session ${id} not found`);
    return session;
  }

  /** Delete a session and all Mastra state owned exclusively by it. */
  async delete(id: string): Promise<SessionDoc> {
    const session = await this.get(id);
    await this.mastra.deleteSessionResources(id);
    const removed = await this.repository.delete(id);
    if (removed === 0) throw new NotFoundException(`Session ${id} not found`);
    return session;
  }

  /** Create a named session; the conversation starts empty in the chat view. */
  async create(name: string, sandboxes: string[]): Promise<SessionDoc> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('session name is required');
    if (!Array.isArray(sandboxes) || sandboxes.length === 0) {
      throw new BadRequestException('select at least one sandbox');
    }
    const id = randomUUID();
    const workspace = await this.mastra.ensureSessionWorkspace(id, trimmed);
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
    return (await this.repository.update(session.id, patch)) ?? fresh;
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
    this.appendUserMessage(session, trimmed);
    const agent = this.mastra.getAgent('assistant');
    const input = await this.agentInput(agent, session);
    const result = await agent.generate(
      input,
      await this.agentOptions(session, trimmed),
    );
    const reasoning = reasoningTrail(toolRecords(result));
    session.messages.push({
      role: 'assistant',
      content: (result.text ?? '').trim(),
      at: new Date().toISOString(),
      ...(reasoning ? { reasoning } : {}),
    });
    const updated = await this.repository.update(id, {
      messages: session.messages,
    });
    return updated ?? session;
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
    this.appendUserMessage(session, trimmed);
    // Persist the prompt before model startup. A user can stop while the
    // provider is still connecting, and that turn should survive a reload.
    await this.repository.update(id, { messages: session.messages });

    const agent = this.mastra.getAgent('assistant');
    const input = await this.agentInput(agent, session);
    // Own controller so a clarification can end the model turn without the
    // client having disconnected.
    const turn = new AbortController();
    const forwardAbort = () => turn.abort();
    abortSignal?.addEventListener('abort', forwardAbort, { once: true });
    const options = await this.agentOptions(
      session,
      trimmed,
      turn.signal,
      activeVisualId,
    );
    // A live reference to this turn's captured records, handed to the visual
    // tools via requestContext so create_visual/update_visual called later in
    // the same turn can see SQL the turn already ran (drill-down queries a
    // tailored visual needs but that never touched the source answer). Fresh
    // RequestContext + array per call — no leakage across turns or sessions.
    const data: ToolDataRecord[] = [];
    options.requestContext.set(TURN_RECORDS_CONTEXT_KEY, data);
    const stream = await agent.stream(input, options);

    let text = '';
    let clarification: ChatMessage['clarification'] | null = null;
    let visualEvent: VisualEvent | undefined;
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
          // The client shows the reason before the result arrives, so the
          // rationale travels with the call, not with its rows.
          const rationale = statedRationale((payload.args ?? {})['rationale']);
          emit({
            type: 'tool',
            content: JSON.stringify({
              name: payload.toolName ?? 'tool',
              ...(rationale ? { rationale } : {}),
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
                rationale: record.rationale,
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
    const reasoning = reasoningTrail(data);
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
      });
    } else if (text.trim() || visualEvent) {
      const interpretation = interpretationLine(data, entities);
      // Careful mode only, and only when there is a result set to corroborate.
      const crossChecked =
        careful && !turn.signal.aborted
          ? await this.crossCheckAnswer(session, trimmed, data)
          : undefined;
      messages.push({
        role: 'assistant',
        content:
          text.trim() ||
          `${visualEvent!.action === 'created' ? 'Created' : 'Updated'} interactive visual "${visualEvent!.title}" (v${visualEvent!.version}).`,
        at: new Date().toISOString(),
        ...(data.length ? { data } : {}),
        ...(entities.length ? { entities } : {}),
        ...(interpretation ? { interpretation } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...((await this.matchesVerifiedQuery(session, data))
          ? { verified: true }
          : {}),
        ...(visualEvent ? { visual: visualEvent } : {}),
        ...(crossChecked ? { crossCheck: crossChecked } : {}),
      });
    }
    const updated = await this.repository.update(id, { messages });
    if (!turn.signal.aborted || clarification) {
      emit({ type: 'done', session: updated ?? fresh });
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
    session: SessionDoc,
    data: ToolDataRecord[],
  ): Promise<boolean> {
    const sql = lastSuccessfulSql(data);
    if (!sql) return false;
    try {
      return await this.verifiedQueries.isVerifiedSql(
        sql,
        await this.soleDatasourceId(session),
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
  ): Promise<SessionDoc> {
    if (rating !== 'up' && rating !== 'down') {
      throw new BadRequestException("rating must be 'up' or 'down'");
    }
    if (!messageAt) throw new BadRequestException('messageAt is required');
    const session = await this.get(id);
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
          datasourceId: await this.soleDatasourceId(session),
          entities: answer.entities ?? [],
          sourceSessionId: id,
          sourceMessageAt: messageAt,
        });
      }
    }
    const updated = await this.repository.update(id, { messages });
    return updated ?? { ...session, messages };
  }

  /** The session's datasource when it is unambiguous — provenance only. */
  private async soleDatasourceId(
    session: SessionDoc,
  ): Promise<string | undefined> {
    const sandboxes = await this.boundSandboxes(session.sandboxes);
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
  private appendUserMessage(session: SessionDoc, content: string): void {
    const latest = session.messages.at(-1);
    if (latest?.role === 'user' && latest.content === content) return;
    session.messages.push({
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
    warnings?: unknown;
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
  const rationale = statedRationale(args['rationale']);
  if (typeof value.error === 'string') {
    // A step that failed still explained why it was attempted — keep it, the
    // dead end is part of the route the assistant took.
    return {
      tool,
      input,
      error: value.error,
      ...(rationale ? { rationale } : {}),
    };
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
  // The guards ran in the tool, against the full result — keep their verdict
  // with the rows it judged.
  const warnings = Array.isArray(value.warnings)
    ? value.warnings.map((w) => String(w)).filter(Boolean)
    : [];
  return {
    tool,
    input,
    columns,
    rows: rows.slice(0, STORED_ROWS_CAP),
    rowCount: rows.length,
    ...(truncated ? { truncated: true } : {}),
    ...(rationale ? { rationale } : {}),
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * The reason the assistant gave for a call, as stored: flattened, trimmed and
 * clipped. Anything that is not usable prose becomes nothing at all.
 */
function statedRationale(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const flat = value.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  return flat.length > RATIONALE_CHARS
    ? `${flat.slice(0, RATIONALE_CHARS - 1)}\u2026`
    : flat;
}

/**
 * Records captured from a non-streamed turn. The stream path reads tool
 * chunks one by one; `generate` hands them back in a batch, wrapped or flat
 * depending on the provider, so both shapes are accepted.
 */
function toolRecords(result: unknown): ToolDataRecord[] {
  const entries = (result as { toolResults?: unknown })?.toolResults;
  if (!Array.isArray(entries)) return [];
  const records: ToolDataRecord[] = [];
  for (const entry of entries) {
    const payload = ((entry as { payload?: unknown })?.payload ?? entry) as {
      toolName?: string;
      name?: string;
      args?: Record<string, unknown>;
      result?: unknown;
    };
    const record = toolDataRecord(
      payload.toolName ?? payload.name ?? 'tool',
      payload.args ?? {},
      payload.result,
    );
    if (record) records.push(record);
  }
  return records;
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

/**
 * The assistant's plain-language route from the question to the answer: one
 * step per captured call that said why it ran, in the order they ran. Built
 * at persist time like `interpretationLine` — the prose is the model's, the
 * ordering and the outcomes are ours, so a step can never claim a query that
 * never happened.
 */
function reasoningTrail(
  data: ToolDataRecord[] | undefined,
): ReasoningStep[] | undefined {
  const steps: ReasoningStep[] = [];
  for (const record of data ?? []) {
    if (!record.rationale) continue;
    steps.push({
      step: steps.length + 1,
      rationale: record.rationale,
      tool: record.tool,
      ...(record.input ? { input: record.input } : {}),
      ...(record.rowCount === undefined ? {} : { rowCount: record.rowCount }),
      ...(record.error ? { error: record.error } : {}),
    });
  }
  return steps.length ? steps : undefined;
}

/**
 * Strip fences/semicolons off a model-authored statement and keep it only if
 * it is a read-only query. Shared by the fixer and the verifier.
 */
function readOnlyStatement(sql: string): string | undefined {
  const cleaned = sql
    .trim()
    .replace(/^```(?:sql)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/;+\s*$/, '')
    .trim();
  return /^(select|with)\b/i.test(cleaned) ? cleaned : undefined;
}

/** A cross-check verdict with its note clipped to tooltip length. */
function crossCheck(status: CrossCheck['status'], note: string): CrossCheck {
  const flat = note.replace(/\s+/g, ' ').trim();
  return {
    status,
    note:
      flat.length > CROSS_CHECK_NOTE_CHARS
        ? `${flat.slice(0, CROSS_CHECK_NOTE_CHARS - 1)}…`
        : flat,
  };
}

/**
 * `entity(column type [e.g. a, b], …)` lines for the verifier. Richer than the
 * fixer's block: sample values let it match filter literals to real data.
 */
function verifierSchema(sandboxes: SandboxSnapshot[]): string {
  const lines: string[] = [];
  let budget = VERIFIER_SCHEMA_CHARS;
  for (const sandbox of sandboxes) {
    for (const key of sandbox.tables) {
      const columns =
        sandbox.entities?.find((e) => e.key === key)?.columns ?? [];
      const described = columns.map((column) => {
        const samples = (column.sampleValues ?? []).slice(
          0,
          VERIFIER_SAMPLE_VALUES,
        );
        const shown = samples.length ? ` [e.g. ${samples.join(', ')}]` : '';
        return `${column.name} ${column.type}${shown}${referenceSuffix(column)}`;
      });
      const line = `${key}(${described.join(', ')})`;
      if (line.length > budget) return lines.join('\n');
      budget -= line.length;
      lines.push(line);
    }
  }
  return lines.join('\n');
}

/**
 * ` -> teams.id` for a key column, so a schema line states where it joins.
 * `~>` marks an inferred edge: the model should trust it less than a declared
 * one and can confirm with describe_entity.
 */
function referenceSuffix(column: SandboxColumnSnapshot): string {
  const reference = column.references;
  if (!reference?.entity || !reference?.column) return '';
  const arrow = reference.source === 'declared' ? '->' : '~>';
  return ` ${arrow} ${reference.entity}.${reference.column}`;
}

/**
 * The join graph, stated up front. Without it the assistant knows which
 * entities exist but not which column joins to which, so it guesses — writing
 * `goals.team_id` where the column is `goals.scoring_team_id`, which fails the
 * query and ends in an answer naming a raw id instead of a team.
 */
function joinHintBlock(sandboxes: SandboxSnapshot[]): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  let budget = JOIN_HINT_CHARS;
  for (const sandbox of sandboxes) {
    for (const entity of sandbox.entities ?? []) {
      for (const column of entity.columns ?? []) {
        const suffix = referenceSuffix(column);
        if (!suffix) continue;
        const line = `- ${entity.key}.${column.name}${suffix}`;
        if (seen.has(line)) continue;
        if (line.length > budget) return joinHintHeader(lines);
        budget -= line.length;
        seen.add(line);
        lines.push(line);
      }
    }
  }
  return joinHintHeader(lines);
}

function joinHintHeader(lines: string[]): string {
  if (!lines.length) return '';
  return [
    'How these entities join (-> declared by the datasource, ~> inferred from',
    'naming; join on these columns rather than guessing a key name):',
    ...lines,
  ].join('\n');
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
