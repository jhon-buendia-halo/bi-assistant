import axe from 'axe-core';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { saveLenaiSettings } from './helpers/agents-api';
import { startLlmStub } from './helpers/llm-stub';
import {
  WORLD_CUP_DATASET,
  WORLD_CUP_DATASOURCE,
  createWorldCupDatasource,
  createWorldCupDataset,
  followOsTheme,
} from './helpers/app-actions';
import { appSql } from './helpers/app-db';

/**
 * The questions tab opens on the set list — a set has to be clicked before its
 * questions (and the run controls) are on screen.
 */
async function openWorldCupSet(page: Page): Promise<void> {
  await page.getByTestId('eval-set-world-cup').click();
}

/**
 * The question rows. A row's button is `eval-case-<id>` and its category chip
 * `eval-case-category-<id>`, so the prefix alone would count both.
 */
const CASE_ROWS =
  '[data-testid^="eval-case-"]:not([data-testid^="eval-case-category-"])';

/** Whether a request is the one that starts an eval run. */
function isRunStart(method: string, url: string): boolean {
  return method === 'POST' && new URL(url).pathname.endsWith('/evals/run');
}

type SeededStatus = 'passed' | 'failed' | 'not-scored';

function seededCheck(
  id: string,
  description: string,
  criterion: string,
  status: SeededStatus,
  reason?: string,
) {
  return {
    id,
    description,
    criterion,
    status,
    score: status === 'passed' ? 1 : 0,
    passed: status === 'passed',
    ...(reason ? { reason } : {}),
  };
}

function seededResult(
  id: string,
  question: string,
  category: string,
  status: SeededStatus,
  checkResults: ReturnType<typeof seededCheck>[],
) {
  return {
    id,
    question,
    category,
    status,
    passed: status === 'passed',
    scores: Object.fromEntries(checkResults.map((c) => [c.id, c.score])),
    checkResults,
    answer: 'A seeded answer.',
    toolCalls: [],
    durationMs: 1200,
  };
}

/** Job id of the seeded finished run. */
const SEEDED_RUN = 'seeded-judge-off';

/**
 * Stores a finished run of the world-cup set with the judge off, straight in
 * the app's database: a run that reaches its end needs a model, which the suite does not have. It is stored without a
 * summary, which the backend computes whenever a run is read (R148). One
 * question passed (lookup), one failed (join), and one, whose only check is
 * the judge, was not scored (out-of-scope).
 */
function seedFinishedRun(appDataDir: string): void {
  const run = {
    jobId: SEEDED_RUN,
    agentKey: 'assistant',
    datasourceId: 'seeded-datasource',
    datasets: [WORLD_CUP_DATASET],
    caseIds: ['champion-2022', 'final-score-2018', 'out-of-scope'],
    status: 'completed',
    totalCases: 3,
    startedAt: '2026-10-01T09:00:00.000Z',
    finishedAt: '2026-10-01T09:01:00.000Z',
    judge: { mode: 'off' },
    results: [
      seededResult(
        'champion-2022',
        'Who won the 2022 World Cup?',
        'lookup',
        'passed',
        [
          seededCheck(
            'check-includes',
            'Checks if output includes "Argentina"',
            'G1',
            'passed',
          ),
          seededCheck(
            'check-called-tool',
            'Checks that "run_readonly_sql" was called',
            'D1',
            'passed',
          ),
          seededCheck(
            'check-no-tool-errors',
            'Checks that no tool calls resulted in errors',
            'D3',
            'passed',
          ),
        ],
      ),
      seededResult(
        'final-score-2018',
        'What was the score of the 2018 World Cup final?',
        'join',
        'failed',
        [
          seededCheck(
            'check-includes',
            'Checks if output includes "France"',
            'G1',
            'failed',
            'The answer does not include "France"',
          ),
          seededCheck(
            'check-called-tool',
            'Checks that "run_readonly_sql" was called',
            'D1',
            'passed',
          ),
        ],
      ),
      seededResult(
        'out-of-scope',
        'How many goals did Pelé score in the 1970 World Cup?',
        'out-of-scope',
        'not-scored',
        [
          seededCheck(
            'llm-judge',
            'LLM judge: says it cannot answer for 1970 and names the years the data covers',
            'G2',
            'not-scored',
            'Judge off for this run',
          ),
        ],
      ),
    ],
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:01:00.000Z',
  };
  appSql(
    appDataDir,
    'INSERT INTO "eval_runs" (doc) VALUES (?)',
    JSON.stringify(run),
  );
}

