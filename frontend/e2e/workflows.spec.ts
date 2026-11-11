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
/** The Official workflows in catalogue order (workflows R1). */
const OFFICIAL = [
  ['agent:assistant', 'Assistant'],
  [V2_ID, V2],
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

function drawnSteps(page: Page): Locator {
  return page.getByTestId('agent-workflow').getByTestId('workflow-step-title');
}

test.describe('Feature: Workflows', () => {
  test(
    'Open a workflow and start a chat from it',
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
        'Then I see its four steps in the drawing and the agent "Questions to Insights v2" under Agents',
        async () => {
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(page.getByTestId('workflow-bar-note')).toHaveText(
            'In a chat, the workflow bar shows these steps as they run.',
          );
          const agent = page.getByTestId('workflow-agent-assistant-v2');
          await expect(agent).toHaveAccessibleName(`Open agent ${V2}`);
          await expect(agent).toContainText('Official');
          await expect(railItem(page, 'Workflows')).toHaveAttribute(
            'aria-current',
            'page',
          );
        },
      );
      await scenarioStep(page, 'When I click "All workflows"', async () => {
        await page.getByTestId('workflow-back').click();
        await expect(section(page, 'official')).toBeVisible();
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
          await expect(page.getByTestId('workflow-bar-note')).toHaveText(
            "In a chat, the workflow bar shows the agent's own steps as it sets them.",
          );
          await expect(page.getByTestId(`workflow-agent-${healthId}`)).toContainText(
            'You',
          );
        },
      );
      await scenarioStep(page, 'When I click "Start chat"', async () => {
        await page.getByTestId('workflow-start-chat').click();
      });
      await scenarioStep(
        page,
        `Then I see "Session "${HEALTH}" created" and the chat opens`,
        async () => {
          await expect(
            page.getByText(`Session "${HEALTH}" created`, { exact: true }),
          ).toBeVisible();
          await expect(page.getByPlaceholder('Ask a follow-up question…')).toBeVisible();
          await expect(
            page.getByRole('heading', { name: HEALTH, exact: true }),
          ).toBeVisible();
          await expect(railItem(page, 'Sessions')).toHaveAttribute(
            'aria-current',
            'page',
          );
        },
      );
    },
  );

  test('A workflow that cannot start says why', async ({ page }) => {
    await test.step('When I open Workflows', async () => {
      await openWorkflows(page);
    });
    await test.step(
      'Then the "RFP Builder" card\'s Start chat is disabled with its requirement as the title',
      async () => {
        const start = page.getByTestId('workflow-start-chat-agent:rfp');
        await expect(start).toBeDisabled();
        await expect(start).toHaveAttribute('title', RFP_REQUIREMENT);
        await expect(start).toHaveAccessibleName('Start chat with RFP Builder');
      },
    );
    await test.step('When I open "RFP Builder"', async () => {
      await openWorkflow(page, 'agent:rfp', 'RFP Builder');
    });
    await test.step(
      'Then its Start chat is disabled and the requirement is written beside it',
      async () => {
        const start = page.getByTestId('workflow-start-chat');
        await expect(start).toBeDisabled();
        await expect(start).toHaveAttribute('title', RFP_REQUIREMENT);
        await expect(page.getByTestId('workflow-chat-requirement')).toHaveText(
          RFP_REQUIREMENT,
        );
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
      'Then I see no Edit, New, Delete or step-reorder control on its page',
      async () => {
        const detail = page.getByTestId('workflow-detail-page');
        await expect(drawnSteps(page)).toHaveCount(4);
        await expect(detail.getByRole('button', { name: editing })).toHaveCount(
          0,
        );
        await expect(detail.locator('[draggable="true"]')).toHaveCount(0);
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

  await openWorkflow(page, V2_ID, V2);
  await expect(drawnSteps(page)).toHaveCount(4);
  await scan('Questions to Insights v2 page');

  await page.getByTestId('workflow-back').click();
  await openWorkflow(page, 'agent:rfp', 'RFP Builder');
  await expect(page.getByTestId('workflow-chat-requirement')).toBeVisible();
  await scan('RFP Builder page');
});
