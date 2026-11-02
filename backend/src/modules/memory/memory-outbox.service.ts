import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type {
  MemorySignalDoc,
  MemorySignalInput,
} from './entities/memory-signal.entity';
import {
  LEARNING_STORE,
  type LearningSignal,
  type LearningStore,
} from './learning-store.port';
import { MemorySignalsRepository } from './repositories/memory-signals.repository';
import { clip } from './signal-text';

/** Quiet period after the last write before a flush: a burst flushes once. */
export const FLUSH_DEBOUNCE_MS = 2_000;
/** Background flush cadence: retries come due, a previous run's leftovers. */
export const FLUSH_INTERVAL_MS = 30_000;
/** Failed attempts before a row is given up (`failed`). */
export const MAX_STORE_ATTEMPTS = 5;
/** First retry delay; doubles per failed attempt, capped. */
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;
/** Longest error text kept on a row. */
const ERROR_CHARS = 500;

/**
 * The persisted outbox between a rating and the cross-session memory
 * (data-model 3.15, knowledge R34). A row is written at once and handed to
 * the store's `retain` in the background, about 2 s after the last write,
 * every 30 s and at start-up, so a click never waits for the memory and a
 * memory that cannot store yet only delays what it learns.
 *
 * Flushes and forgets run one at a time (`exclusive`), so a forget never
 * races a flush that already read the row it deletes. Writing a row does
 * not wait for them. Nothing here throws to its caller.
 */
@Injectable()
export class MemoryOutboxService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MemoryOutboxService.name);
  private debounce?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;
  private chain: Promise<unknown> = Promise.resolve();
  private queuedFlush?: Promise<void>;

  constructor(
    private readonly repository: MemorySignalsRepository,
    @Inject(LEARNING_STORE) private readonly store: LearningStore,
  ) {}

  onApplicationBootstrap(): void {
    this.interval = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    // Never what keeps the process (the CLI, a script) alive.
    this.interval.unref();
    void this.flush();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.debounce) clearTimeout(this.debounce);
  }

  /** Write (or replace) the row of one signal and schedule a flush. */
  async enqueue(signal: MemorySignalInput): Promise<void> {
    await this.repository.upsert(signal);
    this.scheduleFlush();
  }

  /** Run `work` while no flush runs (a forget: rows, then the store). */
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const next = this.chain.then(work);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /**
   * Hand every due row to the store, one `retain` per learning memory. A
   * flush asked for while one waits to start joins it.
   */
  flush(): Promise<void> {
    if (this.queuedFlush) return this.queuedFlush;
    const run = this.exclusive(async () => {
      this.queuedFlush = undefined;
      await this.flushDue(new Date());
    });
    this.queuedFlush = run;
    return run;
  }

  private scheduleFlush(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
    this.debounce.unref();
  }

  private async flushDue(now: Date): Promise<void> {
    try {
      const due = await this.repository.due(now);
      const byScope = new Map<string, MemorySignalDoc[]>();
      for (const doc of due) {
        byScope.set(doc.datasourceId, [
          ...(byScope.get(doc.datasourceId) ?? []),
          doc,
        ]);
      }
      for (const [scope, docs] of byScope) {
        try {
          await this.store.retain(scope, docs.map(toSignal));
          for (const doc of docs) {
            if (await this.unchanged(doc)) {
              await this.repository.markStored(doc.id, new Date());
            }
          }
        } catch (error) {
          this.logger.warn(
            `Memory retain of ${docs.length} signal(s) for ${scope} failed: ${errorText(error)}`,
          );
          for (const doc of docs) {
            if (await this.unchanged(doc)) {
              await this.recordFailure(doc, error, now);
            }
          }
        }
      }
    } catch (error) {
      this.logger.warn(`Memory outbox flush failed: ${errorText(error)}`);
    }
  }

  /**
   * Whether the row still holds what was flushed: a rating may have
   * replaced it meanwhile, and that version waits for the next flush.
   */
  private async unchanged(doc: MemorySignalDoc): Promise<boolean> {
    const now = await this.repository.get(doc.id);
    return (
      !!now &&
      now.status === 'pending' &&
      now.kind === doc.kind &&
      now.content === doc.content &&
      now.datasourceId === doc.datasourceId
    );
  }

  private async recordFailure(
    doc: MemorySignalDoc,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const attempts = doc.attempts + 1;
    const lastError = clip(errorText(error), ERROR_CHARS);
    if (attempts >= MAX_STORE_ATTEMPTS) {
      this.logger.warn(
        `Memory signal ${doc.documentId} given up after ${attempts} attempts`,
      );
      await this.repository.markAttemptFailed(doc.id, {
        status: 'failed',
        attempts,
        lastError,
      });
      return;
    }
    const delay = Math.min(RETRY_BASE_MS * 2 ** (attempts - 1), RETRY_MAX_MS);
    await this.repository.markAttemptFailed(doc.id, {
      status: 'pending',
      attempts,
      lastError,
      nextAttemptAt: new Date(now.getTime() + delay).toISOString(),
    });
  }
}

/** The signal itself, without the outbox's bookkeeping. */
function toSignal(doc: MemorySignalDoc): LearningSignal {
  return {
    documentId: doc.documentId,
    kind: doc.kind,
    content: doc.content,
    occurredAt: doc.occurredAt,
    metadata: {
      datasourceId: doc.datasourceId,
      datasetIds: doc.datasetIds,
      entities: doc.entities,
    },
  };
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
