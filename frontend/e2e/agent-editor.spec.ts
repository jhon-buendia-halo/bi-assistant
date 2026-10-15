import fs from 'node:fs';
import path from 'node:path';
import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  followOsTheme,
  openSessions,
} from './helpers/app-actions';
import { DatabaseSync } from 'node:sqlite';
import {
  apiBase,
  createSkill,
  createUserAgent,
  publishAgent,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
import {
  LlmStub,
  STUB_ANSWER,
  StubRequest,
  messageText,
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
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}

async function openNewAgent(page: Page): Promise<void> {
  await openHub(page);
  await button(page, 'New agent').click();
  await expect(
    page.getByRole('heading', { name: 'New agent', exact: true }),
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
  page.getByLabel('Instructions', { exact: true });
const datasetBox = (page: Page, label: string) =>
  page
    .getByRole('group', { name: 'Datasets' })
    .getByRole('checkbox', { name: label, exact: true });
const editorStatus = (page: Page) => page.getByTestId('agent-editor-status');
const detailsPanel = (page: Page) =>
  page.getByRole('complementary', { name: 'Details panel' });
const previewComposer = (page: Page) =>
  detailsPanel(page).getByPlaceholder('Ask a follow-up question…');

async function sendInPreview(page: Page, question: string): Promise<void> {
  await previewComposer(page).fill(question);
  await detailsPanel(page)
    .getByRole('button', { name: 'Send message' })
    .click();
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

function previewWorkspaces(appDataDir: string): string[] {
  const dir = path.join(appDataDir, 'workspaces');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('session-preview-'));
}

test('creates an agent, previews it, publishes it and deletes it', async ({
  page,
}) => {
  await openNewAgent(page);
  await expect(page.getByTestId('agent-save')).toBeDisabled();

  await nameField(page).fill(HISTORIAN);
  await instructionsField(page).fill('Always name the tournament year.');
  await datasetBox(page, WORLD_CUP_DATASET).check();
  await button(page, 'Add starter question').click();
  await page.getByLabel('Starter question 1').fill('Who won in 2014?');
  await page.getByTestId('agent-save').click();
  await expect(
    page.getByText(`Agent "${HISTORIAN}" saved as draft`),
  ).toBeVisible();
  await expect(editorStatus(page)).toContainText('Draft');

  await page.getByTestId('agent-preview').click();
  await expect(detailsPanel(page)).toContainText('Preview');
  await expect(
    detailsPanel(page).getByRole('button', {
      name: 'Who won in 2014?',
      exact: true,
    }),
  ).toBeVisible();
  await sendInPreview(page, 'Who won in 2014?');
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
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(HISTORIAN, { exact: true })).toHaveCount(0);
});

test('editing a Live agent keeps its sessions on the Live version until republished', async ({
  page,
}) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openHub(page);
  await page
    .getByRole('button', { name: `Start chat with ${HISTORIAN}` })
    .click();
  await expect(page.getByText(`Session "${HISTORIAN}" created`)).toBeVisible();

  await openEditor(page, id, HISTORIAN);
  await instructionsField(page).fill('Talk like a pirate.');
  await page.getByTestId('agent-save').click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await expect(editorStatus(page)).toContainText('Live');
  await expect(editorStatus(page)).toContainText('Unpublished changes');

  const openSession = async () => {
    await openSessions(page);
    await page
      .getByRole('navigation', { name: 'Sessions', exact: true })
      .locator('[data-testid^="session-"]')
      .filter({ hasText: HISTORIAN })
      .click();
    await expect(page.getByTestId('session-agent')).toHaveText(HISTORIAN);
  };
  const send = async (question: string) => {
    await page.getByPlaceholder('Ask a follow-up question…').fill(question);
    await page.getByRole('button', { name: 'Send message' }).click();
  };

  await openSession();
  await send('Who won in 2014?');
  await expectAnswers(page, 1);
  expect(systemsFor('Who won in 2014?')).toContain('Answer in one sentence.');
  expect(systemsFor('Who won in 2014?')).not.toContain('Talk like a pirate.');

  await openEditor(page, id, HISTORIAN);
  await page.getByTestId('agent-editor-publish').click();
  await expect(page.getByText(`Agent "${HISTORIAN}" is Live`)).toBeVisible();
  await expect(editorStatus(page)).toContainText('Live');
  await expect(editorStatus(page)).not.toContainText('Unpublished changes');

  await openSession();
  await send('And in 2010?');
  await expectAnswers(page, 2);
  expect(systemsFor('And in 2010?')).toContain('Talk like a pirate.');
});

test('sending in the preview saves the form first', async ({ page }) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await openEditor(page, id, HISTORIAN);
  await page.getByTestId('agent-preview').click();
  await expect(previewComposer(page)).toBeVisible();

  await instructionsField(page).fill('Talk like a pirate.');
  await sendInPreview(page, 'Who won in 2014?');
  await expect(page.getByText('Draft saved')).toBeVisible();
  await expectAnswers(detailsPanel(page), 1);
  const systems = systemsFor('Who won in 2014?');
  expect(systems).toContain('Talk like a pirate.');
  expect(systems).not.toContain('Answer in one sentence.');
});

