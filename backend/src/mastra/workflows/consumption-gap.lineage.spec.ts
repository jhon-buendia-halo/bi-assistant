import type { LayerTable } from './consumption-gap-analysis.schemas';
import type { GapQueryResult } from './consumption-gap-analysis.steps';
import {
  LINEAGE_MAX_CHECKS,
  gapDialectOf,
  lineageCandidates,
  lineageFromChecks,
  lineageQueries,
  normaliseName,
  tableReference,
  typeFamily,
  type LineageCandidate,
} from './consumption-gap.lineage';
import { GAP_SAMPLE_TABLES } from './consumption-gap.trace-sample';

const C = 'world_cup.wc_consumption';
const N = 'world_cup.wc_normalized';
const L = 'world_cup.wc_landing';

function find(
  candidates: readonly LineageCandidate[],
  from: string,
  to: string,
): LineageCandidate | undefined {
  return candidates.find(
    (c) =>
      `${c.from.entity}.${c.from.column}` === from &&
      `${c.to.entity}.${c.to.column}` === to,
  );
}

function result(
  id: string,
  row: Record<string, unknown> | undefined,
  error: string | null = null,
): GapQueryResult {
  return {
    id,
    columns: row ? Object.keys(row) : [],
    rows: row ? [row] : [],
    error,
  };
}

describe('normaliseName', () => {
  it('drops layer prefixes, storage suffixes and case', () => {
    expect(normaliseName('raw_matches')).toBe('matches');
    expect(normaliseName('fct_match_results')).toBe('match_results');
    expect(normaliseName('minute_str')).toBe('minute');
    expect(normaliseName('Stage_TXT')).toBe('stage');
    expect(normaliseName('v_agg_team_tournament')).toBe('team_tournament');
    expect(normaliseName('attendance_raw')).toBe('attendance');
  });

  it('keeps a name that is only a prefix or a suffix', () => {
    expect(normaliseName('raw_')).toBe('raw');
    expect(normaliseName('_str')).toBe('str');
  });
});

describe('typeFamily', () => {
  it('reads the four families', () => {
    expect(typeFamily('integer')).toBe('number');
    expect(typeFamily('numeric(10,2)')).toBe('number');
    expect(typeFamily('character varying')).toBe('text');
    expect(typeFamily('STRING')).toBe('text');
    expect(typeFamily('timestamp with time zone')).toBe('date');
    expect(typeFamily('date')).toBe('date');
    expect(typeFamily('boolean')).toBe('boolean');
    expect(typeFamily('jsonb')).toBe('other');
  });
});