/** axe violations on the page in Light then Dark, one line per node. */
async function axeViolations(page: Page, view: string): Promise<string[]> {
  const found: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.mouse.move(1, 1);
    // Let the theme's colour transitions finish before axe reads colours.
    await page.waitForTimeout(500);
    const results = await page.evaluate(async () =>
      (window as unknown as { axe: typeof axe }).axe.run(document),
    );
    for (const violation of results.violations) {
      for (const node of violation.nodes) {
        found.push(
          `${theme} · ${view} · ${violation.id} · ${node.target.join(' ')}`,
        );
      }
    }
  }
  return found;
}

const WORLD_CUP_EVAL_TABLES = [
  'tournaments',
  'teams',
  'matches',
  'venues',
  'players',
  'goals',
  'match_team_statistics',
  'disciplinary_events',
  'v_match_results',
  'v_player_goal_totals',
];

test('opens an agent from the Agents list and switches between its tabs', async ({
  page,
}) => {
  // The LLM Config tab shows a provider only once settings are saved; no
  // model call is made here.
  const stub = await startLlmStub();
  await saveLenaiSettings(page, stub.baseUrl);
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();

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

  // The Chat Box is the first tab, with Start chat (R90).
  await expect(page.getByTestId('agent-chat-start')).toBeVisible();

  await page.getByTestId('agent-tab-prompt').click();
  await expect(page.getByTestId('agent-prompt-view')).toContainText(
    'You are the Questions to Insights assistant',
  );

  await page.getByTestId('agent-tab-tools').click();
  await expect(
    page.getByText('run_readonly_sql').locator('visible=true').first(),
  ).toBeVisible();
  await expect(
    page.getByText('ask_clarification').locator('visible=true').first(),
  ).toBeVisible();

  await page.getByTestId('agent-tab-memory').click();
  await expect(page.getByText('Recent messages replayed')).toBeVisible();
  await expect(page.getByText('40 messages')).toBeVisible();

  await page.getByTestId('agent-tab-model').click();
  await expect(page.getByText('Provider')).toBeVisible();

  await page.getByTestId('agent-tab-evals').click();
  // The tab opens on the set list, with every question still hidden.
  await expect(page.getByTestId('eval-set-world-cup')).toContainText(
    '12 questions',
  );
  await expect(page.locator(CASE_ROWS)).toHaveCount(0);
  await expect(page.getByTestId('eval-run')).toBeHidden();

  await openWorldCupSet(page);
  await expect(page.getByTestId('eval-case-champion-2022')).toContainText(
    'Who won the 2022 World Cup?',
  );
  // The checks each question is scored by are listed with it.
  await expect(page.getByTestId('eval-case-champion-2022')).toContainText(
    'Checks if output includes "Argentina"',
  );
  // So is the category of each question, as a chip.
  await expect(page.getByTestId('eval-case-category-champion-2022')).toHaveText(
    'lookup',
  );
  await expect(page.getByTestId('eval-case-category-out-of-scope')).toHaveText(
    'out-of-scope',
  );
  await expect(page.locator(CASE_ROWS)).toHaveCount(12);
  await expect(
    page.locator('[data-testid^="eval-case-category-"]'),
  ).toHaveCount(12);

  // Clicking the open set again collapses it.
  await page.getByTestId('eval-set-world-cup').click();
  await expect(page.locator(CASE_ROWS)).toHaveCount(0);

  // Back returns to the hub, with the System section collapsed again.
  await page.getByRole('button', { name: 'All agents' }).click();
  await page.getByTestId('agent-show-more-system').click();
  await expect(
    page.getByTestId('agent-section-system').getByTestId('agent-sql-verifier'),
  ).toBeVisible();
  await stub.close();
});

test('shows the stateless, no-tool agents accurately', async ({ page }) => {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
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

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  const picker = page.getByTestId('eval-datasource-select');
  await expect(picker).toContainText(WORLD_CUP_DATASOURCE);
  await expect(picker).toContainText('PostgreSQL');

  // Every question is ticked by default.
  await expect(page.getByTestId('eval-run')).toContainText('Run 12 selected');

  // Starting the run is enough to assert here: completing it means live model
  // calls, which the suite must not make.
  await page.getByTestId('eval-run').click();
  await expect(page.getByTestId('eval-run')).toContainText('Running…');
  await expect(page.getByText(/0\/12 done/)).toBeVisible();
});

