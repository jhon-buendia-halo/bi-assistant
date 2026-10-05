import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { RequestContext } from '@mastra/core/request-context';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';
import { MastraService } from '../../mastra/mastra.service';
import { setDatasetToolServices } from '../../mastra/tool-services';
import type {
  DatasetColumnSnapshot,
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
import {
  DatasetsRepository,
  type DatasetDoc,
} from '../datasets/repositories/datasets.repository';
import { DatasourcesService } from '../datasources/datasources.service';
import type { DatasourceKind } from '../datasources/entities/datasource.entity';
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
import { MemoryOutboxService } from '../memory/memory-outbox.service';
import { MemoryBankService } from '../memory/memory-bank.service';
import {
  LEARNING_STORE,
  type LearningStore,
} from '../memory/learning-store.port';
import type { MemorySignal } from '../memory/entities/memory-signal.entity';
import {
  learnedBlock,
  mentalModelsBlock,
  toKnowledgeUse as memoryUses,
} from '../memory/learned-block';
import { clip, redactSqlLiterals, SIGNAL_SQL_CHARS } from '../memory/redact';
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
 * blocks this turn was given — read back by the answer review (it judges the
 * answer against the same definitions the assistant saw rather than a
 * re-read that may differ), by business expert mode (its trace may only cite
 * sources the turn was actually given) and by answer pinning (the
 * fingerprint hashes the exact context the model received).
 */
const METRICS_BLOCK_CONTEXT_KEY = 'metrics-block';
const VERIFIED_BLOCK_CONTEXT_KEY = 'verified-block';
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
 * Learning memory (lever `memory`, ADR-0013): the recall's token budget and
 * the deadline for recall and the mental models — a turn never waits longer
 * on the memory than this, and a late memory is no memory.
 */
const MEMORY_RECALL_TOKENS = 1_200;
// Recall embeds the question through the memory server's provider (a network
// call with OpenAI embeddings), so 800 ms timed out in practice; 2.5 s still
// runs in parallel with the other context blocks (ADR-0013).
const MEMORY_TIMEOUT_MS = 2_500;
/** Longest reviewer note a correction signal carries. */
const SIGNAL_NOTE_CHARS = 1_000;
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
  /** `used` also lists the recalled memories (`source: 'memory'`). */
  knowledge: { block: string; used: KnowledgeUse[] };
  /** "Learned from past sessions" — lever `memory` on, something recalled. */
  learned?: string;
  /** The memory bank's mental models — lever `memory: 'recall+models'`. */
  mentalModels?: string;
}

