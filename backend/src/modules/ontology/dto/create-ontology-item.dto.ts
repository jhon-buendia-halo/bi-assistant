import type {
  ConceptMapping,
  OntologyKind,
  RelationType,
} from '../entities/ontology-item.entity';

/**
 * Body of `POST /datasets/:name/ontology`. Only the fields of `kind` are
 * kept; `OntologyService` validates and normalizes them.
 */
export class CreateOntologyItemDto {
  kind: OntologyKind;
  name?: string;
  description?: string;
  /** Defaults to `true`. */
  enabled?: boolean;
  /** `true` stores the item for every dataset (`dataset: null`). */
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
