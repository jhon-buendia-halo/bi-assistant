/**
 * Upkeep the memory service runs beside the port: what only the "Mastra
 * only" store's file layout can answer, and its compaction (data-model
 * 5.2). Plain module, so the service never loads the framework.
 */
export interface LearningStoreMaintenance {
  /**
   * `PRAGMA wal_checkpoint(TRUNCATE)`, `VACUUM`, and a checkpoint again.
   * Throws when it cannot.
   */
  compact(): Promise<void>;
  /** The scopes whose learning thread holds a message with this id. */
  scopesHolding(documentId: string): Promise<string[]>;
  /** Whether the scope has a learning thread or a summary. */
  holdsScope(scope: string): Promise<boolean>;
  /** Forget every `eval-` scope a stopped eval run left; returns how many. */
  removeEvalScopes(): Promise<number>;
  /** At shutdown: let summary rewrites and background deletes finish. */
  close(): Promise<void>;
}

export const LEARNING_STORE_MAINTENANCE = 'LEARNING_STORE_MAINTENANCE';
