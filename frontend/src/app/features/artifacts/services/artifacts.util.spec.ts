import { ArtifactSummary } from '../models/artifact.model';
import { artifactGroupLabel, groupArtifacts } from './artifacts.util';

function artifact(id: string, kind: string): ArtifactSummary {
  return {
    id,
    kind: kind as ArtifactSummary['kind'],
    name: id,
    description: '',
    widgetCount: 1,
    filterCount: 0,
    hasImage: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('groupArtifacts', () => {
  it('makes one section per kind that has artifacts, keeping their order', () => {
    const groups = groupArtifacts([
      artifact('b', 'dashboard'),
      artifact('a', 'dashboard'),
    ]);
    expect(groups.map((group) => [group.kind, group.label])).toEqual([
      ['dashboard', 'Dashboards'],
    ]);
    expect(groups[0].artifacts.map((item) => item.id)).toEqual(['b', 'a']);
    expect(groupArtifacts([])).toEqual([]);
  });

  it('puts the known kinds first and any other after, by name', () => {
    const groups = groupArtifacts([
      artifact('r', 'report'),
      artifact('d', 'dashboard'),
      artifact('g', 'glossary'),
    ]);
    expect(groups.map((group) => group.kind)).toEqual([
      'dashboard',
      'glossary',
      'report',
    ]);
    // A kind with no label of its own is shown by its name.
    expect(artifactGroupLabel('report')).toBe('report');
  });
});
