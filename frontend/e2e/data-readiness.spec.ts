import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { apiJson } from './helpers/api';
import { saveLenaiSettings } from './helpers/agents-api';
import { WORLD_CUP_DATASOURCE } from './helpers/app-actions';

/** Saves an evidence screenshot when E2E_EVIDENCE_DIR names a folder. */
async function evidence(page: Page, folder: string, name: string) {
  const root = process.env['E2E_EVIDENCE_DIR'];
  if (!root) return;
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
}
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';
import {
  WORLD_CUP_DB,
  worldCupKey,
  worldCupScalar,
} from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Data readiness" in
 * specs/capabilities/data-readiness/spec.md. The model is the recording
 * OpenAI-compatible stub, scripted to call the Data Readiness Agent's tools;
 * the tools run for real: the deterministic engine profiles the seeded World
 * Cup PostgreSQL (docker compose, port 55432, or E2E_WORLD_CUP_DB_*). Every
 * number the UI shows is checked against the stored report the API returns,
 * never against a hard-coded value, since the scores depend on the data.
 *
 * UI details this spec relies on (ui.md is silent on them). Drafted before
 * units 7-11 were wired (BA-251 unit 14); every one was confirmed against the
 * integrated app at the acceptance gate, where all five scenarios pass:
 *  1. The datasets API accepts a dataset whose entity snapshots carry no
 *     columns (`columns: []`); the assessment profiles the datasource itself,
 *     so the snapshot's columns are not needed.
 *  2. A dimension row's text reads, in DOM order, the label (the dimension
 *     name capitalised: "Completeness" … "Currency"), the score, then
 *     `<n> findings · <m> checks` (matched as `findings?`/`checks?` in case the
 *     UI singularises). Accuracy and currency read `Not assessed` in place of
 *     the score.
 *  3. The Dimension filter's options are labelled with the capitalised
 *     dimension name ("Completeness"); the Severity filter's options read
 *     `All`, `High`, `Medium`, `Low`, `Info` (ui.md 4.13.5).
 *  4. A finding row (`readiness-finding`) shows the severity pill and the
 *     dimension as text, capitalised ("High", "Completeness"); matched
 *     case-insensitively.
 *  5. The maturity pill (`readiness-maturity`) reads exactly the band
 *     (`Managed`), and `readiness-overall` holds the score with `/100` beside
 *     it, so its text starts with the score.
 *  6. The Past assessments menu has `role="menu"` and each report is a
 *     `role="menuitem"` (or `menuitemradio`) showing `<score>/100` and the
 *     band; the selected one carries `aria-checked="true"` or
 *     `aria-current="true"`.
 *  7. Choosing a past report fetches it with
 *     `GET /data-readiness/assessments/<id>` (ui.md 4.13.5: "It fetches the
 *     report when the item opens"), so the spec waits on that response.
 *  8. The World Cup sample yields findings in at least two dimensions, so the
 *     filter scenario has something to narrow (asserted as a precondition).
 *  9. The engine raises no `info` findings (R12-R19 have none), so
 *     Severity = `Info` is a combination that always matches nothing; the
 *     spec still derives the empty combination from the report.
 * 10. The session ID button (`session-id`, `Copy session ID <id>`) is in the
 *     header of an agent-bound session, as in an assistant session.
 * 11. Block D1 names the kind `PostgreSQL` and counts the dataset's tables
 *     as `<n> entities` (agents.md 4.1).
 */

const AGENT = 'Data Readiness Agent';
const AGENT_KEY = 'data-readiness';
const SESSION = 'Data Readiness';
const DATASET = 'World Cup';
const REQUIREMENT = 'Add a PostgreSQL or Databricks dataset first';
const DESCRIPTION =
  'Assesses how ready a PostgreSQL or Databricks dataset is for analysis, scoring it on the DMBOK data-quality dimensions with a deterministic engine and explaining the findings.';
const STARTERS = [
  'Assess the readiness of this dataset',
  'What are the worst data-quality problems?',
  'Show my past assessments',
];
const READINESS_TOOLS = [
  'assess_data_readiness',
  'get_readiness_report',
  'list_readiness_reports',
];
/** The shared dataset tools the agent drills down with (R3, ADR-0035). */
const DRILLDOWN_TOOLS = ['describe_entity', 'run_readonly_sql'];
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
const ASSESS_QUESTION = STARTERS[0];
const ASSESS_ANSWER =
  'The World Cup dataset has been assessed: the scorecard is in the panel.';
/** An assessment profiles twelve tables; allow it time on a cold database. */
const TURN_TIMEOUT = 90_000;

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
  notProfiled?: {
    entity: string;
    reason: 'too-large' | 'timed-out';
    rowCount?: number;
  }[];
}

