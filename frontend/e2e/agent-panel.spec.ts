import fs from 'node:fs';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  createWorldCupSession,
  openSessions,
} from './helpers/app-actions';
import { apiFetch, apiJson } from './helpers/api';
import {
  createUserAgent,
  publishAgent,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
import {
  LlmStub,
  STUB_ANSWER,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
  systemTexts,
  turnRequests,
} from './helpers/llm-stub';
import { worldCupKey, worldCupScalar } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Agent panel" in specs/capabilities/agent-panel/spec.md
 * (roadmap 1.14.18, BA-231). The model is the recording OpenAI-compatible
 * stub: each scenario scripts the tool calls of its turn (`show_in_panel`,
 * `update_workflow`, `run_readonly_sql`) and, where the Gherkin says "while
 * the turn streams", holds the turn's last reply open with `stub.hold`.
 */

const EVIDENCE = path.resolve(__dirname, '../../evidence/1.14.18');

/** Marks the designer's (non-streamed) request: it carries its skill. */
const DESIGNER_SKILL_TAG = '<interactive-visuals-skill>';
const VISUAL_TITLE = 'Goals per team';
const STAGE_SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
const STAGE_RATIONALE = 'Count the matches per stage.';
/** A table's default title: the rationale's first sentence (agents.md 3.11). */
const STAGE_TITLE = 'Count the matches per stage';
/** The designer's spec-mode answer over STAGE_SQL's columns. */
const VISUAL_SPEC = {
  title: VISUAL_TITLE,
  description: 'Matches played at each stage of the tournament.',
  spec: {
    spec: 1,
    chart: { form: 'bar', select: ['stage', 'matches'], x: 'stage', y: 'matches' },
  },
};

const FINDINGS_MD = '# Findings\n\nBrazil scored most.';
const SUMMARY_MD = '# Summary notes\n\nGermany reached the final.';

const WORKFLOW_AGENT = 'Process guide';
/** A user agent whose prompt has a `## Workflow` section (agent-panel R8). */
const WORKFLOW_INSTRUCTIONS = [
  'Guide the user through a short analysis of the World Cup data.',
  '',
  '## Workflow',
  '1. Understand: Tell me what you want to find out.',
  '2. Analyse — [[skill:curated-knowledge]]: Review the queries I run.',
  '3. Report: Review the report and approve it.',
  '',
  '## Style',
  'Answer briefly.',
].join('\n');
const STEPS = ['Understand', 'Analyse', 'Report'];
const FREE_AGENT = 'Free guide';

const ERR_RENAME =
  'Your ## Workflow section defines the steps; set their status instead';

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  // Background: the LLM stub is the provider, World Cup data is loaded.
  stub = await startLlmStub();
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

// ---------------------------------------------------------------- scripting

interface ToolCallScript {
  name: string;
  arguments: Record<string, unknown>;
}

interface TurnScript {
  /** Text the turn's latest user message contains. */
  question: string;
  /** The tool calls the model makes, one per model request, in order. */
  calls: ToolCallScript[];
  /** The text the model answers once the calls are done. */
  answer: string;
}

/** Index of the latest user message of a request. */
function lastUserIndex(request: StubRequest): number {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    if (request.messages[i].role === 'user') return i;
  }
  return -1;
}

/** The latest user message's text and how many tool results follow it. */
function position(request: StubRequest): { question: string; step: number } {
  const index = lastUserIndex(request);
  if (index < 0) return { question: '', step: 0 };
  return {
    question: messageText(request.messages[index]),
    step: request.messages
      .slice(index + 1)
      .filter((message) => message.role === 'tool').length,
  };
}

function turnOf(turns: TurnScript[], request: StubRequest): TurnScript | undefined {
  const { question } = position(request);
  return turns.find((turn) => question.includes(turn.question));
}

/** Whether `request` asks for the final answer of the turn `question`. */
function isFinalRequest(
  turns: TurnScript[],
  request: StubRequest,
  question: string,
): boolean {
  const turn = turnOf(turns, request);
  return (
    request.stream &&
    turn?.question === question &&
    position(request).step >= turn.calls.length
  );
}

/** Scripts every turn by its latest user message (never the whole history). */
function script(turns: TurnScript[]): void {
  stub.reply = (request): StubReply => {
    if (systemTexts(request).some((text) => text.includes(DESIGNER_SKILL_TAG))) {
      return { text: JSON.stringify(VISUAL_SPEC) };
    }
    if (!request.stream) return { text: STUB_ANSWER };
    const turn = turnOf(turns, request);
    if (!turn) return { text: STUB_ANSWER };
    const { step } = position(request);
    if (step < turn.calls.length) {
      const call = turn.calls[step];
      const name =
        request.tools.find((tool) => tool === call.name) ??
        request.tools.find((tool) => tool.endsWith(call.name)) ??
        call.name;
      return { toolCall: { name, arguments: call.arguments } };
    }
    return { text: turn.answer };
  };
}

