/** The kinds of artifact the app stores; the first is a dashboard's blueprint. */
export type ArtifactKind = 'dashboard';

/** One artifact as `GET /artifacts` lists it. */
export interface ArtifactSummary {
  id: string;
  kind: ArtifactKind;
  /** 1..80 characters, trimmed. */
  name: string;
  /** The blueprint's summary; may be ''. */
  description: string;
  widgetCount: number;
  filterCount: number;
  /** Whether `GET /artifacts/:id/image` answers the original image. */
  hasImage: boolean;
  /** The run it was saved from. */
  source?: { runId: string; workflowId: string };
  createdAt: string;
  updatedAt: string;
  /** Live dashboards: the current version, how many exist, whether it has data. */
  currentVersion?: number;
  versionCount?: number;
  hasData?: boolean;
}

/** A Clara dashboard is a draft until a version is saved (api.md 145, 164). */
export type ArtifactStatus = 'draft' | 'saved';

/** One artifact with its blueprint and its document. */
export interface Artifact extends ArtifactSummary {
  /** The dashboard as data (opaque to the UI). */
  blueprint: Record<string, unknown>;
  /** A self-contained HTML document, shown in a sandboxed iframe. */
  document: string;
  /** The version shown (the current one when none was asked). */
  version?: number;
  versions?: ArtifactVersionInfo[];
  /** The version was built before data snapshots: drawn with the mock. */
  dataMissing?: true;
  /** `draft` while no version is saved (api.md 145). */
  status?: ArtifactStatus;
  /** The versions saved to Artifacts, the only ones listed and downloaded. */
  savedVersions?: number[];
}

/**
 * Whether `version` of the artifact is saved: an artifact without versions
 * (an image's blueprint) is; a versioned one only for the versions it lists
 * as saved (api.md 145, 164). An answer with no save information at all
 * (`savedVersions` absent, no version marked) predates drafts: all saved.
 */
export function isVersionSaved(
  artifact: Pick<Artifact, 'versions' | 'savedVersions'>,
  version: number,
): boolean {
  if (artifact.versions === undefined) return true;
  if (
    artifact.savedVersions === undefined &&
    artifact.versions.every((v) => v.saved === undefined)
  )
    return true;
  if (artifact.savedVersions?.includes(version)) return true;
  return artifact.versions.some((v) => v.version === version && v.saved);
}

/** One version in an artifact's history. */
export interface ArtifactVersionInfo {
  version: number;
  createdAt: string;
  instruction?: string;
  rowCount?: number;
  widgetCount: number;
  filterCount: number;
  /** Saved to Artifacts (api.md 145); a draft otherwise. */
  saved?: boolean;
}

/** The zip name a dashboard version downloads as: `<slug of the name>-v<N>.zip` (api.md 163). */
export function dashboardZipName(
  name: string,
  id: string,
  version: number,
): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64);
  return `${slug || `dashboard-${id.slice(0, 8)}`}-v${version}.zip`;
}