describe('lineageCandidates', () => {
  const candidates = lineageCandidates(GAP_SAMPLE_TABLES);

  it('pairs Landing text with a typed Normalized column of the same name', () => {
    const edge = find(
      candidates,
      `${L}.raw_goals.minute_str`,
      `${N}.goals.minute`,
    );
    expect(edge).toMatchObject({ method: 'name' });
    // text → number lowers the confidence; the tables' names match.
    expect(edge?.confidence).toBeCloseTo(0.77, 2);
  });

  it('pairs Normalized with Consumption by name', () => {
    expect(
      find(candidates, `${N}.matches.stage`, `${C}.fct_match_results.stage`),
    ).toMatchObject({ method: 'name', confidence: 0.8 });
    expect(
      find(candidates, `${L}.raw_matches.stage_txt`, `${N}.matches.stage`),
    ).toMatchObject({ method: 'name', confidence: 0.9 });
  });

  it('finds similar names by token overlap', () => {
    expect(
      find(
        candidates,
        `${L}.raw_match_stats.possession_pct_str`,
        `${N}.match_team_statistics.possession`,
      ),
    ).toMatchObject({ method: 'similar-name' });
  });

  it('prefers pairs whose tables match too', () => {
    const same = find(
      candidates,
      `${L}.raw_goals.match_id`,
      `${N}.goals.match_id`,
    );
    const other = find(
      candidates,
      `${L}.raw_teams.team`,
      `${N}.goals.match_id`,
    );
    expect(other).toBeUndefined();
    const cross = find(
      candidates,
      `${L}.raw_match_stats.match_id`,
      `${N}.goals.match_id`,
    );
    expect(same && cross && same.confidence > cross.confidence).toBe(true);
    expect(candidates.indexOf(same!)).toBeLessThan(candidates.indexOf(cross!));
  });

  it('skips Landing → Consumption when Normalized has tables, and pairs within a layer never', () => {
    for (const c of candidates) {
      const from = c.from.entity.split('.')[1];
      const to = c.to.entity.split('.')[1];
      expect(from).not.toBe(to);
      expect([from, to]).not.toEqual(['wc_landing', 'wc_consumption']);
    }
    // score_str → home_score is no name match (at most a weak similar
    // name, under the 0.7 kept unchecked): the mapper's edges cover it.
    const score = find(
      candidates,
      `${L}.raw_matches.score_str`,
      `${N}.matches.home_score`,
    );
    expect(score?.method).not.toBe('name');
    expect(score?.confidence ?? 0).toBeLessThan(0.7);
  });

  it('pairs Landing with Consumption when there is no Normalized table', () => {
    const tables = GAP_SAMPLE_TABLES.filter((t) => t.layer !== 'normalized');
    const direct = lineageCandidates(tables);
    expect(
      find(
        direct,
        `${L}.raw_matches.stage_txt`,
        `${C}.fct_match_results.stage`,
      ),
    ).toBeDefined();
  });

  it('never pairs incompatible type families', () => {
    const tables: LayerTable[] = [
      { ...GAP_SAMPLE_TABLES[7], columns: [{ name: 'flag', type: 'boolean' }] },
      { ...GAP_SAMPLE_TABLES[3], columns: [{ name: 'flag', type: 'date' }] },
    ];
    expect(lineageCandidates(tables)).toEqual([]);
  });

  it('is sorted best first and capped', () => {
    const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
    expect(candidates.map((c) => c.confidence)).toEqual(
      sorted.map((c) => c.confidence),
    );
    expect(lineageCandidates(GAP_SAMPLE_TABLES, 3)).toHaveLength(3);
  });
});

describe('lineageQueries', () => {
  const candidate: LineageCandidate = {
    from: { entity: `${N}.matches`, column: 'stage' },
    to: { entity: `${C}.fct_match_results`, column: 'stage' },
    method: 'name',
    confidence: 0.8,
  };

  it('writes one Postgres statement per candidate, in one row', () => {
    const [query] = lineageQueries([candidate], GAP_SAMPLE_TABLES);
    expect(query.id).toBe('lineage-1');
    expect(query.datasourceId).toBe('ds-world-cup');
    expect(query.rationale).toBe(
      'Checks whether the values of fct_match_results.stage come from matches.stage',
    );
    expect(query.sql).toBe(
      'SELECT COUNT(t.v) AS target_values, COUNT(s.v) AS matched_values FROM (SELECT DISTINCT TRIM(CAST("stage" AS TEXT)) AS v FROM "wc_consumption"."fct_match_results" WHERE "stage" IS NOT NULL LIMIT 1000) t LEFT JOIN (SELECT DISTINCT TRIM(CAST("stage" AS TEXT)) AS v FROM "wc_normalized"."matches" WHERE "stage" IS NOT NULL LIMIT 10000) s ON s.v = t.v',
    );
    expect(query.candidate).toBe(candidate);
  });

  it('writes no query for a file (Excel / CSV) dataset and does not throw', () => {
    const tables = GAP_SAMPLE_TABLES.map((t) => ({
      ...t,
      datasourceKind: 'file',
    }));
    expect(gapDialectOf('file')).toBeUndefined();
    expect(lineageQueries([candidate], tables)).toEqual([]);
  });

  it('writes Databricks SQL with backticks and the catalog', () => {
    const tables = GAP_SAMPLE_TABLES.map((t) => ({
      ...t,
      datasourceKind: 'databricks',
    }));
    const [query] = lineageQueries([candidate], tables);
    expect(query.sql).toContain(
      'TRIM(CAST(`stage` AS STRING)) AS v FROM `world_cup`.`wc_consumption`.`fct_match_results`',
    );
    expect(query.sql).toContain('`world_cup`.`wc_normalized`.`matches`');
    expect(tableReference('a.b.c', 'postgres')).toBe('"b"."c"');
    expect(tableReference('we"ird.t', 'postgres')).toBe('"we""ird"."t"');
  });

  it('skips pairs across datasources, without one, or of a REST kind', () => {
    const split = GAP_SAMPLE_TABLES.map((t) =>
      t.entity === `${N}.matches` ? { ...t, datasourceId: 'other' } : t,
    );
    expect(lineageQueries([candidate], split)).toEqual([]);
    const none = GAP_SAMPLE_TABLES.map((t) => ({ ...t, datasourceId: null }));
    expect(lineageQueries([candidate], none)).toEqual([]);
    const rest = GAP_SAMPLE_TABLES.map((t) => ({
      ...t,
      datasourceKind: 'rest',
    }));
    expect(lineageQueries([candidate], rest)).toEqual([]);
  });

  it('checks at most LINEAGE_MAX_CHECKS candidates, best first', () => {
    const candidates = lineageCandidates(GAP_SAMPLE_TABLES);
    expect(candidates.length).toBeGreaterThan(LINEAGE_MAX_CHECKS);
    const queries = lineageQueries(candidates, GAP_SAMPLE_TABLES);
    expect(queries).toHaveLength(LINEAGE_MAX_CHECKS);
    expect(queries[0].candidate).toBe(candidates[0]);
    expect(queries[39].id).toBe('lineage-40');
  });
});

