import type { DashboardBlueprint } from '../../../mastra/workflows/recreate-dashboard.steps';

/** The kinds of artifact the app stores (data-model 3.18). */
export const ARTIFACT_KINDS = ['dashboard'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** The longest name an artifact takes, in characters (trimmed). */
export const ARTIFACT_NAME_MAX_LENGTH = 80;

/**
 * A stored artifact (data-model 3.18): reusable context saved from a
 * workflow run. A `dashboard` artifact holds the blueprint a Recreate a
 * Dashboard run read from an image, so a later run can take it in place of
 * the image (agents.md 5.17).
 */
export interface ArtifactDoc {
  id: string;
  kind: ArtifactKind;
  name: string;
  /** The blueprint's summary. */
  description: string;
  blueprint: DashboardBlueprint;
  /**
   * The image the dashboard was read from, kept as a file of the data dir:
   * `artifacts/<file>`.
   */
  image?: { file: string; mediaType: string };
  /** The run it was saved from. */
  source?: { runId: string; workflowId: string };
  createdAt?: string;
  updatedAt?: string;
}

/** An artifact as the list shows it (api.md 139). */
export interface ArtifactSummary {
  id: string;
  kind: ArtifactKind;
  name: string;
  description: string;
  widgetCount: number;
  filterCount: number;
  hasImage: boolean;
  source?: { runId: string; workflowId: string };
  createdAt: string;
  updatedAt: string;
}

/** An artifact in full (api.md 140). */
export interface ArtifactDetail extends ArtifactSummary {
  blueprint: DashboardBlueprint;
  /** The dashboard drawn by the fixed runtime, as a sandboxed document. */
  document: string;
}
