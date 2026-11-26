import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import { DatabaseSync } from 'node:sqlite';
import {
  apiBase,
  createSkill,
  createUserAgent,
  publishAgent,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
import { apiJson } from './helpers/api';
import { pickDatasetIn } from './helpers/run-ui';
import { worldCupKey } from './helpers/world-cup-db';
import {
  LlmStub,
  STUB_ANSWER,
  StubRequest,
  startLlmStub,
  systemTexts,
  turnRequests,
} from './helpers/llm-stub';

/**
 * Mirrors the Feature "Agent editor" in specs/capabilities/agents-evals/spec.md.
 * The model is a local OpenAI-compatible stub that records what the backend
 * sends it (see agent-sessions.spec.ts).
 */

const HISTORIAN = 'Cup historian';
const AGENT_BLOCK_START = 'Agent instructions (user-supplied';

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  // Background
  stub = await startLlmStub();
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

function button(page: Page | Locator, name: string): Locator {
  return page.getByRole('button', { name, exact: true });
}

async function openHub(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agent personas', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agent personas', exact: true }),
  ).toBeVisible();
}

async function openNewAgent(page: Page): Promise<void> {
  await openHub(page);
  await button(page, 'New agent persona').click();
  await expect(
    page.getByRole('heading', { name: 'New agent persona', exact: true }),
  ).toBeVisible();
}

/** Opens a user agent's editor from its hub card and detail view. */
async function openEditor(page: Page, id: string, name: string) {
  await openHub(page);
  await page.getByTestId(`agent-${id}`).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByTestId('agent-edit').click();
  await expect(
    page.getByRole('heading', { name: `Edit ${name}`, exact: true }),
  ).toBeVisible();
}

const nameField = (page: Page) => page.getByLabel('Name', { exact: true });
const instructionsField = (page: Page) =>
  page.getByLabel('Job description', { exact: true });
const datasetsGroup = (page: Page) =>
  page.getByRole('group', { name: 'Datasets' });
/** A picked dataset's chip, by its text (`<name> (missing)` when it no longer exists). */
const datasetChip = (page: Page, text: string) =>
  datasetsGroup(page)
    .getByTestId('dataset-picker-chip')
    .filter({ hasText: new RegExp(`^\\s*${text.replace(/[()]/g, '\\$&')}\\s*$`) });
const pickAgentDataset = (page: Page, name: string) =>
  pickDatasetIn(datasetsGroup(page), name);
const editorStatus = (page: Page) => page.getByTestId('agent-editor-status');
const detailsPanel = (page: Page) =>
  page.getByRole('complementary', { name: 'Details panel' });
const tryQuestion = (page: Page) =>
  detailsPanel(page).getByTestId('agent-tryit-question');

/** Try it in the Details panel: ask the draft once (agents-evals R60). */
async function tryInPanel(page: Page, question: string): Promise<void> {
  await tryQuestion(page).fill(question);
  await detailsPanel(page).getByTestId('agent-tryit-run').click();
}

/** Waits for the stub's answer `count` times in `scope`. */
async function expectAnswers(scope: Page | Locator, count: number) {
  await expect(scope.getByText(STUB_ANSWER)).toHaveCount(count);
}

/** The system messages the model received for the turn that asked `question`. */
function systemsFor(question: string): string {
  const requests = turnRequests(stub, question);
  expect(requests.length, `a streamed call for "${question}"`).toBeGreaterThan(
    0,
  );
  return systemTexts(requests[0]).join('\n');
}

async function listedSessions(page: Page): Promise<string[]> {
  const response = await page.request.get(`${apiBase(page)}/sessions`);
  const body = (await response.json()) as { sessions: { name: string }[] };
  return body.sessions.map((session) => session.name);
}

/** The workspaces of draft runs: a stored run keeps its own, a draft run none. */
function draftRunWorkspaces(appDataDir: string): string[] {
  const dir = path.join(appDataDir, 'workspaces');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.startsWith('session-run-'));
}

async function storedRuns(page: Page): Promise<string[]> {
  const response = await page.request.get(`${apiBase(page)}/workflow-runs`);
  const body = (await response.json()) as { runs: { id: string }[] };
  return body.runs.map((run) => run.id);
}

