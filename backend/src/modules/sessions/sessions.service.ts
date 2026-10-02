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
import { resolveAgentModel } from '../../mastra/model-resolver';
import {
  providerOptionsFor,
  type ProviderOptionValue,
  type ProviderOptions,
} from '../../mastra/model-compat';
import { setDatasetToolServices } from '../../mastra/tool-services';
import type {
  DatasetSnapshot,
  LogicalQueryRunResult,
  SqlRunResult,
} from '../../mastra/tool-services';
import { ASSISTANT_MAX_STEPS } from '../../mastra/agent-constants';
import { sqlFixOutputSchema } from '../../mastra/agents/sql-fixer.agent';
import { queryFixOutputSchema } from '../../mastra/agents/query-fixer.agent';
import { queryVerifyOutputSchema } from '../../mastra/agents/query-verifier.agent';
import { DATASETS_CONTEXT_KEY } from '../../mastra/tools/dataset.tools';
import {
  ACTIVE_VISUAL_CONTEXT_KEY,
  SESSION_ID_CONTEXT_KEY,
  TURN_RECORDS_CONTEXT_KEY,
} from '../../mastra/tools/visual.tools';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../../mastra/session-workspaces';
import type { KnowledgeUse } from '../knowledge/entities/knowledge-snippet.entity';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { LlmService } from '../llm/llm.service';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { DataModelsService } from '../data-models/data-models.service';
import {
  composeSessionModel,
  renderModelBlock,
  type SessionEntity,
  type SessionModel,
} from '../data-models/session-model';
import {
  compileLogicalQuery,
  LogicalQueryError,
  type SqlDialect,
} from '../data-models/query/compile-sql';
import {
  parseLogicalQuery,
  type LogicalQuery,
} from '../data-models/query/logical-query';
import {
  dialectForDatasourceKind,
  isRepairableSqlError,
  readOnlyStatement,
  setSqlFixerBridge,
} from '../data-models/query/sql-repair';
import { SessionsRepository } from './repositories/sessions.repository';
import { VisualizationService } from './visualization.service';
import { sourceEntities } from './visualization-document';
import { compareResults } from './result-compare';
import {
  SQL_RUN_TOOLS,
  STORED_ROWS_CAP,
  groundingNudge,
  statedRationale,
  synthesizeToolOnlyTurn,
  toolDataRecord,
  toolRecords,
} from './turn-data';
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

const VISUAL_TOOLS = new Set(['create_visual', 'update_visual']);
/**
 * requestContext key carrying the curated-knowledge snippets this turn's
 * system block was built from, so the persist step can record them on the
 * answer without re-reading (and possibly disagreeing with) the store.
 */
const KNOWLEDGE_USED_CONTEXT_KEY = 'knowledge-used';
/**
 * requestContext key carrying the session model versions `agentContext`
 * composed the turn's rendered model block from (ADR-0007) — read back at
 * persist time the same way `KNOWLEDGE_USED_CONTEXT_KEY` is, so an answer
 * records exactly the model the assistant actually saw.
 */
const MODEL_VERSIONS_CONTEXT_KEY = 'model-versions';
/** Issue codes a logical query is worth one automatic `query-fixer` retry
 * for — a mistaken reference, not a structural/dialect problem a rewrite
 * cannot fix (ADR-0007 §6). */
const FIXABLE_QUERY_ISSUE_CODES = new Set([
  'unknown_attribute',
  'unknown_metric',
  'ambiguous_path',
]);
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
/** Character budget for a failed statement written into the warn log (ships in diagnostics reports). */
const SQL_LOG_CHARS = 500;
/** Character budget for the richer (sample-value bearing) verifier schema. */
const VERIFIER_SCHEMA_CHARS = 6_000;
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

export type StreamEvent = {
  type:
    'reasoning' | 'text' | 'tool' | 'tool-result' | 'visual-updated' | 'done';
  content?: string;
  session?: SessionDoc;
};

@Injectable()
export class SessionsService implements OnModuleInit {
  private readonly logger = new Logger(SessionsService.name);

  /**
   * Provider options filed under the bucket the configured model actually
   * reads. Mastra names an OpenAI-compatible client's bucket after the
   * provider id, so a hardcoded `openai` key is silently discarded for every
   * `lenai/…` deployment — which is how the reasoning-effort chip came to be
   * a no-op there.
   */
  private async providerOptions(
    bucket: Record<string, ProviderOptionValue>,
  ): Promise<ProviderOptions> {
    return providerOptionsFor(await resolveAgentModel(), bucket);
  }