test('reset and leaving the editor discard the preview', async ({
  page,
  appDataDir,
}) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    datasets: [WORLD_CUP_DATASET],
  });
  await openEditor(page, id, HISTORIAN);
  await page.getByTestId('agent-preview').click();
  await sendInPreview(page, 'Who won in 2014?');
  await expectAnswers(detailsPanel(page), 1);
  expect(previewWorkspaces(appDataDir)).toHaveLength(1);

  await page.getByTestId('agent-preview-reset').click();
  await expect(detailsPanel(page).getByText('Who won in 2014?')).toHaveCount(0);
  await expect(detailsPanel(page).getByText(STUB_ANSWER)).toHaveCount(0);
  await expect.poll(() => previewWorkspaces(appDataDir)).toHaveLength(1);

  await sendInPreview(page, 'And in 2010?');
  await expectAnswers(detailsPanel(page), 1);
  await button(page, 'Back').click();
  await expect(
    page.getByRole('heading', { name: HISTORIAN, exact: true }),
  ).toBeVisible();
  // The agent page's Chat Box holds a preview of its own (R90); leaving the
  // agent page discards it too.
  await button(page, 'All agents').click();
  await expect.poll(() => previewWorkspaces(appDataDir)).toEqual([]);
  expect(await listedSessions(page)).toEqual([]);
});