describe('lineageFromChecks', () => {
  const make = (column: string, confidence: number): LineageCandidate => ({
    from: { entity: `${N}.matches`, column },
    to: { entity: `${C}.fct_match_results`, column },
    method: 'name',
    confidence,
  });
  const proven = make('stage', 0.8);
  const partial = make('home_score', 0.8);
  const dropped = make('away_score', 0.8);
  const failed = make('match_id', 0.8);
  const failedLow = make('tournament_year', 0.6);
  const unchecked = make('winner', 0.75);
  const uncheckedLow = make('total_goals', 0.5);
  const candidates = [
    proven,
    partial,
    dropped,
    failed,
    failedLow,
    unchecked,
    uncheckedLow,
  ];
  const queries = lineageQueries(candidates.slice(0, 5), GAP_SAMPLE_TABLES);
  const lineage = lineageFromChecks(candidates, [
    {
      query: queries[0],
      result: result('lineage-1', { target_values: '5', matched_values: '5' }),
    },
    {
      query: queries[1],
      result: result('lineage-2', { TARGET_VALUES: 10, MATCHED_VALUES: 5 }),
    },
    {
      query: queries[2],
      result: result('lineage-3', { target_values: 10, matched_values: 1 }),
    },
    {
      query: queries[3],
      result: result('lineage-4', undefined, 'permission denied'),
    },
    {
      query: queries[4],
      result: result('lineage-5', undefined, 'timeout'),
    },
  ]);
  const edgeOf = (column: string) =>
    lineage.edges.find((e) => e.to.column === column);

  it('proves an edge at an overlap of 0.8 or more', () => {
    expect(edgeOf('stage')).toEqual({
      from: proven.from,
      to: proven.to,
      method: 'values',
      confidence: 1,
      overlap: 1,
      expression: '',
    });
  });

  it('keeps an edge in between with its name method and overlap', () => {
    expect(edgeOf('home_score')).toMatchObject({
      method: 'name',
      confidence: 0.8,
      overlap: 0.5,
    });
  });

  it('drops an edge under 0.2', () => {
    expect(edgeOf('away_score')).toBeUndefined();
  });

  it('keeps a failed or unchecked candidate only from confidence 0.7', () => {
    expect(edgeOf('match_id')).toMatchObject({ method: 'name', overlap: null });
    expect(edgeOf('tournament_year')).toBeUndefined();
    expect(edgeOf('winner')).toMatchObject({ method: 'name', overlap: null });
    expect(edgeOf('total_goals')).toBeUndefined();
  });

  it('counts the checked pairs and the failed checks', () => {
    expect(lineage.checkedPairs).toBe(5);
    expect(lineage.failedChecks).toBe(2);
  });

  it('gives an exactly-0.8 overlap confidence 0.9', () => {
    const [query] = lineageQueries([proven], GAP_SAMPLE_TABLES);
    const out = lineageFromChecks(
      [proven],
      [
        {
          query,
          result: result('lineage-1', { target_values: 5, matched_values: 4 }),
        },
      ],
    );
    expect(out.edges[0]).toMatchObject({
      method: 'values',
      confidence: 0.9,
      overlap: 0.8,
    });
  });
});