test('runs only the ticked questions', async ({ page }) => {
  // The run button is also gated on having a datasource, so give it one — the
  // assertions below are about the ticks, not the dropdown.
  await createWorldCupDatasource(page);

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  const run = page.getByTestId('eval-run');
  await expect(run).toContainText('Run 12 selected');

  // Untick one, then clear the rest via select-all.
  await page.getByTestId('eval-select-champion-2022').uncheck();
  await expect(run).toContainText('Run 11 selected');

  await page.getByTestId('eval-select-all').click();
  await expect(run).toContainText('Run 12 selected');
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

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
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
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
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
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  // The details panel is closed until a question is selected (on demand).
  const panel = page.getByLabel('Details panel');
  await expect(panel).toHaveCount(0);

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

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  // Questions is the default sub-tab.
  await expect(page.locator(CASE_ROWS)).toHaveCount(12);

  await page.getByTestId('eval-subtab-runs').click();
  await expect(page.getByText(/No eval runs yet/)).toBeVisible();
  await expect(page.locator(CASE_ROWS)).toHaveCount(0);

  // Starting a run puts it in the executions list (it stays running — the
  // suite must not wait for live model calls).
  await page.getByTestId('eval-subtab-questions').click();
  await page.getByTestId('eval-run').click();
  await page.getByTestId('eval-subtab-runs').click();
  await expect(
    page.locator('[data-testid^="eval-run-"]').first(),
  ).toContainText('0/12 passed');

  await page.getByTestId('eval-subtab-questions').click();
  await expect(page.locator(CASE_ROWS)).toHaveCount(12);
});

test('downloads an execution as a Markdown report', async ({ page }) => {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
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
  // The run's judge option and its two summary sections (R153), which a run
  // with no finished question has too.
  expect(report).toContain('Judge: off');
  expect(report).toContain('## By category');
  expect(report).toContain('## By criterion');
  expect(report).toContain('## Summary');
  expect(report).toContain('Who won the 2022 World Cup?');
});

/**
 * The sets the question bank files produce (agents-evals R11, R107): the World
 * Cup file gives two variants, PostgreSQL and REST; Formula 1 and the golden
 * set one each. Test ids are `eval-set-<set id>` and match exactly, so
 * `eval-set-world-cup` never matches the `-rest` or `-golden` sets.
 */
const EVAL_SETS: ReadonlyArray<[id: string, name: string, questions: number]> =
  [
    ['world-cup', 'World Cup', 12],
    ['world-cup-rest', 'World Cup (REST API)', 12],
    ['world-cup-databricks', 'World Cup (Databricks)', 12],
    ['formula-1', 'Formula 1', 10],
    ['world-cup-golden', 'World Cup (golden set)', 11],
    ['world-cup-golden-rest', 'World Cup (golden set, REST API)', 11],
    ['world-cup-golden-databricks', 'World Cup (golden set, Databricks)', 11],
    ['world-cup-rest-connector', 'World Cup (REST connector)', 12],
    ['world-cup-databricks-only', 'World Cup (Databricks only)', 10],
    ['finance', 'Finance', 68],
    ['finance-rest', 'Finance (REST API)', 68],
    ['finance-databricks', 'Finance (Databricks)', 68],
    ['health-insurance', 'Health Insurance', 42],
    ['genomics', 'Genomics', 49],
    ['supply-chain', 'Supply Chain', 20],
    ['marketing-analytics', 'Marketing Analytics', 50],
    ['marketing-analytics-rest', 'Marketing Analytics (REST API)', 50],
    ['marketing-analytics-databricks', 'Marketing Analytics (Databricks)', 50],
  ];

test('lists every question set, the golden set among them', async ({
  page,
}) => {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();

  await expect(page.locator('[data-testid^="eval-set-"]')).toHaveCount(
    EVAL_SETS.length,
  );
  for (const [id, name, questions] of EVAL_SETS) {
    const set = page.getByTestId(`eval-set-${id}`);
    await expect(set).toContainText(name);
    await expect(set).toContainText(`${questions} questions`);
  }

  // The golden set (R109): the nine golden-set questions and the two
  // answer-quality ones, each scored as having run SQL with no tool errors.
  // Its case ids live in the question bank file, so match on question text.
  await page.getByTestId('eval-set-world-cup-golden').click();
  const cases = page.locator(CASE_ROWS);
  await expect(cases).toHaveCount(11);
  await expect(
    cases.filter({
      hasText: 'Which teams scored exactly four goals in total?',
    }),
  ).toHaveCount(1);
  await expect(
    cases.filter({
      hasText: 'What share of the disciplinary cards shown were yellow?',
    }),
  ).toHaveCount(1);
  await expect(
    cases.filter({ hasText: 'Checks that "run_readonly_sql" was called' }),
  ).toHaveCount(11);
  await expect(
    cases.filter({ hasText: 'Checks that no tool calls resulted in errors' }),
  ).toHaveCount(11);
});

test('starts a run of the golden set on the World Cup datasource', async ({
  page,
}) => {
  // The golden set is bound to the World Cup PostgreSQL sample, so the same
  // saved scope as the world-cup set passes its preflight (R19, R20).
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await page.getByTestId('eval-set-world-cup-golden').click();

  const run = page.getByTestId('eval-run');
  await expect(run).toContainText('Run 11 selected');

  // Starting is enough: completing it means live model calls.
  await run.click();
  await expect(run).toContainText('Running…');
  await expect(page.getByText(/0\/11 done/)).toBeVisible();
});

