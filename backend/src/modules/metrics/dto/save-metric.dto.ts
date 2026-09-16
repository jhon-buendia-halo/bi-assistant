/** Create/update payload for a curated metric definition. */
export class SaveMetricDto {
  name: string;
  label: string;
  entity: string;
  expression: string;
  description?: string;
  datasourceId?: string;
  dimensions?: string[];
  /** Verified query the draft was prefilled from, when promoted. */
  sourceVerifiedQueryId?: string;
}
