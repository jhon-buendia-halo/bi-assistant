/**
 * The shape of a sample's **knowledge seed** (testing-data R26): the knowledge
 * entries and metrics a synthetic domain sample ships about its data, created
 * by the loader after a successful load from the Testing Data panel.
 *
 * Pure data, like the registry that carries it: no Nest, no `pg`, no fs. The
 * only import is type-only, so it is erased at compile time and the DI-less
 * eval modules that import the registry stay dependency-free.
 *
 * Entities are written **two-segment**, `<schema>.<table>`: the catalog
 * segment is the database the user loads the sample into, which is only known
 * at load time, so the loader prefixes it (`<database>.<schema>.<table>`,
 * dataset-ontology R7) when it creates each entry.
 *
 * Every entry states a rule about the DATA (a column's vocabulary, a join path,
 * a coverage boundary, a unit, a standing filter), never a hint about one eval
 * question (R27). The non-obvious facts are verified against the loaded
 * sample, with the query and its result kept next to the fact; an entry
 * names only its entities, never a column, so an entry about one column names
 * the column in its body.
 *
 * The kinds are the block's tags (dataset-ontology R22): the loader creates a
 * `term` as a concept, a `default_filter` as a constraint and an
 * `instruction` as an instruction (`seedOntologyItem`).
 */
import type { KnowledgeUseKind } from '../../../ontology/entities/ontology-item.entity';

/** The kinds a seed entry may have. */
export type SeedKnowledgeKind = Extract<
  KnowledgeUseKind,
  'term' | 'default_filter' | 'instruction'
>;
export const SEED_KNOWLEDGE_KINDS: readonly SeedKnowledgeKind[] = [
  'term',
  'default_filter',
  'instruction',
];

export interface SeedKnowledgeEntry {
  kind: SeedKnowledgeKind;
  /** With `kind`, what makes an entry "held" (R26): unique within a seed. */
  title: string;
  body: string;
  synonyms?: string[];
  /** `<schema>.<table>`, each a table or view of the sample's `requiredTables`. */
  entities: string[];
}

export interface SeedMetric {
  /** Metric handle; names are unique across every metric (metrics R5). */
  name: string;
  label: string;
  description?: string;
  /** `<schema>.<table>`, a table or view of the sample's `requiredTables`. */
  entity: string;
  /** One SQL aggregation expression, no semicolon (metrics R4). */
  expression: string;
  dimensions?: string[];
}

export interface KnowledgeSeed {
  knowledge: SeedKnowledgeEntry[];
  metrics: SeedMetric[];
}