test('runs with the judge off by default', async ({ page, appDataDir }) => {
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);
  seedFinishedRun(appDataDir);

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await openWorldCupSet(page);

  // A labelled select next to the run button, Off unless changed.
  const judge = page.getByLabel('Judge', { exact: true });
  await expect(judge).toHaveValue('off');
  await expect(page.getByTestId('eval-judge')).toHaveValue('off');
  await expect(judge.locator('option')).toHaveText(['Off', 'On']);

  // The run is started with the judge off, and its view says so.
  const firstPoll = page.waitForResponse(
    (res) =>
      res.request().method() === 'GET' &&
      /\/evals\/runs\/[^/]+$/.test(new URL(res.url()).pathname),
  );
  const [request] = await Promise.all([
    page.waitForRequest((req) => isRunStart(req.method(), req.url())),
    page.getByTestId('eval-run').click(),
  ]);
  expect(request.postDataJSON()).toMatchObject({ judge: 'off' });
  const view = (await (await firstPoll).json()) as {
    judge?: { mode?: string };
  };
  expect(view.judge).toMatchObject({ mode: 'off' });

  // In the finished run, the question whose only check is the judge was not
  // scored.
  await page.getByTestId('eval-subtab-runs').click();
  await page
    .getByTestId(`eval-run-${SEEDED_RUN}`)
    .getByRole('button', { name: /passed/ })
    .click();
  const row = page.getByTestId(`eval-run-result-${SEEDED_RUN}-out-of-scope`);
  await expect(row).toContainText('Not scored');

  await row.click();
  const panel = page.getByLabel('Details panel');
  await expect(panel).toContainText(
    'How many goals did Pelé score in the 1970 World Cup?',
  );
  await expect(panel).toContainText('Not scored');
  const judgeCheck = panel.getByTestId('eval-trace-check-llm-judge');
  await expect(judgeCheck).toContainText('LLM judge');
  await expect(judgeCheck).toContainText('Not scored');
  await expect(judgeCheck).toContainText('Judge off for this run');
});

test('reports pass rate by category', async ({ page, appDataDir }) => {
  await followOsTheme(page);
  seedFinishedRun(appDataDir);
  await page.addScriptTag({ content: axe.source });

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await page.getByTestId('eval-subtab-runs').click();

  const card = page.getByTestId(`eval-run-${SEEDED_RUN}`);
  await expect(card).toContainText('1/3 passed · 1 not scored');
  await card.getByRole('button', { name: /passed/ }).click();
  const summary = page.getByTestId(`eval-run-summary-${SEEDED_RUN}`);

  // By category: one row per category, counting questions.
  const byCategory = summary.getByRole('table', { name: 'By category' });
  await expect(byCategory.getByRole('columnheader')).toHaveText([
    'Category',
    'Passed',
    'Failed',
    'Not scored',
    'Total',
  ]);
  const categoryCounts = (category: string) =>
    summary.getByTestId(`eval-run-summary-category-${category}`).locator('td');
  await expect(categoryCounts('lookup')).toHaveText(['1', '0', '0', '1']);
  await expect(categoryCounts('join')).toHaveText(['0', '1', '0', '1']);
  await expect(categoryCounts('out-of-scope')).toHaveText(['0', '0', '1', '1']);

  // By criterion: one row per criterion of a scored check, counting checks;
  // the not-scored judge check (G2) counts nowhere.
  const byCriterion = summary.getByRole('table', { name: 'By criterion' });
  await expect(byCriterion.getByRole('columnheader')).toHaveText([
    'Criterion',
    'Passed',
    'Failed',
    'Total',
  ]);
  const criterionCounts = (criterion: string) =>
    summary
      .getByTestId(`eval-run-summary-criterion-${criterion}`)
      .locator('td');
  await expect(criterionCounts('D1')).toHaveText(['2', '0', '2']);
  await expect(criterionCounts('D3')).toHaveText(['1', '0', '1']);
  await expect(criterionCounts('G1')).toHaveText(['1', '1', '2']);
  await expect(
    summary.getByTestId('eval-run-summary-criterion-G2'),
  ).toHaveCount(0);

  // No accessibility violations on the new parts, in either theme: the
  // tables, the not-scored marks and the Details panel, then the question
  // list with its category chips and the Judge select.
  await page.getByTestId(`eval-run-result-${SEEDED_RUN}-out-of-scope`).click();
  await expect(page.getByLabel('Details panel')).toContainText(
    'Judge off for this run',
  );
  const executions = await axeViolations(page, 'Evals executions');
  await page.getByTestId('eval-subtab-questions').click();
  await openWorldCupSet(page);
  await expect(page.getByTestId('eval-judge')).toBeVisible();
  const questions = await axeViolations(page, 'Evals questions');
  expect([...executions, ...questions]).toEqual([]);
});
