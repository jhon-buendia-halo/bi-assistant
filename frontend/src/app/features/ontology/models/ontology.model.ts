/**
 * The dataset ontology (BA-320, ADR-0036). Mirrors
 * `backend/src/modules/ontology/entities/ontology-item.entity.ts` — the
 * contract is docs/plans/ba-320-dataset-ontology.md.
 */
export type OntologyKind = 'concept' | 'relation' | 'constraint' | 'instruction';
export type OntologySource = 'user' | 'mined';
export type RelationType =
  | 'is-a'
  | 'part-of'
  | 'has-many'
  | 'related-to'
  | 'measured-by';

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
  /** Dataset name; null = shared by every dataset ("All datasets"). */
  dataset: string | null;
  kind: OntologyKind;
  name: string;
  description: string;
  enabled: boolean;
  /** 'mined' items are AI-suggested and arrive disabled, pending approval. */
  source: OntologySource;
  synonyms?: string[];
  mappings?: ConceptMapping[];
  predicate?: string;
  conceptId?: string;
  entities?: string[];
  from?: string;
  type?: RelationType;
  to?: string;
  metricId?: string;
  createdAt: string;
  updatedAt: string;
}

/** Create body: the kind's fields plus `enabled?` and `shared?`. */
export interface OntologyItemInput {
  kind: OntologyKind;
  name?: string;
  description?: string;
  enabled?: boolean;
  shared?: boolean;
  synonyms?: string[];
  mappings?: ConceptMapping[];
  predicate?: string;
  conceptId?: string;
  entities?: string[];
  from?: string;
  type?: RelationType;
  to?: string;
  metricId?: string;
}

/** PATCH body — partial; `kind` and `shared` cannot change. */
export type OntologyItemPatch = Partial<Omit<OntologyItemInput, 'kind' | 'shared'>>;

export const ONTOLOGY_KINDS: {
  value: OntologyKind;
  label: string;
  /** Section heading in the Ontology tab. */
  section: string;
  description: string;
}[] = [
  {
    value: 'concept',
    label: 'Concept',
    section: 'Concepts',
    description:
      'A business concept: what a piece of domain language means and which entities, columns or expressions it maps to.',
  },
  {
    value: 'relation',
    label: 'Relation',
    section: 'Relations',
    description:
      'How two concepts connect (is-a, part-of, has-many, related-to), or the governed metric a concept is measured by.',
  },
  {
    value: 'constraint',
    label: 'Constraint',
    section: 'Constraints',
    description:
      'A SQL predicate applied by default to every query — e.g. excluding test accounts or soft-deleted rows — unless a question asks otherwise.',
  },
  {
    value: 'instruction',
    label: 'Instruction',
    section: 'Instructions',
    description:
      'A rule the assistant follows when answering — formatting conventions, data quirks or coverage facts such as which years the data spans.',
  },
];

export function ontologyKindLabel(kind: OntologyKind): string {
  return ONTOLOGY_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export function ontologyKindDescription(kind: OntologyKind): string {
  return ONTOLOGY_KINDS.find((k) => k.value === kind)?.description ?? '';
}

/** Tailwind color accent per kind, echoing the catalog/schema/entity coding. */
export function ontologyKindAccentClass(kind: OntologyKind): string {
  switch (kind) {
    case 'concept':
      return 'text-on-warning-soft';
    case 'relation':
      return 'text-on-info-soft';
    case 'constraint':
      return 'text-on-success-soft';
    case 'instruction':
      return 'text-accent';
  }
}

/** A mined suggestion not yet accepted. */
export function isPending(item: OntologyItem): boolean {
  return item.source === 'mined' && !item.enabled;
}

/** How one concept mapping reads: `entity.column`, `expr`, or `expr (entity.column)`. */
export function mappingLabel(mapping: ConceptMapping): string {
  const ref = mapping.column ? `${mapping.entity}.${mapping.column}` : '';
  if (mapping.expression && ref) return `${mapping.expression} (${ref})`;
  if (mapping.expression) return mapping.expression;
  return ref || mapping.entity;
}

/* ---- Legacy tags in the chat's "Ontology in context" list ---- */

/** The per-turn context keeps the old line tags (`KnowledgeUse.kind`). */
export type LegacyOntologyTag =
  | 'term'
  | 'default_filter'
  | 'instruction'
  | 'relation';

const LEGACY_TAG_KIND: Record<LegacyOntologyTag, OntologyKind> = {
  term: 'concept',
  default_filter: 'constraint',
  instruction: 'instruction',
  relation: 'relation',
};

export function legacyTagKind(tag: string): OntologyKind | null {
  return LEGACY_TAG_KIND[tag as LegacyOntologyTag] ?? null;
}

export function legacyTagLabel(tag: string): string {
  const kind = legacyTagKind(tag);
  return kind ? ontologyKindLabel(kind) : tag;
}

export function legacyTagDescription(tag: string): string {
  const kind = legacyTagKind(tag);
  return kind ? ontologyKindDescription(kind) : '';
}

export function legacyTagAccentClass(tag: string): string {
  const kind = legacyTagKind(tag);
  return kind ? ontologyKindAccentClass(kind) : 'text-fg-muted';
}
