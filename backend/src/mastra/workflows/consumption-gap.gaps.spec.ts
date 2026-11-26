import type {
  LayerTable,
  Lineage,
  ReferenceDashboard,
  Requirement,
  RequirementAssessment,
} from './consumption-gap-analysis.schemas';
import {
  CONFIRM_REQUIREMENTS_OPTION,
  GAP_MAX_QUESTIONS,
  type GapQueryResult,
} from './consumption-gap-analysis.steps';
import {
  applyProbes,
  checkedFixes,
  checkedMappings,
  confirmQuestion,
  dashboardRequirements,
  isConfirmation,
  layerTables,
  parseQuestions,
  probeQueries,
  resolveLayers,
  statusCounts,
  traceGaps,
} from './consumption-gap.gaps';
import {
  lineageCandidates,
  lineageFromChecks,
} from './consumption-gap.lineage';
import {
  GAP_SAMPLE_MAPPING_REPLY,
  GAP_SAMPLE_QUESTIONS,
  GAP_SAMPLE_REQUIREMENTS,
  GAP_SAMPLE_TABLES,
} from './consumption-gap.trace-sample';

const C = 'world_cup.wc_consumption';
const N = 'world_cup.wc_normalized';
const L = 'world_cup.wc_landing';

/** The sample's name lineage, no value check run. */
const SAMPLE_LINEAGE: Lineage = lineageFromChecks(
  lineageCandidates(GAP_SAMPLE_TABLES),
  [],
);

function sampleTrace() {
  const mappings = checkedMappings(
    GAP_SAMPLE_MAPPING_REPLY,
    GAP_SAMPLE_REQUIREMENTS,
    GAP_SAMPLE_TABLES,
  );
  return traceGaps({
    requirements: GAP_SAMPLE_REQUIREMENTS,
    mappings,
    lineage: SAMPLE_LINEAGE,
    tables: GAP_SAMPLE_TABLES,
  });
}

function requirement(
  id: string,
  fields: Requirement['fields'],
  extra: Partial<Requirement> = {},
): Requirement {
  return {
    id,
    kind: 'question',
    title: id,
    source: '',
    dashboardId: '',
    ref: '',
    fields,
    grain: '',
    periodValues: [],
    ...extra,
  };
}

function measure(name: string, aggregation = 'sum') {
  return { name, role: 'measure' as const, aggregation, description: '' };
}

function dimension(name: string) {
  return { name, role: 'dimension' as const, aggregation: '', description: '' };
}

