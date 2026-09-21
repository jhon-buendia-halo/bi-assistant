import { Inject, Injectable } from '@nestjs/common';
import { KNOWLEDGE_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { KnowledgeSnippet } from '../entities/knowledge-snippet.entity';

/**
 * Curated knowledge snippets, keyed by id. Scope/kind/source/enabled
 * filtering (including the dataset-scoped-OR-global rule) needs an OR the
 * `DocStore` filter surface does not express, so it lives in
 * `KnowledgeService` over the full `list()` — same trade `MetricsService`
 * makes over `MetricsRepository.list()`.
 */
@Injectable()
export class KnowledgeRepository {
  constructor(
    @Inject(KNOWLEDGE_STORE) private readonly store: DocStore<KnowledgeSnippet>,
  ) {}

  list(): Promise<KnowledgeSnippet[]> {
    return this.store.find({}, { sort: { updatedAt: -1 } });
  }

  get(id: string): Promise<KnowledgeSnippet | null> {
    return this.store.findOne({ id });
  }

  insert(doc: KnowledgeSnippet): Promise<KnowledgeSnippet> {
    return this.store.insert(doc);
  }

  /** Partial merge — fields absent from `patch` are left untouched. */
  update(
    id: string,
    patch: Partial<KnowledgeSnippet>,
  ): Promise<KnowledgeSnippet | null> {
    return this.store.update({ id }, patch);
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
