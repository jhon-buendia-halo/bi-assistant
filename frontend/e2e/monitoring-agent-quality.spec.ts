import type { Page } from '@playwright/test';
import axe from 'axe-core';
import { expect, test } from './fixtures/app.fixture';
import { apiBase, saveLenaiSettings } from './helpers/agents-api';
import {
  createWorldCupDataset,
  createWorldCupDatasource,
  followOsTheme,
} from './helpers/app-actions';
import { startLlmStub, type LlmStub } from './helpers/llm-stub';
import { runQuestionOk } from './helpers/runs-api';
import { scenarioStep } from './support/demo-captions';

/**
 * Mirrors `Feature: Agent quality` in specs/capabilities/monitoring/spec.md
 * (docs/plans/monitoring-agent-quality.md). The eval run and the live run are
 * real: Elena's one question and Insights Analyst's turn go to the
 * recording LLM stub, are traced by Mastra and read back by
 * `GET /monitoring/agent-quality`.
 */

const WORLD_CUP_EVAL_TABLES = [
  'tournaments',
  'teams',
  'matches',
  'venues',
  'players',
  'goals',
  'match_team_statistics',
  'v_match_results',
  'v_player_goal_totals',
];
/** saveLenaiSettings' deployment name, the model the runs are made with. */
const MODEL = 'stub-deployment';

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  // Background: an LLM is configured.
  stub = await startLlmStub();
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

const railItem = (page: Page, name: string) =>
  page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });

async function openAgentQuality(page: Page): Promise<void> {
  await railItem(page, 'Monitoring').click();
  await page.getByTestId('monitoring-tab-quality').click();
  await expect(page.getByTestId('agent-quality-table')).toBeVisible();
}

/** Runs Elena's evals on one question and waits for the run to end. */
async function runElenaEvalOnce(page: Page): Promise<string> {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);
  const base = apiBase(page);
  const sources = (await (
    await page.request.get(`${base}/datasources`)
  ).json()) as { datasources: { id: string }[] };
  const started = await page.request.post(`${base}/agents/insights-lead/evals/run`, {
    data: { datasourceId: sources.datasources[0].id, caseIds: ['champion-2022'] },
  });
  const body = (await started.json()) as { ok: boolean; message: string; jobId: string };
  expect(body.ok, body.message).toBe(true);
  await expect
    .poll(
      async () =>
        (
          (await (
            await page.request.get(`${base}/agents/insights-lead/evals/runs/${body.jobId}`)
          ).json()) as { status: string }
        ).status,
      { timeout: 180_000, intervals: [1_000] },
    )
    .not.toBe('running');
  return body.jobId;
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const results = await page.evaluate(async () =>
    (window as unknown as { axe: typeof axe }).axe.run(document),
  );
  expect(results.violations).toEqual([]);
}

