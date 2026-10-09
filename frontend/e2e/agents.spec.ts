import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASOURCE,
  createWorldCupDatasource,
  createWorldCupDataset,
} from './helpers/app-actions';

/**
 * The questions tab opens on the set list — a set has to be clicked before its
 * questions (and the run controls) are on screen.
 */
async function openWorldCupSet(page: Page): Promise<void> {
  await page.getByTestId('eval-set-world-cup').click();
}

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

test('opens an agent from the Agents list and switches between its tabs', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Agents' }).click();

  // The hub lists the harness registry in sections; the System section
  // shows its first row of 3 until "Show more" (R3).
  const assistantRow = page.getByTestId('agent-assistant');
  await expect(
    page.getByTestId('agent-section-official').getByTestId('agent-assistant'),
  ).toContainText('Questions to Insights Assistant');
  await page.getByTestId('agent-show-more-system').click();
  await expect(
    page.getByTestId('agent-section-system').getByTestId('agent-sql-fixer'),
  ).toBeVisible();

  await assistantRow.click();

  // Detail header, then one tab at a time.
  await expect(
    page.getByRole('heading', { name: 'Questions to Insights Assistant' }),
  ).toBeVisible();

  // Prompt is the default tab.
  await expect(page.locator('pre')).toContainText(
    'You are the Questions to Insights assistant',
  );

  await page.getByTestId('agent-tab-tools').click();
  await expect(page.getByText('run_readonly_sql')).toBeVisible();
  await expect(page.getByText('ask_clarification')).toBeVisible();

  await page.getByTestId('agent-tab-memory').click();
  await expect(page.getByText('Recent messages replayed')).toBeVisible();
  await expect(page.getByText('40 messages')).toBeVisible();

  await page.getByTestId('agent-tab-model').click();
  await expect(page.getByText('Provider')).toBeVisible();

  await page.getByTestId('agent-tab-evals').click();
  // The tab opens on the set list, with every question still hidden.
  await expect(page.getByTestId('eval-set-world-cup')).toContainText(
    '10 questions',
  );
  await expect(page.locator('[data-testid^="eval-case-"]')).toHaveCount(0);
  await expect(page.getByTestId('eval-run')).toBeHidden();

  await openWorldCupSet(page);
  await expect(page.getByTestId('eval-case-champion-2022')).toContainText(
    'Who won the 2022 World Cup?',
  );
  // The checks each question is scored by are listed with it.
  await expect(page.getByTestId('eval-case-champion-2022')).toContainText(
    'Checks if output includes "Argentina"',
  );
  await expect(page.locator('[data-testid^="eval-case-"]')).toHaveCount(10);

  // Clicking the open set again collapses it.
  await page.getByTestId('eval-set-world-cup').click();
  await expect(page.locator('[data-testid^="eval-case-"]')).toHaveCount(0);

  // Back returns to the hub, with the System section collapsed again.
  await page.getByRole('button', { name: 'All agents' }).click();
  await page.getByTestId('agent-show-more-system').click();
  await expect(
    page.getByTestId('agent-section-system').getByTestId('agent-sql-verifier'),
  ).toBeVisible();
});

test('shows the stateless, no-tool agents accurately', async ({ page }) => {
  await page.getByRole('button', { name: 'Agents' }).click();
  await page.getByTestId('agent-show-more-system').click();
  await page.getByTestId('agent-sql-fixer').click();

  await page.getByTestId('agent-tab-tools').click();
  await expect(
    page.getByText('This agent runs in a single step with no tools.'),
  ).toBeVisible();

  await page.getByTestId('agent-tab-memory').click();
  await expect(
    page.getByText('This agent is stateless — no memory is configured.'),
  ).toBeVisible();

  await page.getByTestId('agent-tab-evals').click();
  await expect(
    page.getByText('No evals configured for this agent yet.'),
  ).toBeVisible();
});

test('offers the configured datasources and starts a run from the evals tab', async ({
  page,
}) => {
  // A run needs the World Cup fixture tables and views in its saved scope.
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);

  await page.getByRole('button', { name: 'Agents' }).click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  const picker = page.getByTestId('eval-datasource-select');
  await expect(picker).toContainText(WORLD_CUP_DATASOURCE);
  await expect(picker).toContainText('PostgreSQL');

  // Every question is ticked by default.
  await expect(page.getByTestId('eval-run')).toContainText('Run 10 selected');

  // Starting the run is enough to assert here: completing it means live model
  // calls, which the suite must not make.
  await page.getByTestId('eval-run').click();
  await expect(page.getByTestId('eval-run')).toContainText('Running…');
  await expect(page.getByText(/0\/10 done/)).toBeVisible();
});

