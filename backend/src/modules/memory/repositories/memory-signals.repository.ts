import { Inject, Injectable } from '@nestjs/common';
import { MEMORY_SIGNALS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type {
  MemorySignal,
  MemorySignalDoc,
} from '../entities/memory-signal.entity';

/** The learning-memory outbox: signals waiting for, or done with, a retain. */
@Injectable()
export class MemorySignalsRepository {
  constructor(
    @Inject(MEMORY_SIGNALS_STORE)
    private readonly store: DocStore<MemorySignalDoc>,
  ) {}

  /**
   * Queue a signal. A signal still pending for the same document is replaced
   * rather than joined: the memory groups items that share a document id,
   * and only the latest version of an approval, a note or a snippet counts.
   */
  async enqueue(signal: MemorySignal): Promise<MemorySignalDoc> {
    const doc: MemorySignalDoc = {
      ...signal,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    const pending = await this.store.findOne({
      documentId: signal.documentId,
      status: 'pending',
    });
    if (!pending) return this.store.insert(doc);
    await this.store.unset({ id: pending.id }, 'lastError');
    await this.store.unset({ id: pending.id }, 'nextAttemptAt');
    return (await this.store.update({ id: pending.id }, doc)) ?? doc;
  }

  /** Pending signals whose retry time has come, oldest first. */
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

  async markSent(ids: string[], sentAt: Date): Promise<void> {
    for (const id of ids) {
      await this.store.update(
        { id },
        { status: 'sent', sentAt: sentAt.toISOString() },
      );
      await this.store.unset({ id }, 'nextAttemptAt');
    }
  }

  /** Record one failed attempt: back to pending with a retry time, or failed. */
  async markAttemptFailed(
    id: string,
    patch: Pick<MemorySignalDoc, 'status' | 'attempts' | 'lastError'> & {
      nextAttemptAt?: string;
    },
  ): Promise<void> {
    await this.store.update({ id }, patch);
    if (!patch.nextAttemptAt) await this.store.unset({ id }, 'nextAttemptAt');
  }

  /** Drop what is still queued for a document that is being forgotten. */
  dropPending(documentId: string): Promise<number> {
    return this.store.deleteMany({ documentId, status: 'pending' });
  }
}