test('creates an agent, tries it, publishes it and deletes it', async ({
  page,
}) => {
  await openNewAgent(page);
  await expect(page.getByTestId('agent-save')).toBeDisabled();

  await nameField(page).fill(HISTORIAN);
  await instructionsField(page).fill('Always name the tournament year.');
  await pickAgentDataset(page, WORLD_CUP_DATASET);
  await button(page, 'Add starter question').click();
  await page.getByLabel('Starter question 1').fill('Who won in 2014?');
  await page.getByTestId('agent-save').click();
  await expect(
    page.getByText(`Agent "${HISTORIAN}" saved as draft`),
  ).toBeVisible();
  await expect(editorStatus(page)).toContainText('Draft');

  await page.getByTestId('agent-try-it').click();
  await expect(detailsPanel(page)).toContainText('Try it');
  await tryInPanel(page, 'Who won in 2014?');
  await expectAnswers(detailsPanel(page), 1);
  const systems = systemsFor('Who won in 2014?');
  expect(systems).toContain(AGENT_BLOCK_START);
  expect(systems).toContain('Always name the tournament year.');
  expect(await listedSessions(page)).toEqual([]);

  await page.getByTestId('agent-editor-publish').click();
  await expect(page.getByText(`Agent "${HISTORIAN}" is Live`)).toBeVisible();
  await expect(editorStatus(page)).toContainText('Live');

  await button(page, 'Back').click();
  await expect(
    page.getByRole('heading', { name: HISTORIAN, exact: true }),
  ).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('agent-delete').click();
  await expect(page.getByText(`Agent "${HISTORIAN}" deleted`)).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Agent personas', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(HISTORIAN, { exact: true })).toHaveCount(0);
});

test('editing a Live agent shows unpublished changes until republished', async ({
  page,
}) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);

  await openEditor(page, id, HISTORIAN);
  await instructionsField(page).fill('Talk like a pirate.');
  await page.getByTestId('agent-save').click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await expect(editorStatus(page)).toContainText('Live');
  await expect(editorStatus(page)).toContainText('Unpublished changes');

  await openEditor(page, id, HISTORIAN);
  await page.getByTestId('agent-editor-publish').click();
  await expect(page.getByText(`Agent "${HISTORIAN}" is Live`)).toBeVisible();
  await expect(editorStatus(page)).toContainText('Live');
  await expect(editorStatus(page)).not.toContainText('Unpublished changes');
});

test('Try it saves the form first', async ({ page }) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await openEditor(page, id, HISTORIAN);
  await page.getByTestId('agent-try-it').click();
  await expect(tryQuestion(page)).toBeVisible();

  await instructionsField(page).fill('Talk like a pirate.');
  await tryInPanel(page, 'Who won in 2014?');
  await expect(page.getByText('Draft saved')).toBeVisible();
  await expectAnswers(detailsPanel(page), 1);
  const systems = systemsFor('Who won in 2014?');
  expect(systems).toContain('Talk like a pirate.');
  expect(systems).not.toContain('Answer in one sentence.');
});

test('Try it stores nothing: the run leaves no workspace, and Reset clears the result', async ({
  page,
  appDataDir,
}) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    datasets: [WORLD_CUP_DATASET],
  });
  await openEditor(page, id, HISTORIAN);
  await page.getByTestId('agent-try-it').click();
  await tryInPanel(page, 'Who won in 2014?');
  await expectAnswers(detailsPanel(page), 1);
  // The draft run's host and workspace are gone once it ends (R61), and it
  // is neither a session nor a stored run.
  await expect.poll(() => draftRunWorkspaces(appDataDir)).toEqual([]);
  expect(await listedSessions(page)).toEqual([]);
  expect(await storedRuns(page)).toEqual([]);

  await detailsPanel(page).getByTestId('agent-tryit-reset').click();
  await expect(tryQuestion(page)).toHaveValue('');
  await expect(detailsPanel(page).getByText(STUB_ANSWER)).toHaveCount(0);

  await tryInPanel(page, 'And in 2010?');
  await expectAnswers(detailsPanel(page), 1);
  await button(page, 'Back').click();
  await expect(
    page.getByRole('heading', { name: HISTORIAN, exact: true }),
  ).toBeVisible();
  await button(page, 'All agent personas').click();
  await expect.poll(() => draftRunWorkspaces(appDataDir)).toEqual([]);
  expect(await storedRuns(page)).toEqual([]);
});

