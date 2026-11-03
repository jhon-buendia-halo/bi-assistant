/**
 * The cross-session memory as the rest of the app sees it (ADR-0031,
 * agents.md 2.1). Sessions, the memory outbox and the memory eval depend on
 * this port only; `MastraLearningStore` is the one implementation.
 *
 * Self-contained on purpose: no imports, so the memory eval can carry a
 * byte-identical copy of this file.
 */

/** Injection token of the one `LearningStore`. */
export const LEARNING_STORE = 'LEARNING_STORE';

/** What a person's judgement of an answer taught (knowledge R31). */
export type LearningSignalKind = 'verified_query' | 'correction' | 'rejection';

/** One signal on its way into a learning memory. */
export interface LearningSignal {
  /**
   * The signal's identity in the memory: `rating:<sessionId>:<messageAt>` or
   * `correction:<sessionId>:<messageAt>` (data-model 3.15). Retaining an id
   * already stored replaces it.
   */
  documentId: string;
  kind: LearningSignalKind;
  /** The text of knowledge R33, redacted and clipped by R32. */
  content: string;
  /** ISO time of the rated answer; the memory stores the signal at it. */
  occurredAt: string;
  metadata: {
    datasourceId?: string;
    datasetIds: string[];
    /** `catalog.schema.table` names, for provenance. */
    entities: string[];
  };
}

/** A stored signal a recall found relevant, as stored. */
export interface RecalledSignal {
  documentId: string;
  kind: LearningSignalKind;
  content: string;
  occurredAt: string;
}

/** One item a store holds for a scope, as text (for audits and the eval). */
export interface LearningStoreItem {
  /**
   * `signal`: a signal as stored; `index`: another copy of a signal's text
   * the store keeps (a vector index's metadata); `summary`; `fact` and
   * `observation`: what a store that extracts facts derived.
   */
  kind: 'signal' | 'index' | 'summary' | 'fact' | 'observation';
  /** The signal's document id, when the item belongs to one signal. */
  documentId?: string;
  text: string;
}

/** One model call the memory made itself, with what the provider reported. */
export interface MemoryModelUsage {
  /** The scope of the operation that caused the call. */
  scope: string;
  purpose: 'embedding' | 'summary';
  /** The model id without provider prefix, lower case. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}

/**
 * A scope is an opaque key: a datasource id for a user's memory (knowledge
 * R35), or `eval-…` for one attempt of the memory eval.
 */
export interface LearningStore {
  /**
   * Store signals, each at its own time. A signal whose document id is
   * already stored replaces it, leaving one copy. Resolves once they can be
   * recalled; throws when refused (no embedding key, a store error).
   */
  retain(scope: string, signals: LearningSignal[]): Promise<void>;

  /**
   * The stored signals relevant to the question after the relevance filter,
   * oldest first, a text found twice kept once. Never throws: an error, or
   * the cut-off at 2.5 seconds, is nothing.
   */
  recall(scope: string, question: string): Promise<RecalledSignal[]>;

  /**
   * The scope's summary as last written (knowledge R42), or null; null too
   * after a forget until it is rewritten. Never waits for a rewrite; never
   * throws.
   */
  mentalModels(scope: string): Promise<string | null>;

  /**
   * Delete one signal by its document id, or with no id the whole scope,
   * with every copy of their text the store keeps (embeddings and the
   * index's copy) and, for a whole scope, its summary. Resolves once the
   * store's background deletes are done; compacting the file afterwards is
   * the caller's. Never throws. The caller deletes outbox rows first.
   */
  forget(scope: string, documentId?: string): Promise<void>;

  /**
   * Every item the store holds for the scope, as text: its signals as
   * stored, every other copy of their text, its summary and, for a store
   * that extracts facts, its facts and observations. Throws when the store
   * cannot be read.
   */
  items(scope: string): Promise<LearningStoreItem[]>;

  /**
   * Resolves once the scope's background work (signals being stored, a
   * summary rewrite) is done.
   */
  settle(scope: string): Promise<void>;

  /**
   * Subscribe to the store's own model calls (each embedding, each summary
   * rewrite), one event per call. Returns the unsubscribe function. Never
   * throws; a listener that throws does not break the store.
   */
  onUsage(listener: (usage: MemoryModelUsage) => void): () => void;
}