/** What the learning memory adds to one turn's grounding. */
interface MemoryContext {
  used: KnowledgeUse[];
  learned?: string;
  mentalModels?: string;
}

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
    private readonly expertMode: ExpertModeService,
    private readonly pins: AnswerPinsService,
    private readonly learning: LearningService,
    // Learning memory (ADR-0013). Optional so a service built without
    // `MemoryModule` (most unit tests) behaves as if Hindsight were unset.
    @Optional() private readonly memoryOutbox?: MemoryOutboxService,
    @Optional() private readonly memoryBanks?: MemoryBankService,
    @Optional()
    @Inject(LEARNING_STORE)
    private readonly learningStore?: LearningStore,
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
   * - `memory` (ADR-0013) adds what past sessions taught: the "Learned from
   *   past sessions" block right after the curated Knowledge (before the
   *   verified pairs) and, with `recall+models`, the mental models right
   *   after the orientation block, where they stay cacheable. Never in
   *   `bare`.
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
    const {
      datasets,
      view: { reasoningEffort },
      verified,
      metrics,
      knowledge,
      learned,
      mentalModels,
    } = await this.groundingSources(session, question, levers);
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
    const effort = levers.reasoningEffort ?? reasoningEffort;
    // Threaded on requestContext rather than returned alongside the options,
    // because the options object is spread straight into the agent call.
    requestContext.set(KNOWLEDGE_USED_CONTEXT_KEY, knowledge.used);
    if (metrics) requestContext.set(METRICS_BLOCK_CONTEXT_KEY, metrics);
    if (verified) requestContext.set(VERIFIED_BLOCK_CONTEXT_KEY, verified);
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
    const modelsBlock = mentalModels ? [system(mentalModels)] : [];
    const curatedBlocks = [
      ...(cards ? [system(cards)] : []),
      ...(metrics ? [system(metrics)] : []),
      ...(knowledge.block ? [system(knowledge.block)] : []),
      ...(learned ? [system(learned)] : []),
    ];
    const context = levers.staticFirstContext
      ? [
          system(orientation.join('\n')),
          ...modelsBlock,
          ...curatedBlocks,
          ...(verified ? [system(verified)] : []),
          system(visualsBlock.join('\n')),
        ]
      : [
          system([...orientation, '', ...visualsBlock].join('\n')),
          ...modelsBlock,
          ...curatedBlocks,
          ...(verified ? [system(verified)] : []),
        ];
    return {
      // Analysis often chains several schema + SQL tool calls per turn.
      maxSteps: levers.maxSteps ?? ASSISTANT_MAX_STEPS,
      // The user-configured reasoning effort (Low/Medium/High chip), unless
      // the turn's levers override it; keyed by provider (`LlmService`).
      providerOptions: await this.llmService.providerOptionsFor(effort),
      context,
      ...(activeTools ? { activeTools } : {}),
      requestContext,
      abortSignal,
    };
  }

  /**
   * The inputs every turn's grounding is built from — and therefore what an
   * answer pin's fingerprint hashes. One function for both, so the context a
   * turn is given and the fingerprint the feedback path recomputes later can
   * never be built two different ways.
   *
   * `levers` are the turn's engine levers: `context: 'bare'` withholds every
   * curated block (verified pairs, metrics, knowledge) and the memory, and
   * `rankedKnowledge` orders knowledge and metrics by relevance to
   * `question`. With `memory` on, the recalled memories join `knowledge.used`
   * — so the answer's provenance and its pin fingerprint both cover them.
   *
   * The blocks are independent reads and run in parallel, so the memory's
   * deadline overlaps the rest instead of adding to it.
   */
  private async groundingSources(
    session: SessionDoc,
    question: string | undefined,
    levers: EngineOptions,
  ): Promise<GroundingSources> {
    const curated = levers.context !== 'bare';
    const datasets = await this.boundDatasets(session.datasets);
    const entities = datasets.flatMap((s) => s.tables ?? []);
    const noMemory: MemoryContext = { used: [] };
    const [view, verified, metrics, knowledge, memory] = await Promise.all([
      this.llmService.getView(),
      curated && question
        ? this.verifiedQueries.referenceBlock(question)
        : undefined,
      // Curated semantics for the entities this session can see — the one
      // definition of each business number, never re-derived per turn.
      curated
        ? this.metrics.definitionBlock(entities, {
            question,
            ranked: levers.rankedKnowledge,
          })
        : undefined,
      // Curated, user-authored knowledge (glossary/instructions/default
      // filters, learned lessons) for this session's datasets — authoritative
      // over anything the model would otherwise infer from schema alone.
      curated
        ? this.knowledge.contextFor(session.datasets, {
            question,
            entities,
            ranked: levers.rankedKnowledge,
          })
        : { block: '', used: [] as KnowledgeUse[] },
      curated
        ? this.memoryContext(session, datasets, question, levers)
        : noMemory,
    ]);
    return {
      datasets,
      view,
      verified,
      metrics,
      knowledge: memory.used.length
        ? { block: knowledge.block, used: [...knowledge.used, ...memory.used] }
        : knowledge,
      ...(memory.learned ? { learned: memory.learned } : {}),
      ...(memory.mentalModels ? { mentalModels: memory.mentalModels } : {}),
    };
  }

  /**
   * What the learning memory (lever `memory`, ADR-0013) adds to a turn:
   * memories recalled for `question` — a block plus one `KnowledgeUse`
   * each, `source: 'memory'` — and, with `recall+models`, the bank's mental
   * models. Nothing when the lever is off, Hindsight is not configured or
   * the session spans several datasources (a bank is per datasource).
   * Recall makes no model call and has a deadline; a failure, a timeout or
   * an empty bank all mean "no memory", never a failed turn.
   */
  private async memoryContext(
    session: SessionDoc,
    datasets: DatasetDoc[],
    question: string | undefined,
    levers: EngineOptions,
  ): Promise<MemoryContext> {
    const store = this.learningStore;
    if (levers.memory === 'off' || !store?.enabled) return { used: [] };
    const datasourceId = soleDatasourceOf(datasets);
    if (!datasourceId) return { used: [] };
    // Missions, directives and mental models before the bank's first use:
    // once per process, never throws, never waited on by a turn.
    void this.memoryBanks?.ensureBank(datasourceId);
    const [memories, models] = await Promise.all([
      question
        ? store
            .recall({
              datasourceId,
              datasetIds: session.datasets,
              question,
              maxTokens: MEMORY_RECALL_TOKENS,
              timeoutMs: MEMORY_TIMEOUT_MS,
            })
            .catch(() => [])
        : [],
      levers.memory === 'recall+models'
        ? store.mentalModels(datasourceId, MEMORY_TIMEOUT_MS).catch(() => [])
        : [],
    ]);
    const learned = learnedBlock(memories);
    const mentalModels = mentalModelsBlock(models);
    return {
      used: memoryUses(memories),
      ...(learned ? { learned } : {}),
      ...(mentalModels ? { mentalModels } : {}),
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
            providerOptions: await this.llmService.providerOptionsFor('low'),
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
   * effective reasoning effort; `options.answer` is the answer text, so the
   * check corroborates the query the answer actually quotes;
   * `options.engine` is the turn's levers (the verifier gets the curated
   * context the answer got, none in `bare`); `options.onUsage` receives the
   * verifier call's token counts (the turn's `crossCheck` side pass) when
   * they were reported.
   */
  private async crossCheckAnswer(
    session: SessionDoc,
    question: string,
    data: ToolDataRecord[],
    effort: EngineReasoningEffort,
    options: {
      answer?: string;
      engine?: EngineOptions;
      onUsage?: (usage: TokenUsage) => void;
    } = {},
  ): Promise<CrossCheck | undefined> {
    const { answer, engine, onUsage } = options;
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
      const context = await this.verifierContext(
        session,
        engine ?? (await this.engineSettings.resolved()),
        question,
      );
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

  /**
   * Dialect, datasource and a sample-value bearing schema for the verifier,
   * plus the curated knowledge and governed metrics the answer worked under.
   * `engine` is the checked turn's levers: in the `bare` context arm the
   * answer had no curated block, so neither does its second opinion.
   */
  private async verifierContext(
    session: SessionDoc,
    engine: EngineOptions,
    question: string,
  ): Promise<
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
    // the curated knowledge (default filters, term definitions, learned
    // lessons) and the governed metrics, built with the same levers.
    // Independence means never seeing the answer's SQL, not re-deriving
    // without the semantic layer — a verifier that ignores "employees only"
    // or "convert to USD" disagrees with every correct answer that applied
    // them, which turns the cross-check into a measure of whether the
    // knowledge was followed, inverted.
    const curated = engine.context !== 'bare';
    const [knowledge, metrics] = curated
      ? await Promise.all([
          this.knowledge
            .contextFor(session.datasets, {
              question,
              entities: datasets.flatMap((s) => s.tables ?? []),
              ranked: engine.rankedKnowledge,
            })
            .then((k) => k.block || undefined)
            .catch(() => undefined),
          this.metrics
            .definitionBlock(
              inScope.flatMap((s) => s.tables ?? []),
              {
                question,
                ranked: engine.rankedKnowledge,
              },
            )
            .catch(() => undefined),
        ])
      : [undefined, undefined];
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
    const providerOptions = await this.llmService.providerOptionsFor(effort);
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
   *
   * A chat turn is a user's turn, so it may send learning-memory signals
   * (`memorySignals`); a harness calling `runTurn` directly never does.
   *
   * Everything else is the production turn, `runTurn`.
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
    await this.runTurn(id, content, {
      emit,
      abortSignal,
      activeVisualId,
      engine: careful ? { careful: 'on' } : undefined,
      expert,
      pin,
      memorySignals: true,
    });
  }

  /**
   * The production turn — the one place a question gets answered. Chat
   * (`streamMessage`), the CLI golden-set harness and the in-app eval runner
   * all come through here, so a graded run measures exactly what a user
   * gets (`turn-result.ts` says why that matters).
   *
   * One turn, in order: persist the prompt → answer-pin lookup and replay
   * (`opts.pin` only; a replay ends the turn with zero model calls) →
   * stream the assistant run (tools, repairs, guards) → tool-only synthesis
   * when it ended without prose → the zero-tool grounding guard → the
   * answer review (lever `answerReview`) → careful mode's cross-check
   * (`careful`, `'auto'` on a risky category or a turn whose SQL drew a
   * warning; always in business expert mode) → the expert explainer pass
   * (`opts.expert`) → persist the answer → save its answer pin → `done`.
   * The levers are `opts.engine` over Settings → Engine levers, resolved
   * once and handed to the tools on the requestContext.
   *
   * Answer pinning in evals: `opts.pin` defaults to off, and neither eval
   * harness (the CLI `run-eval` and the in-app runner) turns it on, so a
   * graded turn never replays a pin nor writes one — an eval measures the
   * model and the levers, never a cache (business-expert plan decision 11,
   * the same reason Snowflake strips verified queries before grading).
   * Learning memory likewise: an arm may recall (lever `memory`), but only a
   * turn with `opts.memorySignals` (chat) retains a cross-check
   * disagreement, so an eval run never writes memory (ADR-0013).
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
    const expert = opts.expert === true;
    // Expert mode is review mode: a missing business definition is answered
    // under a stated convention for the reviewer to correct, not asked about.
    if (expert) {
      options.context.push({ role: 'system', content: REVIEW_MODE_CONTEXT });
    }

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
    // Statements the SQL fixer had to repair before they ran — the expert
    // trace's execution signal counts a repair against the final query.
    const repairedSql: string[] = [];
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

    // Answer pinning: key the question and look up its pin from the context
    // just built — no model call has happened yet, so a replay costs nothing.
    const mode = turnPinMode(engine, expert);
    const pinning =
      opts.pin &&
      !opts.activeVisualId &&
      !answersClarification(session.messages)
        ? await this.preparePin(session, mode, options.requestContext, effort)
        : undefined;
    if (pinning) {
      const replay = await this.replayPin(session, pinning, turn.signal, emit);
      if (replay) {
        opts.abortSignal?.removeEventListener('abort', forwardAbort);
        // A replay is a whole turn: the stored answer, no model call, no
        // side pass. `aborted` when the user stopped while the SQL re-ran.
        return turnResult({
          text: replay.message?.content ?? '',
          message: replay.message,
          data: replay.message?.data ?? [],
          calledTools: [],
          sidePassUsage: {},
          engine,
          configHash,
          aborted: !replay.message,
          durationMs: Date.now() - started,
        });
      }
    }

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
    // Set when this turn's answer becomes its lineage's pin, saved once the
    // transcript is persisted so a pin never points at an unsaved message.
    let pinned:
      | { pinning: TurnPin; record: ToolDataRecord; message: ChatMessage }
      | undefined;
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
      // Careful mode (lever `careful`) and business expert mode, and only
      // when there is a result set to corroborate.
      if (
        !turn.signal.aborted &&
        !providerFailed &&
        (expert || crossCheckWanted(engine, opts.category, data))
      ) {
        if (expert && lastSuccessfulSql(data)) {
          emit({ type: 'expert-status', content: 'cross-check' });
        }
        crossChecked = await this.crossCheckAnswer(
          session,
          trimmed,
          data,
          effort,
          {
            answer: text,
            engine,
            onUsage: (observed) => bill('crossCheck', observed),
          },
        );
      }
      const verified =
        !providerFailed && (await this.matchesVerifiedQuery(session, data));
      const answer =
        text.trim() ||
        `${visualEvent!.action === 'created' ? 'Created' : 'Updated'} interactive visual "${visualEvent!.title}" (v${visualEvent!.version}).`;
      const expertTrace =
        expert && !turn.signal.aborted && !providerFailed
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
      // replays an expert answer, trace included. A provider-error message
      // is not an answer, and an answer the review flagged (findings its
      // corrective pass could not address) carries a known defect — like a
      // result-guard warning, neither is ever pinned and replayed.
      const record = pickAnswerRecord(data, answer);
      const pinRecord =
        pinning &&
        !turn.signal.aborted &&
        !providerFailed &&
        review?.status !== 'flagged' &&
        (mode !== 'expert' || expertTrace) &&
        pinEligible({
          record,
          visualEvent,
          activeVisualId: opts.activeVisualId,
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
      persisted = {
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
        ...(review ? { review } : {}),
        ...(usage ? { usage } : {}),
        ...(providerError ? { providerError } : {}),
        ...(expertTrace ? { expertTrace } : {}),
        ...(stabilised?.consistency
          ? { consistency: stabilised.consistency }
          : {}),
        ...engineStamp,
      };
      messages.push(persisted);
      if (pinning && pinRecord) {
        pinned = { pinning, record: pinRecord, message: persisted };
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
    // An independent re-derivation got different numbers — on a user's turn,
    // a signal for the memory (ADR-0013). After `done`: never delays it.
    if (
      opts.memorySignals &&
      persisted &&
      crossChecked?.status === 'disagree'
    ) {
      await this.signalMemory(
        session,
        disagreementSignal(
          id,
          trimmed,
          pickAnswerRecord(data, text)?.input,
          crossChecked.note ?? CROSS_CHECK_DISAGREE_NOTE,
          persisted,
        ),
      );
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

  // ------------------------------------------------------- answer pinning

  /**
   * Key this turn's question (lineage) and fingerprint the context it was
   * just given, then look up the lineage's pin. The knowledge, metrics and
   * verified blocks are read back off the turn's own requestContext — the
   * exact context the model is about to receive, so the engine levers that
   * shape it (`context`, `rankedKnowledge`) are already in it; datasets and
   * model settings are the same reads `groundingSources` made, with `effort`
   * the turn's effective reasoning effort (a lever may override Settings →
   * LLM). `undefined` (pinning off for this turn) when anything fails: a
   * turn is never broken by its pin.
   */
  private async preparePin(
    session: SessionDoc,
    mode: PinMode,
    requestContext: { get(key: string): unknown },
    effort: EngineReasoningEffort,
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
        view: { ...view, reasoningEffort: effort },
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
   * (one `text` event, then `done`) with zero model calls and returns it;
   * `{}` when the user stopped while the SQL re-ran (nothing persisted, the
   * turn is over). `undefined` whenever any of that does not hold, or the
   * re-run fails: the turn then derives a fresh answer as usual.
   */
  private async replayPin(
    session: SessionDoc,
    pinning: TurnPin,
    signal: AbortSignal,
    emit: (event: StreamEvent) => void,
  ): Promise<{ message?: ChatMessage } | undefined> {
    const pin = pinning.existing;
    if (
      !pin ||
      // A reviewer rejected this answer: never hand it out again.
      pin.rejectedAt ||
      pin.fingerprint !== pinning.fingerprint ||
      !pinning.datasourceId ||
      pin.datasourceId !== pinning.datasourceId
    ) {
      return undefined;
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
        return undefined;
      }
    } catch (error) {
      this.logger.warn(`Answer pin replay failed: ${errorText(error)}`);
      return undefined;
    }
    // Stopped while the query re-ran: nothing to answer, nothing to derive.
    if (signal.aborted) return {};
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
    return { message };
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
   * now — the same `groundingSources`, under the same production levers
   * (Settings → Engine levers), the turn's context is built from, so a pin
   * approved from the feedback path matches the next turn's key.
   */
  private async fingerprintFor(
    session: SessionDoc,
    question: string,
  ): Promise<{ fingerprint: string; parts: FingerprintParts }> {
    const levers = await this.engineSettings.resolved();
    const sources = await this.groundingSources(session, question, levers);
    return pinFingerprint({
      used: sources.knowledge.used,
      metrics: sources.metrics,
      verified: sources.verified,
      datasets: sources.datasets,
      view: {
        ...sources.view,
        reasoningEffort: levers.reasoningEffort ?? sources.view.reasoningEffort,
      },
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
    await this.signalMemory(
      session,
      approvalSignal(question.content.trim(), sql, answer),
    );
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
      const question = questionBefore(messages, index);
      if (question) {
        await this.signalMemory(session, rejectionSignal(id, question, answer));
      }
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
      // The note itself is a correction for the memory (ADR-0013) — queued
      // before the slower lesson distillation, and replaced by a later note.
      await this.signalMemory(
        session,
        blockCorrectionSignal(
          id,
          question?.content ?? '',
          block,
          comment,
          answer,
        ),
      );
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
      void this.forgetMemory(
        session,
        correctionDocumentId(id, messageAt, block),
      );
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

  // ------------------------------------------------------- learning memory

  /**
   * Queue one learning-memory signal (ADR-0013) for this session's
   * datasource. Skipped when Hindsight is not configured or the session
   * spans several datasources; the outbox also drops it while the
   * production `memory` lever is off. Never throws — a rating or an answer
   * is never lost to its memory echo.
   */
  private async signalMemory(
    session: SessionDoc,
    signal: Omit<MemorySignal, 'id' | 'datasourceId' | 'datasetIds'>,
  ): Promise<void> {
    if (!this.memoryOutbox || !this.learningStore?.enabled) return;
    try {
      const datasourceId = await this.soleDatasourceId(session);
      if (!datasourceId) return;
      await this.memoryOutbox.enqueue({
        id: randomUUID(),
        datasourceId,
        datasetIds: [...session.datasets],
        ...signal,
      });
    } catch (error) {
      this.logger.warn(
        `Memory signal ${signal.documentId} skipped: ${errorText(error)}`,
      );
    }
  }

  /** Remove one retained document (a cleared reviewer note). Never throws. */
  private async forgetMemory(
    session: SessionDoc,
    documentId: string,
  ): Promise<void> {
    if (!this.memoryOutbox || !this.learningStore?.enabled) return;
    try {
      const datasourceId = await this.soleDatasourceId(session);
      if (datasourceId)
        await this.memoryOutbox.forget(datasourceId, documentId);
    } catch (error) {
      this.logger.warn(
        `Memory document ${documentId} not forgotten: ${errorText(error)}`,
      );
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

// ---------------------------------------------------- memory signals

/** A signal as `signalMemory` takes it: the datasource is the session's. */
type SessionSignal = Omit<MemorySignal, 'id' | 'datasourceId' | 'datasetIds'>;

/** SQL as a signal carries it: literals not in the question redacted, clipped. */
function signalSql(sql: string, question: string): string {
  return clip(redactSqlLiterals(sql.trim(), question), SIGNAL_SQL_CHARS);
}

/** The user message the answer at `index` replied to. */
function questionBefore(
  messages: ChatMessage[],
  index: number,
): string | undefined {
  const question = messages
    .slice(0, index)
    .reverse()
    .find((m) => m.role === 'user')
    ?.content.trim();
  return question || undefined;
}

/** Memory document of a correction: a whole answer, or one reasoning block. */
function correctionDocumentId(
  sessionId: string,
  messageAt: string,
  block: string,
): string {
  return `corr:${sessionId}:${messageAt}:${block}`;
}

/**
 * 👍: the approved pair. Keyed by the normalised question, so approving the
 * same question again (in any session) replaces the earlier approval.
 */
function approvalSignal(
  question: string,
  sql: string,
  answer: ChatMessage,
): SessionSignal {
  const key = createHash('sha256')
    .update(normalizeQuestion(question))
    .digest('hex');
  return {
    kind: 'verified_query',
    documentId: `vq:${key}`,
    content: `Question: ${question}\nApproved SQL: ${signalSql(sql, question)}`,
    context: 'An analyst approved this SQL answer as correct',
    occurredAt: answer.at,
    entities: answer.entities ?? [],
  };
}

/** 👎 on a whole answer. */
function rejectionSignal(
  sessionId: string,
  question: string,
  answer: ChatMessage,
): SessionSignal {
  const sql = pickAnswerRecord(answer.data, answer.content)?.input?.trim();
  return {
    kind: 'correction',
    documentId: correctionDocumentId(sessionId, answer.at, 'answer'),
    content: [
      `Question: ${question}`,
      ...(sql ? [`Rejected SQL: ${signalSql(sql, question)}`] : []),
      'The analyst marked this answer incorrect.',
    ].join('\n'),
    context: 'An analyst rejected this SQL answer',
    occurredAt: answer.at,
    entities: answer.entities ?? [],
  };
}

/** A reviewer's note on one reasoning block (business expert mode). */
function blockCorrectionSignal(
  sessionId: string,
  question: string,
  block: string,
  comment: string,
  answer: ChatMessage,
): SessionSignal {
  const sql = pickAnswerRecord(answer.data, answer.content)?.input?.trim();
  return {
    kind: 'correction',
    documentId: correctionDocumentId(sessionId, answer.at, block),
    content: [
      `Question: ${question}`,
      `Step: ${block}`,
      `Reviewer note: ${clip(comment, SIGNAL_NOTE_CHARS)}`,
      ...(sql ? [`Final SQL: ${signalSql(sql, question)}`] : []),
    ].join('\n'),
    context: `An analyst corrected the "${block}" step of this answer`,
    occurredAt: answer.at,
    entities: answer.entities ?? [],
  };
}

/** Careful mode's independent re-derivation disagreed with the answer. */
function disagreementSignal(
  sessionId: string,
  question: string,
  sql: string | undefined,
  note: string,
  answer: ChatMessage,
): SessionSignal {
  return {
    kind: 'cross_check_differs',
    documentId: `xc:${sessionId}:${answer.at}`,
    content: [
      `Question: ${question}`,
      ...(sql?.trim() ? [`Answer SQL: ${signalSql(sql, question)}`] : []),
      `An independent cross-check disagreed: ${note}`,
    ].join('\n'),
    context: "The system's independent cross-check disagreed with this answer",
    occurredAt: answer.at,
    entities: answer.entities ?? [],
  };
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

/**
 * The pin mode a turn is keyed under, decided before the model runs:
 * business expert mode, else careful when the turn's levers always
 * cross-check (`careful: 'on'` — the composer's Careful chip, or Settings →
 * Engine levers), else plain. `careful: 'auto'` decides per turn after the
 * answer exists, so it keys as plain — `messageMode` reads it back the same.
 */
function turnPinMode(engine: EngineOptions, expert: boolean): PinMode {
  if (expert) return 'expert';
  return engine.careful === 'on' ? 'careful' : 'plain';
}

/**
 * Which pin mode an answer was produced in, read off what it carries — the
 * same key `turnPinMode` gave its turn. A cross-check that `careful: 'auto'`
 * escalated to (the engine stamp says `auto`) was keyed plain.
 */
function messageMode(message: ChatMessage | undefined): PinMode {
  if (message?.expertTrace) return 'expert';
  if (message?.crossCheck && message.engine?.careful !== 'auto') {
    return 'careful';
  }
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