test('preview needs a dataset, and names must be unique', async ({ page }) => {
  const id = await createUserAgent(page, {
    name: 'Health plan analyst',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);

  await openNewAgent(page);
  await nameField(page).fill(HISTORIAN);
  await page.getByTestId('agent-preview').click();
  await expect(detailsPanel(page)).toContainText(
    'Select at least one dataset to preview',
  );
  await expect(previewComposer(page)).toHaveCount(0);

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
    page.getByRole('heading', { name: 'New agent', exact: true }),
  ).toBeVisible();

  page.once('dialog', (dialog) => void dialog.accept());
  await button(page, 'Back').click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
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
  await expect(datasetBox(page, WORLD_CUP_DATASET)).toBeChecked();
  await expect(datasetBox(page, 'Gone (missing)')).toBeChecked();

  await datasetBox(page, 'Gone (missing)').uncheck();
  await page.getByTestId('agent-save').click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await expect(datasetBox(page, 'Gone (missing)')).toHaveCount(0);

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
  await page.getByTestId('agent-preview').click();
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
// agent page's Chat Box, System Prompt and Skills tabs (BA-222).
// ---------------------------------------------------------------------------

const FISCAL = 'fiscal-calendar';
const FISCAL_DESCRIPTION = 'Use when a question names a fiscal year.';
const CHART_STYLE = 'chart-style';
const OPTIONAL_TOOLS_OFF = [
  'ask_clarification',
  'create_visual',
  'update_visual',
];

/** The agent editor's Instructions field: the Tiptap link editor. */
const instructionsEditor = (page: Page) =>
  page.getByRole('textbox', { name: 'Instructions', exact: true });
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

/** Whether a request is a chat turn whose latest user message is `question`. */
function isTurnFor(request: StubRequest, question: string): boolean {
  const lastUser = request.messages
    .filter((message) => message.role === 'user')
    .at(-1);
  return (
    request.stream &&
    lastUser !== undefined &&
    messageText(lastUser).includes(question)
  );
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
  await datasetBox(page, WORLD_CUP_DATASET).check();
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

  await page.getByTestId('agent-preview').click();
  await sendInPreview(page, 'Who won in 2014?');
  await expectAnswers(detailsPanel(page), 1);
  const request = firstRequest('Who won in 2014?');
  expect(request.tools).toContain('sample_rows');
  for (const tool of OPTIONAL_TOOLS_OFF)
    expect(request.tools).not.toContain(tool);
  expect(systemTexts(request).join('\n')).toContain(
    "You can't ask the user a question back in this session.",
  );

  await button(page, 'Back').click();
  await expect(
    page.getByRole('heading', { name: 'KPI lookup', exact: true }),
  ).toBeVisible();
  await page.getByTestId('agent-tab-tools').click();
  await expect(page.getByTestId('tool-status-sample_rows')).toHaveText(
    'Linked',
  );
  await expect(page.getByTestId('tool-status-create_visual')).toHaveText(
    'Not linked',
  );
  await evidence(page, '1.14.2', 'agent-tools-tab-linked.png');
});

test('a linked skill reaches the preview, and the Live agent keeps its copy', async ({
  page,
}) => {
  await createSkill(page, {
    name: FISCAL,
    description: FISCAL_DESCRIPTION,
    body: 'Our fiscal year starts on 1 July.',
  });
  await openNewAgent(page);
  await nameField(page).fill('Finance helper');
  await datasetBox(page, WORLD_CUP_DATASET).check();
  await linkFromMenu(page, instructionsEditor(page), '/fis', FISCAL);
  await page.getByTestId('agent-save').click();
  await expect(
    page.getByText('Agent "Finance helper" saved as draft'),
  ).toBeVisible();
  await evidence(page, '1.14.6', 'agent-editor-skill-chip.png');

  await page.getByTestId('agent-preview').click();
  await sendInPreview(page, 'What happened in fiscal 2018?');
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

  // The Live agent runs on the copy taken at publish.
  const question = 'When does our fiscal year start?';
  let turn = 0;
  stub.reply = (request) => {
    if (!isTurnFor(request, question)) return { text: STUB_ANSWER };
    turn += 1;
    return turn === 1
      ? { toolCall: { name: 'skill', arguments: { name: FISCAL } } }
      : { text: STUB_ANSWER };
  };
  await page
    .getByRole('button', { name: 'Start chat with Finance helper' })
    .click();
  await expect(
    page.getByText('Session "Finance helper" created'),
  ).toBeVisible();
  await page.getByPlaceholder('Ask a follow-up question…').fill(question);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(STUB_ANSWER)).toBeVisible();
  const last = turnRequests(stub, question).at(-1)!;
  const results = last.messages
    .filter((message) => message.role === 'tool')
    .map(messageText);
  expect(results).toHaveLength(1);
  expect(results[0]).toContain('Our fiscal year starts on 1 July.');
  expect(results[0]).not.toContain('1 April');
});

