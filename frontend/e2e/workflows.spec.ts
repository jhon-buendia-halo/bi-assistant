import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import {
  createUserAgent,
  publishAgent,
  seedWorldCupDataset,
} from './helpers/agents-api';

/** Mirrors the Feature "Workflows" in specs/capabilities/workflows/spec.md. */

const V2 = 'Questions to Insights v2';
const V2_ID = 'qti-v2-turn';
const V2_STEPS = ['Receive question', 'Load catalog', 'Analyse', 'Wrap up'];
const HEALTH = 'Health plan analyst';
const RFP_REQUIREMENT =
  'Load the "Intellify RFP API" sample in Settings → Testing Data first';
const SEQ = 'Sequential test workflow';
const SEQ_ID = 'seq-text-demo';
const SEQ_STEPS = ['Clean text', 'Count words', 'Format result'];
/** The Official workflows in catalogue order (workflows R1). */
const OFFICIAL = [
  ['agent:assistant', 'Assistant'],
  [V2_ID, V2],
  [SEQ_ID, SEQ],
  ['deep-analysis', 'Deep analysis'],
  ['agent:data-readiness', 'Data Readiness Agent'],
  ['agent:rfp', 'RFP Builder'],
] as const;

/** The Background's published user agent (a user agent's key is its id). */
let healthId = '';