/** A promise a test resolves by hand. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/** Holds the final answer of `question` until the returned release is called. */
function holdFinalAnswer(turns: TurnScript[], question: string): () => void {
  const held = gate();
  stub.hold = (request) =>
    isFinalRequest(turns, request, question) ? held.promise : undefined;
  return () => {
    held.release();
    stub.hold = undefined;
  };
}

/** The tool results the model received in the last request of a turn. */
function toolResultsOf(question: string): string[] {
  const request = turnRequests(stub, question).at(-1);
  expect(request, `a streamed call for "${question}"`).toBeDefined();
  const index = lastUserIndex(request!);
  return request!.messages
    .slice(index + 1)
    .filter((message) => message.role === 'tool')
    .map(messageText);
}

// ------------------------------------------------------------------ the UI

function composer(page: Page): Locator {
  return page.getByPlaceholder('Ask a follow-up question…');
}

async function send(page: Page, question: string): Promise<void> {
  await composer(page).fill(question);
  await page.getByRole('button', { name: 'Send message' }).click();
}

/** Sends `question` and waits for `answer` and the composer to come back. */
async function ask(page: Page, question: string, answer: string): Promise<void> {
  await send(page, question);
  await expect(page.getByText(answer).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
}

function rightPanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Details panel' });
}

function historyButton(page: Page): Locator {
  return rightPanel(page).locator('button[title="Shown in this session"]');
}

async function historyTitles(page: Page): Promise<string[]> {
  await historyButton(page).click();
  const items = rightPanel(page).locator('.menu-item');
  await expect(items.first()).toBeVisible();
  const titles = (await items.allTextContents()).map((text) => text.trim());
  // Close the menu without choosing anything.
  await page.getByRole('button', { name: 'Close panel menu' }).click();
  return titles;
}

function bar(page: Page): Locator {
  return page.getByTestId('workflow-bar');
}

function step(page: Page, title: string): Locator {
  return bar(page)
    .getByRole('list', { name: 'Workflow' })
    .getByRole('listitem')
    .filter({ hasText: title });
}

function details(page: Page): Locator {
  return page.getByRole('region', { name: 'Workflow details' });
}

function detailsToggle(page: Page): Locator {
  return page.getByTestId('workflow-details-toggle');
}

function detailsStep(page: Page, title: string): Locator {
  return details(page)
    .getByTestId('workflow-details-step')
    .filter({ hasText: title });
}

/** The button that opens a session from the Sessions list (not its id button). */
function sessionRow(page: Page, name: string): Locator {
  return page
    .getByRole('navigation', { name: 'Sessions', exact: true })
    .getByRole('button', { name: new RegExp(`^${name}`) });
}

async function sessionIdFromHeader(page: Page): Promise<string> {
  const label = await page.getByTestId('session-id').getAttribute('aria-label');
  const id = /^Copy session ID (.+)$/.exec(label ?? '')?.[1];
  if (!id) throw new Error('The open session did not expose its id');
  return id;
}

interface SessionJson {
  id: string;
  panelItems: { id: string; kind: string; title: string; visualId?: string }[];
  visualizations?: { id: string; title: string }[];
  workflow?: {
    phases: { number: number; title: string; skill?: string; action?: string }[];
    current: number | null;
    done: number[];
    source: string;
    note?: string;
    waiting?: boolean;
  };
}

function getSession(page: Page, id: string): Promise<SessionJson> {
  return apiJson<SessionJson>(page, 'GET', `/sessions/${id}`);
}

async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, name) });
}

