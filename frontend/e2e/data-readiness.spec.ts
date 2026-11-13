import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { apiJson } from './helpers/api';
import { saveLenaiSettings } from './helpers/agents-api';
import { WORLD_CUP_DATASOURCE, openSessions } from './helpers/app-actions';
import { LlmStub, startLlmStub } from './helpers/llm-stub';
import { seedPastChat } from './helpers/past-chats';
import { railItem } from './helpers/run-ui';
import { WORLD_CUP_DB, worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Data readiness" in
 * specs/capabilities/data-readiness/spec.md. Since workflows are v2 only the
 * Data Readiness Agent is a library agent with no workflow: nothing in the UI
 * runs it, so no new readiness report is produced from the UI. Its page
 * (prompt, Used in) is covered by `agent-hub.spec.ts`.
 *
 * Stored reports stay viewable: the scorecard scenarios make a report with
 * `POST /data-readiness/assessments` (api.md 108; the deterministic engine
 * profiles the seeded World Cup PostgreSQL, docker compose, port 55432, or
 * E2E_WORLD_CUP_DB_*), seed a past Data Readiness chat whose answer carries
 * the report's readiness card, and open its scorecard in the session panel.
 * Every number the UI shows is checked against the stored report the API
 * returns, never against a hard-coded value, since the scores depend on the
 * data.
 *
 * UI details this spec relies on (ui.md is silent on them):
 *  1. The datasets API accepts a dataset whose entity snapshots carry no
 *     columns (`columns: []`); the assessment profiles the datasource itself.
 *  2. A dimension row's text reads, in DOM order, the label (the dimension
 *     name capitalised), the score, then `<n> findings · <m> checks`.
 *     Accuracy and currency read `Not assessed` in place of the score.
 *  3. The Dimension filter's options are labelled with the capitalised
 *     dimension name; the Severity filter's read `All`, `High`, `Medium`,
 *     `Low`, `Info` (ui.md 4.13.5).
 *  4. A finding row (`readiness-finding`) shows the severity and the
 *     dimension as text, capitalised; matched case-insensitively.
 *  5. The maturity pill (`readiness-maturity`) reads exactly the band, and
 *     `readiness-overall` holds the score with `/100` beside it.
 *  6. The Past assessments menu has `role="menu"` and each report is a
 *     `role="menuitem"` (or `menuitemradio`) showing `<score>/100` and the
 *     band; the selected one carries `aria-checked` or `aria-current`.
 *  7. Choosing a past report fetches it with
 *     `GET /data-readiness/assessments/<id>` (ui.md 4.13.5).
 *  8. The World Cup sample yields findings in at least two dimensions.
 *  9. The engine raises no `info` findings, so Severity = `Info` always
 *     matches nothing; the spec still derives the empty combination from the
 *     report.
 */

const AGENT = 'Data Readiness Agent';
const AGENT_KEY = 'data-readiness';
const SESSION = 'Data Readiness';
const DATASET = 'World Cup';
const DESCRIPTION =
  'Assesses how ready a PostgreSQL or Databricks dataset is for analysis, scoring it on the DMBOK data-quality dimensions with a deterministic engine and explaining the findings.';
const ASSESS_QUESTION = 'Assess the readiness of this dataset';
const ASSESS_ANSWER =
  'The World Cup dataset has been assessed: the scorecard is in the panel.';
/** Every table of the seeded `world_cup` schema (docker/postgres/init). */
const WORLD_CUP_TABLES = [
  'confederations',
  'countries',
  'teams',
  'tournaments',
  'tournament_teams',
  'venues',
  'players',
  'squad_members',
  'matches',
  'match_team_statistics',
  'goals',
  'disciplinary_events',
];
/** Scorecard order (R25, ui.md 4.13.5). */
const DIMENSIONS = [
  'completeness',
  'validity',
  'consistency',
  'uniqueness',
  'integrity',
  'accessibility',
  'timeliness',
  'reasonability',
  'accuracy',
  'currency',
] as const;
const UNASSESSED = ['accuracy', 'currency'];
const SEVERITIES = ['high', 'medium', 'low', 'info'] as const;

type Dimension = (typeof DIMENSIONS)[number];
type Severity = (typeof SEVERITIES)[number];

