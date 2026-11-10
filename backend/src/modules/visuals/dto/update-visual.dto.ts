/** Partial update: omitted fields keep their value. */
export class UpdateVisualDto {
  name?: string;
  category?: string;
  previewKey?: string;
  rendererForm?: string | null;
  description?: string;
  whenToUse?: string;
  whenToAvoid?: string;
  dataShape?: string;
  enabled?: boolean;
}