test.beforeEach(async ({ page }) => {
  // Background
  await seedWorldCupDataset(page);
  healthId = await createUserAgent(page, {
    name: HEALTH,
    description: 'Answers questions about the 2026 health plan',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, healthId);
});

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
        'Then I see "Assistant", "Questions to Insights v2", "Data Readiness Agent" and "RFP Builder" under Official',
        async () => {
          await expect(railItem(page, 'Workflows')).toHaveAttribute(
            'aria-current',
            'page',
          );
          const official = section(page, 'official');
          await expect(
            official.getByTestId('workflow-card-agent:assistant'),
          ).toBeVisible();
          expect(await cardIds(official)).toEqual(OFFICIAL.map(([id]) => id));
          for (const [id, name] of OFFICIAL) {
            await expect(official.getByTestId(`workflow-${id}`)).toContainText(
              name,
            );
          }
          await expect(official.getByTestId(`workflow-kind-${V2_ID}`)).toHaveText(
            '4 steps',
          );
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
      await scenarioStep(page, 'When I click "Workflows" in the breadcrumb', async () => {
        await backToWorkflows(page);
      });
      await scenarioStep(
        page,
        `And I open "${HEALTH}" under Mine`,
        async () => {
          const mine = section(page, 'mine');
          await expect(mine.getByTestId(`workflow-kind-agent:${healthId}`)).toHaveText(
            'One step',
          );
          await expect(
            mine.getByTestId(`workflow-uses-agent:${healthId}`),
          ).toHaveText(`Uses ${HEALTH}`);
          await mine.getByTestId(`workflow-agent:${healthId}`).click();
          await expect(page.getByTestId('workflow-detail-name')).toHaveText(
            HEALTH,
          );
        },
      );
      await scenarioStep(
        page,
        'Then I see "One step" and its single "Answer" step',
        async () => {
          await expect(page.getByTestId('workflow-detail-kind')).toHaveText(
            'One step',
          );
          await expect(drawnSteps(page)).toHaveText(['Answer']);
          const start = await openNode(page, 'start', 'Start');
          await expect(start.getByTestId(`workflow-agent-${healthId}`)).toContainText(HEALTH);
          await closeNode(page);
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

  test('A workflow that cannot run says why', async ({ page }) => {
    await test.step('When I open Workflows', async () => {
      await openWorkflows(page);
    });
    await test.step(
      'Then the "RFP Builder" card has Run and no Start chat',
      async () => {
        const card = page.getByTestId('workflow-card-agent:rfp');
        await expect(
          card.getByRole('button', { name: 'Run RFP Builder' }),
        ).toBeVisible();
        await expect(card.getByRole('button', { name: /Start chat/ })).toHaveCount(0);
      },
    );
    await test.step('When I open "RFP Builder" and click Execute', async () => {
      await openWorkflow(page, 'agent:rfp', 'RFP Builder');
      await page.getByTestId('workflow-execute').click();
    });
    await test.step(
      'Then its Run panel writes the requirement and its Execute is disabled',
      async () => {
        await expect(page.getByTestId('workflow-run-requirement')).toHaveText(
          RFP_REQUIREMENT,
        );
        await expect(page.getByTestId('workflow-run')).toBeDisabled();
      },
    );
  });

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
    await test.step('When I search for "rfp"', async () => {
      await expect(search).toHaveAttribute(
        'placeholder',
        'Search workflows by name or description',
      );
      await search.fill('rfp');
    });
    await test.step('Then only the "RFP Builder" card is shown', async () => {
      await expect(page.getByTestId('workflow-card-agent:rfp')).toBeVisible();
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

/** Opens the sequential test workflow's page from its card's Run. */
async function openSeqFromRun(page: Page): Promise<void> {
  await page.getByTestId(`workflow-run-open-${SEQ_ID}`).click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(SEQ);
}

test.describe('Feature: Workflows (run workflows)', () => {
  test(
    'I run the sequential test workflow on a text',
    { tag: ['@demo', '@story-1.23.9'] },
    async ({ page }) => {
      await scenarioStep(page, 'When I open Workflows', async () => {
        await openWorkflows(page);
      });
      await scenarioStep(
        page,
        'Then I see "Sequential test workflow" with "3 steps" and no Start chat',
        async () => {
          const card = page.getByTestId(`workflow-card-${SEQ_ID}`);
          await expect(card).toBeVisible();
          await expect(page.getByTestId(`workflow-${SEQ_ID}`)).toContainText(SEQ);
          await expect(page.getByTestId(`workflow-kind-${SEQ_ID}`)).toHaveText(
            '3 steps',
          );
          await expect(page.getByTestId(`workflow-start-chat-${SEQ_ID}`)).toHaveCount(0);
          await expect(card.getByRole('button', { name: /start chat/i })).toHaveCount(0);
          await expect(page.getByTestId(`workflow-run-open-${SEQ_ID}`)).toHaveAccessibleName(
            `Run ${SEQ}`,
          );
        },
      );
      await scenarioStep(page, 'When I click its Run', async () => {
        await openSeqFromRun(page);
      });
      await scenarioStep(
        page,
        'Then I see its three steps on the canvas, Execute and no Start chat',
        async () => {
          await expect(drawnSteps(page)).toHaveText(SEQ_STEPS);
          await expect(page.getByTestId('workflow-detail-kind')).toHaveText(
            '3 steps',
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
        'Then the Run panel shows the "Text" input',
        async () => {
          await expectRunPanel(page);
          const text = detailsPanel(page).getByLabel('Text', { exact: true });
          await expect(text).toBeVisible();
          // Execute workflow only opens the form and focuses it; nothing ran.
          await expect(text).toBeFocused();
          await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
          await expect(text).toHaveAttribute('placeholder', 'Paste or type any text');
          await expect(text).toHaveAttribute('aria-required', 'true');
        },
      );
      await scenarioStep(
        page,
        'When I type "  Hello   workflow   world  "',
        async () => {
          await page.getByTestId('workflow-input-text').fill('  Hello   workflow   world  ');
        },
      );
      await scenarioStep(page, 'And I click Execute in the panel', async () => {
        await page.getByTestId('workflow-run').click();
      });
      await scenarioStep(
        page,
        'Then I see "Run succeeded" with "Clean text", "Count words" and "Format result" all "Done"',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          for (const [id, title] of [
            ['clean-text', 'Clean text'],
            ['count-words', 'Count words'],
            ['format-result', 'Format result'],
          ]) {
            await expect(runStep(page, id)).toContainText(title);
            await expect(runStep(page, id).getByText('Done', { exact: true })).toBeVisible();
          }
          await expect(page.getByTestId('workflow-run')).toHaveText('Execute');
          await expect(page.getByTestId('workflow-run')).toBeEnabled();
        },
      );
      await scenarioStep(
        page,
        'And the output summary is "3 words, 20 characters: "Hello workflow world""',
        async () => {
          await expect(page.getByTestId('workflow-run-output')).toContainText(
            '3 words, 20 characters: "Hello workflow world"',
          );
        },
      );
    },
  );

  test('A failing step stops the run', async ({ page }) => {
    await test.step('Given I am on the "Sequential test workflow" page', async () => {
      await openWorkflows(page);
      await openSeqFromRun(page);
    });
    await test.step('When I run it on a text of only spaces', async () => {
      await page.getByTestId('workflow-execute').click();
      await page.getByTestId('workflow-input-text').fill('   ');
      await page.getByTestId('workflow-run').click();
    });
    await test.step('Then I see "Run failed: The text is empty"', async () => {
      await expect(page.getByTestId('workflow-run-status')).toHaveText(
        'Run failed: The text is empty',
      );
    });
    await test.step(
      'And "Clean text" is "Failed" and "Count words" and "Format result" are "Skipped"',
      async () => {
        await expect(runStep(page, 'clean-text').getByText('Failed', { exact: true })).toBeVisible();
        await expect(runStep(page, 'clean-text')).toContainText('The text is empty');
        await expect(runStep(page, 'count-words').getByText('Skipped', { exact: true })).toBeVisible();
        await expect(runStep(page, 'format-result').getByText('Skipped', { exact: true })).toBeVisible();
        await expect(page.getByTestId('workflow-run-output')).toHaveCount(0);
      },
    );
    await test.step('And the canvas shows "Failed" on "Clean text" and "Skipped" on the others', async () => {
      await expect(nodeStatus(page, 'clean-text')).toHaveText('Failed');
      await expect(nodeStatus(page, 'count-words')).toHaveText('Skipped');
      await expect(nodeStatus(page, 'format-result')).toHaveText('Skipped');
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
      await scenarioStep(
        page,
        'When I open "Sequential test workflow" and click Execute workflow',
        async () => {
          await backToWorkflows(page);
          await openSeqFromRun(page);
          await page.getByTestId('workflow-execute').click();
        },
      );
      await scenarioStep(page, 'Then the Run panel focuses its input and nothing runs', async () => {
        await expectRunPanel(page);
        await expect(page.getByTestId('workflow-input-text')).toBeFocused();
        await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
      });
      await scenarioStep(page, 'When I type a text and click Execute', async () => {
        await page.getByTestId('workflow-input-text').fill('Hello workflow world');
        await page.getByTestId('workflow-run').click();
      });
      await scenarioStep(
        page,
        'Then I see the result and "Done" on the three canvas nodes',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          for (const id of ['clean-text', 'count-words', 'format-result']) {
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
      await test.step('Given I am on the "Sequential test workflow" page', async () => {
        await openWorkflows(page);
        await openSeqFromRun(page);
      });
      await test.step('When I run it on "Hello workflow world"', async () => {
        await page.getByTestId('workflow-execute').click();
        await page.getByTestId('workflow-input-text').fill('Hello workflow world');
        await page.getByTestId('workflow-run').click();
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      });
      await test.step(
        'Then every connector is done and the Workflow state panel reads "5 of 5 nodes ran"',
        async () => {
          const connectors = page
            .getByTestId('workflow-canvas')
            .locator('path[data-testid^="workflow-connector-"]');
          await expect(connectors).toHaveCount(4);
          for (const connector of await connectors.all()) {
            await expect(connector).toHaveAttribute('data-done', 'true');
          }
          await expect(page.getByTestId('workflow-state-progress')).toHaveText(
            '5 of 5 nodes ran',
          );
          await expect(page.getByTestId('workflow-state-status')).toHaveText('success');
        },
      );
      await test.step('When I double-click "Count words"', async () => {
        await openNode(page, 'count-words', 'Count words');
      });
      await test.step(
        'Then its Input holds the cleaned text and its Output the counts',
        async () => {
          const dialog = nodeDialog(page);
          await expect(dialog.getByTestId('workflow-ndv-output-status')).toHaveText('Done');
          const input = dialog.getByTestId('workflow-ndv-input').getByTestId('workflow-data-json');
          await expect(input).toContainText('"text"');
          await expect(input).toContainText('Hello workflow world');
          const output = dialog.getByTestId('workflow-ndv-output').getByTestId('workflow-data-json');
          await expect(output).toContainText('"words"');
          await expect(output).toContainText('3');
          await expect(output).toContainText('"characters"');
          await expect(output).toContainText('20');
          await closeNode(page);
        },
      );
      await test.step('When I run it on a text of only spaces', async () => {
        await page.getByTestId('workflow-input-text').fill('   ');
        await page.getByTestId('workflow-run').click();
        await expect(page.getByTestId('workflow-run-status')).toHaveText(
          'Run failed: The text is empty',
        );
      });
      await test.step('Then the "Clean text" dialog shows the error in its Output', async () => {
        const dialog = await openNode(page, 'clean-text', 'Clean text');
        await expect(dialog.getByTestId('workflow-ndv-output-error')).toContainText(
          'The text is empty',
        );
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
  await expect(section(page, 'mine')).toBeVisible();
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
  await openWorkflow(page, 'agent:rfp', 'RFP Builder');
  await expect(page.getByTestId('workflow-execute')).toBeVisible();
  await scan('RFP Builder page');

  await backToWorkflows(page);
  await openSeqFromRun(page);
  await page.getByTestId('workflow-execute').click();
  await page.getByTestId('workflow-input-text').fill('Hello workflow world');
  await page.getByTestId('workflow-run').click();
  await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
  await scan('Sequential test workflow page after a run');

  await openNode(page, 'count-words', 'Count words');
  await scan('Sequential test workflow page, Count words dialog after a run');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  await page.getByTestId('workflow-input-text').fill('   ');
  await page.getByTestId('workflow-run').click();
  await expect(page.getByTestId('workflow-run-status')).toHaveText(
    'Run failed: The text is empty',
  );
  await scan('Sequential test workflow page after a failed run');
});
