import {
  formatAttributeRef,
  formatEntityRef,
  formatMetricRef,
  formatRelationshipRef,
  listRefs,
  parseRef,
  resolveRef,
} from './references';
import { worldCupFixture } from './__fixtures__/world-cup.fixture';
import type { DataModel } from '../entities/data-model.entity';

function fixture(): DataModel {
  return structuredClone(worldCupFixture());
}

describe('parseRef — grammar', () => {
  it('parses a bare entity reference', () => {
    expect(parseRef('teams')).toEqual({ kind: 'entity', entity: 'teams' });
  });

  it('parses an attribute reference', () => {
    expect(parseRef('matches.home_team_id')).toEqual({
      kind: 'attribute',
      entity: 'matches',
      attribute: 'home_team_id',
    });
  });

  it('parses a nested array attribute path, splitting only on the first dot', () => {
    expect(parseRef('teams.ratings[].score')).toEqual({
      kind: 'attribute',
      entity: 'teams',
      attribute: 'ratings[].score',
    });
  });

  it('parses a metric reference', () => {
    expect(parseRef('metric:avg_attendance')).toEqual({
      kind: 'metric',
      name: 'avg_attendance',
    });
  });

  it('parses a relationship reference by endpoints', () => {
    expect(parseRef('rel:matches.home_team_id->teams.team_id')).toEqual({
      kind: 'relationship',
      from: 'matches.home_team_id',
      to: 'teams.team_id',
    });
  });

  it('parses a relationship reference by name', () => {
    expect(parseRef('rel:matches_home_team')).toEqual({
      kind: 'relationship',
      name: 'matches_home_team',
    });
  });

  it.each(['', '   ', 'metric:', 'rel:', 'rel:a->'])(
    'returns null for the malformed ref %j',
    (ref) => {
      expect(parseRef(ref)).toBeNull();
    },
  );
});

describe('resolveRef', () => {
  const model = worldCupFixture();

  it('resolves an entity, case-insensitively, to its canonical ref', () => {
    const resolved = resolveRef(model, 'TEAMS');
    expect(resolved).toEqual({
      kind: 'entity',
      ref: 'teams',
      target: model.entities.find((e) => e.name === 'teams'),
    });
  });

  it('resolves an attribute, case-insensitively', () => {
    const resolved = resolveRef(model, 'Matches.Home_Team_Id');
    expect(resolved?.kind).toBe('attribute');
    expect(resolved?.ref).toBe('matches.home_team_id');
    if (resolved?.kind === 'attribute') {
      expect(resolved.target.entity.name).toBe('matches');
      expect(resolved.target.attribute.name).toBe('home_team_id');
    }
  });

  it('resolves a metric', () => {
    const resolved = resolveRef(model, 'metric:AVG_ATTENDANCE');
    expect(resolved).toEqual({
      kind: 'metric',
      ref: 'metric:avg_attendance',
      target: model.metrics.find((m) => m.name === 'avg_attendance'),
    });
  });

  it('resolves a relationship by name', () => {
    const resolved = resolveRef(model, 'rel:MATCHES_HOME_TEAM');
    expect(resolved).toEqual({
      kind: 'relationship',
      ref: 'rel:matches_home_team',
      target: model.relationships[0],
    });
  });

  it('resolves a relationship by its endpoints', () => {
    const resolved = resolveRef(
      model,
      'rel:MATCHES.home_team_id->TEAMS.team_id',
    );
    expect(resolved).toEqual({
      kind: 'relationship',
      ref: 'rel:matches_home_team',
      target: model.relationships[0],
    });
  });

  it('returns null for an unknown entity', () => {
    expect(resolveRef(model, 'players')).toBeNull();
  });

  it('returns null for an unknown attribute on a known entity', () => {
    expect(resolveRef(model, 'teams.nope')).toBeNull();
  });

  it('returns null for an unknown metric', () => {
    expect(resolveRef(model, 'metric:nope')).toBeNull();
  });

  it('returns null for an unknown relationship name', () => {
    expect(resolveRef(model, 'rel:nope')).toBeNull();
  });

  it('returns null for an unknown relationship endpoint pair', () => {
    expect(
      resolveRef(model, 'rel:teams.team_id->matches.home_team_id'),
    ).toBeNull();
  });

  it('returns null for a syntactically malformed ref', () => {
    expect(resolveRef(model, 'metric:')).toBeNull();
  });

  it('resolves a nested array attribute path', () => {
    const nested: DataModel = fixture();
    nested.entities[0].attributes.push({
      name: 'ratings[].score',
      type: 'number',
      role: 'measure',
    });
    const resolved = resolveRef(nested, 'teams.ratings[].score');
    expect(resolved?.kind).toBe('attribute');
    expect(resolved?.ref).toBe('teams.ratings[].score');
  });
});

describe('formatRef helpers', () => {
  const model = worldCupFixture();

  it('formats an entity ref', () => {
    expect(formatEntityRef(model.entities[0])).toBe('teams');
  });

  it('formats an attribute ref', () => {
    expect(
      formatAttributeRef(model.entities[1], model.entities[1].attributes[1]),
    ).toBe('matches.home_team_id');
  });

  it('formats a metric ref', () => {
    expect(formatMetricRef(model.metrics[0])).toBe('metric:avg_attendance');
  });

  it('formats a named relationship ref by name', () => {
    expect(formatRelationshipRef(model.relationships[0])).toBe(
      'rel:matches_home_team',
    );
  });

  it('formats an unnamed relationship ref by endpoints', () => {
    expect(
      formatRelationshipRef({
        from: 'matches.away_team_id',
        to: 'teams.team_id',
        cardinality: 'many_to_one',
        source: 'inferred',
      }),
    ).toBe('rel:matches.away_team_id->teams.team_id');
  });
});

describe('listRefs', () => {
  it('lists every entity, attribute, metric and relationship once, in canonical casing', () => {
    const model = worldCupFixture();
    const refs = listRefs(model);

    expect(refs).toEqual([
      'teams',
      'teams.team_id',
      'teams.name',
      'teams.fifa_code',
      'matches',
      'matches.match_id',
      'matches.home_team_id',
      'matches.away_team_id',
      'matches.winner_team_id',
      'matches.stage',
      'matches.attendance',
      'metric:avg_attendance',
      'metric:home_win_rate',
      'rel:matches_home_team',
    ]);
  });

  it('every listed ref resolves back to the element it names', () => {
    const model = worldCupFixture();
    for (const ref of listRefs(model)) {
      expect(resolveRef(model, ref)).not.toBeNull();
    }
  });
});
