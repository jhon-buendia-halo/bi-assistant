import type { MemorySignal } from './entities/memory-signal.entity';

/**
 * The learning memory, as the rest of the app sees it (ADR-0013). Sessions
 * and Knowledge depend on this port only; `HindsightLearningStore` is the
 * one implementation that talks to a server, `NoopLearningStore` the one
 * used when `HINDSIGHT_URL` is unset.
 */
export const LEARNING_STORE = Symbol('LEARNING_STORE');

/** One memory recall returned, mapped off the server's snake_case shape. */
export interface RecalledMemory {
  id: string;
  type: 'world' | 'experience' | 'observation';
  text: string;
  occurredAt?: string;
  documentId?: string;
  entities: string[];
  /** Observations: how many facts it was consolidated from. */
  evidenceCount?: number;
}

/** A bank's mental model with content (curated summary the memory keeps current). */
export interface MentalModel {
  id: string;
  name: string;
  content: string;
}

export interface RecallQuery {
  datasourceId: string;
  datasetIds: string[];
  question: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface LearningStore {
  /** False for the no-op store: callers skip all memory work. */
  readonly enabled: boolean;
  /** Batch retain; groups by bank internally. Throws when the server refused. */
  retain(signals: MemorySignal[]): Promise<void>;
  /** Never throws: a timeout or an error is "no memories". */
  recall(query: RecallQuery): Promise<RecalledMemory[]>;
  /** Models with non-empty content only. Never throws. */
  mentalModels(datasourceId: string, timeoutMs: number): Promise<MentalModel[]>;
  /** Delete one retained document. Never throws. */
  forget(datasourceId: string, documentId: string): Promise<void>;
}
