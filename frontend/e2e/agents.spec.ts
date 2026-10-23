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
import { apiJson } from './helpers/api';

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
  storeRun(appDataDir, run);
}

/** Stores a run document straight in the app's database. */
function storeRun(appDataDir: string, run: object): void {
  appSql(
    appDataDir,
    'INSERT INTO "eval_runs" (doc) VALUES (?)',
    JSON.stringify(run),
  );
}

/**
 * One agent's usage on one model (agents-evals R219), no reasoning tokens:
 * `calls` reported tokens, `unreportedCalls` reported none.
 */
function usageEntry(
  agent: 'assistant' | 'sql-fixer',
  model: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  calls: number,
  unreportedCalls = 0,
) {
  return {
    agent,
    model,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens: 0,
    calls,
    unreportedCalls,
  };
}

/** One attempt of a question, as a result's `attempts` holds it (R211). */
function seededAttempt(
  attempt: number,
  status: SeededStatus,
  checkResults: ReturnType<typeof seededCheck>[],
  durationMs: number,
  usage: ReturnType<typeof usageEntry>[],
  costUsd: number,
) {
  return {
    attempt,
    status,
    passed: status === 'passed',
    scores: Object.fromEntries(checkResults.map((c) => [c.id, c.score])),
    checkResults,
    answer: 'A seeded answer.',
    toolCalls: [],
    durationMs,
    usage,
    costUsd,
  };
}

const GPT_4O_MINI = 'gpt-4o-mini';

const CHAMPION_CHECKS = [
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
];

/** Job id of the seeded run with Repeats 3. */
const REPEATS_RUN = 'seeded-repeats-3';

/**
 * Stores a finished run of the world-cup set with Repeats 3 on gpt-4o-mini
 * (R209 to R221): `champion-2022` (dev, lookup) passed all three attempts,
 * and `shot-conversion-2022` (held-out, ratio) passed attempts 1 and 3 and
 * failed attempt 2, so it is flaky and failed, its representative attempt
 * is 2, and its usage is the assistant's and the SQL fixer's. Like the run
 * above it is stored without a summary. The costs are what the backend's
 * own `costUsdOf`, `foldAttempts` and `sumCostUsd` give for these tokens at
 * the bundled price table's gpt-4o-mini rates (computed with
 * `backend/dist/mastra/evals/`, not by hand). `source` is where it was
 * started (R223), and `comparedWith` the earlier run its regression
 * comparison names (R40), with champion-2022 unchanged.
 */
