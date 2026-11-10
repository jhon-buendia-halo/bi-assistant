import type {
  ConceptMapping,
  OntologyKind,
  RelationType,
} from '../entities/ontology-item.entity';

/**
 * Body of `PATCH /ontology/:id`. Every field is optional and only the ones
 * present are validated and applied; `kind` may be sent but cannot change.
 */
export class UpdateOntologyItemDto {
  kind?: OntologyKind;
  name?: string;
  description?: string;
  enabled?: boolean;
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
