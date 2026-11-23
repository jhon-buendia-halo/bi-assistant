import { RequestContext } from '@mastra/core/request-context';
import {
  setDatasetToolServices,
  type DatasetToolServices,
} from '../tool-services';
import { DATASETS_CONTEXT_KEY } from './dataset-tool-context';
import {
  DASHBOARD_TOOLS_RUNTIME_KEY,
  submitDashboardTool,
  type DashboardToolsRuntime,
} from './dashboard.tools';
import type { DashboardDraft } from '../workflows/bi-dashboard.schemas';

type Execute = (
  input: Record<string, unknown>,
  context: { requestContext: RequestContext; abortSignal?: AbortSignal },
) => Promise<Record<string, unknown>>;
const execute = submitDashboardTool.execute as unknown as Execute;

const DASHBOARD: DashboardDraft = {
  title: 'Goals',
  summary: 'Goals by team.',
  theme: { mode: 'light', accent: '#2563eb', palette: ['#2563eb'] },
  layout: 'One chart.',
  filters: [],
  widgets: [
    {
      id: 'by-team',
      title: 'Goals by team',
      kind: 'bar',
      span: 12,
      measures: [
        {
          label: 'Goals',
          column: 'goals',
          aggregation: 'sum',
          format: 'number',
          unit: '',
        },
      ],
      dimension: 'team',
      description: 'Goals per team.',
      filteredBy: [],
    },
  ],
  columns: [
    { name: 'team', type: 'string', description: 'Team.' },
    { name: 'goals', type: 'number', description: 'Goals.' },
  ],
};

const INPUT = {
  dashboard: DASHBOARD,
  sql: 'SELECT team, SUM(goals) AS goals FROM wc.public.goals GROUP BY team',
  rationale: 'Goals per team.',
};

function services(datasourceIds: string[]): DatasetToolServices {
  return {
    getDatasets: jest.fn().mockResolvedValue(
      datasourceIds.map((id, i) => ({
        name: `wc${i}`,
        datasourceId: id,
        datasourceKind: 'postgres',
        tables: ['wc.public.goals'],
      })),
    ),
  } as unknown as DatasetToolServices;
}

function contextWith(runtime?: DashboardToolsRuntime): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(DATASETS_CONTEXT_KEY, ['wc0', 'wc1']);
  if (runtime) requestContext.set(DASHBOARD_TOOLS_RUNTIME_KEY, runtime);
  return requestContext;
}

describe('submit_dashboard', () => {
  it("hands the dashboard to the run on the session's only datasource, and says so in text alone", async () => {
    setDatasetToolServices(services(['ds-pg']));
    const submit = jest.fn().mockResolvedValue({
      accepted: true,
      rowCount: 32,
      columns: ['team', 'goals'],
    });
    const result = await execute(INPUT, {
      requestContext: contextWith({ submit }),
    });
    expect(submit).toHaveBeenCalledWith({ ...INPUT, datasourceId: 'ds-pg' });
    expect(Object.keys(result)).toEqual(['result']);
    expect(result.result).toContain('32 rows');
    // A result with `columns` or `rows` would be captured as a query record.
    expect(result).not.toHaveProperty('columns');
    expect(result).not.toHaveProperty('rows');
  });

  it('returns what to fix when the run refuses the dashboard', async () => {
    setDatasetToolServices(services(['ds-pg']));
    const submit = jest.fn().mockResolvedValue({
      accepted: false,
      error: 'Widget "by-team" breaks down by "team_name".',
    });
    await expect(
      execute(INPUT, { requestContext: contextWith({ submit }) }),
    ).resolves.toEqual({
      error: 'Widget "by-team" breaks down by "team_name".',
    });
  });

  it('asks for a datasourceId among several, as run_readonly_sql does', async () => {
    setDatasetToolServices(services(['ds-a', 'ds-b']));
    const submit = jest.fn();
    const result = await execute(INPUT, {
      requestContext: contextWith({ submit }),
    });
    expect(result.error).toContain('Several datasources are in scope');
    expect(submit).not.toHaveBeenCalled();
    await execute(
      { ...INPUT, datasourceId: 'ds-b' },
      { requestContext: contextWith({ submit }) },
    );
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ datasourceId: 'ds-b' }),
    );
  });

  it('refuses outside a dashboard build', async () => {
    setDatasetToolServices(services(['ds-pg']));
    const result = await execute(INPUT, { requestContext: contextWith() });
    expect(result.error).toContain('only runs when Avery asks Clara');
  });

  it('turns a failed submit into an error the model reads', async () => {
    setDatasetToolServices(services(['ds-pg']));
    const submit = jest.fn().mockRejectedValue(new Error('timeout'));
    await expect(
      execute(INPUT, { requestContext: contextWith({ submit }) }),
    ).resolves.toEqual({ error: 'timeout' });
  });
});
