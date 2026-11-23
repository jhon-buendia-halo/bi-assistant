import {
  BIA_SEED_SQL,
  BIA_SEED_WIDGET_IDS,
  BI_ANALYST_EVAL_CASES,
  biaEvolveBrief,
  biaSeedDraft,
} from './bi-analyst.evals';
import {
  hasSelectFilterOn,
  judgeSubmission,
  keepsWidgetIds,
  noBindingErrors,
  rowsAtLeast,
  slicesBy,
  submitAccepted,
  sumsColumn,
  type AcceptedDashboard,
  type BiAnalystRun,
} from './bi-analyst-eval-checks';
import { evalDashboardRuntime } from './bi-analyst-eval-target';
import {
  dashboardDraftSchema,
  dashboardBindingErrors,
  type DashboardDraft,
} from '../workflows/bi-dashboard.schemas';
import type { EvalCustomCheck } from './assistant.evals';

jest.mock('../tool-services', () => ({ getDatasetToolServices: jest.fn() }));

const SEED_COLUMNS = ['team', 'tournament_year', 'goals'];

function accepted(patch: Partial<AcceptedDashboard> = {}): AcceptedDashboard {
  return {
    draft: biaSeedDraft(),
    sql: BIA_SEED_SQL,
    rowCount: 120,
    columns: SEED_COLUMNS,
    ...patch,
  };
}

/** The draft with a stage filter, the stage column and the old widgets. */
function withStage(): AcceptedDashboard {
  const draft = biaSeedDraft();
  draft.columns.push({
    name: 'stage',
    type: 'string',
    description: 'The stage of the match.',
  });
  draft.filters.push({
    id: 'stage',
    label: 'Stage',
    kind: 'select',
    column: 'stage',
  });
  return accepted({ draft, columns: [...SEED_COLUMNS, 'stage'] });
}

function runOf(a?: AcceptedDashboard, extra: Partial<BiAnalystRun> = {}) {
  return {
    details: {
      output: { submissions: a ? 1 : 0, refusals: [], accepted: a, ...extra },
    },
  };
}

function verdict(check: EvalCustomCheck, a?: AcceptedDashboard) {
  return check.run({
    answer: '',
    toolCalls: [],
    datasets: [],
    vars: {},
    ...runOf(a),
  });
}

describe('the seed dashboard', () => {
  it('is a valid draft with every field bound to its query', () => {
    expect(() => dashboardDraftSchema.parse(biaSeedDraft())).not.toThrow();
    expect(dashboardBindingErrors(biaSeedDraft(), SEED_COLUMNS)).toEqual([]);
    expect(biaSeedDraft().widgets.map((w) => w.id)).toEqual([
      ...BIA_SEED_WIDGET_IDS,
    ]);
  });

  it('is in the evolve brief with its query', () => {
    const brief = biaEvolveBrief('Add a filter by stage');
    expect(brief).toContain('Add a filter by stage');
    expect(brief).toContain('"id": "goals-by-team"');
    expect(brief).toContain(BIA_SEED_SQL);
  });
});

describe('bi-analyst checks', () => {
  it('submitAccepted passes on an accepted run and names a refusal', async () => {
    expect(await verdict(submitAccepted(), accepted())).toBeUndefined();
    const refused = await submitAccepted().run({
      answer: '',
      toolCalls: [],
      datasets: [],
      vars: {},
      details: {
        output: { submissions: 2, refusals: ['a', 'bad column'] },
      },
    });
    expect(refused).toContain('never accepted');
    expect(refused).toContain('bad column');
    expect(await verdict(submitAccepted())).toContain('never called');
  });

  it('noBindingErrors fails on a measure over a missing column', async () => {
    expect(await verdict(noBindingErrors(), accepted())).toBeUndefined();
    const draft: DashboardDraft = biaSeedDraft();
    draft.widgets[1].measures[0].column = 'points';
    expect(await verdict(noBindingErrors(), accepted({ draft }))).toContain(
      'points',
    );
  });

  it('rowsAtLeast fails under the minimum and over the cap', async () => {
    expect(await verdict(rowsAtLeast(2), accepted())).toBeUndefined();
    expect(await verdict(rowsAtLeast(2), accepted({ rowCount: 1 }))).toContain(
      '1 rows',
    );
    expect(
      await verdict(rowsAtLeast(2), accepted({ rowCount: 5001 })),
    ).toContain('5001 rows');
  });

  it('sumsColumn needs a sum on a goals column, not a count', async () => {
    expect(await verdict(sumsColumn(/goal/i), accepted())).toBeUndefined();
    const draft = biaSeedDraft();
    for (const widget of draft.widgets) {
      for (const measure of widget.measures) {
        measure.aggregation = 'count';
        measure.column = '';
      }
    }
    expect(await verdict(sumsColumn(/goal/i), accepted({ draft }))).toContain(
      'no widget measure sums',
    );
  });

  it('slicesBy needs a filter or dimension on team or tournament', async () => {
    const check = slicesBy(/team|tournament/i);
    expect(await verdict(check, accepted())).toBeUndefined();
    const draft = biaSeedDraft();
    draft.filters = [];
    draft.widgets.forEach((w) => (w.dimension = 'goals'));
    expect(await verdict(check, accepted({ draft }))).toContain('no filter');
  });

  it('hasSelectFilterOn needs a select filter on a returned stage column', async () => {
    const check = hasSelectFilterOn(/stage/i);
    expect(await verdict(check, withStage())).toBeUndefined();
    expect(await verdict(check, accepted())).toContain('no select filter');
    const asTabs = withStage();
    asTabs.draft.filters[2].kind = 'tabs';
    expect(await verdict(check, asTabs)).toContain('no select filter');
    const notReturned = withStage();
    notReturned.columns = SEED_COLUMNS;
    expect(await verdict(check, notReturned)).toContain('no select filter');
  });

  it('keepsWidgetIds names the widgets that were dropped', async () => {
    const check = keepsWidgetIds(BIA_SEED_WIDGET_IDS);
    expect(await verdict(check, withStage())).toBeUndefined();
    const draft = biaSeedDraft();
    draft.widgets = draft.widgets.filter((w) => w.id !== 'goals-by-team');
    expect(await verdict(check, accepted({ draft }))).toBe(
      'widgets dropped: goals-by-team',
    );
  });
});

