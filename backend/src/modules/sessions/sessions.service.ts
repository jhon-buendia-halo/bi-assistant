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
  DatasetColumnSnapshot,
  DatasetSnapshot,
  SqlRunResult,
} from '../../mastra/tool-services';
import { ASSISTANT_MAX_STEPS } from '../../mastra/agent-constants';
import { sqlFixOutputSchema } from '../../mastra/agents/sql-fixer.agent';
import { sqlVerifyOutputSchema } from '../../mastra/agents/sql-verifier.agent';
import {
  DATASETS_CONTEXT_KEY,
  DEFAULT_SQL_ROW_LIMIT,
} from '../../mastra/tools/dataset.tools';
import {
  ACTIVE_VISUAL_CONTEXT_KEY,
  SESSION_ID_CONTEXT_KEY,
  TURN_RECORDS_CONTEXT_KEY,
} from '../../mastra/tools/visual.tools';
import { SESSION_WORKSPACE_CONTEXT_KEY } from '../../mastra/session-workspaces';
import type { KnowledgeUse } from '../knowledge/entities/knowledge-snippet.entity';
import { extractUsage, type TokenUsage } from '../agents/eval-telemetry';
import {
  entityOrientationLines,
  schemaSnapshotBlock,
} from '../../mastra/context-blocks';
import {
  DatasetsRepository,
  type DatasetDoc,
} from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import { LlmService } from '../llm/llm.service';
import { VerifiedQueriesService } from '../verified-queries/verified-queries.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  KnowledgeService,
  type KnowledgeQuery,
} from '../knowledge/knowledge.service';
import {
  ExpertModeService,
  type TraceInput,
} from '../expert-mode/expert-mode.service';
import { pickAnswerRecord } from '../expert-mode/answer-record';
import { withVerifiedMatch } from '../expert-mode/rescore';
import {
  validateBlockFeedback,
  type BlockFeedbackDto,
} from '../expert-mode/dto/block-feedback.dto';
import type {
  BlockFeedback,
  BlockVote,
  ReasoningBlock,
  ReasoningBlockKind,
  ReasoningTrace,
} from '../expert-mode/entities/reasoning-trace.entity';
import {
  AnswerPinsService,
  stripForPin,
} from '../answer-pins/answer-pins.service';
import type {
  AnswerPinDoc,
  FingerprintParts,
  PinMode,
} from '../answer-pins/entities/answer-pin.entity';
import {
  fingerprintFor,
  knowledgePart,
  lineageKeyFor,
  modelPart,
  normalizeQuestion,
  schemaPart,
  textPart,
  type ModelPartView,
  type SchemaDataset,
} from '../answer-pins/pin-key';
import { pinEligible } from '../answer-pins/eligibility';
import {
  LearningService,
  type LearnedLesson,
} from '../learning/learning.service';
import { SessionsRepository } from './repositories/sessions.repository';
import { VisualizationService } from './visualization.service';
import { sourceEntities } from './visualization-document';
import { compareResults } from './result-compare';
import {
  STORED_ROWS_CAP,
  groundingNudge,
  statedRationale,
  synthesizeToolOnlyTurn,
  toolDataRecord,
  toolRecords,
} from './turn-data';
import {
  AnswerConsistency,
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
 * requestContext keys carrying the governed-metrics and verified-reference
 * blocks this turn's context was built from — read back by business expert
 * mode, whose trace may only cite sources the turn was actually given.
 */
const METRICS_BLOCK_CONTEXT_KEY = 'metrics-block';
const VERIFIED_BLOCK_CONTEXT_KEY = 'verified-block';
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
 * Extra system context on business-expert-mode turns. Expert mode shows every
 * assumption block by block and turns a reviewer's correction into curated
 * knowledge (`modules/learning`), so for a definition the knowledge does not
 * cover, a stated assumption the reviewer can correct once is worth more than
 * a clarification that only settles this one conversation. Without it GPT-5
 * asked "What's your fiscal year boundary?" on the Retail trap before running
 * a single query — and none of its options was the real calendar.
 */
const REVIEW_MODE_CONTEXT = [
  'Business expert mode is on for this turn: a reviewer reads your',
  'interpretation, assumptions and metric definition one by one and corrects',
  'them, and every correction becomes curated knowledge for later answers.',
  'So when the definition you need is a business convention the curated',
  'knowledge does not cover — a fiscal calendar, how a metric is calculated,',
  'which records a business term includes — do not ask: answer under the most',
  'common convention and state that assumption plainly in the answer. Still',
  'ask when the question names something the data itself matches in several',
  'ways (a person, product, member or value with several plausible matches),',
  'because no convention can settle that.',
].join('\n');

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
    | 'reasoning'
    | 'text'
    | 'tool'
    | 'tool-result'
    | 'visual-updated'
    /** Business expert mode progress — content is an `ExpertStatus`. */
    | 'expert-status'
    | 'done';
  content?: string;
  session?: SessionDoc;
};

/** Progress of business expert mode's extra passes, streamed as `expert-status`. */
export type ExpertStatus = 'cross-check' | 'explaining' | 'failed';

/** What a block rating returns: the session plus any lessons its note taught. */
export interface BlockFeedbackResult {
  session: SessionDoc;
  /** Present when the rating's comment changed and was learned from (may be empty). */
  lessons?: LearnedLesson[];
}