/** Creates and publishes a user agent over the World Cup dataset. */
async function liveAgent(
  page: Page,
  name: string,
  instructions: string,
): Promise<string> {
  const id = await createUserAgent(page, {
    name,
    description: 'Walks you through an analysis',
    instructions,
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  return id;
}

/** Starts a chat from the agent's hub card and waits for its session. */
async function startChatWith(page: Page, name: string): Promise<string> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await page.getByRole('button', { name: `Start chat with ${name}` }).click();
  await expect(page.getByText(`Session "${name}" created`)).toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  return sessionIdFromHeader(page);
}

/** The turn that moves the workflow to "Analyse" (current 2, step 1 done). */
const GO_ON: TurnScript = {
  question: 'Go on',
  calls: [{ name: 'update_workflow', arguments: { current: 2, done: '1' } }],
  answer: 'We are analysing now.',
};

/** A workflow agent's session whose bar shows "Analyse" as the current step. */
async function sessionAtAnalyse(page: Page): Promise<string> {
  script([GO_ON]);
  await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  const id = await startChatWith(page, WORKFLOW_AGENT);
  await ask(page, GO_ON.question, GO_ON.answer);
  await expect(step(page, 'Analyse')).toHaveAttribute('data-status', 'current');
  return id;
}

const SHOW_FINDINGS: TurnScript = {
  question: 'Write up the findings',
  calls: [
    {
      name: 'show_in_panel',
      arguments: { kind: 'document', title: 'Findings', markdown: FINDINGS_MD },
    },
  ],
  answer: 'The findings are in the panel.',
};

const SHOW_TABLE: TurnScript = {
  question: 'Show me the top scorers as a table',
  calls: [
    {
      name: 'run_readonly_sql',
      arguments: { sql: STAGE_SQL, rationale: STAGE_RATIONALE },
    },
    { name: 'show_in_panel', arguments: { kind: 'table' } },
  ],
  answer: 'The table is in the panel.',
};

// --------------------------------------------------------------- scenarios

test('a composed document opens in the panel and downloads as PDF', async ({
  page,
}) => {
  script([SHOW_FINDINGS]);
  const sessionId = await createWorldCupSession(page);
  await expect(rightPanel(page)).toHaveCount(0);

  // The panel opens while the turn still streams (R12).
  const release = holdFinalAnswer([SHOW_FINDINGS], SHOW_FINDINGS.question);
  await send(page, SHOW_FINDINGS.question);
  await expect(
    rightPanel(page).getByRole('heading', { name: 'Findings' }),
  ).toBeVisible();
  await expect(rightPanel(page)).toContainText('Brazil scored most.');
  await expect(page.getByText('Thinking', { exact: true })).toBeVisible();
  await expect(page.getByText('show_in_panel', { exact: true })).toBeVisible();
  release();
  await expect(page.getByText(SHOW_FINDINGS.answer)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await screenshot(page, 'panel-document.png');

  // R11: a document downloads as PDF by default…
  const download = rightPanel(page).getByRole('button', { name: 'Download PDF' });
  await expect(download).toHaveAttribute('title', 'Download PDF');
  const [pdf] = await Promise.all([
    page.waitForEvent('download'),
    download.click(),
  ]);
  expect(pdf.suggestedFilename()).toBe('findings.pdf');
  const pdfBytes = fs.readFileSync((await pdf.path())!);
  expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await expect(page.getByText('Downloaded findings.pdf')).toBeVisible();

  // …with Markdown as the alternative.
  await rightPanel(page).getByRole('button', { name: 'Download as…' }).click();
  const [md] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Markdown (.md)' }).click(),
  ]);
  expect(md.suggestedFilename()).toBe('findings.md');
  expect(fs.readFileSync((await md.path())!, 'utf8')).toContain(
    'Brazil scored most.',
  );
  await expect(page.getByText('Downloaded findings.md')).toBeVisible();

  // The item is kept with the session (R10) and the API serves it (api.md 107).
  const session = await getSession(page, sessionId);
  expect(session.panelItems.map((item) => [item.kind, item.title])).toEqual([
    ['document', 'Findings'],
  ]);
  const res = await apiFetch(
    page,
    'GET',
    `/sessions/${sessionId}/panel-items/${session.panelItems[0].id}/download?format=md`,
  );
  expect(res.status()).toBe(200);
  expect(res.headers()['content-disposition']).toContain('filename="findings.md"');
  expect(await res.text()).toBe(FINDINGS_MD);
});