describe('parseQuestions', () => {
  it('reads one question per line, without list markers or duplicates', () => {
    expect(
      parseQuestions(
        '1. Who won?\n\n- Who scored?\n* who won?\n2) Where?\n  Who scored?  ',
      ),
    ).toEqual(['Who won?', 'Who scored?', 'Where?']);
  });

  it('keeps at most GAP_MAX_QUESTIONS', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Q ${i}`).join('\n');
    expect(parseQuestions(many)).toHaveLength(GAP_MAX_QUESTIONS);
  });

  it('throws when no question is left', () => {
    expect(() => parseQuestions(' \n- \n')).toThrow(
      'Write at least one business question',
    );
  });
});

describe('resolveLayers and layerTables', () => {
  const datasets = [
    {
      dataset: 'World Cup Medallion',
      datasourceId: 'ds-world-cup',
      datasourceKind: 'postgres',
      schemas: [
        { key: 'world_cup.wc_consumption', layer: 'consumption' },
        { key: 'world_cup.wc_landing', layer: 'Landing', description: 'raw' },
        { key: 'world_cup.public' },
        { key: 'world_cup.wc_normalized', layer: 'normalized' },
      ],
      entities: [
        {
          key: 'world_cup.wc_landing.raw_teams',
          columns: [{ name: 'team', type: 'text' }],
        },
        {
          key: 'world_cup.wc_consumption.agg_team_tournament',
          columns: Array.from({ length: 65 }, (_, i) => ({
            name: `c${i}`,
            type: 'integer',
          })),
        },
        {
          key: 'world_cup.public.notes',
          columns: [{ name: 'x', type: 'text' }],
        },
        { key: 'world_cup.wc_normalized.teams', columns: null },
      ],
    },
  ];

  it('orders the tagged schemas Landing, Normalized, Consumption', () => {
    expect(resolveLayers(datasets)).toEqual([
      {
        schemaKey: 'world_cup.wc_landing',
        layer: 'landing',
        dataset: 'World Cup Medallion',
        description: 'raw',
      },
      {
        schemaKey: 'world_cup.wc_normalized',
        layer: 'normalized',
        dataset: 'World Cup Medallion',
        description: '',
      },
      {
        schemaKey: 'world_cup.wc_consumption',
        layer: 'consumption',
        dataset: 'World Cup Medallion',
        description: '',
      },
    ]);
  });

  it('fails when no schema is tagged Consumption', () => {
    expect(() =>
      resolveLayers([
        {
          ...datasets[0],
          schemas: [{ key: 'world_cup.wc_landing', layer: 'landing' }],
        },
      ]),
    ).toThrow(
      "No schema of the datasets World Cup Medallion is tagged Consumption. Tag one in the dataset's schema notes (Datasets → schema → Layer).",
    );
  });

  it('lists the entities under tagged schemas, Consumption first, columns capped', () => {
    const tables = layerTables(datasets, resolveLayers(datasets));
    expect(tables.map((t) => [t.entity, t.layer])).toEqual([
      ['world_cup.wc_consumption.agg_team_tournament', 'consumption'],
      ['world_cup.wc_normalized.teams', 'normalized'],
      ['world_cup.wc_landing.raw_teams', 'landing'],
    ]);
    expect(tables[0].columns).toHaveLength(60);
    expect(tables[0].more).toBe(5);
    expect(tables[0]).toMatchObject({
      datasourceId: 'ds-world-cup',
      datasourceKind: 'postgres',
      dataset: 'World Cup Medallion',
    });
    expect(tables[1].columns).toEqual([]);
  });
});

describe('dashboardRequirements', () => {
  const dashboard: ReferenceDashboard = {
    id: 'D1',
    name: 'Rendimiento Mundial',
    blueprint: {
      title: 'Rendimiento Mundial',
      summary: '',
      theme: { mode: 'light', accent: '#000000', palette: [] },
      layout: '',
      filters: [
        {
          id: 'year',
          label: 'Mundial',
          kind: 'select',
          column: 'tournament_year',
          options: ['2018', '2022', 'Todos'],
        },
        {
          id: 'stage',
          label: 'Fase',
          kind: 'select',
          column: 'stage',
          options: ['Final'],
        },
      ],
      widgets: [
        {
          id: 'wins-by-team',
          title: 'Victorias por equipo',
          kind: 'bar',
          span: 6,
          measures: [
            {
              label: 'Victorias',
              column: 'wins',
              aggregation: 'sum',
              format: 'number',
              unit: '',
              total: null,
            },
          ],
          dimension: 'team',
          description: '',
          observed: '',
          filteredBy: ['year'],
        },
        {
          id: 'intro',
          title: 'Notas',
          kind: 'text',
          span: 12,
          measures: [],
          dimension: '',
          description: '',
          observed: '',
          filteredBy: [],
        },
        {
          id: 'goals-trend',
          title: 'Goles por Mundial',
          kind: 'line',
          span: 6,
          measures: [
            {
              label: 'Goles',
              column: 'goals',
              aggregation: 'sum',
              format: 'number',
              unit: '',
              total: null,
            },
          ],
          dimension: 'tournament_year',
          description: '',
          observed: '',
          filteredBy: [],
        },
      ],
      columns: [
        {
          name: 'team',
          type: 'string',
          description: 'The team',
          values: [],
          min: null,
          max: null,
        },
      ],
    },
  };
  const requirements = dashboardRequirements([dashboard]);

  it('makes one requirement per widget that reads data and per filter', () => {
    expect(requirements.map((r) => [r.id, r.ref, r.kind])).toEqual([
      ['W1', 'wins-by-team', 'widget'],
      ['W2', 'goals-trend', 'widget'],
      ['F1', 'year', 'filter'],
      ['F2', 'stage', 'filter'],
    ]);
  });

  it("reads a widget's measures, dimension and grain", () => {
    expect(requirements[0]).toEqual({
      id: 'W1',
      kind: 'widget',
      title: 'Victorias por equipo',
      source: 'Rendimiento Mundial · bar',
      dashboardId: 'D1',
      ref: 'wins-by-team',
      fields: [
        {
          name: 'wins',
          role: 'measure',
          aggregation: 'sum',
          description: 'Victorias',
        },
        {
          name: 'team',
          role: 'dimension',
          aggregation: '',
          description: 'The team',
        },
      ],
      grain: 'team',
      periodValues: [],
    });
    expect(requirements[1].fields[1]).toMatchObject({
      name: 'tournament_year',
      role: 'time',
    });
  });

  it("reads a filter's column, and its periods when it filters a period", () => {
    expect(requirements[2]).toMatchObject({
      title: 'Mundial',
      source: 'Rendimiento Mundial · select filter',
      fields: [{ name: 'tournament_year', role: 'filter' }],
      periodValues: ['2018', '2022'],
    });
    expect(requirements[3].periodValues).toEqual([]);
  });
});

describe('confirmQuestion and isConfirmation', () => {
  it('lists the requirements by group and asks to confirm or edit', () => {
    const reqs = [
      ...GAP_SAMPLE_REQUIREMENTS.slice(0, 1),
      requirement('W1', [measure('wins'), dimension('team')], {
        kind: 'widget',
        title: 'Victorias',
        grain: 'team',
      }),
      requirement(
        'F1',
        [{ name: 'stage', role: 'filter', aggregation: '', description: '' }],
        { kind: 'filter', title: 'Fase' },
      ),
    ];
    const { question, options } = confirmQuestion(reqs);
    expect(options).toEqual([CONFIRM_REQUIREMENTS_OPTION]);
    expect(question).toBe(
      [
        'These are the requirements I will check against the Consumption layer:',
        '',
        '**Questions**',
        '',
        `- **Q1** ${GAP_SAMPLE_QUESTIONS[0]} — measures wins (max); by team, tournament_year; grain team × tournament; periods 2018, 2022`,
        '',
        '**Dashboard widgets**',
        '',
        '- **W1** Victorias — measures wins (sum); by team; grain team',
        '',
        '**Filters**',
        '',
        '- **F1** Fase — filters stage',
        '',
        `Answer **${CONFIRM_REQUIREMENTS_OPTION}** to check them as they are, or say what to drop, add or change.`,
      ].join('\n'),
    );
  });

  it.each([
    CONFIRM_REQUIREMENTS_OPTION,
    'confirm the requirements.',
    'Yes',
    'ok!',
    'OK, thanks',
    'Sí',
    'si, confirmo',
    'De acuerdo.',
    'dale',
    'yes please',
    '¡Sí, de acuerdo!',
  ])('takes %p as a confirmation', (answer) => {
    expect(isConfirmation(answer)).toBe(true);
  });

  it.each([
    '',
    'thanks',
    'no',
    'Drop W2 and add stadium attendance',
    'yes but drop Q6',
    'sí, pero quita la pregunta 6',
  ])('takes %p as feedback', (answer) => {
    expect(isConfirmation(answer)).toBe(false);
  });
});

describe('checkedMappings', () => {
  const reqs = [requirement('Q1', [measure('wins'), dimension('stage')])];

  it('keeps sources that exist, with the catalog spelling and layer', () => {
    const mappings = checkedMappings(
      JSON.stringify({
        mappings: [
          {
            requirementId: 'q1',
            field: 'WINS',
            sources: [
              {
                layer: 'normalized',
                entity: `${C.toUpperCase()}.AGG_TEAM_TOURNAMENT`,
                column: 'Wins',
                expression: '',
              },
              {
                layer: 'consumption',
                entity: `${C}.agg_team_tournament`,
                column: 'wins',
              },
              { layer: 'consumption', entity: `${C}.invented`, column: 'wins' },
              {
                layer: 'consumption',
                entity: `${C}.agg_team_tournament`,
                column: 'invented',
              },
              {
                layer: 'normalized',
                entity: 'wc_normalized.matches',
                column: 'match_id',
                expression: 'count(*)',
              },
            ],
            note: 'ok',
          },
        ],
      }),
      reqs,
      GAP_SAMPLE_TABLES,
    );
    expect(mappings).toEqual([
      {
        requirementId: 'Q1',
        field: 'wins',
        sources: [
          {
            layer: 'consumption',
            entity: `${C}.agg_team_tournament`,
            column: 'wins',
            expression: '',
          },
          {
            layer: 'normalized',
            entity: `${N}.matches`,
            column: 'match_id',
            expression: 'count(*)',
          },
        ],
        note: 'ok',
      },
      { requirementId: 'Q1', field: 'stage', sources: [], note: '' },
    ]);
  });

  it('reads a bare array and survives nonsense', () => {
    expect(checkedMappings('not json', reqs, GAP_SAMPLE_TABLES)).toHaveLength(
      2,
    );
    expect(
      checkedMappings(
        [
          {
            requirementId: 'Q1',
            field: 'stage',
            sources: [{ entity: `${N}.matches`, column: 'stage' }],
          },
        ],
        reqs,
        GAP_SAMPLE_TABLES,
      )[1].sources,
    ).toEqual([
      {
        layer: 'normalized',
        entity: `${N}.matches`,
        column: 'stage',
        expression: '',
      },
    ]);
  });
});

describe('traceGaps', () => {
  const { assessments, lineage } = sampleTrace();
  const status = (id: string) =>
    assessments.find((a) => a.requirementId === id);

  it('gives the six example questions their statuses', () => {
    expect(assessments.map((a) => [a.requirementId, a.status])).toEqual([
      ['Q1', 'supported'],
      ['Q2', 'derivable'],
      ['Q3', 'normalized-only'],
      ['Q4', 'normalized-only'],
      ['Q5', 'landing-only'],
      ['Q6', 'missing'],
    ]);
    expect(assessments.every((a) => a.evidence === '')).toBe(true);
  });

  it('explains each status in one sentence', () => {
    expect(status('Q1')?.reason).toBe(
      'Every field is a Consumption column (agg_team_tournament).',
    );
    expect(status('Q2')?.reason).toBe(
      'Every field can be computed from Consumption columns: goal_difference = goals_for - goals_against.',
    );
    expect(status('Q4')?.reason).toBe(
      'possession is in Normalized (match_team_statistics.possession) but not in Consumption.',
    );
    expect(status('Q5')?.reason).toBe(
      'attendance, stadium are only in Landing (raw_matches).',
    );
    expect(status('Q6')?.reason).toBe('No layer has yellow_cards.');
  });

  it('records the field sources and the path from the lowest layer up', () => {
    const year = status('Q1')?.fields[2];
    expect(year).toMatchObject({
      status: 'supported',
      consumption: {
        entity: `${C}.agg_team_tournament`,
        column: 'tournament_year',
      },
      upstream: null,
    });
    expect(year?.path).toEqual([
      { entity: `${L}.raw_matches`, column: 'tournament' },
      { entity: `${N}.matches`, column: 'tournament_year' },
      { entity: `${C}.agg_team_tournament`, column: 'tournament_year' },
    ]);
    expect(status('Q4')?.fields[0]).toMatchObject({
      status: 'normalized-only',
      consumption: null,
      upstream: {
        layer: 'normalized',
        entity: `${N}.match_team_statistics`,
        column: 'possession',
      },
    });
    expect(status('Q6')?.fields[0]).toMatchObject({
      status: 'missing',
      upstream: null,
      path: [],
    });
  });

  it('adds a mapped edge between the layers a field is mapped in', () => {
    expect(
      lineage.edges.find(
        (e) => e.method === 'mapped' && e.from.column === 'tournament',
      ),
    ).toEqual({
      from: { entity: `${L}.raw_matches`, column: 'tournament' },
      to: { entity: `${N}.matches`, column: 'tournament_year' },
      method: 'mapped',
      confidence: 0.8,
      overlap: null,
      expression: 'left(tournament, 4)::int',
    });
    expect(
      lineage.edges.find(
        (e) => e.method === 'mapped' && e.from.column === 'penalty_flag',
      )?.to,
    ).toEqual({ entity: `${N}.goals`, column: 'is_penalty' });
    // The name edge matches.tournament_year → agg … already joins them.
    expect(
      lineage.edges.filter(
        (e) =>
          e.from.entity === `${N}.matches` &&
          e.from.column === 'tournament_year' &&
          e.to.entity === `${C}.agg_team_tournament`,
      ),
    ).toHaveLength(1);
    expect(lineage.edges.length).toBeGreaterThan(SAMPLE_LINEAGE.edges.length);
  });

  it('upgrades a Normalized source that lineage carries into Consumption', () => {
    const reqs = [requirement('Q9', [dimension('stage')])];
    const out = traceGaps({
      requirements: reqs,
      mappings: [
        {
          requirementId: 'Q9',
          field: 'stage',
          sources: [
            {
              layer: 'normalized',
              entity: `${N}.matches`,
              column: 'stage',
              expression: '',
            },
          ],
          note: '',
        },
      ],
      lineage: SAMPLE_LINEAGE,
      tables: GAP_SAMPLE_TABLES,
    });
    expect(out.assessments[0].status).toBe('supported');
    expect(out.assessments[0].fields[0]).toMatchObject({
      consumption: {
        layer: 'consumption',
        entity: `${C}.fct_match_results`,
        column: 'stage',
      },
      upstream: null,
      path: [
        { entity: `${L}.raw_matches`, column: 'stage_txt' },
        { entity: `${N}.matches`, column: 'stage' },
        { entity: `${C}.fct_match_results`, column: 'stage' },
      ],
    });
  });

  it('marks grain when the Consumption entities share no column', () => {
    const tables: LayerTable[] = [
      ...GAP_SAMPLE_TABLES,
      {
        ...GAP_SAMPLE_TABLES[0],
        entity: `${C}.dim_stadium`,
        columns: [
          { name: 'stadium_name', type: 'text' },
          { name: 'capacity', type: 'integer' },
        ],
      },
    ];
    const reqs = [requirement('Q7', [measure('capacity'), dimension('stage')])];
    const out = traceGaps({
      requirements: reqs,
      mappings: [
        {
          requirementId: 'Q7',
          field: 'capacity',
          sources: [
            {
              layer: 'consumption',
              entity: `${C}.dim_stadium`,
              column: 'capacity',
              expression: '',
            },
          ],
          note: '',
        },
        {
          requirementId: 'Q7',
          field: 'stage',
          sources: [
            {
              layer: 'consumption',
              entity: `${C}.fct_match_results`,
              column: 'stage',
              expression: '',
            },
          ],
          note: '',
        },
      ],
      lineage: SAMPLE_LINEAGE,
      tables,
    });
    expect(out.assessments[0].status).toBe('grain');
    expect(out.assessments[0].fields.map((f) => f.status)).toEqual([
      'supported',
      'supported',
    ]);
    expect(out.assessments[0].reason).toBe(
      'The fields are in Consumption, but in entities that share no column to join on (dim_stadium, fct_match_results).',
    );
  });

  it('marks grain when the entities share only a column the requirement does not read', () => {
    // Scorers by stage: agg_player_goals and fct_match_results share only
    // tournament_year, which would multiply rows, not join them.
    const source = (entity: string, column: string) => ({
      layer: 'consumption' as const,
      entity: `${C}.${entity}`,
      column,
      expression: '',
    });
    const reqs = [
      requirement('W7', [
        measure('goals'),
        dimension('player'),
        dimension('stage'),
      ]),
    ];
    const mapped = (field: string, entity: string, column: string) => ({
      requirementId: 'W7',
      field,
      sources: [source(entity, column)],
      note: '',
    });
    const out = traceGaps({
      requirements: reqs,
      mappings: [
        mapped('goals', 'agg_player_goals', 'goals'),
        mapped('player', 'agg_player_goals', 'player'),
        mapped('stage', 'fct_match_results', 'stage'),
      ],
      lineage: SAMPLE_LINEAGE,
      tables: GAP_SAMPLE_TABLES,
    });
    expect(out.assessments[0].status).toBe('grain');
    // Reading the shared year itself makes it a usable join column.
    const byYear = traceGaps({
      requirements: [
        requirement('W8', [measure('goals'), dimension('tournament_year')]),
      ],
      mappings: [
        {
          ...mapped('goals', 'agg_player_goals', 'goals'),
          requirementId: 'W8',
        },
        {
          ...mapped('tournament_year', 'fct_match_results', 'tournament_year'),
          requirementId: 'W8',
        },
      ],
      lineage: SAMPLE_LINEAGE,
      tables: GAP_SAMPLE_TABLES,
    });
    expect(byYear.assessments[0].status).toBe('supported');
  });

  it('calls a requirement with no field missing', () => {
    const out = traceGaps({
      requirements: [requirement('Q8', [])],
      mappings: [],
      lineage: SAMPLE_LINEAGE,
      tables: GAP_SAMPLE_TABLES,
    });
    expect(out.assessments[0].status).toBe('missing');
  });
});

describe('probeQueries and applyProbes', () => {
  const { assessments } = sampleTrace();
  const probes = probeQueries({
    requirements: GAP_SAMPLE_REQUIREMENTS,
    assessments,
    tables: GAP_SAMPLE_TABLES,
  });

  it('writes coverage and period probes per requirement', () => {
    expect(probes.map((p) => [p.id, p.requirementId, p.purpose])).toEqual([
      ['probe-1', 'Q1', 'coverage'],
      ['probe-2', 'Q1', 'periods'],
      ['probe-3', 'Q2', 'coverage'],
      ['probe-4', 'Q3', 'coverage'],
      ['probe-5', 'Q4', 'coverage'],
      ['probe-6', 'Q5', 'coverage'],
      ['probe-7', 'Q6', 'coverage'],
    ]);
    expect(probes[0].sql).toBe(
      'SELECT COUNT(*) AS total_rows, COUNT("wins") AS "wins", COUNT("team") AS "team", COUNT("tournament_year") AS "tournament_year" FROM "wc_consumption"."agg_team_tournament"',
    );
    expect(probes[1].sql).toBe(
      `SELECT COUNT(CASE WHEN CAST("tournament_year" AS TEXT) LIKE '2018%' THEN 1 END) AS "2018", COUNT(CASE WHEN CAST("tournament_year" AS TEXT) LIKE '2022%' THEN 1 END) AS "2022" FROM "wc_consumption"."agg_team_tournament"`,
    );
    expect(probes[3].sql).toBe(
      'SELECT COUNT(*) AS total_rows, COUNT("is_penalty") AS "is_penalty" FROM "wc_normalized"."goals"',
    );
    expect(probes[0].datasourceId).toBe('ds-world-cup');
    expect(probes[1].rationale).toBe(
      'Counts the rows of agg_team_tournament for each period Q1 names (2018, 2022) by tournament_year',
    );
  });

  it('writes Databricks probes and skips entities it cannot query', () => {
    const databricks = GAP_SAMPLE_TABLES.map((t) => ({
      ...t,
      datasourceKind: 'databricks',
    }));
    const out = probeQueries({
      requirements: GAP_SAMPLE_REQUIREMENTS,
      assessments,
      tables: databricks,
    });
    expect(out[1].sql).toBe(
      "SELECT COUNT(CASE WHEN CAST(`tournament_year` AS STRING) LIKE '2018%' THEN 1 END) AS `2018`, COUNT(CASE WHEN CAST(`tournament_year` AS STRING) LIKE '2022%' THEN 1 END) AS `2022` FROM `world_cup`.`wc_consumption`.`agg_team_tournament`",
    );
    const rest = GAP_SAMPLE_TABLES.map((t) =>
      t.layer === 'landing' ? { ...t, datasourceKind: 'rest' } : t,
    );
    expect(
      probeQueries({
        requirements: GAP_SAMPLE_REQUIREMENTS,
        assessments,
        tables: rest,
      }).some((p) => p.requirementId === 'Q5'),
    ).toBe(false);
    const none = GAP_SAMPLE_TABLES.map((t) => ({ ...t, datasourceId: null }));
    expect(
      probeQueries({
        requirements: GAP_SAMPLE_REQUIREMENTS,
        assessments,
        tables: none,
      }),
    ).toEqual([]);
  });

  const results: GapQueryResult[] = [
    {
      id: 'probe-1',
      columns: ['total_rows', 'wins', 'team', 'tournament_year'],
      rows: [
        { total_rows: '32', wins: '32', team: '32', tournament_year: '32' },
      ],
      error: null,
    },
    {
      id: 'probe-2',
      columns: ['2018', '2022'],
      rows: [{ '2018': '0', '2022': '32' }],
      error: null,
    },
    {
      id: 'probe-3',
      columns: ['total_rows', 'goals_for', 'team', 'tournament_year'],
      rows: [{ total_rows: 32, goals_for: 10, team: 32, tournament_year: 32 }],
      error: null,
    },
    { id: 'probe-4', columns: [], rows: [], error: 'relation does not exist' },
    {
      id: 'probe-6',
      columns: ['total_rows', 'attendance_str', 'stadium'],
      rows: [{ total_rows: 128, attendance_str: 40, stadium: 128 }],
      error: null,
    },
  ];
  const probed = applyProbes(assessments, probes, results);
  const of = (id: string) => probed.find((a) => a.requirementId === id);

  it('downgrades Q1 to grain when a named period has no rows', () => {
    expect(of('Q1')).toMatchObject({
      status: 'grain',
      evidence:
        'agg_team_tournament: 32 rows; wins filled in 32 of 32, team filled in 32 of 32, tournament_year filled in 32 of 32. agg_team_tournament: rows by tournament_year: 2018 → 0, 2022 → 32.',
      reason:
        'The fields are in Consumption, but the data does not answer it: no rows for 2018.',
    });
  });

  it('counts the named periods upstream too, as evidence only', () => {
    const lineage = {
      edges: [
        {
          from: {
            entity: 'world_cup.wc_normalized.matches',
            column: 'tournament_year',
          },
          to: {
            entity: 'world_cup.wc_consumption.agg_team_tournament',
            column: 'tournament_year',
          },
          method: 'values' as const,
          confidence: 0.95,
          overlap: 1,
          expression: '',
        },
      ],
      checkedPairs: 1,
      failedChecks: 0,
    };
    const withUpstream = probeQueries({
      requirements: GAP_SAMPLE_REQUIREMENTS,
      assessments,
      tables: GAP_SAMPLE_TABLES,
      lineage,
    });
    const q1 = withUpstream.filter((p) => p.requirementId === 'Q1');
    expect(q1.map((p) => [p.id, p.purpose, p.layer])).toEqual([
      ['probe-1', 'coverage', undefined],
      ['probe-2', 'periods', undefined],
      ['probe-3', 'upstream-periods', 'normalized'],
    ]);
    expect(q1[2].sql).toBe(
      `SELECT COUNT(CASE WHEN CAST("tournament_year" AS TEXT) LIKE '2018%' THEN 1 END) AS "2018", COUNT(CASE WHEN CAST("tournament_year" AS TEXT) LIKE '2022%' THEN 1 END) AS "2022" FROM "wc_normalized"."matches"`,
    );
    const upstream = applyProbes(assessments, withUpstream, [
      results[0],
      results[1],
      {
        id: 'probe-3',
        columns: ['2018', '2022'],
        rows: [{ '2018': 28, '2022': 28 }],
        error: null,
      },
    ]).find((a) => a.requirementId === 'Q1');
    expect(upstream?.status).toBe('grain');
    expect(upstream?.evidence).toContain(
      'Upstream in Normalized, matches: rows by tournament_year: 2018 → 28, 2022 → 28.',
    );
    expect(upstream?.reason).toBe(
      'The fields are in Consumption, but the data does not answer it: no rows for 2018.',
    );
  });

  it('downgrades a requirement whose column is under half filled', () => {
    expect(of('Q2')?.status).toBe('grain');
    expect(of('Q2')?.reason).toContain(
      'goals_for is filled in only 10 of 32 rows',
    );
  });

  it('records a failed probe without changing the status', () => {
    expect(of('Q3')).toMatchObject({
      status: 'normalized-only',
      evidence: 'The check query failed: relation does not exist.',
    });
  });

  it('never downgrades a gap that is already worse than derivable', () => {
    expect(of('Q5')?.status).toBe('landing-only');
    expect(of('Q5')?.evidence).toBe(
      'raw_matches: 128 rows; attendance_str filled in 40 of 128, stadium filled in 128 of 128.',
    );
    expect(of('Q4')?.evidence).toBe('');
  });

  it('downgrades on an empty entity', () => {
    const [q2] = applyProbes([assessments[1]], probes, [
      { id: 'probe-3', columns: [], rows: [{ total_rows: 0 }], error: null },
    ]);
    expect(q2).toMatchObject({
      status: 'grain',
      evidence: 'agg_team_tournament: 0 rows.',
    });
  });

  it('counts the statuses', () => {
    expect(statusCounts(probed)).toEqual({
      supported: 0,
      derivable: 0,
      grain: 2,
      'normalized-only': 2,
      'landing-only': 1,
      missing: 1,
    });
  });
});

describe('checkedFixes', () => {
  const { assessments } = sampleTrace();
  const gaps: RequirementAssessment[] = assessments;

  it('keeps fixes that close real gaps, renumbers them, and adds fallbacks', () => {
    const fixes = checkedFixes(
      {
        fixes: [
          {
            id: 'A',
            title: 'Add penalty share to Consumption',
            startsIn: 'consumption',
            path: ['consumption', 'normalized', 'nowhere'],
            closes: ['q3', 'Q1', 'Q99'],
            why: 'is_penalty is in goals',
            change: 'ALTER …',
          },
          {
            title: 'Closes nothing',
            startsIn: 'consumption',
            closes: ['Q2', 'Q42'],
          },
          { title: 'Nothing', closes: [] },
        ],
      },
      GAP_SAMPLE_REQUIREMENTS,
      gaps,
    );
    expect(fixes[0]).toEqual({
      id: 'X1',
      title: 'Add penalty share to Consumption',
      startsIn: 'consumption',
      path: ['normalized', 'consumption'],
      closes: ['Q3'],
      why: 'is_penalty is in goals',
      change: 'ALTER …',
    });
    expect(fixes.map((f) => [f.id, f.closes, f.startsIn, f.path])).toEqual([
      ['X1', ['Q3'], 'consumption', ['normalized', 'consumption']],
      ['X2', ['Q4'], 'consumption', ['normalized', 'consumption']],
      ['X3', ['Q5'], 'normalized', ['landing', 'normalized', 'consumption']],
      [
        'X4',
        ['Q6'],
        'source',
        ['source', 'landing', 'normalized', 'consumption'],
      ],
    ]);
    expect(fixes[1].title).toBe('Expose possession in Consumption');
    expect(fixes[2].title).toBe(
      'Model attendance, stadium in Normalized and expose them in Consumption',
    );
    expect(fixes[3].title).toBe('Bring yellow_cards from the source system');
  });

  it('adds a Consumption fallback for a grain gap and reads a bare array', () => {
    const grain = assessments.map((a) =>
      a.requirementId === 'Q1' ? { ...a, status: 'grain' as const } : a,
    );
    const fixes = checkedFixes('[]', GAP_SAMPLE_REQUIREMENTS, grain);
    expect(fixes[0]).toMatchObject({
      id: 'X1',
      closes: ['Q1'],
      startsIn: 'consumption',
      path: ['consumption'],
    });
    expect(fixes).toHaveLength(5);
  });
});
