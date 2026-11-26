import {
  blueprintFromDraft,
  dashboardBindingErrors,
  dashboardDraftSchema,
  draftOf,
  prepareDashboardRows,
  submitDashboardInputSchema,
  type DashboardDraft,
} from './bi-dashboard.schemas';
import { dashboardBlueprintSchema } from './dashboard-blueprint.schemas';

/** Goals by team and tournament: one row per team, tournament and stage. */
function draft(): DashboardDraft {
  return {
    title: 'World Cup goals',
    summary: 'Goals by team and tournament.',
    theme: { mode: 'light', accent: '#2563eb', palette: ['#2563eb'] },
    layout: 'A KPI row, then goals by team beside goals by year.',
    filters: [
      { id: 'team', label: 'Team', kind: 'select', column: 'team' },
      { id: 'search', label: 'Search', kind: 'search', column: '' },
    ],
    widgets: [
      {
        id: 'total-goals',
        title: 'Goals',
        kind: 'kpi',
        span: 4,
        measures: [
          {
            label: 'Goals',
            column: 'goals',
            aggregation: 'sum',
            format: 'number',
            unit: '',
          },
        ],
        dimension: '',
        description: 'All goals.',
        filteredBy: ['team'],
      },
      {
        id: 'matches',
        title: 'Rows',
        kind: 'kpi',
        span: 4,
        measures: [
          {
            label: 'Rows',
            column: '',
            aggregation: 'count',
            format: 'number',
            unit: '',
          },
        ],
        dimension: '',
        description: 'Team-tournament rows.',
        filteredBy: [],
      },
      {
        id: 'by-year',
        title: 'Goals by tournament',
        kind: 'line',
        span: 8,
        measures: [
          {
            label: 'Goals',
            column: 'goals',
            aggregation: 'sum',
            format: 'number',
            unit: '',
          },
        ],
        dimension: 'tournament_date',
        description: 'Goals per tournament.',
        filteredBy: ['team'],
      },
    ],
    columns: [
      { name: 'team', type: 'string', description: 'The team.' },
      {
        name: 'tournament_date',
        type: 'date',
        description: 'When the tournament started.',
      },
      { name: 'goals', type: 'number', description: 'Goals scored.' },
      { name: 'won', type: 'boolean', description: 'Won the tournament.' },
    ],
  };
}

const QUERY_COLUMNS = ['team', 'tournament_date', 'goals', 'won', 'stage'];

describe('dashboardDraftSchema and submitDashboardInputSchema', () => {
  it('accept a draft and its data query', () => {
    expect(dashboardDraftSchema.safeParse(draft()).success).toBe(true);
    expect(
      submitDashboardInputSchema.safeParse({
        dashboard: draft(),
        sql: 'SELECT 1',
        rationale: 'Goals per team and tournament.',
      }).success,
    ).toBe(true);
  });

  it("refuse the blueprint's 'other' kinds and more than 12 widgets", () => {
    const other = draft();
    (other.widgets[0] as { kind: string }).kind = 'other';
    expect(dashboardDraftSchema.safeParse(other).success).toBe(false);
    const otherFilter = draft();
    (otherFilter.filters[0] as { kind: string }).kind = 'other';
    expect(dashboardDraftSchema.safeParse(otherFilter).success).toBe(false);
    const many = draft();
    many.widgets = Array.from({ length: 13 }, (_v, i) => ({
      ...draft().widgets[1],
      id: `w${i}`,
    }));
    expect(dashboardDraftSchema.safeParse(many).success).toBe(false);
    expect(
      dashboardDraftSchema.safeParse({ ...draft(), widgets: [] }).success,
    ).toBe(false);
  });
});

