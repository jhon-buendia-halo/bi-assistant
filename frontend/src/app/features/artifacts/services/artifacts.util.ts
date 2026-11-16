import { ArtifactSummary } from '../models/artifact.model';

/** `<n> widgets · <n> filters`, singular for one. */
export function artifactCountsLabel(
  artifact: Pick<ArtifactSummary, 'widgetCount' | 'filterCount'>,
): string {
  const widgets = `${artifact.widgetCount} ${artifact.widgetCount === 1 ? 'widget' : 'widgets'}`;
  const filters = `${artifact.filterCount} ${artifact.filterCount === 1 ? 'filter' : 'filters'}`;
  return `${widgets} · ${filters}`;
}

/** The chip's text for a kind. */
export function artifactKindLabel(kind: ArtifactSummary['kind']): string {
  return kind === 'dashboard' ? 'Dashboard' : kind;
}

/** The heading of a kind's section: its plural. */
export function artifactGroupLabel(kind: string): string {
  return kind === 'dashboard' ? 'Dashboards' : kind;
}

/** The kinds the Artifacts page shows first, in order; any other follows. */
const KIND_ORDER: readonly string[] = ['dashboard'];

/** One section of the Artifacts page: the artifacts of one kind. */
export interface ArtifactGroup {
  kind: string;
  label: string;
  artifacts: ArtifactSummary[];
}

/**
 * The artifacts grouped by kind, a section per kind that has any: the known
 * kinds in their order, then any other by name. Within a section the
 * artifacts keep the order given (newest first).
 */
export function groupArtifacts(
  artifacts: readonly ArtifactSummary[],
): ArtifactGroup[] {
  const byKind = new Map<string, ArtifactSummary[]>();
  for (const artifact of artifacts) {
    const group = byKind.get(artifact.kind);
    if (group) group.push(artifact);
    else byKind.set(artifact.kind, [artifact]);
  }
  const rank = (kind: string) => {
    const at = KIND_ORDER.indexOf(kind);
    return at < 0 ? KIND_ORDER.length : at;
  };
  return [...byKind.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((kind) => ({
      kind,
      label: artifactGroupLabel(kind),
      artifacts: byKind.get(kind) ?? [],
    }));
}

/** The artifacts whose name or description contains the query. */
export function filterArtifacts(
  artifacts: readonly ArtifactSummary[],
  query: string,
): ArtifactSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...artifacts];
  return artifacts.filter(
    (artifact) =>
      artifact.name.toLowerCase().includes(q) ||
      artifact.description.toLowerCase().includes(q),
  );
}
