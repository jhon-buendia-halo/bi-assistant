import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import { apiJson } from './helpers/api';
import {
  LlmStub,
  StubRequest,
  StubReply,
  messageText,
  startLlmStub,
  turnRequests,
} from './helpers/llm-stub';
import { clarifyingPlan, clearPlan } from './helpers/v2-steps';
import { fillRun } from './helpers/run-ui';
import { worldCupKey } from './helpers/world-cup-db';

/** Mirrors the Feature "Workflows" in specs/capabilities/workflows/spec.md. */

const V2 = 'Answer a Business Question';
const V2_ID = 'qti-v2-turn';
/**
 * Its steps in catalogue order: Plan, then a branch (Clarify waits for the answer),
 * then Analyse and Validate (retried once), Write answer and Wrap up.
 */
const V2_STEP_IDS = [
  ['receive-question', 'Receive question'],
  ['load-catalog', 'Load catalog'],
  ['plan', 'Plan'],
  ['clarify', 'Clarify'],
  ['analyse', 'Analyse'],
  ['validate', 'Validate'],
  ['write-answer', 'Write answer'],
  ['wrap-up', 'Wrap up'],
] as const;
/** The steps a clear question runs: the canvas's main path, left to right. */
const V2_MAIN_STEP_IDS = V2_STEP_IDS.filter(([id]) => id !== 'clarify');
/** The steps a question that needs clarification skips. */
const V2_ANALYSIS_STEP_IDS = ['analyse', 'validate', 'write-answer'] as const;
/** The step titles as the canvas lists them: the main path, then Clarify below it. */
const V2_STEPS = [...V2_MAIN_STEP_IDS.map(([, title]) => title), 'Clarify'];
const V2_STEP_COUNT = `${V2_STEP_IDS.length} steps`;
/** The Official workflows in catalogue order (workflows R1): v2 only. */
const OFFICIAL = [[V2_ID, V2]] as const;

const QUESTION = 'How many matches were played in each stage?';
const ANSWER = 'The stages hold the matches counted by the query.';
const SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  // Background: World Cup data is loaded, the LLM stub is the provider.
  stub = await startLlmStub();
  stub.reply = queryThenAnswer;
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

/** The model queries the World Cup data once with SQL, then answers. */
function queryThenAnswer(request: StubRequest): StubReply {
  if (!request.stream || request.messages.at(-1)?.role === 'tool') {
    return { text: ANSWER };
  }
  return {
    toolCall: {
      name: request.tools.find((tool) => tool.endsWith('run_readonly_sql')) ?? 'run_readonly_sql',
      arguments: { sql: SQL, rationale: 'Counting matches per stage.' },
    },
  };
}

const CHAT_QUESTION = 'Which query did you run, and what did it return?';
const CHAT_ANSWER = 'I counted the matches of each stage with one query.';
const CHAT_SQL = `SELECT COUNT(DISTINCT stage) AS stages FROM ${worldCupKey('matches')}`;

/** The text of a request's last user message. */
function lastUserText(request: StubRequest): string {
  const users = request.messages.filter((message) => message.role === 'user');
  return users.length ? messageText(users[users.length - 1]) : '';
}

/** A model call of the step chat's turn: its last user message is the chat question. */
function isChatTurn(request: StubRequest): boolean {
  return lastUserText(request).includes(CHAT_QUESTION);
}

/**
 * The run as `queryThenAnswer`; a step chat's turn queries once with its
 * own SQL, then answers.
 */
function chatOrRun(request: StubRequest): StubReply {
  if (!isChatTurn(request)) return queryThenAnswer(request);
  if (!request.stream || request.messages.at(-1)?.role === 'tool') {
    return { text: CHAT_ANSWER };
  }
  return {
    toolCall: {
      name: request.tools.find((tool) => tool.endsWith('run_readonly_sql')) ?? 'run_readonly_sql',
      arguments: { sql: CHAT_SQL, rationale: 'Checking the stages again.' },
    },
  };
}

/** The stub fails every model call: the connection drops before a reply. */
function failTheModel(): void {
  stub.hold = (request) =>
    request.stream ? Promise.reject(new Error('model down')) : undefined;
}

/** The provider retries a dropped connection before the step fails. */
const FAILED_RUN_TIMEOUT = 45_000;

function railItem(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

async function openWorkflows(page: Page): Promise<void> {
  await railItem(page, 'Workflows').click();
  await expect(
    page.getByRole('heading', { name: 'Workflows', exact: true }),
  ).toBeVisible();
}

function section(page: Page, id: 'official' | 'mine'): Locator {
  return page.getByTestId(`workflow-section-${id}`);
}

/** The ids of the cards in `scope`, in the order they are shown. */
async function cardIds(scope: Locator): Promise<string[]> {
  const ids = await scope
    .locator('[data-testid^="workflow-card-"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-testid') ?? ''),
    );
  return ids.map((id) => id.slice('workflow-card-'.length));
}

async function openWorkflow(page: Page, id: string, name: string) {
  await page.getByTestId(`workflow-${id}`).click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(name);
}

/** The step titles on the designer's canvas, top to bottom. */
function drawnSteps(page: Page): Locator {
  return page.getByTestId('workflow-canvas').getByTestId('workflow-node-title');
}

/** The right panel of the app shell (app-shell R10). */
function detailsPanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Details panel' });
}

/** The node dialog (ui.md 4.4b). */
function nodeDialog(page: Page): Locator {
  return page.getByTestId('workflow-ndv');
}

/** Double-click a canvas node: its dialog opens. */
async function openNode(page: Page, id: string, title: string): Promise<Locator> {
  await page.getByTestId(`workflow-node-${id}`).dblclick();
  const dialog = nodeDialog(page);
  await expect(dialog.getByTestId('workflow-ndv-title')).toHaveText(title);
  return dialog;
}

/** Open the Tools sub-node's list under an agent step: its tools, the first focused. */
async function openToolsMenu(page: Page, stepId: string): Promise<Locator> {
  await page.getByTestId(`workflow-subnode-${stepId}-tools`).click();
  const menu = page.getByTestId(`workflow-tools-menu-${stepId}`);
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  return menu;
}

/** Pick a tool from an agent step's Tools list: the tool's dialog opens. */
async function openTool(page: Page, stepId: string, tool: string): Promise<Locator> {
  const menu = await openToolsMenu(page, stepId);
  await menu.getByRole('menuitem', { name: tool, exact: true }).click();
  await expect(menu).toHaveCount(0);
  const dialog = nodeDialog(page);
  await expect(dialog.getByTestId('workflow-ndv-title')).toHaveText(tool);
  return dialog;
}

async function closeNode(page: Page): Promise<void> {
  await nodeDialog(page).getByTestId('workflow-ndv-close').click();
  await expect(nodeDialog(page)).toHaveCount(0);
}

/** The Run panel (the Chat) on the right of the canvas and the Logs, which Execute workflow unfolds. */
function runDock(page: Page): Locator {
  return page.getByTestId('workflow-run-dock');
}