test('Try it waits when Elena asks, continues with my answer and stores nothing', async ({
  page,
  appDataDir,
}) => {
  // Elena asks the user once; after the answer she answers.
  stub.reply = (request) => {
    if (!request.stream || request.messages.at(-1)?.role === 'tool') {
      return { text: STUB_ANSWER };
    }
    return {
      toolCall: {
        name:
          request.tools.find((tool) => tool.endsWith('ask_clarification')) ??
          'ask_clarification',
        arguments: {
          question: 'Which World Cup do you mean?',
          options: '2018\n2022',
        },
      },
    };
  };
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Ask when a question is open: [[tool:ask_clarification]].',
    datasets: [WORLD_CUP_DATASET],
  });
  await openEditor(page, id, HISTORIAN);
  await page.getByTestId('agent-try-it').click();
  await tryInPanel(page, 'Who won the World Cup?');

  // The draft waits: the question as a card, no answer, nothing stored.
  const waiting = detailsPanel(page).getByTestId('agent-tryit-waiting');
  await expect(waiting).toContainText('Which World Cup do you mean?');
  await expect(waiting.getByTestId('workflow-run-input-option-1')).toHaveText(
    '2022',
  );
  await expect(detailsPanel(page).getByText(STUB_ANSWER)).toHaveCount(0);
  expect(await storedRuns(page)).toEqual([]);
  expect(await listedSessions(page)).toEqual([]);

  // My answer continues the same draft.
  await waiting.getByTestId('workflow-run-input-option-1').click();
  await expectAnswers(detailsPanel(page), 1);
  await expect(waiting).toHaveCount(0);

  // The run ended: its host and workspace are gone, and nothing was stored.
  await expect.poll(() => draftRunWorkspaces(appDataDir)).toEqual([]);
  expect(await storedRuns(page)).toEqual([]);
  expect(await listedSessions(page)).toEqual([]);
});

test('Try it needs a dataset, and names must be unique', async ({ page }) => {
  const id = await createUserAgent(page, {
    name: 'Health plan analyst',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);

  await openNewAgent(page);
  await nameField(page).fill(HISTORIAN);
  await page.getByTestId('agent-try-it').click();
  await expect(detailsPanel(page)).toContainText(
    'Select at least one dataset to preview',
  );
  await expect(tryQuestion(page)).toHaveCount(0);

  await nameField(page).fill('Health plan analyst');
  await page.getByTestId('agent-save').click();
  await expect(
    page.getByText('An agent named "Health plan analyst" already exists'),
  ).toBeVisible();
});

test('leaving with unsaved changes asks first', async ({ page }) => {
  await openNewAgent(page);
  await nameField(page).fill(HISTORIAN);

  let message = '';
  page.once('dialog', (dialog) => {
    message = dialog.message();
    void dialog.dismiss();
  });
  await button(page, 'Back').click();
  expect(message).toBe('Discard unsaved changes?');
  await expect(
    page.getByRole('heading', { name: 'New agent persona', exact: true }),
  ).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await button(page, 'Back').click();
  await expect(
    page.getByRole('heading', { name: 'Agent personas', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(HISTORIAN, { exact: true })).toHaveCount(0);
});

test('a dataset that no longer exists stays visible in the editor', async ({
  page,
}) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    datasets: [WORLD_CUP_DATASET, 'Gone'],
  });
  await openEditor(page, id, HISTORIAN);
  await expect(datasetChip(page, WORLD_CUP_DATASET)).toBeVisible();
  await expect(datasetChip(page, 'Gone (missing)')).toBeVisible();

  await datasetsGroup(page)
    .getByRole('button', { name: 'Remove Gone', exact: true })
    .click();
  await page.getByTestId('agent-save').click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await expect(datasetChip(page, 'Gone (missing)')).toHaveCount(0);

  await openHub(page);
  await expect(page.getByTestId(`agent-card-${id}`)).not.toContainText(
    'Missing dataset',
  );
});

test('the editor has no detectable accessibility violations in either theme', async ({
  page,
}) => {
  await followOsTheme(page);
  await openNewAgent(page);
  await page.getByTestId('agent-try-it').click();
  await expect(detailsPanel(page)).toContainText(
    'Select at least one dataset to preview',
  );

  await page.addScriptTag({ content: axe.source });
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Let the theme's colour transitions finish before axe reads colours.
    await page.waitForTimeout(500);
    const results = await page.evaluate(async () => {
      return (window as unknown as { axe: typeof axe }).axe.run(document);
    });
    expect(results.violations, theme).toEqual([]);
  }
});

// ---------------------------------------------------------------------------
// Links in the instructions decide the tools and skills (BA-217, BA-216,
// BA-219, BA-220), the Tools, Graph and LLM Config tabs (BA-221), and the
// agent page's Try it, Job Description and Skills tabs (BA-222).
// ---------------------------------------------------------------------------

const FISCAL = 'fiscal-calendar';
const FISCAL_DESCRIPTION = 'Use when a question names a fiscal year.';
const CHART_STYLE = 'chart-style';
const OPTIONAL_TOOLS_OFF = ['ask_clarification'];

/** The agent editor's Job description field: the Tiptap link editor. */
const instructionsEditor = (page: Page) =>
  page.getByRole('textbox', { name: 'Job description', exact: true });
const linkMenu = (page: Page) => page.getByRole('listbox');

/** Types `text` at the end of a link editor. */
async function typeAtEnd(page: Page, editor: Locator, text: string) {
  await editor.click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(text);
}

