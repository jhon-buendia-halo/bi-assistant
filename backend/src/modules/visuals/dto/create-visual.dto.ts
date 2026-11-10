/** Create payload for a visuals library chart. Validated in `VisualsService`. */
export class CreateVisualDto {
  name: string;
  category: string;
  previewKey?: string;
  rendererForm?: string | null;
  description?: string;
  whenToUse?: string;
  whenToAvoid?: string;
  dataShape?: string;
  enabled?: boolean;
}
