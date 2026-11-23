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
import {
  answerPickAsk,
  closeComposerMenu,
  composer,
  fillRun,
  pickedDataset,
  sendButton,
  sendRun,
  setRunOption,
  unfoldMenuItem,
} from './helpers/run-ui';
import { worldCupKey } from './helpers/world-cup-db';

/** Mirrors the Feature "Workflows" in specs/capabilities/workflows/spec.md. */

const V2 = 'Answer a Business Question';
const V2_ID = 'answer-business-question';
/**
 * Its steps in catalogue order: Read images (only with images), Receive
 * question, Load catalog, Plan (which asks its own clarifying question and
 * waits for the answer), then Analyse and Validate (retried once), Write
 * answer, Build visual and Wrap up.
 */
const V2_STEP_IDS = [
  ['read-images', 'Read images'],
  ['receive-question', 'Receive question'],
  ['load-catalog', 'Load catalog'],
  ['plan', 'Plan'],
  ['analyse', 'Analyse'],
  ['validate', 'Validate'],
  ['write-answer', 'Write answer'],
  ['build-visual', 'Build visual'],
  ['wrap-up', 'Wrap up'],
] as const;
/**
 * The steps a clear question runs: the canvas's main path, left to right.
 * Build visual (on by default) is on it; Read images (only when the run has
 * images) is a branch off it.
 */
const V2_MAIN_STEP_IDS = V2_STEP_IDS.filter(([id]) => id !== 'read-images');
/** The steps a question that needs clarification skips. */
const V2_ANALYSIS_STEP_IDS = ['analyse', 'validate', 'write-answer'] as const;
/** The step titles as the canvas lists them. */
const V2_STEPS = V2_STEP_IDS.map(([, title]) => title);
const V2_STEP_COUNT = `${V2_STEP_IDS.length} steps`;
const ORCHESTRATED_ID = 'orchestrated-answer';
const ORCHESTRATED = 'Answer a Business Question (orchestrated)';
const AVERY_MICHAEL_ID = 'orchestrated-answer-michael';
const AVERY_MICHAEL = 'Answer a Business Question (Avery + Michael)';
const READINESS_ID = 'data-readiness-assessment';
const READINESS = 'Assess Data Readiness';
/** The User journeys sections, each with its workflows in catalogue order (workflows R1, R5). */
const SECTIONS = [
  {
    id: 'data-analytics',
    heading: 'Data Analytics',
    workflows: [
      [V2_ID, V2],
      [ORCHESTRATED_ID, ORCHESTRATED],
      [AVERY_MICHAEL_ID, AVERY_MICHAEL],
    ],
  },
  {
    id: 'data-engineering',
    heading: 'Data Engineering',
    workflows: [
      [READINESS_ID, READINESS],
      ['consumption-gap-analysis', 'Consumption Gap Analysis'],
    ],
  },
  {
    id: 'dashboards',
    heading: 'Dashboards',
    workflows: [
      ['recreate-dashboard', 'Dashboard Image to Artifact'],
      ['map-dashboard-data', 'Map a Dashboard to Data'],
    ],
  },
  {
    id: 'software-development',
    heading: 'Software Development',
    workflows: [['review-website', 'Review a Website']],
  },
] as const;
const WORKFLOW_COUNT = SECTIONS.reduce((n, s) => n + s.workflows.length, 0);

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
      name:
        request.tools.find((tool) => tool.endsWith('run_readonly_sql')) ??
        'run_readonly_sql',
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
      name:
        request.tools.find((tool) => tool.endsWith('run_readonly_sql')) ??
        'run_readonly_sql',
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
  await railItem(page, 'User journeys').click();
  await expect(
    page.getByRole('heading', { name: 'User journeys', exact: true }),
  ).toBeVisible();
}

