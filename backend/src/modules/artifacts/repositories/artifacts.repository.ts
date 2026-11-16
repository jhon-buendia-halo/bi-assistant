import { Inject, Injectable } from '@nestjs/common';
import { ARTIFACTS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import type { ArtifactDoc } from '../entities/artifact.entity';

/** The stored artifacts (data-model 3.18), newest first. */
@Injectable()
export class ArtifactsRepository {
  constructor(
    @Inject(ARTIFACTS_STORE)
    private readonly store: DocStore<ArtifactDoc>,
  ) {}

  list(): Promise<ArtifactDoc[]> {
    return this.store.find({}, { sort: { createdAt: -1 } });
  }

  get(id: string): Promise<ArtifactDoc | null> {
    return this.store.findOne({ id });
  }

  insert(doc: ArtifactDoc): Promise<ArtifactDoc> {
    return this.store.insert(doc);
  }

  update(id: string, patch: Partial<ArtifactDoc>): Promise<ArtifactDoc | null> {
    return this.store.update({ id }, patch);
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