  constructor(
    private readonly repository: SessionsRepository,
    private readonly mastra: MastraService,
    private readonly datasetsRepository: DatasetsRepository,
    private readonly datasourcesService: DatasourcesService,
    private readonly llmService: LlmService,
    private readonly visuals: VisualizationService,
    private readonly verifiedQueries: VerifiedQueriesService,
    private readonly knowledge: KnowledgeService,
    private readonly dataModels: DataModelsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Runtime bridge for `DataModelsController` (`POST /model/query`):
    // `DataModelsModule` deliberately never imports `MastraModule` (see its
    // header comment) — this is the only place with a real `MastraService`,
    // so the sql-fixer pass crosses the module boundary as a plain callback
    // instead, mirroring `setDatasetToolServices` below.
    setSqlFixerBridge({
      repair: (sql, errorMessage, dialect, schema) =>
        this.repairSql(sql, errorMessage, { dialect, schema }),
    });
    // Install the DI bridge the Mastra tools use (they load with no Nest DI).
    setDatasetToolServices({
      getDatasets: (names) => this.boundDatasets(names),
      sampleRows: (datasourceId, entity, limit) =>
        this.datasourcesService.sampleRows(datasourceId, entity, limit),
      runReadOnlySql: (datasourceId, sql, limit, datasets) =>
        this.runSqlWithRepair(datasourceId, sql, limit, datasets),
      getSessionModel: (datasetNames) =>
        this.composedSessionModel(datasetNames),
      runLogicalQuery: (sessionModel, query) =>
        this.runLogicalQuery(sessionModel, query),
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
   * Hybrid context: a cheap orientation block (dataset names + entity keys,
   * the session's visuals and which one is open), the curated metric
   * definitions covering those entities, the curated knowledge-store
   * snippets covering this session's datasets, plus any user-approved
   * question → SQL pairs resembling `question`, in the system context, and
   * requestContext scoping the tools to this session.
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
    const visualLines = (session.visualizations ?? []).map(
      (v) =>
        `- ${v.id} — "${v.title}" v${this.visuals.currentVersion(v)} (from the answer at ${v.sourceMessageAt})`,
    );
    const requestContext = new RequestContext();
    requestContext.set(DATASETS_CONTEXT_KEY, session.datasets);
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
    // ADR-0007: one rendered model block replaces the old dataset/entity
    // orientation, join-hint and curated-metrics blocks — the assistant's
    // only view of "what data exists" is the logical model, never a
    // physical table name, datasource id/kind or dialect word.
    const modelPairs = await this.dataModels.getCurrentModels(
      session.datasets,
    );
    const sessionModel = composeSessionModel(modelPairs);
    const modelBlock = renderModelBlock(sessionModel);
    const modelVersions = modelPairs.map((p) => ({
      dataset: p.dataset,
      version: p.model.version,
    }));
    requestContext.set(MODEL_VERSIONS_CONTEXT_KEY, modelVersions);
    // Curated, user-authored knowledge (glossary/instructions/default
    // filters) for this session's datasets — authoritative over anything
    // the model would otherwise infer from schema alone.
    const knowledge = await this.knowledge.contextFor(session.datasets);
    // Threaded on requestContext rather than returned alongside the options,
    // because the options object is spread straight into the agent call.
    requestContext.set(KNOWLEDGE_USED_CONTEXT_KEY, knowledge.used);
    return {
      // Analysis often chains several schema + SQL tool calls per turn.
      maxSteps: ASSISTANT_MAX_STEPS,
      // The user-configured reasoning effort (Low/Medium/High chip).
      providerOptions: await this.providerOptions({ reasoningEffort }),
      context: [
        {
          role: 'system' as const,
          content: [
            modelBlock,
            '',
            'Interactive visuals in this session (id — title, current version):',
            ...(visualLines.length ? visualLines : ['(none yet)']),
            activeVisualId
              ? `Visual currently open in the right panel: ${activeVisualId}.`
              : 'No visual is open in the right panel.',
          ].join('\n'),
        },
        ...(knowledge.block
          ? [{ role: 'system' as const, content: knowledge.block }]
          : []),
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
   * Datasets created before datasources existed carry no binding — attach
   * the preferred saved datasource so tools can still run.
   */
  private async boundDatasets(names: string[]) {
    const datasets = await this.datasetsRepository.getByNames(names);
    if (datasets.every((s) => s.datasourceId)) return datasets;
    const fallback = await this.datasourcesService.defaultDatasource();
    return datasets.map((s) =>
      s.datasourceId || !fallback
        ? s
        : {
            ...s,
            datasourceId: fallback.id,
            datasourceKind: fallback.kind,
          },
    );
  }

  // ------------------------------------------------- logical query layer

  /** The session's composed model (ADR-0007) — the `DatasetToolServices`
   * bridge's `getSessionModel`, and `agentContext`'s own source for the
   * rendered block (built inline there so it can also keep the per-dataset
   * versions for provenance). */
  private async composedSessionModel(
    datasetNames: string[],
  ): Promise<SessionModel> {
    const pairs = await this.dataModels.getCurrentModels(datasetNames);
    return composeSessionModel(pairs);
  }

  /** Resolves the `'default'` placeholder a dataset created before
   * datasources existed carries (`bootstrap.ts`'s bootstrapped bindings use
   * the literal string `'default'` as `datasource` when none was on
   * record) — the same fallback `boundDatasets` already applies to a
   * dataset's own `datasourceId`, needed again here because an entity's
   * `datasourceId` (`session-model.ts`) comes from a binding, which can
   * carry the same placeholder untouched. */
  private async resolveDatasourceId(datasourceId: string): Promise<string> {
    if (datasourceId !== 'default') return datasourceId;
    const fallback = await this.datasourcesService.defaultDatasource();
    return fallback?.id ?? datasourceId;
  }

  /** `sql` bindings compile for the datasource's actual kind (postgres or
   * databricks); `rest` always compiles as sqlite, matching the
   * materialise-to-SQLite path (ADR-0007 §4). */
  private async dialectForEntity(entity: SessionEntity): Promise<SqlDialect> {
    if (entity.kind === 'rest') return 'sqlite';
    try {
      const id = await this.resolveDatasourceId(entity.datasourceId);
      const datasource = await this.datasourcesService.get(id);
      return dialectForDatasourceKind(datasource.kind);
    } catch {
      // Falls through to the default below — an unresolvable datasource
      // fails clearly at execution instead of here.
      return 'postgres';
    }
  }

  /**
   * Compiles `query` against `sessionModel` and runs it through the same
   * execution-guided repair path as raw SQL — a *runtime* error from the
   * compiled statement is still `sql-fixer`'s job. Throws `LogicalQueryError`
   * (no database call made) when the query does not compile.
   */
  private async compileAndRunLogicalQuery(
    sessionModel: SessionModel,
    query: LogicalQuery,
  ): Promise<LogicalQueryRunResult> {
    const rootEntity = sessionModel.entities.find(
      (e) => e.name.toLowerCase() === query.from.toLowerCase(),
    );
    const dialect = rootEntity
      ? await this.dialectForEntity(rootEntity)
      : 'postgres';
    const compiled = compileLogicalQuery(sessionModel, query, dialect);
    const datasourceId = await this.resolveDatasourceId(compiled.datasourceId);
    const touchedDatasets = Array.from(
      new Set(
        compiled.entities.flatMap(
          (name) =>
            sessionModel.entities.find((e) => e.name === name)?.datasets ??
            [],
        ),
      ),
    );
    const result = await this.runSqlWithRepair(
      datasourceId,
      compiled.sql,
      query.limit,
      touchedDatasets,
    );
    return { ...result, entities: compiled.entities, sql: compiled.sql };
  }

  /**
   * `query_entities`'s implementation (ADR-0007 §4/§6): compiles and runs
   * `query`, and — only for a reference mistake a fixer can plausibly
   * correct (`unknown_attribute`/`unknown_metric`/`ambiguous_path`) — tries
   * exactly once to repair the query before giving up, so the assistant
   * only sees a structured error after a genuine second opinion failed too.
   */
  private async runLogicalQuery(
    sessionModel: SessionModel,
    query: LogicalQuery,
  ): Promise<LogicalQueryRunResult> {
    try {
      return await this.compileAndRunLogicalQuery(sessionModel, query);
    } catch (error) {
      if (
        !(error instanceof LogicalQueryError) ||
        !isFixableQueryError(error)
      ) {
        throw error;
      }
      const corrected = await this.repairLogicalQuery(
        sessionModel,
        query,
        error,
      );
      if (!corrected) throw error;
      try {
        const result = await this.compileAndRunLogicalQuery(
          sessionModel,
          corrected,
        );
        const correctionNote = `query auto-corrected (${error.issues[0]?.code}: ${error.issues[0]?.message})`;
        return {
          ...result,
          note: [correctionNote, result.note].filter(Boolean).join('; '),
        };
      } catch (fixedError) {
        // The fixer's rewrite did not compile/run either — the original
        // issue is still the one a human (or the model) can act on, but the
        // fixed query's own failure reason is worth keeping in the logs
        // rather than silently dropped; a future repair attempt that keeps
        // producing the same dead end is otherwise invisible.
        const detail =
          fixedError instanceof Error ? fixedError.message : String(fixedError);
        this.logger.warn(
          `query_entities repair produced a query that also failed: ${detail}`,
        );
        throw error;
      }
    }
  }

  /** One `query-fixer` pass; returns undefined when it produced nothing
   * usable (a bad JSON reply, or a query that fails to parse). */
  private async repairLogicalQuery(
    sessionModel: SessionModel,
    query: LogicalQuery,
    error: LogicalQueryError,
  ): Promise<LogicalQuery | undefined> {
    try {
      const modelBlock = renderModelBlock(sessionModel, {
        budgetChars: FIXER_SCHEMA_CHARS,
      });
      const result = await this.mastra.getAgent('query-fixer').generate(
        [
          '<model>',
          modelBlock,
          '</model>',
          '',
          '<failed-query>',
          JSON.stringify(query),
          '</failed-query>',
          '',
          '<issues>',
          JSON.stringify(error.issues),
          '</issues>',
        ].join('\n'),
        {
          maxSteps: 1,
          toolChoice: 'none',
          // A reference fix does not benefit from hidden reasoning tokens.
          providerOptions: await this.providerOptions({
            reasoningEffort: 'low',
          }),
          structuredOutput: {
            schema: queryFixOutputSchema,
            jsonPromptInjection: 'inline',
          },
        },
      );
      const parsed = queryFixOutputSchema.safeParse(
        result.object ?? parseJsonObject(result.text),
      );
      if (!parsed.success) return undefined;
      return parseLogicalQuery(parsed.data.query);
    } catch (err) {
      this.logger.warn(
        `Query repair attempt failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
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
    datasetNames: string[],
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
        // Guard rejections (statement never reached the engine) and
        // transport/auth failures aren't a formatting problem a rewrite can
        // fix — skip the fixer round trip and let the real error surface.
        if (!isRepairableSqlError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        fixerContext ??= await this.sqlFixerContext(datasetNames, datasourceId);
        const corrected = await this.repairSql(
          statement,
          message,
          fixerContext,
        );
        if (!corrected || corrected === statement) throw error;
        // `statement`, not `sql`: attempt 2 is repairing the fixer's own
        // rewrite from attempt 1. Flattened/capped — this ships in
        // diagnostics reports and must stay one line per failure.
        this.logger.warn(
          `Repairing failed SQL (attempt ${attempt + 1}): ${message} — SQL: ${logSql(statement)}`,
        );
        statement = corrected;
      }
    }
  }

  /** Dialect + a capped `entity(column type, …)` block for the fixer prompt. */
  private async sqlFixerContext(
    datasetNames: string[],
    datasourceId: string,
  ): Promise<{ dialect: string; schema: string }> {
    const datasets = await this.boundDatasets(datasetNames);
    const onDatasource = datasets.filter(
      (s) => s.datasourceId === datasourceId,
    );
    const inScope: DatasetSnapshot[] = onDatasource.length
      ? onDatasource
      : datasets;
    const dialect = sqlDialectOf(inScope);
    const lines: string[] = [];
    let budget = FIXER_SCHEMA_CHARS;
    for (const dataset of inScope) {
      for (const key of dataset.tables) {
        const columns =
          dataset.entities?.find((e) => e.key === key)?.columns ?? [];
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
            providerOptions: await this.providerOptions({
              reasoningEffort: 'low',
            }),
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
   * Careful mode's cross-check (ADR-0007 §6, moved to the logical level): a
   * second agent re-derives the question's *logical query* without ever
   * seeing the one the analysis agent ran, it is compiled and executed once,
   * and the two result sets are compared as multisets. Agreement is
   * therefore corroboration, not an echo of the first answer.
   *
   * Never throws — a check that cannot run reports `error`, because failing
   * to verify must not lose the answer it was verifying.
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
      const sessionModel = await this.composedSessionModel(session.datasets);
      if (!sessionModel.entities.length) {
        this.logger.warn('Cross-check skipped: no data model bound');
        return crossCheck(
          'error',
          'no data model is bound to this session, so the query could not be re-run',
        );
      }
      const query = await this.deriveIndependentQuery(question, sessionModel);
      if (!query) {
        this.logger.warn(
          'Cross-check skipped: verifier produced no usable query',
        );
        return crossCheck(
          'error',
          'the independent check did not produce a usable query',
        );
      }
      const result = await this.compileAndRunLogicalQuery(sessionModel, {
        ...query,
        limit: CROSS_CHECK_ROW_LIMIT,
      });
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

  /**
   * One `query-verifier` pass. It gets the question, the rendered model
   * block (with sample values) and the user-approved reference pairs —
   * deliberately never the original query or its compiled SQL.
   */
  private async deriveIndependentQuery(
    question: string,
    sessionModel: SessionModel,
  ): Promise<LogicalQuery | undefined> {
    let verified: string | undefined;
    try {
      // The verifier's own pass: unlike the assistant's reference block, a
      // SQL-only legacy pair is still useful here as a bare reference
      // question (phrasing/scope), it is just never shown the SQL text
      // itself — the verifier always derives its own logical query.
      verified = await this.verifiedQueries.verifierReferenceBlock(question);
    } catch {
      verified = undefined;
    }
    const modelBlock = renderModelBlock(sessionModel, {
      budgetChars: VERIFIER_SCHEMA_CHARS,
      samples: VERIFIER_SAMPLE_VALUES,
    });
    // A second opinion should think as hard as the answer it is checking.
    const { reasoningEffort } = await this.llmService.getView();
    const result = await this.mastra
      .getAgent('query-verifier')
      .generate(
        [
          '<model>',
          modelBlock,
          '</model>',
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
          providerOptions: await this.providerOptions({ reasoningEffort }),
          structuredOutput: {
            schema: queryVerifyOutputSchema,
            jsonPromptInjection: 'inline',
          },
        },
      );
    const parsed = queryVerifyOutputSchema.safeParse(
      result.object ?? parseJsonObject(result.text),
    );
    if (!parsed.success) return undefined;
    try {
      return parseLogicalQuery(parsed.data.query);
    } catch {
      return undefined;
    }
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
  async create(name: string, datasets: string[]): Promise<SessionDoc> {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('session name is required');
    if (!Array.isArray(datasets) || datasets.length === 0) {
      throw new BadRequestException('select at least one dataset');
    }
    const id = randomUUID();
    const workspace = await this.mastra.ensureSessionWorkspace(id, trimmed);
    return this.repository.insert({
      id,
      name: trimmed.slice(0, 64),
      workspaceId: workspace.id,
      datasets,
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
    const options = await this.agentOptions(session, trimmed);
    const result = await agent.generate(input, options);
    const reasoning = reasoningTrail(toolRecords(result));
    const knowledge = knowledgeUsed(options.requestContext);
    const modelVersions = modelVersionsUsed(options.requestContext);
    session.messages.push({
      role: 'assistant',
      content: (result.text ?? '').trim(),
      at: new Date().toISOString(),
      ...(reasoning ? { reasoning } : {}),
      ...(knowledge ? { knowledge } : {}),
      ...(modelVersions ? { modelVersions } : {}),
      ...(outsideModelFlag(toolRecords(result)) ? { outsideModel: true } : {}),
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
    // Every tool name the model actually invoked this turn — the zero-SQL-
    // turn grounding guard below fires only when this stays empty.
    const calledTools = new Set<string>();
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
          if (payload.toolName) calledTools.add(payload.toolName);
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
      text = await synthesizeToolOnlyTurn(
        agent,
        trimmed,
        data,
        turn.signal,
        await this.providerOptions({
          reasoningEffort: (await this.llmService.getView()).reasoningEffort,
        }),
        this.logger,
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
    const fresh = await this.get(id);
    const messages = fresh.messages;
    const entities = sourceEntities(data);
    const reasoning = reasoningTrail(data);
    const knowledge = knowledgeUsed(options.requestContext);
    const modelVersions = modelVersionsUsed(options.requestContext);
    const outsideModel = outsideModelFlag(data);
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
        ...(modelVersions ? { modelVersions } : {}),
        ...(outsideModel ? { outsideModel } : {}),
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
        ...(knowledge ? { knowledge } : {}),
        ...(modelVersions ? { modelVersions } : {}),
        ...(outsideModel ? { outsideModel } : {}),
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

  /**
   * Runtime backstop for the grounding rule in the system prompt: a turn
   * that produced a non-empty answer without calling a single tool gets one
   * corrective pass, tools allowed, before it is accepted. Called at most
   * once per turn by `streamMessage`.
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
        // Always the model path here — `SessionsService` only ever runs the
        // current `assistant` agent; `assistant-legacy` exists solely for
        // the eval harness's side-by-side comparison.
        content: groundingNudge(originalAnswer, 'model'),
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
      this.logger.warn(
        `Grounding guard corrective pass failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
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
        const logicalQuery = lastSuccessfulLogicalQuery(answer.data);
        await this.verifiedQueries.save({
          question: question.content,
          sql,
          ...(logicalQuery ? { logicalQuery } : {}),
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
    const datasets = await this.boundDatasets(session.datasets);
    const ids = new Set(
      datasets.map((s) => s.datasourceId).filter((id): id is string => !!id),
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

/** Successful SQL runs behind an answer, oldest first. */
/** SQL dialect for prompts: REST datasources are queried as SQLite. */
function sqlDialectOf(datasets: DatasetSnapshot[]): string {
  const kind = datasets.find((s) => s.datasourceKind)?.datasourceKind;
  if (kind === 'rest') return 'sqlite';
  return kind ?? 'databricks';
}

function successfulSqlRuns(data: ToolDataRecord[] | undefined) {
  return (data ?? []).filter(
    (record) =>
      SQL_RUN_TOOLS.has(record.tool) && !record.error && record.input?.trim(),
  );
}

/** The SQL behind an answer: its last `run_readonly_sql` that did not fail. */
function lastSuccessfulSql(
  data: ToolDataRecord[] | undefined,
): string | undefined {
  return successfulSqlRuns(data).at(-1)?.input?.trim();
}

/** The logical query behind an answer, when its last successful SQL-running
 * step was `query_entities` — undefined for a `run_readonly_sql`/
 * `run_raw_sql` step, which never has one (`turn-data.ts`'s `toolDataRecord`
 * only sets `logicalQuery` for `query_entities`). Drives whether a verified
 * query is shown to the assistant at all (ADR-0007 §4 — SQL-only legacy
 * pairs are omitted from its reference block). */
function lastSuccessfulLogicalQuery(
  data: ToolDataRecord[] | undefined,
): string | undefined {
  return successfulSqlRuns(data).at(-1)?.logicalQuery;
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
 * The curated-knowledge snippets `agentContext` put in this turn's system
 * block, read back off the same requestContext that carried them into the
 * agent call. Nothing is re-derived here: an answer lists the knowledge it
 * was actually given, even if the store changed while the turn ran.
 */
function knowledgeUsed(
  requestContext: { get(key: string): unknown } | undefined,
): KnowledgeUse[] | undefined {
  const used = requestContext?.get(KNOWLEDGE_USED_CONTEXT_KEY);
  return Array.isArray(used) && used.length
    ? (used as KnowledgeUse[])
    : undefined;
}

/** `agentContext`'s model-version provenance, read back the same way as
 * `knowledgeUsed` (ADR-0007). */
function modelVersionsUsed(
  requestContext: { get(key: string): unknown } | undefined,
): { dataset: string; version: number }[] | undefined {
  const versions = requestContext?.get(MODEL_VERSIONS_CONTEXT_KEY);
  return Array.isArray(versions) && versions.length
    ? (versions as { dataset: string; version: number }[])
    : undefined;
}

/** True when any captured record this turn came from `run_raw_sql` — the
 * whole answer is then "outside the data model" (ADR-0007 §4), even if other
 * tool calls in the same turn stayed on the logical path. */
function outsideModelFlag(data: ToolDataRecord[]): true | undefined {
  return data.some((record) => record.outsideModel) ? true : undefined;
}

/** Whether a `LogicalQueryError` is worth one `query-fixer` round trip
 * (ADR-0007 §6) — a reference mistake, not a structural one (e.g.
 * `mixed_datasources`, `invalid_order_by`) a rewrite is unlikely to fix. */
function isFixableQueryError(error: LogicalQueryError): boolean {
  return error.issues.some((issue) =>
    FIXABLE_QUERY_ISSUE_CODES.has(issue.code),
  );
}

/** One-line, length-capped rendering of a SQL statement for warn-level logs. */
function logSql(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > SQL_LOG_CHARS
    ? `${flat.slice(0, SQL_LOG_CHARS - 1)}…`
    : flat;
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
