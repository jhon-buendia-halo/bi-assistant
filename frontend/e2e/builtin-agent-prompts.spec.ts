import path from 'node:path';
import type { Locator, Page } from '@playwright/test';
import axe from 'axe-core';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { followOsTheme } from './helpers/app-actions';
import { runQuestionOk } from './helpers/runs-api';
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

/** The built-in agents' persona names, which the hub and their page show. */
const ASSISTANT = 'Emily';
const V2_KEY = 'assistant-v2';
const V2 = 'Michael';
const V2_TOOLS = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'ask_clarification',
];
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
  // A run sent through the API leaves the page where it was: go back to the hub first.
  const back = page.getByRole('button', { name: 'All agents' });
  if (await back.isVisible()) await back.click();
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
  if (!['assistant', V2_KEY].includes(key)) {
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
  return page.getByRole('textbox', { name: 'Job description', exact: true });
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

/**
 * Runs Questions to Insights v2 on `question`; returns the turn's first model
 * request.
 */
async function askInRun(page: Page, question: string): Promise<StubRequest> {
  const from = stub.requests.length;
  const result = await runQuestionOk(page, question);
  expect(result.text).toContain(STUB_ANSWER);
  // The analysis turn's call, not v2's structured Plan or Write answer call.
  const request = stub.requests.slice(from).find((r) => r.stream && r.step === undefined);
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
    `The ## Tools list is generated from the tools ${ASSISTANT} gets and is inserted before ## Working rules.`,
  );
  await appendToEditor(page, DONE_LINE, true);
  await saveButton(page).click();
  await expect(
    page.getByText(`Job description of "${ASSISTANT}" saved`),
  ).toBeVisible();
  await expect(modifiedChip(page)).toBeVisible();
  await page
    .getByRole('button', { name: 'All agents' })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(EVIDENCE, 'assistant-system-prompt-modified.png'),
  });

  // The assistant can no longer be run: the saved override is read back.
  expect(
    (await promptView(page, 'assistant')).editable.endsWith(`\n${DONE_LINE}`),
  ).toBe(true);

  await openAgent(page, 'assistant', ASSISTANT);
  await openPromptTab(page);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('agent-prompt-reset').click();
  await expect(
    page.getByText(`Job description of "${ASSISTANT}" reset`),
  ).toBeVisible();
  await expect(modifiedChip(page)).toHaveCount(0);
  expect((await promptView(page, 'assistant')).modified).toBe(false);
});

test("I edit Questions to Insights v2's prompt, its runs read it, and Reset restores it", async ({
  page,
}) => {
  // Given the World Cup dataset and the stub model.
  await seedChat(page);
  // When I add a line to v2's prompt on its page and save.
  await openAgent(page, V2_KEY, V2);
  await openPromptTab(page);
  await expect(modifiedChip(page)).toHaveCount(0);
  await startEditing(page);
  await expect(page.getByTestId('agent-prompt-banner')).toHaveText(BANNER);
  await expect(
    page
      .getByTestId('agent-prompt-editing')
      .getByTestId('agent-prompt-tools-note'),
  ).toHaveText(
    `The ## Tools list is generated from the tools ${V2} gets and is inserted before ## Working rules.`,
  );
  await appendToEditor(page, DONE_LINE, true);
  await saveButton(page).click();
  await expect(page.getByText(`Job description of "${V2}" saved`)).toBeVisible();
  await expect(modifiedChip(page)).toBeVisible();

  // Then a run of Questions to Insights v2 sends the edited prompt.
  const edited = systemTexts(await askInRun(page, QUESTION))[0];
  expect(edited.startsWith('You are Questions to Insights v2')).toBe(true);
  expect(edited).toContain(DONE_LINE);
  expect(edited).toContain('\n## Tools\n');
  expect(
    (await promptView(page, V2_KEY)).editable.endsWith(`\n${DONE_LINE}`),
  ).toBe(true);

  // When I reset it, Then the next run sends the shipped prompt again.
  await openAgent(page, V2_KEY, V2);
  await openPromptTab(page);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('agent-prompt-reset').click();
  await expect(page.getByText(`Job description of "${V2}" reset`)).toBeVisible();
  await expect(modifiedChip(page)).toHaveCount(0);

  const reset = systemTexts(await askInRun(page, QUESTION));
  expect(reset[0]).not.toContain(DONE_LINE);
  // The model reads plain text: no link syntax reaches it.
  for (const text of reset) expect(text).not.toContain('[[');
});

test("a System agent's prompt is edited in a text area, with no link menu", async ({
  page,
}) => {
  await openAgent(page, 'sql-fixer', 'David');
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

test('the shipped assistant prompt shows its tools and skill as chips', async ({
  page,
}) => {
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
    `## Tools — generated from the tools ${ASSISTANT} gets`,
  );
  await expect(view).not.toContainText('[[');
  // The end of the prompt, with its chips and the generated-Tools note.
  await page.getByTestId('agent-prompt-tools-note').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(EVIDENCE, 'assistant-system-prompt-chips.png'),
  });
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
    page.getByText(`Job description of "${ASSISTANT}" saved`),
  ).toBeVisible();
  await expect(modifiedChip(page)).toBeVisible();
});

const workflowStep = (page: Page, id: string) =>
  page.getByTestId(`workflow-step-${id}`);

