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
import {
  apiBase,
  createUserAgent,
  publishAgent,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
import {
  LlmStub,
  STUB_ANSWER,
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
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
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
      .getByRole('navigation', { name: 'Sessions navigation' })
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
