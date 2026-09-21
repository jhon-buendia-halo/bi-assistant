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
export type KnowledgeSnippetSource = 'user' | 'mined';

export const KNOWLEDGE_SNIPPET_KINDS: KnowledgeSnippetKind[] = [
  'instruction',
  'term',
  'default_filter',
];

export interface KnowledgeSnippetScope {
  datasetId?: string;
  datasourceId?: string;
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
  /** Only enabled snippets are injected into the assistant's context. */
  enabled: boolean;
  source: KnowledgeSnippetSource;
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
