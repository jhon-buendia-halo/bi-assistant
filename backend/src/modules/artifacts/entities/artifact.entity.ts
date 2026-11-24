import type {
  DashboardQuery,
  DashboardRow,
} from '../../../mastra/workflows/live-dashboard';
import type { DashboardBlueprint } from '../../../mastra/workflows/recreate-dashboard.steps';

export type { DashboardQuery, DashboardRow };

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
  /**
   * The version the artifact shows: a dashboard built on the user's data
   * gets a version per change. A doc without versions reads as version 1.
   */
  currentVersion?: number;
  /** Every version, oldest first; `blueprint` is the current one's. */
  versions?: ArtifactVersion[];
  /**
   * The versions the user saved to Artifacts. A dashboard a turn builds
   * starts with none: a draft, hidden from the list and not downloadable.
   * A doc without `versions` (Grace's, or saved before versions) has every
   * version saved; a doc with `versions` but no list has none saved.
   */
  savedVersions?: number[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * One version of a dashboard artifact. A live version keeps the query its
 * rows came from and names the file of the data dir that holds them
 * (`artifacts/<id>/v<N>/rows.json`, `{ columns, rows }`): the rows stay out
 * of the doc store.
 */
export interface ArtifactVersion {
  version: number;
  blueprint: DashboardBlueprint;
  query?: DashboardQuery;
  columns?: string[];
  rowCount?: number;
  dataFile?: string;
  /** What the user asked for that made this version. */
  instruction?: string;
  source?: { runId: string; workflowId: string };
  createdAt: string;
}

/** A dashboard a turn made or changed, as the answer card shows it. */
export interface DashboardRef {
  artifactId: string;
  version: number;
  title: string;
  action: 'created' | 'updated';
  widgetCount: number;
  filterCount: number;
  rowCount: number;
  /** Whether this version is saved to Artifacts; false from the turn. */
  saved: boolean;
}

/** A dashboard version as a turn reads it back to change it. */
export interface CurrentDashboard {
  artifactId: string;
  version: number;
  title: string;
  blueprint: DashboardBlueprint;
  query: DashboardQuery;
  columns: string[];
  rowCount: number;
  widgetCount: number;
  filterCount: number;
}

/**
 * A dashboard version with its rows (`null` when it has none, or its file
 * is gone). A version read from an image has no query.
 */
export type DashboardVersionData = Omit<CurrentDashboard, 'query'> & {
  query?: DashboardQuery;
  rows: DashboardRow[] | null;
  name: string;
  instruction?: string;
  createdAt: string;
};

/** An artifact as the list shows it (api.md 144). */
export interface ArtifactSummary {
  id: string;
  kind: ArtifactKind;
  name: string;
  description: string;
  widgetCount: number;
  filterCount: number;
  hasImage: boolean;
  source?: { runId: string; workflowId: string };
  /** The version the artifact shows; 1 for a doc without versions. */
  currentVersion: number;
  versionCount: number;
  /** Whether the current version is drawn on the user's data. */
  hasData: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One version as the version picker lists it. */
export interface ArtifactVersionSummary {
  version: number;
  createdAt: string;
  instruction?: string;
  rowCount?: number;
  widgetCount: number;
  filterCount: number;
  /** Whether the user saved this version to Artifacts. */
  saved: boolean;
}

/** An artifact with no saved version is a draft (api.md 145). */
export type ArtifactStatus = 'draft' | 'saved';

/**
 * An artifact in full at one version (api.md 145): the counts, description
 * and blueprint are that version's.
 */
export interface ArtifactDetail extends ArtifactSummary {
  /** The version shown. */
  version: number;
  /** `draft` while the artifact has no saved version. */
  status: ArtifactStatus;
  /** The saved versions, oldest first. */
  savedVersions: number[];
  versions: ArtifactVersionSummary[];
  /** The query the version's rows came from, for a live version. */
  query?: DashboardQuery;
  /** A live version whose rows file is gone: drawn on invented values. */
  dataMissing?: true;
  blueprint: DashboardBlueprint;
  /** The dashboard drawn by the fixed runtime, as a sandboxed document. */
  document: string;
}

/**
 * Whether an artifact is a draft: a dashboard a turn built that the user has
 * not saved to Artifacts yet. A doc without versions is never one.
 */
export function isDraft(
  doc: Pick<ArtifactDoc, 'versions' | 'savedVersions'>,
): boolean {
  return Array.isArray(doc.versions) && (doc.savedVersions ?? []).length === 0;
}

/**
 * Whether a version of an artifact is saved: every version of a doc without
 * versions is, else only those in `savedVersions`.
 */
export function isSavedVersion(
  doc: Pick<ArtifactDoc, 'versions' | 'savedVersions'>,
  version: number,
): boolean {
  if (!Array.isArray(doc.versions)) return true;
  return (doc.savedVersions ?? []).includes(version);
}