test('a query result shows as a sortable table', async ({ page }) => {
  script([SHOW_TABLE]);
  const sessionId = await createWorldCupSession(page);
  const stages = Number(
    await worldCupScalar('select count(distinct stage) from world_cup.matches'),
  );
  expect(stages).toBeGreaterThan(1);

  await ask(page, SHOW_TABLE.question, SHOW_TABLE.answer);
  const panel = rightPanel(page);
  const table = panel.locator('table');
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(['stage', 'matches']);
  await expect(table.locator('tbody tr')).toHaveCount(stages);
  await expect(panel).toContainText(`${stages} rows`);
  // The panel shows the SQL of the query.
  await panel.getByRole('button', { name: 'Query' }).click();
  await expect(panel.locator('pre')).toContainText('GROUP BY stage');

  const header = table.locator('thead th').nth(1);
  const counts = async () =>
    (await table.locator('tbody tr td:nth-child(2)').allTextContents()).map(
      (text) => Number(text.trim()),
    );
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  const ascending = await counts();
  expect(ascending).toEqual([...ascending].sort((a, b) => a - b));
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
  const descending = await counts();
  expect(descending).toEqual([...ascending].sort((a, b) => b - a));
  await screenshot(page, 'panel-table.png');

  const download = panel.getByRole('button', { name: 'Download (.csv)' });
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    download.click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const lines = fs
    .readFileSync((await csv.path())!, 'utf8')
    .trim()
    .split(/\r?\n/);
  expect(lines[0]).toBe('stage,matches');
  expect(lines).toHaveLength(stages + 1);
  await expect(
    page.getByText(`Downloaded ${csv.suggestedFilename()}`),
  ).toBeVisible();

  const session = await getSession(page, sessionId);
  expect(session.panelItems).toHaveLength(1);
  expect(session.panelItems[0]).toMatchObject({
    kind: 'table',
    title: STAGE_TITLE,
  });
});

test('a workspace file opens in the panel with a download', async ({
  page,
  appDataDir,
}) => {
  const turn: TurnScript = {
    question: 'Show me the summary notes',
    calls: [
      {
        name: 'show_in_panel',
        arguments: { kind: 'file', path: 'notes/summary.md' },
      },
    ],
    answer: 'The notes are in the panel.',
  };
  script([turn]);
  const sessionId = await createWorldCupSession(page);
  const notes = path.join(
    appDataDir,
    'workspaces',
    `session-${sessionId}`,
    'notes',
  );
  fs.mkdirSync(notes, { recursive: true });
  fs.writeFileSync(path.join(notes, 'summary.md'), SUMMARY_MD);

  await ask(page, turn.question, turn.answer);
  const panel = rightPanel(page);
  // A `.md` file renders as a document (R3), under its base name.
  await expect(panel.getByRole('heading', { name: 'Summary notes' })).toBeVisible();
  await expect(panel).toContainText('Germany reached the final.');
  await expect(panel).toContainText('summary.md');
  await screenshot(page, 'panel-file.png');

  // R11 and ui.md 4.13: a `.md` file downloads as PDF by default, with
  // Markdown (its own bytes) offered beside it.
  await expect(
    panel.getByRole('button', { name: 'Download PDF' }),
  ).toHaveAttribute('title', 'Download PDF');
  await panel.getByRole('button', { name: 'Download as…' }).click();
  const [md] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Markdown (.md)' }).click(),
  ]);
  expect(md.suggestedFilename()).toBe('summary.md');
  expect(fs.readFileSync((await md.path())!, 'utf8')).toBe(SUMMARY_MD);

  // api.md 106: the file's text as it is now in the workspace.
  const session = await getSession(page, sessionId);
  const item = session.panelItems.find((entry) => entry.kind === 'file')!;
  expect(item).toMatchObject({ title: 'summary.md' });
  const file = await apiJson<{ text: string; contentType: string }>(
    page,
    'GET',
    `/sessions/${sessionId}/panel-items/${item.id}/file`,
  );
  expect(file.text).toBe(SUMMARY_MD);
  expect(file.contentType).toBe('text/markdown');
});

test('an invalid path is refused and the panel does not change', async ({
  page,
}) => {
  const secrets: TurnScript = {
    question: 'Show me the secrets',
    calls: [
      {
        name: 'show_in_panel',
        arguments: { kind: 'file', path: '../secrets.md' },
      },
    ],
    answer: 'I could not show that file.',
  };
  script([SHOW_FINDINGS, secrets]);
  const sessionId = await createWorldCupSession(page);
  await ask(page, SHOW_FINDINGS.question, SHOW_FINDINGS.answer);
  await expect(
    rightPanel(page).getByRole('heading', { name: 'Findings' }),
  ).toBeVisible();

  const release = holdFinalAnswer([SHOW_FINDINGS, secrets], secrets.question);
  await send(page, secrets.question);
  // The chat shows the failed step while the turn streams…
  const stepRow = page
    .locator('div')
    .filter({ has: page.getByText('show_in_panel', { exact: true }) })
    .filter({ has: page.getByText('failed', { exact: true }) })
    .last();
  await expect(stepRow).toBeVisible();
  // …the model receives the tool's exact error…
  await expect
    .poll(() => toolResultsOf(secrets.question).join('\n'))
    .toContain('Invalid file path \\"../secrets.md\\"');
  release();
  await expect(page.getByText(secrets.answer)).toBeVisible();

  // …and the panel still shows the document, with nothing added.
  await expect(
    rightPanel(page).getByRole('heading', { name: 'Findings' }),
  ).toBeVisible();
  expect(await historyTitles(page)).toHaveLength(1);
  const session = await getSession(page, sessionId);
  expect(session.panelItems.map((item) => item.title)).toEqual(['Findings']);
});