describe('dashboardBindingErrors', () => {
  it('finds none when every field is bound to a column of the query', () => {
    expect(dashboardBindingErrors(draft(), QUERY_COLUMNS)).toEqual([]);
  });

  it('names each column the query does not return', () => {
    const d = draft();
    d.filters[0].column = 'country';
    d.widgets[2].dimension = 'year';
    d.widgets[0].measures[0].column = 'goals_scored';
    const errors = dashboardBindingErrors(d, QUERY_COLUMNS);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Filter "team" reads column "country"'),
        expect.stringContaining('Widget "by-year" breaks down by "year"'),
        expect.stringContaining(
          'Widget "total-goals" measure "Goals" reads "goals_scored"',
        ),
      ]),
    );
  });

  it('lets a search filter and a count read no column', () => {
    const d = draft();
    d.filters[1].column = 'anything';
    expect(dashboardBindingErrors(d, QUERY_COLUMNS)).toEqual([]);
  });

  it('wants sum, avg, min and max on a number column', () => {
    const d = draft();
    d.widgets[0].measures[0] = {
      label: 'Teams',
      column: 'team',
      aggregation: 'avg',
      format: 'number',
      unit: '',
    };
    d.widgets[1].measures[0].column = 'team';
    expect(dashboardBindingErrors(d, QUERY_COLUMNS)).toEqual([
      'Widget "total-goals" measure "Teams" takes the avg of "team", a string column: use a number column, or count.',
    ]);
  });

  it('wants an empty column only on a count', () => {
    const d = draft();
    d.widgets[0].measures[0].column = '';
    expect(dashboardBindingErrors(d, QUERY_COLUMNS)).toEqual([
      expect.stringContaining('Widget "total-goals" measure "Goals"'),
    ]);
  });

  it('finds unknown filteredBy ids, repeated ids and undeclared columns', () => {
    const d = draft();
    d.widgets[0].filteredBy = ['team', 'stage'];
    d.widgets[1].id = 'total-goals';
    d.filters.push({ ...d.filters[0] });
    d.columns.push({ name: 'stadium', type: 'string', description: '' });
    d.widgets[2].dimension = 'stage';
    expect(dashboardBindingErrors(d, QUERY_COLUMNS)).toEqual(
      expect.arrayContaining([
        'Widget "total-goals" is filtered by "stage", which is no filter id.',
        'Widget id "total-goals" is used more than once.',
        'Filter id "team" is used more than once.',
        'Column "stadium" is not returned by the query.',
        expect.stringContaining(
          'Widget "by-year" breaks down by "stage", which dashboard.columns does not describe',
        ),
      ]),
    );
  });
});

describe('prepareDashboardRows', () => {
  it("turns numbers to numbers, dates to ISO text and keeps only the draft's columns", () => {
    const rows = prepareDashboardRows(
      [
        {
          team: 'Brazil',
          tournament_date: new Date('2002-05-31T00:00:00.000Z'),
          goals: '18',
          won: 't',
          stage: 'Final',
        },
        {
          team: 7,
          tournament_date: new Date('2006-06-09T15:30:00.000Z'),
          goals: 12n,
          won: false,
        },
        {
          team: null,
          tournament_date: '2010-06',
          goals: 'n/a',
          won: null,
        },
      ],
      draft(),
    );
    expect(rows).toEqual([
      {
        team: 'Brazil',
        tournament_date: '2002-05-31',
        goals: 18,
        won: true,
      },
      {
        team: '7',
        tournament_date: '2006-06-09T15:30:00.000Z',
        goals: 12,
        won: false,
      },
      { team: null, tournament_date: '2010-06', goals: null, won: null },
    ]);
  });
});

describe('blueprintFromDraft and draftOf', () => {
  const rows = prepareDashboardRows(
    [
      { team: 'Germany', tournament_date: '2014-06-12', goals: 18, won: true },
      { team: 'Brazil', tournament_date: '2014-06-12', goals: 11, won: false },
      { team: 'Brazil', tournament_date: '2018-06-14', goals: 8, won: false },
      { team: null, tournament_date: '2018-06-14', goals: null, won: null },
    ],
    draft(),
  );

  it('derives a blueprint the dashboard schema accepts', () => {
    const blueprint = blueprintFromDraft(draft(), rows);
    expect(dashboardBlueprintSchema.safeParse(blueprint).success).toBe(true);
  });

  it('reads filter options, column values and ranges from the rows', () => {
    const blueprint = blueprintFromDraft(draft(), rows);
    expect(blueprint.filters[0].options).toEqual(['Brazil', 'Germany']);
    expect(blueprint.filters[1].options).toEqual([]);
    const byName = Object.fromEntries(
      blueprint.columns.map((column) => [column.name, column]),
    );
    expect(byName.team).toMatchObject({
      values: ['Germany', 'Brazil'],
      min: null,
      max: null,
    });
    expect(byName.tournament_date.values).toEqual(['2014-06-12', '2018-06-14']);
    expect(byName.goals).toMatchObject({ values: [], min: 8, max: 18 });
    expect(byName.won.values).toEqual(['true', 'false']);
    expect(blueprint.widgets[0]).toMatchObject({ observed: '' });
    expect(blueprint.widgets[0].measures[0].total).toBeNull();
  });

  it('caps filter options at 50 and column values at 200', () => {
    const many = prepareDashboardRows(
      Array.from({ length: 300 }, (_v, i) => ({
        team: `Team ${String(i).padStart(3, '0')}`,
        tournament_date: '2014-06-12',
        goals: i,
        won: false,
      })),
      draft(),
    );
    const blueprint = blueprintFromDraft(draft(), many);
    expect(blueprint.filters[0].options).toHaveLength(50);
    expect(blueprint.columns[0].values).toHaveLength(200);
  });

  it('gives back the draft it was built from', () => {
    expect(draftOf(blueprintFromDraft(draft(), rows))).toEqual(draft());
  });
});