/** Types `/<query>` at the end of `editor` and picks `name` from the menu. */
async function linkFromMenu(
  page: Page,
  editor: Locator,
  query: string,
  name: string,
) {
  await typeAtEnd(page, editor, query);
  await linkMenu(page)
    .getByRole('option', { name: new RegExp(`^${name}\\b`) })
    .click();
  await expect(linkMenu(page)).toHaveCount(0);
  await expect(editor.locator(`[data-link$=":${name}"]`)).toBeVisible();
}

/** Skill names in the `<available_skills>` catalog of a request. */
function catalogSkills(request: StubRequest): string[] {
  const catalog = systemTexts(request)
    .join('\n')
    .match(/<available_skills>[\s\S]*?<\/available_skills>/);
  if (!catalog) return [];
  return [...catalog[0].matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
}

/** The first streamed request of the turn that asked `question`. */
function firstRequest(question: string): StubRequest {
  const requests = turnRequests(stub, question);
  expect(requests.length, `a streamed call for "${question}"`).toBeGreaterThan(
    0,
  );
  return requests[0];
}

/** Opens a user or built-in agent's page from its hub card. */
async function openAgentPage(page: Page, id: string, name: string) {
  await openHub(page);
  await page.getByTestId(`agent-${id}`).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/**
 * Rewrites a stored agent document straight in the app's SQLite file, for
 * states the API no longer produces: a draft saved before links (BA-219), or
 * one whose link points at a skill that is gone.
 */
function patchAgentDoc(
  appDataDir: string,
  id: string,
  patch: (doc: { draft: Record<string, unknown> }) => void,
): void {
  const db = new DatabaseSync(path.join(appDataDir, 'app.sqlite'));
  try {
    const rows = db.prepare('SELECT rid, doc FROM agents').all() as {
      rid: number;
      doc: string;
    }[];
    const row = rows.find((r) => JSON.parse(r.doc).id === id);
    if (!row) throw new Error(`No agent ${id} in app.sqlite`);
    const doc = JSON.parse(row.doc) as { draft: Record<string, unknown> };
    patch(doc);
    db.prepare('UPDATE agents SET doc = ? WHERE rid = ?').run(
      JSON.stringify(doc),
      row.rid,
    );
  } finally {
    db.close();
  }
}

/** Saves an evidence screenshot when E2E_EVIDENCE_DIR names a folder. */
async function evidence(page: Page, folder: string, name: string) {
  const root = process.env['E2E_EVIDENCE_DIR'];
  if (!root) return;
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
}

test('only linked tools are offered to the model', async ({ page }) => {
  await openNewAgent(page);
  await nameField(page).fill('KPI lookup');
  await pickAgentDataset(page, WORLD_CUP_DATASET);
  await page.getByTestId('link-tool').click();
  await linkMenu(page)
    .getByRole('option', { name: /^sample_rows\b/ })
    .click();
  await expect(
    instructionsEditor(page).locator('[data-link="tool:sample_rows"]'),
  ).toBeVisible();
  await page.getByTestId('agent-save').click();
  await expect(
    page.getByText('Agent "KPI lookup" saved as draft'),
  ).toBeVisible();

  await page.getByTestId('agent-try-it').click();
  await tryInPanel(page, 'Who won in 2014?');
  await expectAnswers(detailsPanel(page), 1);
  const request = firstRequest('Who won in 2014?');
  expect(request.tools).toContain('sample_rows');
  for (const tool of OPTIONAL_TOOLS_OFF)
    expect(request.tools).not.toContain(tool);

  await button(page, 'Back').click();
  await expect(
    page.getByRole('heading', { name: 'KPI lookup', exact: true }),
  ).toBeVisible();
  await page.getByTestId('agent-tab-tools').click();
  await expect(page.getByTestId('tool-status-sample_rows')).toHaveText(
    'Linked',
  );
  await expect(page.getByTestId('tool-status-ask_clarification')).toHaveText(
    'Not linked',
  );
  await evidence(page, '1.14.2', 'agent-tools-tab-linked.png');
});

test('a linked skill reaches Try it, and editing the skill leaves the Live agent with unpublished changes', async ({
  page,
}) => {
  await createSkill(page, {
    name: FISCAL,
    description: FISCAL_DESCRIPTION,
    body: 'Our fiscal year starts on 1 July.',
  });
  await openNewAgent(page);
  await nameField(page).fill('Finance helper');
  await pickAgentDataset(page, WORLD_CUP_DATASET);
  await linkFromMenu(page, instructionsEditor(page), '/fis', FISCAL);
  await page.getByTestId('agent-save').click();
  await expect(
    page.getByText('Agent "Finance helper" saved as draft'),
  ).toBeVisible();
  await evidence(page, '1.14.6', 'agent-editor-skill-chip.png');

  await page.getByTestId('agent-try-it').click();
  await tryInPanel(page, 'What happened in fiscal 2018?');
  await expectAnswers(detailsPanel(page), 1);
  const preview = firstRequest('What happened in fiscal 2018?');
  expect(catalogSkills(preview)).toContain(FISCAL);
  const systems = systemTexts(preview).join('\n');
  expect(systems).toContain(`the "${FISCAL}" skill`);
  expect(systems).not.toContain('[[');

  await page.getByTestId('agent-editor-publish').click();
  await expect(page.getByText('Agent "Finance helper" is Live')).toBeVisible();

  // Change the skill's body in the skills library.
  await openHub(page);
  await page.getByTestId('agent-skills-library').click();
  await page.getByTestId(`skill-row-${FISCAL}`).click();
  const body = page.getByRole('textbox', { name: 'Body', exact: true });
  await expect(body).toContainText('1 July');
  await body.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Our fiscal year starts on 1 April.');
  await page.getByTestId('skill-save').click();
  await expect(page.getByText('Skill saved')).toBeVisible();

  await openHub(page);
  const card = page.locator('[data-testid^="agent-card-"]').filter({
    hasText: 'Finance helper',
  });
  await expect(card).toContainText('Unpublished changes');
});

test("a linked skill's tools come with it", async ({ page }) => {
  await createSkill(page, {
    name: CHART_STYLE,
    description: 'Use when drawing a chart.',
    body: 'Look at real values with [[tool:sample_rows]] before charting.',
  });
  await openNewAgent(page);
  await nameField(page).fill('Chart helper');
  await pickAgentDataset(page, WORLD_CUP_DATASET);
  await linkFromMenu(page, instructionsEditor(page), '/char', CHART_STYLE);
  await page.getByTestId('agent-save').click();
  await expect(
    page.getByText('Agent "Chart helper" saved as draft'),
  ).toBeVisible();

  await page.getByTestId('agent-try-it').click();
  await tryInPanel(page, 'Chart the goals per year.');
  await expectAnswers(detailsPanel(page), 1);
  const request = firstRequest('Chart the goals per year.');
  expect(request.tools).toContain('sample_rows');
  expect(request.tools).not.toContain('ask_clarification');

  await button(page, 'Back').click();
  await page.getByTestId('agent-tab-tools').click();
  await expect(page.getByTestId('tool-status-sample_rows')).toHaveText(
    'Linked',
  );
  await expect(page.getByTestId('tool-link-sample_rows')).toContainText(
    `Linked by ${CHART_STYLE}`,
  );
  await evidence(page, '1.14.7', 'agent-tools-linked-by-skill.png');
});

test('a slash inside a word does not open the link menu', async ({ page }) => {
  await openNewAgent(page);
  await typeAtEnd(page, instructionsEditor(page), 'Speeds in km/h');
  await expect(linkMenu(page)).toHaveCount(0);

  await page.keyboard.type(' /');
  await expect(linkMenu(page)).toBeVisible();
  await expect(
    linkMenu(page).getByText('Skills', { exact: true }),
  ).toBeVisible();
  await expect(
    linkMenu(page).getByText('Tools', { exact: true }),
  ).toBeVisible();
});

test('an unknown link is refused', async ({ page, appDataDir }) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  patchAgentDoc(appDataDir, id, (doc) => {
    doc.draft['instructions'] = 'Use [[skill:gone]] for dates.';
  });
  await openEditor(page, id, HISTORIAN);
  const chip = instructionsEditor(page).locator('[data-link="skill:gone"]');
  await expect(chip).toHaveText('gone');
  await expect(chip).toHaveClass(/chip-danger/);
  await expect(chip).toHaveAttribute('title', 'Not found');

  // Save is enabled once the form differs from what was loaded.
  await page.getByLabel('Description', { exact: true }).fill('Dates first.');
  await page.getByTestId('agent-save').click();
  await expect(page.getByText('Unknown skill "gone"')).toBeVisible();
});

test('an agent saved before links gets a links line', async ({
  page,
  appDataDir,
}) => {
  const id = await createUserAgent(page, {
    name: 'Old timer',
    instructions: 'Be brief.',
    datasets: [WORLD_CUP_DATASET],
  });
  patchAgentDoc(appDataDir, id, (doc) => {
    delete doc.draft['tools'];
    delete doc.draft['skills'];
  });
  await openEditor(page, id, 'Old timer');
  const lastLine = instructionsEditor(page).locator('p').last();
  await expect(lastLine).toHaveText(
    /^Tools and skills:\s*sample_rows\s*ask_clarification$/,
  );
  await expect(lastLine.locator('[data-link]')).toHaveText([
    'sample_rows',
    'ask_clarification',
  ]);
  await expect(page.getByTestId('agent-legacy-notice')).toHaveText(
    'Links were added for what this agent persona had. Save to keep them.',
  );
  await expect(page.getByTestId('agent-save')).toBeEnabled();
});

test('the LLM Config tab shows whether the key is set and never the key', async ({
  page,
}) => {
  const secret = 'sk-secret-123';
  const response = await page.request.put(`${apiBase(page)}/llm/settings`, {
    data: {
      provider: 'lenai',
      model: 'stub-deployment',
      baseUrl: stub.baseUrl,
      apiKey: secret,
    },
  });
  expect(response.ok()).toBe(true);
  await openAgentPage(page, 'insights-lead', 'Elena');
  await page.getByTestId('agent-tab-model').click();
  await expect(page.getByTestId('llm-API key')).toContainText('Set');
  await expect(page.getByTestId('llm-API key')).not.toContainText('Not set');
  expect(await page.content()).not.toContain(secret);
  await evidence(page, '1.14.8', 'agent-llm-config-key-set.png');
});

test('editing the Job Description in place saves a draft with the link', async ({
  page,
}) => {
  await createSkill(page, {
    name: FISCAL,
    description: FISCAL_DESCRIPTION,
    body: 'Our fiscal year starts on 1 July.',
  });
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openAgentPage(page, id, HISTORIAN);
  await expect(page.getByTestId('agent-panel-chat')).toBeVisible();
  await expect(page.getByTestId('agent-panel-chat')).toContainText(
    'Try the draft',
  );

  await page.getByTestId('agent-tab-prompt').click();
  const core = page.getByTestId('agent-core-prompt');
  await expect(core.locator('summary')).toHaveText(
    "Elena's core prompt (fixed)",
  );
  await expect(core).not.toHaveAttribute('open', /.*/);
  // The job description reads as a CV first: its words under Profile.
  await expect(page.getByTestId('agent-cv-section-profile')).toHaveText(
    /Profile\s*Answer in one sentence\./,
  );

  await page.getByTestId('prompt-edit').click();
  await expect(
    page.getByText(
      'Type / to link a skill or tool. The agent persona only gets the skills and tools its instructions link.',
    ),
  ).toBeVisible();
  await expect(page.getByTestId('prompt-save')).toBeDisabled();
  const editor = page.getByRole('textbox', { name: 'Job description' });
  await linkFromMenu(page, editor, ' /fis', FISCAL);
  await expect(
    page.getByTestId('prompt-links').locator(`[data-link="skill:${FISCAL}"]`),
  ).toHaveText(FISCAL);
  await evidence(page, '1.14.9', 'agent-system-prompt-editing.png');

  await page.getByTestId('prompt-save').click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await expect(page.getByTestId('agent-detail-status')).toContainText(
    'Unpublished changes',
  );
  await page.getByTestId('agent-tab-skills').click();
  await expect(page.getByTestId(`agent-skill-linked-${FISCAL}`)).toHaveText(
    'Linked',
  );
});

test('a broken link disables Save job description', async ({ page }) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openAgentPage(page, id, HISTORIAN);
  await page.getByTestId('agent-tab-prompt').click();
  await page.getByTestId('prompt-edit').click();
  const editor = page.getByRole('textbox', { name: 'Job description' });
  await typeAtEnd(page, editor, '[[skill:gone]]');
  await expect(page.getByTestId('prompt-link-error')).toHaveText(
    'No skill named gone. Remove the link or create the skill on the Skills tab.',
  );
  await expect(page.getByTestId('prompt-save')).toBeDisabled();

  for (let i = 0; i < '[[skill:gone]]'.length; i += 1) {
    await page.keyboard.press('Backspace');
  }
  await expect(editor).toHaveText('Answer in one sentence.');
  await expect(page.getByTestId('prompt-link-error')).toHaveCount(0);
  await expect(page.getByTestId('prompt-save')).toBeDisabled();
});