function seedRepeatsRun(
  appDataDir: string,
  {
    source = 'app',
    comparedWith,
  }: { source?: 'app' | 'cli'; comparedWith?: string } = {},
): void {
  const shotPassed = [
    seededCheck(
      'check-includes',
      'Checks if output includes "Netherlands"',
      'G1',
      'passed',
    ),
    seededCheck(
      'check-called-tool',
      'Checks that "run_readonly_sql" was called',
      'D1',
      'passed',
    ),
  ];
  const shotFailed = [
    seededCheck(
      'check-includes',
      'Checks if output includes "Netherlands"',
      'G1',
      'failed',
      'expected "Netherlands" in the answer — answer was "Brazil"',
    ),
    shotPassed[1],
  ];
  storeRun(appDataDir, {
    jobId: REPEATS_RUN,
    agentKey: 'assistant',
    datasourceId: 'seeded-datasource',
    datasets: [WORLD_CUP_DATASET],
    caseIds: ['champion-2022', 'shot-conversion-2022'],
    status: 'completed',
    totalCases: 2,
    startedAt: '2026-10-02T09:00:00.000Z',
    finishedAt: '2026-10-02T09:02:00.000Z',
    judge: { mode: 'off' },
    repeats: 3,
    model: `openai/${GPT_4O_MINI}`,
    source,
    ...(comparedWith
      ? {
          comparison: {
            previousRunId: comparedWith,
            regressions: [],
            improvements: [],
            unchanged: [
              { id: 'champion-2022', question: 'Who won the 2022 World Cup?' },
            ],
          },
        }
      : {}),
    results: [
      {
        ...seededResult(
          'champion-2022',
          'Who won the 2022 World Cup?',
          'lookup',
          'passed',
          CHAMPION_CHECKS,
        ),
        split: 'dev',
        durationMs: 1300,
        passes: 3,
        runs: 3,
        flaky: false,
        usage: [usageEntry('assistant', GPT_4O_MINI, 14410, 7168, 450, 6)],
        costUsd: 0.001894,
        attempts: [
          seededAttempt(
            1,
            'passed',
            CHAMPION_CHECKS,
            1300,
            [usageEntry('assistant', GPT_4O_MINI, 4800, 0, 150, 2)],
            0.00081,
          ),
          seededAttempt(
            2,
            'passed',
            CHAMPION_CHECKS,
            1200,
            [usageEntry('assistant', GPT_4O_MINI, 4800, 3584, 140, 2)],
            0.000535,
          ),
          seededAttempt(
            3,
            'passed',
            CHAMPION_CHECKS,
            1250,
            [usageEntry('assistant', GPT_4O_MINI, 4810, 3584, 160, 2)],
            0.000549,
          ),
        ],
      },
      {
        ...seededResult(
          'shot-conversion-2022',
          'Which team turned the highest share of its shots into goals at the 2022 World Cup?',
          'ratio',
          'failed',
          shotFailed,
        ),
        split: 'held-out',
        durationMs: 2100,
        passes: 2,
        runs: 3,
        flaky: true,
        usage: [
          usageEntry('assistant', GPT_4O_MINI, 18750, 8192, 690, 9),
          usageEntry('sql-fixer', GPT_4O_MINI, 2250, 0, 185, 2),
        ],
        costUsd: 0.00306,
        attempts: [
          seededAttempt(
            1,
            'passed',
            shotPassed,
            1500,
            [
              usageEntry('assistant', GPT_4O_MINI, 6200, 0, 220, 3),
              usageEntry('sql-fixer', GPT_4O_MINI, 1100, 0, 90, 1),
            ],
            0.001281,
          ),
          seededAttempt(
            2,
            'failed',
            shotFailed,
            2100,
            [
              usageEntry('assistant', GPT_4O_MINI, 6400, 4096, 260, 3),
              usageEntry('sql-fixer', GPT_4O_MINI, 1150, 0, 95, 1),
            ],
            0.001038,
          ),
          seededAttempt(
            3,
            'passed',
            shotPassed,
            1400,
            [usageEntry('assistant', GPT_4O_MINI, 6150, 4096, 210, 3)],
            0.000741,
          ),
        ],
      },
    ],
    usage: [
      usageEntry('assistant', GPT_4O_MINI, 33160, 15360, 1140, 15),
      usageEntry('sql-fixer', GPT_4O_MINI, 2250, 0, 185, 2),
    ],
    costUsd: 0.004954,
    // The rates the run was priced with, as the price table had them (R220).
    rates: {
      [GPT_4O_MINI]: {
        inputPerMillionUsd: 0.15,
        cachedInputPerMillionUsd: 0.075,
        outputPerMillionUsd: 0.6,
        source: 'developers.openai.com/api/docs/pricing',
        readOn: '2026-10-20',
      },
    },
    createdAt: '2026-10-02T09:00:00.000Z',
    updatedAt: '2026-10-02T09:02:00.000Z',
  });
}

/** Job id of the seeded run on a model with no price. */
const UNPRICED_RUN = 'seeded-not-priced';

/** A model the bundled price table (data-model 4.11) does not list. */
const UNPRICED_MODEL = 'llama-3.3-70b';

/**
 * Stores a finished run of the world-cup set, Repeats 1, whose one question
 * ran on a model with no price: its tokens are recorded, one of its three
 * calls reported none (R219), its cost and the run's are not priced
 * (`costUsd: null`) and the run keeps no rate (R221).
 */
function seedUnpricedRun(appDataDir: string): void {
  const usage = [usageEntry('assistant', UNPRICED_MODEL, 5100, 0, 180, 2, 1)];
  storeRun(appDataDir, {
    jobId: UNPRICED_RUN,
    agentKey: 'assistant',
    datasourceId: 'seeded-datasource',
    datasets: [WORLD_CUP_DATASET],
    caseIds: ['champion-2022'],
    status: 'completed',
    totalCases: 1,
    startedAt: '2026-10-03T09:00:00.000Z',
    finishedAt: '2026-10-03T09:00:30.000Z',
    judge: { mode: 'off' },
    repeats: 1,
    model: `lenai/${UNPRICED_MODEL}`,
    source: 'app',
    results: [
      {
        ...seededResult(
          'champion-2022',
          'Who won the 2022 World Cup?',
          'lookup',
          'passed',
          CHAMPION_CHECKS,
        ),
        split: 'dev',
        passes: 1,
        runs: 1,
        flaky: false,
        usage,
        costUsd: null,
      },
    ],
    usage,
    costUsd: null,
    rates: {},
    createdAt: '2026-10-03T09:00:00.000Z',
    updatedAt: '2026-10-03T09:00:30.000Z',
  });
}

