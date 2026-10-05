/**
 * Genie-style curated knowledge: business-glossary terms, standing
 * instructions, and default filters an analyst wants the assistant to treat
 * as authoritative over anything it infers from schema alone.
 *
 * `scope.datasetId` is a dataset's `name` — datasets have no separate `id`
 * field (`DatasetsRepository` upserts by name; `SessionDoc.datasets` is a
 * list of names), so `name` is the identifier used everywhere a dataset is
 * referenced, including here.
 */
export type KnowledgeSnippetKind = 'instruction' | 'term' | 'default_filter';
export type KnowledgeSnippetSource = 'user' | 'mined' | 'feedback';

export const KNOWLEDGE_SNIPPET_KINDS: KnowledgeSnippetKind[] = [
  'instruction',
  'term',
  'default_filter',
];

export interface KnowledgeSnippetScope {
  datasetId?: string;
  datasourceId?: string;
}

/**
 * Where a learned lesson came from. `block` is a `ReasoningBlockKind`, typed
 * as `string` to keep this entity free of expert-mode imports.
 */
export interface LessonProvenance {
  feedbackId: string;
  sessionId: string;
  messageAt: string;
  block: string;
  question: string;
  comment: string;
  vote?: 'up' | 'down';
  learnedAt: string;
  method: 'agent' | 'verbatim';
}

export interface KnowledgeSnippet {
  id: string;
  kind: KnowledgeSnippetKind;
  /** `null` = global (applies regardless of which dataset is in scope). */
  scope: KnowledgeSnippetScope | null;
  /** Term name for `'term'`, short label otherwise. */
  title: string;
  /** Definition / instruction / SQL expression + when to apply it. */
  body: string;
  synonyms?: string[];
  /** Fully-qualified `catalog.schema.table` bindings, e.g. `world_cup.world_cup.matches`. */
  entities?: string[];
  /**
   * A column name on the snippet's one entity — set only when `entities` has
   * exactly one member (enforced by `KnowledgeService`). Lets the snippet be
   * rendered inline next to that column (`describe_entity`, schema cards,
   * `KnowledgeService.knowledgeByColumn`) instead of only in the separate
   * Knowledge block.
   */
  column?: string;
  /** Only enabled snippets are injected into the assistant's context. */
  enabled: boolean;
  source: KnowledgeSnippetSource;
  /** Set only for `source: 'feedback'` — where the lesson was distilled from. */
  provenance?: LessonProvenance;
  createdAt: string;
  updatedAt: string;
}

/** Create payload — `id`, `source` and timestamps are owned by the service. */
export interface KnowledgeSnippetInput {
  kind: KnowledgeSnippetKind;
  scope?: KnowledgeSnippetScope | null;
  title: string;
  body: string;
  synonyms?: string[];
  entities?: string[];
  /** See `KnowledgeSnippet.column` — only valid when `entities` has exactly one member. */
  column?: string;
  enabled?: boolean;
}

/** A draft mined by the bootstrap agent, before it is persisted. */
export interface KnowledgeSnippetDraft {
  kind: KnowledgeSnippetKind;
  title: string;
  body: string;
  synonyms?: string[];
  entities?: string[];
}

/**
 * A snippet as it was handed to the assistant for one turn. Recorded at
 * context-assembly time, not inferred afterwards: only snippets that actually
 * fit inside the block's character budget are captured, so the trail can
 * never claim knowledge the model never saw.
 */
export interface KnowledgeUse {
  id: string;
  kind: KnowledgeSnippetKind;
  title: string;
  /** The body exactly as it appeared in the block. */
  body: string;
  /** Dataset the snippet is scoped to; absent for a global snippet. */
  datasetId?: string;
  /** Set by `toKnowledgeUse` — surfaces a learned lesson to the caller. */
  source?: KnowledgeSnippetSource;
}