/**
 * One turn's answer-pinning state, computed before the model runs: which
 * lineage the question belongs to, the fingerprint of the context the turn
 * was given, and the pin already saved at that lineage (if any). Absent on a
 * turn that is not pinnable (`pin: false`, an open visual, an answer to a
 * clarification) or whose key could not be computed.
 */
interface TurnPin {
  lineageKey: string;
  question: string;
  /** Normalised prior user messages, oldest first. */
  chain: string[];
  mode: PinMode;
  fingerprint: string;
  fingerprintParts: FingerprintParts;
  datasourceId?: string;
  existing?: AnswerPinDoc;
}

/** Everything a turn's grounding (and so its fingerprint) is built from. */
interface GroundingSources {
  datasets: DatasetDoc[];
  view: ModelPartView;
  verified?: string;
  metrics?: string;
  knowledge: { block: string; used: KnowledgeUse[] };
}

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
    private readonly metrics: MetricsService,
    private readonly knowledge: KnowledgeService,
    private readonly expertMode: ExpertModeService,
    private readonly pins: AnswerPinsService,
    private readonly learning: LearningService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Install the DI bridge the Mastra tools use (they load with no Nest DI).
    setDatasetToolServices({
      getDatasets: (names) => this.boundDatasets(names),
      sampleRows: (datasourceId, entity, limit) =>
        this.datasourcesService.sampleRows(datasourceId, entity, limit),
      runReadOnlySql: (datasourceId, sql, limit, datasets) =>
        this.runSqlWithRepair(datasourceId, sql, limit, datasets),
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
    const {
      datasets,
      view: { reasoningEffort },
      verified,
      metrics,
      knowledge,
    } = await this.groundingSources(session, question);
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
    // Threaded on requestContext rather than returned alongside the options,
    // because the options object is spread straight into the agent call.
    requestContext.set(KNOWLEDGE_USED_CONTEXT_KEY, knowledge.used);
    if (metrics) requestContext.set(METRICS_BLOCK_CONTEXT_KEY, metrics);
    if (verified) requestContext.set(VERIFIED_BLOCK_CONTEXT_KEY, verified);
    return {
      // Analysis often chains several schema + SQL tool calls per turn.
      maxSteps: ASSISTANT_MAX_STEPS,
      // The user-configured reasoning effort (Low/Medium/High chip).
      providerOptions: await this.providerOptions({ reasoningEffort }),
      context: [
        {
          role: 'system' as const,
          content: [
            ...entityOrientationLines(session.datasets, datasets),
            '',
            'Interactive visuals in this session (id — title, current version):',
            ...(visualLines.length ? visualLines : ['(none yet)']),
            activeVisualId
              ? `Visual currently open in the right panel: ${activeVisualId}.`
              : 'No visual is open in the right panel.',
          ].join('\n'),
        },
        ...(metrics ? [{ role: 'system' as const, content: metrics }] : []),
        ...(knowledge.block
          ? [{ role: 'system' as const, content: knowledge.block }]
          : []),
        ...(verified ? [{ role: 'system' as const, content: verified }] : []),
      ],
      requestContext,
      abortSignal,
    };
  }

  /**
   * The inputs every turn's grounding is built from — and therefore what an
   * answer pin's fingerprint hashes. One function for both, so the context a
   * turn is given and the fingerprint the feedback path recomputes later can
   * never be built two different ways.
   */
  private async groundingSources(
    session: SessionDoc,
    question?: string,
  ): Promise<GroundingSources> {
    const datasets = await this.boundDatasets(session.datasets);
    const view = await this.llmService.getView();
    const verified = question
      ? await this.verifiedQueries.referenceBlock(question)
      : undefined;
    // Curated semantics for the entities this session can see — the one
    // definition of each business number, never re-derived per turn.
    const metrics = await this.metrics.definitionBlock(
      datasets.flatMap((s) => s.tables ?? []),
    );
    // Curated, user-authored knowledge (glossary/instructions/default
    // filters) for this session's datasets — authoritative over anything
    // the model would otherwise infer from schema alone.
    const knowledge = await this.knowledge.contextFor(session.datasets);
    return { datasets, view, verified, metrics, knowledge };
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
    answer?: string,
  ): Promise<CrossCheck | undefined> {
    // The query the answer actually quotes — a supporting count that ran
    // after it must not be the one an independent derivation is compared to.
    const record = pickAnswerRecord(data, answer);
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
      // answer needs, so equal facts routinely arrive at different widths —
      // and a top-1 from the verifier against the answer's full ranking (or
      // the reverse) is the same fact at a different row count.
      const { match, reason, shapeDiffers } = compareResults(
        record.rows ?? [],
        result.rows,
        { widthTolerant: true, leadingRows: true },
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
        knowledge?: string;
        metrics?: string;
      }
    | undefined
  > {
    const datasets = await this.boundDatasets(session.datasets);
    const datasourceId =
      (await this.soleDatasourceId(session)) ??
      datasets.find((s) => s.datasourceId)?.datasourceId;
    if (!datasourceId) return undefined;
    const inScope = datasets.filter((s) => s.datasourceId === datasourceId);
    // The second opinion works under the same business rules as the answer:
    // the curated knowledge (default filters, term definitions) and the
    // governed metrics. Independence means never seeing the answer's SQL,
    // not re-deriving without the semantic layer — a verifier that ignores
    // "employees only" or "convert to USD" disagrees with every correct
    // answer that applied them, which turns the cross-check into a measure
    // of whether the knowledge was followed, inverted.
    const [knowledge, metrics] = await Promise.all([
      this.knowledge
        .contextFor(session.datasets)
        .then((k) => k.block || undefined)
        .catch(() => undefined),
      this.metrics
        .definitionBlock(inScope.flatMap((s) => s.tables ?? []))
        .catch(() => undefined),
    ]);
    return {
      dialect: sqlDialectOf(inScope),
      datasourceId,
      schema: schemaSnapshotBlock(inScope, {
        budgetChars: VERIFIER_SCHEMA_CHARS,
        sampleValues: VERIFIER_SAMPLE_VALUES,
      }),
      ...(knowledge ? { knowledge } : {}),
      ...(metrics ? { metrics } : {}),
    };
  }

  /**
   * One verifier pass. It gets the question, the schema with sample values,
   * the curated knowledge and metric definitions the answer worked under, and
   * the user-approved reference pairs — deliberately not the original SQL.
   */
  private async deriveIndependentSql(
    question: string,
    context: {
      dialect: string;
      schema: string;
      knowledge?: string;
      metrics?: string;
    },
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
          ...(context.knowledge
            ? [
                '',
                '<curated-knowledge>',
                context.knowledge,
                '</curated-knowledge>',
              ]
            : []),
          ...(context.metrics
            ? [
                '',
                '<metric-definitions>',
                context.metrics,
                '</metric-definitions>',
              ]
            : []),
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
      // A replayed answer never reached the agent, so memory has neither its
      // question nor its answer: catch up every contiguous replayed exchange
      // right before this message, oldest first, on the next real turn.
      const replayed = replayedExchanges(session.messages);
      // A clarification ends its turn before memory sees the question, so
      // replay it alongside the user's answer.
      if (previous?.role === 'assistant' && previous.clarification) {
        return [
          ...replayed,
          { role: 'assistant' as const, content: previous.content },
          { role: 'user' as const, content: latest.content },
        ];
      }
      if (replayed.length) {
        return [
          ...replayed,
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
   * carries the verdict.
   *
   * `expert` (business expert mode) runs the same cross-check and then one
   * explainer pass that attaches a `ReasoningTrace` to the answer, streaming
   * `expert-status` events while it works. The explanation never blocks the
   * answer: when it cannot be built the turn emits `expert-status: failed`
   * and saves the answer without a trace.
   *
   * `pin` turns on answer pinning (`modules/answer-pins`): a question whose
   * lineage already has a pin derived under the same fingerprint is answered
   * by re-running the pinned SQL — identical live rows replay the stored
   * answer with zero model calls — and an eligible fresh answer is saved as
   * the lineage's pin (keeping the old wording when its rows did not move).
   * Off by default here so the eval harness keeps measuring the raw engine;
   * the HTTP controller turns it on. Pinning never breaks a turn: any error
   * in it is logged and the turn derives normally.
   */
  async streamMessage(
    id: string,
    content: string,
    emit: (event: StreamEvent) => void,
    abortSignal?: AbortSignal,
    activeVisualId?: string,
    careful = false,
    expert = false,
    pin = false,
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
    // Expert mode is review mode: a missing business definition is answered
    // under a stated convention for the reviewer to correct, not asked about.
    if (expert) {
      options.context.push({ role: 'system', content: REVIEW_MODE_CONTEXT });
    }
    // Answer pinning: key the question and look up its pin from the context
    // just built — no model call has happened yet, so a replay costs nothing.
    const mode: PinMode = expert ? 'expert' : careful ? 'careful' : 'plain';
    const pinning =
      pin && !activeVisualId && !answersClarification(session.messages)
        ? await this.preparePin(session, mode, options.requestContext)
        : undefined;
    if (
      pinning &&
      (await this.replayPin(session, pinning, turn.signal, emit))
    ) {
      abortSignal?.removeEventListener('abort', forwardAbort);
      return;
    }
    const stream = await agent.stream(input, options);

    let text = '';
    let clarification: ChatMessage['clarification'] | null = null;
    let visualEvent: VisualEvent | undefined;
    const pendingCalls = new Map<string, Record<string, unknown>>();
    // Statements the SQL fixer had to repair before they ran — the expert
    // trace's execution signal counts a repair against the final query.
    const repairedSql: string[] = [];
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
          const corrected = (payload.result as { correctedSql?: unknown })
            ?.correctedSql;
          if (typeof corrected === 'string') repairedSql.push(corrected);
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

    // What the turn cost, read once, before the answer is written. Kept on the
    // message so a cost log never has to re-derive it — see `ChatMessage.usage`.
    const usage = await readTurnUsage(stream);

    // Visual tools persist metadata mid-turn; reload so this write keeps it.
    const fresh = await this.get(id);
    const messages = fresh.messages;
    const entities = sourceEntities(data);
    const reasoning = reasoningTrail(data);
    const knowledge = knowledgeUsed(options.requestContext);
    // Set when this turn's answer becomes its lineage's pin, saved once the
    // transcript is persisted so a pin never points at an unsaved message.
    let pinned:
      | { pinning: TurnPin; record: ToolDataRecord; message: ChatMessage }
      | undefined;
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
        ...(usage ? { usage } : {}),
      });
    } else if (text.trim() || visualEvent) {
      const interpretation = interpretationLine(data, entities);
      // Careful and expert mode only, and only when there is a result set to
      // corroborate.
      let crossChecked: CrossCheck | undefined;
      if ((careful || expert) && !turn.signal.aborted) {
        if (expert && lastSuccessfulSql(data)) {
          emit({ type: 'expert-status', content: 'cross-check' });
        }
        crossChecked = await this.crossCheckAnswer(
          session,
          trimmed,
          data,
          text,
        );
      }
      const verified = await this.matchesVerifiedQuery(session, data);
      const answer =
        text.trim() ||
        `${visualEvent!.action === 'created' ? 'Created' : 'Updated'} interactive visual "${visualEvent!.title}" (v${visualEvent!.version}).`;
      const expertTrace =
        expert && !turn.signal.aborted
          ? await this.explainAnswer(
              {
                sessionId: id,
                question: trimmed,
                answer,
                data,
                knowledgeUsed: knowledge ?? [],
                metricsBlock: contextString(
                  options.requestContext,
                  METRICS_BLOCK_CONTEXT_KEY,
                ),
                verifiedBlock: contextString(
                  options.requestContext,
                  VERIFIED_BLOCK_CONTEXT_KEY,
                ),
                verified,
                crossCheck: crossChecked,
                repairedSql,
                abortSignal: turn.signal,
              },
              session,
              emit,
            )
          : undefined;
      // The query behind the answer, when this turn may become its lineage's
      // pin. An expert pin must carry its trace — an expert ask only ever
      // replays an expert answer, trace included.
      const record = pickAnswerRecord(data, answer);
      const pinRecord =
        pinning &&
        !turn.signal.aborted &&
        (mode !== 'expert' || expertTrace) &&
        pinEligible({
          record,
          visualEvent,
          activeVisualId,
          text,
          datasourceId: pinning.datasourceId,
        })
          ? record
          : undefined;
      const stabilised =
        pinning?.existing && pinRecord
          ? stabilise(pinning.existing, pinRecord, knowledge ?? [])
          : undefined;
      if (stabilised?.reproducesRejected) {
        // The engine re-derived the very numbers the reviewer rejected. No
        // continuity is claimed — the answer is saved as a fresh pin — but
        // it is worth a look: the note did not change the result.
        this.logger.warn(
          'Fresh derivation reproduced the rows of a rejected answer pin',
        );
      }
      const message: ChatMessage = {
        role: 'assistant',
        // `kept`: the numbers held, so the wording the lineage already
        // showed is kept — only the content is swapped, everything else is
        // this turn's fresh derivation.
        content: stabilised?.content ?? answer,
        at: new Date().toISOString(),
        ...(data.length ? { data } : {}),
        ...(entities.length ? { entities } : {}),
        ...(interpretation ? { interpretation } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(knowledge ? { knowledge } : {}),
        ...(verified ? { verified: true } : {}),
        ...(visualEvent ? { visual: visualEvent } : {}),
        ...(crossChecked ? { crossCheck: crossChecked } : {}),
        ...(usage ? { usage } : {}),
        ...(expertTrace ? { expertTrace } : {}),
        ...(stabilised?.consistency
          ? { consistency: stabilised.consistency }
          : {}),
      };
      messages.push(message);
      if (pinning && pinRecord) {
        pinned = { pinning, record: pinRecord, message };
      }
    }
    const updated = await this.repository.update(id, { messages });
    if (pinned) {
      await this.savePin(
        session,
        pinned.pinning,
        pinned.record,
        pinned.message,
      );
    }
    if (!turn.signal.aborted || clarification) {
      emit({ type: 'done', session: updated ?? fresh });
    }
  }

  // ------------------------------------------------------- answer pinning

  /**
   * Key this turn's question (lineage) and fingerprint the context it was
   * just given, then look up the lineage's pin. The knowledge, metrics and
   * verified blocks are read back off the turn's own requestContext — the
   * exact context the model is about to receive; datasets and model settings
   * are the same reads `groundingSources` made. `undefined` (pinning off for
   * this turn) when anything fails: a turn is never broken by its pin.
   */
  private async preparePin(
    session: SessionDoc,
    mode: PinMode,
    requestContext: { get(key: string): unknown },
  ): Promise<TurnPin | undefined> {
    try {
      const lineage = turnLineage(
        session.messages,
        session.messages.length - 1,
        session.datasets,
        mode,
      );
      if (!lineage) return undefined;
      const datasets = await this.boundDatasets(session.datasets);
      const view = await this.llmService.getView();
      const used = requestContext.get(KNOWLEDGE_USED_CONTEXT_KEY);
      const { fingerprint, parts } = pinFingerprint({
        used: Array.isArray(used) ? (used as KnowledgeUse[]) : [],
        metrics: contextString(requestContext, METRICS_BLOCK_CONTEXT_KEY),
        verified: contextString(requestContext, VERIFIED_BLOCK_CONTEXT_KEY),
        datasets,
        view,
      });
      const existing = await this.pins.lookup(lineage.lineageKey);
      return {
        ...lineage,
        mode,
        fingerprint,
        fingerprintParts: parts,
        datasourceId: soleDatasourceOf(datasets),
        ...(existing ? { existing } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `Answer pin lookup failed; answering without pinning: ${errorText(error)}`,
      );
      return undefined;
    }
  }

  /**
   * Replay: the lineage's pin was derived under this exact fingerprint on
   * this datasource, and re-running its SQL now returns the same rows — so
   * the stored answer is still the answer. Persists it as this turn's reply
   * (one `text` event, then `done`) with zero model calls. `false` whenever
   * any of that does not hold, or the re-run fails: the turn then derives a
   * fresh answer as usual.
   */
  private async replayPin(
    session: SessionDoc,
    pinning: TurnPin,
    signal: AbortSignal,
    emit: (event: StreamEvent) => void,
  ): Promise<boolean> {
    const pin = pinning.existing;
    if (
      !pin ||
      // A reviewer rejected this answer: never hand it out again.
      pin.rejectedAt ||
      pin.fingerprint !== pinning.fingerprint ||
      !pinning.datasourceId ||
      pin.datasourceId !== pinning.datasourceId
    ) {
      return false;
    }
    try {
      const live = await this.datasourcesService.runReadOnlySql(
        pin.datasourceId,
        pin.sql,
        Math.max(pin.rowCount + 1, pin.rowLimit),
      );
      const rows = live.rows ?? [];
      if (
        rows.length !== pin.rows.length ||
        !compareResults(pin.rows, rows).match
      ) {
        this.logger.log(
          'Answer pin not replayed: its query returns different rows now',
        );
        return false;
      }
    } catch (error) {
      this.logger.warn(`Answer pin replay failed: ${errorText(error)}`);
      return false;
    }
    // Stopped while the query re-ran: nothing to answer, nothing to derive.
    if (signal.aborted) return true;
    const now = new Date().toISOString();
    const message: ChatMessage = {
      ...pin.message,
      at: now,
      consistency: {
        kind: 'replay',
        pinnedAt: pin.sourceMessageAt,
        sourceSessionId: pin.sourceSessionId,
        verifiedAt: now,
      },
    };
    emit({ type: 'text', content: message.content });
    const fresh = await this.get(session.id);
    const messages = [...fresh.messages, message];
    const updated = await this.repository.update(session.id, { messages });
    try {
      await this.pins.touchReplay(pin.lineageKey, now);
    } catch (error) {
      this.logger.warn(`Answer pin replay count failed: ${errorText(error)}`);
    }
    emit({ type: 'done', session: updated ?? { ...fresh, messages } });
    return true;
  }

  /** Save `message` as its lineage's pin — full replace. Never throws. */
  private async savePin(
    session: SessionDoc,
    pinning: TurnPin,
    record: ToolDataRecord,
    message: ChatMessage,
  ): Promise<void> {
    try {
      const rows = record.rows ?? [];
      await this.pins.save({
        id: randomUUID(),
        lineageKey: pinning.lineageKey,
        fingerprint: pinning.fingerprint,
        fingerprintParts: pinning.fingerprintParts,
        question: pinning.question,
        normalizedQuestion: normalizeQuestion(pinning.question),
        datasets: [...session.datasets],
        chain: pinning.chain,
        mode: pinning.mode,
        datasourceId: pinning.datasourceId as string,
        sql: record.input as string,
        columns: record.columns ?? Object.keys(rows[0] ?? {}),
        rows,
        rowCount: record.rowCount ?? rows.length,
        // A replay re-runs the SQL with `max(rowCount + 1, rowLimit)`, so a
        // result that grew past the pinned rows shows up as a difference
        // rather than a clipped match.
        rowLimit: DEFAULT_SQL_ROW_LIMIT,
        message: stripForPin(message),
        knowledgeIds: (message.knowledge ?? []).map((k) => k.id),
        sourceSessionId: session.id,
        sourceMessageAt: message.at,
        replays: 0,
      });
    } catch (error) {
      this.logger.warn(`Answer pin save failed: ${errorText(error)}`);
    }
  }

  /**
   * The lineage of the answer at `index`: the user message it answered, the
   * user messages before that, and the mode read off the answer itself
   * (a trace → expert, a cross-check → careful). Same key `streamMessage`
   * computed for the turn — `turnLineage` builds both.
   */
  private lineageFor(session: SessionDoc, index: number) {
    const questionIndex = session.messages
      .slice(0, index)
      .map((m) => m.role)
      .lastIndexOf('user');
    if (questionIndex < 0) return undefined;
    return turnLineage(
      session.messages,
      questionIndex,
      session.datasets,
      messageMode(session.messages[index]),
    );
  }

  /**
   * The fingerprint a turn asking `question` in this session would get right
   * now — the same `groundingSources` the turn's context is built from, so a
   * pin approved from the feedback path matches the next turn's key.
   */
  private async fingerprintFor(
    session: SessionDoc,
    question: string,
  ): Promise<{ fingerprint: string; parts: FingerprintParts }> {
    const sources = await this.groundingSources(session, question);
    return pinFingerprint({
      used: sources.knowledge.used,
      metrics: sources.metrics,
      verified: sources.verified,
      datasets: sources.datasets,
      view: sources.view,
    });
  }

  /**
   * A 👎 anywhere on an answer (`block` names the rated reasoning block):
   * its lineage's pin is marked rejected — never replayed, its wording never
   * reused — but not deleted, so the next fresh derivation can still report
   * what changed since it (`updated` + the lessons learned).
   */
  private async rejectPin(
    session: SessionDoc,
    index: number,
    block?: ReasoningBlockKind,
  ): Promise<void> {
    try {
      const lineage = this.lineageFor(session, index);
      if (!lineage) return;
      await this.pins.reject(
        lineage.lineageKey,
        new Date().toISOString(),
        block ? { block } : undefined,
      );
    } catch (error) {
      this.logger.warn(`Answer pin rejection failed: ${errorText(error)}`);
    }
  }

  /**
   * A 👍 on an answer: promote its question → SQL pair into the verified
   * library, badge it, rescore its trace as verified, and — when the rated
   * answer is its lineage's pin — approve the pin under the fingerprint the
   * next ask will compute (the verified block for this question just
   * changed). Mutates `messages[index]`.
   */
  private async approveAnswer(
    session: SessionDoc,
    messages: ChatMessage[],
    index: number,
  ): Promise<void> {
    const answer = messages[index];
    const sql = lastSuccessfulSql(answer.data);
    const question = messages
      .slice(0, index)
      .reverse()
      .find((m) => m.role === 'user');
    if (!sql || !question?.content.trim()) return;
    await this.verifiedQueries.save({
      question: question.content,
      sql,
      datasourceId: await this.soleDatasourceId(session),
      entities: answer.entities ?? [],
      sourceSessionId: session.id,
      sourceMessageAt: answer.at,
    });
    if (answer.expertTrace) {
      messages[index] = {
        ...answer,
        expertTrace: withVerifiedMatch(answer.expertTrace),
      };
    }
    try {
      const lineage = this.lineageFor(session, index);
      if (!lineage) return;
      const pin = await this.pins.lookup(lineage.lineageKey);
      // Only the answer the pin actually holds is approved — a 👍 on an
      // older answer of the same lineage must not vouch for a newer one.
      if (!pin || pin.message.content !== answer.content) return;
      const { fingerprint, parts } = await this.fingerprintFor(
        session,
        lineage.question,
      );
      await this.pins.approve(lineage.lineageKey, {
        fingerprint,
        fingerprintParts: parts,
        message: {
          ...pin.message,
          verified: true,
          ...(pin.message.expertTrace
            ? { expertTrace: withVerifiedMatch(pin.message.expertTrace) }
            : {}),
        },
      });
    } catch (error) {
      this.logger.warn(`Answer pin approval failed: ${errorText(error)}`);
    }
  }

  /**
   * Business expert mode's explainer pass over a finished answer. Never
   * throws and never blocks the answer: a trace that cannot be built is
   * reported as `expert-status: failed` and the answer is saved without one.
   */
  private async explainAnswer(
    input: Omit<TraceInput, 'entities'>,
    session: SessionDoc,
    emit: (event: StreamEvent) => void,
  ): Promise<ReasoningTrace | undefined> {
    emit({ type: 'expert-status', content: 'explaining' });
    let trace: ReasoningTrace | undefined;
    try {
      const datasets = await this.boundDatasets(session.datasets);
      trace = await this.expertMode.buildTrace({
        ...input,
        entities: boundEntities(datasets),
      });
    } catch (error) {
      if (!input.abortSignal?.aborted) {
        this.logger.warn(
          `Reasoning trace failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (!trace && !input.abortSignal?.aborted) {
      emit({ type: 'expert-status', content: 'failed' });
    }
    return trace;
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
   *
   * Answer pinning follows the rating: 👍 approves the lineage's pin (re-keyed
   * under the new verified block, `verified: true`, trace rescored with the
   * verified match, any rejection lifted) and 👎 marks it rejected, so a
   * rejected answer is never replayed.
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
      await this.rejectPin(session, index);
    } else {
      await this.approveAnswer(session, messages, index);
    }
    const updated = await this.repository.update(id, { messages });
    return updated ?? { ...session, messages };
  }

  /**
   * Rate one block of an answer's reasoning trace (business expert mode):
   * thumbs up/down and/or a comment, PATCH semantics (`vote: null` clears the
   * vote). The rating is stored in the `reasoning_feedback` collection — with
   * the question and a snapshot of the rated block, for the improvement loop —
   * and mirrored onto the message so the transcript renders it.
   *
   * Then the rating acts: a 👎 marks the lineage's pin rejected and withdraws
   * the answer's verified query and badge; a 👍 on the SQL block approves the
   * answer exactly like a whole-answer 👍. Last, a comment that changed is
   * learned from — distilled into standing knowledge lessons returned with
   * the session — and a cleared comment forgets what it taught. Learning runs
   * after the vote so an approved pin is keyed without the new lessons, and
   * the next ask re-derives under them.
   */
  async recordBlockFeedback(
    id: string,
    body: BlockFeedbackDto,
  ): Promise<BlockFeedbackResult> {
    const { messageAt, block, patch } = validateBlockFeedback(body);
    const session = await this.get(id);
    const index = session.messages.findIndex(
      (m) => m.role === 'assistant' && m.at === messageAt,
    );
    if (index < 0) {
      throw new NotFoundException(`No assistant message at ${messageAt}`);
    }
    const answer = session.messages[index];
    const trace = answer.expertTrace;
    if (!trace) {
      throw new BadRequestException('This answer has no reasoning trace');
    }
    const snapshot = trace.blocks.find((b) => b.kind === block);
    if (!snapshot) {
      throw new BadRequestException(
        `This reasoning trace has no ${block} block`,
      );
    }
    const question = session.messages
      .slice(0, index)
      .reverse()
      .find((m) => m.role === 'user');
    // The mirror is written from the saved feedback doc on every rating, so
    // it holds the comment as stored before this write.
    const previousComment = trace.feedback?.[block]?.comment?.trim() ?? '';
    const saved = await this.expertMode.saveFeedback(
      { sessionId: id, messageAt, block },
      {
        traceId: trace.id,
        question: question?.content ?? '',
        blockSnapshot: snapshot,
      },
      patch,
    );
    const mirrored: BlockFeedback = {
      ...(saved.vote ? { vote: saved.vote } : {}),
      ...(saved.comment ? { comment: saved.comment } : {}),
      at: saved.updatedAt ?? new Date().toISOString(),
    };
    const feedback = { ...(trace.feedback ?? {}) };
    // A rating cleared of both vote and comment leaves nothing to render.
    if (mirrored.vote || mirrored.comment) feedback[block] = mirrored;
    else delete feedback[block];
    const messages = [...session.messages];
    messages[index] = { ...answer, expertTrace: { ...trace, feedback } };

    if (patch.vote === 'down') {
      await this.verifiedQueries.removeForMessage(id, messageAt);
      const rejected: ChatMessage = { ...messages[index] };
      delete rejected.verified;
      messages[index] = rejected;
      await this.rejectPin(session, index, block);
    } else if (patch.vote === 'up' && block === 'sql') {
      messages[index] = { ...messages[index], verified: true };
      await this.approveAnswer(session, messages, index);
    }

    const comment = saved.comment?.trim() ?? '';
    let lessons: LearnedLesson[] | undefined;
    if (comment && comment !== previousComment) {
      lessons = await this.learnFromComment(session, index, {
        feedbackId: saved.id,
        block,
        vote: saved.vote,
        comment,
        blockSnapshot: snapshot,
        question: question?.content ?? '',
      });
    } else if (!comment && previousComment) {
      try {
        await this.learning.forget(saved.id);
      } catch (error) {
        this.logger.warn(
          `Forgetting learned lessons failed: ${errorText(error)}`,
        );
      }
    }

    const updated = await this.repository.update(id, { messages });
    return {
      session: updated ?? { ...session, messages },
      ...(lessons ? { lessons } : {}),
    };
  }

  /**
   * Distil one reviewer note into standing knowledge lessons. The learner
   * sees the same schema snapshot the expert trace was built against and the
   * titles already on file for these datasets. A failure is logged and
   * yields no lessons — the rating itself is already saved.
   */
  private async learnFromComment(
    session: SessionDoc,
    index: number,
    note: {
      feedbackId: string;
      block: ReasoningBlockKind;
      vote?: BlockVote;
      comment: string;
      blockSnapshot: ReasoningBlock;
      question: string;
    },
  ): Promise<LearnedLesson[] | undefined> {
    const answer = session.messages[index];
    try {
      const datasets = await this.boundDatasets(session.datasets);
      // `list({ datasetId })` covers that dataset's snippets plus the global ones.
      const queries: KnowledgeQuery[] = session.datasets.length
        ? session.datasets.map((datasetId) => ({ datasetId }))
        : [{}];
      const known = await Promise.all(
        queries.map((query) => this.knowledge.list(query)),
      );
      const existingTitles = Array.from(
        new Set(known.flat().map((snippet) => snippet.title)),
      );
      const result = await this.learning.learnFromComment({
        sessionId: session.id,
        messageAt: answer.at,
        feedbackId: note.feedbackId,
        datasets: session.datasets,
        question: note.question,
        answer: answer.content,
        block: note.block,
        ...(note.vote ? { vote: note.vote } : {}),
        comment: note.comment,
        blockSnapshot: note.blockSnapshot,
        finalSql: pickAnswerRecord(answer.data, answer.content)?.input,
        entities: boundEntities(datasets),
        existingTitles,
      });
      return result.lessons;
    } catch (error) {
      this.logger.warn(`Learning from feedback failed: ${errorText(error)}`);
      return undefined;
    }
  }

  /** The session's datasource when it is unambiguous — provenance only. */
  private async soleDatasourceId(
    session: SessionDoc,
  ): Promise<string | undefined> {
    return soleDatasourceOf(await this.boundDatasets(session.datasets));
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

/** A string value off a requestContext, or undefined. */
function contextString(
  requestContext: { get(key: string): unknown } | undefined,
  key: string,
): string | undefined {
  const value = requestContext?.get(key);
  return typeof value === 'string' && value ? value : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The datasource every bound dataset shares, when there is exactly one. */
function soleDatasourceOf(
  datasets: { datasourceId?: string }[],
): string | undefined {
  const ids = new Set(
    datasets.map((s) => s.datasourceId).filter((id): id is string => !!id),
  );
  return ids.size === 1 ? Array.from(ids)[0] : undefined;
}

/**
 * Does the latest user message answer a pending clarification? Such a turn
 * is never pinned or replayed: its meaning lives in the card before it.
 */
function answersClarification(messages: ChatMessage[]): boolean {
  const previous = messages.at(-2);
  return (
    messages.at(-1)?.role === 'user' &&
    previous?.role === 'assistant' &&
    !!previous.clarification
  );
}

/** Which pin mode an answer was produced in, read off what it carries. */
function messageMode(message: ChatMessage | undefined): PinMode {
  if (message?.expertTrace) return 'expert';
  if (message?.crossCheck) return 'careful';
  return 'plain';
}

/**
 * The lineage of the user message at `questionIndex`: the question, every
 * user message before it (the chain), the session's datasets and the mode.
 * The one place a lineage key is built — the chat turn and the feedback
 * path both call it, so they can never key the same answer differently.
 */
function turnLineage(
  messages: ChatMessage[],
  questionIndex: number,
  datasets: string[],
  mode: PinMode,
): { lineageKey: string; question: string; chain: string[] } | undefined {
  const asked = messages[questionIndex];
  if (asked?.role !== 'user' || !asked.content.trim()) return undefined;
  const prior = messages
    .slice(0, questionIndex)
    .filter((m) => m.role === 'user')
    .map((m) => m.content);
  return {
    lineageKey: lineageKeyFor({
      question: asked.content,
      datasets,
      chain: prior,
      mode,
    }),
    question: asked.content,
    chain: prior.map(normalizeQuestion),
  };
}

/** The fingerprint of a turn's context, from the sources it was built of. */
function pinFingerprint(sources: {
  used: KnowledgeUse[];
  metrics?: string;
  verified?: string;
  datasets: SchemaDataset[];
  view: ModelPartView;
}): { fingerprint: string; parts: FingerprintParts } {
  const parts: FingerprintParts = {
    v: 1,
    knowledge: knowledgePart(sources.used),
    metrics: textPart(sources.metrics || undefined),
    verified: textPart(sources.verified || undefined),
    schema: schemaPart(sources.datasets),
    model: modelPart(sources.view),
  };
  return { fingerprint: fingerprintFor(parts), parts };
}

/**
 * The stabiliser, for a fresh derivation of a lineage that already has a pin
 * (its fingerprint moved, its data changed, or a reviewer rejected it): the
 * same rows keep the pinned wording (`kept`); different rows are an
 * `updated` answer, listing the feedback lessons the turn was given that the
 * pin was not. A rejected pin's wording is never kept: the same rows then
 * claim nothing at all (`reproducesRejected`, no consistency).
 */
function stabilise(
  pin: AnswerPinDoc,
  record: ToolDataRecord,
  used: KnowledgeUse[],
): {
  content?: string;
  consistency?: AnswerConsistency;
  reproducesRejected?: true;
} {
  const rows = record.rows ?? [];
  const base = {
    pinnedAt: pin.sourceMessageAt,
    sourceSessionId: pin.sourceSessionId,
  };
  if (rows.length === pin.rows.length && compareResults(pin.rows, rows).match) {
    if (pin.rejectedAt) return { reproducesRejected: true };
    return {
      content: pin.message.content,
      consistency: { kind: 'kept', ...base },
    };
  }
  const known = new Set(pin.knowledgeIds ?? []);
  const lessons = Array.from(
    new Set(
      used
        .filter((k) => k.source === 'feedback' && !known.has(k.id))
        .map((k) => k.title),
    ),
  );
  return {
    consistency: {
      kind: 'updated',
      ...base,
      ...(lessons.length ? { lessons } : {}),
    },
  };
}

/** One turn of a caught-up exchange, as the agent's input takes it. */
type ExchangeMessage =
  { role: 'user'; content: string } | { role: 'assistant'; content: string };

/**
 * The contiguous replayed exchanges right before the latest message, oldest
 * first: (user, assistant-replay) pairs walked back from the end until the
 * first assistant message that is not a replay. A replay never ran the
 * agent, so memory holds none of these — the next real turn catches up.
 */
function replayedExchanges(messages: ChatMessage[]): ExchangeMessage[] {
  const pairs: ExchangeMessage[][] = [];
  for (let i = messages.length - 2; i >= 1; i -= 2) {
    const answer = messages[i];
    const asked = messages[i - 1];
    if (
      answer.role !== 'assistant' ||
      answer.consistency?.kind !== 'replay' ||
      asked.role !== 'user'
    ) {
      break;
    }
    pairs.unshift([
      { role: 'user', content: asked.content },
      { role: 'assistant', content: answer.content },
    ]);
  }
  return pairs.flat();
}

/**
 * Every entity the session's datasets expose, deduplicated by key. A table
 * listed without a schema snapshot is kept with no columns, so it still
 * counts as bound when the expert trace checks the SQL against it.
 */
function boundEntities(
  datasets: {
    tables?: string[];
    entities?: { key: string; columns: DatasetColumnSnapshot[] }[];
  }[],
): { key: string; columns: DatasetColumnSnapshot[] }[] {
  const byKey = new Map<
    string,
    { key: string; columns: DatasetColumnSnapshot[] }
  >();
  for (const dataset of datasets) {
    for (const entity of dataset.entities ?? []) {
      if (entity?.key && !byKey.has(entity.key)) {
        byKey.set(entity.key, {
          key: entity.key,
          columns: entity.columns ?? [],
        });
      }
    }
    for (const key of dataset.tables ?? []) {
      if (key && !byKey.has(key)) byKey.set(key, { key, columns: [] });
    }
  }
  return Array.from(byKey.values());
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