test('the agent brings an existing visual back', async ({ page }) => {
  const stageTurn: TurnScript = {
    question: 'How many matches were played at each stage?',
    calls: [
      {
        name: 'run_readonly_sql',
        arguments: { sql: STAGE_SQL, rationale: STAGE_RATIONALE },
      },
    ],
    answer: 'The group stage holds most of the matches.',
  };
  const bringBack = (visualId: string): TurnScript => ({
    question: 'Bring the chart back',
    calls: [{ name: 'show_in_panel', arguments: { kind: 'visual', visualId } }],
    answer: 'The chart is back in the panel.',
  });
  script([stageTurn, SHOW_FINDINGS]);
  const sessionId = await createWorldCupSession(page);
  await ask(page, stageTurn.question, stageTurn.answer);
  await page.getByRole('button', { name: 'Generate interactive visuals' }).click();
  await expect(page.getByText('Interactive visual generated')).toBeVisible();
  const visual = (await getSession(page, sessionId)).visualizations?.[0];
  expect(visual?.title).toBe(VISUAL_TITLE);

  // The panel shows a document over the visual.
  await ask(page, SHOW_FINDINGS.question, SHOW_FINDINGS.answer);
  await expect(
    rightPanel(page).getByRole('heading', { name: 'Findings' }),
  ).toBeVisible();
  await expect(
    rightPanel(page).locator('iframe[title="Interactive visualization"]'),
  ).toHaveCount(0);

  script([stageTurn, SHOW_FINDINGS, bringBack(visual!.id)]);
  await ask(page, 'Bring the chart back', 'The chart is back in the panel.');
  await expect(
    rightPanel(page).locator('iframe[title="Interactive visualization"]'),
  ).toBeVisible();
  await expect(rightPanel(page)).toContainText(VISUAL_TITLE);
  await screenshot(page, 'panel-visual.png');
  const titles = await historyTitles(page);
  expect(titles[0]).toContain(VISUAL_TITLE);
  // One item per visual (R10): showing it again moves it, never adds one.
  expect(titles.filter((title) => title.includes(VISUAL_TITLE))).toHaveLength(1);
  expect(titles[1]).toContain('Findings');

  // A visual downloads through its own route, never as a panel item (api.md 107).
  const res = await apiFetch(
    page,
    'GET',
    `/sessions/${sessionId}/panel-items/visual:${visual!.id}/download`,
  );
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain(
    `Panel item \\"visual:${visual!.id}\\" can't be downloaded`,
  );
});

test('the workflow never appears in the right panel', async ({ page }) => {
  script([GO_ON]);
  await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  const sessionId = await startChatWith(page, WORKFLOW_AGENT);
  for (const title of STEPS) await expect(step(page, title)).toBeVisible();

  await page.getByTitle('Expand right panel').click();
  await expect(rightPanel(page)).toContainText('Nothing to show yet');
  await expect(historyButton(page)).toHaveCount(0);
  await expect(rightPanel(page)).not.toContainText('Workflow');
  await rightPanel(page).getByTitle('Collapse right panel').click();
  await expect(rightPanel(page)).toHaveCount(0);

  await ask(page, GO_ON.question, GO_ON.answer);
  await expect(step(page, 'Understand')).toHaveAttribute('data-status', 'done');
  await expect(step(page, 'Analyse')).toHaveAttribute('data-status', 'current');
  // update_workflow never opens the panel or adds an item (R13, R19).
  await expect(rightPanel(page)).toHaveCount(0);
  expect((await getSession(page, sessionId)).panelItems).toEqual([]);
  await page.getByTitle('Expand right panel').click();
  await expect(rightPanel(page)).toContainText('Nothing to show yet');
  await expect(historyButton(page)).toHaveCount(0);
  // A stored workflow is never a panel item (R10).
  const res = await apiFetch(
    page,
    'GET',
    `/sessions/${sessionId}/panel-items/phases/file`,
  );
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('Panel item \\"phases\\" not found');
});

