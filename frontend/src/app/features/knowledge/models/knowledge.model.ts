export type KnowledgeSnippetKind = 'instruction' | 'term' | 'default_filter';
export type KnowledgeSnippetSource = 'user' | 'mined';

export interface KnowledgeScope {
  datasetId?: string;
  datasourceId?: string;
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
  enabled: boolean;
  /** 'mined' snippets are AI-suggested and arrive disabled, pending approval. */
  source: KnowledgeSnippetSource;
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
      return 'text-accent';
    case 'term':
      return 'text-on-warning-soft';
    case 'default_filter':
      return 'text-on-success-soft';
  }
}
