import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { EngineSettingsService } from '../engine/engine-settings.service';
import type {
  MemorySignal,
  MemorySignalDoc,
} from './entities/memory-signal.entity';
import { LEARNING_STORE, type LearningStore } from './learning-store.port';
import { MemoryBankService } from './memory-bank.service';
import { clip } from './redact';
import { MemorySignalsRepository } from './repositories/memory-signals.repository';

/** Quiet period after the last enqueue before a flush — a burst sends once. */
export const FLUSH_DEBOUNCE_MS = 2_000;
/** Background flush cadence: retries come due, a previous process's leftovers. */
export const FLUSH_INTERVAL_MS = 30_000;
/** Failed sends before a signal is given up (`failed`). */
export const MAX_SEND_ATTEMPTS = 5;
/** First retry delay; doubles per failed attempt, capped. */
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 15 * 60_000;
/** Longest error text kept on a signal row. */
const ERROR_CHARS = 500;

/**
 * The persisted outbox between user signals and the learning memory
 * (ADR-0013). A signal is written to `memory_signals` at once and sent in
 * the background — 2 s after the last enqueue, every 30 s, and on start —
 * so a feedback click never waits for the memory server, and a server that
 * is down only delays what it learns.
 *
 * Signals come from user actions only (feedback, Knowledge edits, a chat
 * turn's cross-check); `enqueue` drops them while the store is disabled
 * (`HINDSIGHT_URL` unset) or the production `memory` lever is `off`.
 * Nothing here throws to its caller.
 */
@Injectable()
export class MemoryOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoryOutboxService.name);
  private debounce?: NodeJS.Timeout;
  private interval?: NodeJS.Timeout;
  private flushing?: Promise<void>;
  private flushAgain = false;

  constructor(
    private readonly repository: MemorySignalsRepository,
    @Inject(LEARNING_STORE) private readonly store: LearningStore,
    private readonly banks: MemoryBankService,
    private readonly engineSettings: EngineSettingsService,
  ) {}

  onModuleInit(): void {
    if (!this.store.enabled) return;
    this.interval = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    // Never what keeps the process (the CLI, a script) alive.
    this.interval.unref();
    void this.flush();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.debounce) clearTimeout(this.debounce);
  }

  /** Queue one signal for the memory. Never throws. */
  async enqueue(signal: MemorySignal): Promise<void> {
    if (!this.store.enabled) return;
    try {
      const levers = await this.engineSettings.resolved();
      if (levers.memory === 'off') return;
      await this.repository.enqueue(signal);
      this.scheduleFlush();
    } catch (error) {
      this.logger.warn(
        `Memory signal ${signal.documentId} was not queued: ${errorText(error)}`,
      );
    }
  }

  /**
   * Remove a document from the memory, and drop anything still queued for
   * it so a later flush cannot bring it back. Not gated on the lever: what
   * was retained while it was on must still be forgettable. Never throws.
   */
  async forget(datasourceId: string, documentId: string): Promise<void> {
    if (!this.store.enabled) return;
    try {
      await this.repository.dropPending(documentId);
      await this.store.forget(datasourceId, documentId);
    } catch (error) {
      this.logger.warn(
        `Memory document ${documentId} was not forgotten: ${errorText(error)}`,
      );
    }
  }

  /**
   * Send every due signal, one retain per datasource. A flush requested
   * while one runs is folded into a second pass right after it.
   */
  flush(): Promise<void> {
    if (this.flushing) {
      this.flushAgain = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      try {
        do {
          this.flushAgain = false;
          await this.flushDue(new Date());
        } while (this.flushAgain);
      } finally {
        this.flushing = undefined;
      }
    })();
    return this.flushing;
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
      const byDatasource = new Map<string, MemorySignalDoc[]>();
      for (const doc of due) {
        byDatasource.set(doc.datasourceId, [
          ...(byDatasource.get(doc.datasourceId) ?? []),
          doc,
        ]);
      }
      for (const [datasourceId, docs] of byDatasource) {
        // The bank's missions must exist before its first retain is
        // extracted; cached after the first call, never throws.
        await this.banks.ensureBank(datasourceId);
        try {
          await this.store.retain(docs.map(toSignal));
          await this.repository.markSent(
            docs.map((doc) => doc.id),
            new Date(),
          );
        } catch (error) {
          this.logger.warn(
            `Memory retain of ${docs.length} signal(s) for ${datasourceId} failed: ${errorText(error)}`,
          );
          for (const doc of docs) await this.recordFailure(doc, error, now);
        }
      }
    } catch (error) {
      this.logger.warn(`Memory outbox flush failed: ${errorText(error)}`);
    }
  }

  private async recordFailure(
    doc: MemorySignalDoc,
    error: unknown,
    now: Date,
  ): Promise<void> {
    const attempts = doc.attempts + 1;
    const lastError = clip(errorText(error), ERROR_CHARS);
    if (attempts >= MAX_SEND_ATTEMPTS) {
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
function toSignal(doc: MemorySignalDoc): MemorySignal {
  return {
    id: doc.id,
    kind: doc.kind,
    datasourceId: doc.datasourceId,
    datasetIds: doc.datasetIds,
    documentId: doc.documentId,
    content: doc.content,
    context: doc.context,
    occurredAt: doc.occurredAt,
    entities: doc.entities,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
