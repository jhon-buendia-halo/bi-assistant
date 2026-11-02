import { Inject, Injectable } from '@nestjs/common';
import { SETTINGS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type {
  MemoryCompactionDoc,
  MemorySettingsDoc,
} from '../entities/memory-settings.entity';

/**
 * The memory's documents in `settings`, keyed as the `llm` document is: the
 * lever (`memory`) and a compaction still to run (`memory-compaction`).
 */
@Injectable()
export class MemorySettingsRepository {
  constructor(
    @Inject(SETTINGS_STORE)
    private readonly store: DocStore<MemorySettingsDoc | MemoryCompactionDoc>,
  ) {}

  /** The lever; absent means off (knowledge R30). */
  async enabled(): Promise<boolean> {
    const doc = (await this.store.findOne({
      key: 'memory',
    })) as MemorySettingsDoc | null;
    return doc?.enabled === true;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.store.update(
      { key: 'memory' },
      { key: 'memory', enabled },
      { upsert: true },
    );
  }

  async compactionPending(): Promise<boolean> {
    return (await this.store.findOne({ key: 'memory-compaction' })) !== null;
  }

  async markCompactionPending(lastError?: string): Promise<void> {
    await this.store.update(
      { key: 'memory-compaction' },
      {
        key: 'memory-compaction',
        pendingSince: new Date().toISOString(),
        ...(lastError ? { lastError } : {}),
      },
      { upsert: true },
    );
  }

  async clearCompactionPending(): Promise<void> {
    await this.store.deleteMany({ key: 'memory-compaction' });
  }
}
