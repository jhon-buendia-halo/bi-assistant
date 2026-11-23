import { Inject, Injectable } from '@nestjs/common';
import {
  CONVERSATION_EXPORTS_STORE,
  type DocStore,
} from '../../infrastructure/database/doc-store';
import type {
  ConversationExportFile,
  ConversationExportRef,
} from './conversation-export.contract';

/** A file of an export, with where it lies under the data directory. */
export interface StoredExportFile extends ConversationExportFile {
  /** `exports/<id>/<fileName>`, relative to the data directory. */
  path: string;
}

/** One export, as `conversation_exports` stores it (data-model 3.20). */
export interface ConversationExportDoc extends Omit<
  ConversationExportRef,
  'files'
> {
  conversationId: string;
  /** The run whose answer carries it. */
  runId: string;
  files: StoredExportFile[];
}

/** The stored conversation exports (data-model 3.20). */
@Injectable()
export class ConversationExportsRepository {
  constructor(
    @Inject(CONVERSATION_EXPORTS_STORE)
    private readonly store: DocStore<ConversationExportDoc>,
  ) {}

  get(id: string): Promise<ConversationExportDoc | null> {
    return this.store.findOne({ id });
  }

  insert(doc: ConversationExportDoc): Promise<ConversationExportDoc> {
    return this.store.insert(doc);
  }
}
