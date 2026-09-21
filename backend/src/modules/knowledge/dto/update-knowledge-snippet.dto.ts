import type {
  KnowledgeSnippetKind,
  KnowledgeSnippetScope,
} from '../entities/knowledge-snippet.entity';

/**
 * Partial update payload. Every field is optional and only the ones present
 * on the body are applied — `KnowledgeService.update` distinguishes "field
 * omitted" from "field explicitly cleared" by checking for the key's
 * presence, not by its value, so this stays a plain optional-field class
 * rather than `Partial<CreateKnowledgeSnippetDto>` losing that distinction.
 */
export class UpdateKnowledgeSnippetDto {
  kind?: KnowledgeSnippetKind;
  scope?: KnowledgeSnippetScope | null;
  title?: string;
  body?: string;
  synonyms?: string[];
  entities?: string[];
  enabled?: boolean;
}
