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
}

/** One version in an artifact's history. */
export interface ArtifactVersionInfo {
  version: number;
  createdAt: string;
  instruction?: string;
  rowCount?: number;
  widgetCount: number;
  filterCount: number;
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
