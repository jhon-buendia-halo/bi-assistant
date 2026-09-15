import { Inject, Injectable } from '@nestjs/common';
import { PROJECTS_STORE } from '../../../infrastructure/database/doc-store';
import type { DocStore } from '../../../infrastructure/database/doc-store';
import { ProjectDoc } from '../entities/project.entity';

@Injectable()
export class ProjectsRepository {
  constructor(
    @Inject(PROJECTS_STORE)
    private readonly store: DocStore<ProjectDoc>,
  ) {}

  list(): Promise<ProjectDoc[]> {
    return this.store.find({}, { sort: { updatedAt: -1 } });
  }

  get(id: string): Promise<ProjectDoc | null> {
    return this.store.findOne({ id });
  }

  insert(doc: ProjectDoc): Promise<ProjectDoc> {
    return this.store.insert(doc);
  }

  update(id: string, patch: Partial<ProjectDoc>): Promise<ProjectDoc | null> {
    return this.store.update({ id }, patch);
  }

  delete(id: string): Promise<number> {
    return this.store.deleteOne({ id });
  }
}
