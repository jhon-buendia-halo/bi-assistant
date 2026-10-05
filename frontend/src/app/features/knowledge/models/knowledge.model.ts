export type KnowledgeSnippetKind = 'instruction' | 'term' | 'default_filter';
export type KnowledgeSnippetSource = 'user' | 'mined' | 'feedback' | 'memory';

export interface KnowledgeScope {
  datasetId?: string;
  datasourceId?: string;
}

/**
 * Where a learned lesson came from — a reviewer's note on one block of one
 * answer. `block` is a `ReasoningBlockKind`, typed as `string` here to keep
 * this model free of an expert-mode import.
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
  /** null = applies globally, across every dataset. */
  scope: KnowledgeScope | null;
  title: string;
  body: string;
  synonyms?: string[];
  entities?: string[];
  /** A single column within `entities`, when the snippet describes exactly one. */
  column?: string;
  enabled: boolean;
  /** 'mined' snippets are AI-suggested and arrive disabled, pending approval. */
  source: KnowledgeSnippetSource;
  /** Present only when `source === 'feedback'` — the note it was learned from. */
  provenance?: LessonProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSnippetInput {
  kind: KnowledgeSnippetKind;
  scope?: KnowledgeScope | null;
  title: string;
  body: string;
  synonyms?: string[];
  entities?: string[];
  /** A single column within `entities`, when the snippet describes exactly one. */
  column?: string;
  enabled?: boolean;
}

export const KNOWLEDGE_KINDS: {
  value: KnowledgeSnippetKind;
  label: string;
  description: string;
}[] = [
  {
    value: 'instruction',
    label: 'Instruction',
    description:
      'A rule the assistant follows when answering — formatting conventions, data quirks (a column that is null instead of zero) or coverage facts such as which years or segments the data spans.',
  },
  {
    value: 'term',
    label: 'Term',
    description:
      'A business-glossary entry: what a piece of domain jargon or an enum-like column code means, so the assistant maps your words to the right columns and values.',
  },
  {
    value: 'default_filter',
    label: 'Default filter',
    description:
      'A SQL predicate applied by default to every query — e.g. excluding test accounts or soft-deleted rows — unless a question asks otherwise.',
  },
];

export function kindLabel(kind: KnowledgeSnippetKind): string {
  return KNOWLEDGE_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export function kindDescription(kind: KnowledgeSnippetKind): string {
  return KNOWLEDGE_KINDS.find((k) => k.value === kind)?.description ?? '';
}

/** Tailwind color accent per kind, echoing the catalog/schema/entity coding. */
export function kindAccentClass(kind: KnowledgeSnippetKind): string {
  switch (kind) {
    case 'instruction':
      return 'text-sky-400';
    case 'term':
      return 'text-amber-400';
    case 'default_filter':
      return 'text-emerald-400';
  }
}
