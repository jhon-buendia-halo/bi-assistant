import type { AssistantEvalCase, AssistantEvalSet } from './assistant.evals';
import {
  hasSelectFilterOn,
  keepsWidgetIds,
  noBindingErrors,
  rowsAtLeast,
  slicesBy,
  submitAccepted,
  sumsColumn,
} from './bi-analyst-eval-checks';
import {
  blueprintFromDraft,
  type DashboardDraft,
} from '../workflows/bi-dashboard.schemas';
import { currentDashboardBlock } from '../workflows/bi-analyst.prompts';

/**
 * The eval set of Clara, the Business Intelligence Analyst (agents.md 8.1,
 * 2.22): her turn alone over the bundled World Cup sample, as Avery's
 * `build_dashboard` brief starts it. The target (`bi-analyst-eval-target.ts`)
 * answers `submit_dashboard` as the host does and saves nothing; the checks
 * read the accepted submission. Code checks only, no judge. Not run against
 * a model here: the lead picks the model and the data dir.
 */

/** The sample fixture the set is bound to. */
export const BI_ANALYST_EVAL_FIXTURE_ID = 'world-cup';

/** The registry key of the agent the set runs on. */
export const BI_ANALYST_EVAL_AGENT_KEY = 'bi-analyst';

/** The query of the dashboard the evolve case starts from. */
export const BIA_SEED_SQL =
  'SELECT team.common_name AS team, tournament.tournament_year AS tournament_year, ' +
  'COUNT(*) AS goals ' +
  'FROM world_cup.goals goal ' +
  'JOIN world_cup.matches match ON match.id = goal.match_id ' +
  'JOIN world_cup.tournaments tournament ON tournament.id = match.tournament_id ' +
  'JOIN world_cup.teams team ON team.id = goal.scoring_team_id ' +
  'GROUP BY team.common_name, tournament.tournament_year';

/** The widget ids of the seed dashboard, which the evolve case keeps. */
export const BIA_SEED_WIDGET_IDS = [
  'total-goals',
  'goals-by-team',
  'goals-by-tournament',
] as const;

/**
 * The dashboard of goals by team and tournament that an earlier turn of
 * Clara built, hand-made so the evolve case never depends on a model run.
 */
export function biaSeedDraft(): DashboardDraft {
  const goals = {
    label: 'Goals',
    column: 'goals',
    aggregation: 'sum' as const,
    format: 'number' as const,
    unit: '',
  };
  return {
    title: 'Goals by team and tournament',
    summary: 'How many goals each team scored at each World Cup.',
    theme: {
      mode: 'light',
      accent: '#1d4ed8',
      palette: ['#1d4ed8', '#0891b2', '#16a34a', '#ca8a04', '#dc2626'],
    },
    layout: 'A KPI on top, then two bar charts side by side.',
    filters: [
      { id: 'team', label: 'Team', kind: 'select', column: 'team' },
      {
        id: 'tournament',
        label: 'Tournament',
        kind: 'select',
        column: 'tournament_year',
      },
    ],
    widgets: [
      {
        id: 'total-goals',
        title: 'Total goals',
        kind: 'kpi',
        span: 12,
        measures: [goals],
        dimension: '',
        description: 'Sum of goals over the filtered rows.',
        filteredBy: ['team', 'tournament'],
      },
      {
        id: 'goals-by-team',
        title: 'Goals by team',
        kind: 'bar',
        span: 6,
        measures: [goals],
        dimension: 'team',
        description: 'Goals scored by each team.',
        filteredBy: ['team', 'tournament'],
      },
      {
        id: 'goals-by-tournament',
        title: 'Goals by tournament',
        kind: 'bar',
        span: 6,
        measures: [goals],
        dimension: 'tournament_year',
        description: 'Goals scored at each tournament.',
        filteredBy: ['team', 'tournament'],
      },
    ],
    columns: [
      { name: 'team', type: 'string', description: 'The scoring team.' },
      {
        name: 'tournament_year',
        type: 'number',
        description: 'The year of the World Cup.',
      },
      { name: 'goals', type: 'number', description: 'Goals scored.' },
    ],
  };
}

/**
 * Avery's brief for the evolve case: the change, then the current
 * dashboard's draft and its data query (the prompt's "brief gives you the
 * current dashboard").
 */
export function biaEvolveBrief(change: string): string {
  const draft = biaSeedDraft();
  const blueprint = blueprintFromDraft(draft, []);
  return [
    change,
    '',
    currentDashboardBlock({
      artifactId: 'eval-dashboard',
      version: 1,
      title: draft.title,
      blueprint,
      query: { sql: BIA_SEED_SQL, datasourceId: 'world-cup' },
      columns: draft.columns.map((c) => c.name),
      rowCount: 0,
      widgetCount: draft.widgets.length,
      filterCount: draft.filters.length,
    }),
  ].join('\n');
}

const TEAM_OR_TOURNAMENT = /team|equip|tournament|torneo|year|anio|ano/i;
const GOALS = /goal|gol/i;

/** The checks every case shares: one accepted, bound dashboard on real rows. */
function baseChecks() {
  return [submitAccepted(), noBindingErrors(), rowsAtLeast(2)];
}

export const BI_ANALYST_EVAL_CASES: AssistantEvalCase[] = [
  {
    id: 'bia-goals-by-team-tournament',
    question: 'Create a dashboard of goals by team and tournament',
    intent:
      'A plain dashboard request: explore, one query at the right grain, ' +
      'goals summed, team and tournament as filters or breakdowns.',
    scorers: [],
    customChecks: [
      ...baseChecks(),
      sumsColumn(GOALS),
      slicesBy(TEAM_OR_TOURNAMENT),
    ],
  },
  {
    id: 'bia-evolve-stage-filter',
    question: biaEvolveBrief('Add a filter by stage'),
    intent:
      'Evolving a dashboard: the brief carries the current draft and query; ' +
      'she keeps every widget id and adds a select filter on a stage column, ' +
      'which needs a new grain in the query.',
    scorers: [],
    customChecks: [
      ...baseChecks(),
      sumsColumn(GOALS),
      slicesBy(TEAM_OR_TOURNAMENT),
      hasSelectFilterOn(/stage/i),
      keepsWidgetIds(BIA_SEED_WIDGET_IDS),
    ],
  },
  {
    id: 'bia-es-goles-por-equipo',
    question: 'Crea un tablero de goles por equipo',
    intent:
      'A request in Spanish: the dashboard is built on the same data, with ' +
      'goals summed by team.',
    scorers: [],
    customChecks: [
      ...baseChecks(),
      sumsColumn(GOALS),
      slicesBy(TEAM_OR_TOURNAMENT),
    ],
  },
];

export const BI_ANALYST_EVAL_SET: AssistantEvalSet = {
  id: 'bi-analyst',
  name: 'Business Intelligence Analyst',
  description:
    "Clara's dashboards over the bundled World Cup sample: a new dashboard " +
    'of goals by team and tournament, the same one evolved with a stage ' +
    'filter, and a request in Spanish. Her query runs with the 5,000-row ' +
    'limit and her bindings are checked as the app does, but nothing is ' +
    'saved. Code checks only. Select its PostgreSQL datasource with a ' +
    'saved dataset containing the world_cup tables and views.',
  fixtureId: BI_ANALYST_EVAL_FIXTURE_ID,
  agentKey: BI_ANALYST_EVAL_AGENT_KEY,
  cases: BI_ANALYST_EVAL_CASES,
};