test.describe('Feature: Agent quality', () => {
  test('The tab shows its note and the three tabs cycle with the arrow keys', async ({
    page,
  }) => {
    await scenarioStep(page, 'Given I open "Monitoring"', async () => {
      await railItem(page, 'Monitoring').click();
      await expect(page.getByTestId('monitoring-page')).toBeVisible();
    });
    await scenarioStep(page, 'When I choose the "Agent quality" tab', async () => {
      await page.getByTestId('monitoring-tab-quality').click();
    });
    await scenarioStep(
      page,
      'Then I see the note "How each agent persona scores on its evals and behaves in live calls."',
      async () => {
        await expect(page.getByTestId('monitoring-note')).toHaveText(
          'How each agent persona scores on its evals and behaves in live calls.',
        );
        await expect(page.getByRole('tab')).toHaveCount(3);
      },
    );
    await scenarioStep(
      page,
      'When I press ArrowRight on the "Agent quality" tab',
      async () => {
        await page.getByTestId('monitoring-tab-quality').press('ArrowRight');
      },
    );
    await scenarioStep(page, 'Then the "LLM calls" tab is chosen', async () => {
      await expect(page.getByTestId('monitoring-tab-calls')).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });
    await scenarioStep(page, 'When I press ArrowLeft', async () => {
      await page.getByTestId('monitoring-tab-calls').press('ArrowLeft');
    });
    await scenarioStep(
      page,
      'Then the "Agent quality" tab is chosen',
      async () => {
        await expect(page.getByTestId('monitoring-tab-quality')).toHaveAttribute(
          'aria-selected',
          'true',
        );
      },
    );
  });

  test('An agent persona with no eval run shows No eval run yet', async ({
    page,
  }) => {
    await scenarioStep(
      page,
      'Given an agent persona has eval sets and no completed run',
      async () => {},
    );
    await scenarioStep(page, 'When I open the "Agent quality" tab', async () => {
      await openAgentQuality(page);
    });
    await scenarioStep(
      page,
      'Then its row shows "No eval run yet" and dashes in the other eval cells',
      async () => {
        const row = page.getByTestId('agent-quality-row-insights-lead');
        await expect(page.getByTestId('agent-quality-pass-insights-lead')).toHaveText(
          'No eval run yet',
        );
        await expect(page.getByTestId('agent-quality-pass3-insights-lead')).toHaveText('—');
        await expect(row).toBeVisible();
      },
    );
  });

  test('After one eval run the row shows the pass rate and needs 3 runs', async ({
    page,
  }) => {
    await scenarioStep(
      page,
      "Given I ran Elena's evals once on one question",
      async () => {
        await runElenaEvalOnce(page);
      },
    );
    await scenarioStep(page, 'When I open the "Agent quality" tab', async () => {
      await openAgentQuality(page);
    });
    await scenarioStep(
      page,
      'Then Elena\'s pass rate chip reads "<passed>/1 · <rate> %"',
      async () => {
        await expect(page.getByTestId('agent-quality-pass-insights-lead')).toContainText(
          /^\d\/1 · \d+%$/,
        );
      },
    );
    await scenarioStep(
      page,
      'And its pass^3 reads "needs 3 runs (1 of 3)"',
      async () => {
        await expect(page.getByTestId('agent-quality-pass3-insights-lead')).toHaveText(
          'needs 3 runs (1 of 3)',
        );
      },
    );
    await scenarioStep(
      page,
      'And its p95 latency and cost per call are dashes because its eval calls are not live calls',
      async () => {
        await expect(page.getByTestId('agent-quality-p95-insights-lead')).toHaveText('—');
        await expect(page.getByTestId('agent-quality-cost-insights-lead')).toHaveText('—');
      },
    );
    for (const theme of ['light', 'dark'] as const) {
      await scenarioStep(page, `Then axe finds nothing in ${theme}`, async () => {
        await page.emulateMedia({ colorScheme: theme });
        await followOsTheme(page);
        await openAgentQuality(page);
        await expectNoAxeViolations(page);
      });
    }
  });

  test("A live run shows its agent persona's p95 latency", async ({ page }) => {
    await scenarioStep(page, 'Given I ran Insights Analyst on a question', async () => {
      await createWorldCupDatasource(page);
      await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);
      await runQuestionOk(page, 'Which team scored the most goals?');
    });
    await scenarioStep(page, 'When I open the "Agent quality" tab', async () => {
      await expect(async () => {
        // Leave and come back so the table is read again.
        await railItem(page, 'Runs').click();
        await openAgentQuality(page);
        await expect(
          page.getByTestId('agent-quality-p95-insights-analyst'),
        ).toHaveText(/\d+\.\d s/, { timeout: 2_000 });
      }).toPass({ timeout: 45_000 });
    });
    await scenarioStep(
      page,
      'Then the Insights Analyst row shows a p95 latency in seconds',
      async () => {
        await expect(
          page.getByTestId('agent-quality-p95-insights-analyst'),
        ).toHaveText(/\d+\.\d s/);
      },
    );
  });

  test('The Model filter offers the model of the run', async ({ page }) => {
    await scenarioStep(page, 'Given an eval run recorded its model', async () => {
      await runElenaEvalOnce(page);
    });
    await scenarioStep(page, 'When I open the "Model" filter', async () => {
      await openAgentQuality(page);
    });
    await scenarioStep(page, 'Then it offers that model', async () => {
      await expect(
        page.getByTestId('quality-filter-model').locator('option', { hasText: MODEL }),
      ).toHaveCount(1);
    });
  });

  test('Clear filters restores the defaults', async ({ page }) => {
    await runElenaEvalOnce(page);
    await openAgentQuality(page);
    await expect(page.getByTestId('quality-filters-clear')).toBeDisabled();
    await scenarioStep(
      page,
      'Given I chose a model and the period "All time"',
      async () => {
        await page.getByTestId('quality-filter-model').selectOption(MODEL);
        await page.getByTestId('quality-filter-range').selectOption({ label: 'All time' });
        await expect(page.getByTestId('quality-filters-clear')).toBeEnabled();
      },
    );
    await scenarioStep(page, 'When I click "Clear filters"', async () => {
      await page.getByTestId('quality-filters-clear').click();
    });
    await scenarioStep(
      page,
      'Then the filters are back to "All models" and "Last 30 days"',
      async () => {
        await expect(page.getByTestId('quality-filter-model')).toHaveValue('');
        await expect(
          page.getByTestId('quality-filter-range').locator('option:checked'),
        ).toHaveText(/Last 30 days/);
      },
    );
    await scenarioStep(page, 'And "Clear filters" is disabled', async () => {
      await expect(page.getByTestId('quality-filters-clear')).toBeDisabled();
    });
  });

  test("A row opens the agent persona's eval executions", async ({ page }) => {
    let jobId = '';
    await scenarioStep(page, 'Given Elena has an eval run', async () => {
      jobId = await runElenaEvalOnce(page);
      await openAgentQuality(page);
    });
    await scenarioStep(page, "When I choose Elena's row", async () => {
      await page.getByTestId('agent-quality-row-insights-lead').click();
    });
    await scenarioStep(
      page,
      'Then I see the Agent personas page on the Evals tab, sub-tab Executions, listing the run',
      async () => {
        await expect(page.getByTestId('eval-subtab-runs')).toBeVisible();
        await expect(page.getByTestId(`eval-run-${jobId}`)).toBeVisible();
      },
    );
    await scenarioStep(
      page,
      'And "Agent personas" is the current rail item',
      async () => {
        await expect(railItem(page, 'Agent personas')).toHaveAttribute(
          'aria-current',
          'page',
        );
      },
    );
  });
});
