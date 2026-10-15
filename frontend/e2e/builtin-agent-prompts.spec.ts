import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET, openSessions } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import { apiJson } from './helpers/api';
import {
  LlmStub,
  STUB_ANSWER,
  StubRequest,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';

/**
 * Mirrors the Feature "Built-in agent prompts" in
 * specs/capabilities/agents-evals/spec.md (R97-R105, ADR-0026). The model is
 * the recording OpenAI-compatible stub, so the scenarios read the system
 * prompt each request carries. The app is single-user (ADR-0030), so there
 * is no permission to gate the edit on.
 */

const ASSISTANT = 'Questions to Insights Assistant';
const RFP_BUILDER = 'RFP Builder';
const QUESTION = 'Who won in 2022?';
const DONE_LINE = 'Always end an answer with the word Done.';
const BANNER =
  'Changes apply to every session and agent as soon as you save. Run the evals to check them.';
const EVIDENCE = path.resolve(__dirname, '../../evidence/1.14.11');

let stub: LlmStub;

test.beforeEach(async () => {
  stub = await startLlmStub();
});

test.afterEach(async () => {
  await stub.close();
});

/** Opens a built-in agent's page from the hub (System agents sit behind "Show more"). */
async function openAgent(page: Page, key: string, name: string) {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
  if (!['assistant', 'rfp'].includes(key)) {
    await page.getByTestId('agent-show-more-system').click();
  }
  await page.getByTestId(`agent-${key}`).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function openPromptTab(page: Page): Promise<void> {
  await page.getByTestId('agent-tab-prompt').click();
  await expect(
    page
      .getByTestId('agent-prompt-view')
      .or(
        page.getByText(
          'This agent builds its prompt at request time, so there is no static template to show.',
        ),
      ),
  ).toBeVisible();
}

const modifiedChip = (page: Page) => page.getByTestId('agent-prompt-modified');
const saveButton = (page: Page) => page.getByTestId('agent-prompt-save');

/** The Tiptap editor of an Official agent's prompt. */
function promptEditor(page: Page): Locator {
  return page.getByRole('textbox', { name: 'System prompt', exact: true });
}

async function startEditing(page: Page): Promise<void> {
  await page.getByTestId('agent-prompt-edit').click();
  await expect(page.getByTestId('agent-prompt-editing')).toBeVisible();
}

/**
 * Puts the caret after the last character of the link editor. A click lands
 * mid-prompt and Ctrl+End does not always reach the end of a long document,
 * so the DOM selection is set directly; ProseMirror follows it.
 */
async function caretAtEnd(page: Page): Promise<void> {
  const editor = promptEditor(page);
  await expect(editor).toBeVisible();
  await editor.focus();
  await editor.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.lastElementChild ?? element);
    range.collapse(false);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

/** Types `text` at the very end of the link editor. */
async function appendToEditor(page: Page, text: string, newLine = false) {
  await caretAtEnd(page);
  if (newLine) await page.keyboard.press('Enter');
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
}

/** The `prompt` view of a built-in agent's detail (api.md 34). */
async function promptView(page: Page, key: string) {
  const agent = await apiJson<{
    prompt?: { modified: boolean; editable: string };
  }>(page, 'GET', `/agents/${key}`);
  return agent.prompt!;
}

/** Creates a World Cup session named `name` from "Start New Conversation". */
async function newSession(page: Page, name: string): Promise<void> {
  await openSessions(page);
  await page
    .locator('header')
    .getByRole('button', { name: 'Start New Conversation' })
    .click();
  await page.getByPlaceholder('My new session').fill(name);
  await page
    .getByRole('button', { name: new RegExp(WORLD_CUP_DATASET) })
    .click();
  await page.getByRole('button', { name: /^Create$/ }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Asks `question` in a new session; returns the turn's first model request. */
async function askInNewSession(
  page: Page,
  sessionName: string,
  question: string,
): Promise<StubRequest> {
  await newSession(page, sessionName);
  const from = stub.requests.length;
  await page.getByPlaceholder('Ask a follow-up question…').fill(question);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(STUB_ANSWER)).toBeVisible();
  const request = stub.requests.slice(from).find((r) => r.stream);
  expect(request, `a streamed call for "${question}"`).toBeDefined();
  return request!;
}

async function seedChat(page: Page): Promise<void> {
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
}

test("I edit the assistant's prompt, and Reset restores it", async ({
  page,
}) => {
  await seedChat(page);
  await openAgent(page, 'assistant', ASSISTANT);
  await openPromptTab(page);
  await expect(
    page.getByText('Built-in', { exact: true }).first(),
  ).toBeVisible();
  await expect(modifiedChip(page)).toHaveCount(0);

  await startEditing(page);
  await expect(page.getByTestId('agent-prompt-banner')).toHaveText(BANNER);
  await expect(
    page
      .getByTestId('agent-prompt-editing')
      .getByTestId('agent-prompt-tools-note'),
  ).toHaveText(
    'The ## Tools list is generated from the tools the assistant gets and is inserted before ## Working rules.',
  );
  await appendToEditor(page, DONE_LINE, true);
  await saveButton(page).click();
  await expect(
    page.getByText(`System prompt of "${ASSISTANT}" saved`),
  ).toBeVisible();
  await expect(modifiedChip(page)).toBeVisible();
  await page
    .getByRole('button', { name: 'All agents' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(EVIDENCE, 'assistant-system-prompt-modified.png'),
  });

  const edited = systemTexts(
    await askInNewSession(page, 'Prompt override', QUESTION),
  )[0];
  expect(edited).toContain(DONE_LINE);
  expect(
    (await promptView(page, 'assistant')).editable.endsWith(`\n${DONE_LINE}`),
  ).toBe(true);
  expect(edited).toContain('\n## Tools\n');

  await openAgent(page, 'assistant', ASSISTANT);
  await openPromptTab(page);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('agent-prompt-reset').click();
  await expect(
    page.getByText(`System prompt of "${ASSISTANT}" reset`),
  ).toBeVisible();
  await expect(modifiedChip(page)).toHaveCount(0);

  const reset = systemTexts(
    await askInNewSession(page, 'Prompt reset', QUESTION),
  )[0];
  expect(reset).not.toContain(DONE_LINE);
});

test("a System agent's prompt is edited in a text area, with no link menu", async ({
  page,
}) => {
  await openAgent(page, 'sql-fixer', 'SQL Fixer');
  await openPromptTab(page);
  await startEditing(page);

  const area = page.getByTestId('agent-prompt-textarea');
  await expect(area).toBeVisible();
  await expect(page.getByTestId('agent-prompt-count')).toHaveText(
    /^[\d,]+\/20,000$/,
  );
  await expect(page.getByText('+ Link tool')).toHaveCount(0);
  await expect(page.getByText('+ Link skill')).toHaveCount(0);
  await expect(page.getByTestId('link-any')).toHaveCount(0);

  await area.fill(`${await area.inputValue()} [[tool:sample_rows]]`);
  await saveButton(page).click();
  await expect(
    page.getByText("This agent's prompt can't contain links"),
  ).toBeVisible();
  await expect(modifiedChip(page)).toHaveCount(0);
  expect((await promptView(page, 'sql-fixer')).modified).toBe(false);
});

test("a skill link in the assistant's prompt is refused", async ({ page }) => {
  await openAgent(page, 'assistant', ASSISTANT);
  await openPromptTab(page);
  await startEditing(page);

  await appendToEditor(page, ' [[skill:sql-style]]');
  await saveButton(page).click();
  await expect(
    page.getByText(
      'Only built-in skills can be linked here: this prompt is shared by every user',
    ),
  ).toBeVisible();
  await expect(modifiedChip(page)).toHaveCount(0);
  expect((await promptView(page, 'assistant')).modified).toBe(false);
});

test('the shipped assistant prompt shows its tools and skill as chips and the model reads plain mentions', async ({
  page,
}) => {
  await seedChat(page);
  await openAgent(page, 'assistant', ASSISTANT);
  await openPromptTab(page);

  const view = page.getByTestId('agent-prompt-view');
  for (const tool of ['ask_clarification', 'run_readonly_sql']) {
    await expect(view.locator(`[data-link="tool:${tool}"]`).first()).toHaveText(
      tool,
    );
    await expect(
      view.locator(`[data-link="tool:${tool}"]`).first(),
    ).toHaveClass(/chip-neutral/);
  }
  const skill = view.locator('[data-link="skill:curated-knowledge"]').first();
  await expect(skill).toHaveText('curated-knowledge');
  await expect(skill).toHaveClass(/chip-info/);
  await expect(page.getByTestId('agent-prompt-tools-note')).toHaveText(
    '## Tools — generated from the tools the assistant gets',
  );
  await expect(view).not.toContainText('[[');
  // The end of the prompt, with its chips and the generated-Tools note.
  await page.getByTestId('agent-prompt-tools-note').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(EVIDENCE, 'assistant-system-prompt-chips.png'),
  });

  const request = await askInNewSession(page, 'Plain mentions', QUESTION);
  const prompt = systemTexts(request)[0];
  expect(prompt).toContain('Call the "ask_clarification" tool only when');
  for (const text of systemTexts(request)) expect(text).not.toContain('[[');
});

test("a built-in skill link in the assistant's prompt is accepted", async ({
  page,
}) => {
  await openAgent(page, 'assistant', ASSISTANT);
  await openPromptTab(page);
  await startEditing(page);

  await appendToEditor(page, ' [[skill:curated-knowledge]]');
  await saveButton(page).click();
  await expect(
    page.getByText(`System prompt of "${ASSISTANT}" saved`),
  ).toBeVisible();
  await expect(modifiedChip(page)).toBeVisible();
});

test('the shipped RFP Builder prompt shows its tools and skill as chips and in the Graph tab', async ({
  page,
}) => {
  await openAgent(page, 'rfp', RFP_BUILDER);
  await openPromptTab(page);

  const view = page.getByTestId('agent-prompt-view');
  for (const tool of ['get_rfp', 'update_rfp']) {
    await expect(
      view.locator(`[data-link="tool:${tool}"]`).first(),
    ).toHaveClass(/chip-neutral/);
  }
  await expect(
    view.locator('[data-link="skill:rfp-client-renewal"]').first(),
  ).toHaveClass(/chip-info/);
  await expect(page.getByTestId('agent-prompt-tools-note')).toHaveText(
    '## Tools — generated from the tools the RFP Builder gets',
  );
  await expect(view).not.toContainText('[[');

  await page.getByTestId('agent-tab-graph').click();
  const graph = page.getByTestId('agent-graph');
  await expect(graph).toBeVisible();
  const edges = graph.locator('desc');
  await expect(edges).toContainText(
    'The instructions link the rfp-client-renewal skill.',
  );
  await expect(edges).toContainText('The instructions link the get_rfp tool.');
  await expect(edges).toContainText(
    'The rfp-client-renewal skill links the list_clients tool.',
  );
  const detail = await apiJson<{ toolDetails: { name: string }[] }>(
    page,
    'GET',
    '/agents/rfp',
  );
  const tools = detail.toolDetails.map((tool) => tool.name);
  expect(tools.length).toBeGreaterThan(0);
  for (const tool of tools) {
    await expect(page.getByTestId(`graph-node-tool:${tool}`)).toHaveAttribute(
      'aria-label',
      `${tool}, Tool · always on`,
    );
  }
  await expect(
    page.getByText('This agent has no links: it gets all of its tools.'),
  ).toHaveCount(0);
});

test("the RFP Builder's prompt links only its own tools and skill", async ({
  page,
}) => {
  await openAgent(page, 'rfp', RFP_BUILDER);
  await openPromptTab(page);
  await startEditing(page);

  await caretAtEnd(page);
  await page.keyboard.type(' /');
  const menu = page.getByRole('listbox');
  await expect(menu).toBeVisible();
  // The menu lists up to 6 entries of each kind and narrows as you type
  // (ui.md 4.5.5), so each name is looked up by what follows the "/".
  await expect(
    menu.getByRole('option', { name: /^rfp-carriers/ }),
  ).toBeVisible();
  await expect(
    menu.getByRole('option', { name: /run_readonly_sql/ }),
  ).toHaveCount(0);
  await page.keyboard.type('list_cl');
  await expect(
    menu.getByRole('option', { name: /^list_clients/ }),
  ).toBeVisible();
  for (let i = 0; i < 'list_cl'.length; i++) {
    await page.keyboard.press('Backspace');
  }
  await page.keyboard.type('run_readonly');
  await expect(
    page.getByRole('option', { name: /run_readonly_sql/ }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (let i = 0; i < ' /run_readonly'.length; i++) {
    await page.keyboard.press('Backspace');
  }

  const toolLink = '[[tool:run_readonly_sql]]';
  await page.keyboard.type(toolLink);
  await saveButton(page).click();
  await expect(page.getByText('Unknown tool "run_readonly_sql"')).toBeVisible();

  await caretAtEnd(page);
  for (let i = 0; i < toolLink.length; i++) {
    await page.keyboard.press('Backspace');
  }
  await page.keyboard.type('[[skill:curated-knowledge]]');
  await saveButton(page).click();
  await expect(
    page.getByText(
      "Only the RFP Builder's own skills can be linked here: this prompt is shared by every user",
    ),
  ).toBeVisible();
  await expect(modifiedChip(page)).toHaveCount(0);
  expect((await promptView(page, 'rfp')).modified).toBe(false);
});
