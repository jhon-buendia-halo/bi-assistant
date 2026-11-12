import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import { LlmStub, StubRequest, StubReply, startLlmStub } from './helpers/llm-stub';
import { fillRun } from './helpers/run-ui';
import { worldCupKey } from './helpers/world-cup-db';

/** Mirrors the Feature "Workflows" in specs/capabilities/workflows/spec.md. */

const V2 = 'Questions to Insights v2';
const V2_ID = 'qti-v2-turn';
const V2_STEPS = ['Receive question', 'Load catalog', 'Analyse', 'Wrap up'];
const V2_STEP_IDS = [
  ['receive-question', 'Receive question'],
  ['load-catalog', 'Load catalog'],
  ['analyse', 'Analyse'],
  ['wrap-up', 'Wrap up'],
] as const;
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

async function closeNode(page: Page): Promise<void> {
  await nodeDialog(page).getByTestId('workflow-ndv-close').click();
  await expect(nodeDialog(page)).toHaveCount(0);
}

/** The run form in the right panel, which Execute workflow opens. */
async function expectRunPanel(page: Page): Promise<void> {
  await expect(detailsPanel(page).getByRole('heading', { name: 'Run', exact: true })).toBeVisible();
  await expect(page.getByTestId('workflow-run')).toBeVisible();
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
        'Then I see only "Questions to Insights v2" under Official, and no Mine section',
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
            '4 steps',
          );
          await expect(page.locator('[data-testid^="workflow-card-"]')).toHaveCount(1);
          await expect(section(page, 'mine')).toHaveCount(0);
        },
      );
      await scenarioStep(page, 'When I open "Questions to Insights v2"', async () => {
        await openWorkflow(page, V2_ID, V2);
      });
      await scenarioStep(
        page,
        'Then I see its four steps on the canvas and the agent "Questions to Insights v2" under Agents in its Start node',
        async () => {
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(detailsPanel(page).getByTestId('workflow-bar-note')).toHaveCount(0);
          const start = await openNode(page, 'start', 'Start');
          await expect(start.getByTestId('workflow-agent-assistant-v2')).toContainText(V2);
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
        'Then the panel opens on Run and no chat is started',
        async () => {
          await expectRunPanel(page);
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
    await test.step('When I open "Questions to Insights v2"', async () => {
      await openWorkflow(page, V2_ID, V2);
    });
    await test.step(
      'Then I see no Edit, New, Delete or step-reorder control on its page or in its panel',
      async () => {
        await expect(drawnSteps(page)).toHaveCount(4);
        for (const scope of [
          page.getByTestId('workflow-detail-page'),
          page.getByTestId('workflow-panel'),
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
    await test.step('When I search for "insights"', async () => {
      await expect(search).toHaveAttribute(
        'placeholder',
        'Search workflows by name or description',
      );
      await search.fill('insights');
    });
    await test.step('Then only the "Questions to Insights v2" card is shown', async () => {
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

/** A run's step row on the workflow page (workflows R13). */
function runStep(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-run-step-${id}`);
}

/** Opens Questions to Insights v2's page from its card's Run. */
async function openV2FromRun(page: Page): Promise<void> {
  await page.getByTestId(`workflow-run-open-${V2_ID}`).click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(V2);
}

test.describe('Feature: Workflows (run workflows)', () => {
  test(
    'I run Questions to Insights v2 on a question from its card',
    { tag: ['@demo', '@story-1.23.9'] },
    async ({ page }) => {
      await scenarioStep(page, 'When I open Workflows', async () => {
        await openWorkflows(page);
      });
      await scenarioStep(
        page,
        'Then I see "Questions to Insights v2" with "4 steps" and no Start chat',
        async () => {
          const card = page.getByTestId(`workflow-card-${V2_ID}`);
          await expect(card).toBeVisible();
          await expect(page.getByTestId(`workflow-${V2_ID}`)).toContainText(V2);
          await expect(page.getByTestId(`workflow-kind-${V2_ID}`)).toHaveText(
            '4 steps',
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
        'Then I see its four steps on the canvas, Execute and no Start chat',
        async () => {
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(page.getByTestId('workflow-detail-kind')).toHaveText(
            '4 steps',
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
          const question = detailsPanel(page).getByLabel('Question', { exact: true });
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
        'Then I see "Run succeeded" with "Receive question", "Load catalog", "Analyse" and "Wrap up" all "Done"',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          for (const [id, title] of V2_STEP_IDS) {
            await expect(runStep(page, id)).toContainText(title);
            await expect(runStep(page, id).getByText('Done', { exact: true })).toBeVisible();
          }
          await expect(page.getByTestId('workflow-run')).toHaveText('Execute');
          await expect(page.getByTestId('workflow-run')).toBeEnabled();
        },
      );
      await scenarioStep(page, "And I see the model's answer", async () => {
        await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
      });
    },
  );

  test('A failing step stops the run', async ({ page }) => {
    await test.step('Given I am on the "Questions to Insights v2" page', async () => {
      await openWorkflows(page);
      await openV2FromRun(page);
    });
    await test.step('When the model fails and I run it on a question', async () => {
      failTheModel();
      await page.getByTestId('workflow-execute').click();
      await runOnQuestion(page, QUESTION);
    });
    await test.step('Then I see "Run failed" with the error', async () => {
      await expect(page.getByTestId('workflow-run-status')).toHaveText(/^Run failed: \S/, {
        timeout: FAILED_RUN_TIMEOUT,
      });
    });
    await test.step(
      'And "Receive question" and "Load catalog" are "Done", "Analyse" is "Failed" and "Wrap up" is "Skipped"',
      async () => {
        await expect(runStep(page, 'receive-question').getByText('Done', { exact: true })).toBeVisible();
        await expect(runStep(page, 'load-catalog').getByText('Done', { exact: true })).toBeVisible();
        await expect(runStep(page, 'analyse').getByText('Failed', { exact: true })).toBeVisible();
        await expect(runStep(page, 'wrap-up').getByText('Skipped', { exact: true })).toBeVisible();
        await expect(page.getByTestId('workflow-run-output')).toHaveCount(0);
      },
    );
    await test.step('And the canvas shows "Failed" on "Analyse" and "Skipped" on "Wrap up"', async () => {
      await expect(nodeStatus(page, 'receive-question')).toHaveText('Done');
      await expect(nodeStatus(page, 'load-catalog')).toHaveText('Done');
      await expect(nodeStatus(page, 'analyse')).toHaveText('Failed');
      await expect(nodeStatus(page, 'wrap-up')).toHaveText('Skipped');
    });
  });
});

/** A canvas node's run status chip (ui.md 4.4b). */
function nodeStatus(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-node-${id}`).getByTestId('workflow-node-status');
}

test.describe('Feature: Workflows (the designer)', () => {
  test(
    'A workflow opens as a designer',
    { tag: ['@demo', '@story-1.23.10'] },
    async ({ page }) => {
      await scenarioStep(page, 'When I open "Questions to Insights v2" from Workflows', async () => {
        await openWorkflows(page);
        await openWorkflow(page, V2_ID, V2);
      });
      await scenarioStep(
        page,
        'Then the canvas shows Start, its four steps in order with their badges, and End, left to right',
        async () => {
          const canvas = page.getByTestId('workflow-canvas');
          await expect(canvas.getByTestId('workflow-node-start')).toContainText('Start');
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(canvas.getByTestId('workflow-node-kind')).toHaveText([
            'CODE',
            'CODE',
            'LLM',
            'CODE',
          ]);
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
        'And the right panel is open on Run beside the canvas, with the Workflow state panel under the canvas',
        async () => {
          const panel = detailsPanel(page);
          await expectRunPanel(page);
          await expect(panel.getByRole('tab')).toHaveCount(0);
          const canvasBox = await page.getByTestId('workflow-canvas').boundingBox();
          const panelBox = await panel.boundingBox();
          expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(panelBox!.x);
          const state = page.getByTestId('workflow-state');
          await expect(state.getByTestId('workflow-state-toggle')).toHaveAttribute(
            'aria-expanded',
            'true',
          );
          const stateBox = await state.boundingBox();
          expect(canvasBox!.y + canvasBox!.height).toBeLessThanOrEqual(stateBox!.y + 1);
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
          await expect(dialog.getByTestId('workflow-panel-output')).toHaveText(
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
        'Then "Analyse" is selected on the canvas and in the Workflow state panel',
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
            'list_entities, describe_entity, run_readonly_sql',
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
        'Then I see the answer and "Done" on the four canvas nodes',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
          for (const [id] of V2_STEP_IDS) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
          }
        },
      );
    },
  );

  test(
    "A run shows each node's data in the Workflow state panel and the node dialog",
    { tag: ['@demo'] },
    async ({ page }) => {
      await test.step('Given I am on the "Questions to Insights v2" page', async () => {
        await openWorkflows(page);
        await openV2FromRun(page);
      });
      await test.step(`When I run it on "${QUESTION}"`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, QUESTION);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      });
      await test.step(
        'Then every connector is done and the Workflow state panel reads "6 of 6 nodes ran"',
        async () => {
          const connectors = page
            .getByTestId('workflow-canvas')
            .locator('path[data-testid^="workflow-connector-"]');
          await expect(connectors).toHaveCount(5);
          for (const connector of await connectors.all()) {
            await expect(connector).toHaveAttribute('data-done', 'true');
          }
          await expect(page.getByTestId('workflow-state-progress')).toHaveText(
            '6 of 6 nodes ran',
          );
          await expect(page.getByTestId('workflow-state-status')).toHaveText('success');
        },
      );
      await test.step('When I double-click "Wrap up"', async () => {
        await openNode(page, 'wrap-up', 'Wrap up');
      });
      await test.step(
        "Then its Input holds the Analyse step's SQL call and its Output the counts",
        async () => {
          const dialog = nodeDialog(page);
          await expect(dialog.getByTestId('workflow-ndv-output-status')).toHaveText('Done');
          const input = dialog.getByTestId('workflow-ndv-input').getByTestId('workflow-data-json');
          await expect(input).toContainText('"calls"');
          await expect(input).toContainText('run_readonly_sql');
          const output = dialog.getByTestId('workflow-ndv-output').getByTestId('workflow-data-json');
          await expect(output).toContainText('"sqlQueries"');
          await expect(output).toContainText('1');
          await expect(output).toContainText('"failedQueries"');
          await expect(output).toContainText('0');
          await closeNode(page);
        },
      );
      await test.step('When the model fails and I run it again', async () => {
        failTheModel();
        await page.getByTestId('workflow-run').click();
        await expect(page.getByTestId('workflow-run-status')).toHaveText(/^Run failed: \S/, {
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

  // A workflow's page: the canvas, the Workflow state panel and the Run panel.
  await openWorkflow(page, V2_ID, V2);
  await expect(drawnSteps(page)).toHaveCount(4);
  await expect(page.getByTestId('workflow-panel')).toBeVisible();
  await scan('Questions to Insights v2 page');

  await openNode(page, 'analyse', 'Analyse');
  await scan('Questions to Insights v2 page, Analyse dialog');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  await page.getByTestId('workflow-state-node-analyse').click();
  await expect(page.getByTestId('workflow-state-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('workflow-state-detail')).toBeVisible();
  await scan('Questions to Insights v2 page, Workflow state panel on Analyse');

  await backToWorkflows(page);
  await openV2FromRun(page);
  await page.getByTestId('workflow-execute').click();
  await runOnQuestion(page, QUESTION);
  await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
  await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
  await scan('Questions to Insights v2 page after a run');

  await openNode(page, 'wrap-up', 'Wrap up');
  await scan('Questions to Insights v2 page, Wrap up dialog after a run');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  failTheModel();
  await page.getByTestId('workflow-run').click();
  await expect(page.getByTestId('workflow-run-status')).toHaveText(/^Run failed: \S/, {
    timeout: FAILED_RUN_TIMEOUT,
  });
  await scan('Questions to Insights v2 page after a failed run');
});