test('the agent guides me through the current phase', async ({ page }) => {
  const turn: TurnScript = {
    question: 'Go on',
    calls: [
      {
        name: 'update_workflow',
        arguments: {
          current: 2,
          done: '1',
          todo: '2: Choose the lines to market',
          note: 'Pick the lines to market.',
        },
      },
    ],
    answer: 'Tell me which lines to market.',
  };
  script([turn]);
  await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  await startChatWith(page, WORKFLOW_AGENT);
  await ask(page, turn.question, turn.answer);

  const next = bar(page).getByTestId('workflow-bar-action');
  await expect(next).toHaveText('Your next step: Choose the lines to market');
  // One line (R17): the row is no taller than its line height.
  const { height, lineHeight } = await next.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight),
  }));
  expect(height).toBeLessThanOrEqual(lineHeight + 1);
  await expect(bar(page)).not.toContainText('Pick the lines to market.');

  await detailsToggle(page).click();
  await expect(details(page)).toBeVisible();
  const current = details(page).locator('[data-current="true"]');
  await expect(current).toContainText('Analyse');
  await expect(current).toBeInViewport();
  await expect(current.getByTestId('workflow-details-note')).toHaveText(
    'Pick the lines to market.',
  );
  await expect(details(page).getByTestId('workflow-details-note')).toHaveCount(1);
});

test('details lists every step and closes on Escape, outside click and its button', async ({
  page,
}) => {
  await sessionAtAnalyse(page);
  const toggle = detailsToggle(page);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(details(page).getByTestId('workflow-details-step')).toHaveText(
    STEPS.map((title) => new RegExp(title)),
  );
  await expect(details(page)).toContainText('Workflow · 1/3 done');
  await expect(detailsStep(page, 'Understand')).toHaveAttribute('data-status', 'done');
  await expect(detailsStep(page, 'Understand')).toContainText('Done');
  await expect(detailsStep(page, 'Analyse')).toHaveAttribute('data-status', 'current');
  await expect(detailsStep(page, 'Analyse')).toContainText('Current');
  await expect(detailsStep(page, 'Report')).toHaveAttribute('data-status', 'upcoming');
  // Open steps say what to do; done steps don't. The skill is a caption.
  await expect(detailsStep(page, 'Understand')).not.toContainText('To do:');
  await expect(detailsStep(page, 'Analyse')).toContainText(
    'To do: Review the queries I run.',
  );
  await expect(detailsStep(page, 'Report')).toContainText(
    'To do: Review the report and approve it.',
  );
  await expect(detailsStep(page, 'Analyse')).toContainText('curated-knowledge');
  // It overlays the chat and leaves the right panel alone.
  await expect(rightPanel(page)).toHaveCount(0);
  await screenshot(page, 'workflow-bar-details.png');

  await page.keyboard.press('Escape');
  await expect(details(page)).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await toggle.click();
  await expect(details(page)).toBeVisible();
  await composer(page).click();
  await expect(details(page)).toHaveCount(0);

  await toggle.click();
  await expect(details(page)).toBeVisible();
  await toggle.click();
  await expect(details(page)).toHaveCount(0);
});

test('every session shows the workflow bar, empty until there is a workflow', async ({
  page,
}) => {
  await createWorldCupSession(page);
  await expect(bar(page)).toBeVisible();
  await expect(bar(page).getByTestId('workflow-bar-empty')).toHaveText(
    /Workflow · No workflow yet · The agent shows its steps here when it guides you through a process\./,
  );
  await expect(bar(page).getByRole('button', { name: 'Hide workflow' })).toHaveCount(0);
  await expect(detailsToggle(page)).toHaveCount(0);
  await screenshot(page, 'workflow-bar-empty.png');
});

