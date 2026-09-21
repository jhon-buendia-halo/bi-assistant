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

export const KNOWLEDGE_KINDS: { value: KnowledgeSnippetKind; label: string }[] =
  [
    { value: 'instruction', label: 'Instruction' },
    { value: 'term', label: 'Term' },
    { value: 'default_filter', label: 'Default filter' },
  ];

export function kindLabel(kind: KnowledgeSnippetKind): string {
  return KNOWLEDGE_KINDS.find((k) => k.value === kind)?.label ?? kind;
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
