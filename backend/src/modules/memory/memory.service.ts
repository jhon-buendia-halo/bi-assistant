import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { DOC_STORE_MAINTENANCE } from '../../infrastructure/database/doc-store';
import type { DocStoreMaintenance } from '../../infrastructure/database/doc-store';
import type { KnowledgeUse } from '../knowledge/entities/knowledge-snippet.entity';
import {
  EMBEDDING_KEY_RESOLVER,
  type EmbeddingKeyResolver,
} from './embedding-key';
import {
  EMBEDDING_MODEL,
  type MemorySettingsView,
} from './entities/memory-settings.entity';
import { type LearningMemoryRecall, learnedBlock } from './learned-block';
import { LEARNING_STORE_MAINTENANCE } from './learning-store-maintenance';
import type { LearningStoreMaintenance } from './learning-store-maintenance';
import { LEARNING_STORE, type LearningStore } from './learning-store.port';
import { MemoryOutboxService, errorText } from './memory-outbox.service';
import { MemorySettingsRepository } from './repositories/memory-settings.repository';
import { MemorySignalsRepository } from './repositories/memory-signals.repository';
import { clip, signalText } from './signal-text';

/** Recall of a turn is cut off after this (knowledge R36). */
export const TURN_RECALL_TIMEOUT_MS = 2_500;
/** Document ids a Forget accepts (api.md 110). */
const SIGNAL_ID = /^(rating|correction):/;

/** A rating of an answer, with what a signal of it would carry. */
export interface RatingInput {
  sessionId: string;
  /** The rated answer's `at`. */
  messageAt: string;
  rating: 'up' | 'down';
  /** The thumbs-down's note, trimmed; empty or absent = none. */
  note?: string;
  /** The preceding user question; absent when there is none. */
  question?: string;
  /** The answer's last successful `run_readonly_sql`; absent when none. */
  sql?: string;
  /** The session's one datasource; absent when there are none or several. */
  datasourceId?: string;
  datasetIds: string[];
  entities: string[];
}

/**
 * The cross-session memory as the rest of the app uses it (knowledge R30 to
 * R43): the lever, what a rating retains, the learned block of a chat turn,
 * and forgetting. With the lever off it neither retains nor recalls, so no
 * turn changes; forgetting works whatever the lever says. Nothing here
 * fails the request that called it, except a Forget given a malformed id.
 */