/** Job id of the seeded run saved before repeats, splits and usage. */
const BEFORE_REPEATS_RUN = 'seeded-before-repeats';

/**
 * Stores a finished run of the world-cup set as runs were saved before
 * BA-242: no repeats, model or source, no split, attempt counts, usage or
 * cost on its results, and none on the run (data-model 3.8). Its held-out
 * question, `shot-conversion-2022`, failed; `champion-2022` (dev) passed.
 */
function seedBeforeRepeatsRun(appDataDir: string): void {
  storeRun(appDataDir, {
    jobId: BEFORE_REPEATS_RUN,
    agentKey: 'assistant',
    datasourceId: 'seeded-datasource',
    datasets: [WORLD_CUP_DATASET],
    caseIds: ['champion-2022', 'shot-conversion-2022'],
    status: 'completed',
    totalCases: 2,
    startedAt: '2026-09-30T09:00:00.000Z',
    finishedAt: '2026-09-30T09:01:00.000Z',
    judge: { mode: 'off' },
    results: [
      seededResult(
        'champion-2022',
        'Who won the 2022 World Cup?',
        'lookup',
        'passed',
        CHAMPION_CHECKS,
      ),
      seededResult(
        'shot-conversion-2022',
        'Which team turned the highest share of its shots into goals at the 2022 World Cup?',
        'ratio',
        'failed',
        [
          seededCheck(
            'check-includes',
            'Checks if output includes "Netherlands"',
            'G1',
            'failed',
            'expected "Netherlands" in the answer — answer was "Brazil"',
          ),
        ],
      ),
    ],
    createdAt: '2026-09-30T09:00:00.000Z',
    updatedAt: '2026-09-30T09:01:00.000Z',
  });
}

/**
 * Downloads a run's Markdown report with its download button, and answers
 * the report (the response that feeds the save, as in the download test).
 */
async function downloadReport(page: Page, jobId: string): Promise<string> {
  const [response] = await Promise.all([
    page.waitForResponse((res) =>
      new URL(res.url()).pathname.endsWith(`/evals/runs/${jobId}/download`),
    ),
    page.getByTestId(`eval-run-download-${jobId}`).click(),
  ]);
  expect(response.status()).toBe(200);
  return response.text();
}

/** Opens the assistant's Evals tab on its Executions sub-tab. */
async function openAssistantExecutions(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await page.getByTestId('eval-subtab-runs').click();
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
    '63 questions',
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
  // A held-out question carries the chip `held-out`, a dev one no split
  // chip (R215).
  await expect(page.getByTestId('eval-split-champion-2022')).toHaveCount(0);
  await expect(
    page
      .getByTestId('eval-case-shot-conversion-2022')
      .getByTestId('eval-split-shot-conversion-2022'),
  ).toHaveText('held-out');
  await expect(page.locator(CASE_ROWS)).toHaveCount(63);
  await expect(
    page.locator('[data-testid^="eval-case-category-"]'),
  ).toHaveCount(63);

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
  await expect(page.getByTestId('eval-run')).toContainText('Run 63 selected');

  // Starting the run is enough to assert here: completing it means live model
  // calls, which the suite must not make.
  await page.getByTestId('eval-run').click();
  await expect(page.getByTestId('eval-run')).toContainText('Running…');
  await expect(page.getByText(/0\/63 done/)).toBeVisible();
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
  await expect(run).toContainText('Run 63 selected');

  // Untick one, then clear the rest via select-all.
  await page.getByTestId('eval-select-champion-2022').uncheck();
  await expect(run).toContainText('Run 62 selected');

  await page.getByTestId('eval-select-all').click();
  await expect(run).toContainText('Run 63 selected');
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
  await expect(page.locator(CASE_ROWS)).toHaveCount(63);

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
  ).toContainText('0/63 passed');

  await page.getByTestId('eval-subtab-questions').click();
  await expect(page.locator(CASE_ROWS)).toHaveCount(63);
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
  // The repeats, dev, held-out and cost lines (R218). The run has only just
  // started, so how many questions it has finished, and so the counts, are
  // not fixed; a new run records its cost from the start, so it is never
  // "not recorded".
  expect(report).toMatch(/^Repeats: 1$/m);
  expect(report).toMatch(/^Dev: \d+\/\d+ passed · 95% interval (—|\d+–\d+%)$/m);
  expect(report).toMatch(
    /^Held-out: \d+\/\d+ passed · 95% interval (—|\d+–\d+%)$/m,
  );
  expect(report).toMatch(
    /^Cost: (\$\d+\.\d{4}( · \$\d+\.\d{4} per question)?|not priced \(.+\))$/m,
  );
  expect(report).toContain('## By category');
  expect(report).toContain('## By criterion');
  expect(report).toContain('## Summary');
  expect(report).toContain('Who won the 2022 World Cup?');
});