test('leaving an unsaved Job Description edit asks first', async ({ page }) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openAgentPage(page, id, HISTORIAN);
  await page.getByTestId('agent-tab-prompt').click();
  await page.getByTestId('prompt-edit').click();
  const editor = page.getByRole('textbox', { name: 'Job description' });
  await typeAtEnd(page, editor, ' Be brief.');

  let message = '';
  page.once('dialog', (dialog) => {
    message = dialog.message();
    void dialog.dismiss();
  });
  await button(page, 'All agent personas').click();
  await expect.poll(() => message).toBe('Discard unsaved changes?');
  await expect(
    page.getByRole('heading', { name: HISTORIAN, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('prompt-editing')).toBeVisible();
  await expect(editor).toHaveText('Answer in one sentence. Be brief.');
});

test('@demo @story-1.23.23 Try it runs the draft, not the Live version', async ({
  page,
}) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);

  await test.step('Given the Live agent persona "Cup historian" answers in one sentence', async () => {
    const agent = await apiJson<{ live: { instructions: string } }>(
      page,
      'GET',
      `/agents/${id}`,
    );
    expect(agent.live.instructions).toBe('Answer in one sentence.');
  });
  await test.step("When I edit the draft's instructions in the agent persona editor", async () => {
    await openEditor(page, id, HISTORIAN);
    await instructionsField(page).fill('Talk like a pirate.');
  });
  await test.step('And I click Try it and run "Who won in 2014?"', async () => {
    await page.getByTestId('agent-try-it').click();
    await tryInPanel(page, 'Who won in 2014?');
    await expectAnswers(detailsPanel(page), 1);
  });
  await test.step("Then the recorded request carries the draft's instructions block", async () => {
    const systems = systemsFor('Who won in 2014?');
    expect(systems).toContain(AGENT_BLOCK_START);
    expect(systems).toContain('Talk like a pirate.');
    expect(systems).not.toContain('Answer in one sentence.');
  });
  await test.step('And the Live version is unchanged', async () => {
    const agent = await apiJson<{ live: { instructions: string } }>(
      page,
      'GET',
      `/agents/${id}`,
    );
    expect(agent.live.instructions).toBe('Answer in one sentence.');
    expect(await storedRuns(page)).toEqual([]);
  });
});

