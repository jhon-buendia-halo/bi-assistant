/** Body of `POST /knowledge/bootstrap`. */
export class BootstrapKnowledgeDto {
  /** The dataset's `name` (datasets have no separate id — see the entity). */
  datasetId: string;
}