describe('judgeSubmission', () => {
  it('accepts a bound draft on at most 5000 rows', () => {
    expect(
      judgeSubmission(biaSeedDraft(), {
        columns: SEED_COLUMNS,
        rows: new Array(5000).fill({}),
      }),
    ).toEqual({ accepted: true, rowCount: 5000, columns: SEED_COLUMNS });
  });

  it('rejects more than 5000 rows', () => {
    const verdict = judgeSubmission(biaSeedDraft(), {
      columns: SEED_COLUMNS,
      rows: new Array(5001).fill({}),
    });
    expect(verdict).toMatchObject({ accepted: false });
    expect(JSON.stringify(verdict)).toContain('5000');
  });

  it('rejects binding errors with their sentences', () => {
    const verdict = judgeSubmission(biaSeedDraft(), {
      columns: ['team', 'goals'],
      rows: [{}],
    });
    expect(verdict).toMatchObject({ accepted: false });
    expect(JSON.stringify(verdict)).toContain('tournament_year');
  });
});

describe('evalDashboardRuntime', () => {
  const input = {
    dashboard: biaSeedDraft(),
    sql: BIA_SEED_SQL,
    rationale: 'because',
    datasourceId: 'ds-1',
  };

  it('runs the query one row past the cap and records the accepted submission', async () => {
    const runSql = jest.fn().mockResolvedValue({
      columns: SEED_COLUMNS,
      rows: [{}, {}],
    });
    const run: BiAnalystRun = { submissions: 0, refusals: [] };
    const result = await evalDashboardRuntime(
      ['World Cup Core'],
      run,
      runSql,
    ).submit(input);
    expect(runSql).toHaveBeenCalledWith('ds-1', BIA_SEED_SQL, 5001, [
      'World Cup Core',
    ]);
    expect(result).toEqual({
      accepted: true,
      rowCount: 2,
      columns: SEED_COLUMNS,
    });
    expect(run.submissions).toBe(1);
    expect(run.accepted?.rowCount).toBe(2);
  });

  it('records a refusal, also when the query throws', async () => {
    const run: BiAnalystRun = { submissions: 0, refusals: [] };
    const runtime = evalDashboardRuntime(
      [],
      run,
      jest.fn().mockRejectedValue(new Error('relation does not exist')),
    );
    expect(await runtime.submit(input)).toEqual({
      accepted: false,
      error: 'relation does not exist',
    });
    expect(run).toMatchObject({
      submissions: 1,
      refusals: ['relation does not exist'],
    });
    expect(run.accepted).toBeUndefined();
  });
});

describe('BI_ANALYST_EVAL_CASES', () => {
  it('are three, prefixed bia-, with code checks only', () => {
    expect(BI_ANALYST_EVAL_CASES.map((c) => c.id)).toEqual([
      'bia-goals-by-team-tournament',
      'bia-evolve-stage-filter',
      'bia-es-goles-por-equipo',
    ]);
    for (const c of BI_ANALYST_EVAL_CASES) {
      expect(c.judgeRubric).toBeUndefined();
      expect(c.customChecks?.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('passes the evolve case on a stage dashboard and fails the seed', () => {
    const evolve = BI_ANALYST_EVAL_CASES[1];
    const runAll = (a: AcceptedDashboard) =>
      (evolve.customChecks ?? [])
        .map((check) => verdict(check, a))
        .filter(Boolean);
    expect(runAll(withStage())).toEqual([]);
    expect(runAll(accepted())).toHaveLength(1);
  });
});
