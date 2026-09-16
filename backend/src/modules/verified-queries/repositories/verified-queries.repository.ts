import { Inject, Injectable } from '@nestjs/common';
import { VERIFIED_QUERIES_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { VerifiedQueryDoc } from '../entities/verified-query.entity';

/** Approved question → SQL pairs, keyed by the answer they came from. */
@Injectable()
export class VerifiedQueriesRepository {
  constructor(
    @Inject(VERIFIED_QUERIES_STORE)
    private readonly store: DocStore<VerifiedQueryDoc>,
  ) {}

  list(): Promise<VerifiedQueryDoc[]> {
    return this.store.find({}, { sort: { updatedAt: -1 } });
  }

  /** Upsert on the source answer so re-rating the same message never forks. */
  async save(doc: VerifiedQueryDoc): Promise<VerifiedQueryDoc> {
    const saved = await this.store.update(
      {
        sourceProjectId: doc.sourceProjectId,
        sourceMessageAt: doc.sourceMessageAt,
      },
      doc,
      { upsert: true },
    );
    return saved ?? doc;
  }

  deleteForMessage(projectId: string, messageAt: string): Promise<number> {
    return this.store.deleteMany({
      sourceProjectId: projectId,
      sourceMessageAt: messageAt,
    });
  }
}
