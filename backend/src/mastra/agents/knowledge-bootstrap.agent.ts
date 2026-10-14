import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { resolveAgentModel } from '../model-resolver';
import { agentInstructions } from '../agent-prompt-overrides';
import {
  MAX_BOOTSTRAP_DRAFTS,
  KNOWLEDGE_BOOTSTRAP_PROMPT,
} from './system-prompts';

export { MAX_BOOTSTRAP_DRAFTS };

export const knowledgeSnippetKindSchema = z.enum([
  'instruction',
  'term',
  'default_filter',
]);

/** One mined draft — matches `KnowledgeSnippetDraft` (mirrored, not imported:
 * this file has no Nest DI, same reasoning as `tool-services.ts`). */
export const knowledgeDraftSchema = z.object({
  kind: knowledgeSnippetKindSchema.describe(
    '"term" for a business-glossary entry or enum-like column value, ' +
      '"instruction" for a formatting convention, data quirk, or coverage ' +
      'fact, "default_filter" for a SQL predicate to apply by default',
  ),
  title: z
    .string()
    .describe(
      'Short label — the term name for a "term" draft, a short label otherwise',
    ),
  body: z
    .string()
    .describe(
      'The definition/instruction, or for a default_filter the SQL predicate plus when to apply it',
    ),
  synonyms: z
    .array(z.string())
    .optional()
    .describe('Alternate names/phrasings this term is also known by'),
  entities: z
    .array(z.string())
    .optional()
    .describe(
      'Fully-qualified catalog.schema.table entities this draft is about, if any',
    ),
});

export const knowledgeBootstrapOutputSchema = z.object({
  drafts: z
    .array(knowledgeDraftSchema)
    .max(MAX_BOOTSTRAP_DRAFTS)
    .describe(`Up to ${MAX_BOOTSTRAP_DRAFTS} draft knowledge snippets`),
});

/**
 * Mines a first pass of curated knowledge from a dataset's schema and sample
 * data: business-glossary terms, standing instructions and default filters —
 * the same shapes a user would author by hand in the knowledge store, but
 * seeded from what the data itself shows. Drafts persist disabled
 * (`source: 'mined'`) so a human reviews and opts each one in. Single step,
 * no tools, structured output, on the same configured model the assistant
 * runs on (see ../model-resolver).
 */
export const knowledgeBootstrapAgent = new Agent({
  id: 'knowledge-bootstrap',
  name: 'Knowledge Bootstrap',
  description:
    "Mines business-glossary terms, instructions and coverage facts from a dataset's schema and sample rows.",
  // The shipped prompt, or the in-app override (ADR-0025).
  instructions: () =>
    agentInstructions('knowledge-bootstrap', KNOWLEDGE_BOOTSTRAP_PROMPT),
  // Same configured model as the analysis agent; see ../model-resolver.
  model: async () => resolveAgentModel(),
});