test('the Try it tab runs the draft, and Reset starts over', async ({
  page,
}) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openAgentPage(page, id, HISTORIAN);
  const tab = page.getByTestId('agent-panel-chat');
  await expect(tab).toContainText('Try the draft');
  await expect(tab.getByTestId('agent-tryit-reset')).toHaveText('Reset');

  await tab.getByTestId('agent-tryit-question').fill('Who won in 2014?');
  await tab.getByTestId('agent-tryit-run').click();
  await expectAnswers(tab, 1);
  const systems = systemsFor('Who won in 2014?');
  expect(systems).toContain(AGENT_BLOCK_START);
  expect(systems).toContain('Answer in one sentence.');
  expect(await listedSessions(page)).not.toContain(HISTORIAN);
  expect(await storedRuns(page)).toEqual([]);
  await evidence(page, '1.14.9', 'agent-try-it-answer.png');

  await tab.getByTestId('agent-tryit-reset').click();
  await expect(tab.getByTestId('agent-tryit-question')).toHaveValue('');
  await expect(tab.getByText(STUB_ANSWER)).toHaveCount(0);

  await button(page, 'All agent personas').click();
  await openAgentPage(page, id, HISTORIAN);
  await expect(tab.getByTestId('agent-tryit-question')).toHaveValue('');
  await expect(tab.getByText(STUB_ANSWER)).toHaveCount(0);
});

