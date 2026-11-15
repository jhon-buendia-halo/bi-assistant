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
