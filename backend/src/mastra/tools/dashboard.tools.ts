/**
 * Clara's submit_dashboard (plan bi-dashboard 2.2): hands her dashboard and
 * its one data query to the run, through the `DashboardToolsRuntime` the
 * run puts on the requestContext. The run executes the query (up to
 * `DASHBOARD_ROWS_CAP` rows), checks the bindings and saves the dashboard;
 * the tool answers Clara in text. It never returns `columns` or `rows`
 * keys: a result with them would be captured as one of the turn's queries.
 */
import { createTool } from '@mastra/core/tools';
import type { z } from 'zod';
import {
  SUBMIT_DASHBOARD_TOOL,
  submitDashboardInputSchema,
} from '../workflows/bi-dashboard.schemas';
import { resolveDatasource, sessionDatasets } from './dataset.tools';

/** The requestContext key of the run's `DashboardToolsRuntime`. */
export const DASHBOARD_TOOLS_RUNTIME_KEY = 'dashboard-tools-runtime';

/** What submit_dashboard calls: the run that builds the dashboard. */
export interface DashboardToolsRuntime {
  submit(
    input: z.output<typeof submitDashboardInputSchema> & {
      datasourceId: string;
    },
  ): Promise<
    | { accepted: true; rowCount: number; columns: string[] }
    | { accepted: false; error: string }
  >;
}

export const submitDashboardTool = createTool({
  id: SUBMIT_DASHBOARD_TOOL,
  description:
    'Submit the dashboard and its one data query. The app runs the query (at most 5000 rows), checks that every filter, dimension and measure reads a column it returns, and draws the dashboard on those rows. Returns that it was accepted, or what to fix. datasourceId is optional when the session uses a single datasource.',
  inputSchema: submitDashboardInputSchema,
  execute: async (input, context) => {
    const requestContext = context?.requestContext;
    const runtime: DashboardToolsRuntime | undefined = requestContext?.get(
      DASHBOARD_TOOLS_RUNTIME_KEY,
    );
    if (!runtime || !requestContext) {
      return {
        error: 'This tool only runs when Avery asks Clara for a dashboard.',
      };
    }
    const target = resolveDatasource(
      await sessionDatasets(requestContext),
      input.datasourceId,
    );
    if ('error' in target) return { error: target.error };
    try {
      const submitted = await runtime.submit({
        ...input,
        datasourceId: target.id,
      });
      if (!submitted.accepted) return { error: submitted.error };
      return {
        result: `Accepted: the dashboard is drawn on ${submitted.rowCount} rows of your query (${submitted.columns.length} columns). Reply to Avery in one or two sentences.`,
      };
    } catch (err) {
      // A submit the stop cut short is no failed submit: the call ends.
      if (context?.abortSignal?.aborted) throw err;
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },
});