test('Try it needs a dataset', async ({ page }) => {
  const id = await createUserAgent(page, { name: 'Empty historian' });
  await openAgentPage(page, id, 'Empty historian');
  await expect(page.getByTestId('agent-tryit-no-dataset')).toContainText(
    'Add a dataset to this agent persona to try it.',
  );
  await expect(page.getByTestId('agent-tryit-edit')).toHaveText('Edit');
});

test('an Official agent has no Try it tab and opens on Job Description', async ({
  page,
}) => {
  await openAgentPage(page, 'insights-lead', 'Elena');
  await expect(page.getByTestId('agent-tab-prompt')).toBeVisible();
  await expect(page.getByTestId('agent-tab-chat')).toHaveCount(0);
  await expect(page.getByTestId('agent-panel-chat')).toHaveCount(0);
  await expect(page.getByTestId('agent-prompt-view')).toBeVisible();
});

test('the Skills tab shows what is linked and creates a skill inline', async ({
  page,
}) => {
  await createSkill(page, {
    name: FISCAL,
    description: FISCAL_DESCRIPTION,
    body: 'Our fiscal year starts on 1 July.',
  });
  await createSkill(page, {
    name: CHART_STYLE,
    description: 'Use when drawing a chart.',
    body: 'Look at real values with [[tool:sample_rows]] before charting.',
  });
  const id = await createUserAgent(page, {
    name: 'Finance helper',
    instructions: `Use [[skill:${FISCAL}]] for dates.`,
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openAgentPage(page, id, 'Finance helper');
  await page.getByTestId('agent-tab-skills').click();

  await expect(page.getByTestId(`agent-skill-linked-${FISCAL}`)).toHaveText(
    'Linked',
  );
  await expect(
    page.getByTestId(`agent-skill-linked-${CHART_STYLE}`),
  ).toHaveText('Not linked');
  await expect(
    page.getByTestId(`agent-skill-row-${CHART_STYLE}`),
  ).toContainText('sample_rows');
  await expect(
    page.getByText('Built-in · included in every agent persona'),
  ).toBeVisible();
  await evidence(page, '1.14.9', 'agent-skills-tab-linked.png');

  await page.getByTestId('agent-skill-new').click();
  const form = page.getByTestId('agent-skill-form');
  await form.getByLabel('Name', { exact: true }).fill('fy-rules');
  await form
    .getByLabel('Description', { exact: true })
    .fill(FISCAL_DESCRIPTION);
  const body = form.getByRole('textbox', { name: 'Body', exact: true });
  await typeAtEnd(page, body, 'The fiscal year starts on 1 July.');
  await page.getByTestId('agent-skill-save').click();
  await expect(page.getByText('Skill "fy-rules" created')).toBeVisible();
  await expect(page.getByTestId('agent-skill-linked-fy-rules')).toHaveText(
    'Not linked',
  );
  await expect(form).toHaveCount(0);
  await expect(page.getByTestId('agent-skill-new')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Finance helper', exact: true }),
  ).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('agent-skill-delete-fy-rules').click();
  await expect(page.getByTestId('agent-skill-row-fy-rules')).toHaveCount(0);
});

test('@demo @story-1.25.11 Try it shows the evidence of its answer in the query inspector', async ({
  page,
}) => {
  const question = 'How many matches were played?';
  const sql = `SELECT MAX(0) + 4321 AS matches_played FROM ${worldCupKey('matches')}`;
  stub.reply = (request) =>
    request.messages[request.messages.length - 1]?.role === 'tool'
      ? { text: 'The data holds 4,321 matches played.' }
      : {
          toolCall: {
            name:
              request.tools.find((tool) => tool.endsWith('run_readonly_sql')) ??
              'run_readonly_sql',
            arguments: { sql, rationale: 'Counting the matches played.' },
          },
        };
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer from the data with [[tool:run_readonly_sql]].',
    datasets: [WORLD_CUP_DATASET],
  });
  const answer = detailsPanel(page).getByTestId('agent-tryit-answer');
  const sheet = page.getByTestId('query-inspector-sheet');

  await test.step('Given a draft user agent persona "Cup historian" over "World Cup Core" in its editor', async () => {
    await openEditor(page, id, HISTORIAN);
    await page.getByTestId('agent-try-it').click();
  });
  await test.step('When I run "How many matches were played?" in Try it', async () => {
    await tryInPanel(page, question);
    await expect(answer).toContainText('The data holds 4,321');
  });
  await test.step('Then the answer shows a numbered source on a figure, the coverage line and the query row with its coverage chip', async () => {
    await expect(answer.getByTestId('figure-ref').first()).toHaveText('1');
    await expect(answer.getByTestId('query-coverage-line')).toBeVisible();
    await expect(answer.getByTestId('query-row-0')).toBeVisible();
    await expect(answer.getByTestId('query-coverage-chip')).toHaveCount(1);
  });
  await test.step('When I open the query from its row', async () => {
    await answer.getByTestId('query-row-0').click();
    await expect(sheet).toBeVisible();
  });
  await test.step('Then the sheet is in the main column and does not overlap the Details panel', async () => {
    const box = await sheet.boundingBox();
    const panel = await detailsPanel(page).boundingBox();
    expect(box).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(panel!.x + 1);
    expect(box!.width).toBeLessThanOrEqual(720);
  });
  await test.step("And the inspector's header shows Source 1 of 1 and its steps start from a table and end with Show", async () => {
    await expect(page.getByTestId('query-inspector-position')).toHaveText(
      'Source 1 of 1',
    );
    const steps = page.getByTestId('query-funnel-step');
    await expect(steps.first()).toHaveAttribute('data-verb', 'start');
    await expect(steps.last()).toHaveAttribute('data-verb', 'show');
  });
  await test.step('When I switch to Result and to SQL', async () => {
    await page.getByTestId('query-inspector-tab-result').click();
    await expect(page.getByTestId('query-result-table')).toContainText('4321');
    await page.getByTestId('query-inspector-tab-sql').click();
    await expect(page.getByTestId('query-sql')).toContainText('4321');
  });
  await test.step('And I press Escape', async () => {
    await page.keyboard.press('Escape');
  });
  await test.step('Then the sheet closes and the focus is back on the query row', async () => {
    await expect(sheet).toHaveCount(0);
    await expect(answer.getByTestId('query-row-0')).toBeFocused();
  });
  await test.step('When I open the query again and run the draft again', async () => {
    await answer.getByTestId('query-row-0').click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await answer.getByTestId('query-row-0').click();
    await expect(sheet).toBeVisible();
    await detailsPanel(page).getByTestId('agent-tryit-run').click();
  });
  await test.step('Then the sheet is closed', async () => {
    await expect(sheet).toHaveCount(0);
    await expect(answer).toContainText('The data holds 4,321');
  });
});