test('runs only the ticked questions', async ({ page }) => {
  // The run button is also gated on having a datasource, so give it one — the
  // assertions below are about the ticks, not the dropdown.
  await createWorldCupDatasource(page);
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: 'Agents' }).click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  const run = page.getByTestId('eval-run');
  await expect(run).toContainText('Run 10 selected');

  // Untick one, then clear the rest via select-all.
  await page.getByTestId('eval-select-champion-2022').uncheck();
  await expect(run).toContainText('Run 9 selected');

  await page.getByTestId('eval-select-all').click();
  await expect(run).toContainText('Run 10 selected');
  await page.getByTestId('eval-select-all').click();
  await expect(run).toContainText('Run 0 selected');
  await expect(run).toBeDisabled();

  // A single ticked question is enough to run.
  await page.getByTestId('eval-select-shootouts').check();
  await expect(run).toContainText('Run 1 selected');
  await expect(run).toBeEnabled();
});

test('refuses to run against a datasource with no datasets', async ({
  page,
}) => {
  await createWorldCupDatasource(page);
  await page.getByRole('button', { name: 'Back' }).click();

  await page.getByRole('button', { name: 'Agents' }).click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  await page.getByTestId('eval-run').click();
  await expect(page.getByText(/has no datasets/)).toBeVisible();
});

test('explains an incomplete eval dataset without starting a run', async ({
  page,
}) => {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page);
  await page.getByRole('button', { name: 'Agents' }).click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);
  await page.getByTestId('eval-run').click();
  await expect(
    page.getByText(/Missing entities: world_cup.tournaments/),
  ).toBeVisible();
  await page.getByTestId('eval-subtab-runs').click();
  await expect(page.getByText(/No eval runs yet/)).toBeVisible();
});

test('opens a question in the right panel with what it is scored on', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Agents' }).click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  const panel = page.getByLabel('Details panel');
  await expect(panel).toContainText('Select a question in the Evals tab');

  await page.getByTestId('eval-case-champion-2022').click();
  await expect(panel).toContainText('Who won the 2022 World Cup?');
  // Intent and the checks it will be scored on, before any run.
  await expect(panel).toContainText('Single-hop lookup');
  await expect(panel).toContainText('Checks if output includes "Argentina"');
  await expect(panel).toContainText(
    'Run the evals to see the steps the agent executed',
  );

  // Selecting another question swaps the panel.
  await page.getByTestId('eval-case-ambiguous-best-team').click();
  await expect(panel).toContainText('Which team performed best?');
});

test('separates the question suite from past executions', async ({ page }) => {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);

  await page.getByRole('button', { name: 'Agents' }).click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  // Questions is the default sub-tab.
  await expect(page.locator('[data-testid^="eval-case-"]')).toHaveCount(10);

  await page.getByTestId('eval-subtab-runs').click();
  await expect(page.getByText(/No eval runs yet/)).toBeVisible();
  await expect(page.locator('[data-testid^="eval-case-"]')).toHaveCount(0);

  // Starting a run puts it in the executions list (it stays running — the
  // suite must not wait for live model calls).
  await page.getByTestId('eval-subtab-questions').click();
  await page.getByTestId('eval-run').click();
  await page.getByTestId('eval-subtab-runs').click();
  await expect(
    page.locator('[data-testid^="eval-run-"]').first(),
  ).toContainText('0/10 passed');

  await page.getByTestId('eval-subtab-questions').click();
  await expect(page.locator('[data-testid^="eval-case-"]')).toHaveCount(10);
});

test('downloads an execution as a Markdown report', async ({ page }) => {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);

  await page.getByRole('button', { name: 'Agents' }).click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);
  await page.getByTestId('eval-run').click();

  await page.getByTestId('eval-subtab-runs').click();
  const download = page.locator('[data-testid^="eval-run-download-"]').first();
  await expect(download).toBeVisible();

  // Playwright's download event is not wired through the Electron renderer, so
  // assert the response that feeds the save instead.
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) =>
        res.url().includes('/evals/runs/') && res.url().endsWith('/download'),
    ),
    download.click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/markdown');
  expect(response.headers()['content-disposition']).toMatch(
    /filename="eval-run-assistant-.*\.md"/,
  );

  const report = await response.text();
  expect(report).toContain('# Eval run — assistant');
  expect(report).toContain('## Summary');
  expect(report).toContain('Who won the 2022 World Cup?');
});