/** The Run panel is unfolded on the right of the canvas, with the run form in its Chat. */
async function expectRunPanel(page: Page): Promise<void> {
  await expect(runDock(page).getByRole('heading', { name: 'Run', exact: true })).toBeVisible();
  await expect(runDock(page).getByTestId('workflow-state-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(runDock(page).getByTestId('workflow-run-chat').getByTestId('workflow-run')).toBeVisible();
}

/** The Logs under the canvas. */
function logsDock(page: Page): Locator {
  return page.getByTestId('workflow-logs-dock');
}

/** A node's row in the Logs under the canvas: its state is `data-state`. */
function logRow(page: Page, id: string): Locator {
  return logsDock(page).getByTestId(`workflow-state-node-${id}`);
}

/** New question: drops the run shown and the question, keeps the datasets; types `question`. */
async function newQuestion(page: Page, question: string): Promise<void> {
  await page.getByTestId('workflow-run-new').click();
  await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
  await page.getByTestId('workflow-input-question').fill(question);
}

/** Back to the list from a workflow's page. */
async function backToWorkflows(page: Page): Promise<void> {
  await page.getByTestId('workflow-breadcrumb').click();
  await expect(section(page, 'official')).toBeVisible();
}

/** Picks the World Cup dataset, types `question` and clicks Execute in the panel. */
async function runOnQuestion(page: Page, question: string): Promise<void> {
  await fillRun(page, question, WORLD_CUP_DATASET);
  await page.getByTestId('workflow-run').click();
}

test.describe('Feature: Workflows', () => {
  test(
    'Open a workflow and run it from its page',
    { tag: ['@demo', '@story-1.23.5'] },
    async ({ page }) => {
      await scenarioStep(page, 'When I click "Workflows" on the rail', async () => {
        await openWorkflows(page);
      });
      await scenarioStep(
        page,
        'Then I see only "Answer a Business Question" under Official, and no Mine section',
        async () => {
          await expect(railItem(page, 'Workflows')).toHaveAttribute(
            'aria-current',
            'page',
          );
          const official = section(page, 'official');
          await expect(official.getByTestId(`workflow-card-${V2_ID}`)).toBeVisible();
          expect(await cardIds(official)).toEqual(OFFICIAL.map(([id]) => id));
          for (const [id, name] of OFFICIAL) {
            await expect(official.getByTestId(`workflow-${id}`)).toContainText(
              name,
            );
          }
          await expect(official.getByTestId(`workflow-kind-${V2_ID}`)).toHaveText(
            V2_STEP_COUNT,
          );
          await expect(page.locator('[data-testid^="workflow-card-"]')).toHaveCount(1);
          await expect(section(page, 'mine')).toHaveCount(0);
        },
      );
      await scenarioStep(page, 'When I open "Answer a Business Question"', async () => {
        await openWorkflow(page, V2_ID, V2);
      });
      await scenarioStep(
        page,
        'Then I see its eight steps on the canvas and the agent "Michael" under Agents in its Start node',
        async () => {
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(page.getByTestId('workflow-bar-note')).toHaveCount(0);
          const start = await openNode(page, 'start', 'Start');
          await expect(start.getByTestId('workflow-agent-assistant-v2')).toContainText('Michael');
          await closeNode(page);
          await expect(railItem(page, 'Workflows')).toHaveAttribute(
            'aria-current',
            'page',
          );
        },
      );
      await scenarioStep(page, 'When I click "Execute workflow"', async () => {
        await page.getByTestId('workflow-execute').click();
      });
      await scenarioStep(
        page,
        'Then the Logs are under the canvas, the Run panel is on its right, there is no Details panel and no chat is started',
        async () => {
          await expectRunPanel(page);
          await expect(detailsPanel(page)).toHaveCount(0);
          await expect(page.getByTitle('Expand right panel')).toHaveCount(0);
          const canvasBox = await page.getByTestId('workflow-canvas').boundingBox();
          const dockBox = await runDock(page).boundingBox();
          const logsBox = await logsDock(page).boundingBox();
          expect(dockBox!.x).toBeGreaterThanOrEqual(canvasBox!.x + canvasBox!.width - 1);
          expect(logsBox!.y).toBeGreaterThanOrEqual(canvasBox!.y + canvasBox!.height - 1);
          await expect(page.getByTestId('workflow-start-chat')).toHaveCount(0);
          await expect(railItem(page, 'Workflows')).toHaveAttribute(
            'aria-current',
            'page',
          );
        },
      );
    },
  );

  test("Workflows can't be edited", async ({ page }) => {
    const editing = /^(edit|new|delete|remove|add|move|reorder|duplicate|rename|save)\b/i;
    await test.step('When I open Workflows', async () => {
      await openWorkflows(page);
    });
    await test.step(
      'Then I see no Edit, New, Delete or reorder control on the list',
      async () => {
        const list = page.getByTestId('workflows-page');
        await expect(list.getByTestId(`workflow-card-${V2_ID}`)).toBeVisible();
        await expect(list.getByRole('button', { name: editing })).toHaveCount(0);
        await expect(list.locator('[draggable="true"]')).toHaveCount(0);
      },
    );
    await test.step('When I open "Answer a Business Question"', async () => {
      await openWorkflow(page, V2_ID, V2);
    });
    await test.step(
      'Then I see no Edit, New, Delete or step-reorder control on its page or in its Run panel',
      async () => {
        await expect(drawnSteps(page)).toHaveCount(V2_STEPS.length);
        for (const scope of [
          page.getByTestId('workflow-detail-page'),
          page.getByTestId('workflow-run-chat'),
        ]) {
          await expect(scope).toBeVisible();
          await expect(scope.getByRole('button', { name: editing })).toHaveCount(0);
          await expect(scope.locator('[draggable="true"]')).toHaveCount(0);
          await expect(scope.locator('[contenteditable="true"]')).toHaveCount(0);
        }
      },
    );
  });

  test('Search filters the list', async ({ page }) => {
    await test.step('Given I am on Workflows', async () => {
      await openWorkflows(page);
    });
    const search = page.getByTestId('workflow-search');
    await test.step('When I search for "business"', async () => {
      await expect(search).toHaveAttribute(
        'placeholder',
        'Search workflows by name or description',
      );
      await search.fill('business');
    });
    await test.step('Then only the "Answer a Business Question" card is shown', async () => {
      await expect(page.getByTestId(`workflow-card-${V2_ID}`)).toBeVisible();
      await expect(page.locator('[data-testid^="workflow-card-"]')).toHaveCount(1);
      await expect(section(page, 'mine')).toHaveCount(0);
    });
    await test.step('When I search for "zzz"', async () => {
      await search.fill('zzz');
    });
    await test.step('Then I see "No workflows match "zzz""', async () => {
      await expect(
        page.getByText('No workflows match "zzz"', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-testid^="workflow-card-"]')).toHaveCount(0);
    });
  });
});

/** A run's step row in the Run panel's Logs (workflows R13). */
function runStep(page: Page, id: string): Locator {
  return logRow(page, id);
}

/** Opens Answer a Business Question's page from its card's Run. */
async function openV2FromRun(page: Page): Promise<void> {
  await page.getByTestId(`workflow-run-open-${V2_ID}`).click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(V2);
}

test.describe('Feature: Workflows (run workflows)', () => {
  test(
    'I run Answer a Business Question on a question from its card',
    { tag: ['@demo', '@story-1.23.9'] },
    async ({ page }) => {
      await scenarioStep(page, 'When I open Workflows', async () => {
        await openWorkflows(page);
      });
      await scenarioStep(
        page,
        'Then I see "Answer a Business Question" with "8 steps" and no Start chat',
        async () => {
          const card = page.getByTestId(`workflow-card-${V2_ID}`);
          await expect(card).toBeVisible();
          await expect(page.getByTestId(`workflow-${V2_ID}`)).toContainText(V2);
          await expect(page.getByTestId(`workflow-kind-${V2_ID}`)).toHaveText(
            V2_STEP_COUNT,
          );
          await expect(page.getByTestId(`workflow-start-chat-${V2_ID}`)).toHaveCount(0);
          await expect(card.getByRole('button', { name: /start chat/i })).toHaveCount(0);
          await expect(page.getByTestId(`workflow-run-open-${V2_ID}`)).toHaveAccessibleName(
            `Run ${V2}`,
          );
        },
      );
      await scenarioStep(page, 'When I click its Run', async () => {
        await openV2FromRun(page);
      });
      await scenarioStep(
        page,
        'Then I see its eight steps on the canvas, Execute and no Start chat',
        async () => {
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(page.getByTestId('workflow-detail-kind')).toHaveText(
            V2_STEP_COUNT,
          );
          await expect(page.getByTestId('workflow-execute')).toHaveText('Execute workflow');
          await expect(page.getByTestId('workflow-start-chat')).toHaveCount(0);
          await expect(page.getByTestId('workflow-bar-note')).toHaveCount(0);
        },
      );
      await scenarioStep(page, 'When I click Execute workflow', async () => {
        await page.getByTestId('workflow-execute').click();
      });
      await scenarioStep(
        page,
        'Then the Run panel shows the "Question" input and the datasets to pick',
        async () => {
          await expectRunPanel(page);
          const question = runDock(page).getByLabel('Question', { exact: true });
          await expect(question).toBeVisible();
          // Execute workflow only opens the form and focuses it; nothing ran.
          await expect(question).toBeFocused();
          await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
          await expect(question).toHaveAttribute('placeholder', 'Ask a question about your data');
          await expect(question).toHaveAttribute('aria-required', 'true');
          await expect(
            page.getByTestId('workflow-input-datasets').getByRole('button', { name: WORLD_CUP_DATASET }),
          ).toHaveAttribute('aria-pressed', 'false');
        },
      );
      await scenarioStep(
        page,
        `When I pick "${WORLD_CUP_DATASET}" and type "${QUESTION}"`,
        async () => {
          await fillRun(page, QUESTION, WORLD_CUP_DATASET);
        },
      );
      await scenarioStep(page, 'And I click Execute in the panel', async () => {
        await page.getByTestId('workflow-run').click();
      });
      await scenarioStep(
        page,
        'Then I see "Run succeeded" with every step "Done" but "Clarify", which is "Skipped"',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          for (const [id, title] of V2_MAIN_STEP_IDS) {
            await expect(runStep(page, id)).toContainText(title);
            await expect(runStep(page, id)).toHaveAttribute('data-state', 'done');
          }
          await expect(runStep(page, 'clarify')).toHaveAttribute('data-state', 'skipped');
          // The run is over: the follow-up composer stands in for the form.
          await expect(page.getByTestId('workflow-follow-up-input')).toBeVisible();
          await expect(page.getByTestId('workflow-run')).toHaveCount(0);
          await expect(page.getByTestId('workflow-run-new')).toBeEnabled();
        },
      );
      await scenarioStep(page, "And I see the model's answer", async () => {
        await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
      });
    },
  );

  test(
    'A v2 run plans, analyses, validates and writes its answer',
    { tag: ['@demo'] },
    async ({ page }) => {
      stub.plan = () => clearPlan(QUESTION);
      await scenarioStep(page, 'Given I am on the "Answer a Business Question" page', async () => {
        await openWorkflows(page);
        await openV2FromRun(page);
      });
      await scenarioStep(page, `When I run it on "${QUESTION}"`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, QUESTION);
      });
      await scenarioStep(page, 'Then I see "Run succeeded" and the written answer', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
        await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
        // Plan and Write answer each called the model once, as structured steps.
        expect(stub.requests.filter((r) => r.step === 'plan').length).toBeGreaterThan(0);
        expect(stub.requests.filter((r) => r.step === 'answer').length).toBeGreaterThan(0);
      });
      await scenarioStep(
        page,
        'And every step of the main path is "Done" on the canvas, and "Clarify" is "Skipped" and muted',
        async () => {
          for (const [id] of V2_MAIN_STEP_IDS) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
            await expect(page.getByTestId(`workflow-node-${id}`)).not.toHaveAttribute('data-skipped', 'true');
          }
          await expect(nodeStatus(page, 'clarify')).toHaveText('Skipped');
          await expect(page.getByTestId('workflow-node-clarify')).toHaveAttribute('data-skipped', 'true');
          await expect(page.getByTestId('workflow-edge-label-plan-clarify')).toHaveAttribute(
            'data-skipped',
            'true',
          );
          await expect(page.getByTestId('workflow-connector-plan-analyse')).toHaveAttribute('data-done', 'true');
          // Validate passed the first time: nothing ran twice.
          await expect(page.getByTestId('workflow-node-attempts')).toHaveCount(0);
        },
      );
      await scenarioStep(page, 'When I double-click "Plan"', async () => {
        await openNode(page, 'plan', 'Plan');
      });
      await scenarioStep(
        page,
        'Then its Output shows the question, the measures, the entities, the scope and the assumptions',
        async () => {
          const view = nodeDialog(page).getByTestId('workflow-plan-view');
          await expect(view).toBeVisible();
          await expect(view.getByTestId('workflow-plan-question')).toHaveText(QUESTION);
          await expect(view.getByTestId('workflow-plan-measures').getByRole('listitem')).toHaveText([
            'match count',
          ]);
          await expect(view.getByTestId('workflow-plan-entities').getByRole('listitem')).toHaveText([
            'matches',
          ]);
          await expect(view.getByTestId('workflow-plan-scope')).toHaveText('The picked datasets');
          await expect(view.getByTestId('workflow-plan-assumptions').getByRole('listitem')).toHaveText([
            'Every match in the data counts once',
          ]);
          await expect(view.getByTestId('workflow-plan-clarification')).toHaveCount(0);
          // The raw data stays under it.
          await expect(
            nodeDialog(page).getByTestId('workflow-ndv-output').getByTestId('workflow-data-json'),
          ).toContainText('"measures"');
          await closeNode(page);
        },
      );
      await scenarioStep(page, 'When I double-click "Validate"', async () => {
        await openNode(page, 'validate', 'Validate');
      });
      await scenarioStep(
        page,
        'Then its Output shows the checks as a checklist, valid on attempt 1',
        async () => {
          const view = nodeDialog(page).getByTestId('workflow-validate-view');
          await expect(view).toBeVisible();
          await expect(view.getByTestId('workflow-validate-ok')).toHaveText('Valid');
          await expect(view.getByTestId('workflow-validate-attempt')).toContainText('Attempt 1');
          await expect(view.getByTestId('workflow-validate-finding').first()).toBeVisible();
          await expect(
            view.locator('[data-testid="workflow-validate-finding"][data-passed="true"]').first(),
          ).toBeVisible();
          // It ran once: no attempt switcher.
          await expect(nodeDialog(page).getByTestId('workflow-attempts')).toHaveCount(0);
          await closeNode(page);
        },
      );
    },
  );

  test(
    'A question that needs clarification waits for my answer and continues the same run',
    { tag: ['@demo'] },
    async ({ page }) => {
      const question = 'How did the team do?';
      const clarification = {
        question: 'Which team do you mean?',
        options: ['Brazil', 'Germany'],
      };
      // Plan asks the first time; after the answer it plans clearly.
      let plans = 0;
      stub.plan = () => (plans++ === 0 ? clarifyingPlan(question, clarification) : clearPlan(question));
      let runId = '';

      await scenarioStep(page, 'Given I am on the "Answer a Business Question" page', async () => {
        await openWorkflows(page);
        await openV2FromRun(page);
      });
      await scenarioStep(
        page,
        `When I run it on "${question}" and the plan needs clarification`,
        async () => {
          await page.getByTestId('workflow-execute').click();
          await runOnQuestion(page, question);
        },
      );
      await scenarioStep(
        page,
        'Then a card "Waiting for your answer" shows the question and its options, and the run is "Waiting for you"',
        async () => {
          const card = page.getByTestId('workflow-run-input-required');
          await expect(card).toBeVisible();
          await expect(card.getByRole('heading', { name: 'Waiting for your answer' })).toBeVisible();
          await expect(card.getByTestId('workflow-run-input-step')).toHaveText('Clarify');
          await expect(card.getByTestId('workflow-run-input-question')).toHaveText(clarification.question);
          await expect(card.getByTestId('workflow-run-input-option-0')).toHaveText(clarification.options[0]);
          await expect(card.getByTestId('workflow-run-input-option-1')).toHaveText(clarification.options[1]);
          await expect(card).toBeFocused();
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Waiting for you');
          await expect(logRow(page, 'clarify')).toHaveAttribute('data-state', 'waiting');
          await expect(page.getByTestId('workflow-run-activity')).toHaveText('Waiting for your answer');
          // The agent has not been called: the run stopped at the question.
          expect(turnRequests(stub, question)).toEqual([]);
          const runs = (await storedRuns(page)) as { id: string; status: string }[];
          expect(runs.map((run) => run.status)).toEqual(['suspended']);
          runId = runs[0].id;
          await expect(page.getByTestId('workflow-state-run-id')).toHaveText(runId);
        },
      );
      await scenarioStep(page, `When I pick "${clarification.options[0]}"`, async () => {
        await page.getByTestId('workflow-run-input-option-0').click();
      });
      await scenarioStep(
        page,
        'Then the same run continues through Analyse, Validate and Write answer and succeeds',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          await expect(page.getByTestId('workflow-run-input-required')).toHaveCount(0);
          for (const id of ['plan', 'analyse', 'validate', 'write-answer', 'wrap-up']) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
            await expect(logRow(page, id)).toHaveAttribute('data-state', 'done');
          }
          await expect(page.getByTestId('workflow-state-run-id')).toHaveText(runId);
          const runs = (await storedRuns(page)) as { id: string; status: string }[];
          expect(runs.map((run) => [run.id, run.status])).toEqual([[runId, 'success']]);
          await expect(page.getByTestId('run-answer')).toBeVisible();
        },
      );
    },
  );

  test(
    'The agent asks mid-analysis and continues after my answer',
    { tag: ['@demo'] },
    async ({ page }) => {
      const question = 'How did the team do?';
      const ask = {
        question: 'Which stage do you want to look at?',
        options: ['Group stage', 'Final'],
      };
      // Analyse asks on its first turn, and answers once the run resumes.
      let asked = false;
      stub.reply = (request) => {
        if (!asked && request.stream && request.messages.at(-1)?.role !== 'tool') {
          asked = true;
          return {
            toolCall: {
              name:
                request.tools.find((tool) => tool.endsWith('ask_clarification')) ??
                'ask_clarification',
              arguments: { question: ask.question, options: ask.options.join('\n') },
            },
          };
        }
        return queryThenAnswer(request);
      };
      // Hold Analyse's first turn open to see the progress while the run streams.
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      stub.hold = (request) => (request.stream ? gate : undefined);
      let runId = '';

      await scenarioStep(page, 'Given I am on the "Answer a Business Question" page', async () => {
        await openWorkflows(page);
        await openV2FromRun(page);
      });
      await scenarioStep(page, `When I run it on "${question}"`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, question);
      });
      await scenarioStep(page, 'Then the Logs show "Analyse" as the current step', async () => {
        const current = page.getByTestId('workflow-state').locator('[aria-current="step"]');
        await expect(current).toHaveCount(1);
        await expect(current).toHaveAttribute('data-testid', 'workflow-state-node-analyse');
        await expect(current).toHaveAttribute('data-state', 'current');
        await expect(logRow(page, 'plan')).toHaveAttribute('data-state', 'done');
        await expect(page.getByTestId('workflow-run-activity')).toHaveText(/^\s*Analys/);
        release();
      });
      await scenarioStep(
        page,
        'And a card "Waiting for your answer" asks the agent\'s question with its options',
        async () => {
          const card = page.getByTestId('workflow-run-input-required');
          await expect(card).toBeVisible();
          await expect(card.getByTestId('workflow-run-input-step')).toHaveText('Analyse');
          await expect(card.getByTestId('workflow-run-input-question')).toHaveText(ask.question);
          await expect(card.getByTestId('workflow-run-input-option-0')).toHaveText(ask.options[0]);
          await expect(logRow(page, 'analyse')).toHaveAttribute('data-state', 'waiting');
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Waiting for you');
          const runs = (await storedRuns(page)) as { id: string; status: string }[];
          expect(runs.map((run) => run.status)).toEqual(['suspended']);
          runId = runs[0].id;
        },
      );
      await scenarioStep(page, 'When I type my answer and press "Continue"', async () => {
        const answer = page.getByTestId('workflow-run-input-answer');
        await expect(page.getByTestId('workflow-run-input-continue')).toBeDisabled();
        await answer.fill('The final');
        await page.getByTestId('workflow-run-input-continue').click();
      });
      await scenarioStep(
        page,
        'Then the same run continues, Analyse answers and the run succeeds',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          await expect(page.getByTestId('workflow-run-input-required')).toHaveCount(0);
          await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
          await expect(page.getByTestId('workflow-state-run-id')).toHaveText(runId);
          for (const id of ['analyse', 'validate', 'write-answer']) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
          }
          const runs = (await storedRuns(page)) as { id: string; status: string }[];
          expect(runs.map((run) => [run.id, run.status])).toEqual([[runId, 'success']]);
        },
      );
    },
  );

  test('A failing step stops the run', async ({ page }) => {
    await test.step('Given I am on the "Answer a Business Question" page', async () => {
      await openWorkflows(page);
      await openV2FromRun(page);
    });
    await test.step('When the model fails and I run it on a question', async () => {
      failTheModel();
      await page.getByTestId('workflow-execute').click();
      await runOnQuestion(page, QUESTION);
    });
    await test.step('Then I see "Run failed" with the error', async () => {
      await expect(page.getByTestId('workflow-run-status')).toHaveText(/^\s*Run failed: \S/, {
        timeout: FAILED_RUN_TIMEOUT,
      });
    });
    await test.step(
      'And the steps up to "Plan" are "Done", "Analyse" is "Failed" and the steps after it are "Skipped"',
      async () => {
        for (const id of ['receive-question', 'load-catalog', 'plan']) {
          await expect(runStep(page, id)).toHaveAttribute('data-state', 'done');
        }
        await expect(runStep(page, 'analyse')).toHaveAttribute('data-state', 'failed');
        for (const id of ['validate', 'write-answer', 'wrap-up']) {
          await expect(runStep(page, id)).toHaveAttribute('data-state', 'skipped');
        }
        await expect(page.getByTestId('workflow-run-output')).toHaveCount(0);
      },
    );
    await test.step('And the canvas shows "Failed" on "Analyse" and "Skipped" on "Wrap up"', async () => {
      await expect(nodeStatus(page, 'receive-question')).toHaveText('Done');
      await expect(nodeStatus(page, 'load-catalog')).toHaveText('Done');
      await expect(nodeStatus(page, 'plan')).toHaveText('Done');
      await expect(nodeStatus(page, 'analyse')).toHaveText('Failed');
      await expect(nodeStatus(page, 'wrap-up')).toHaveText('Skipped');
      await expect(page.getByTestId('workflow-node-wrap-up')).toHaveAttribute('data-skipped', 'true');
    });
  });

  test(
    'An invalid input is refused before the workflow runs',
    { tag: ['@demo'] },
    async ({ page }) => {
      const runRequests: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().includes('/runs/stream')) {
          runRequests.push(request.url());
        }
      });
      const question = page.getByTestId('workflow-input-question');
      const picker = page.getByTestId('workflow-input-datasets');

      let storedBefore = 0;

      await scenarioStep(page, 'Given I am on the "Answer a Business Question" page', async () => {
        await openWorkflows(page);
        await openV2FromRun(page);
        storedBefore = (await storedRuns(page)).length;
      });
      await scenarioStep(page, 'When I click Execute workflow', async () => {
        await page.getByTestId('workflow-execute').click();
        await expectRunPanel(page);
      });
      await scenarioStep(
        page,
        'And I leave the question blank (only spaces), pick no dataset and click Execute',
        async () => {
          await question.fill('   ');
          await expect(
            picker.getByRole('button', { name: WORLD_CUP_DATASET }),
          ).toHaveAttribute('aria-pressed', 'false');
          await page.getByTestId('workflow-run').click();
        },
      );
      await scenarioStep(
        page,
        'Then I see "Question is required" and "Select at least one dataset" on their fields',
        async () => {
          await expect(page.getByTestId('workflow-input-error-question')).toHaveText(
            'Question is required',
          );
          await expect(page.getByTestId('workflow-input-error-datasets')).toHaveText(
            'Select at least one dataset',
          );
          await expect(question).toHaveAttribute('aria-invalid', 'true');
          await expect(question).toHaveAccessibleDescription('Question is required');
          await expect(question).toBeFocused();
          await expect(picker).toHaveAttribute('aria-invalid', 'true');
        },
      );
      await scenarioStep(
        page,
        'And the Start node shows "Invalid input" and the Run panel says "Input invalid: 2 fields"',
        async () => {
          await expect(nodeStatus(page, 'start')).toHaveText('Invalid input');
          await expect(nodeStatus(page, 'start')).toHaveAttribute('data-status', 'invalid');
          await expect(page.getByTestId('workflow-state-invalid')).toHaveText(
            'Input invalid: 2 fields',
          );
        },
      );
      await scenarioStep(page, 'And no run was started', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
        await expect(page.getByTestId('workflow-run-error')).toHaveCount(0);
        expect(runRequests).toEqual([]);
        expect(await storedRuns(page)).toHaveLength(storedBefore);
      });
      await scenarioStep(
        page,
        'When I double-click Start',
        async () => {
          await openNode(page, 'start', 'Start');
        },
      );
      await scenarioStep(
        page,
        'Then its Output lists the refused errors and its parameters say what each field needs',
        async () => {
          const dialog = nodeDialog(page);
          await expect(dialog.getByTestId('workflow-ndv-input-errors').getByRole('listitem')).toHaveText([
            'Question is required',
            'Select at least one dataset',
          ]);
          await expect(dialog.getByTestId('workflow-ndv-output-status')).toHaveText(
            'Invalid input',
          );
          await expect(dialog.getByTestId('workflow-param-rules-question')).toHaveText(
            'Rules: Max 4000 characters',
          );
          await expect(dialog.getByTestId('workflow-param-usedby-question')).toHaveText(
            'Used by: Receive question',
          );
          await closeNode(page);
        },
      );
      await scenarioStep(
        page,
        `When I pick "${WORLD_CUP_DATASET}", type "${QUESTION}" and click Execute`,
        async () => {
          await fillRun(page, QUESTION, WORLD_CUP_DATASET);
          await expect(page.getByTestId('workflow-input-error-question')).toHaveCount(0);
          await expect(page.getByTestId('workflow-input-error-datasets')).toHaveCount(0);
          await page.getByTestId('workflow-run').click();
        },
      );
      await scenarioStep(page, 'Then the run starts and succeeds', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
        await expect(nodeStatus(page, 'start')).toHaveText('Done');
        await expect(page.getByTestId('workflow-state-invalid')).toHaveCount(0);
        expect(runRequests).toHaveLength(1);
      });
    },
  );
});

