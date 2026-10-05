import type {
  KnowledgeSnippetKind,
  KnowledgeSnippetScope,
} from '../entities/knowledge-snippet.entity';

/** Create payload for a curated knowledge snippet. */
export class CreateKnowledgeSnippetDto {
  kind: KnowledgeSnippetKind;
  /** Omit or pass `null` for a global snippet. */
  scope?: KnowledgeSnippetScope | null;
  title: string;
  body: string;
  synonyms?: string[];
  entities?: string[];
  /** See `KnowledgeSnippet.column` — only valid when `entities` has exactly one member. */
  column?: string;
  enabled?: boolean;
}
