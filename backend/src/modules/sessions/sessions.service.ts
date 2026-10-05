import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestContext } from '@mastra/core/request-context';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { MastraService } from '../../mastra/mastra.service';
import { setDatasetToolServices } from '../../mastra/tool-services';
import type {
  DatasetSnapshot,
  SqlRunRepair,
  SqlRunResult,
} from '../../mastra/tool-services';
import { ASSISTANT_MAX_STEPS } from '../../mastra/agent-constants';
import {
  agentModelId,
  lastAgentModelId,
  resolveAgentModel,
} from '../../mastra/model-resolver';
import { sqlFixOutputSchema } from '../../mastra/agents/sql-fixer.agent';
import { sqlVerifyOutputSchema } from '../../mastra/agents/sql-verifier.agent';
import { DATASETS_CONTEXT_KEY } from '../../mastra/tools/dataset.tools';
import {
  ACTIVE_VISUAL_CONTEXT_KEY,
  SESSION_ID_CONTEXT_KEY,
  TURN_RECORDS_CONTEXT_KEY,
} from '../../mastra/tools/visual.tools';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../../mastra/session-workspaces';
import type { KnowledgeUse } from '../knowledge/entities/knowledge-snippet.entity';
import {
  addUsage,
  extractUsage,
  extractUsageDeep,
  sumUsage,
  type TokenUsage,
} from '../agents/eval-telemetry';
import {
  entityOrientationLines,
  schemaCardBlock,
  schemaSnapshotBlock,
} from '../../mastra/context-blocks';
import {
  ENGINE_OPTIONS_CONTEXT_KEY,
  LOOKUP_TOOL_NAMES,
  RISKY_CATEGORIES,
  describeEngineDiff,
  engineConfigHash,
  resolveEngineOptions,
  type EngineOptions,
  type EngineReasoningEffort,
} from '../engine/engine-options';
import { EngineSettingsService } from '../engine/engine-settings.service';
import { splitEntity } from '../datasources/connectors/connector';
import { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import type { DatasourceKind } from '../datasources/entities/datasource.entity';
import { LlmService } from '../llm/llm.service';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
import { MetricsService } from '../metrics/metrics.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { SessionsRepository } from './repositories/sessions.repository';
import { VisualizationService } from './visualization.service';
import { sourceEntities } from './visualization-document';
import { compareResults } from './result-compare';
import { precheckSql } from './sql-precheck';
import { classifyRepair } from './sql-repair-guard';
import {
  reviewAnswer,
  reviewNudge,
  type AnswerReviewInput,
  type ReviewAgentLike,
} from './answer-review';
import type {
  AnswerReview,
  ProviderError,
  RunTurnOptions,
  SidePass,
  SqlRepairRecord,
  TurnResult,
} from './turn-result';
import {
  STORED_ROWS_CAP,
  classifyProviderError,
  groundingNudge,
  isProviderFailure,
  providerErrorMessage,
  statedRationale,
  synthesizeToolOnlyTurn,
  toolCallNames,
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
 * `providerOptions` as an agent call types it: provider name → settings.
 * `LlmService.providerOptionsFor` returns the looser `Record<string,
 * unknown>` (it knows the provider, not Mastra's option types).
 */
type AgentProviderOptions = Record<
  string,
  Record<string, string | number | boolean>
>;
/**
 * requestContext key carrying the curated-knowledge snippets this turn's
 * system block was built from, so the persist step can record them on the
 * answer without re-reading (and possibly disagreeing with) the store.
 */
const KNOWLEDGE_USED_CONTEXT_KEY = 'knowledge-used';
/**
 * requestContext key carrying the governed-metrics block this turn was
 * given, so the answer review judges the answer against the same
 * definitions the assistant saw rather than a re-read that may differ.
 */
const METRICS_BLOCK_CONTEXT_KEY = 'metrics-block';
/**
 * Tools Mastra adds to a call at execution time, outside `agent.listTools()`:
 * the session workspace's filesystem tools and, because the workspace ships
 * skills, the skill tools (`createSkillTools` in @mastra/core). A per-call
 * `activeTools` list is an allow-list over the *whole* resolved toolset, so
 * leaving these out would silently strip them from every turn that hides
 * the lookup tools. Names that are not in a given call's toolset are
 * ignored by Mastra, so listing every possible one is safe.
 */
const EXECUTION_TIME_TOOL_NAMES: readonly string[] = [
  ...Object.values(WORKSPACE_TOOLS).flatMap((group) =>
    Object.values(group as Record<string, string>),
  ),
  'skill',
  'skill_search',
  'skill_read',
];
/** Rows `lookup_values` may return, whatever the tool asks for. */
const LOOKUP_VALUES_MAX = 50;
const LOOKUP_VALUES_DEFAULT = 10;
/** Longest answer-review note persisted on a message (tooltip-sized). */
const REVIEW_NOTE_CHARS = 220;
const REVIEW_REVISED_NOTE =
  'the review found issues and the answer was corrected';
const REVIEW_FLAGGED_NOTE =
  'the review found issues the corrective pass could not address';
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
/** How long the turn waits for the provider's token counts before giving up. */
const USAGE_WAIT_MS = 2_000;

/**
 * Token counts for one turn, read off the model stream.
 *
 * The smallest possible seam for cost accounting: the stream object already
 * carries the provider's own numbers, so nothing has to wrap the model, count
 * characters or guess. Two deliberate choices:
 *
 * - `totalUsage` first. It spans every step of a multi-step turn (the tool
 *   loop included); `usage` can be the final step alone, so it is the
 *   fallback, not the first choice.
 * - Bounded wait. `totalUsage` settles when the model stream finishes, and a
 *   turn that ended early — a clarification breaks the loop, the user stops
 *   it — may never see that finish chunk. A turn must never hang on its own
 *   bookkeeping, so an unresolved reading is simply "not observed" and the
 *   message is persisted without a `usage` field.
 */
async function readTurnUsage(stream: {
  totalUsage?: Promise<unknown>;
  usage?: Promise<unknown>;
}): Promise<TokenUsage | undefined> {
  // One deadline for both readings, so a turn that reports nothing waits once.
  const deadline = Date.now() + USAGE_WAIT_MS;
  const settle = async (
    pending: Promise<unknown> | undefined,
  ): Promise<unknown> => {
    if (!pending) return undefined;
    // Swallow the rejection here, not in the race: a provider error that
    // arrives after the timeout must not surface as an unhandled rejection.
    const guarded = pending.then(
      (value) => value,
      () => undefined,
    );
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        guarded,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(
            () => resolve(undefined),
            Math.max(0, deadline - Date.now()),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  return (
    extractUsage({ totalUsage: await settle(stream.totalUsage) }) ??
    extractUsage({ usage: await settle(stream.usage) })
  );
}

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
    private readonly datasetsRepository: DatasetsRepository,
    private readonly datasourcesService: DatasourcesService,
    private readonly llmService: LlmService,
    private readonly visuals: VisualizationService,
    private readonly verifiedQueries: VerifiedQueriesService,
    private readonly metrics: MetricsService,
    private readonly knowledge: KnowledgeService,
    private readonly engineSettings: EngineSettingsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Install the DI bridge the Mastra tools use (they load with no Nest DI).
    setDatasetToolServices({
      getDatasets: (names) => this.boundDatasets(names),
      sampleRows: (datasourceId, entity, limit) =>
        this.datasourcesService.sampleRows(datasourceId, entity, limit),
      runReadOnlySql: (datasourceId, sql, limit, datasets, options) =>
        this.runSqlWithRepair(datasourceId, sql, limit, datasets, options),
      lookupValues: (datasourceId, entity, column, phrase, limit) =>
        this.lookupValues(datasourceId, entity, column, phrase, limit),
      knowledgeFor: async (datasets, query) => {
        const entities = (await this.boundDatasets(datasets)).flatMap(
          (s) => s.tables ?? [],
        );
        const [snippets, metrics] = await Promise.all([
          this.knowledge.lookup(datasets, query),
          this.metrics.lookup(entities, {
            phrase: query.phrase,
            entity: query.entity,
          }),
        ]);
        return { snippets, metrics };
      },
      defaultFilters: (datasets) => this.knowledge.defaultFilters(datasets),
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
   * `engine` picks the levers (`engine-options.ts`); left out, it is the
   * production defaults from Settings → Engine levers, which is how a
   * background job gets exactly what chat gets. With `ENGINE_DEFAULTS` the
   * blocks, their order and every call option are what they were before the
   * levers existed — the Iteration 0 baseline depends on that:
   *
   * - `context: 'bare'` drops every curated block (metrics, knowledge,
   *   verified pairs): the schema is all a new install knows on day one.
   * - `columnProfiles` adds per-entity schema cards right after the
   *   orientation block — with `inlineKnowledge`, each column's Knowledge
   *   beside it (never in `bare`, which is knowledge-free by definition).
   * - `staticFirstContext` moves the per-turn parts (verified pairs, the
   *   visuals list) behind everything that is stable across turns, so a
   *   provider's prompt cache can reuse the prefix.
   * - `lookupTools: false` hides `lookup_values` / `lookup_knowledge` via a
   *   per-call `activeTools` — only when the agent has them registered, so
   *   the call is unchanged until they exist.
   *
   * Memory-free on purpose — `agentOptions` adds the session's conversation
   * thread, `backgroundAgentOptions` deliberately does not.
   */
  private async agentContext(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
    engine?: EngineOptions,
  ) {
    const levers = engine ?? (await this.engineSettings.resolved());
    const curated = levers.context !== 'bare';
    const datasets = await this.boundDatasets(session.datasets);
    const entities = datasets.flatMap((s) => s.tables ?? []);
    const visualLines = (session.visualizations ?? []).map(
      (v) =>
        `- ${v.id} — "${v.title}" v${this.visuals.currentVersion(v)} (from the answer at ${v.sourceMessageAt})`,
    );
    const visualsBlock = [
      'Interactive visuals in this session (id — title, current version):',
      ...(visualLines.length ? visualLines : ['(none yet)']),
      activeVisualId
        ? `Visual currently open in the right panel: ${activeVisualId}.`
        : 'No visual is open in the right panel.',
    ];
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
    // The tools read the turn's levers back off the context they run with
    // (`readEngineOptions`), so one resolution governs the whole turn.
    requestContext.set(ENGINE_OPTIONS_CONTEXT_KEY, levers);
    const { reasoningEffort } = await this.llmService.getView();
    const effort = levers.reasoningEffort ?? reasoningEffort;
    const verified =
      curated && question
        ? await this.verifiedQueries.referenceBlock(question)
        : undefined;
    // Curated semantics for the entities this session can see — the one
    // definition of each business number, never re-derived per turn.
    const metrics = curated
      ? await this.metrics.definitionBlock(entities, {
          question,
          ranked: levers.rankedKnowledge,
        })
      : undefined;
    // Curated, user-authored knowledge (glossary/instructions/default
    // filters) for this session's datasets — authoritative over anything
    // the model would otherwise infer from schema alone.
    const knowledge = curated
      ? await this.knowledge.contextFor(session.datasets, {
          question,
          entities,
          ranked: levers.rankedKnowledge,
        })
      : { block: '', used: [] as KnowledgeUse[] };
    // Threaded on requestContext rather than returned alongside the options,
    // because the options object is spread straight into the agent call.
    requestContext.set(KNOWLEDGE_USED_CONTEXT_KEY, knowledge.used);
    if (metrics) requestContext.set(METRICS_BLOCK_CONTEXT_KEY, metrics);
    const cards = levers.columnProfiles
      ? schemaCardBlock(datasets, {
          knowledgeByColumn:
            curated && levers.inlineKnowledge
              ? await this.knowledge.knowledgeByColumn(session.datasets)
              : undefined,
        })
      : '';
    const activeTools = levers.lookupTools
      ? undefined
      : await this.toolsWithoutLookups(requestContext);
    const system = (content: string) => ({ role: 'system' as const, content });
    const orientation = entityOrientationLines(session.datasets, datasets);
    const curatedBlocks = [
      ...(cards ? [system(cards)] : []),
      ...(metrics ? [system(metrics)] : []),
      ...(knowledge.block ? [system(knowledge.block)] : []),
    ];
    const context = levers.staticFirstContext
      ? [
          system(orientation.join('\n')),
          ...curatedBlocks,
          ...(verified ? [system(verified)] : []),
          system(visualsBlock.join('\n')),
        ]
      : [
          system([...orientation, '', ...visualsBlock].join('\n')),
          ...curatedBlocks,
          ...(verified ? [system(verified)] : []),
        ];
    return {
      // Analysis often chains several schema + SQL tool calls per turn.
      maxSteps: levers.maxSteps ?? ASSISTANT_MAX_STEPS,
      // The user-configured reasoning effort (Low/Medium/High chip), unless
      // the turn's levers override it; keyed by provider (`LlmService`).
      providerOptions: (await this.llmService.providerOptionsFor(
        effort,
      )) as AgentProviderOptions,
      context,
      ...(activeTools ? { activeTools } : {}),
      requestContext,
      abortSignal,
    };
  }

  /**
   * The assistant's tool names minus the lookup tools, as a per-call
   * `activeTools` allow-list — or `undefined` (pass nothing) when the agent
   * has no lookup tool registered, which keeps the call identical to one
   * made before the lever existed. The allow-list also names every tool
   * Mastra adds at execution time (`EXECUTION_TIME_TOOL_NAMES`) so hiding
   * two tools never hides the workspace's.
   */
  private async toolsWithoutLookups(
    requestContext: RequestContext,
  ): Promise<string[] | undefined> {
    const lookups = new Set<string>(LOOKUP_TOOL_NAMES);
    let registered: string[];
    try {
      const agent = this.mastra.getAgent('assistant') as {
        listTools?: (args: {
          requestContext: RequestContext;
        }) => Promise<Record<string, unknown>>;
      };
      if (typeof agent?.listTools !== 'function') return undefined;
      registered = Object.keys(
        (await agent.listTools({ requestContext })) ?? {},
      );
    } catch (error) {
      this.logger.warn(
        `Could not list the assistant's tools, lookup tools stay visible: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
    if (!registered.some((name) => lookups.has(name))) return undefined;
    return [...new Set([...registered, ...EXECUTION_TIME_TOOL_NAMES])].filter(
      (name) => !lookups.has(name),
    );
  }

  /** Chat turns: the shared grounding plus this session's memory thread. */
  private async agentOptions(
    session: SessionDoc,
    question?: string,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
    engine?: EngineOptions,
  ) {
    return {
      ...(await this.agentContext(
        session,
        question,
        abortSignal,
        activeVisualId,
        engine,
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

  // ----------------------------------------------------- SQL self-correction

  /**
   * Execution-guided repair: when a statement fails to execute, hand it plus
   * the engine error and the schema in scope to the `sql-fixer` agent and
   * re-run, up to `SQL_REPAIR_ATTEMPTS` times. Empty result sets are not
   * errors — they get a note, never an LLM call. The last error propagates so
   * the tool reports it to the agent as before.
   *
   * `options.engine` is the calling turn's levers (the tool reads them off
   * its requestContext); a call from outside a turn gets the production
   * defaults. The bridge owns three of them (the tool owns the rest):
   *
   * - `sqlRepair: false` — no fixer at all: the original error goes straight
   *   back to the assistant, which (unlike the fixer) knows the question.
   * - `repairIntentGuard` — every repair is classified against the statement
   *   it replaced (`classifyRepair`), so a "fix" that changed a filter or an
   *   aggregate carries a warning instead of passing as the assistant's SQL.
   * - `sqlPrecheck` — zero-token static findings on the statement before it
   *   runs; they annotate the result and never block execution.
   */
  private async runSqlWithRepair(
    datasourceId: string,
    sql: string,
    limit: number,
    datasetNames: string[],
    options?: { engine?: EngineOptions },
  ): Promise<SqlRunResult> {
    const engine = options?.engine ?? (await this.engineSettings.resolved());
    const precheck = engine.sqlPrecheck
      ? await this.precheckStatement(sql, datasourceId, datasetNames, engine)
      : [];
    let statement = sql;
    let fixerContext: { dialect: string; schema: string } | undefined;
    // One record per fixer step that produced a new statement; returned only
    // when a statement finally ran, since a thrown error carries no result.
    const repairs: SqlRunRepair[] = [];
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
          ...(repairs.length ? { repairs } : {}),
          ...(precheck.length ? { precheck } : {}),
        };
      } catch (error) {
        if (!engine.sqlRepair || attempt >= SQL_REPAIR_ATTEMPTS) throw error;
        // Guard rejections (statement never reached the engine) and
        // transport/auth failures aren't a formatting problem a rewrite can
        // fix — skip the fixer round trip and let the real error surface.
        if (!isRepairableSqlError(error)) throw error;
        const message = error instanceof Error ? error.message : String(error);
        fixerContext ??= await this.sqlFixerContext(datasetNames, datasourceId);
        const fix = await this.repairSql(statement, message, fixerContext);
        const corrected = fix.sql;
        if (!corrected || corrected === statement) throw error;
        // `statement`, not `sql`: attempt 2 is repairing the fixer's own
        // rewrite from attempt 1. Flattened/capped — this ships in
        // diagnostics reports and must stay one line per failure.
        this.logger.warn(
          `Repairing failed SQL (attempt ${attempt + 1}): ${message} — SQL: ${logSql(statement)}`,
        );
        const verdict = engine.repairIntentGuard
          ? classifyRepair(statement, corrected)
          : undefined;
        repairs.push({
          original: statement,
          repaired: corrected,
          error: message,
          kind: verdict?.kind ?? 'unknown',
          ...(verdict?.warning ? { warning: verdict.warning } : {}),
          ...(fix.usage ? { usage: fix.usage } : {}),
        });
        statement = corrected;
      }
    }
  }

  /**
   * `sqlPrecheck` findings for `sql` against the snapshots on its datasource.
   * Curated inputs (default filters, governed metrics) are withheld in the
   * `bare` context arm — that arm measures an install with no curation, and
   * a precheck quoting curated filters would leak them back in. Best-effort:
   * a precheck that cannot run reports nothing rather than failing the query.
   */
  private async precheckStatement(
    sql: string,
    datasourceId: string,
    datasetNames: string[],
    engine: EngineOptions,
  ): Promise<string[]> {
    try {
      const datasets = await this.boundDatasets(datasetNames);
      const onDatasource = datasets.filter(
        (s) => s.datasourceId === datasourceId,
      );
      const snapshots = onDatasource.length ? onDatasource : datasets;
      const curated = engine.context !== 'bare';
      return precheckSql(sql, snapshots, {
        defaultFilters: curated
          ? await this.knowledge.defaultFilters(datasetNames)
          : [],
        metrics: curated
          ? await this.metrics.forEntities(
              snapshots.flatMap((s) => s.tables ?? []),
            )
          : [],
      });
    } catch (error) {
      this.logger.warn(
        `SQL precheck skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * `lookup_values`: the stored values of `entity.column` containing
   * `phrase`, most frequent first — so the assistant filters on
   * `'Denied - Prior Auth'` rather than guessing `'denied'`.
   *
   * The only statement in the backend built from tool arguments, so it is
   * guarded first: `entity` must be a table of a dataset bound to
   * `datasourceId` and `column` must be in that table's snapshot — both are
   * then taken from the snapshot, never from the arguments — and the phrase
   * is escaped for the literal and for LIKE. Identifiers are quoted the way
   * the connectors quote them in `sampleRows`.
   */
  private async lookupValues(
    datasourceId: string,
    entity: string,
    column: string,
    phrase: string,
    limit: number,
  ): Promise<{ value: string; count?: number }[]> {
    const names = (await this.datasetsRepository.list()).map((d) => d.name);
    const onDatasource = (await this.boundDatasets(names)).filter(
      (s) => s.datasourceId === datasourceId,
    );
    const wantedEntity = (entity ?? '').trim().toLowerCase();
    const dataset = onDatasource.find((s) =>
      (s.tables ?? []).some((t) => t.toLowerCase() === wantedEntity),
    );
    const key = dataset?.tables.find((t) => t.toLowerCase() === wantedEntity);
    if (!dataset || !key) {
      throw new Error(
        `lookup_values: "${entity}" is not a table of any dataset on this datasource`,
      );
    }
    const columns = dataset.entities?.find((e) => e.key === key)?.columns ?? [];
    const wantedColumn = (column ?? '').trim().toLowerCase();
    const known = columns.find((c) => c.name.toLowerCase() === wantedColumn);
    if (!known) {
      throw new Error(
        `lookup_values: "${column}" is not a column of ${key}${
          columns.length
            ? ` — its columns are ${columns.map((c) => c.name).join(', ')}`
            : ''
        }`,
      );
    }
    const rows = Math.max(
      1,
      Math.min(LOOKUP_VALUES_MAX, Math.floor(limit) || LOOKUP_VALUES_DEFAULT),
    );
    const result = await this.datasourcesService.runReadOnlySql(
      datasourceId,
      lookupValuesSql(
        dataset.datasourceKind ?? 'databricks',
        key,
        known.name,
        phrase ?? '',
        rows,
      ),
      rows,
    );
    return result.rows.map((row) => ({
      value: cellText(row['lookup_value']),
      count: Number(row['lookup_count']) || 0,
    }));
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

  /**
   * One fixer pass. `sql` is undefined when it produced nothing usable;
   * `usage` is what the call cost when the provider reported it.
   */
  private async repairSql(
    sql: string,
    error: string,
    context: { dialect: string; schema: string },
  ): Promise<{ sql?: string; usage?: TokenUsage }> {
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
            providerOptions: (await this.llmService.providerOptionsFor(
              'low',
            )) as AgentProviderOptions,
            structuredOutput: {
              schema: sqlFixOutputSchema,
              jsonPromptInjection: 'inline',
            },
          },
        );
      const parsed = sqlFixOutputSchema.safeParse(
        result.object ?? parseJsonObject(result.text),
      );
      const usage = extractUsageDeep(result);
      // The connector rejects anything but a read-only statement anyway — keep
      // the original error instead of burning another round-trip on it.
      return {
        sql: parsed.success ? readOnlyStatement(parsed.data.sql) : undefined,
        ...(usage ? { usage } : {}),
      };
    } catch (err) {
      this.logger.warn(
        `SQL repair attempt failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {};
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
   * verify must not lose the answer it was verifying. `effort` is the turn's
   * effective reasoning effort; `onUsage` receives the verifier call's token
   * counts (the turn's `crossCheck` side pass) when they were reported.
   */
  private async crossCheckAnswer(
    session: SessionDoc,
    question: string,
    data: ToolDataRecord[],
    effort: EngineReasoningEffort,
    onUsage?: (usage: TokenUsage) => void,
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
      const sql = await this.deriveIndependentSql(
        question,
        context,
        effort,
        onUsage,
      );
      if (!sql) {
        this.logger.warn(
          'Cross-check skipped: verifier produced no usable query',
        );
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
    const datasets = await this.boundDatasets(session.datasets);
    const datasourceId =
      (await this.soleDatasourceId(session)) ??
      datasets.find((s) => s.datasourceId)?.datasourceId;
    if (!datasourceId) return undefined;
    const inScope = datasets.filter((s) => s.datasourceId === datasourceId);
    return {
      dialect: sqlDialectOf(inScope),
      datasourceId,
      schema: schemaSnapshotBlock(inScope, {
        budgetChars: VERIFIER_SCHEMA_CHARS,
        sampleValues: VERIFIER_SAMPLE_VALUES,
      }),
    };
  }

  /**
   * One verifier pass. It gets the question, the schema with sample values and
   * the user-approved reference pairs — deliberately not the original SQL.
   */
  private async deriveIndependentSql(
    question: string,
    context: { dialect: string; schema: string },
    effort: EngineReasoningEffort,
    onUsage?: (usage: TokenUsage) => void,
  ): Promise<string | undefined> {
    let verified: string | undefined;
    try {
      verified = await this.verifiedQueries.referenceBlock(question);
    } catch {
      verified = undefined;
    }
    // A second opinion should think as hard as the answer it is checking.
    const providerOptions = (await this.llmService.providerOptionsFor(
      effort,
    )) as AgentProviderOptions;
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
          providerOptions,
          structuredOutput: {
            schema: sqlVerifyOutputSchema,
            jsonPromptInjection: 'inline',
          },
        },
      );
    const usage = extractUsageDeep(result);
    if (usage) onUsage?.(usage);
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
    session.messages.push({
      role: 'assistant',
      content: (result.text ?? '').trim(),
      at: new Date().toISOString(),
      ...(reasoning ? { reasoning } : {}),
      ...(knowledge ? { knowledge } : {}),
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
   * carries the verdict. Everything else is the production turn, `runTurn`.
   */
  async streamMessage(
    id: string,
    content: string,
    emit: (event: StreamEvent) => void,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
    careful = false,
  ): Promise<void> {
    await this.runTurn(id, content, {
      emit,
      abortSignal,
      activeVisualId,
      engine: careful ? { careful: 'on' } : undefined,
    });
  }

  /**
   * The production turn — the one place a question gets answered. Chat
   * (`streamMessage`), the CLI golden-set harness and the in-app eval runner
   * all come through here, so a graded run measures exactly what a user
   * gets (`turn-result.ts` says why that matters).
   *
   * One turn, in order: persist the prompt → stream the assistant run
   * (tools, repairs, guards) → tool-only synthesis when it ended without
   * prose → the zero-tool grounding guard → the answer review (lever
   * `answerReview`) → careful mode's cross-check (`careful`, `'auto'` on a
   * risky category or a turn whose SQL drew a warning) → persist the answer
   * → `done`. The levers are `opts.engine` over Settings → Engine levers,
   * resolved once and handed to the tools on the requestContext.
   *
   * Returns everything a harness grades, side passes and their token counts
   * included. An aborted turn still returns what it had (`aborted: true`).
   */
  async runTurn(
    id: string,
    content: string,
    opts: RunTurnOptions = {},
  ): Promise<TurnResult> {
    const started = Date.now();
    const emit = opts.emit ?? (() => {});
    const trimmed = (content ?? '').trim();
    if (!trimmed) throw new BadRequestException('message is required');
    const session = await this.get(id);
    this.appendUserMessage(session, trimmed);
    // Persist the prompt before model startup. A user can stop while the
    // provider is still connecting, and that turn should survive a reload.
    await this.repository.update(id, { messages: session.messages });

    const engine = resolveEngineOptions(
      await this.engineSettings.resolved(),
      opts.engine,
    );
    const effort: EngineReasoningEffort =
      engine.reasoningEffort ??
      (await this.llmService.getView()).reasoningEffort;
    const configHash = engineConfigHash(engine, {
      model: await this.turnModelId(),
      reasoningEffort: effort,
    });

    const agent = this.mastra.getAgent('assistant');
    const input = await this.agentInput(agent, session);
    // Own controller so a clarification can end the model turn without the
    // client having disconnected.
    const turn = new AbortController();
    const forwardAbort = () => turn.abort();
    opts.abortSignal?.addEventListener('abort', forwardAbort, { once: true });
    const options = await this.agentOptions(
      session,
      trimmed,
      turn.signal,
      opts.activeVisualId,
      engine,
    );
    // A live reference to this turn's captured records, handed to the visual
    // tools via requestContext so create_visual/update_visual called later in
    // the same turn can see SQL the turn already ran (drill-down queries a
    // tailored visual needs but that never touched the source answer). Fresh
    // RequestContext + array per call — no leakage across turns or sessions.
    const data: ToolDataRecord[] = [];
    options.requestContext.set(TURN_RECORDS_CONTEXT_KEY, data);

    let text = '';
    let clarification: ChatMessage['clarification'] | null = null;
    let visualEvent: VisualEvent | undefined;
    let review: AnswerReview | undefined;
    let crossChecked: CrossCheck | undefined;
    // The first failure the provider (or the stream to it) reported in the
    // main run — quota, rate limit, auth, network, timeout. Mastra does not
    // throw it: it sends an `error` chunk and ends the stream, so without this
    // an outage looked like a turn that simply had nothing to say.
    let providerError: ProviderError | undefined;
    const pendingCalls = new Map<string, Record<string, unknown>>();
    // Every tool name the model invoked this turn, in call order, repeats
    // kept — what a harness grades `calledTool`/`toolOrder` on, and what the
    // zero-SQL-turn grounding guard below keys off (it fires only when empty).
    const calledTools: string[] = [];
    const sidePassUsage: Partial<Record<SidePass, TokenUsage>> = {};
    const bill = (pass: SidePass, observed: TokenUsage | undefined) => {
      if (!observed) return;
      const sofar = sidePassUsage[pass];
      sidePassUsage[pass] = sofar ? addUsage(sofar, observed) : observed;
    };
    const finish = (message?: ChatMessage, usage?: TokenUsage): TurnResult =>
      turnResult({
        text: message?.content ?? text.trim(),
        message,
        data,
        calledTools,
        clarification: clarification ?? undefined,
        crossCheck: crossChecked,
        review,
        usage,
        sidePassUsage,
        engine,
        configHash,
        aborted: turn.signal.aborted && !clarification,
        durationMs: Date.now() - started,
        providerError,
      });

    const stream = await agent.stream(input, options);
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
          if (payload.toolName) calledTools.push(payload.toolName);
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
        } else if (chunk.type === 'error') {
          // `{ type: 'error', payload: { error } }` — an AI SDK
          // `APICallError` for an HTTP failure (`statusCode`, `responseBody`,
          // `data`), a network/timeout error, or a MastraError for a step
          // that finished with reason "error". The run ends after it; what
          // the turn does about it is decided once the stream is drained.
          if (!turn.signal.aborted && !providerError) {
            providerError = classifyProviderError(
              (chunk.payload as { error?: unknown } | undefined)?.error,
            );
          }
        }
      }
    } catch (error) {
      if (!turn.signal.aborted) {
        // A provider failure thrown out of the stream, before any answer,
        // ends the turn like an error chunk does. Anything else — or a throw
        // after text was already streamed — surfaces exactly as before.
        if (text.trim() || !isProviderFailure(error)) throw error;
        providerError ??= classifyProviderError(error);
      }
    } finally {
      opts.abortSignal?.removeEventListener('abort', forwardAbort);
    }
    if (!turn.signal.aborted && !clarification && !text) {
      try {
        text = ((await stream.text) ?? '').trim();
      } catch (error) {
        // After an error chunk the stream rejects `text` with that error.
        if (!turn.signal.aborted) {
          providerError ??= classifyProviderError(error);
        }
      }
      // A stream can also end "finished with an error" without the chunk ever
      // reaching this loop; the output keeps it on `error`.
      const streamError = (stream as { error?: unknown }).error;
      if (!text && !providerError && streamError && !turn.signal.aborted) {
        providerError = classifyProviderError(streamError);
      }
    }
    // The provider refused or dropped the turn before it produced an answer.
    // Every side pass below (synthesis, grounding guard, answer review,
    // cross-check) would call the same failing provider, and the synthesis
    // fallback would claim an analysis that never finished — so the turn
    // ends here with an honest message instead. A turn that did produce
    // text, a clarification or a visual keeps what it produced.
    const providerFailed =
      !!providerError &&
      !turn.signal.aborted &&
      !clarification &&
      !text.trim() &&
      !visualEvent;
    if (providerError && providerFailed) {
      this.logger.warn(
        `Turn ended by a provider error (${providerError.kind}${providerError.statusCode ? `, HTTP ${providerError.statusCode}` : ''}): ${providerError.message}`,
      );
      text = providerErrorMessage(providerError, calledTools.length > 0);
      emit({ type: 'text', content: text });
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
        await this.llmService.providerOptionsFor(effort),
        this.logger,
        (observed) => bill('synthesis', observed),
      );
      if (turn.signal.aborted) return finish();
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
      !providerFailed &&
      text.trim() &&
      calledTools.length === 0
    ) {
      const guard = await this.runGroundingGuard(
        agent,
        trimmed,
        text,
        options,
        data,
        turn.signal,
      );
      bill('grounding', guard.usage);
      calledTools.push(...guard.calledTools);
      if (guard.text) text = guard.text;
    }

    // Answer review (lever `answerReview`): after every rewrite above, so it
    // judges the answer the user would see; before the cross-check, so a
    // revised answer is the one careful mode corroborates.
    if (
      engine.answerReview &&
      !turn.signal.aborted &&
      !clarification &&
      !providerFailed &&
      text.trim()
    ) {
      const outcome = await this.reviewTurn(
        agent,
        session,
        trimmed,
        text,
        options,
        data,
        turn.signal,
        engine,
      );
      review = outcome.review;
      bill('review', outcome.usage);
      calledTools.push(...outcome.calledTools);
      if (outcome.text) text = outcome.text;
    }

    // What the turn cost, read once, before the answer is written. Kept on the
    // message so a cost log never has to re-derive it — see `ChatMessage.usage`.
    const usage = await readTurnUsage(stream);

    // Visual tools persist metadata mid-turn; reload so this write keeps it.
    const fresh = await this.get(id);
    const messages = fresh.messages;
    const entities = sourceEntities(data);
    const reasoning = reasoningTrail(data);
    const knowledge = knowledgeUsed(options.requestContext);
    // Stamped only when this turn ran something other than today's engine,
    // or a harness named its arm — an ordinary chat answer is unchanged.
    const engineStamp =
      describeEngineDiff(engine).length || opts.arm
        ? {
            engine: {
              hash: configHash,
              careful: engine.careful,
              answerReview: engine.answerReview,
              ...(opts.arm ? { arm: opts.arm } : {}),
            },
          }
        : {};
    let persisted: ChatMessage | undefined;
    if (clarification) {
      // The turn stops here, but the schema/sample work done before the
      // question is real work — keep it on the card instead of dropping it.
      persisted = {
        role: 'assistant',
        content: clarification.question,
        at: new Date().toISOString(),
        clarification,
        ...(data.length ? { data } : {}),
        ...(entities.length ? { entities } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(knowledge ? { knowledge } : {}),
        ...(usage ? { usage } : {}),
        ...engineStamp,
      };
      messages.push(persisted);
    } else if (text.trim() || visualEvent) {
      // An honest provider-error message is not an answer: no provenance
      // line, no verified badge, nothing to cross-check.
      const interpretation = providerFailed
        ? undefined
        : interpretationLine(data, entities);
      // Careful mode only, and only when there is a result set to corroborate.
      crossChecked =
        !turn.signal.aborted &&
        !providerFailed &&
        crossCheckWanted(engine, opts.category, data)
          ? await this.crossCheckAnswer(
              session,
              trimmed,
              data,
              effort,
              (observed) => bill('crossCheck', observed),
            )
          : undefined;
      persisted = {
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
        ...(!providerFailed && (await this.matchesVerifiedQuery(session, data))
          ? { verified: true }
          : {}),
        ...(visualEvent ? { visual: visualEvent } : {}),
        ...(crossChecked ? { crossCheck: crossChecked } : {}),
        ...(review ? { review } : {}),
        ...(usage ? { usage } : {}),
        ...(providerError ? { providerError } : {}),
        ...engineStamp,
      };
      messages.push(persisted);
    }
    const updated = await this.repository.update(id, { messages });
    if (!turn.signal.aborted || clarification) {
      emit({ type: 'done', session: updated ?? fresh });
    }
    return finish(persisted, usage);
  }

  /** The router id the turn's agents resolve to, for `configHash`. */
  private async turnModelId(): Promise<string> {
    try {
      return agentModelId(await resolveAgentModel());
    } catch {
      // The agent call will surface the real error; the hash just needs a name.
      return lastAgentModelId() ?? 'unknown';
    }
  }

  /**
   * Runtime backstop for the grounding rule in the system prompt: a turn
   * that produced a non-empty answer without calling a single tool gets one
   * corrective pass, tools allowed, before it is accepted. Called at most
   * once per turn by `runTurn`.
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
   * `entities`, `interpretation` and verified-badge logic below. The pass's
   * tool names and token counts come back too — it is a side pass of the
   * turn, and a harness grades and bills it like one.
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
  ): Promise<{ text?: string; usage?: TokenUsage; calledTools: string[] }> {
    return this.correctivePass(
      agent,
      question,
      turnOptions,
      [groundingNudge(originalAnswer)],
      data,
      abortSignal,
      'Grounding guard',
    );
  }

  /**
   * One memory-free, tools-allowed `generate` over the turn's own system
   * blocks plus `nudges` — the shared shape of the grounding guard and the
   * answer review's corrective pass (see `runGroundingGuard` for why it must
   * not touch memory). The pass's records land on `data` only when it
   * produced an answer, so the persisted SQL always belongs to the text.
   */
  private async correctivePass(
    agent: ReturnType<MastraService['getAgent']>,
    question: string,
    turnOptions: {
      context?: { role: 'system'; content: string }[];
      memory?: unknown;
      [key: string]: unknown;
    },
    nudges: string[],
    data: ToolDataRecord[],
    abortSignal: AbortSignal,
    label: string,
  ): Promise<{ text?: string; usage?: TokenUsage; calledTools: string[] }> {
    const correctiveOptions: Record<string, unknown> = { ...turnOptions };
    delete correctiveOptions['memory'];
    correctiveOptions['context'] = [
      ...(turnOptions.context ?? []),
      ...nudges.map((content) => ({ role: 'system' as const, content })),
    ];
    try {
      const result = await agent.generate(question, correctiveOptions);
      const usage = extractUsageDeep(result);
      const calledTools = toolCallNames(result);
      const corrected = ((result as { text?: string }).text ?? '').trim();
      if (!corrected) return { usage, calledTools };
      data.push(...toolRecords(result));
      return { text: corrected, usage, calledTools };
    } catch (error) {
      if (!abortSignal.aborted) {
        this.logger.warn(
          `${label} corrective pass failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return { calledTools: [] };
    }
  }

  /**
   * Lever `answerReview` (L4 Stage C0): one `answer-review` call over the
   * finished turn — the answer, the SQL it ran, the result shape, the
   * guards' warnings, the governed metrics and default filters it was given
   * — and, when the review finds something, one corrective pass with the
   * findings as a system nudge (same memory-free shape as the grounding
   * guard). `revised` when that pass produced a new answer, `flagged` when it
   * did not; the review can never lose the answer — an unavailable or failed
   * review is `status: 'error'` and the original text stands.
   */
  private async reviewTurn(
    agent: ReturnType<MastraService['getAgent']>,
    session: SessionDoc,
    question: string,
    answer: string,
    turnOptions: {
      context?: { role: 'system'; content: string }[];
      memory?: unknown;
      providerOptions?: unknown;
      requestContext: RequestContext;
      [key: string]: unknown;
    },
    data: ToolDataRecord[],
    abortSignal: AbortSignal,
    engine: EngineOptions,
  ): Promise<{
    review: AnswerReview;
    text?: string;
    usage?: TokenUsage;
    calledTools: string[];
  }> {
    let reviewer: ReviewAgentLike;
    try {
      reviewer = this.mastra.getAgent('answer-review');
    } catch (error) {
      return {
        review: reviewError(
          `the answer review is unavailable — ${error instanceof Error ? error.message : String(error)}`,
        ),
        calledTools: [],
      };
    }
    const metricsBlock = turnOptions.requestContext.get(
      METRICS_BLOCK_CONTEXT_KEY,
    );
    const input: AnswerReviewInput = {
      question,
      finalText: answer,
      sql: data
        .filter((r) => r.tool === 'run_readonly_sql' && r.input?.trim())
        .map((r) => ({
          sql: r.input!.trim(),
          ok: !r.error,
          ...(r.error ? { error: r.error } : {}),
          ...(r.rowCount === undefined ? {} : { rowCount: r.rowCount }),
        })),
      resultShape: resultShape(data),
      warnings: turnWarnings(data),
      ...(typeof metricsBlock === 'string' && metricsBlock
        ? { metricsBlock }
        : {}),
      ...(engine.context !== 'bare'
        ? { defaultFilters: await this.defaultFilterLines(session) }
        : {}),
    };
    let verdict: Awaited<ReturnType<typeof reviewAnswer>>;
    try {
      verdict = await reviewAnswer(reviewer, input, {
        providerOptions: turnOptions.providerOptions as
          Record<string, unknown> | undefined,
        abortSignal,
      });
    } catch (error) {
      return {
        review: reviewError(
          `the answer review could not complete — ${error instanceof Error ? error.message : String(error)}`,
        ),
        calledTools: [],
      };
    }
    const { review, usage, nudge } = verdict;
    if (review.status === 'ok' || !review.findings.length) {
      return { review, usage, calledTools: [] };
    }
    const findingsNudge = reviewNudge(review.findings);
    const corrective = await this.correctivePass(
      agent,
      question,
      turnOptions,
      [
        findingsNudge,
        ...(nudge && nudge !== findingsNudge ? [nudge] : []),
        // Memory-free, so the pass has not seen the answer it must correct.
        `The answer under review:\n${answer}`,
      ],
      data,
      abortSignal,
      'Answer review',
    );
    const both = [usage, corrective.usage].filter((u): u is TokenUsage => !!u);
    return {
      review: corrective.text
        ? {
            ...review,
            status: 'revised',
            note: clipNote(review.note || REVIEW_REVISED_NOTE),
          }
        : {
            ...review,
            status: 'flagged',
            note: clipNote(review.note || REVIEW_FLAGGED_NOTE),
          },
      text: corrective.text,
      usage: both.length ? sumUsage(both) : undefined,
      calledTools: corrective.calledTools,
    };
  }

  /** `entity: predicate` for each default filter in scope — never throws. */
  private async defaultFilterLines(
    session: SessionDoc,
  ): Promise<string[] | undefined> {
    try {
      const filters = await this.knowledge.defaultFilters(session.datasets);
      return filters.length
        ? filters.map((f) => `${f.entity}: ${f.predicate}`)
        : undefined;
    } catch {
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

/**
 * Narrow, deliberately conservative match for transport/auth failures — the
 * statement never reached the engine at all, so no rewrite touches these.
 * Kept to specific markers (HTTP status wording, known Node connection error
 * codes, timeouts) rather than bare numbers, so it doesn't accidentally
 * swallow a genuine engine error that happens to mention a number.
 */
const TRANSPORT_OR_AUTH_ERROR =
  /\bstatus code\b|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|\bsocket hang up\b|\btimed? ?out\b|\bconnection (?:refused|reset|closed)\b/i;

/**
 * Whether a failed statement is worth another `sql-fixer` round trip.
 * Repairable = the engine parsed and rejected the statement, so a rewrite
 * can plausibly fix it. Not repairable: `assertReadOnlySql`'s
 * `BadRequestException` (the statement never reached the engine — a rewrite
 * doesn't change whether it's forbidden/malformed) or a transport/auth
 * failure (HTTP status, connection, timeout). Anything unrecognised defaults
 * to repairable: that matches today's behaviour (every error goes to the
 * fixer), so an under-matched transport message costs one attempt at worst,
 * while an over-matched one would silently skip a genuinely fixable error.
 */
function isRepairableSqlError(error: unknown): boolean {
  if (error instanceof BadRequestException) return false;
  const message = error instanceof Error ? error.message : String(error);
  return !TRANSPORT_OR_AUTH_ERROR.test(message);
}

/** One-line, length-capped rendering of a SQL statement for warn-level logs. */
function logSql(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > SQL_LOG_CHARS
    ? `${flat.slice(0, SQL_LOG_CHARS - 1)}…`
    : flat;
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

/**
 * `careful` resolved for one turn: `'on'` always, `'off'` never, `'auto'`
 * only where a confident wrong answer is likeliest — an eval category in
 * `RISKY_CATEGORIES`, or a turn whose own SQL drew a result-guard warning or
 * a precheck finding, or whose fixer changed what the query asks.
 */
function crossCheckWanted(
  engine: EngineOptions,
  category: string | undefined,
  data: ToolDataRecord[],
): boolean {
  if (engine.careful === 'on') return true;
  if (engine.careful !== 'auto') return false;
  if (category && RISKY_CATEGORIES.has(category)) return true;
  return data.some(
    (record) =>
      !!record.warnings?.length ||
      !!record.precheck?.length ||
      !!record.repairs?.some((repair) => repair.kind === 'semantic'),
  );
}

/**
 * Every guard warning, precheck finding and repair warning on the turn's
 * records, deduplicated in first-seen order — the tool may already have
 * merged precheck/repair lines into `warnings`, so the same text can arrive
 * twice.
 */
function turnWarnings(data: ToolDataRecord[]): string[] {
  const seen = new Set<string>();
  for (const record of data) {
    for (const line of [
      ...(record.warnings ?? []),
      ...(record.precheck ?? []),
      ...(record.repairs ?? []).map((repair) => repair.warning ?? ''),
    ]) {
      if (line) seen.add(line);
    }
  }
  return [...seen];
}

/** `N rows × columns a, b` of the answer's final result, for the review. */
function resultShape(data: ToolDataRecord[]): string | undefined {
  const record = successfulSqlRuns(data).at(-1);
  if (!record) return undefined;
  const rows = record.rowCount ?? record.rows?.length ?? 0;
  const columns = record.columns?.length
    ? ` × columns ${record.columns.join(', ')}`
    : '';
  const clipped = record.truncated ? ' (truncated — row limit reached)' : '';
  return `${rows} row${rows === 1 ? '' : 's'}${columns}${clipped}`;
}

/** A result cell as the text a filter literal would need. */
function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return JSON.stringify(value) ?? '';
}

function clipNote(note: string): string {
  const flat = note.replace(/\s+/g, ' ').trim();
  return flat.length > REVIEW_NOTE_CHARS
    ? `${flat.slice(0, REVIEW_NOTE_CHARS - 1)}…`
    : flat;
}

function reviewError(note: string): AnswerReview {
  return { status: 'error', findings: [], note: clipNote(note) };
}

/**
 * Assemble the `TurnResult` from what the turn gathered. Pure over its
 * inputs: fixer usage is read off the repair records (the bridge cannot know
 * which turn called it), and `usage` is the main run plus every side pass
 * that reported something — absent when nothing did, which is not zero.
 */
function turnResult(turn: {
  text: string;
  message?: ChatMessage;
  data: ToolDataRecord[];
  calledTools: string[];
  clarification?: ChatMessage['clarification'];
  crossCheck?: CrossCheck;
  review?: AnswerReview;
  usage?: TokenUsage;
  sidePassUsage: Partial<Record<SidePass, TokenUsage>>;
  engine: EngineOptions;
  configHash: string;
  aborted: boolean;
  durationMs: number;
  providerError?: ProviderError;
}): TurnResult {
  const repairs: SqlRepairRecord[] = turn.data.flatMap(
    (record) => record.repairs ?? [],
  );
  const sides: Partial<Record<SidePass, TokenUsage>> = {
    ...turn.sidePassUsage,
  };
  const fixer = repairs
    .map((repair) => repair.usage)
    .filter((u): u is TokenUsage => !!u);
  if (fixer.length) sides.fixer = sumUsage(fixer);
  const observed = [turn.usage, ...Object.values(sides)].filter(
    (u): u is TokenUsage => !!u,
  );
  const finalSql = lastSuccessfulSql(turn.data);
  return {
    text: turn.text,
    ...(turn.message ? { message: turn.message } : {}),
    data: turn.data,
    calledTools: [...turn.calledTools],
    steps: turn.calledTools.length,
    ...(finalSql ? { finalSql } : {}),
    ...(turn.clarification ? { clarification: turn.clarification } : {}),
    ...(turn.crossCheck ? { crossCheck: turn.crossCheck } : {}),
    ...(turn.review ? { review: turn.review } : {}),
    repairs,
    warnings: turnWarnings(turn.data),
    ...(observed.length ? { usage: sumUsage(observed) } : {}),
    ...(Object.keys(sides).length ? { sidePassUsage: sides } : {}),
    engine: turn.engine,
    configHash: turn.configHash,
    aborted: turn.aborted,
    durationMs: turn.durationMs,
    ...(turn.providerError ? { providerError: turn.providerError } : {}),
  };
}

/**
 * The `lookup_values` statement: distinct values of one column containing
 * `phrase` (case-insensitive), most frequent first. `entity` and `column`
 * must already be validated against a dataset snapshot — they are quoted
 * here, not checked. Identifiers follow the connectors' `sampleRows`
 * convention: `"schema"."table"` on Postgres (the database is the
 * connection's), backticks on all three Databricks parts. The phrase is
 * escaped for LIKE with `!` (`%`, `_` and `!` itself) — not a backslash,
 * whose meaning inside a string literal differs between the two dialects —
 * then for the literal (`'`, plus `\` on Databricks, where a backslash in a
 * literal is an escape character).
 */
export function lookupValuesSql(
  kind: DatasourceKind,
  entity: string,
  column: string,
  phrase: string,
  limit: number,
): string {
  const [catalog, schema, table] = splitEntity(entity);
  // Postgres and REST (SQLite over fetched endpoints) quote with "…",
  // Databricks with backticks.
  const quote =
    kind === 'databricks'
      ? (ident: string) => `\`${ident.replace(/`/g, '``')}\``
      : (ident: string) => `"${ident.replace(/"/g, '""')}"`;
  // A REST endpoint is materialised as one table named by its lower-cased
  // `api.schema.table` key, which the connector recognises when quoted whole.
  const from =
    kind === 'postgres'
      ? `${quote(schema)}.${quote(table)}`
      : kind === 'rest'
        ? quote(`${catalog}.${schema}.${table}`.toLowerCase())
        : [catalog, schema, table].map(quote).join('.');
  const col = quote(column);
  let pattern = phrase
    .trim()
    .toLowerCase()
    .replace(/[!%_]/g, (char) => `!${char}`)
    .replace(/'/g, "''");
  if (kind === 'databricks') pattern = pattern.replace(/\\/g, '\\\\');
  const text = kind === 'databricks' ? 'STRING' : 'TEXT';
  return [
    `SELECT ${col} AS lookup_value, COUNT(*) AS lookup_count`,
    `FROM ${from}`,
    `WHERE LOWER(CAST(${col} AS ${text})) LIKE '%${pattern}%' ESCAPE '!'`,
    `GROUP BY ${col}`,
    `ORDER BY lookup_count DESC, lookup_value`,
    `LIMIT ${Math.max(1, Math.floor(limit))}`,
  ].join(' ');
}