/** The stored runs (api.md 120). */
async function storedRuns(page: Page): Promise<unknown[]> {
  const { runs } = await apiJson<{ runs: unknown[] }>(page, 'GET', '/workflow-runs');
  return runs;
}

/** A canvas node's run status chip (ui.md 4.4b). */
function nodeStatus(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-node-${id}`).getByTestId('workflow-node-status');
}

test.describe('Feature: Workflows (the designer)', () => {
  test(
    'A workflow opens as a designer',
    { tag: ['@demo', '@story-1.23.10'] },
    async ({ page }) => {
      await scenarioStep(page, 'When I open "Answer a Business Question" from Workflows', async () => {
        await openWorkflows(page);
        await openWorkflow(page, V2_ID, V2);
      });
      await scenarioStep(
        page,
        'Then the canvas shows Start, its steps in order with their badges, and End, left to right, with Clarify below Plan',
        async () => {
          const canvas = page.getByTestId('workflow-canvas');
          await expect(canvas.getByTestId('workflow-node-start')).toContainText('Start');
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(canvas.getByTestId('workflow-node-kind')).toHaveText([
            'CODE',
            'CODE',
            'LLM',
            'LLM',
            'CODE',
            'LLM',
            'CODE',
            'CODE',
          ]);
          const plan = await canvas.getByTestId('workflow-node-plan').boundingBox();
          const clarify = await canvas.getByTestId('workflow-node-clarify').boundingBox();
          expect(clarify!.y).toBeGreaterThan(plan!.y + plan!.height);
          await expect(canvas.getByTestId('workflow-edge-label-plan-clarify')).toHaveText(
            'Needs clarification',
          );
          await expect(canvas.getByTestId('workflow-edge-label-validate-analyse')).toHaveText(
            'Retry once',
          );
          await expect(canvas.getByTestId('workflow-connector-validate-analyse')).toHaveAttribute(
            'data-kind',
            'loop',
          );
          await expect(canvas.getByTestId('workflow-node-end')).toContainText('End');
          // The graph is fitted on open: never zoomed past 100%.
          const zoom = Number.parseInt(
            (await page.getByTestId('workflow-zoom-level').textContent()) ?? '',
            10,
          );
          expect(zoom).toBeGreaterThanOrEqual(40);
          expect(zoom).toBeLessThanOrEqual(100);
          // Start left of the first step, End right of the last, on one centre line.
          const start = await canvas.getByTestId('workflow-node-start').boundingBox();
          const first = await page.getByTestId('workflow-node-receive-question').boundingBox();
          const last = await page.getByTestId('workflow-node-wrap-up').boundingBox();
          const end = await canvas.getByTestId('workflow-node-end').boundingBox();
          expect(start!.x + start!.width).toBeLessThan(first!.x);
          expect(last!.x + last!.width).toBeLessThan(end!.x);
          const centre = (box: { y: number; height: number }) => box.y + box.height / 2;
          expect(Math.abs(centre(start!) - centre(first!))).toBeLessThan(2);
          expect(Math.abs(centre(last!) - centre(end!))).toBeLessThan(2);
        },
      );
      await scenarioStep(
        page,
        'And there is no Details panel, the Logs are under the canvas and the Run panel with the Chat is on its right',
        async () => {
          await expect(detailsPanel(page)).toHaveCount(0);
          await expectRunPanel(page);
          const canvasBox = await page.getByTestId('workflow-canvas').boundingBox();
          const dockBox = await runDock(page).boundingBox();
          expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(dockBox!.x + 1);
          const logsBox = await logsDock(page).boundingBox();
          expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(logsBox!.y + 1);
          expect(logsBox!.x + logsBox!.width).toBeLessThanOrEqual(dockBox!.x + 1);
          await expect(runDock(page).getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
          await expect(logsDock(page).getByRole('heading', { name: 'Logs', exact: true })).toBeVisible();
        },
      );
      await scenarioStep(page, 'When I double-click Start', async () => {
        await page.getByTestId('workflow-node-start').dblclick();
      });
      await scenarioStep(
        page,
        'Then its dialog shows the trigger, the input parameters and the output',
        async () => {
          const dialog = nodeDialog(page);
          await expect(dialog).toHaveAttribute('role', 'dialog');
          await expect(dialog.getByTestId('workflow-ndv-title')).toHaveText('Start');
          await expect(dialog.getByTestId('workflow-panel-trigger')).toHaveText('Runs on an input');
          await expect(dialog.getByTestId('workflow-param-question')).toBeVisible();
          await expect(dialog.getByTestId('workflow-param-datasets')).toBeVisible();
          await expect(dialog.getByTestId('workflow-panel-output')).toContainText(
            'sqlQueries, failedQueries, rows',
          );
          await closeNode(page);
          await expect(page.getByTestId('workflow-node-start')).toBeFocused();
        },
      );
      await scenarioStep(page, 'When I click "Analyse" on the canvas', async () => {
        await page.getByTestId('workflow-node-analyse').click();
      });
      await scenarioStep(
        page,
        'Then "Analyse" is selected on the canvas and in the Logs',
        async () => {
          await expect(page.getByTestId('workflow-node-analyse')).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          await expect(page.getByTestId('workflow-state-node-analyse')).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          await expect(nodeDialog(page)).toHaveCount(0);
        },
      );
      await scenarioStep(page, 'When I double-click "Analyse"', async () => {
        await page.getByTestId('workflow-node-analyse').dblclick();
      });
      await scenarioStep(
        page,
        'Then its dialog shows its model, its tools and "Max steps 15"',
        async () => {
          const dialog = nodeDialog(page);
          await expect(dialog.getByTestId('workflow-ndv-title')).toHaveText('Analyse');
          await expect(dialog.getByTestId('workflow-step-field-model')).toBeVisible();
          await expect(dialog.getByTestId('workflow-step-field-tools')).toHaveText(
            'list_entities, describe_entity, sample_rows, run_readonly_sql, ask_clarification',
          );
          await expect(dialog.getByText('Max steps', { exact: true })).toBeVisible();
          await expect(dialog.getByTestId('workflow-step-field-max-steps')).toHaveText('15');
          await page.keyboard.press('Escape');
          await expect(nodeDialog(page)).toHaveCount(0);
        },
      );
      await scenarioStep(page, 'When I click Execute workflow', async () => {
        await page.getByTestId('workflow-execute').click();
      });
      await scenarioStep(page, 'Then the Run panel focuses its input and nothing runs', async () => {
        await expectRunPanel(page);
        await expect(page.getByTestId('workflow-input-question')).toBeFocused();
        await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
      });
      await scenarioStep(
        page,
        'When I pick a dataset, type a question and click Execute',
        async () => {
          await runOnQuestion(page, QUESTION);
        },
      );
      await scenarioStep(
        page,
        'Then I see the answer and "Done" on every canvas node but "Clarify"',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
          for (const [id] of V2_MAIN_STEP_IDS) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
          }
          await expect(nodeStatus(page, 'clarify')).toHaveText('Skipped');
        },
      );
      await scenarioStep(page, 'When I double-click "Analyse" again', async () => {
        await openNode(page, 'analyse', 'Analyse');
      });
      await scenarioStep(
        page,
        'Then its Receives lists "question" and the "plan" with their types',
        async () => {
          const receives = nodeDialog(page)
            .getByTestId('workflow-step-field-input')
            .getByTestId('workflow-contract-field');
          await expect(receives.filter({ hasText: /^question\b/ })).toContainText(
            /: string$/,
          );
          await expect(receives.filter({ hasText: /^plan\b/ })).toContainText(/: \S+/);
        },
      );
      await scenarioStep(
        page,
        'And its Output in Schema mode shows the declared contract',
        async () => {
          const output = nodeDialog(page).getByTestId('workflow-ndv-output');
          await output.getByTestId('workflow-data-mode-schema').click();
          await expect(output.getByTestId('workflow-data-schema-declared')).toHaveText(
            'Declared contract',
          );
          await expect(
            output.getByTestId('workflow-data-schema').getByTestId('workflow-contract-field'),
          ).not.toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        'And its Settings show the contract the run used',
        async () => {
          const dialog = nodeDialog(page);
          await dialog.getByTestId('workflow-ndv-tab-settings').click();
          await expect(dialog.getByText('Contract', { exact: true })).toBeVisible();
          await expect(dialog.getByTestId('workflow-ndv-setting-contract')).toHaveText(
            /^\s*[0-9a-f]{12}\s*$/,
          );
          await expect(dialog.getByTestId('workflow-ndv-contract-older')).toHaveCount(0);
          await closeNode(page);
        },
      );
    },
  );

  test(
    "A run shows each node's data in the Run panel's Logs and the node dialog",
    { tag: ['@demo'] },
    async ({ page }) => {
      await test.step('Given I am on the "Answer a Business Question" page', async () => {
        await openWorkflows(page);
        await openV2FromRun(page);
      });
      await test.step(`When I run it on "${QUESTION}"`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, QUESTION);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      });
      await test.step(
        'Then every connector of the main path is done, the branch to "Clarify" is muted, and the Run panel reads "9 of 10 nodes ran"',
        async () => {
          const canvas = page.getByTestId('workflow-canvas');
          const connectors = canvas.locator('path[data-testid^="workflow-connector-"]');
          await expect(connectors).toHaveCount(11);
          const main = ['start', ...V2_MAIN_STEP_IDS.map(([id]) => id), 'end'];
          for (const [i, from] of main.slice(0, -1).entries()) {
            await expect(canvas.getByTestId(`workflow-connector-${from}-${main[i + 1]}`)).toHaveAttribute(
              'data-done',
              'true',
            );
          }
          for (const id of ['plan-clarify', 'clarify-plan']) {
            await expect(canvas.getByTestId(`workflow-connector-${id}`)).toHaveAttribute('data-skipped', 'true');
            await expect(canvas.getByTestId(`workflow-connector-${id}`)).toHaveAttribute('data-done', 'false');
          }
          // Validate passed the first time: the loop was not taken.
          await expect(canvas.getByTestId('workflow-connector-validate-analyse')).toHaveAttribute(
            'data-done',
            'false',
          );
          await expect(page.getByTestId('workflow-state-progress')).toHaveText(
            '9 of 10 nodes ran',
          );
          await expect(page.getByTestId('workflow-state-status')).toHaveText('success');
        },
      );
      await test.step('When I double-click "Wrap up"', async () => {
        await openNode(page, 'wrap-up', 'Wrap up');
      });
      await test.step(
        'Then its Output holds the counts of the SQL calls and the answer',
        async () => {
          const dialog = nodeDialog(page);
          await expect(dialog.getByTestId('workflow-ndv-output-status')).toHaveText('Done');
          await expect(
            dialog.getByTestId('workflow-ndv-input').getByTestId('workflow-data-json'),
          ).not.toBeEmpty();
          const output = dialog.getByTestId('workflow-ndv-output').getByTestId('workflow-data-json');
          await expect(output).toContainText('"answer"');
          await expect(output).toContainText('"sqlQueries"');
          await expect(output).toContainText('1');
          await expect(output).toContainText('"failedQueries"');
          await expect(output).toContainText('0');
          await closeNode(page);
        },
      );
      await test.step('When the model fails and I run it again', async () => {
        failTheModel();
        await newQuestion(page, QUESTION);
        await page.getByTestId('workflow-run').click();
        await expect(page.getByTestId('workflow-run-status')).toHaveText(/^\s*Run failed: \S/, {
          timeout: FAILED_RUN_TIMEOUT,
        });
      });
      await test.step('Then the "Analyse" dialog shows the error in its Output', async () => {
        const dialog = await openNode(page, 'analyse', 'Analyse');
        await expect(dialog.getByTestId('workflow-ndv-output-status')).toHaveText('Failed');
        await expect(dialog.getByTestId('workflow-ndv-output-error')).not.toBeEmpty();
        await closeNode(page);
      });
    },
  );

  test("A tool sub-node opens the tool's own details", { tag: ['@demo'] }, async ({ page }) => {
    await test.step('Given I am on the "Answer a Business Question" page', async () => {
      await openWorkflows(page);
      await openWorkflow(page, V2_ID, V2);
    });
    await test.step('When I open the Tools sub-node under "Analyse" and pick "run_readonly_sql"', async () => {
      const tools = page.getByTestId('workflow-subnode-analyse-tools');
      await expect(tools).toHaveAccessibleName('Tools of Analyse: 5 tools');
      const menu = await openToolsMenu(page, 'analyse');
      await expect(menu.getByRole('menuitem')).toHaveText([
        'list_entities',
        'describe_entity',
        'sample_rows',
        'run_readonly_sql',
        'ask_clarification',
      ]);
      // Keyboard: down to the fourth tool, then Enter.
      for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
      await expect(menu.getByRole('menuitem', { name: 'run_readonly_sql' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(menu).toHaveCount(0);
      await expect(nodeDialog(page).getByTestId('workflow-ndv-title')).toHaveText('run_readonly_sql');
    });
    await test.step(
      "Then its dialog shows the tool's description and inputs, not the agent's prompt",
      async () => {
        const dialog = nodeDialog(page);
        await expect(dialog.getByText('TOOL', { exact: true })).toBeVisible();
        await expect(dialog.getByText('Tool of Michael · Analyse')).toBeVisible();
        await expect(dialog.getByTestId('workflow-tool-field-name')).toHaveText('run_readonly_sql');
        await expect(dialog.getByTestId('workflow-tool-field-description')).toBeVisible();
        await expect(dialog.getByTestId('workflow-tool-field-description')).not.toHaveText('None');
        await expect(dialog.getByTestId('workflow-tool-field-inputs')).toContainText('sql');
        await expect(dialog.getByTestId('workflow-tool-field-step')).toHaveText('Analyse');
        await expect(dialog.getByTestId('workflow-step-field-system-prompt')).toHaveCount(0);
        await expect(dialog.getByTestId('workflow-ndv-input')).toContainText(
          'This tool has not run yet. Execute the workflow to see its calls.',
        );
        await closeNode(page);
        await expect(page.getByTestId('workflow-subnode-analyse-tools')).toBeFocused();
      },
    );
    await test.step(`When I run it on "${QUESTION}" and open the tool again`, async () => {
      await page.getByTestId('workflow-execute').click();
      await runOnQuestion(page, QUESTION);
      await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      await openTool(page, 'analyse', 'run_readonly_sql');
    });
    await test.step('Then its Input shows the SQL the agent ran and its Output the call done', async () => {
      const dialog = nodeDialog(page);
      await expect(dialog.getByTestId('workflow-ndv-tool-input')).toHaveText([SQL]);
      await expect(dialog.getByTestId('workflow-ndv-tool-result')).toHaveCount(1);
      await expect(dialog.getByTestId('workflow-ndv-tool-result')).toContainText(/^\s*Done/);
      await dialog.getByTestId('workflow-ndv-tab-settings').click();
      await expect(dialog.getByTestId('workflow-ndv-setting-calls')).toHaveText('1');
      await closeNode(page);
    });
  });

  test(
    "I chat with a step's agent about its run data",
    { tag: ['@demo'] },
    async ({ page }) => {
      stub.reply = chatOrRun;

      await scenarioStep(page, 'Given I am on the "Answer a Business Question" page', async () => {
        await openWorkflows(page);
        await openV2FromRun(page);
      });
      await scenarioStep(
        page,
        'When I open "Analyse" before any run, its Chat tab says to execute the workflow first',
        async () => {
          const dialog = await openNode(page, 'analyse', 'Analyse');
          await expect(dialog.getByRole('tab')).toHaveText(['Parameters', 'Settings', 'Chat']);
          await dialog.getByRole('tab', { name: 'Chat', exact: true }).click();
          await expect(dialog.getByTestId('workflow-ndv-tab-chat')).toHaveAttribute(
            'aria-selected',
            'true',
          );
          await expect(dialog.getByTestId('workflow-node-chat-unavailable')).toHaveText(
            "Execute the workflow, then chat with this agent about this step's data.",
          );
          await expect(dialog.getByTestId('workflow-node-chat-input')).toHaveCount(0);
          await closeNode(page);
        },
      );
      await scenarioStep(page, `When I run it on "${QUESTION}"`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, QUESTION);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      });
      await scenarioStep(page, 'And I open "Analyse" on its Chat tab', async () => {
        const dialog = await openNode(page, 'analyse', 'Analyse');
        await dialog.getByTestId('workflow-ndv-tab-chat').click();
        await expect(dialog.getByTestId('workflow-node-chat-note')).toHaveText(
          /^\s*Chatting about run \S{8}: this step's input, output and tool calls\.\s*$/,
        );
        await expect(dialog.getByRole('log')).toBeVisible();
        await expect(dialog.getByTestId('workflow-node-chat-message')).toHaveCount(0);
        await expect(dialog.getByTestId('workflow-node-chat-send')).toBeDisabled();
      });
      await scenarioStep(page, `And I ask "${CHAT_QUESTION}"`, async () => {
        const box = nodeDialog(page).getByRole('textbox', { name: "Ask this step's agent" });
        await box.fill(CHAT_QUESTION);
        await box.press('Enter');
      });
      await scenarioStep(
        page,
        "Then the agent's answer appears under my question, with the query it ran",
        async () => {
          const messages = nodeDialog(page).getByTestId('workflow-node-chat-message');
          await expect(messages).toHaveCount(2);
          await expect(messages.nth(0)).toHaveAttribute('data-role', 'user');
          await expect(messages.nth(0)).toHaveText(CHAT_QUESTION);
          await expect(messages.nth(1)).toHaveAttribute('data-role', 'assistant');
          await expect(messages.nth(1)).toContainText(CHAT_ANSWER);
          const call = messages.nth(1).getByTestId('workflow-node-chat-tool-call');
          await expect(call).toHaveCount(1);
          await expect(call).toContainText('run_readonly_sql');
          await expect(call.locator('pre')).toHaveText(CHAT_SQL);
          await expect(nodeDialog(page).getByTestId('workflow-node-chat-error')).toHaveCount(0);
          await expect(nodeDialog(page).getByTestId('workflow-node-chat-stop')).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        "And the agent received this step's input question and the SQL it ran in the run",
        async () => {
          const chat = stub.requests.filter((request) => isChatTurn(request));
          expect(chat.length, `a model call for "${CHAT_QUESTION}"`).toBeGreaterThan(0);
          // The first call of the chat turn, as the model received it.
          await test.info().attach('first node-chat request', {
            body: JSON.stringify(chat[0], null, 2),
            contentType: 'application/json',
          });
          const texts = chat[0].messages.map(messageText).join('\n');
          expect(texts, "the step's input question").toContain(QUESTION);
          expect(texts, "the run's SQL").toContain(SQL);
          // The run itself was not changed by the chat.
          await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
        },
      );
      await scenarioStep(
        page,
        'When I close the dialog and open its Chat again, both messages are still there',
        async () => {
          await closeNode(page);
          const dialog = await openNode(page, 'analyse', 'Analyse');
          await dialog.getByTestId('workflow-ndv-tab-chat').click();
          const messages = dialog.getByTestId('workflow-node-chat-message');
          await expect(messages).toHaveCount(2);
          await expect(messages.nth(0)).toHaveText(CHAT_QUESTION);
          await expect(messages.nth(1)).toContainText(CHAT_ANSWER);
          await closeNode(page);
        },
      );
    },
  );
});

test('the Workflows pages have no detectable accessibility violations in either theme', async ({
  page,
}) => {
  await followOsTheme(page);
  await page.addScriptTag({ content: axe.source });

  async function scan(label: string): Promise<void> {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // Let the theme's colour transitions finish before axe reads colours.
      await page.waitForTimeout(500);
      const results = await page.evaluate(async () => {
        return (window as unknown as { axe: typeof axe }).axe.run(document);
      });
      expect(results.violations, `${label}, ${theme}`).toEqual([]);
    }
  }

  await openWorkflows(page);
  await expect(section(page, 'official')).toBeVisible();
  await scan('Workflows page');

  // A workflow's page: the canvas, the Logs under it and the Run panel (Chat) on the right.
  await openWorkflow(page, V2_ID, V2);
  await expect(drawnSteps(page)).toHaveCount(V2_STEPS.length);
  await expect(runDock(page)).toBeVisible();
  await scan('Answer a Business Question page');

  // The Run panel maximized, then restored.
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();
  await expect(runDock(page).getByTestId('workflow-run-dock-maximize')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await scan('Answer a Business Question page, Run panel maximized');
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();
  await expect(runDock(page).getByTestId('workflow-run-dock-maximize')).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  await openNode(page, 'analyse', 'Analyse');
  await scan('Answer a Business Question page, Analyse dialog');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  await openToolsMenu(page, 'analyse');
  await scan('Answer a Business Question page, Analyse Tools list');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workflow-tools-menu-analyse')).toHaveCount(0);
  await expect(page.getByTestId('workflow-subnode-analyse-tools')).toBeFocused();

  await openTool(page, 'analyse', 'run_readonly_sql');
  await scan('Answer a Business Question page, run_readonly_sql tool dialog');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  await page.getByTestId('workflow-state-node-analyse').click();
  await expect(page.getByTestId('workflow-state-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('workflow-state-detail')).toBeVisible();
  await scan('Answer a Business Question page, Logs on Analyse');

  await backToWorkflows(page);
  await openV2FromRun(page);
  await page.getByTestId('workflow-execute').click();

  // A refused Execute: the field errors, Start invalid, the state summary.
  await page.getByTestId('workflow-run').click();
  await expect(page.getByTestId('workflow-input-error-question')).toBeVisible();
  await expect(page.getByTestId('workflow-input-error-datasets')).toBeVisible();
  await expect(nodeStatus(page, 'start')).toHaveText('Invalid input');
  await scan('Answer a Business Question page, input refused');

  await openNode(page, 'start', 'Start');
  await expect(nodeDialog(page).getByTestId('workflow-ndv-input-errors')).toBeVisible();
  await scan('Answer a Business Question page, Start dialog with the refused input');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  await runOnQuestion(page, QUESTION);
  await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
  await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
  await expect(page.getByTestId('workflow-follow-up-input')).toBeVisible();
  await scan('Answer a Business Question page after a run');
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();
  await scan('Answer a Business Question page after a run, Run panel maximized');
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();

  await openNode(page, 'wrap-up', 'Wrap up');
  await scan('Answer a Business Question page, Wrap up dialog after a run');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  // Plan's and Validate's outputs as panels (ui.md 4.4b).
  await expect(
    (await openNode(page, 'plan', 'Plan')).getByTestId('workflow-plan-view'),
  ).toBeVisible();
  await scan('Answer a Business Question page, Plan dialog after a run');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);
  await expect(
    (await openNode(page, 'validate', 'Validate')).getByTestId('workflow-validate-view'),
  ).toBeVisible();
  await scan('Answer a Business Question page, Validate dialog after a run');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  // The Analyse dialog's Chat tab, with a question, its answer and a tool call.
  stub.reply = chatOrRun;
  const chatDialog = await openNode(page, 'analyse', 'Analyse');
  await chatDialog.getByTestId('workflow-ndv-tab-chat').click();
  await chatDialog.getByTestId('workflow-node-chat-input').fill(CHAT_QUESTION);
  await chatDialog.getByTestId('workflow-node-chat-send').click();
  await expect(chatDialog.getByTestId('workflow-node-chat-message')).toHaveCount(2);
  await expect(chatDialog.getByTestId('workflow-node-chat-tool-call')).toHaveCount(1);
  await scan('Answer a Business Question page, Analyse dialog on its Chat tab');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  failTheModel();
  await newQuestion(page, QUESTION);
  await page.getByTestId('workflow-run').click();
  await expect(page.getByTestId('workflow-run-status')).toHaveText(/^\s*Run failed: \S/, {
    timeout: FAILED_RUN_TIMEOUT,
  });
  await scan('Answer a Business Question page after a failed run');

  // A run that waits for my answer: the waiting card, the progress and the activity line.
  stub.hold = undefined;
  stub.plan = () =>
    clarifyingPlan(QUESTION, {
      question: 'Which stage do you mean?',
      options: ['Group stage', 'Final'],
    });
  await newQuestion(page, QUESTION);
  await page.getByTestId('workflow-run').click();
  await expect(page.getByTestId('workflow-run-input-required')).toBeVisible();
  await expect(page.getByTestId('workflow-run-activity')).toHaveText('Waiting for your answer');
  await scan('Answer a Business Question page, a run waiting for my answer');
});