interface DimensionScore {
  dimension: Dimension;
  score: number;
  findingCount: number;
  maxSeverity: Severity | null;
  assessed: boolean;
  totalChecks: number;
}

interface ReadinessReport {
  id: string;
  datasourceId: string;
  datasourceName: string;
  datasourceKind: 'postgres' | 'databricks';
  generatedAt: string;
  entityCount: number;
  overallScore: number;
  maturity: string;
  dimensionScores: DimensionScore[];
  findings: { dimension: Dimension; severity: Severity }[];
  sessionId?: string;
  runId?: string;
  notProfiled?: {
    entity: string;
    reason: 'too-large' | 'timed-out';
    rowCount?: number;
  }[];
}

interface ReadinessReportSummary {
  id: string;
  generatedAt: string;
  overallScore: number;
  maturity: string;
}

let stub: LlmStub;
let cappedDir: string | undefined;

// ------------------------------------------------------------ helpers

/** Saves an evidence screenshot when E2E_EVIDENCE_DIR names a folder. */
async function evidence(page: Page, folder: string, name: string) {
  const root = process.env['E2E_EVIDENCE_DIR'];
  if (!root) return;
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Background: the World Cup sample datasource and a dataset "World Cup" over
 * every table of its `world_cup` schema. Returns the datasource id.
 */
async function seedWorldCup(page: Page): Promise<string> {
  const { datasource } = await apiJson<{
    ok: boolean;
    datasource: { id: string };
  }>(page, 'POST', '/datasources', {
    kind: 'postgres',
    name: WORLD_CUP_DATASOURCE,
    config: { ...WORLD_CUP_DB, ssl: false },
  });
  const keys = WORLD_CUP_TABLES.map(worldCupKey);
  const saved = await apiJson<{ ok: boolean; message: string }>(
    page,
    'POST',
    '/datasets',
    {
      name: DATASET,
      tables: keys,
      entities: keys.map((key) => ({ key, columns: [] })),
      datasourceId: datasource.id,
      datasourceKind: 'postgres',
    },
  );
  expect(saved.ok, saved.message).toBe(true);
  return datasource.id;
}

async function listReports(
  page: Page,
  datasourceId: string,
): Promise<ReadinessReportSummary[]> {
  const { reports } = await apiJson<{ reports: ReadinessReportSummary[] }>(
    page,
    'GET',
    `/data-readiness/assessments?datasourceId=${encodeURIComponent(datasourceId)}`,
  );
  return reports;
}

async function getReport(page: Page, id: string): Promise<ReadinessReport> {
  return apiJson<ReadinessReport>(
    page,
    'GET',
    `/data-readiness/assessments/${encodeURIComponent(id)}`,
  );
}

/** Runs an assessment straight through the API (api.md 108). */
async function assessThroughApi(
  page: Page,
  datasourceId: string,
): Promise<ReadinessReport> {
  return apiJson<ReadinessReport>(page, 'POST', '/data-readiness/assessments', {
    datasourceId,
    entities: WORLD_CUP_TABLES.map(worldCupKey),
  });
}

/**
 * Seeds a past Data Readiness chat whose answer carries `report`'s readiness
 * card, opens it from Runs → Past chats, checks the card and clicks
 * "Open scorecard": the session panel shows the report's scorecard.
 */
async function openScorecardFromPastChat(
  page: Page,
  appDataDir: string,
  report: ReadinessReport,
): Promise<void> {
  seedPastChat(appDataDir, {
    name: SESSION,
    datasets: [DATASET],
    agentKey: AGENT_KEY,
    agentName: AGENT,
    turns: [
      {
        question: ASSESS_QUESTION,
        answer: ASSESS_ANSWER,
        readinessReport: {
          reportId: report.id,
          datasourceName: report.datasourceName,
          overallScore: report.overallScore,
          maturity: report.maturity,
          generatedAt: report.generatedAt,
        },
      },
    ],
  });
  await page.reload();
  await openSessions(page);
  await page
    .getByRole('navigation', { name: 'Past chats', exact: true })
    .getByRole('button', { name: new RegExp(`^${SESSION}`) })
    .click();
  await expect(page.getByTestId('past-chat-banner')).toBeVisible();
  const card = page.getByTestId('readiness-card');
  await expect(card).toContainText(report.datasourceName);
  await expect(card.getByTestId('readiness-card-score')).toContainText(
    `${report.overallScore}/100 · ${report.maturity}`,
  );
  await card.getByTestId('readiness-open-scorecard').click();
  await expect(scorecard(page)).toBeVisible();
}

function scorecard(page: Page): Locator {
  return page.getByTestId('readiness-scorecard');
}

function dimensionRow(page: Page, dimension: Dimension): Locator {
  return scorecard(page).getByTestId(`readiness-dimension-${dimension}`);
}

function findingRows(page: Page): Locator {
  return scorecard(page).getByTestId('readiness-finding');
}

/** Asserts the scorecard shows `report`'s overall score, band and ten rows. */
async function expectScorecardShows(
  page: Page,
  report: ReadinessReport,
): Promise<void> {
  const card = scorecard(page);
  await expect(card).toContainText(report.datasourceName);
  await expect(card.getByTestId('readiness-overall')).toHaveText(
    new RegExp(`^\\s*${report.overallScore}\\b`),
  );
  await expect(card).toContainText(`${report.overallScore}/100`);
  await expect(card.getByTestId('readiness-maturity')).toHaveText(
    report.maturity,
  );
  const rows = card
    .getByTestId('readiness-dimensions')
    .locator('[data-testid^="readiness-dimension-"]');
  await expect(rows).toHaveCount(DIMENSIONS.length);
  const shown = await rows.evaluateAll((elements) =>
    elements.map((e) =>
      (e.getAttribute('data-testid') ?? '').replace('readiness-dimension-', ''),
    ),
  );
  expect(shown, 'dimension rows in scorecard order (R25)').toEqual([
    ...DIMENSIONS,
  ]);
  for (const score of report.dimensionScores) {
    const row = dimensionRow(page, score.dimension);
    const label = capitalise(score.dimension);
    if (!score.assessed) {
      await expect(row).toContainText(label);
      await expect(row).toContainText('Not assessed');
      continue;
    }
    await expect(row).not.toContainText('Not assessed');
    await expect(row).toHaveText(
      new RegExp(
        `${escape(label)}\\s*${score.score}\\s*${score.findingCount} findings?\\s*·\\s*${score.totalChecks} checks?`,
      ),
    );
  }
}

// ------------------------------------------------------------ setup

test.beforeEach(async ({ page }) => {
  // Background: the LLM stub is the provider.
  stub = await startLlmStub();
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
  // The fixture closes its apps after this hook, so the directory may still be
  // held open; a failed removal is left to the OS temp cleaner.
  if (cappedDir)
    try {
      fs.rmSync(cappedDir, { recursive: true, force: true });
    } catch {
      /* still held by the app */
    }
  cappedDir = undefined;
});

// ------------------------------------------------------------ scenarios

test('the Data Readiness Agent is an Official library agent with no workflow', async ({
  page,
}) => {
  // Given I open Agents.
  await railItem(page, 'Agents').click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();

  // Then the Data Readiness Agent is listed under Official.
  const official = page.getByTestId('agent-section-official');
  const card = official.getByTestId(`agent-card-${AGENT_KEY}`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId(`agent-${AGENT_KEY}`)).toContainText(AGENT);
  await expect(card).toContainText('Owner: Official');
  await expect(card).toContainText(DESCRIPTION.slice(0, 60));
  // The agent card never starts a chat, and chats cannot start at all.
  await expect(card.getByRole('button', { name: /Start chat/ })).toHaveCount(0);

  // When I open Workflows, then no workflow runs the agent.
  await railItem(page, 'Workflows').click();
  await expect(
    page.getByRole('heading', { name: 'Workflows', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('workflow-qti-v2-turn')).toBeVisible();
  await expect(page.getByTestId(`workflow-agent:${AGENT_KEY}`)).toHaveCount(0);
  expect(stub.requests, 'nothing reached the model').toHaveLength(0);
});

test('A table too large to profile is listed as not profiled', async ({
  launchApp,
}) => {
  // Given a table has more rows than the cap: the CLI reads the cap per
  // assessment (delivery.md), set to 20 so the larger sample tables (79, 50, 47 and 32 rows) exceed it.
  const cap = 20;
  // Its own data directory: the default `page` app already holds the fixture's.
  cappedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-e2e-capped-'));
  const { page } = await launchApp(cappedDir, {
    READINESS_MAX_PROFILED_ROWS: String(cap),
  });
  const datasourceId = await seedWorldCup(page);

  // When the dataset is assessed and I open its scorecard from a past chat.
  const report = await assessThroughApi(page, datasourceId);
  await openScorecardFromPastChat(page, cappedDir, report);

  // Then the stored report lists those tables as not profiled (R31).
  const listed = report.notProfiled ?? [];
  expect(listed.length, 'some tables exceed the cap').toBeGreaterThan(0);
  for (const entry of listed) {
    expect(entry.reason).toBe('too-large');
    expect(entry.rowCount).toBeGreaterThan(cap);
  }
  expect(report.entityCount).toBe(WORLD_CUP_TABLES.length);

  // And the scorecard shows them with the reason and the row count.
  const section = page.getByTestId('readiness-not-profiled');
  await expect(section).toBeVisible();
  await expect(section).toContainText(`Not profiled (${listed.length})`);
  for (const [index, entry] of listed.entries()) {
    const row = page.getByTestId(`readiness-not-profiled-${index}`);
    await expect(row).toContainText(entry.entity);
    await expect(row).toContainText(
      `Too large — ${entry.rowCount!.toLocaleString('en-US')} rows, column checks skipped`,
    );
  }
  await evidence(page, '1.20.3', 'readiness-not-profiled.png');
});

test('the scorecard shows the same numbers as the API', async ({
  appDataDir,
  page,
}) => {
  // Given an assessment of the World Cup datasource is stored and its
  // scorecard is open from a past chat.
  const datasourceId = await seedWorldCup(page);
  const stored = await assessThroughApi(page, datasourceId);
  await openScorecardFromPastChat(page, appDataDir, stored);
  const [newest] = await listReports(page, datasourceId);
  expect(newest.id).toBe(stored.id);

  // When I request GET /data-readiness/assessments/<report id>.
  const report = await getReport(page, newest.id);
  expect(report.id).toBe(newest.id);

  // Then its overall score, band and dimension scores equal the scorecard's.
  await expectScorecardShows(page, report);

  // And the overall score is the rounded mean of the eight assessed scores.
  expect(report.dimensionScores).toHaveLength(10);
  const assessed = report.dimensionScores.filter((d) => d.assessed);
  expect(assessed.map((d) => d.dimension).sort()).toEqual(
    DIMENSIONS.filter((d) => !UNASSESSED.includes(d)).sort(),
  );
  const mean = assessed.reduce((sum, d) => sum + d.score, 0) / assessed.length;
  expect(report.overallScore).toBe(Math.round(mean));
  for (const d of report.dimensionScores.filter((s) => !s.assessed)) {
    expect(d).toMatchObject({ score: 100, totalChecks: 0 });
  }
});

test('past assessments lists and reopens earlier reports', async ({
  appDataDir,
  page,
}) => {
  // Given two assessments of the World Cup datasource are stored, and the
  // newer one's scorecard is open from a past chat.
  const datasourceId = await seedWorldCup(page);
  const older = await assessThroughApi(page, datasourceId);
  const newer = await assessThroughApi(page, datasourceId);
  expect(newer.id).not.toBe(older.id);
  const listed = await listReports(page, datasourceId);
  expect(listed.map((r) => r.id)).toEqual([newer.id, older.id]);
  await openScorecardFromPastChat(page, appDataDir, newer);

  // The scorecard opens on the newer report.
  await expectScorecardShows(page, newer);

  // When I open "Past assessments" on the scorecard.
  const history = scorecard(page).getByTestId('readiness-history');
  await expect(history).toHaveText(/Past assessments/);
  await history.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const items = menu.getByRole('menuitem').or(menu.getByRole('menuitemradio'));

  // Then I see two reports, newest first, each with its time, score and band.
  await expect(items).toHaveCount(2);
  for (const [index, report] of listed.entries()) {
    await expect(items.nth(index)).toContainText(`${report.overallScore}/100`);
    await expect(items.nth(index)).toContainText(report.maturity);
  }
  const selected = (item: Locator) =>
    item.and(page.locator('[aria-checked="true"], [aria-current="true"]'));
  await expect(selected(items.nth(0)), 'the current report').toHaveCount(1);
  await expect(menu).not.toContainText('No earlier assessments.');

  // When I choose the older report.
  const fetched = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/data-readiness/assessments/${older.id}`),
  );
  await items.nth(1).click();
  expect((await fetched).ok()).toBe(true);

  // Then the scorecard shows the older report.
  await expectScorecardShows(page, older);
  await history.click();
  await expect(
    selected(items.nth(1)),
    'the older report is current',
  ).toHaveCount(1);
  await expect(selected(items.nth(0))).toHaveCount(0);
});

test('filtering findings by dimension and severity', async ({
  appDataDir,
  page,
}) => {
  // Given the scorecard shows a report with findings in several dimensions.
  const datasourceId = await seedWorldCup(page);
  const report = await assessThroughApi(page, datasourceId);
  await openScorecardFromPastChat(page, appDataDir, report);
  const dimensionsWithFindings = new Set(
    report.findings.map((f) => f.dimension),
  );
  expect(
    dimensionsWithFindings.size,
    'the World Cup sample has findings in several dimensions',
  ).toBeGreaterThanOrEqual(2);

  // Both filters start at All, and the table lists every finding.
  const card = scorecard(page);
  const dimensionFilter = card.getByLabel('Dimension', { exact: true });
  const severityFilter = card.getByLabel('Severity', { exact: true });
  await expect(dimensionFilter.locator('option:checked')).toHaveText('All');
  await expect(severityFilter.locator('option:checked')).toHaveText('All');
  await expect(findingRows(page)).toHaveCount(report.findings.length);
  // Dimension offers All plus the eight assessed dimensions (ui.md 4.13.5).
  await expect(dimensionFilter.locator('option')).toHaveText([
    'All',
    ...DIMENSIONS.filter((d) => !UNASSESSED.includes(d)).map(capitalise),
  ]);
  await expect(severityFilter.locator('option')).toHaveText([
    'All',
    'High',
    'Medium',
    'Low',
    'Info',
  ]);

  // Most severe first (R25).
  const rank = { high: 0, medium: 1, low: 2, info: 3 } as const;
  const shownSeverities = (await findingRows(page).allInnerTexts()).map(
    (text) =>
      SEVERITIES.find((s) => new RegExp(`\\b${s}\\b`, 'i').test(text)) ??
      'info',
  );
  expect(shownSeverities).toEqual(
    [...shownSeverities].sort((a, b) => rank[a] - rank[b]),
  );

  // When I set Dimension to Completeness and Severity to High.
  await dimensionFilter.selectOption({ label: 'Completeness' });
  await severityFilter.selectOption({ label: 'High' });

  // Then the findings table shows only high completeness findings.
  const expected = report.findings.filter(
    (f) => f.dimension === 'completeness' && f.severity === 'high',
  ).length;
  await expect(findingRows(page)).toHaveCount(expected);
  if (expected === 0) {
    await expect(card).toContainText('No findings match these filters.');
  } else {
    for (const row of await findingRows(page).all()) {
      await expect(row).toContainText(/high/i);
      await expect(row).toContainText(/completeness/i);
    }
  }

  // When a filter combination matches nothing.
  const assessedDimensions = DIMENSIONS.filter((d) => !UNASSESSED.includes(d));
  let empty: { dimension: Dimension; severity: Severity } | undefined;
  for (const severity of [...SEVERITIES].reverse()) {
    const dimension = assessedDimensions.find(
      (d) =>
        !report.findings.some(
          (f) => f.dimension === d && f.severity === severity,
        ),
    );
    if (dimension) {
      empty = { dimension, severity };
      break;
    }
  }
  expect(empty, 'some combination has no finding').toBeTruthy();
  await dimensionFilter.selectOption({ label: capitalise(empty!.dimension) });
  await severityFilter.selectOption({ label: capitalise(empty!.severity) });

  // Then the table reads "No findings match these filters."
  await expect(findingRows(page)).toHaveCount(0);
  await expect(card).toContainText('No findings match these filters.');

  // Back to All, All: every finding again.
  await dimensionFilter.selectOption({ label: 'All' });
  await severityFilter.selectOption({ label: 'All' });
  await expect(findingRows(page)).toHaveCount(report.findings.length);
});