function section(page: Page, id: string): Locator {
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
async function openNode(
  page: Page,
  id: string,
  title: string,
): Promise<Locator> {
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
async function openTool(
  page: Page,
  stepId: string,
  tool: string,
): Promise<Locator> {
  const menu = await openToolsMenu(page, stepId);
  await menu.getByRole('menuitem', { name: tool, exact: true }).click();
  await expect(menu).toHaveCount(0);
  const dialog = nodeDialog(page);
  await expect(dialog.getByTestId('workflow-ndv-title')).toHaveText(tool);
  return dialog;
}

/** Unfold the node dialog's Input or Output, which start collapsed (ui.md 4.4b). */
async function expandNodeSection(
  page: Page,
  section: 'input' | 'output',
): Promise<Locator> {
  const dialog = nodeDialog(page);
  const toggle = dialog.getByTestId(`workflow-ndv-${section}-toggle`);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return dialog.getByTestId(`workflow-ndv-${section}`);
}

/**
 * An agent step's collapsed cards (ui.md 4.4b): unfold What it received (`input`), What it returned
 * (`output`) or How it's set up (`params`). Does nothing when the card is already open.
 */
async function unfoldAgentCard(
  page: Page,
  card: 'input' | 'output' | 'params',
): Promise<Locator> {
  const dialog = nodeDialog(page);
  const toggle = dialog.getByTestId(`workflow-ndv-${card}-toggle`);
  if ((await toggle.getAttribute('aria-expanded')) === 'false')
    await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return dialog.getByTestId(`workflow-ndv-${card}`);
}

async function closeNode(page: Page): Promise<void> {
  await nodeDialog(page).getByTestId('workflow-ndv-close').click();
  await expect(nodeDialog(page)).toHaveCount(0);
}

/** The Run panel (the Chat) on the right of the canvas, which Execute workflow unfolds. */
function runDock(page: Page): Locator {
  return page.getByTestId('workflow-run-dock');
}

/** The Run panel is unfolded on the right of the canvas, with the composer in its Chat. */
async function expectRunPanel(page: Page): Promise<void> {
  await expect(
    runDock(page).getByRole('heading', { name: 'Run', exact: true }),
  ).toBeVisible();
  await expect(
    runDock(page).getByTestId('workflow-state-toggle'),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    runDock(page)
      .getByTestId('workflow-run-chat')
      .getByTestId('run-composer-input'),
  ).toBeVisible();
}

/**
 * A node on the canvas: its status in the run shown is `data-status`
 * (`success`, `running`, `suspended`, `failed`, `skipped`, `stopped`).
 */
function canvasNode(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-node-${id}`);
}

/** New question: drops the run shown and the question, keeps the datasets; types `question`. */
async function newQuestion(page: Page, question: string): Promise<void> {
  await page.getByTestId('workflow-run-new').click();
  await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
  await composer(page).fill(question);
}

/** Back to the list from a workflow's page. */
async function backToWorkflows(page: Page): Promise<void> {
  await page.getByTestId('workflow-breadcrumb').click();
  await expect(section(page, 'data-analytics')).toBeVisible();
}

/** Adds the World Cup dataset through +, types `question` and clicks Send in the panel. */
async function runOnQuestion(page: Page, question: string): Promise<void> {
  await fillRun(page, question, WORLD_CUP_DATASET);
  await sendRun(page);
}

/** A question over the longest a run takes (4000 characters): the form refuses it. */
const TOO_LONG_QUESTION = 'x'.repeat(4001);
const TOO_LONG_ERROR = 'Question must be at most 4000 characters';

test.describe('Feature: Workflows', () => {
  test(
    'Open a workflow and run it from its page',
    { tag: ['@demo', '@story-1.23.5'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        'When I click "User journeys" on the rail',
        async () => {
          await openWorkflows(page);
        },
      );
      await scenarioStep(
        page,
        'Then I see the user journeys grouped by category: "Answer a Business Question" and its orchestrated and Avery + Michael versions under Data Analytics, "Assess Data Readiness" and "Consumption Gap Analysis" under Data Engineering, "Dashboard Image to Artifact" and "Map a Dashboard to Data" under Dashboards, and "Review a Website" under Software Development',
        async () => {
          await expect(railItem(page, 'User journeys')).toHaveAttribute(
            'aria-current',
            'page',
          );
          await expect(
            page.locator('[data-testid^="workflow-section-"]'),
          ).toHaveCount(SECTIONS.length);
          for (const { id, heading, workflows } of SECTIONS) {
            const scope = section(page, id);
            await expect(
              scope.getByRole('heading', { name: heading, exact: true }),
            ).toBeVisible();
            expect(await cardIds(scope)).toEqual(workflows.map(([wid]) => wid));
            for (const [wid, name] of workflows) {
              await expect(scope.getByTestId(`workflow-${wid}`)).toContainText(
                name,
              );
            }
          }
          await expect(page.getByTestId(`workflow-kind-${V2_ID}`)).toHaveText(
            V2_STEP_COUNT,
          );
          await expect(
            page.getByTestId(`workflow-kind-${ORCHESTRATED_ID}`),
          ).toHaveText('1 step');
          await expect(
            page.getByTestId(`workflow-kind-${READINESS_ID}`),
          ).toHaveText('8 steps');
          await expect(
            page.locator('[data-testid^="workflow-card-"]'),
          ).toHaveCount(WORKFLOW_COUNT);
        },
      );
      await scenarioStep(
        page,
        'When I open "Answer a Business Question"',
        async () => {
          await openWorkflow(page, V2_ID, V2);
        },
      );
      await scenarioStep(
        page,
        'Then I see its nine steps on the canvas and the agent personas Michael, Zoe, Olivia, Jessica and Ryan under Agent personas in its Start node',
        async () => {
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(page.getByTestId('workflow-bar-note')).toHaveCount(0);
          const start = await openNode(page, 'start', 'Start');
          // Each agent persona with its role (R39).
          await expect(
            start.getByTestId('workflow-agent-insights-analyst'),
          ).toContainText('Michael, Insights Analyst');
          await expect(
            start.getByTestId('workflow-agent-image-reader'),
          ).toContainText('Zoe, Image Analyst');
          await expect(
            start.getByTestId('workflow-agent-result-explorer'),
          ).toHaveCount(0);
          await closeNode(page);
          await expect(railItem(page, 'User journeys')).toHaveAttribute(
            'aria-current',
            'page',
          );
        },
      );
      await scenarioStep(
        page,
        'When I click "Execute user journey"',
        async () => {
          await page.getByTestId('workflow-execute').click();
        },
      );
      await scenarioStep(
        page,
        'Then the Run panel is on the left of the canvas, there is no Details panel and no chat is started',
        async () => {
          await expectRunPanel(page);
          await expect(detailsPanel(page)).toHaveCount(0);
          await expect(page.getByTitle('Expand right panel')).toHaveCount(0);
          const canvasBox = await page
            .getByTestId('workflow-canvas')
            .boundingBox();
          const dockBox = await runDock(page).boundingBox();
          expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(
            canvasBox!.x + 1,
          );
          // No Logs panel: the canvas takes the column's full height.
          await expect(page.getByTestId('workflow-logs-dock')).toHaveCount(0);
          await expect(page.getByTestId('workflow-start-chat')).toHaveCount(0);
          await expect(railItem(page, 'User journeys')).toHaveAttribute(
            'aria-current',
            'page',
          );
        },
      );
    },
  );

  test("Workflows can't be edited", async ({ page }) => {
    const editing =
      /^(edit|new|delete|remove|add|move|reorder|duplicate|rename|save)\b/i;
    await test.step('When I open User journeys', async () => {
      await openWorkflows(page);
    });
    await test.step('Then I see no Edit, New, Delete or reorder control on the list', async () => {
      const list = page.getByTestId('workflows-page');
      await expect(list.getByTestId(`workflow-card-${V2_ID}`)).toBeVisible();
      await expect(list.getByRole('button', { name: editing })).toHaveCount(0);
      await expect(list.locator('[draggable="true"]')).toHaveCount(0);
    });
    await test.step('When I open "Answer a Business Question"', async () => {
      await openWorkflow(page, V2_ID, V2);
    });
    await test.step('Then I see no Edit, New, Delete or step-reorder control on its page or in its Run panel', async () => {
      await expect(drawnSteps(page)).toHaveCount(V2_STEPS.length);
      for (const scope of [
        page.getByTestId('workflow-detail-page'),
        page.getByTestId('workflow-run-chat'),
      ]) {
        await expect(scope).toBeVisible();
        // The composer's + (Add inputs and options) fills the run's input; it
        // does not edit the workflow, so it is left out of this check.
        const outsideRunInput = page.locator(
          ':not([data-testid="run-composer"] *)',
        );
        await expect(
          scope.getByRole('button', { name: editing }).and(outsideRunInput),
        ).toHaveCount(0);
        await expect(scope.locator('[draggable="true"]')).toHaveCount(0);
        await expect(scope.locator('[contenteditable="true"]')).toHaveCount(0);
      }
    });
  });

  test('Search filters the list', async ({ page }) => {
    await test.step('Given I am on User journeys', async () => {
      await openWorkflows(page);
    });
    const search = page.getByTestId('workflow-search');
    await test.step('When I search for "business"', async () => {
      await expect(search).toHaveAttribute(
        'placeholder',
        'Search user journeys by name or description',
      );
      await search.fill('business');
    });
    await test.step('Then only the "Answer a Business Question" card and its orchestrated and Avery + Michael versions are shown', async () => {
      await expect(page.getByTestId(`workflow-card-${V2_ID}`)).toBeVisible();
      await expect(
        page.getByTestId(`workflow-card-${ORCHESTRATED_ID}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`workflow-card-${AVERY_MICHAEL_ID}`),
      ).toBeVisible();
      await expect(page.locator('[data-testid^="workflow-card-"]')).toHaveCount(
        3,
      );
      await expect(
        page.locator('[data-testid^="workflow-section-"]'),
      ).toHaveCount(1);
    });
    await test.step('When I search for "zzz"', async () => {
      await search.fill('zzz');
    });
    await test.step('Then I see "No user journeys match "zzz""', async () => {
      await expect(
        page.getByText('No user journeys match "zzz"', { exact: true }),
      ).toBeVisible();
      await expect(page.locator('[data-testid^="workflow-card-"]')).toHaveCount(
        0,
      );
    });
  });

  test('A category pill shows only its user journeys', async ({ page }) => {
    const pills = page.getByRole('group', {
      name: 'Filter user journeys by category',
    });
    await scenarioStep(page, 'Given I am on User journeys', async () => {
      await openWorkflows(page);
    });
    await scenarioStep(
      page,
      'Then I see the pills All, Data Analytics, Data Engineering, Dashboards and Software Development, with All pressed',
      async () => {
        await expect(pills.getByRole('button')).toHaveText([
          'All',
          ...SECTIONS.map((s) => s.heading),
        ]);
        await expect(page.getByTestId('workflow-filter-all')).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      },
    );
    await scenarioStep(page, 'When I click "Dashboards"', async () => {
      await pills.getByRole('button', { name: 'Dashboards' }).click();
    });
    await scenarioStep(
      page,
      'Then only the Dashboards section shows, with "Dashboard Image to Artifact" and "Map a Dashboard to Data"',
      async () => {
        await expect(
          page.getByTestId('workflow-filter-dashboards'),
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(
          page.locator('[data-testid^="workflow-section-"]'),
        ).toHaveCount(1);
        expect(await cardIds(section(page, 'dashboards'))).toEqual([
          'recreate-dashboard',
          'map-dashboard-data',
        ]);
      },
    );
    await scenarioStep(page, 'When I click "All"', async () => {
      await pills.getByRole('button', { name: 'All', exact: true }).click();
    });
    await scenarioStep(page, 'Then every section shows again', async () => {
      await expect(
        page.locator('[data-testid^="workflow-section-"]'),
      ).toHaveCount(SECTIONS.length);
    });
  });
});