test("a linked skill's tools come with it", async ({ page }) => {
  await createSkill(page, {
    name: CHART_STYLE,
    description: 'Use when drawing a chart.',
    body: 'Draw every chart with [[tool:create_visual]].',
  });
  await openNewAgent(page);
  await nameField(page).fill('Chart helper');
  await datasetBox(page, WORLD_CUP_DATASET).check();
  await linkFromMenu(page, instructionsEditor(page), '/char', CHART_STYLE);
  await page.getByTestId('agent-save').click();
  await expect(
    page.getByText('Agent "Chart helper" saved as draft'),
  ).toBeVisible();

  await page.getByTestId('agent-preview').click();
  await sendInPreview(page, 'Chart the goals per year.');
  await expectAnswers(detailsPanel(page), 1);
  const request = firstRequest('Chart the goals per year.');
  expect(request.tools).toContain('create_visual');
  expect(request.tools).toContain('update_visual');
  expect(request.tools).not.toContain('sample_rows');

  await button(page, 'Back').click();
  await page.getByTestId('agent-tab-tools').click();
  await expect(page.getByTestId('tool-status-create_visual')).toHaveText(
    'Linked',
  );
  await expect(page.getByTestId('tool-link-create_visual')).toContainText(
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
    /^Tools and skills:\s*sample_rows\s*ask_clarification\s*create_visual$/,
  );
  await expect(lastLine.locator('[data-link]')).toHaveText([
    'sample_rows',
    'ask_clarification',
    'create_visual',
  ]);
  await expect(page.getByTestId('agent-legacy-notice')).toHaveText(
    'Links were added for what this agent had. Save to keep them.',
  );
  await expect(page.getByTestId('agent-save')).toBeEnabled();
});