test('the workflow bar shows my agent\'s steps from the first turn', async ({
  page,
}) => {
  await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  const sessionId = await startChatWith(page, WORKFLOW_AGENT);
  expect(stub.requests, 'no message has been sent').toHaveLength(0);

  // Under the page header, above the chat.
  const header = page
    .locator('header')
    .filter({ has: page.getByTestId('session-id') });
  const headerBox = (await header.boundingBox())!;
  const barBox = (await bar(page).boundingBox())!;
  const welcomeBox = (await page.getByTestId('session-welcome').boundingBox())!;
  expect(barBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height - 1);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(welcomeBox.y + 1);

  const items = bar(page).getByRole('list', { name: 'Workflow' }).getByRole('listitem');
  await expect(items).toHaveText(STEPS.map((title) => new RegExp(title)));
  // The Gherkin reads "with Understand as current"; R17, ui.md 4.12.1 and
  // data-model 3.4.4 (`current: null` until the agent marks a step) say no
  // step is current before the agent's first update_workflow, and the next
  // step is the first open one. The test follows the system specs (see the
  // evidence's e2e-impact.md).
  await expect(items.and(page.locator('[data-status="upcoming"]'))).toHaveCount(3);
  await expect(items.and(page.locator('[aria-current="step"]'))).toHaveCount(0);
  await expect(bar(page).getByTestId('workflow-bar-action')).toHaveText(
    'Your next step: Tell me what you want to find out.',
  );
  await expect(bar(page)).toContainText('0/3 done');
  await expect(items.and(page.locator('[data-status="done"]'))).toHaveCount(0);
  await screenshot(page, 'workflow-bar-steps.png');

  const { workflow } = await getSession(page, sessionId);
  expect(workflow?.source).toBe('prompt');
  expect(workflow?.phases.map((phase) => phase.title)).toEqual(STEPS);
  expect(workflow?.phases[1].skill).toBe('curated-knowledge');
  expect(workflow?.current).toBeNull();
});

test('the agent moves the workflow bar as we go', async ({ page }) => {
  const turn: TurnScript = {
    question: 'Go on',
    calls: [
      {
        name: 'update_workflow',
        arguments: {
          current: 2,
          done: '1',
          waiting: true,
          todo: '2: Choose the lines to market',
          note: 'Pick the lines to market.',
        },
      },
    ],
    answer: 'Tell me which lines to market.',
  };
  script([turn]);
  await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  const sessionId = await startChatWith(page, WORKFLOW_AGENT);
  await expect(bar(page)).toContainText('0/3 done');

  // The bar moves while the turn still streams (R19).
  const release = holdFinalAnswer([turn], turn.question);
  await send(page, turn.question);
  await expect(step(page, 'Understand')).toHaveAttribute('data-status', 'done');
  await expect(step(page, 'Analyse')).toHaveAttribute('data-status', 'waiting');
  await expect(page.getByText('Thinking', { exact: true })).toBeVisible();
  release();
  await expect(page.getByText(turn.answer)).toBeVisible();

  await expect(
    step(page, 'Understand').getByRole('button', { name: 'Step 1: Understand, Done' }),
  ).toBeVisible();
  const analyse = step(page, 'Analyse').getByRole('button', {
    name: 'Step 2: Analyse, Waiting for you',
  });
  await expect(analyse).toHaveAttribute('title', 'Waiting for you');
  await expect(step(page, 'Analyse')).toHaveAttribute('aria-current', 'step');
  await expect(bar(page)).toContainText('1/3 done');
  await expect(bar(page).getByTestId('workflow-bar-action')).toHaveText(
    'Your next step: Choose the lines to market',
  );
  await detailsToggle(page).click();
  const current = details(page).locator('[data-current="true"]');
  await expect(current).toContainText('Analyse');
  await expect(current).toContainText('Waiting for you');
  await expect(current.getByTestId('workflow-details-note')).toHaveText(
    'Pick the lines to market.',
  );
  await page.keyboard.press('Escape');

  // The persisted view comes back with the session (R19).
  const { workflow } = await getSession(page, sessionId);
  expect(workflow).toMatchObject({
    current: 2,
    done: [1],
    waiting: true,
    note: 'Pick the lines to market.',
  });
  expect(workflow?.phases[1].action).toBe('Choose the lines to market');
});

test('every open step says what needs to be done', async ({ page }) => {
  await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  await startChatWith(page, WORKFLOW_AGENT);

  const report = step(page, 'Report').getByRole('button');
  await expect(report).toHaveAttribute(
    'title',
    'To do: Review the report and approve it.',
  );
  await report.click();
  const popover = page.getByRole('dialog', { name: 'Step details' });
  await expect(popover).toContainText('Step 3');
  await expect(popover).toContainText('Report');
  await expect(popover).toContainText('To do Review the report and approve it.');
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);

  await detailsToggle(page).click();
  await expect(detailsStep(page, 'Report')).toContainText(
    'To do: Review the report and approve it.',
  );
  // Before the agent marks a step, the next step is the first open one (R17).
  await page.keyboard.press('Escape');
  await expect(bar(page).getByTestId('workflow-bar-action')).toHaveText(
    'Your next step: Tell me what you want to find out.',
  );
});

