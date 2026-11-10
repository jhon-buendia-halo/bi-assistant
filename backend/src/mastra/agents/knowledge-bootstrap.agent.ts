import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { resolveAgentModel } from '../model-resolver';
import { agentInstructions } from '../agent-prompt-overrides';
import {
  MAX_BOOTSTRAP_DRAFTS,
  KNOWLEDGE_BOOTSTRAP_PROMPT,
} from './system-prompts';

export { MAX_BOOTSTRAP_DRAFTS };

/** Relation types a draft may use — mirrors `RELATION_TYPES` in the ontology
 * entity (mirrored, not imported: this file has no Nest DI, same reasoning
 * as `tool-services.ts`). */
export const ontologyRelationTypeSchema = z.enum([
  'is-a',
  'part-of',
  'has-many',
  'related-to',
  'measured-by',
]);

const entitiesSchema = z
  .array(z.string())
  .optional()
  .describe(
    'Fully-qualified catalog.schema.table entities this draft applies to, taken from <entity-schemas>',
  );

export const conceptDraftSchema = z.object({
  kind: z.literal('concept'),
  name: z
    .string()
    .describe(
      'The business concept, as an analyst would say it (e.g. "Customer")',
    ),
  description: z
    .string()
    .describe(
      'What the concept means in this data; for an enum-like column, its code-to-meaning mapping',
    ),
  synonyms: z
    .array(z.string())
    .optional()
    .describe('Other names or phrasings the concept is known by'),
  mappings: z
    .array(
      z.object({
        entity: z
          .string()
          .describe('A fully-qualified table listed in <entity-schemas>'),
        column: z
          .string()
          .optional()
          .describe('A column of that table, exactly as listed'),
        expression: z
          .string()
          .optional()
          .describe(
            'A SQL expression over that table, when no single column carries the concept',
          ),
      }),
    )
    .optional()
    .describe('Where the concept lives in the schema'),
});

export const relationDraftSchema = z.object({
  kind: z.literal('relation'),
  from: z
    .string()
    .describe('Name of a concept drafted in this run or listed as existing'),
  type: ontologyRelationTypeSchema.describe(
    'How "from" connects: is-a, part-of, has-many, related-to, or measured-by a governed metric',
  ),
  to: z
    .string()
    .optional()
    .describe('Name of the target concept (every type except measured-by)'),
  metric: z
    .string()
    .optional()
    .describe('Name of a metric listed in <metrics> (measured-by only)'),
});

export const constraintDraftSchema = z.object({
  kind: z.literal('constraint'),
  name: z.string().describe('Short label for the default filter'),
  predicate: z
    .string()
    .describe(
      'The SQL predicate to apply by default, over listed columns only',
    ),
  description: z.string().optional().describe('When to apply the predicate'),
  entities: entitiesSchema,
});

export const instructionDraftSchema = z.object({
  kind: z.literal('instruction'),
  name: z.string().describe('Short label for the instruction'),
  description: z
    .string()
    .describe(
      'The standing instruction: a data quirk, formatting convention or coverage fact',
    ),
  entities: entitiesSchema,
});

/** One mined ontology draft, discriminated on `kind`. */
export const ontologyDraftSchema = z.discriminatedUnion('kind', [
  conceptDraftSchema,
  relationDraftSchema,
  constraintDraftSchema,
  instructionDraftSchema,
]);

export type OntologyDraft = z.infer<typeof ontologyDraftSchema>;

export const knowledgeBootstrapOutputSchema = z.object({
  // No `.max()`: a model that overshoots must not fail the whole run on
  // structured-output validation; the service keeps the first
  // MAX_BOOTSTRAP_DRAFTS (agents.md 2.5).
  drafts: z
    .array(ontologyDraftSchema)
    .describe(
      `Up to ${MAX_BOOTSTRAP_DRAFTS} ontology drafts, concepts before the relations that use them`,
    ),
});

/**
 * Drafts a first pass of a dataset's ontology from its schema, sample rows,
 * column references and governed metrics: concepts mapped to columns, the
 * relations between them, default-filter constraints and standing
 * instructions — the same shapes a user authors in the dataset's Ontology
 * tab. Drafts persist disabled (`source: 'mined'`) so a human reviews and
 * opts each one in. Single step, no tools, structured output, on the same
 * configured model the assistant runs on (see ../model-resolver). The id
 * stays `knowledge-bootstrap`: in-app prompt overrides are keyed by it.
 */
export const knowledgeBootstrapAgent = new Agent({
  id: 'knowledge-bootstrap',
  name: 'Ontology Bootstrap',
  description:
    "Drafts a dataset's ontology — concepts, relations, constraints and instructions — from its schema, sample rows, column references and governed metrics.",
  // The shipped prompt, or the in-app override (ADR-0026).
  instructions: () =>
    agentInstructions('knowledge-bootstrap', KNOWLEDGE_BOOTSTRAP_PROMPT),
  // Same configured model as the analysis agent; see ../model-resolver.
  model: async () => resolveAgentModel(),
});
