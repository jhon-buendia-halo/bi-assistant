/**
 * A dataset's ontology (ADR-0036; docs/plans/ba-320-dataset-ontology.md):
 * the concepts its data talks about, how they relate, the standing
 * constraints and the instructions an analyst wants the assistant to treat as
 * authoritative over anything it infers from schema alone.
 *
 * `dataset` is a dataset's `name` (datasets are identified by name — see
 * `DatasetsRepository`); `null` makes the item shared by every dataset.
 */
export type OntologyKind =
  'concept' | 'relation' | 'constraint' | 'instruction';
export const ONTOLOGY_KINDS: OntologyKind[] = [
  'concept',
  'relation',
  'constraint',
  'instruction',
];
export type OntologySource = 'user' | 'mined';
export type RelationType =
  'is-a' | 'part-of' | 'has-many' | 'related-to' | 'measured-by';
export const RELATION_TYPES: RelationType[] = [
  'is-a',
  'part-of',
  'has-many',
  'related-to',
  'measured-by',
];
export interface ConceptMapping {
  entity: string;
  column?: string;
  expression?: string;
}
export interface OntologyItem {
  id: string;
  dataset: string | null; // dataset name; null = shared by every dataset
  kind: OntologyKind;
  name: string;
  description: string; // '' when not given
  enabled: boolean;
  source: OntologySource;
  synonyms?: string[]; // concept only; omitted when empty
  mappings?: ConceptMapping[]; // concept only; omitted when empty
  predicate?: string; // constraint only (required)
  conceptId?: string; // constraint only, optional
  entities?: string[]; // constraint and instruction; omitted when empty
  from?: string; // relation: concept id
  type?: RelationType; // relation
  to?: string; // relation: concept id (not measured-by)
  metricId?: string; // relation: measured-by only
  ownerId?: string; // legacy, inert ('local')
  createdAt: string;
  updatedAt: string;
}

/**
 * Create / update payload, untyped on purpose: `OntologyService` validates
 * and normalizes every field for the item's kind, and drops the fields that
 * do not belong to it. On update only the keys present are applied.
 */
export interface OntologyItemInput {
  kind?: unknown;
  name?: unknown;
  description?: unknown;
  enabled?: unknown;
  /** Create only: `true` stores the item with `dataset: null`. */
  shared?: unknown;
  synonyms?: unknown;
  mappings?: unknown;
  predicate?: unknown;
  conceptId?: unknown;
  entities?: unknown;
  from?: unknown;
  type?: unknown;
  to?: unknown;
  metricId?: unknown;
}

/** The kind tag an item carries in the per-turn block and the trail. */
export type KnowledgeUseKind =
  'term' | 'default_filter' | 'instruction' | 'relation';

/**
 * An ontology item as it was handed to the assistant for one turn. Recorded
 * at context-assembly time, not inferred afterwards: only items that actually
 * fit inside the block's character budget are captured, so the trail can
 * never claim knowledge the model never saw. Stored on a message as
 * `knowledge`; the shape predates the ontology and is kept.
 */
export interface KnowledgeUse {
  id: string;
  kind: KnowledgeUseKind;
  /** The item's name. */
  title: string;
  /** Description (concept, instruction), predicate (constraint) or `"<from> <type> <to>"` (relation). */
  body: string;
  /** Dataset the item belongs to; absent for a shared item. */
  datasetId?: string;
}