/** A run's step on the canvas (workflows R13): its status is `data-status`. */
function runStep(page: Page, id: string): Locator {
  return canvasNode(page, id);
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
      await scenarioStep(page, 'When I open User journeys', async () => {
        await openWorkflows(page);
      });
      await scenarioStep(
        page,
        'Then I see "Answer a Business Question" with "9 steps" and no Start chat',
        async () => {
          const card = page.getByTestId(`workflow-card-${V2_ID}`);
          await expect(card).toBeVisible();
          await expect(page.getByTestId(`workflow-${V2_ID}`)).toContainText(V2);
          await expect(page.getByTestId(`workflow-kind-${V2_ID}`)).toHaveText(
            V2_STEP_COUNT,
          );
          await expect(
            page.getByTestId(`workflow-start-chat-${V2_ID}`),
          ).toHaveCount(0);
          await expect(
            card.getByRole('button', { name: /start chat/i }),
          ).toHaveCount(0);
          await expect(
            page.getByTestId(`workflow-run-open-${V2_ID}`),
          ).toHaveAccessibleName(`Run ${V2}`);
        },
      );
      await scenarioStep(page, 'When I click its Run', async () => {
        await openV2FromRun(page);
      });
      await scenarioStep(
        page,
        'Then I see its nine steps on the canvas, Execute user journey and no Start chat',
        async () => {
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(page.getByTestId('workflow-detail-kind')).toHaveText(
            V2_STEP_COUNT,
          );
          await expect(page.getByTestId('workflow-execute')).toHaveText(
            'Execute user journey',
          );
          await expect(page.getByTestId('workflow-start-chat')).toHaveCount(0);
          await expect(page.getByTestId('workflow-bar-note')).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        'When I click Execute user journey',
        async () => {
          await page.getByTestId('workflow-execute').click();
        },
      );
      await scenarioStep(
        page,
        `Then the Run panel's Chat shows the composer with its "+" button and no Execute button`,
        async () => {
          await expectRunPanel(page);
          const box = runDock(page).getByTestId('run-composer-input');
          // Execute user journey only opens the composer and focuses it; nothing ran.
          await expect(box).toBeFocused();
          await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
          await expect(box).toHaveAttribute('placeholder', /^Message \S/);
          await expect(
            runDock(page).getByTestId('run-composer-plus'),
          ).toHaveAccessibleName('Add inputs and options');
          await expect(
            runDock(page).getByTestId('run-composer-plus'),
          ).toHaveAttribute('aria-expanded', 'false');
          await expect(sendButton(page)).toBeDisabled();
          await expect(page.getByTestId('workflow-run')).toHaveCount(0);
          await expect(pickedDataset(page, WORLD_CUP_DATASET)).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        `When I type "${QUESTION}" and click Send`,
        async () => {
          // Approve each step is on by default; this run goes straight through.
          await setRunOption(page, 'approveSteps', false);
          await composer(page).fill(QUESTION);
          await sendRun(page);
        },
      );
      await scenarioStep(
        page,
        'Then the agent asks which datasets to use',
        async () => {
          await expect(page.getByTestId('run-user-message')).toHaveText(
            QUESTION,
          );
          await expect(
            page
              .getByTestId('run-intake-datasets')
              .getByTestId('run-agent-message'),
          ).toContainText('Pick one or more datasets.');
          await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        `When I add "${WORLD_CUP_DATASET}" and click "Continue with 1 dataset"`,
        async () => {
          await answerPickAsk(page, WORLD_CUP_DATASET);
        },
      );
      await scenarioStep(
        page,
        'Then I see "Run succeeded" with every step "Done" but "Read images", which is "Skipped"',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          for (const [id, title] of V2_MAIN_STEP_IDS) {
            await expect(runStep(page, id)).toContainText(title);
            await expect(runStep(page, id)).toHaveAttribute(
              'data-status',
              'success',
            );
          }
          await expect(runStep(page, 'read-images')).toHaveAttribute(
            'data-status',
            'skipped',
          );
          // How it ran, under the answer, tells the same run step by step.
          const howItRan = page.getByTestId('workflow-run-story');
          await howItRan.getByTestId('workflow-run-story-toggle').click();
          await expect(
            howItRan.getByTestId('workflow-run-story-step-clarify'),
          ).toHaveCount(0);
          // The run is over: no composer at all, and no follow-up.
          await expect(page.getByTestId('run-composer')).toHaveCount(0);
          await expect(
            page.getByTestId('workflow-follow-up-input'),
          ).toHaveCount(0);
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
      await scenarioStep(
        page,
        'Given I am on the "Answer a Business Question" page',
        async () => {
          await openWorkflows(page);
          await openV2FromRun(page);
        },
      );
      await scenarioStep(page, `When I run it on "${QUESTION}"`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, QUESTION);
      });
      await scenarioStep(
        page,
        'Then I see "Run succeeded" and the written answer',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
          // Plan and Write answer each called the model once, as structured steps.
          expect(
            stub.requests.filter((r) => r.step === 'plan').length,
          ).toBeGreaterThan(0);
          expect(
            stub.requests.filter((r) => r.step === 'answer').length,
          ).toBeGreaterThan(0);
        },
      );
      await scenarioStep(
        page,
        'And every step of the main path is "Done" on the canvas, and "Read images" is "Skipped" and muted',
        async () => {
          for (const [id] of V2_MAIN_STEP_IDS) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
            await expect(
              page.getByTestId(`workflow-node-${id}`),
            ).not.toHaveAttribute('data-skipped', 'true');
          }
          await expect(nodeStatus(page, 'read-images')).toHaveText('Skipped');
          await expect(
            page.getByTestId('workflow-node-read-images'),
          ).toHaveAttribute('data-skipped', 'true');
          await expect(
            page.getByTestId('workflow-connector-plan-analyse'),
          ).toHaveAttribute('data-done', 'true');
          // Validate passed the first time: nothing ran twice.
          await expect(page.getByTestId('workflow-node-attempts')).toHaveCount(
            0,
          );
        },
      );
      await scenarioStep(page, 'When I double-click "Plan"', async () => {
        await openNode(page, 'plan', 'Plan');
      });
      await scenarioStep(
        page,
        'Then its report shows the question, the measures, the entities, the scope and the assumptions',
        async () => {
          // An agent step is one column: its Story card, from the persona, comes first.
          await expect(
            nodeDialog(page).getByTestId('workflow-ndv-story-persona'),
          ).toBeVisible();
          // Its Story (api.md 3.6 `story`): the question as Plan read it, then the plan.
          const story = nodeDialog(page).getByTestId('workflow-step-story');
          await expect(
            story.getByTestId('workflow-step-story-headline'),
          ).toContainText(QUESTION);
          const facts = story.getByTestId('workflow-step-story-facts');
          await expect(facts).toContainText('Will measure');
          await expect(facts).toContainText('match count');
          await expect(facts.locator('code')).toHaveText(['matches']);
          await expect(facts).toContainText('The picked datasets');
          await expect(facts).toContainText(
            'Every match in the data counts once',
          );
          await expect(
            story.getByTestId('workflow-step-story-next'),
          ).toHaveText('Analyse ran next with this plan.');
          // The plan's own panel is in What it returned.
          await unfoldAgentCard(page, 'output');
          const view = nodeDialog(page).getByTestId('workflow-plan-view');
          await expect(view.getByTestId('workflow-plan-question')).toHaveText(
            QUESTION,
          );
          await expect(
            view.getByTestId('workflow-plan-clarification'),
          ).toHaveCount(0);
          // The raw data follows it in What it returned.
          await expect(
            nodeDialog(page)
              .getByTestId('workflow-ndv-output')
              .getByTestId('workflow-data-json'),
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
          await expandNodeSection(page, 'output');
          const view = nodeDialog(page).getByTestId('workflow-validate-view');
          await expect(view).toBeVisible();
          await expect(view.getByTestId('workflow-validate-ok')).toHaveText(
            'Valid',
          );
          await expect(
            view.getByTestId('workflow-validate-attempt'),
          ).toContainText('Attempt 1');
          await expect(
            view.getByTestId('workflow-validate-finding').first(),
          ).toBeVisible();
          await expect(
            view
              .locator(
                '[data-testid="workflow-validate-finding"][data-passed="true"]',
              )
              .first(),
          ).toBeVisible();
          // It ran once: no attempt switcher.
          await expect(
            nodeDialog(page).getByTestId('workflow-attempts'),
          ).toHaveCount(0);
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
      stub.plan = () =>
        plans++ === 0
          ? clarifyingPlan(question, clarification)
          : clearPlan(question);
      let runId = '';

      await scenarioStep(
        page,
        'Given I am on the "Answer a Business Question" page',
        async () => {
          await openWorkflows(page);
          await openV2FromRun(page);
        },
      );
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
          await expect(
            card.getByRole('heading', { name: 'Waiting for your answer' }),
          ).toBeVisible();
          await expect(card.getByTestId('workflow-run-input-step')).toHaveText(
            'Plan',
          );
          await expect(
            card.getByTestId('workflow-run-input-question'),
          ).toHaveText(clarification.question);
          await expect(
            card.getByTestId('workflow-run-input-option-0'),
          ).toHaveText(clarification.options[0]);
          await expect(
            card.getByTestId('workflow-run-input-option-1'),
          ).toHaveText(clarification.options[1]);
          await expect(card).toBeFocused();
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Waiting for you',
          );
          await expect(canvasNode(page, 'plan')).toHaveAttribute(
            'data-status',
            'suspended',
          );
          await expect(page.getByTestId('workflow-run-activity')).toHaveText(
            'Waiting for your answer',
          );
          // The agent has not been called: the run stopped at the question.
          expect(turnRequests(stub, question)).toEqual([]);
          const runs = (await storedRuns(page)) as {
            id: string;
            status: string;
          }[];
          expect(runs.map((run) => run.status)).toEqual(['suspended']);
          runId = runs[0].id;
          await expect(
            page
              .getByTestId('workflow-state-run-id')
              .getByTestId('execution-id'),
          ).toHaveAttribute('data-execution-id', runId);
        },
      );
      await scenarioStep(
        page,
        `When I pick "${clarification.options[0]}"`,
        async () => {
          await page.getByTestId('workflow-run-input-option-0').click();
        },
      );
      await scenarioStep(
        page,
        'Then the same run continues through Analyse, Validate and Write answer and succeeds',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          await expect(
            page.getByTestId('workflow-run-input-required'),
          ).toHaveCount(0);
          for (const id of [
            'plan',
            'analyse',
            'validate',
            'write-answer',
            'wrap-up',
          ]) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
            await expect(canvasNode(page, id)).toHaveAttribute(
              'data-status',
              'success',
            );
          }
          await expect(
            page
              .getByTestId('workflow-state-run-id')
              .getByTestId('execution-id'),
          ).toHaveAttribute('data-execution-id', runId);
          const runs = (await storedRuns(page)) as {
            id: string;
            status: string;
          }[];
          expect(runs.map((run) => [run.id, run.status])).toEqual([
            [runId, 'success'],
          ]);
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
        if (
          !asked &&
          request.stream &&
          request.messages.at(-1)?.role !== 'tool'
        ) {
          asked = true;
          return {
            toolCall: {
              name:
                request.tools.find((tool) =>
                  tool.endsWith('ask_clarification'),
                ) ?? 'ask_clarification',
              arguments: {
                question: ask.question,
                options: ask.options.join('\n'),
              },
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

      await scenarioStep(
        page,
        'Given I am on the "Answer a Business Question" page',
        async () => {
          await openWorkflows(page);
          await openV2FromRun(page);
        },
      );
      await scenarioStep(page, `When I run it on "${question}"`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, question);
      });
      await scenarioStep(
        page,
        'Then the canvas shows "Analyse" as the running step',
        async () => {
          await expect(canvasNode(page, 'analyse')).toHaveAttribute(
            'data-status',
            'running',
          );
          await expect(canvasNode(page, 'plan')).toHaveAttribute(
            'data-status',
            'success',
          );
          await expect(page.getByTestId('workflow-run-activity')).toHaveText(
            /^\s*Analys/,
          );
          release();
        },
      );
      await scenarioStep(
        page,
        'And a card "Waiting for your answer" asks the agent persona\'s question with its options',
        async () => {
          const card = page.getByTestId('workflow-run-input-required');
          await expect(card).toBeVisible();
          await expect(card.getByTestId('workflow-run-input-step')).toHaveText(
            'Analyse',
          );
          await expect(
            card.getByTestId('workflow-run-input-question'),
          ).toHaveText(ask.question);
          await expect(
            card.getByTestId('workflow-run-input-option-0'),
          ).toHaveText(ask.options[0]);
          await expect(canvasNode(page, 'analyse')).toHaveAttribute(
            'data-status',
            'suspended',
          );
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Waiting for you',
          );
          const runs = (await storedRuns(page)) as {
            id: string;
            status: string;
          }[];
          expect(runs.map((run) => run.status)).toEqual(['suspended']);
          runId = runs[0].id;
        },
      );
      await scenarioStep(
        page,
        'When I type my answer and press "Continue"',
        async () => {
          const answer = page.getByTestId('workflow-run-input-answer');
          await expect(
            page.getByTestId('workflow-run-input-continue'),
          ).toBeDisabled();
          await answer.fill('The final');
          await page.getByTestId('workflow-run-input-continue').click();
        },
      );
      await scenarioStep(
        page,
        'Then the same run continues, Analyse answers and the run succeeds',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          await expect(
            page.getByTestId('workflow-run-input-required'),
          ).toHaveCount(0);
          await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
          await expect(
            page
              .getByTestId('workflow-state-run-id')
              .getByTestId('execution-id'),
          ).toHaveAttribute('data-execution-id', runId);
          for (const id of ['analyse', 'validate', 'write-answer']) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
          }
          const runs = (await storedRuns(page)) as {
            id: string;
            status: string;
          }[];
          expect(runs.map((run) => [run.id, run.status])).toEqual([
            [runId, 'success'],
          ]);
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
      await expect(page.getByTestId('workflow-run-status')).toHaveText(
        /^\s*Run failed: \S/,
        {
          timeout: FAILED_RUN_TIMEOUT,
        },
      );
    });
    await test.step('And the steps up to "Plan" are "Done", "Analyse" is "Failed" and the steps after it are "Skipped"', async () => {
      for (const id of ['receive-question', 'load-catalog', 'plan']) {
        await expect(runStep(page, id)).toHaveAttribute(
          'data-status',
          'success',
        );
      }
      await expect(runStep(page, 'analyse')).toHaveAttribute(
        'data-status',
        'failed',
      );
      for (const id of ['validate', 'write-answer', 'wrap-up']) {
        await expect(runStep(page, id)).toHaveAttribute(
          'data-status',
          'skipped',
        );
      }
      await expect(page.getByTestId('workflow-run-output')).toHaveCount(0);
    });
    await test.step('And the canvas shows "Failed" on "Analyse" and "Skipped" on "Wrap up"', async () => {
      await expect(nodeStatus(page, 'receive-question')).toHaveText('Done');
      await expect(nodeStatus(page, 'load-catalog')).toHaveText('Done');
      await expect(nodeStatus(page, 'plan')).toHaveText('Done');
      await expect(nodeStatus(page, 'analyse')).toHaveText('Failed');
      await expect(nodeStatus(page, 'wrap-up')).toHaveText('Skipped');
      await expect(page.getByTestId('workflow-node-wrap-up')).toHaveAttribute(
        'data-skipped',
        'true',
      );
    });
  });

  test(
    'An invalid input is refused before the workflow runs',
    { tag: ['@demo'] },
    async ({ page }) => {
      const runRequests: string[] = [];
      page.on('request', (request) => {
        if (
          request.method() === 'POST' &&
          request.url().includes('/runs/stream')
        ) {
          runRequests.push(request.url());
        }
      });
      const refusal = page.getByTestId('workflow-run-error');

      let storedBefore = 0;

      await scenarioStep(
        page,
        'Given I am on the "Answer a Business Question" page',
        async () => {
          await openWorkflows(page);
          await openV2FromRun(page);
          storedBefore = (await storedRuns(page)).length;
        },
      );
      await scenarioStep(
        page,
        'When I click Execute user journey',
        async () => {
          await page.getByTestId('workflow-execute').click();
          await expectRunPanel(page);
        },
      );
      await scenarioStep(
        page,
        'Then a blank message cannot be sent',
        async () => {
          await composer(page).fill('   ');
          await expect(sendButton(page)).toBeDisabled();
          await composer(page).press('Enter');
          await expect(page.getByTestId('run-user-message')).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        `When I add "${WORLD_CUP_DATASET}" and send a question over 4000 characters`,
        async () => {
          await fillRun(page, TOO_LONG_QUESTION, WORLD_CUP_DATASET);
          await sendRun(page);
        },
      );
      await scenarioStep(
        page,
        `Then the agent says it couldn't start yet: "${TOO_LONG_ERROR}"`,
        async () => {
          await expect(refusal).toHaveAttribute('role', 'alert');
          await expect(refusal.getByTestId('run-agent-message')).toHaveText(
            `I couldn't start yet: ${TOO_LONG_ERROR}.`,
          );
          // The question at fault is back in the composer, which has the focus.
          await expect(composer(page)).toHaveValue(TOO_LONG_QUESTION);
          await expect(composer(page)).toBeFocused();
        },
      );
      await scenarioStep(
        page,
        'And the Start node shows "Invalid input" and the Run panel says "Input invalid: 1 field"',
        async () => {
          await expect(nodeStatus(page, 'start')).toHaveText('Invalid input');
          await expect(nodeStatus(page, 'start')).toHaveAttribute(
            'data-status',
            'invalid',
          );
          await expect(page.getByTestId('workflow-state-invalid')).toHaveText(
            'Input invalid: 1 field',
          );
        },
      );
      await scenarioStep(page, 'And no run was started', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
        expect(runRequests).toEqual([]);
        expect(await storedRuns(page)).toHaveLength(storedBefore);
      });
      await scenarioStep(page, 'When I double-click Start', async () => {
        await openNode(page, 'start', 'Start');
      });
      await scenarioStep(
        page,
        'Then its Output lists the refused errors and its parameters say what each field needs',
        async () => {
          const dialog = nodeDialog(page);
          await expandNodeSection(page, 'output');
          await expect(
            dialog
              .getByTestId('workflow-ndv-input-errors')
              .getByRole('listitem'),
          ).toHaveText([TOO_LONG_ERROR]);
          await expect(
            dialog.getByTestId('workflow-ndv-output-status'),
          ).toHaveText('Invalid input');
          await expect(
            dialog.getByTestId('workflow-param-rules-question'),
          ).toHaveText('Rules: Max 4000 characters');
          await expect(
            dialog.getByTestId('workflow-param-usedby-question'),
          ).toHaveText('Used by: Read images, Receive question');
          await closeNode(page);
        },
      );
      await scenarioStep(
        page,
        `When I type "${QUESTION}" instead and click Send`,
        async () => {
          await composer(page).fill(QUESTION);
          await sendRun(page);
        },
      );
      await scenarioStep(page, 'Then the run starts and succeeds', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveText(
          'Run succeeded',
        );
        await expect(nodeStatus(page, 'start')).toHaveText('Done');
        await expect(page.getByTestId('workflow-state-invalid')).toHaveCount(0);
        expect(runRequests).toHaveLength(1);
      });
    },
  );
});