test(
  "Questions to Insights v2's Graph tab draws what happens on each message",
  { tag: ['@demo', '@story-1.23.1'] },
  async ({ page }) => {
    await scenarioStep(page, `When I open the "${V2}" agent`, async () => {
      await openAgent(page, V2_KEY, V2);
    });
    await scenarioStep(page, 'And I open the Graph tab', async () => {
      await page.getByTestId('agent-tab-graph').click();
      await expect(page.getByTestId('agent-workflow')).toBeVisible();
    });
    await scenarioStep(
      page,
      'Then I see "What happens on each message" with its eight steps from "Receive question" to "Wrap up", numbered 1 to 8',
      async () => {
        await expect(
          page.getByRole('heading', { name: 'What happens on each message' }),
        ).toHaveCount(1);
        await expect(
          page.getByTestId('agent-workflow').getByTestId('workflow-step-title'),
        ).toHaveText([
          'Receive question',
          'Load catalog',
          'Plan',
          'Clarify',
          'Analyse',
          'Validate',
          'Write answer',
          'Wrap up',
        ]);
        await expect(workflowStep(page, 'wrap-up')).toHaveAccessibleName(
          /^Step 8: Wrap up/,
        );
      },
    );
    await scenarioStep(
      page,
      'And "Analyse" is marked "LLM" and shows "list_entities", "describe_entity", "sample_rows", "run_readonly_sql", "ask_clarification" and "≤ 15 steps"',
      async () => {
        const analyse = workflowStep(page, 'analyse');
        await expect(analyse.getByTestId('workflow-step-kind')).toHaveText('LLM');
        await expect(analyse.getByTestId('workflow-step-tool')).toHaveText(
          V2_TOOLS,
        );
        await expect(analyse.getByTestId('workflow-step-loop')).toHaveText(
          '≤ 15 steps',
        );
      },
    );
    await scenarioStep(page, 'And the code steps are marked "Code"', async () => {
      for (const id of ['receive-question', 'load-catalog', 'clarify', 'validate', 'wrap-up']) {
        await expect(
          workflowStep(page, id).getByTestId('workflow-step-kind'),
        ).toHaveText('Code');
      }
    });
    await scenarioStep(
      page,
      'And the arrow from "Load catalog" to "Plan" reads "question, catalog"',
      async () => {
        await expect(page.getByTestId('workflow-edge-load-catalog')).toHaveText(
          /question, catalog/,
        );
        // The arrow sits between the two cards, left to right.
        const [load, edge, plan] = await Promise.all([
          workflowStep(page, 'load-catalog').boundingBox(),
          page.getByTestId('workflow-edge-load-catalog').boundingBox(),
          workflowStep(page, 'plan').boundingBox(),
        ]);
        expect(edge!.x).toBeGreaterThanOrEqual(load!.x + load!.width - 1);
        expect(plan!.x).toBeGreaterThanOrEqual(edge!.x + edge!.width - 1);
      },
    );
    await scenarioStep(
      page,
      `And "Plan", "Analyse" and "Write answer" show "Model error → fails the turn" and "Stop → ends the turn here", "Clarify" shows "Waits for an answer → waits for the user's answer", and "Analyse" also "Clarifying question → waits for the user's answer"`,
      async () => {
        // "Receive question" has no exit: its input is checked before the run.
        // Clarify pauses the run until the user answers.
        const fails = 'Model error → fails the turn';
        const stops = 'Stop → ends the turn here';
        await expect(page.getByTestId('workflow-step-exit')).toHaveText([
          fails,
          stops,
          "Waits for an answer → waits for the user's answer",
          fails,
          stops,
          "Clarifying question → waits for the user's answer",
          fails,
          stops,
        ]);
      },
    );
    await scenarioStep(page, 'When I click the "Load catalog" step', async () => {
      await workflowStep(page, 'load-catalog').click();
      await expect(workflowStep(page, 'load-catalog')).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    await scenarioStep(
      page,
      'Then the step details show Input "question, datasets" and Output "question, catalog, columns"',
      async () => {
        const details = page.getByTestId('workflow-step-details');
        await expect(details).toContainText('2. Load catalog');
        await expect(details.getByTestId('workflow-detail-kind')).toHaveText('Code');
        await expect(details.getByTestId('workflow-detail-input')).toHaveText(
          'question, datasets',
        );
        await expect(details.getByTestId('workflow-detail-output')).toHaveText(
          'question, catalog, columns',
        );
      },
    );
    await scenarioStep(page, 'And I see "Prompt links" with the agent\'s tools', async () => {
      await expect(
        page.getByRole('heading', { name: 'Prompt links' }),
      ).toBeVisible();
      for (const tool of V2_TOOLS) {
        await expect(page.getByTestId(`graph-node-tool:${tool}`)).toBeVisible();
      }
    });
    await scenarioStep(
      page,
      `When I open the "${ASSISTANT}" agent and its Graph tab`,
      async () => {
        // From an agent's detail, its back button returns to the hub.
        await page.getByRole('button', { name: 'All agents' }).click();
        await page.getByTestId('agent-assistant').click();
        await expect(
          page.getByRole('heading', { name: ASSISTANT, exact: true }),
        ).toBeVisible();
        await page.getByTestId('agent-tab-graph').click();
        await expect(page.getByTestId('agent-graph')).toBeVisible();
      },
    );
    await scenarioStep(page, 'Then I do not see the workflow drawing', async () => {
      await expect(page.getByTestId('agent-workflow')).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: 'Prompt links' }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: 'What happens on each message' }),
      ).toBeVisible();
    });
  },
);

test("v2's Graph tab has no detectable accessibility violations in either theme", async ({
  page,
}) => {
  await followOsTheme(page);
  await openAgent(page, V2_KEY, V2);
  await page.getByTestId('agent-tab-graph').click();
  await expect(page.getByTestId('agent-workflow')).toBeVisible();
  await workflowStep(page, 'analyse').click();
  await expect(page.getByTestId('workflow-step-details')).toBeVisible();

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
