import { test, expect } from './fixtures/app.fixture';
import type { Page } from '@playwright/test';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import { LlmStub, StubReply, StubRequest, startLlmStub } from './helpers/llm-stub';
import { openRunTab, openWorkflowPage, runAnswer } from './helpers/run-ui';
import { worldCupKey, worldCupScalar } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Every workflow whose answer ran queries gets the query
 * inspector" (specs/capabilities/workflows/spec.md R31): an Assess Data
 * Readiness run whose Explain report turn ran a drill-down query shows the
 * sources and opens the inspector with paging.
 */

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  stub = await startLlmStub();
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

/** The answer's source rows, in order. */
function sources(page: Page) {
  return runAnswer(page).locator('[data-testid^="query-row-"]');
}

test.describe('Feature: Every workflow whose answer ran queries gets the query inspector', () => {
  test(
    'an Assess Data Readiness run with a drill-down query shows its sources and opens the inspector',
    { tag: ['@demo', '@story-1.27.10'] },
    async ({ page }) => {
      const from = `${worldCupKey('matches')} a CROSS JOIN ${worldCupKey('matches')} b`;
      const total = Number(await worldCupScalar(`SELECT COUNT(*) FROM ${from}`));
      expect(total).toBeGreaterThan(100);
      const sql = `SELECT a.id AS a_id, b.id AS b_id FROM ${from}`;
      const explain = (request: StubRequest): StubReply => {
        if (request.messages.at(-1)?.role === 'tool') {
          return { text: 'The matches table was checked: see the drill-down query.' };
        }
        const tool = request.tools.find((name) => name.endsWith('run_readonly_sql'));
        return tool === undefined
          ? { text: 'Assessed.' }
          : {
              toolCall: {
                name: tool,
                arguments: { sql, rationale: 'Looking at the rows behind a finding.' },
              },
            };
      };
      stub.reply = (request) =>
        request.tools.some((name) => name.endsWith('run_readonly_sql'))
          ? explain(request)
          : { text: 'Assessed.' };
      const inspector = page.getByTestId('query-inspector');

      await scenarioStep(
        page,
        `Given I ran Assess Data Readiness on "${WORLD_CUP_DATASET}" and its explanation ran a drill-down query`,
        async () => {
          await openWorkflowPage(page, 'data-readiness-assessment', 'Assess Data Readiness');
          await openRunTab(page);
          await page
            .getByTestId('workflow-input-dataset')
            .selectOption({ label: WORLD_CUP_DATASET });
          await page.getByTestId('workflow-run').click();
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded', {
            timeout: 60_000,
          });
        },
      );
      await scenarioStep(page, 'Then the answer lists the query as a source', async () => {
        // The rows behind the findings come first (1.27.11); the agent's
        // drill-down query is the last source.
        await expect(sources(page).last()).toBeVisible();
      });
      await scenarioStep(page, 'When I open the source', async () => {
        await sources(page).last().click();
        await expect(inspector).toBeVisible();
        await inspector.getByTestId('query-inspector-tab-result').click();
      });
      await scenarioStep(page, 'And I click Next', async () => {
        await expect(inspector.getByTestId('query-result-table')).toBeVisible();
        await inspector.getByTestId('query-result-next-page').click();
      });
      await scenarioStep(page, 'Then the next page of the full result shows', async () => {
        await expect(inspector.getByTestId('query-result-page-label')).toHaveText(
          `Rows 51–100 of ${total.toLocaleString('en-US')}`,
        );
      });
    },
  );
});