@Injectable()
export class MemoryService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MemoryService.name);
  /** Work started in the background (a forget after a rating, start-up). */
  private readonly background = new Set<Promise<unknown>>();

  constructor(
    private readonly settings: MemorySettingsRepository,
    private readonly signals: MemorySignalsRepository,
    private readonly outbox: MemoryOutboxService,
    @Inject(LEARNING_STORE) private readonly store: LearningStore,
    @Inject(LEARNING_STORE_MAINTENANCE)
    private readonly maintenance: LearningStoreMaintenance,
    @Inject(DOC_STORE_MAINTENANCE)
    private readonly appStore: DocStoreMaintenance,
    @Inject(EMBEDDING_KEY_RESOLVER)
    private readonly keys: EmbeddingKeyResolver,
  ) {}

  /**
   * At every start: forget the eval scopes a stopped run left (data-model
   * 5.2), and run a compaction that failed before. In the background.
   */
  onApplicationBootstrap(): void {
    this.track(
      (async () => {
        try {
          const removed = await this.maintenance.removeEvalScopes();
          if (removed) {
            this.logger.log(
              `Removed ${removed} memory eval scope(s) left by a stopped run`,
            );
          }
        } catch (error) {
          this.logger.warn(
            `Memory eval scopes not removed: ${errorText(error)}`,
          );
        }
        try {
          if (await this.settings.compactionPending()) await this.compact();
        } catch (error) {
          this.logger.warn(
            `Memory compaction not resumed: ${errorText(error)}`,
          );
        }
      })(),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.idle();
    await this.maintenance.close().catch(() => undefined);
  }

  /** Resolves once the work started in the background is done. */
  async idle(): Promise<void> {
    while (this.background.size) await Promise.all([...this.background]);
  }

  // ------------------------------------------------------------ settings

  /** `GET /memory/settings` (api.md 108). */
  async view(): Promise<MemorySettingsView> {
    return {
      enabled: await this.settings.enabled(),
      embeddingModel: EMBEDDING_MODEL,
      embeddingKey: (await this.keys.resolve()).source,
    };
  }

  /**
   * `PUT /memory/settings` (api.md 109). Turning it off keeps what the
   * memory holds.
   */
  async setEnabled(enabled: unknown): Promise<MemorySettingsView> {
    if (typeof enabled !== 'boolean') {
      throw new BadRequestException('enabled must be true or false');
    }
    await this.settings.setEnabled(enabled);
    return this.view();
  }

  // ------------------------------------------------------------- ratings

  /**
   * After a rating is saved (knowledge R30, R31, R39): with the lever on and
   * an answer that ran SQL on one datasource, write the outbox row of its
   * `rating:` signal, an approval or a rejection; otherwise forget what an
   * earlier rating of the answer retained. Never waits for the memory,
   * never throws.
   */
  async recordRating(input: RatingInput): Promise<void> {
    const documentId = `rating:${input.sessionId}:${input.messageAt}`;
    try {
      const question = input.question?.trim();
      const sql = input.sql?.trim();
      if (
        (await this.settings.enabled()) &&
        question &&
        sql &&
        input.datasourceId
      ) {
        const kind = input.rating === 'up' ? 'verified_query' : 'rejection';
        await this.outbox.enqueue({
          documentId,
          kind,
          datasourceId: input.datasourceId,
          datasetIds: input.datasetIds,
          content: signalText({
            kind,
            occurredAt: input.messageAt,
            question,
            sql,
            ...(kind === 'rejection' && input.note ? { note: input.note } : {}),
          }),
          occurredAt: input.messageAt,
          entities: input.entities,
        });
        return;
      }
      this.track(this.forgetDocument(documentId));
    } catch (error) {
      this.logger.warn(
        `Memory signal ${documentId} not recorded: ${errorText(error)}`,
      );
    }
  }

  // ---------------------------------------------------------------- recall

  /**
   * Block 3b of a chat turn (agents.md 4.1), with its "Knowledge in context"
   * entries; undefined when the lever is off or nothing was recalled. One
   * `recall` and one `mentalModels` per datasource, in parallel, cut off
   * after 2.5 seconds: a memory that fails or is late adds nothing.
   */
  async learnedContext(
    datasourceIds: string[],
    question: string,
  ): Promise<{ block: string; used: KnowledgeUse[] } | undefined> {
    try {
      const scopes = [...new Set(datasourceIds.filter(Boolean))];
      if (!question.trim() || !scopes.length) return undefined;
      if (!(await this.settings.enabled())) return undefined;
      let timer: NodeJS.Timeout | undefined;
      const cutOff = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), TURN_RECALL_TIMEOUT_MS);
      });
      try {
        const answers = await Promise.all(
          scopes.map((scope) =>
            Promise.race([this.recallOne(scope, question), cutOff]),
          ),
        );
        const { block, used } = learnedBlock(
          answers.filter((a): a is LearningMemoryRecall => !!a),
        );
        return block ? { block, used } : undefined;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      this.logger.warn(`Memory recall failed: ${errorText(error)}`);
      return undefined;
    }
  }

  private async recallOne(
    scope: string,
    question: string,
  ): Promise<LearningMemoryRecall | undefined> {
    try {
      const [signals, summary] = await Promise.all([
        this.store.recall(scope, question),
        this.store.mentalModels(scope),
      ]);
      return { scope, summary, signals };
    } catch {
      return undefined;
    }
  }

  // --------------------------------------------------------------- forget

  /**
   * Forget one signal (api.md 110, knowledge R40): its outbox rows, then
   * every copy the store keeps, then both files compacted. An unknown or
   * already forgotten id changes nothing.
   */
  async forgetSignal(documentId: string): Promise<void> {
    if (!SIGNAL_ID.test(documentId ?? '')) {
      throw new BadRequestException('Unknown memory signal id');
    }
    if (await this.forgetDocument(documentId)) await this.compact();
  }

  /**
   * A deleted datasource's whole learning memory (knowledge R41): its outbox
   * rows, the scope, then both files compacted. Never throws.
   */
  async forgetDatasource(datasourceId: string): Promise<void> {
    try {
      const found = await this.outbox.exclusive(async () => {
        const removed = await this.signals.deleteByDatasource(datasourceId);
        const held = await this.maintenance.holdsScope(datasourceId);
        if (held) await this.store.forget(datasourceId);
        return removed > 0 || held;
      });
      if (found) await this.compact();
    } catch (error) {
      this.logger.warn(
        `Learning memory of datasource ${datasourceId} not forgotten: ${errorText(error)}`,
      );
    }
  }

  /**
   * The outbox rows of a document id, then its message in every learning
   * memory that holds it; no compaction (a re-rating's replaced text, data-
   * model 5.2). True when anything was there.
   */
  private forgetDocument(documentId: string): Promise<boolean> {
    return this.outbox.exclusive(async () => {
      const rows = await this.signals.byDocumentId(documentId);
      await this.signals.deleteByDocumentId(documentId);
      const scopes = new Set(
        rows
          .filter((row) => row.status === 'stored')
          .map((row) => row.datasourceId),
      );
      for (const scope of await this.maintenance.scopesHolding(documentId)) {
        scopes.add(scope);
      }
      for (const scope of scopes) await this.store.forget(scope, documentId);
      return rows.length > 0 || scopes.size > 0;
    });
  }

  /**
   * `mastra.sqlite`, then `app.sqlite`, so that forgotten text no longer
   * stays in their bytes (data-model 3.15, 5.2). Marked pending first and
   * cleared once done, so a failure or a stop runs it at the next start.
   */
  private async compact(): Promise<void> {
    try {
      await this.settings.markCompactionPending();
      await this.maintenance.compact();
      await this.appStore.compact();
      await this.settings.clearCompactionPending();
    } catch (error) {
      this.logger.warn(
        `Memory compaction failed, retried at the next start: ${errorText(error)}`,
      );
      await this.settings
        .markCompactionPending(clip(errorText(error), 500))
        .catch(() => undefined);
    }
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => {
      this.logger.warn(`Memory background work failed: ${errorText(error)}`);
    });
    this.background.add(tracked);
    void tracked.finally(() => this.background.delete(tracked));
  }
}