test('an agent without a Workflow section creates its own steps', async ({
  page,
}) => {
  const turn: TurnScript = {
    question: 'Guide me through a review',
    calls: [
      {
        name: 'update_workflow',
        arguments: { steps: 'Scope | Analyse | Report', current: 1 },
      },
    ],
    answer: 'Let us start with the scope.',
  };
  script([turn]);
  await liveAgent(page, FREE_AGENT, 'Help the user review the World Cup data.');
  const sessionId = await startChatWith(page, FREE_AGENT);
  await expect(bar(page).getByTestId('workflow-bar-empty')).toBeVisible();

  await ask(page, turn.question, turn.answer);
  const items = bar(page).getByRole('list', { name: 'Workflow' }).getByRole('listitem');
  await expect(items).toHaveText([/Scope/, /Analyse/, /Report/]);
  await expect(step(page, 'Scope')).toHaveAttribute('data-status', 'current');
  await expect(bar(page)).toContainText('0/3 done');
  const { workflow } = await getSession(page, sessionId);
  expect(workflow?.source).toBe('agent');
});

test("the agent can't rename prompt-defined steps", async ({ page }) => {
  const turn: TurnScript = {
    question: 'Rename the steps',
    calls: [{ name: 'update_workflow', arguments: { steps: 'One | Two' } }],
    answer: 'The steps stay as they are.',
  };
  script([turn]);
  await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  await startChatWith(page, WORKFLOW_AGENT);
  await ask(page, turn.question, turn.answer);

  const results = toolResultsOf(turn.question);
  expect(results).toHaveLength(1);
  expect(results[0]).toContain(ERR_RENAME);
  const items = bar(page).getByRole('list', { name: 'Workflow' }).getByRole('listitem');
  await expect(items).toHaveText(STEPS.map((title) => new RegExp(title)));
  await expect(bar(page)).not.toContainText('One');
});

test('I can fold the workflow bar', async ({ page }) => {
  await sessionAtAnalyse(page);
  const list = bar(page).getByRole('list', { name: 'Workflow' });

  await bar(page).getByRole('button', { name: 'Hide workflow' }).click();
  await expect(list).toHaveCount(0);
  await expect(bar(page)).toContainText('Workflow · Analyse · 1/3');
  await expect(bar(page).getByTestId('workflow-bar-action')).toHaveCount(0);
  await expect(detailsToggle(page)).toBeVisible();
  await screenshot(page, 'workflow-bar-folded.png');

  // Reopen the app: the fold is remembered per browser (R18).
  await page.reload();
  await openSessions(page);
  await sessionRow(page, WORKFLOW_AGENT).click();
  await expect(bar(page)).toContainText('Workflow · Analyse · 1/3');
  await expect(list).toHaveCount(0);

  await bar(page).getByRole('button', { name: 'Show workflow' }).click();
  await expect(list.getByRole('listitem')).toHaveText(
    STEPS.map((title) => new RegExp(title)),
  );
});

test('shown items survive reopening the session', async ({ page }) => {
  script([SHOW_FINDINGS, SHOW_TABLE]);
  const sessionId = await createWorldCupSession(page);
  await ask(page, SHOW_FINDINGS.question, SHOW_FINDINGS.answer);
  await ask(page, SHOW_TABLE.question, SHOW_TABLE.answer);
  await expect(rightPanel(page).locator('table')).toBeVisible();

  const other = await apiJson<{ session: { id: string } }>(page, 'POST', '/sessions', {
    name: 'Other analysis',
    datasets: [WORLD_CUP_DATASET],
  });
  expect(other.session.id).not.toBe(sessionId);
  const row = (name: string) => sessionRow(page, name);

  // Another session, then back: the panel opens on the latest item (R12).
  await page.reload();
  await openSessions(page);
  await row('Other analysis').click();
  await expect(page.getByRole('heading', { name: 'Other analysis' })).toBeVisible();
  await page.getByTitle('Expand right panel').click();
  await expect(rightPanel(page)).toContainText('Nothing to show yet');
  await openSessions(page);
  await row('World Cup analysis').click();
  await expect(rightPanel(page).locator('table')).toBeVisible();
  await expect(rightPanel(page)).toContainText(STAGE_TITLE);

  const titles = await historyTitles(page);
  expect(titles).toHaveLength(2);
  expect(titles[0]).toContain(STAGE_TITLE);
  expect(titles[1]).toContain('Findings');

  await historyButton(page).click();
  await rightPanel(page).locator('.menu-item').filter({ hasText: 'Findings' }).click();
  await expect(
    rightPanel(page).getByRole('heading', { name: 'Findings' }),
  ).toBeVisible();
  await expect(rightPanel(page).locator('table')).toHaveCount(0);
});