/**
 * The sets the question bank files produce (agents-evals R11, R107): the World
 * Cup file gives three variants, PostgreSQL, REST and Databricks, and holds the
 * former golden set as its last 11 questions (R109). Test ids are
 * `eval-set-<set id>` and match exactly, so `eval-set-world-cup` never matches
 * the `-rest` or `-databricks` sets.
 */
const EVAL_SETS: ReadonlyArray<[id: string, name: string, questions: number]> =
  [
    ['world-cup', 'World Cup', 63],
    ['world-cup-rest', 'World Cup (REST API)', 63],
    ['world-cup-databricks', 'World Cup (Databricks)', 63],
    ['formula-1', 'Formula 1', 10],
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

test('lists every question set, the former golden set inside the World Cup sets', async ({
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
  // The golden set is no longer a set of its own (R109).
  await expect(page.getByText('World Cup (golden set)')).toHaveCount(0);

  // Its 11 questions close the World Cup set: the nine golden-set questions
  // and the two answer-quality ones, each scored as having run SQL with no
  // tool errors. Match on question text and position, not case ids.
  await openWorldCupSet(page);
  const cases = page.locator(CASE_ROWS);
  await expect(cases).toHaveCount(63);
  await expect(cases.nth(55)).toContainText(
    'Which teams scored exactly four goals in total?',
  );
  await expect(cases.nth(62)).toContainText(
    'What share of the disciplinary cards shown were yellow?',
  );
  for (let index = 52; index < 63; index += 1) {
    await expect(cases.nth(index)).toContainText(
      'Checks that "run_readonly_sql" was called',
    );
    await expect(cases.nth(index)).toContainText(
      'Checks that no tool calls resulted in errors',
    );
  }
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

  // By category: one row per category, counting questions, its dev and
  // held-out questions side by side as "<passed>/<scored> (<interval>)", or
  // "—" with none scored (R152, R216). The seeded results carry no split, so
  // each reads its question bank case's (R215): all three are dev. The
  // intervals are Wilson's for 1 of 1 and 0 of 1 (R212).
  const byCategory = summary.getByRole('table', { name: 'By category' });
  await expect(byCategory.getByRole('columnheader')).toHaveText([
    'Category',
    'Dev',
    'Held-out',
    'Flaky',
    'Not scored',
    'Total',
  ]);
  const categoryCounts = (category: string) =>
    summary.getByTestId(`eval-run-summary-category-${category}`).locator('td');
  await expect(categoryCounts('lookup')).toHaveText([
    '1/1 (21–100%)',
    '—',
    '0',
    '0',
    '1',
  ]);
  await expect(categoryCounts('join')).toHaveText([
    '0/1 (0–79%)',
    '—',
    '0',
    '0',
    '1',
  ]);
  await expect(categoryCounts('out-of-scope')).toHaveText([
    '—',
    '—',
    '0',
    '1',
    '1',
  ]);

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

test('runs every question three times when Repeats is 3', async ({ page }) => {
  // The stub stands in for the model and holds its first call open, so the
  // run is still going when the test looks at it and no question finishes.
  const stub = await startLlmStub();
  try {
    await saveLenaiSettings(page, stub.baseUrl);
    stub.hold = () => new Promise<void>(() => undefined);
    await createWorldCupDatasource(page);
    await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);

    await page
      .getByRole('complementary', { name: 'Navigation rail' })
      .getByRole('button', { name: 'Agents' })
      .click();
    await page.getByTestId('agent-assistant').click();
    await page.getByTestId('agent-tab-evals').click();
    await openWorldCupSet(page);

    // A labelled select after the Judge select, 1 unless changed (R214).
    const repeats = page.getByLabel('Repeats', { exact: true });
    await expect(repeats).toHaveValue('1');
    await expect(repeats.locator('option')).toHaveText(['1', '3', '5']);
    await repeats.selectOption('3');
    await expect(repeats).toHaveValue('3');

    // The run is started with repeats 3, and records them (R19, R22, R209).
    const firstPoll = page.waitForResponse(
      (res) =>
        res.request().method() === 'GET' &&
        /\/evals\/runs\/[^/]+$/.test(new URL(res.url()).pathname),
    );
    const [request] = await Promise.all([
      page.waitForRequest((req) => isRunStart(req.method(), req.url())),
      page.getByTestId('eval-run').click(),
    ]);
    expect(request.postDataJSON()).toMatchObject({ repeats: 3 });
    const view = (await (await firstPoll).json()) as {
      status?: string;
      repeats?: number;
    };
    expect(view).toMatchObject({ status: 'running', repeats: 3 });

    // The select is disabled while the run is going.
    await expect(page.getByTestId('eval-run')).toContainText('Running…');
    await expect(repeats).toBeDisabled();
  } finally {
    await stub.close();
  }
});

test('shows dev and held-out side by side, with repeats, flaky questions and cost', async ({
  page,
  appDataDir,
}) => {
  await followOsTheme(page);
  seedRepeatsRun(appDataDir);
  await page.addScriptTag({ content: axe.source });

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await page.getByTestId('eval-subtab-runs').click();

  // After "<passed>/<total> passed": the repeats, the flaky questions and
  // the run's cost (R216). The flaky question counts as failed (R211).
  const card = page.getByTestId(`eval-run-${REPEATS_RUN}`);
  await expect(card).toContainText('1/2 passed');
  await expect(card.getByTestId(`eval-run-repeats-${REPEATS_RUN}`)).toHaveText(
    'Repeat 3',
  );
  await expect(card.getByTestId(`eval-run-flaky-${REPEATS_RUN}`)).toHaveText(
    '1 flaky',
  );
  await expect(card.getByTestId(`eval-run-cost-${REPEATS_RUN}`)).toHaveText(
    '$0.0050',
  );

  // Expanded: the split line, dev and held-out each with its passed and
  // scored questions and its interval (R212, R213, R216), computed on read.
  await card.getByRole('button', { name: /passed/ }).click();
  await expect(page.getByTestId(`eval-run-splits-${REPEATS_RUN}`)).toHaveText(
    'Dev 1/1 (21–100%) · Held-out 0/1 (0–79%)',
  );
  const summary = page.getByTestId(`eval-run-summary-${REPEATS_RUN}`);
  const byCategory = summary.getByRole('table', { name: 'By category' });
  await expect(byCategory.getByRole('columnheader')).toHaveText([
    'Category',
    'Dev',
    'Held-out',
    'Flaky',
    'Not scored',
    'Total',
  ]);
  await expect(
    summary.getByTestId('eval-run-summary-category-ratio').locator('td'),
  ).toHaveText(['—', '0/1 (0–79%)', '1', '0', '1']);

  // The flaky question's row: its held-out chip and its passed attempts.
  const row = page.getByTestId(
    `eval-run-result-${REPEATS_RUN}-shot-conversion-2022`,
  );
  await expect(
    row.getByTestId(
      `eval-run-result-split-${REPEATS_RUN}-shot-conversion-2022`,
    ),
  ).toHaveText('held-out');
  await expect(row).toContainText('2/3');

  // The Details panel: split, attempts, tokens per agent and cost (R217).
  await row.click();
  const panel = page.getByLabel('Details panel');
  await expect(panel).toContainText(
    'Which team turned the highest share of its shots into goals at the 2022 World Cup?',
  );
  await expect(panel.getByTestId('eval-trace-split')).toContainText('Held-out');
  const attempts = panel.getByTestId('eval-trace-attempts');
  await expect(attempts).toContainText('2 of 3 attempts passed');
  // One line per attempt, with its verdict and duration, and the attempt
  // whose checks, steps and answer the panel shows: the first that failed
  // (R211).
  await expect(attempts.locator(':scope > div')).toHaveText([
    /^\s*Attempt 1\s*Passed\s*1\.5s\s*$/,
    /^\s*Attempt 2\s*Failed\s*2\.1s\s*$/,
    /^\s*Attempt 3\s*Passed\s*1\.4s\s*$/,
  ]);
  await expect(attempts).toContainText(
    /Checks, steps and answer below are from attempt\s+2\./,
  );
  await expect(panel.getByTestId('eval-trace-failed-checks')).toContainText(
    'expected "Netherlands" in the answer — answer was "Brazil"',
  );
  const assistantTokens = panel.getByTestId('eval-trace-tokens-assistant');
  await expect(assistantTokens).toContainText('Assistant');
  await expect(assistantTokens).toContainText(GPT_4O_MINI);
  await expect(assistantTokens).toContainText(
    '18,750 in · 8,192 cached · 690 out',
  );
  const fixerTokens = panel.getByTestId('eval-trace-tokens-sql-fixer');
  await expect(fixerTokens).toContainText('SQL fixer');
  await expect(fixerTokens).toContainText(GPT_4O_MINI);
  await expect(fixerTokens).toContainText('2,250 in · 185 out');
  await expect(panel.getByTestId('eval-trace-cost')).toHaveText('$0.0031');

  // No accessibility violations on the new parts, in either theme.
  expect(await axeViolations(page, 'Evals executions with repeats')).toEqual(
    [],
  );
});

test('says "Not priced" for a model with no price', async ({
  page,
  appDataDir,
}) => {
  seedUnpricedRun(appDataDir);

  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents' })
    .click();
  await page.getByTestId('agent-assistant').click();
  await page.getByTestId('agent-tab-evals').click();
  await page.getByTestId('eval-subtab-runs').click();

  // Not priced, naming the model without a price (R216, R221).
  const cost = page.getByTestId(`eval-run-cost-${UNPRICED_RUN}`);
  await expect(cost).toHaveText('Not priced');
  await expect(cost).toHaveAttribute('title', `No price for ${UNPRICED_MODEL}`);

  // The question's tokens are still shown, with the call that reported
  // none, and its cost is not priced (R217).
  await page
    .getByTestId(`eval-run-${UNPRICED_RUN}`)
    .getByRole('button', { name: /passed/ })
    .click();
  await page
    .getByTestId(`eval-run-result-${UNPRICED_RUN}-champion-2022`)
    .click();
  const panel = page.getByLabel('Details panel');
  await expect(panel).toContainText('Who won the 2022 World Cup?');
  const tokens = panel.getByTestId('eval-trace-tokens-assistant');
  await expect(tokens).toContainText(UNPRICED_MODEL);
  await expect(tokens).toContainText(
    '5,100 in · 180 out · 1 call reported no usage',
  );
  await expect(panel.getByTestId('eval-trace-cost')).toHaveText('Not priced');

  // The report names the model without a rate, and counts every call, the
  // one without usage too (R218, R221).
  const report = await downloadReport(page, UNPRICED_RUN);
  expect(report).toMatch(/^Cost: not priced \(llama-3\.3-70b\)$/m);
  expect(report).toMatch(
    /^Tokens: 5,100 in \(0 cached\) · 180 out \(0 reasoning\) · 3 calls · 1 without usage$/m,
  );
});

test('shows which attempt of a question is running when Repeats is 3', async ({
  page,
}) => {
  // The stub stands in for the model. It answers the run's first call, so
  // the first attempt of the first question finishes (its checks fail on
  // the stub's answer), and holds every later call open, so the second
  // attempt is still running when the test looks (R210, R214).
  const stub = await startLlmStub();
  try {
    await saveLenaiSettings(page, stub.baseUrl);
    await createWorldCupDatasource(page);
    await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);

    await page
      .getByRole('complementary', { name: 'Navigation rail' })
      .getByRole('button', { name: 'Agents' })
      .click();
    await page.getByTestId('agent-assistant').click();
    await page.getByTestId('agent-tab-evals').click();
    await openWorldCupSet(page);
    await page.getByLabel('Repeats', { exact: true }).selectOption('3');

    const callsBefore = stub.requests.length;
    stub.hold = () =>
      stub.requests.length > callsBefore + 1
        ? new Promise<void>(() => undefined)
        : undefined;
    await page.getByTestId('eval-run').click();

    // The progress line ends with the attempt in flight (R26, R214). No
    // question has finished: its result lands once all three attempts have.
    await expect(
      page.getByText(/^\s*0\/63 done\s+·\s+0 passed\s+·\s+attempt 2\/3\s*$/),
    ).toBeVisible({ timeout: 20_000 });
    expect(stub.requests.length - callsBefore).toBe(2);
  } finally {
    await stub.close();
  }
});

test('downloads the report of a command-line run with Repeats 3, compared with a run of Repeats 1', async ({
  page,
  appDataDir,
}) => {
  // The earlier run reads as Repeats 1 (R209); the later one carries the
  // source a command-line run is saved with (R223) and its comparison with
  // the earlier one (R40).
  seedFinishedRun(appDataDir);
  seedRepeatsRun(appDataDir, { source: 'cli', comparedWith: SEEDED_RUN });

  await openAssistantExecutions(page);

  // An app on the same data directory lists both runs, newest first.
  const cards = page.locator(
    `[data-testid="eval-run-${REPEATS_RUN}"], [data-testid="eval-run-${SEEDED_RUN}"]`,
  );
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAttribute(
    'data-testid',
    `eval-run-${REPEATS_RUN}`,
  );

  const report = await downloadReport(page, REPEATS_RUN);
  // The run lines (R218): 35,410 input tokens, 15,360 of them cached, 1,325
  // output tokens and 17 calls over both agents; $0.004954 over 2 questions.
  expect(report).toMatch(/^Repeats: 3$/m);
  expect(report).toMatch(/^Dev: 1\/1 passed · 95% interval 21–100%$/m);
  expect(report).toMatch(/^Held-out: 0\/1 passed · 95% interval 0–79%$/m);
  expect(report).toMatch(/^Flaky: 1$/m);
  expect(report).toMatch(
    /^Tokens: 35,410 in \(15,360 cached\) · 1,325 out \(0 reasoning\) · 17 calls$/m,
  );
  expect(report).toMatch(/^Cost: \$0\.0050 · \$0\.0025 per question$/m);

  // The summary table, with the split and, with Repeats 3, the passed
  // attempts after each result.
  expect(report).toContain('| # | Question | Split | Result | Duration |');
  expect(report).toContain(
    '| 1 | Who won the 2022 World Cup? | dev | ✅ 3/3 | 1.3s |',
  );
  expect(report).toContain(
    '| 2 | Which team turned the highest share of its shots into goals at the 2022 World Cup? | held-out | ❌ 2/3 | 2.1s |',
  );

  // The flaky question's section: its split, attempts, tokens and cost.
  const flaky = report.slice(report.indexOf('### 2. Which team turned'));
  expect(flaky).toContain('- **Split:** held-out');
  expect(flaky).toContain('- **Attempts:** 2 of 3 passed, flaky');
  expect(flaky).toContain(
    '- **Tokens:** 21,000 in (8,192 cached) · 875 out (0 reasoning) · 11 calls',
  );
  expect(flaky).toContain('- **Cost:** $0.0031');

  // The comparison notes the other repeats, read from the earlier run.
  const compared = report.slice(report.indexOf('## Compared to previous run'));
  expect(compared).toContain(`_Compared to run \`${SEEDED_RUN}\`._`);
  expect(compared).toContain('Note: the previous run used Repeats 1.');
  expect(compared).toContain('No change from the previous run.');
});

test('shows a run saved before repeats and costs with its splits and nothing it did not record', async ({
  page,
  appDataDir,
}) => {
  seedBeforeRepeatsRun(appDataDir);

  await openAssistantExecutions(page);

  // No repeats, flaky count or cost: the run recorded none (R216).
  const card = page.getByTestId(`eval-run-${BEFORE_REPEATS_RUN}`);
  await expect(card).toContainText('1/2 passed');
  await expect(
    page.getByTestId(`eval-run-repeats-${BEFORE_REPEATS_RUN}`),
  ).toHaveCount(0);
  await expect(
    page.getByTestId(`eval-run-flaky-${BEFORE_REPEATS_RUN}`),
  ).toHaveCount(0);
  await expect(
    page.getByTestId(`eval-run-cost-${BEFORE_REPEATS_RUN}`),
  ).toHaveCount(0);

  // Expanded: each split read from the question bank (R215), with the
  // held-out chip on the held-out question's row, and no attempts with
  // Repeats 1 (R216).
  await card.getByRole('button', { name: /passed/ }).click();
  await expect(
    page.getByTestId(`eval-run-splits-${BEFORE_REPEATS_RUN}`),
  ).toHaveText('Dev 1/1 (21–100%) · Held-out 0/1 (0–79%)');
  const row = page.getByTestId(
    `eval-run-result-${BEFORE_REPEATS_RUN}-shot-conversion-2022`,
  );
  await expect(
    row.getByTestId(
      `eval-run-result-split-${BEFORE_REPEATS_RUN}-shot-conversion-2022`,
    ),
  ).toHaveText('held-out');
  await expect(row).not.toContainText('/');
  await expect(
    page.getByTestId(
      `eval-run-result-split-${BEFORE_REPEATS_RUN}-champion-2022`,
    ),
  ).toHaveCount(0);

  // The Details panel shows its split and none of the rest (R217).
  await row.click();
  const panel = page.getByLabel('Details panel');
  await expect(panel).toContainText(
    'Which team turned the highest share of its shots into goals at the 2022 World Cup?',
  );
  await expect(panel.getByTestId('eval-trace-split')).toContainText('Held-out');
  await expect(panel.getByTestId('eval-trace-attempts')).toHaveCount(0);
  await expect(
    panel.locator('[data-testid^="eval-trace-tokens-"]'),
  ).toHaveCount(0);
  await expect(panel.getByTestId('eval-trace-cost')).toHaveCount(0);

  // The report reads it as Repeats 1, with no tokens or cost recorded and
  // no flaky question (R218, R221).
  const report = await downloadReport(page, BEFORE_REPEATS_RUN);
  expect(report).toMatch(/^Repeats: 1$/m);
  expect(report).toMatch(/^Tokens: not recorded$/m);
  expect(report).toMatch(/^Cost: not recorded$/m);
  expect(report).not.toMatch(/^Flaky:/m);
  expect(report).toContain(
    '| 2 | Which team turned the highest share of its shots into goals at the 2022 World Cup? | held-out | ❌ | 1.2s |',
  );
  const question = report.slice(report.indexOf('### 2. Which team turned'));
  expect(question).toContain('- **Split:** held-out');
  expect(question).toContain('- **Tokens:** not recorded');
  expect(question).toContain('- **Cost:** not recorded');
  expect(report).not.toContain('**Attempts:**');
});

test('refuses repeats other than 1, 3 or 5 from the API', async ({ page }) => {
  // Every earlier check of the start passes (R19 steps 1 to 8), so the
  // repeats are the reason for each refusal (step 9).
  await createWorldCupDatasource(page);
  await createWorldCupDataset(page, WORLD_CUP_EVAL_TABLES);
  const { datasources } = await apiJson<{
    datasources: { id: string; name: string }[];
  }>(page, 'GET', '/datasources');
  const datasource = datasources.find(
    (each) => each.name === WORLD_CUP_DATASOURCE,
  );
  expect(datasource).toBeDefined();

  // The value as sent: a string as written, anything else JSON-encoded
  // (R209).
  for (const [repeats, written] of [
    [2, '2'],
    ['3', '3'],
    [true, 'true'],
  ] as const) {
    const refused = await apiJson<{ ok: boolean; message: string }>(
      page,
      'POST',
      '/agents/assistant/evals/run',
      {
        datasourceId: datasource?.id,
        caseIds: ['champion-2022'],
        judge: 'off',
        repeats,
      },
    );
    expect(refused).toEqual({
      ok: false,
      message: `Repeats must be 1, 3 or 5 (got "${written}")`,
    });
  }

  // No run was recorded.
  const { runs } = await apiJson<{ runs: unknown[] }>(
    page,
    'GET',
    '/agents/assistant/evals/runs',
  );
  expect(runs).toEqual([]);
  await openAssistantExecutions(page);
  await expect(page.getByText(/No eval runs yet/)).toBeVisible();
});