/** The stored runs (api.md 120). */
async function storedRuns(page: Page): Promise<unknown[]> {
  const { runs } = await apiJson<{ runs: unknown[] }>(
    page,
    'GET',
    '/workflow-runs',
  );
  return runs;
}

/** A canvas node's run status chip (ui.md 4.4b). */
function nodeStatus(page: Page, id: string): Locator {
  return page
    .getByTestId(`workflow-node-${id}`)
    .getByTestId('workflow-node-status');
}

test.describe('Feature: Workflows (the designer)', () => {
  test(
    'A workflow opens as a designer',
    { tag: ['@demo', '@story-1.23.10'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        'When I open "Answer a Business Question" from User journeys',
        async () => {
          await openWorkflows(page);
          await openWorkflow(page, V2_ID, V2);
        },
      );
      await scenarioStep(
        page,
        'Then the canvas shows Start, its steps in order with their badges, and End, left to right',
        async () => {
          const canvas = page.getByTestId('workflow-canvas');
          await expect(canvas.getByTestId('workflow-node-start')).toContainText(
            'Start',
          );
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(canvas.getByTestId('workflow-node-kind')).toHaveText([
            'LLM',
            'CODE',
            'CODE',
            'LLM',
            'LLM',
            'CODE',
            'LLM',
            'LLM',
            'CODE',
          ]);
          // One line: Plan has no branch of its own, and no Clarify node.
          await expect(canvas.getByTestId('workflow-node-clarify')).toHaveCount(
            0,
          );
          // Each branch label carries its note under it (R42).
          await expect(
            canvas.getByTestId('workflow-edge-label-validate-analyse'),
          ).toContainText('Retry once');
          await expect(
            canvas.getByTestId('workflow-edge-note-validate-analyse'),
          ).toHaveText(
            'A check failed: the analyst tries once more, told what failed.',
          );
          await expect(
            canvas.getByTestId('workflow-connector-validate-analyse'),
          ).toHaveAttribute('data-kind', 'loop');
          await expect(canvas.getByTestId('workflow-node-end')).toContainText(
            'End',
          );
          // The graph is fitted on open: never zoomed past 100%.
          const zoom = Number.parseInt(
            (await page.getByTestId('workflow-zoom-level').textContent()) ?? '',
            10,
          );
          expect(zoom).toBeGreaterThanOrEqual(40);
          expect(zoom).toBeLessThanOrEqual(100);
          // Start left of the first step, End right of the last, on one centre line.
          const start = await canvas
            .getByTestId('workflow-node-start')
            .boundingBox();
          const first = await page
            .getByTestId('workflow-node-receive-question')
            .boundingBox();
          const last = await page
            .getByTestId('workflow-node-wrap-up')
            .boundingBox();
          const end = await canvas
            .getByTestId('workflow-node-end')
            .boundingBox();
          expect(start!.x + start!.width).toBeLessThan(first!.x);
          expect(last!.x + last!.width).toBeLessThan(end!.x);
          const centre = (box: { y: number; height: number }) =>
            box.y + box.height / 2;
          expect(Math.abs(centre(start!) - centre(first!))).toBeLessThan(2);
          expect(Math.abs(centre(last!) - centre(end!))).toBeLessThan(2);
        },
      );
      await scenarioStep(
        page,
        'And there is no Details panel and no Logs panel, and the Run panel with the Chat is on the left of the canvas',
        async () => {
          await expect(detailsPanel(page)).toHaveCount(0);
          await expect(page.getByTestId('workflow-logs-dock')).toHaveCount(0);
          await expectRunPanel(page);
          const canvasBox = await page
            .getByTestId('workflow-canvas')
            .boundingBox();
          const dockBox = await runDock(page).boundingBox();
          expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(
            canvasBox!.x + 1,
          );
          await expect(
            runDock(page).getByRole('heading', { name: 'Chat', exact: true }),
          ).toBeVisible();
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
          await expect(dialog.getByTestId('workflow-ndv-title')).toHaveText(
            'Start',
          );
          await expect(dialog.getByTestId('workflow-panel-trigger')).toHaveText(
            'Runs on an input',
          );
          await expect(
            dialog.getByTestId('workflow-param-question'),
          ).toBeVisible();
          await expect(
            dialog.getByTestId('workflow-param-datasets'),
          ).toBeVisible();
          await expect(
            dialog.getByTestId('workflow-panel-output'),
          ).toContainText('sqlQueries, failedQueries, rows');
          await closeNode(page);
          await expect(page.getByTestId('workflow-node-start')).toBeFocused();
        },
      );
      await scenarioStep(
        page,
        'When I click "Analyse" on the canvas',
        async () => {
          await page.getByTestId('workflow-node-analyse').click();
        },
      );
      await scenarioStep(
        page,
        'Then "Analyse" is selected on the canvas',
        async () => {
          await expect(
            page.getByTestId('workflow-node-analyse'),
          ).toHaveAttribute('aria-pressed', 'true');
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
          await expect(dialog.getByTestId('workflow-ndv-title')).toHaveText(
            'Analyse',
          );
          // An agent step opens on its Story; its fields are under "How it's set up".
          await expect(dialog.getByTestId('workflow-ndv-story')).toBeVisible();
          await unfoldAgentCard(page, 'params');
          await expect(
            dialog.getByTestId('workflow-step-field-model'),
          ).toBeVisible();
          await expect(
            dialog.getByTestId('workflow-step-field-tools'),
          ).toHaveText(
            'list_entities, describe_entity, sample_rows, run_readonly_sql, explore_result, ask_clarification',
          );
          await expect(
            dialog.getByText('Max steps', { exact: true }),
          ).toBeVisible();
          await expect(
            dialog.getByTestId('workflow-step-field-max-steps'),
          ).toHaveText('15');
          await page.keyboard.press('Escape');
          await expect(nodeDialog(page)).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        'When I click Execute user journey',
        async () => {
          await page.getByTestId('workflow-execute').click();
        },
      );
      await scenarioStep(
        page,
        "Then the Run panel focuses the composer's text box and nothing runs",
        async () => {
          await expectRunPanel(page);
          await expect(composer(page)).toBeFocused();
          await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        'When I type a question, click Send and add a dataset when the agent asks',
        async () => {
          await setRunOption(page, 'approveSteps', false);
          await composer(page).fill(QUESTION);
          await sendRun(page);
          await answerPickAsk(page, WORLD_CUP_DATASET);
        },
      );
      await scenarioStep(
        page,
        'Then I see the answer and "Done" on every canvas node but "Read images"',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
          for (const [id] of V2_MAIN_STEP_IDS) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
          }
          await expect(nodeStatus(page, 'read-images')).toHaveText('Skipped');
        },
      );
      await scenarioStep(
        page,
        'When I double-click "Analyse" again and unfold "How it\'s set up"',
        async () => {
          await openNode(page, 'analyse', 'Analyse');
          await unfoldAgentCard(page, 'params');
        },
      );
      await scenarioStep(
        page,
        'Then its Receives lists "question" and the "plan" with their types',
        async () => {
          const receives = nodeDialog(page)
            .getByTestId('workflow-step-field-input')
            .getByTestId('workflow-contract-field');
          await expect(
            receives.filter({ hasText: /^question\b/ }),
          ).toContainText(/: string$/);
          await expect(receives.filter({ hasText: /^plan\b/ })).toContainText(
            /: \S+/,
          );
        },
      );
      await scenarioStep(
        page,
        'And its Output in Schema mode shows the declared contract',
        async () => {
          const output = await unfoldAgentCard(page, 'output');
          await output.getByTestId('workflow-data-mode-schema').click();
          await expect(
            output.getByTestId('workflow-data-schema-declared'),
          ).toHaveText('Declared contract');
          await expect(
            output
              .getByTestId('workflow-data-schema')
              .getByTestId('workflow-contract-field'),
          ).not.toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        'And its Settings show the contract the run used',
        async () => {
          const dialog = nodeDialog(page);
          await unfoldAgentCard(page, 'params');
          await expect(
            dialog.getByText('Contract', { exact: true }),
          ).toBeVisible();
          await expect(
            dialog.getByTestId('workflow-ndv-setting-contract'),
          ).toHaveText(/^\s*[0-9a-f]{12}\s*$/);
          await expect(
            dialog.getByTestId('workflow-ndv-contract-older'),
          ).toHaveCount(0);
          await closeNode(page);
        },
      );
    },
  );

  test(
    "A run shows each node's data in the node dialog",
    { tag: ['@demo'] },
    async ({ page }) => {
      await test.step('Given I am on the "Answer a Business Question" page', async () => {
        await openWorkflows(page);
        await openV2FromRun(page);
      });
      await test.step(`When I run it on "${QUESTION}"`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, QUESTION);
        await expect(page.getByTestId('workflow-run-status')).toHaveText(
          'Run succeeded',
        );
      });
      await test.step('Then every connector of the main path is done, the branch to "Read images" is muted, and the Run panel reads "10 of 11 nodes ran" (Build visual included)', async () => {
        const canvas = page.getByTestId('workflow-canvas');
        const connectors = canvas.locator(
          'path[data-testid^="workflow-connector-"]',
        );
        await expect(connectors).toHaveCount(13);
        const main = ['start', ...V2_MAIN_STEP_IDS.map(([id]) => id), 'end'];
        for (const [i, from] of main.slice(0, -1).entries()) {
          await expect(
            canvas.getByTestId(`workflow-connector-${from}-${main[i + 1]}`),
          ).toHaveAttribute('data-done', 'true');
        }
        for (const id of [
          'start-read-images',
          'read-images-receive-question',
        ]) {
          await expect(
            canvas.getByTestId(`workflow-connector-${id}`),
          ).toHaveAttribute('data-skipped', 'true');
          await expect(
            canvas.getByTestId(`workflow-connector-${id}`),
          ).toHaveAttribute('data-done', 'false');
        }
        // Validate passed the first time: the loop was not taken.
        await expect(
          canvas.getByTestId('workflow-connector-validate-analyse'),
        ).toHaveAttribute('data-done', 'false');
        await expect(page.getByTestId('workflow-state-progress')).toHaveText(
          '10 of 11 nodes ran',
        );
        await expect(page.getByTestId('workflow-state-status')).toHaveText(
          'success',
        );
      });
      await test.step('When I double-click "Wrap up"', async () => {
        await openNode(page, 'wrap-up', 'Wrap up');
      });
      await test.step('Then its Output holds the counts of the SQL calls and the answer', async () => {
        const dialog = nodeDialog(page);
        await expect(
          dialog.getByTestId('workflow-ndv-output-status'),
        ).toHaveText('Done');
        await expandNodeSection(page, 'input');
        await expandNodeSection(page, 'output');
        await expect(
          dialog
            .getByTestId('workflow-ndv-input')
            .getByTestId('workflow-data-json'),
        ).not.toBeEmpty();
        const output = dialog
          .getByTestId('workflow-ndv-output')
          .getByTestId('workflow-data-json');
        await expect(output).toContainText('"answer"');
        await expect(output).toContainText('"sqlQueries"');
        await expect(output).toContainText('1');
        await expect(output).toContainText('"failedQueries"');
        await expect(output).toContainText('0');
        await closeNode(page);
      });
      await test.step('When the model fails and I run it again', async () => {
        failTheModel();
        await newQuestion(page, QUESTION);
        await sendRun(page);
        await expect(page.getByTestId('workflow-run-status')).toHaveText(
          /^\s*Run failed: \S/,
          {
            timeout: FAILED_RUN_TIMEOUT,
          },
        );
      });
      await test.step('Then the "Analyse" dialog shows the error in its Output', async () => {
        const dialog = await openNode(page, 'analyse', 'Analyse');
        await expect(
          dialog.getByTestId('workflow-ndv-output-status'),
        ).toHaveText('Failed');
        // Its Story says it failed (the generic story: `It failed: <error>`).
        await expect(
          dialog.getByTestId('workflow-step-story-headline'),
        ).toContainText('It failed:');
        await unfoldAgentCard(page, 'output');
        await expect(
          dialog.getByTestId('workflow-ndv-output-error'),
        ).toBeVisible();
        await expect(
          dialog.getByTestId('workflow-ndv-output-error'),
        ).not.toBeEmpty();
        await closeNode(page);
      });
    },
  );

  test(
    "A tool sub-node opens the tool's own details",
    { tag: ['@demo'] },
    async ({ page }) => {
      await test.step('Given I am on the "Answer a Business Question" page', async () => {
        await openWorkflows(page);
        await openWorkflow(page, V2_ID, V2);
      });
      await test.step('When I open the Tools sub-node under "Analyse" and pick "run_readonly_sql"', async () => {
        const tools = page.getByTestId('workflow-subnode-analyse-tools');
        await expect(tools).toHaveAccessibleName('Tools of Analyse: 6 tools');
        const menu = await openToolsMenu(page, 'analyse');
        await expect(menu.getByRole('menuitem')).toHaveText([
          'list_entities',
          'describe_entity',
          'sample_rows',
          'run_readonly_sql',
          'explore_result',
          'ask_clarification',
        ]);
        // Keyboard: down to the fourth tool, then Enter.
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
        await expect(
          menu.getByRole('menuitem', { name: 'run_readonly_sql' }),
        ).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(menu).toHaveCount(0);
        await expect(
          nodeDialog(page).getByTestId('workflow-ndv-title'),
        ).toHaveText('run_readonly_sql');
      });
      await test.step("Then its dialog shows the tool's description and inputs, not the agent persona's prompt", async () => {
        const dialog = nodeDialog(page);
        await expect(dialog.getByText('TOOL', { exact: true })).toBeVisible();
        await expect(
          dialog.getByText('Tool of Michael, Insights Analyst · Analyse'),
        ).toBeVisible();
        await expect(dialog.getByTestId('workflow-tool-field-name')).toHaveText(
          'run_readonly_sql',
        );
        await expect(
          dialog.getByTestId('workflow-tool-field-description'),
        ).toBeVisible();
        await expect(
          dialog.getByTestId('workflow-tool-field-description'),
        ).not.toHaveText('None');
        await expect(
          dialog.getByTestId('workflow-tool-field-inputs'),
        ).toContainText('sql');
        await expect(dialog.getByTestId('workflow-tool-field-step')).toHaveText(
          'Analyse',
        );
        await expect(
          dialog.getByTestId('workflow-step-field-system-prompt'),
        ).toHaveCount(0);
        await expandNodeSection(page, 'input');
        await expect(dialog.getByTestId('workflow-ndv-input')).toContainText(
          'This tool has not run yet. Execute the user journey to see its calls.',
        );
        await closeNode(page);
        await expect(
          page.getByTestId('workflow-subnode-analyse-tools'),
        ).toBeFocused();
      });
      await test.step(`When I run it on "${QUESTION}" and open the tool again`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, QUESTION);
        await expect(page.getByTestId('workflow-run-status')).toHaveText(
          'Run succeeded',
        );
        await openTool(page, 'analyse', 'run_readonly_sql');
      });
      await test.step('Then its Input shows the SQL the agent persona ran and its Output the call done', async () => {
        const dialog = nodeDialog(page);
        await expandNodeSection(page, 'input');
        await expandNodeSection(page, 'output');
        await expect(dialog.getByTestId('workflow-ndv-tool-input')).toHaveText([
          SQL,
        ]);
        await expect(
          dialog.getByTestId('workflow-ndv-tool-result'),
        ).toHaveCount(1);
        await expect(
          dialog.getByTestId('workflow-ndv-tool-result'),
        ).toContainText(/^\s*Done/);
        await dialog.getByTestId('workflow-ndv-tab-settings').click();
        await expect(
          dialog.getByTestId('workflow-ndv-setting-calls'),
        ).toHaveText('1');
        await closeNode(page);
      });
    },
  );

  test(
    "I chat with a step's agent about its run data",
    { tag: ['@demo'] },
    async ({ page }) => {
      stub.reply = chatOrRun;

      await scenarioStep(
        page,
        'Given I am on the "Answer a Business Question" page',
        async () => {
          await openWorkflows(page);
          await openV2FromRun(page);
        },
      );
      await scenarioStep(
        page,
        'When I open "Analyse" before any run, its chat says to execute the user journey first',
        async () => {
          const dialog = await openNode(page, 'analyse', 'Analyse');
          await expect(dialog.getByTestId('workflow-ndv-chat')).toBeVisible();
          await expect(
            dialog.getByRole('heading', { name: 'Chat with Michael' }),
          ).toBeVisible();
          await expect(
            dialog.getByTestId('workflow-ndv-story-empty'),
          ).toHaveText(
            'This node has not run yet. Execute the user journey to see its data.',
          );
          await expect(
            dialog.getByTestId('workflow-node-chat-unavailable'),
          ).toHaveText(
            "Execute the user journey, then chat with this agent persona about this step's data.",
          );
          await expect(
            dialog.getByTestId('workflow-node-chat-input'),
          ).toHaveCount(0);
          await closeNode(page);
        },
      );
      await scenarioStep(page, `When I run it on "${QUESTION}"`, async () => {
        await page.getByTestId('workflow-execute').click();
        await runOnQuestion(page, QUESTION);
        await expect(page.getByTestId('workflow-run-status')).toHaveText(
          'Run succeeded',
        );
      });
      await scenarioStep(
        page,
        'And I open "Analyse", its chat under its story and evidence',
        async () => {
          const dialog = await openNode(page, 'analyse', 'Analyse');
          await expect(dialog.getByTestId('workflow-ndv-chat')).toBeVisible();
          await expect(
            dialog.getByTestId('workflow-step-evidence'),
          ).toBeVisible();
          await expect(
            dialog.getByTestId('workflow-node-chat-composer-label'),
          ).toHaveText('Ask Michael about this step');
          await expect(
            dialog.getByTestId('workflow-step-story-headline'),
          ).toContainText('Ran ');
          // Expanding an evidence row shows the SQL the persona ran.
          const row = dialog.getByTestId('workflow-step-evidence-row-0');
          await expect(row).toHaveAttribute('aria-expanded', 'false');
          await row.click();
          await expect(row).toHaveAttribute('aria-expanded', 'true');
          await expect(
            dialog.getByTestId('workflow-step-evidence-input').first(),
          ).toHaveText(SQL);
          await expect(
            dialog.getByTestId('workflow-node-chat-note'),
          ).toHaveText(
            /^\s*Chatting about this run: this step's input, output and tool calls\.\s*Execution ID \S{8}\s*$/,
          );
          await expect(dialog.getByRole('log')).toBeVisible();
          await expect(
            dialog.getByTestId('workflow-node-chat-message'),
          ).toHaveCount(0);
          await expect(
            dialog.getByTestId('workflow-node-chat-send'),
          ).toBeDisabled();
        },
      );
      await scenarioStep(page, `And I ask "${CHAT_QUESTION}"`, async () => {
        const box = nodeDialog(page).getByRole('textbox', {
          name: 'Ask Michael about this step',
        });
        await box.fill(CHAT_QUESTION);
        await box.press('Enter');
      });
      await scenarioStep(
        page,
        "Then the agent persona's answer appears under my question, with the query it ran",
        async () => {
          const messages = nodeDialog(page).getByTestId(
            'workflow-node-chat-message',
          );
          await expect(messages).toHaveCount(2);
          await expect(messages.nth(0)).toHaveAttribute('data-role', 'user');
          await expect(messages.nth(0)).toHaveText(CHAT_QUESTION);
          await expect(messages.nth(1)).toHaveAttribute(
            'data-role',
            'assistant',
          );
          await expect(messages.nth(1)).toContainText(CHAT_ANSWER);
          const call = messages
            .nth(1)
            .getByTestId('workflow-node-chat-tool-call');
          await expect(call).toHaveCount(1);
          await expect(call).toContainText('run_readonly_sql');
          await expect(call.locator('pre')).toHaveText(CHAT_SQL);
          await expect(
            nodeDialog(page).getByTestId('workflow-node-chat-error'),
          ).toHaveCount(0);
          await expect(
            nodeDialog(page).getByTestId('workflow-node-chat-stop'),
          ).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        "And the agent persona received this step's input question and the SQL it ran in the run",
        async () => {
          const chat = stub.requests.filter((request) => isChatTurn(request));
          expect(
            chat.length,
            `a model call for "${CHAT_QUESTION}"`,
          ).toBeGreaterThan(0);
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
  await expect(section(page, 'data-analytics')).toBeVisible();
  await scan('Workflows page');

  // A workflow's page: the canvas and the Run panel (Chat) on the right.
  await openWorkflow(page, V2_ID, V2);
  await expect(drawnSteps(page)).toHaveCount(V2_STEPS.length);
  await expect(runDock(page)).toBeVisible();
  await scan('Answer a Business Question page');

  // The Run panel maximized, then restored.
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();
  await expect(
    runDock(page).getByTestId('workflow-run-dock-maximize'),
  ).toHaveAttribute('aria-pressed', 'true');
  await scan('Answer a Business Question page, Run panel maximized');
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();
  await expect(
    runDock(page).getByTestId('workflow-run-dock-maximize'),
  ).toHaveAttribute('aria-pressed', 'false');

  await openNode(page, 'analyse', 'Analyse');
  await scan('Answer a Business Question page, Analyse dialog');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  await openToolsMenu(page, 'analyse');
  await scan('Answer a Business Question page, Analyse Tools list');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('workflow-tools-menu-analyse')).toHaveCount(0);
  await expect(
    page.getByTestId('workflow-subnode-analyse-tools'),
  ).toBeFocused();

  await openTool(page, 'analyse', 'run_readonly_sql');
  await scan('Answer a Business Question page, run_readonly_sql tool dialog');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  await backToWorkflows(page);
  await openV2FromRun(page);
  await page.getByTestId('workflow-execute').click();

  // The composer's + menu, its Datasets unfolded.
  await unfoldMenuItem(page, 'datasets');
  await expect(page.getByTestId('workflow-input-datasets')).toBeVisible();
  await scan('Answer a Business Question page, composer menu open');
  await closeComposerMenu(page);

  // The agent asks for the datasets, with option cards.
  await composer(page).fill(TOO_LONG_QUESTION);
  await sendRun(page);
  await expect(page.getByTestId('run-intake-datasets')).toBeVisible();
  await scan('Answer a Business Question page, the agent asks for datasets');

  // A refused start: the agent's error turn, Start invalid, the state summary.
  await answerPickAsk(page, WORLD_CUP_DATASET);
  await expect(page.getByTestId('workflow-run-error')).toContainText(
    TOO_LONG_ERROR,
  );
  await expect(nodeStatus(page, 'start')).toHaveText('Invalid input');
  await scan('Answer a Business Question page, input refused');

  await openNode(page, 'start', 'Start');
  await expandNodeSection(page, 'output');
  await expect(
    nodeDialog(page).getByTestId('workflow-ndv-input-errors'),
  ).toBeVisible();
  await scan(
    'Answer a Business Question page, Start dialog with the refused input',
  );
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  await runOnQuestion(page, QUESTION);
  await expect(page.getByTestId('workflow-run-status')).toHaveText(
    'Run succeeded',
  );
  await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
  await expect(page.getByTestId('workflow-run-new')).toBeVisible();
  await scan('Answer a Business Question page after a run');
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();
  await scan(
    'Answer a Business Question page after a run, Run panel maximized',
  );
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();

  await openNode(page, 'wrap-up', 'Wrap up');
  await scan('Answer a Business Question page, Wrap up dialog after a run');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  // How it ran, unfolded under the answer.
  await page.getByTestId('workflow-run-story-toggle').click();
  await expect(page.getByTestId('workflow-run-story-steps')).toBeVisible();
  await scan('Answer a Business Question page, How it ran');

  // Plan's and Validate's outputs as panels (ui.md 4.4b).
  await openNode(page, 'plan', 'Plan');
  await expect(
    nodeDialog(page).getByTestId('workflow-step-story'),
  ).toBeVisible();
  await scan('Answer a Business Question page, Plan dialog after a run: Story');
  await unfoldAgentCard(page, 'output');
  await expect(
    nodeDialog(page).getByTestId('workflow-plan-view'),
  ).toBeVisible();
  await scan(
    'Answer a Business Question page, Plan dialog after a run: What it returned',
  );
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);
  await openNode(page, 'validate', 'Validate');
  await expect(
    (await expandNodeSection(page, 'output')).getByTestId(
      'workflow-validate-view',
    ),
  ).toBeVisible();
  await scan('Answer a Business Question page, Validate dialog after a run');
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  // The Analyse dialog's chat, with a question, its answer and a tool call.
  stub.reply = chatOrRun;
  const chatDialog = await openNode(page, 'analyse', 'Analyse');
  await chatDialog.getByTestId('workflow-node-chat-input').fill(CHAT_QUESTION);
  await chatDialog.getByTestId('workflow-node-chat-send').click();
  await expect(
    chatDialog.getByTestId('workflow-node-chat-message'),
  ).toHaveCount(2);
  await expect(
    chatDialog.getByTestId('workflow-node-chat-tool-call'),
  ).toHaveCount(1);
  await expect(chatDialog.getByTestId('workflow-step-story')).toBeVisible();
  await scan('Answer a Business Question page, Analyse dialog: chat and Story');
  await unfoldAgentCard(page, 'output');
  await scan(
    'Answer a Business Question page, Analyse dialog: What it returned',
  );
  await unfoldAgentCard(page, 'params');
  await scan(
    "Answer a Business Question page, Analyse dialog: How it's set up",
  );
  await page.keyboard.press('Escape');
  await expect(nodeDialog(page)).toHaveCount(0);

  failTheModel();
  await newQuestion(page, QUESTION);
  await sendRun(page);
  await expect(page.getByTestId('workflow-run-status')).toHaveText(
    /^\s*Run failed: \S/,
    {
      timeout: FAILED_RUN_TIMEOUT,
    },
  );
  await scan('Answer a Business Question page after a failed run');

  // A run that waits for my answer: the waiting card, the progress and the activity line.
  stub.hold = undefined;
  stub.plan = () =>
    clarifyingPlan(QUESTION, {
      question: 'Which stage do you mean?',
      options: ['Group stage', 'Final'],
    });
  await newQuestion(page, QUESTION);
  await sendRun(page);
  await expect(page.getByTestId('workflow-run-input-required')).toBeVisible();
  await expect(page.getByTestId('workflow-run-activity')).toHaveText(
    'Waiting for your answer',
  );
  await scan('Answer a Business Question page, a run waiting for my answer');
});

test.describe('Feature: Workflows (Builder and Business views)', () => {
  function viewButton(page: Page, name: 'Builder' | 'Business'): Locator {
    return page
      .getByRole('group', { name: 'View', exact: true })
      .getByRole('button', { name, exact: true });
  }

  function businessView(page: Page): Locator {
    return page.getByTestId('workflow-business-view');
  }

  // A device that never picked a view: the app's default, not the suite's Builder.
  test.use({ workflowView: null });

  test(
    'I run a workflow in the Business view',
    { tag: ['@demo'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        `When I open "${V2}" from User journeys on a device that never picked a view`,
        async () => {
          // The theme follows the OS so the axe scan below can try both; it reloads the app.
          await followOsTheme(page);
          await openWorkflows(page);
          await openWorkflow(page, V2_ID, V2);
        },
      );
      await scenarioStep(
        page,
        `Then it opens in the Business view, first in the header's View control: a chat with no canvas and no Run panel, its composer at the bottom`,
        async () => {
          const group = page.getByRole('group', { name: 'View', exact: true });
          await expect(group.getByRole('button')).toHaveText([
            'Business',
            'Builder',
          ]);
          await expect(viewButton(page, 'Business')).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          await expect(viewButton(page, 'Builder')).toHaveAttribute(
            'aria-pressed',
            'false',
          );
          await expect(businessView(page)).toBeVisible();
          await expect(page.getByTestId('workflow-canvas')).toHaveCount(0);
          await expect(runDock(page)).toHaveCount(0);
          const view = businessView(page);
          await expect(
            view.getByRole('heading', { name: 'Chat', exact: true }),
          ).toBeVisible();
          await expect(view.getByTestId('run-composer-input')).toBeVisible();
          await expect(view.getByTestId('run-composer-plus')).toBeVisible();
          await expect(view.getByTestId('run-composer-send')).toBeDisabled();
          await expect(view.getByTestId('workflow-run')).toHaveCount(0);
          await expect(
            view.getByTestId('workflow-run-open-builder'),
          ).toHaveCount(0);
          // A chat: the workflow's name and hint first, the composer under them.
          const empty = view.getByTestId('workflow-run-empty');
          await expect(empty).toContainText(V2);
          await expect(empty).toContainText(
            /Ask .+ anything about your data\./,
          );
          const emptyBox = await empty.boundingBox();
          const composerBox = await view
            .getByTestId('run-composer')
            .boundingBox();
          expect(composerBox!.y).toBeGreaterThan(emptyBox!.y);
        },
      );
      await scenarioStep(
        page,
        `When I type "${QUESTION}", press Enter and add "${WORLD_CUP_DATASET}" when the agent asks`,
        async () => {
          // Approve each step is on by default; this run goes straight through.
          await setRunOption(page, 'approveSteps', false);
          await composer(page).fill(QUESTION);
          await composer(page).press('Enter');
          await answerPickAsk(page, WORLD_CUP_DATASET);
        },
      );
      await scenarioStep(
        page,
        `Then the user journey runs and I see my question, the agent personas' thread, the answer and the run's execution ID, with no tool calls and no How it ran`,
        async () => {
          const view = businessView(page);
          await expect(view.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          await expect(view.getByTestId('workflow-run-question')).toHaveText(
            QUESTION,
          );
          await expect(view.getByTestId('workflow-run-team')).toBeVisible();
          // Each agent persona with its role (R39).
          await expect(
            view
              .getByTestId('workflow-run-team-write-answer')
              .getByTestId('workflow-run-team-role'),
          ).toHaveText('· Insights Writer');
          await expect(view.getByTestId('run-answer')).toContainText(ANSWER);
          await expect(view.getByTestId('workflow-run-story')).toHaveCount(0);
          await expect(view.getByTestId('workflow-run-tool')).toHaveCount(0);
          await expect(
            view.getByTestId('workflow-run-open-builder'),
          ).toHaveText('Open in Builder');
          // The execution ID to quote when something goes wrong, as in Builder's Run panel.
          await expect(
            view.getByTestId('workflow-run-execution-id'),
          ).toContainText('Execution ID');
        },
      );
      await scenarioStep(
        page,
        'And the chat has no composer and no follow-up, with Stop gone and New question there',
        async () => {
          const view = businessView(page);
          await expect(view.getByTestId('run-composer')).toHaveCount(0);
          await expect(
            view.getByTestId('workflow-follow-up-input'),
          ).toHaveCount(0);
          await expect(view.getByTestId('workflow-run-stop')).toHaveCount(0);
          await expect(view.getByTestId('workflow-run-new')).toBeEnabled();
          await expect(view.getByTestId('workflow-turn')).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        'And the Business view has no detectable accessibility violations',
        async () => {
          await page.addScriptTag({ content: axe.source });
          for (const theme of ['light', 'dark'] as const) {
            await page.emulateMedia({ colorScheme: theme });
            await expect(page.locator('html')).toHaveAttribute(
              'data-theme',
              theme,
            );
            await page.waitForTimeout(500);
            const results = await page.evaluate(async () =>
              (window as unknown as { axe: typeof axe }).axe.run(document),
            );
            expect(results.violations, `Business view, ${theme}`).toEqual([]);
          }
        },
      );
      await scenarioStep(page, 'When I click "Open in Builder"', async () => {
        await businessView(page)
          .getByTestId('workflow-run-open-builder')
          .click();
      });
      await scenarioStep(
        page,
        'Then the Builder view shows the same run on the canvas and in the Run panel',
        async () => {
          await expect(viewButton(page, 'Builder')).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          await expect(businessView(page)).toHaveCount(0);
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(
            runDock(page).getByTestId('workflow-run-question'),
          ).toHaveText(QUESTION);
          await expect(runDock(page).getByTestId('run-answer')).toContainText(
            ANSWER,
          );
          await expect(
            runDock(page).getByTestId('workflow-run-story'),
          ).toBeVisible();
        },
      );
      await scenarioStep(
        page,
        `When I go back to User journeys and open "${V2}" again`,
        async () => {
          await page.getByTestId('workflow-breadcrumb').click();
          await openWorkflow(page, V2_ID, V2);
        },
      );
      await scenarioStep(
        page,
        'Then it opens in the Builder view I last used',
        async () => {
          await expect(viewButton(page, 'Builder')).toHaveAttribute(
            'aria-pressed',
            'true',
          );
          await expect(drawnSteps(page)).toHaveText(V2_STEPS);
          await expect(businessView(page)).toHaveCount(0);
        },
      );
    },
  );
});
