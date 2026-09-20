import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { VERIFIED_QUERIES_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { VerifiedQueryDoc } from '../entities/verified-query.entity';

/** Approved question → SQL pairs, keyed by the answer they came from. */
@Injectable()
export class VerifiedQueriesRepository implements OnModuleInit {
  constructor(
    @Inject(VERIFIED_QUERIES_STORE)
    private readonly store: DocStore<VerifiedQueryDoc>,
  ) {}

  /**
   * Rewrite the `sourceProjectId` key stored before the `projects` →
   * `sessions` rename. The dedupe filter in `save` matches on
   * `sourceSessionId`, so a legacy document would otherwise never be found
   * again — and would fork on the next thumbs-up.
   */
  async onModuleInit(): Promise<void> {
    const legacy = (await this.store.find({})) as (VerifiedQueryDoc & {
      sourceProjectId?: string;
    })[];
    for (const doc of legacy) {
      if (!doc.sourceProjectId || doc.sourceSessionId) continue;
      // Both writes stamp `updatedAt`, so migrated entries land together at
      // the top of the library's recency ordering. Harmless: retrieval is by
      // lexical similarity, not recency.
      await this.store.update(
        { id: doc.id },
        {
          sourceSessionId: doc.sourceProjectId,
        },
      );
      await this.store.unset({ id: doc.id }, 'sourceProjectId');
    }
  }

  list(): Promise<VerifiedQueryDoc[]> {
    return this.store.find({}, { sort: { updatedAt: -1 } });
  }

  /** Upsert on the source answer so re-rating the same message never forks. */
  async save(doc: VerifiedQueryDoc): Promise<VerifiedQueryDoc> {
    const saved = await this.store.update(
      {
        sourceSessionId: doc.sourceSessionId,
        sourceMessageAt: doc.sourceMessageAt,
      },
      doc,
      { upsert: true },
    );
    return saved ?? doc;
  }

  deleteForMessage(sessionId: string, messageAt: string): Promise<number> {
    return this.store.deleteMany({
      sourceSessionId: sessionId,
      sourceMessageAt: messageAt,
    });
  }
}