test('the Graph tab shows the chain from instructions to skill to tool', async ({
  page,
}) => {
  await createSkill(page, {
    name: CHART_STYLE,
    description: 'Use when drawing a chart.',
    body: 'Draw every chart with [[tool:create_visual]].',
  });
  const id = await createUserAgent(page, {
    name: 'Chart helper',
    instructions: `Use [[skill:${CHART_STYLE}]] and [[tool:sample_rows]].`,
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openAgentPage(page, id, 'Chart helper');
  await page.getByTestId('agent-tab-graph').click();

  for (const node of [
    'prompt',
    `skill:${CHART_STYLE}`,
    'tool:create_visual',
    'tool:sample_rows',
  ]) {
    await expect(page.getByTestId(`graph-node-${node}`)).toBeVisible();
  }
  await expect(page.getByTestId('graph-node-prompt')).toContainText(
    'Instructions',
  );
  const graph = page.getByTestId('agent-graph');
  await expect(graph.locator('desc')).toContainText(
    `The instructions link the ${CHART_STYLE} skill`,
  );
  await expect(graph.locator('desc')).toContainText(
    `The ${CHART_STYLE} skill links the create_visual tool`,
  );
  await expect(graph.locator('desc')).not.toContainText(
    'The instructions link the create_visual tool',
  );
  await expect(page.getByText('What happens on each message')).toBeVisible();
  await expect(
    page.getByTestId('graph-node-tool:ask_clarification'),
  ).toHaveCount(0);
  await evidence(page, '1.14.8', 'agent-graph-chain.png');

  await page.getByTestId('graph-show-unlinked').check();
  const unlinked = page.getByTestId('graph-node-tool:ask_clarification');
  await expect(unlinked).toBeVisible();
  await expect(unlinked).toHaveClass(/inactive/);
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
  await openAgentPage(page, 'assistant', 'Questions to Insights Assistant');
  await page.getByTestId('agent-tab-model').click();
  await expect(page.getByTestId('llm-API key')).toContainText('Set');
  await expect(page.getByTestId('llm-API key')).not.toContainText('Not set');
  expect(await page.content()).not.toContain(secret);
  await evidence(page, '1.14.8', 'agent-llm-config-key-set.png');
});

test('editing the System Prompt in place saves a draft with the link', async ({
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
    'Chat with the draft',
  );

  await page.getByTestId('agent-tab-prompt').click();
  const core = page.getByTestId('agent-core-prompt');
  await expect(core.locator('summary')).toHaveText(
    'Assistant core prompt (fixed)',
  );
  await expect(core).not.toHaveAttribute('open', /.*/);
  await expect(page.getByTestId('agent-instructions')).toHaveText(
    'Answer in one sentence.',
  );

  await page.getByTestId('prompt-edit').click();
  await expect(
    page.getByText(
      'Type / to link a skill or tool. The agent only gets the skills and tools its instructions link.',
    ),
  ).toBeVisible();
  await expect(page.getByTestId('prompt-save')).toBeDisabled();
  const editor = page.getByRole('textbox', { name: 'Agent instructions' });
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

test('a broken link disables Save prompt', async ({ page }) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openAgentPage(page, id, HISTORIAN);
  await page.getByTestId('agent-tab-prompt').click();
  await page.getByTestId('prompt-edit').click();
  const editor = page.getByRole('textbox', { name: 'Agent instructions' });
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

test('leaving an unsaved System Prompt edit asks first', async ({ page }) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openAgentPage(page, id, HISTORIAN);
  await page.getByTestId('agent-tab-prompt').click();
  await page.getByTestId('prompt-edit').click();
  const editor = page.getByRole('textbox', { name: 'Agent instructions' });
  await typeAtEnd(page, editor, ' Be brief.');

  let message = '';
  page.once('dialog', (dialog) => {
    message = dialog.message();
    void dialog.dismiss();
  });
  await button(page, 'All agents').click();
  await expect.poll(() => message).toBe('Discard unsaved changes?');
  await expect(
    page.getByRole('heading', { name: HISTORIAN, exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('prompt-editing')).toBeVisible();
  await expect(editor).toHaveText('Answer in one sentence. Be brief.');
});

test('the Chat Box tab chats with the draft, and New chat starts over', async ({
  page,
}) => {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    instructions: 'Answer in one sentence.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  await openAgentPage(page, id, HISTORIAN);
  const chat = page.getByTestId('agent-panel-chat');
  await expect(chat).toContainText('Chat with the draft');
  await expect(chat.getByTestId('agent-chat-new')).toHaveText('New chat');

  await chat
    .getByPlaceholder('Ask a follow-up question…')
    .fill('Who won in 2014?');
  await chat.getByRole('button', { name: 'Send message' }).click();
  await expectAnswers(chat, 1);
  const systems = systemsFor('Who won in 2014?');
  expect(systems).toContain(AGENT_BLOCK_START);
  expect(systems).toContain('Answer in one sentence.');
  expect(await listedSessions(page)).not.toContain(HISTORIAN);
  await evidence(page, '1.14.9', 'agent-chat-box-answer.png');

  await chat.getByTestId('agent-chat-new').click();
  await expect(
    chat.getByPlaceholder('Ask a follow-up question…'),
  ).toBeVisible();
  await expect(chat.getByText(STUB_ANSWER)).toHaveCount(0);
  await expect(chat.getByText('Who won in 2014?')).toHaveCount(0);

  await button(page, 'All agents').click();
  await openAgentPage(page, id, HISTORIAN);
  await expect(
    chat.getByPlaceholder('Ask a follow-up question…'),
  ).toBeVisible();
  await expect(chat.getByText(STUB_ANSWER)).toHaveCount(0);
});

test('the Chat Box needs a dataset', async ({ page }) => {
  const id = await createUserAgent(page, { name: 'Empty historian' });
  await openAgentPage(page, id, 'Empty historian');
  await expect(page.getByTestId('agent-chat-no-dataset')).toContainText(
    'Add a dataset to this agent to chat with it.',
  );
  await expect(page.getByTestId('agent-chat-edit')).toHaveText('Edit');
});

test("the Official agent's Chat Box offers Start chat", async ({ page }) => {
  await openAgentPage(page, 'assistant', 'Questions to Insights Assistant');
  const chat = page.getByTestId('agent-panel-chat');
  await expect(chat).toContainText(
    'Chats with the assistant run over datasets you choose.',
  );
  await expect(chat.getByTestId('agent-chat-start')).toHaveText('Start chat');
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
    body: 'Draw every chart with [[tool:create_visual]].',
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
  ).toContainText('create_visual');
  await expect(
    page.getByText('Built-in · included in every agent'),
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