/** The `data:` frames of an SSE body, parsed in order. */
function sseFrames(body: string): { type: string; content?: string }[] {
  return body
    .split(/\r?\n\r?\n/)
    .map((block) => block.replace(/^data: ?/, '').trim())
    .filter((json) => json.startsWith('{'))
    .map((json) => JSON.parse(json) as { type: string; content?: string });
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

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The last user message of a request: which turn it belongs to. */
function lastUserText(request: StubRequest): string {
  const users = request.messages.filter((m) => m.role === 'user');
  return users.length ? messageText(users[users.length - 1]) : '';
}

/** Tool results since the last user message: the step of the turn. */
function turnToolResults(request: StubRequest): string[] {
  let last = -1;
  request.messages.forEach((m, i) => {
    if (m.role === 'user') last = i;
  });
  return request.messages
    .slice(last + 1)
    .filter((m) => m.role === 'tool')
    .map(messageText);
}

/**
 * Scripts the stub per turn: the reply is the script of the turn (found by
 * its last user message, never by any user message in the history) at the
 * index of the step; past the end it answers the script's last entry.
 */
function script(
  turns: Record<string, StubReply[]>,
): (r: StubRequest) => StubReply {
  return (request) => {
    const steps = turns[lastUserText(request)];
    if (!steps) return { text: 'Noted.' };
    const step = turnToolResults(request).length;
    return steps[Math.min(step, steps.length - 1)];
  };
}

/** The streamed requests of the turn that asked `question`, oldest first. */
function requestsOf(question: string): StubRequest[] {
  return stub.requests.filter((r) => r.stream && lastUserText(r) === question);
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

async function openHub(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}

function startChatButton(page: Page): Locator {
  return page.getByRole('button', { name: `Start chat with ${AGENT}` });
}

/** Starts a chat from the hub card and waits for its session's welcome. */
async function startReadinessChat(page: Page): Promise<void> {
  await openHub(page);
  await expect(startChatButton(page)).toBeEnabled();
  await startChatButton(page).click();
  await expect(page.getByText(`Session "${SESSION}" created`)).toBeVisible();
  await expect(page.getByTestId('session-welcome')).toBeVisible();
}

/** The current session's id, read from the header's session ID button. */
async function sessionId(page: Page): Promise<string> {
  const label = await page
    .locator('header')
    .getByTestId('session-id')
    .getAttribute('aria-label');
  const id = /^Copy session ID (.+)$/.exec(label ?? '')?.[1];
  if (!id) throw new Error('The session did not expose its id');
  return id;
}

/** Sends `question` and waits for `answer` and the composer to be free. */
async function send(
  page: Page,
  question: string,
  answer: string,
): Promise<void> {
  await page.getByPlaceholder('Ask a follow-up question…').fill(question);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(answer)).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeVisible();
}

/** Scripts the assessment turn: one `assess_data_readiness`, then the answer. */
function scriptAssessment(): void {
  stub.reply = script({
    [ASSESS_QUESTION]: [
      {
        toolCall: {
          name: 'assess_data_readiness',
          arguments: { dataset: DATASET },
        },
      },
      { text: ASSESS_ANSWER },
    ],
  });
}

/** Starts a chat and runs one assessment from it; returns the stored report. */
async function assessFromChat(
  page: Page,
  datasourceId: string,
): Promise<ReadinessReport> {
  scriptAssessment();
  await startReadinessChat(page);
  await send(page, ASSESS_QUESTION, ASSESS_ANSWER);
  await expect(scorecard(page)).toBeVisible();
  const [newest] = await listReports(page, datasourceId);
  expect(newest, 'the chat stored a report').toBeTruthy();
  return getReport(page, newest.id);
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

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

test('start chat is blocked without a PostgreSQL or Databricks dataset', async ({
  page,
}) => {
  // Given no dataset is bound to a PostgreSQL or Databricks datasource.
  await openHub(page);
  const official = page.getByTestId('agent-section-official');
  const card = official.getByTestId(`agent-card-${AGENT_KEY}`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId(`agent-${AGENT_KEY}`)).toContainText(AGENT);
  await expect(card).toContainText('Owner: Official');
  await expect(card).toContainText(DESCRIPTION.slice(0, 60));

  const button = startChatButton(page);
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute(
    'data-testid',
    `agent-start-chat-${AGENT_KEY}`,
  );
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', REQUIREMENT);
  expect(stub.requests, 'nothing reached the model').toHaveLength(0);
});

test('assessing a dataset from the chat shows the scorecard', async ({
  page,
}, testInfo) => {
  const datasourceId = await seedWorldCup(page);
  scriptAssessment();

  // When I click "Start chat with Data Readiness Agent".
  await startReadinessChat(page);
  await expect(page.getByTestId('session-agent')).toHaveText(AGENT);
  await expect(
    page.getByRole('heading', { name: SESSION, exact: true }),
  ).toBeVisible();
  const welcome = page.getByTestId('session-welcome');
  await expect(welcome).toContainText(DESCRIPTION);
  for (const starter of STARTERS) {
    await expect(
      welcome.getByRole('button', { name: starter, exact: true }),
    ).toBeVisible();
  }
  // R15 of rfp, shared by Data Readiness sessions: no assistant-only toggles.
  await expect(page.getByRole('button', { name: 'Careful mode' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('button', { name: 'Deep analysis' })).toHaveCount(
    0,
  );
  expect(stub.requests, 'no message has been sent').toHaveLength(0);
  const session = await sessionId(page);

  // When I ask "Assess the readiness of this dataset" (the starter fills the composer).
  await welcome
    .getByRole('button', { name: ASSESS_QUESTION, exact: true })
    .click();
  await expect(page.getByPlaceholder('Ask a follow-up question…')).toHaveValue(
    ASSESS_QUESTION,
  );
  const streamed = page.waitForResponse((r) =>
    r.url().endsWith('/messages/stream'),
  );
  await page.getByRole('button', { name: 'Send message' }).click();

  // And the agent calls "assess_data_readiness": the step shows in the chat.
  await expect(
    page.getByText('assess_data_readiness', { exact: true }).first(),
  ).toBeVisible({ timeout: TURN_TIMEOUT });
  await expect(page.getByText(ASSESS_ANSWER)).toBeVisible({
    timeout: TURN_TIMEOUT,
  });

  // R32: the stream carries `tool-progress` frames between the tool call and
  // its result, in phase order, profiling counting done 1..N of N.
  const frames = sseFrames((await (await streamed).body()).toString('utf8'));
  const toolAt = frames.findIndex(
    (f) =>
      f.type === 'tool' &&
      (JSON.parse(f.content ?? '{}') as { name?: string }).name ===
        'assess_data_readiness',
  );
  const resultAt = frames.findIndex((f) => f.type === 'tool-result');
  expect(toolAt, 'the tool frame').toBeGreaterThanOrEqual(0);
  expect(resultAt, 'the tool-result frame').toBeGreaterThan(toolAt);
  const progress = frames
    .slice(toolAt + 1, resultAt)
    .filter((f) => f.type === 'tool-progress')
    .map(
      (f) =>
        JSON.parse(f.content ?? '{}') as {
          tool: string;
          phase: string;
          message: string;
          done?: number;
          total?: number;
        },
    );
  expect(
    progress.length,
    'progress frames between tool and result',
  ).toBeGreaterThan(0);
  for (const frame of progress) {
    expect(frame.tool).toBe('assess_data_readiness');
  }
  const phases = [...new Set(progress.map((f) => f.phase))];
  expect(phases).toEqual([
    'inventory',
    'profiling',
    'relationships',
    'scoring',
    'storing',
  ]);
  const profiling = progress.filter((f) => f.phase === 'profiling');
  expect(profiling.every((f) => f.total === WORLD_CUP_TABLES.length)).toBe(
    true,
  );
  const doneCounts = profiling
    .map((f) => f.done)
    .filter((d): d is number => d !== undefined);
  expect(Math.max(...doneCounts)).toBe(WORLD_CUP_TABLES.length);
  expect(doneCounts).toEqual([...doneCounts].sort((a, b) => a - b));
  expect(
    profiling.some((f) => /^Profiling .+ \(\d+\/\d+\)…$/.test(f.message)),
  ).toBe(true);
  // The UI part (the running row's `tool-progress`) is not asserted: the
  // World Cup run lasts about 0.3 s and the fixture has no stream throttle.

  // The turn ran the Data Readiness Agent, not the assistant (R2, R3, Block D1).
  const requests = requestsOf(ASSESS_QUESTION);
  expect(requests.length).toBeGreaterThanOrEqual(2);
  const first = requests[0];
  // The drill-down tools are offered besides the readiness tools (R3,
  // ADR-0035); no other dataset-browsing, visual or workspace tool is.
  expect(first.tools).toEqual(
    expect.arrayContaining([
      ...READINESS_TOOLS,
      ...DRILLDOWN_TOOLS,
      'show_in_panel',
      'ask_clarification',
    ]),
  );
  for (const forbidden of [
    'list_entities',
    'sample_rows',
    'update_workflow',
    'create_visual',
    'mastra_workspace_write_file',
  ]) {
    expect(first.tools).not.toContain(forbidden);
  }
  expect(
    systemTexts(first)[0].startsWith('You are the Data Readiness Agent'),
  ).toBe(true);
  const system = systemTexts(first).join('\n');
  expect(system).toContain('Datasets for this session (data readiness):');
  // Each dataset line carries the datasource id and an example entity key
  // for the drill-down tools (ADR-0035, agents.md 4.1).
  expect(system).toContain(
    `- ${DATASET} — PostgreSQL datasource "${WORLD_CUP_DATASOURCE}" (datasourceId ${datasourceId}), ${WORLD_CUP_TABLES.length} entities, named like ${worldCupKey(WORLD_CUP_TABLES[0])}`,
  );
  expect(system).toContain(
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
  );

  // The stored report: from this session, over the World Cup datasource (R24).
  const reports = await listReports(page, datasourceId);
  expect(reports).toHaveLength(1);
  const report = await getReport(page, reports[0].id);
  expect(report.datasourceName).toBe(WORLD_CUP_DATASOURCE);
  expect(report.datasourceKind).toBe('postgres');
  expect(report.sessionId).toBe(session);
  expect(report.entityCount).toBe(WORLD_CUP_TABLES.length);

  // The model saw the compact summary only (R5): the report id, no full list.
  const toolResult = turnToolResults(requests[1])[0];
  expect(toolResult).toContain(report.id);
  expect(toolResult).toContain('topFindings');
  // The full list is never sent: no `findings` key, only `topFindings`.
  expect(toolResult).not.toMatch(/findings\\*"\s*:/);

  // Then the right panel shows the scorecard for the World Cup datasource,
  // with an overall score out of 100, a band and ten dimension bars.
  await expect(scorecard(page)).toBeVisible();
  await expectScorecardShows(page, report);
  for (const dimension of UNASSESSED) {
    await expect(dimensionRow(page, dimension as Dimension)).toContainText(
      'Not assessed',
    );
  }

  // And the answer carries a readiness card with "Open scorecard" (R25).
  const readinessCard = page.getByTestId('readiness-card');
  await expect(readinessCard).toHaveCount(1);
  await expect(readinessCard).toContainText(WORLD_CUP_DATASOURCE);
  await expect(readinessCard.getByTestId('readiness-card-score')).toContainText(
    `${report.overallScore}/100 · ${report.maturity}`,
  );
  const open = readinessCard.getByTestId('readiness-open-scorecard');
  await expect(open).toHaveText(/Open scorecard/);
  await open.click();
  await expect(scorecard(page)).toBeVisible();
  await expectScorecardShows(page, report);

  await page.screenshot({
    path: testInfo.outputPath('data-readiness-scorecard.png'),
  });
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
  await saveLenaiSettings(page, stub.baseUrl);
  const datasourceId = await seedWorldCup(page);

  // When I assess the dataset from the chat.
  const report = await assessFromChat(page, datasourceId);

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

test('the scorecard shows the same numbers as the API', async ({ page }) => {
  // Given an assessment of the World Cup datasource was run from the chat.
  const datasourceId = await seedWorldCup(page);
  await assessFromChat(page, datasourceId);
  const [newest] = await listReports(page, datasourceId);

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

test('past assessments lists and reopens earlier reports', async ({ page }) => {
  // Given two assessments of the World Cup datasource were run: an earlier
  // one through the API, then one from the chat.
  const datasourceId = await seedWorldCup(page);
  const older = await assessThroughApi(page, datasourceId);
  const newer = await assessFromChat(page, datasourceId);
  expect(newer.id).not.toBe(older.id);
  const listed = await listReports(page, datasourceId);
  expect(listed.map((r) => r.id)).toEqual([newer.id, older.id]);

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

test('filtering findings by dimension and severity', async ({ page }) => {
  // Given the scorecard shows a report with findings in several dimensions.
  const datasourceId = await seedWorldCup(page);
  const report = await assessFromChat(page, datasourceId);
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

test('the agent shows the records behind a finding', async ({ page }) => {
  // The Gherkin's Formula 1 `driver.second_nationality_country_id` stands in
  // here as the World Cup `goals.assist_player_id`, null for unassisted goals:
  // the suite's database is the World Cup sample.
  const datasourceId = await seedWorldCup(page);
  const before = await assessThroughApi(page, datasourceId);
  const nulls = Number(
    await worldCupScalar(
      'select count(*) from world_cup.goals where assist_player_id is null',
    ),
  );
  expect(nulls, 'the sample has unassisted goals').toBeGreaterThan(0);
  const shown = Math.min(nulls, 20);
  const goals = worldCupKey('goals');
  const question =
    'what are the records with assist_player_id null values in goals';
  const sql = `SELECT id, scorer_player_id, assist_player_id FROM ${goals} WHERE assist_player_id IS NULL ORDER BY id LIMIT 20`;

  // The model drills down: describe_entity, run_readonly_sql, then answers
  // with the count first and a table built from the rows the query returned.
  stub.reply = (request) => {
    if (lastUserText(request) !== question) return { text: 'Noted.' };
    const results = turnToolResults(request);
    if (results.length === 0) {
      return {
        toolCall: {
          name: 'describe_entity',
          arguments: { entity: goals, datasourceId },
        },
      };
    }
    if (results.length === 1) {
      return {
        toolCall: {
          name: 'run_readonly_sql',
          arguments: {
            sql,
            datasourceId,
            rationale: 'List the goals with no assist.',
          },
        },
      };
    }
    const { rows = [] } = JSON.parse(results[1]) as {
      rows?: Record<string, unknown>[];
    };
    const table = [
      '| id | scorer_player_id |',
      '| --- | --- |',
      ...rows.map((row) => `| ${String(row['id'])} | ${String(row['scorer_player_id'])} |`),
    ].join('\n');
    return {
      text: `There are ${rows.length} goals with a null assist_player_id.\n\n${table}`,
    };
  };

  await startReadinessChat(page);
  await send(
    page,
    question,
    `There are ${shown} goals with a null assist_player_id.`,
  );

  // The agent ran one read-only IS NULL query on goals, which returned rows.
  const requests = requestsOf(question);
  expect(requests[0].tools).toEqual(expect.arrayContaining(DRILLDOWN_TOOLS));
  const last = requests[requests.length - 1];
  const sqlResult = JSON.parse(turnToolResults(last)[1]) as {
    rows?: Record<string, unknown>[];
    error?: string;
  };
  expect(sqlResult.error).toBeUndefined();
  expect(sqlResult.rows).toHaveLength(shown);
  expect(sqlResult.rows!.every((row) => row['assist_player_id'] === null)).toBe(
    true,
  );

  // The answer leads with the count and shows the rows in a table.
  const answer = page.locator('table').last();
  await expect(answer.locator('tbody tr')).toHaveCount(shown);
  await expect(answer.locator('tbody tr').first()).toContainText(
    String(sqlResult.rows![0]['id']),
  );
  await page.getByText('Data used (1 query)').click();
  await expect(page.getByText(`run_readonly_sql — ${shown} rows`)).toBeVisible();
  await expect(page.getByText('WHERE assist_player_id IS NULL')).toBeVisible();

  // No score changes: the stored report is the same one, unchanged.
  const reports = await listReports(page, datasourceId);
  expect(reports).toHaveLength(1);
  const after = await getReport(page, before.id);
  expect(after.overallScore).toBe(before.overallScore);
  expect(after.dimensionScores).toEqual(before.dimensionScores);
});
