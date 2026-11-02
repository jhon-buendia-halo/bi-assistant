import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MEMORY_SIGNALS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type {
  MemorySignalDoc,
  MemorySignalInput,
} from '../entities/memory-signal.entity';

/** The `memory_signals` outbox (data-model 3.15). */
@Injectable()
export class MemorySignalsRepository {
  constructor(
    @Inject(MEMORY_SIGNALS_STORE)
    private readonly store: DocStore<MemorySignalDoc>,
  ) {}

  /**
   * Write a signal. A row with the same document id, whatever its state,
   * takes the new signal fields and goes back to `pending` with no
   * attempts, so an answer keeps one row per document id.
   */
  async upsert(signal: MemorySignalInput): Promise<MemorySignalDoc> {
    const fresh = { ...signal, status: 'pending' as const, attempts: 0 };
    const existing = await this.store.findOne({
      documentId: signal.documentId,
    });
    if (!existing) {
      return this.store.insert({ id: randomUUID(), ...fresh });
    }
    for (const field of ['lastError', 'nextAttemptAt', 'storedAt']) {
      await this.store.unset({ id: existing.id }, field);
    }
    return (
      (await this.store.update({ id: existing.id }, fresh)) ?? {
        ...existing,
        ...fresh,
      }
    );
  }

  get(id: string): Promise<MemorySignalDoc | null> {
    return this.store.findOne({ id });
  }

  /** Pending rows whose retry time has come, oldest first. */
  async due(now: Date): Promise<MemorySignalDoc[]> {
    const pending = await this.store.find(
      { status: 'pending' },
      { sort: { createdAt: 1 } },
    );
    const at = now.toISOString();
    return pending.filter(
      (doc) => !doc.nextAttemptAt || doc.nextAttemptAt <= at,
    );
  }

  byDocumentId(documentId: string): Promise<MemorySignalDoc[]> {
    return this.store.find({ documentId });
  }

  byDatasource(datasourceId: string): Promise<MemorySignalDoc[]> {
    return this.store.find({ datasourceId });
  }

  async markStored(id: string, storedAt: Date): Promise<void> {
    await this.store.update(
      { id },
      { status: 'stored', storedAt: storedAt.toISOString() },
    );
    await this.store.unset({ id }, 'nextAttemptAt');
  }

  /** One failed attempt: back to pending with a retry time, or failed. */
  async markAttemptFailed(
    id: string,
    patch: Pick<MemorySignalDoc, 'status' | 'attempts' | 'lastError'> & {
      nextAttemptAt?: string;
    },
  ): Promise<void> {
    await this.store.update({ id }, patch);
    if (!patch.nextAttemptAt) await this.store.unset({ id }, 'nextAttemptAt');
  }

  deleteByDocumentId(documentId: string): Promise<number> {
    return this.store.deleteMany({ documentId });
  }

  deleteByDatasource(datasourceId: string): Promise<number> {
    return this.store.deleteMany({ datasourceId });
  }
}
