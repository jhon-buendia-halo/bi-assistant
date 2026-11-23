import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import { apiBaseOf } from './helpers/api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
} from './helpers/llm-stub';
import { worldCupKey, worldCupScalar } from './helpers/world-cup-db';
import {
  answerPickAsk,
  closeComposerMenu,
  composer,
  composerMenu,
  fillRun as fillRunDefault,
  openComposerMenu,
  pickDataset,
  pickedDataset,
  sendButton,
  sendRun,
  setRunOption,
  unfoldMenuItem,
} from './helpers/run-ui';

/**
 * Mirrors the Feature "Workflow runs" in specs/capabilities/workflows/spec.md:
 * Answer a Business Question runs from its page's Run tab (workflows R21), on
 * the recording stub model and the World Cup dataset.
 */

const V2_ID = 'answer-business-question';
const V2 = 'Answer a Business Question';
const QUESTION = 'Which team scored the most goals?';
const ANSWER = 'Brazil scored the most goals in this data.';
const SECOND_QUESTION = 'And the fewest?';
const SECOND_ANSWER = 'Zaire scored the fewest goals in this data.';
const SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
/** The steps a clear question runs. */
const V2_STEPS = [
  'receive-question',
  'load-catalog',
  'plan',
  'analyse',
  'validate',
  'write-answer',
  'wrap-up',
];

/**
 * Fills the Run tab (Approve each step off) and turns "Build a visual" off
 * (it is on by default) through `+`, so a run that is not about the visual
 * keeps its steps to the answer's.
 */
async function fillRun(page: Page, question: string, dataset?: string): Promise<void> {
  await fillRunDefault(page, question, dataset);
  await setRunOption(page, 'buildVisual', false);
}

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

// ------------------------------------------------------------------ the stub

/** The last user message of a request: which run's turn it belongs to. */
function lastUserText(request: StubRequest): string {
  const users = request.messages.filter((message) => message.role === 'user');
  return users.length === 0 ? '' : messageText(users[users.length - 1]);
}

/**
 * A streamed call of the analysis turn whose latest user message is `text`
 * (not v2's structured Plan or Write answer call).
 */
function isTurn(request: StubRequest, text: string): boolean {
  return request.stream && request.step === undefined && lastUserText(request) === text;
}

/** The model's last message in the request was a tool result. */
function afterToolResult(request: StubRequest): boolean {
  return request.messages.at(-1)?.role === 'tool';
}

/** The offered tool whose name is (or ends with) `name`. */
function toolName(request: StubRequest, name: string): string {
  return request.tools.find((tool) => tool === name || tool.endsWith(name)) ?? name;
}

/** Each question queries once with SQL, then answers its text. */
function answerWithSql(answers: Record<string, string>): (r: StubRequest) => StubReply {
  return (request) => {
    const question = Object.keys(answers).find((q) => isTurn(request, q));
    if (question === undefined) return { text: 'The stub model answered this question.' };
    if (!afterToolResult(request)) {
      return {
        toolCall: {
          name: toolName(request, 'run_readonly_sql'),
          arguments: { sql: SQL, rationale: 'Counting matches per stage.' },
        },
      };
    }
    return { text: answers[question] };
  };
}

/** A promise a test resolves by hand. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

// ------------------------------------------------------------------ the UI

function railItem(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

/** The Run panel on the right of the canvas: the Chat (the run form). */
function runDock(page: Page): Locator {
  return page.getByTestId('workflow-run-dock');
}

async function openWorkflowPage(page: Page, id: string, name: string): Promise<void> {
  await railItem(page, 'User journeys').click();
  await expect(page.getByRole('heading', { name: 'User journeys', exact: true })).toBeVisible();
  await page.getByTestId(`workflow-${id}`).click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(name);
}

async function openRunTab(page: Page): Promise<void> {
  await page.getByTestId('workflow-execute').click();
  await expect(composer(page)).toBeVisible();
}


/** A step's node on the canvas; its status in the run shown is `data-status`. */
function runStep(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-node-${id}`);
}

function nodeStatus(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-node-${id}`).getByTestId('workflow-node-status');
}

function runAnswer(page: Page): Locator {
  return page.getByTestId('run-answer');
}

// ------------------------------------------------------------------ scenarios

test.describe('Feature: Workflow runs', () => {
  test(
    'I run Answer a Business Question on a question',
    { tag: ['@demo', '@story-1.23.15'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER, [SECOND_QUESTION]: SECOND_ANSWER });
      // The first answer waits until the test has seen the step running.
      const held = gate();
      stub.hold = (request) =>
        isTurn(request, QUESTION) && afterToolResult(request) ? held.promise : undefined;

      await scenarioStep(
        page,
        `When I open "${V2}" from User journeys and click Execute user journey`,
        async () => {
          await openWorkflowPage(page, V2_ID, V2);
          await openRunTab(page);
        },
      );
      await scenarioStep(page, 'Then the Run tab shows the composer and no Careful', async () => {
        const panel = runDock(page);
        await expect(page.getByRole('complementary', { name: 'Details panel' })).toHaveCount(0);
        await expect(panel.getByTestId('run-composer')).toHaveAccessibleName(/^Message \S/);
        await expect(composer(page)).toHaveValue('');
        await expect(composer(page)).toHaveAttribute('placeholder', /^Message \S/);
        // Nothing to send yet; no Execute button any more.
        await expect(sendButton(page)).toHaveAccessibleName('Send');
        await expect(sendButton(page)).toBeDisabled();
        await expect(page.getByTestId('workflow-run')).toHaveCount(0);
        await expect(pickedDataset(page, WORLD_CUP_DATASET)).toHaveCount(0);
        await openComposerMenu(page);
        await expect(composerMenu(page).getByRole('switch', { name: /^Careful/ })).toHaveCount(0);
        await closeComposerMenu(page);
      });
      await scenarioStep(
        page,
        `When I type "${QUESTION}", click Send and add "${WORLD_CUP_DATASET}" when the agent asks`,
        async () => {
          await setRunOption(page, 'approveSteps', false);
          await setRunOption(page, 'buildVisual', false);
          await composer(page).fill(QUESTION);
          await sendRun(page);
          await answerPickAsk(page, WORLD_CUP_DATASET);
        },
      );
      await scenarioStep(
        page,
        'Then the Analyse step is running on the canvas and in the Run tab, with its SQL call',
        async () => {
          await expect(nodeStatus(page, 'analyse')).toHaveText('Running');
          await expect(runStep(page, 'analyse')).toHaveAttribute('data-status', 'running');
          await expect(page.locator('[data-testid="workflow-run-tool"][data-tool="run_readonly_sql"]').first()).toBeVisible();
          await expect(page.getByTestId('workflow-run-stop')).toBeVisible();
          held.release();
        },
      );
      await scenarioStep(
        page,
        "And I see the stub's answer with its SQL, and every step Done but Build visual",
        async () => {
          await expect(runAnswer(page)).toContainText(ANSWER);
          await page.getByTestId('query-row-0').click();
          await page.getByTestId('query-inspector-tab-sql').click();
          await expect(page.getByTestId('query-sql')).toHaveText(SQL);
          await page.getByTestId('query-inspector-close').click();
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          for (const id of V2_STEPS) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
            await expect(runStep(page, id)).toHaveAttribute('data-status', 'success');
          }
          // The visual is off for this run, and its line says so.
          await expect(nodeStatus(page, 'build-visual')).toHaveText('Skipped');
          await expect(runStep(page, 'build-visual')).toHaveAttribute(
            'data-status',
            'skipped',
          );
          await expect(
            runStep(page, 'build-visual').getByTestId('workflow-node-activity'),
          ).toHaveText('Off for this run');
        },
      );
      await scenarioStep(page, 'Then the composer is hidden while the answer shows', async () => {
        await expect(page.getByTestId('run-composer')).toHaveCount(0);
        await expect(composer(page)).toHaveCount(0);
        await expect(page.getByTestId('workflow-follow-up-input')).toHaveCount(0);
        await expect(page.getByTestId('workflow-run-follow-up')).toHaveCount(0);
        await expect(page.getByTestId('workflow-run-stop')).toHaveCount(0);
      });
      await scenarioStep(
        page,
        `When I click New question, type "${SECOND_QUESTION}" and click Send`,
        async () => {
          await page.getByTestId('workflow-run-new').click();
          // The dataset stays added: nothing is missing, so the run starts.
          await expect(pickedDataset(page, WORLD_CUP_DATASET)).toBeVisible();
          await composer(page).fill(SECOND_QUESTION);
          await sendRun(page);
        },
      );
      await scenarioStep(page, 'Then I see the second answer', async () => {
        await expect(page.getByTestId('run-intake-datasets')).toHaveCount(0);
        await expect(page.getByTestId('workflow-run-question')).toHaveText(SECOND_QUESTION);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
        await expect(runAnswer(page)).toContainText(SECOND_ANSWER);
      });
    },
  );

  test(
    "I approve each agent's work before the next one starts",
    { tag: ['@demo'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER });
      const card = page.getByTestId('workflow-run-input-required');

      await scenarioStep(
        page,
        `Given I open "${V2}" and its Run tab`,
        async () => {
          await openWorkflowPage(page, V2_ID, V2);
          await openRunTab(page);
        },
      );
      await scenarioStep(
        page,
        `When "Approve each step" is on by default, I ask "${QUESTION}" without a visual and click Send`,
        async () => {
          await openComposerMenu(page);
          await expect(
            composerMenu(page).getByTestId('workflow-input-approveSteps'),
          ).toBeChecked();
          await pickDataset(page, WORLD_CUP_DATASET);
          await composerMenu(page)
            .getByTestId('workflow-input-buildVisual')
            .setChecked(false);
          await closeComposerMenu(page);
          await composer(page).fill(QUESTION);
          await sendRun(page);
        },
      );
      await scenarioStep(
        page,
        "Then the run waits for my approval of Olivia's plan, with no options and no changes asked yet",
        async () => {
          await expect(card).toBeVisible();
          await expect(card).toContainText('Waiting for your approval');
          await expect(card).toContainText("Olivia's plan is ready");
          await expect(
            card.getByTestId('workflow-run-input-review'),
          ).toContainText('Measures');
          await expect(
            card.getByTestId('workflow-run-input-approve'),
          ).toBeEnabled();
          await expect(
            card.locator('[data-testid^="workflow-run-input-option-"]'),
          ).toHaveCount(0);
          await expect(
            card.getByTestId('workflow-run-input-continue'),
          ).toHaveText('Ask for changes');
          await expect(
            card.getByTestId('workflow-run-input-continue'),
          ).toBeDisabled();
        },
      );
      await scenarioStep(
        page,
        "When I approve the plan, then Michael's analysis waits for me",
        async () => {
          await card.getByTestId('workflow-run-input-approve').click();
          await expect(card).toContainText("Michael's analysis is ready");
        },
      );
      await scenarioStep(
        page,
        'When I approve the analysis, then the run ends with an answer',
        async () => {
          await card.getByTestId('workflow-run-input-approve').click();
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          await expect(runAnswer(page)).toContainText(ANSWER);
        },
      );
    },
  );

  test(
    'I open a query of an answer in the inspector and read how it was built',
    { tag: ['@demo', '@story-1.25.4'] },
    async ({ page }) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(page.url()).origin,
      });
      const total = Number(await worldCupScalar(`SELECT COUNT(*) FROM ${worldCupKey('matches')}`));
      const sql = `SELECT COUNT(*) AS total_matches FROM ${worldCupKey('matches')}`;
      const question = 'How many matches does the data hold?';
      stub.reply = (request) => {
        if (!isTurn(request, question)) return { text: 'The stub model answered this question.' };
        return afterToolResult(request)
          ? { text: `The data holds ${total.toLocaleString('en-US')} matches.` }
          : {
              toolCall: {
                name: toolName(request, 'run_readonly_sql'),
                arguments: { sql, rationale: 'Counting all the matches.' },
              },
            };
      };
      const sheet = page.getByTestId('query-inspector');

      await scenarioStep(page, `When I run "${question}" on "${WORLD_CUP_DATASET}"`, async () => {
        await openWorkflowPage(page, V2_ID, V2);
        await openRunTab(page);
        await fillRun(page, question, WORLD_CUP_DATASET);
        await sendRun(page);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      });
      await scenarioStep(page, 'Then I see the coverage line and a query row with its chip', async () => {
        await expect(page.getByTestId('query-coverage-line')).toContainText('table was read');
        const row = page.getByTestId('query-row-0');
        await expect(row).toContainText('Counting all the matches.');
        await expect(row.getByTestId('query-coverage-chip')).toHaveText('Whole table');
        await expect(runAnswer(page).getByText('How I worked this out')).toHaveCount(0);
        await expect(runAnswer(page).getByText(/Data used/)).toHaveCount(0);
      });
      const chip = runAnswer(page).getByTestId('figure-ref').first();
      await scenarioStep(page, 'And a figure of the answer carries a numbered source', async () => {
        await expect(chip).toHaveText('1');
        await expect(chip).toHaveAttribute('data-query-index', '0');
        await chip.hover();
        await expect(page.getByTestId('figure-ref-card')).toContainText('Counting all the matches.');
        await expect(page.getByTestId('figure-ref-card')).toContainText('Click to see how it was computed');
      });
      await scenarioStep(page, 'When I open the query from the chip', async () => {
        await chip.click();
      });
      await scenarioStep(page, 'Then the inspector opens beside the answer and I read its last step', async () => {
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveAttribute('aria-modal', 'false');
        await expect(page.getByTestId('query-inspector-close')).toBeFocused();
        await expect(page.getByTestId('query-inspector-position')).toHaveText('Source 1 of 1');
        await expect(page.getByTestId('query-inspector-title')).toHaveText('Counting all the matches.');
        await expect(page.getByTestId('query-inspector-meta')).toContainText('PostgreSQL');
        await expect(page.getByTestId('query-inspector-tab-steps')).toHaveAttribute('aria-selected', 'true');
        const steps = page.getByTestId('query-funnel-step');
        await expect(steps.first()).toHaveAttribute('data-verb', 'start');
        await expect(steps.last()).toHaveAttribute('data-verb', 'show');
        await expect(steps.last()).toContainText('Show');
        // The sheet opens over the canvas, right of the Run panel on the left,
        // so the answer stays visible.
        const sheetBox = (await page.getByTestId('query-inspector-sheet').boundingBox())!;
        const dockBox = (await runDock(page).boundingBox())!;
        expect(sheetBox.x).toBeGreaterThanOrEqual(dockBox.x + dockBox.width - 1);
        expect(sheetBox.width).toBeLessThanOrEqual(720);
        await expect(runAnswer(page)).toBeVisible();
      });
      await scenarioStep(page, 'When I switch to Result and to SQL', async () => {
        await page.getByTestId('query-inspector-tab-result').click();
        await expect(page.getByTestId('query-result-table')).toContainText('total_matches');
        await expect(page.getByTestId('query-result-table')).toContainText(String(total));
        await page.getByTestId('query-inspector-tab-sql').click();
        await expect(page.getByTestId('query-sql')).toHaveText(sql);
      });
      await scenarioStep(page, 'And I copy the SQL', async () => {
        await page.getByTestId('query-copy-sql').click();
        await expect(page.getByText('SQL copied to clipboard')).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sql);
      });
      await scenarioStep(page, 'And I press Escape', async () => {
        await page.keyboard.press('Escape');
      });
      await scenarioStep(page, 'Then the inspector closes and the focus is back on the chip', async () => {
        await expect(sheet).toHaveCount(0);
        await expect(runAnswer(page).getByTestId('figure-ref').first()).toBeFocused();
      });
    },
  );

  test(
    'I open the query of a stored run from the Runs page',
    { tag: ['@demo', '@story-1.25.5'] },
    async ({ page }) => {
      const sql = `SELECT COUNT(*) AS total_matches FROM ${worldCupKey('matches')}`;
      const question = 'How many matches does the data hold?';
      stub.reply = (request) => {
        if (!isTurn(request, question)) return { text: 'The stub model answered this question.' };
        return afterToolResult(request)
          ? { text: 'The data holds many matches.' }
          : {
              toolCall: {
                name: toolName(request, 'run_readonly_sql'),
                arguments: { sql, rationale: 'Counting all the matches.' },
              },
            };
      };

      await scenarioStep(page, `Given I ran "${question}" on "${WORLD_CUP_DATASET}"`, async () => {
        await openWorkflowPage(page, V2_ID, V2);
        await openRunTab(page);
        await fillRun(page, question, WORLD_CUP_DATASET);
        await sendRun(page);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      });
      await scenarioStep(page, 'When I open that run from the Runs page', async () => {
        await railItem(page, 'Runs').click();
        await page.getByTestId(/^run-[0-9a-f]{8}-/).first().getByRole('button').first().click();
        // A finished run opens on its workflow's page, drawn with that run (workflows R19).
        await expect(page.getByTestId('workflow-detail-name')).toHaveText(V2);
        await expect(page.getByTestId('workflow-run-question')).toHaveText(question);
        await expect(runAnswer(page)).toContainText('The data holds many matches.');
      });
      await scenarioStep(page, 'Then I see its coverage line and its query row', async () => {
        const answer = runAnswer(page);
        await expect(answer.getByTestId('query-coverage-line')).toContainText('table was read');
        await expect(answer.getByTestId('query-row-0')).toContainText('Counting all the matches.');
        await expect(answer.getByText(/Data used/)).toHaveCount(0);
      });
      await scenarioStep(page, 'When I open the query from its row', async () => {
        await page.getByTestId('query-row-0').click();
      });
      await scenarioStep(page, 'Then the inspector shows its steps and the focus is on its close button', async () => {
        await expect(page.getByTestId('query-inspector-position')).toHaveText('Source 1 of 1');
        await expect(page.getByTestId('query-funnel-step').last()).toHaveAttribute('data-verb', 'show');
        await expect(page.getByTestId('query-inspector-close')).toBeFocused();
        const sheet = (await page.getByTestId('query-inspector-sheet').boundingBox())!;
        expect(sheet.width).toBeLessThanOrEqual(720);
      });
      await scenarioStep(page, 'When I press Escape', async () => {
        await page.keyboard.press('Escape');
      });
      await scenarioStep(page, 'Then it closes and the focus is back on the row', async () => {
        await expect(page.getByTestId('query-inspector')).toHaveCount(0);
        await expect(page.getByTestId('query-row-0')).toBeFocused();
      });
    },
  );

  test(
    'Answer a Business Question builds a visual with Ryan unless it is turned off',
    { tag: ['@demo'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER });

      await scenarioStep(page, `Given I open "${V2}" and its Run tab`, async () => {
        await openWorkflowPage(page, V2_ID, V2);
        await openRunTab(page);
      });
      await scenarioStep(
        page,
        `When "Build a visual" is on by default, I add "${WORLD_CUP_DATASET}", ask "${QUESTION}" and click Send`,
        async () => {
          await openComposerMenu(page);
          await expect(
            composerMenu(page).getByTestId('workflow-input-buildVisual'),
          ).toBeChecked();
          await fillRunDefault(page, QUESTION, WORLD_CUP_DATASET);
          await sendRun(page);
        },
      );
      await scenarioStep(
        page,
        'Then "Build visual" ends Done, after Write answer and before Wrap up in How it ran',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          await expect(nodeStatus(page, 'build-visual')).toHaveText('Done');
          await expect(runStep(page, 'build-visual')).toHaveAttribute('data-status', 'success');
          const order = await page
            .getByTestId('workflow-run-story')
            .locator('[data-testid^="workflow-run-story-step-"]')
            .evaluateAll((els) =>
              els.map((e) =>
                (e.getAttribute('data-testid') ?? '').replace('workflow-run-story-step-', ''),
              ),
            );
          expect(order.indexOf('build-visual')).toBeGreaterThan(order.indexOf('write-answer'));
          expect(order.indexOf('build-visual')).toBeLessThan(order.indexOf('wrap-up'));
        },
      );
      await scenarioStep(page, 'And the answer is still shown', async () => {
        await expect(runAnswer(page)).toContainText(ANSWER);
      });
    },
  );

  test(
    "I rate a run's answer and it becomes a verified query",
    { tag: ['@demo', '@story-1.23.19'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER });

      await scenarioStep(page, `Given I ran "${V2}" on "${QUESTION}"`, async () => {
        await openWorkflowPage(page, V2_ID, V2);
        await openRunTab(page);
        await fillRun(page, QUESTION, WORLD_CUP_DATASET);
        await sendRun(page);
        await expect(runAnswer(page)).toContainText(ANSWER);
        await expect(runAnswer(page).getByText('Verified', { exact: true })).toHaveCount(0);
      });
      await scenarioStep(page, "When I give the run's answer a thumbs-up", async () => {
        await runAnswer(page).getByRole('button', { name: 'Save as verified query' }).click();
      });
      await scenarioStep(
        page,
        'Then I see "Answer saved as a verified query" and the Verified badge',
        async () => {
          await expect(page.getByText('Answer saved as a verified query')).toBeVisible();
          await expect(runAnswer(page).getByText('Verified', { exact: true })).toBeVisible();
        },
      );
      await scenarioStep(
        page,
        'When I run the same question again, then its answer shows Verified',
        async () => {
          // New question keeps the dataset added; the question is typed again.
          await page.getByTestId('workflow-run-new').click();
          await composer(page).fill(QUESTION);
          await sendRun(page);
          await expect(runAnswer(page)).toContainText(ANSWER);
          await expect(runAnswer(page).getByText('Verified', { exact: true })).toBeVisible();
        },
      );
    },
  );

  test('Enter runs the question, the run hides the composer and New question brings it back', async ({
    page,
  }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    await test.step(`Given I am on the Run panel of "${V2}" with "${WORLD_CUP_DATASET}" added`, async () => {
      await openWorkflowPage(page, V2_ID, V2);
      await openRunTab(page);
      await pickDataset(page, WORLD_CUP_DATASET);
      await composerMenu(page).getByTestId('workflow-input-approveSteps').setChecked(false);
      await closeComposerMenu(page);
      await expect(pickedDataset(page, WORLD_CUP_DATASET)).toBeVisible();
    });
    await test.step('When I press Shift+Enter, the composer adds a line and nothing runs', async () => {
      await composer(page).fill('Which team');
      await composer(page).press('Shift+Enter');
      await expect(composer(page)).toHaveValue('Which team\n');
      await expect(page.getByTestId('run-user-message')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
    });
    await test.step('When I type the question and press Enter', async () => {
      await composer(page).fill(QUESTION);
      await composer(page).press('Enter');
    });
    await test.step('Then the user journey runs and I see the answer', async () => {
      await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      await expect(runAnswer(page)).toContainText(ANSWER);
      await expect(page.getByTestId('workflow-run-question')).toHaveText(QUESTION);
    });
    await test.step('And the composer and any follow-up are gone under the answer', async () => {
      await expect(page.getByTestId('run-composer')).toHaveCount(0);
      await expect(composer(page)).toHaveCount(0);
      await expect(page.getByTestId('workflow-follow-up-input')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run-follow-up')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run')).toHaveCount(0);
    });
    await test.step('When I click New question', async () => {
      await page.getByTestId('workflow-run-new').click();
    });
    await test.step('Then the run is cleared, the composer is empty and focused, and the dataset stays added', async () => {
      await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
      await expect(runAnswer(page)).toHaveCount(0);
      await expect(composer(page)).toBeVisible();
      await expect(composer(page)).toHaveValue('');
      await expect(composer(page)).toBeFocused();
      await expect(sendButton(page)).toBeDisabled();
      await expect(pickedDataset(page, WORLD_CUP_DATASET)).toBeVisible();
      await expect(page.getByTestId('workflow-run-new')).toHaveCount(0);
    });
  });

  test('Asking on home runs Answer a Business Question on its page', async ({ page }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    const ask = page.getByTestId('welcome-ask');
    await test.step(`Given I am on home with "${WORLD_CUP_DATASET}" as the only dataset`, async () => {
      await page.reload();
      await expect(ask.getByLabel('What do you want to know?')).toBeVisible();
      await expect(page.getByTestId('welcome-setup')).toHaveCount(0);
    });
    await test.step('Then that dataset is already picked', async () => {
      await expect(
        ask.getByRole('button', { name: `Remove ${WORLD_CUP_DATASET}`, exact: true }),
      ).toBeVisible();
    });
    await test.step('When I type the question and press Enter', async () => {
      const question = page.getByTestId('welcome-question');
      await question.fill(QUESTION);
      await question.press('Enter');
    });
    await test.step(`Then "${V2}" opens, runs on my question and I see the answer`, async () => {
      await expect(page.getByTestId('workflow-detail-name')).toHaveText(V2);
      // Home starts the run with the defaults, Approve each step among them:
      // approve each agent's work as it waits.
      const approve = page.getByTestId('workflow-run-input-approve');
      await expect(async () => {
        if (await approve.isVisible()) await approve.click();
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded', {
          timeout: 1_500,
        });
      }).toPass({ timeout: 30_000 });
      await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      await expect(runAnswer(page)).toContainText(ANSWER);
      await expect(page.getByTestId('workflow-run-question')).toHaveText(QUESTION);
    });
    await test.step('And home lists the run under Recent runs', async () => {
      await page.reload();
      await expect(
        page.getByTestId('welcome-runs').getByRole('button', { name: new RegExp(V2) }),
      ).toBeVisible();
    });
  });

  test('The Run panel maximizes, folds and resizes from the keyboard', async ({ page }) => {
    const dock = runDock(page);
    const maximize = dock.getByTestId('workflow-run-dock-maximize');
    const toggle = dock.getByTestId('workflow-state-toggle');
    const width = async () => (await dock.boundingBox())!.width;
    await test.step(`Given I am on the Run panel of "${V2}"`, async () => {
      await openWorkflowPage(page, V2_ID, V2);
      await openRunTab(page);
      await expect(maximize).toHaveAttribute('aria-pressed', 'false');
    });
    const normal = await width();
    await test.step('When I maximize it, it grows; when I restore it, it returns', async () => {
      await maximize.click();
      await expect(maximize).toHaveAttribute('aria-pressed', 'true');
      await expect(maximize).toHaveAccessibleName('Restore Run panel');
      await expect.poll(width).toBeGreaterThan(normal);
      await maximize.click();
      await expect(maximize).toHaveAttribute('aria-pressed', 'false');
      await expect(maximize).toHaveAccessibleName('Maximize Run panel');
      await expect.poll(width).toBe(normal);
    });
    await test.step('When I fold it, it narrows to a strip; when I unfold it, it returns', async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('workflow-run-chat')).toHaveCount(0);
      await expect.poll(width).toBeLessThan(normal);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(width).toBe(normal);
    });
    await test.step('When I press Arrow Right on the resize separator, the panel grows', async () => {
      const separator = dock.getByRole('separator', { name: 'Resize Run panel' });
      await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
      const before = Number(await separator.getAttribute('aria-valuenow'));
      await separator.focus();
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
        .toBeGreaterThan(before);
      await expect.poll(width).toBeGreaterThan(normal);
    });
  });

  test('The agent asks for a missing required dataset with option cards', async ({ page }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    const ask = page.getByTestId('run-intake-datasets');
    const option = ask.getByTestId(`run-intake-option-datasets-${WORLD_CUP_DATASET}`);
    await test.step(`Given I am on the Run tab of "${V2}" and no dataset is added`, async () => {
      await openWorkflowPage(page, V2_ID, V2);
      await openRunTab(page);
      await setRunOption(page, 'approveSteps', false);
      await setRunOption(page, 'buildVisual', false);
      await expect(pickedDataset(page, WORLD_CUP_DATASET)).toHaveCount(0);
    });
    await test.step(`When I type "${QUESTION}" and click Send`, async () => {
      await composer(page).fill(QUESTION);
      await sendRun(page);
    });
    await test.step('Then I see my message as a bubble on the right', async () => {
      await expect(page.getByTestId('run-user-message')).toHaveText(QUESTION);
    });
    await test.step(
      'And an agent message on the left asks which datasets to use, with option cards from the catalogue and the read-only footnote',
      async () => {
        await expect(ask.getByTestId('run-agent-message')).toHaveText(
          /^\s*Happy to\. First, which data should \S+ look at\? Pick one or more datasets\.\s*$/,
        );
        const card = option.locator('xpath=ancestor::li[1]');
        await expect(card).toContainText(WORLD_CUP_DATASET);
        await expect(card).toContainText(/PostgreSQL · \d+ tables?/);
        await expect(option).toHaveAccessibleName(`Add ${WORLD_CUP_DATASET}`);
        await expect(option).toHaveAttribute('aria-pressed', 'false');
        await expect(option).toHaveText('Add');
        await expect(ask).toContainText('only reads your data with read-only SQL.');
        // The composer now filters the cards.
        await expect(composer(page)).toHaveAttribute('placeholder', 'Or type a dataset name…');
      },
    );
    await test.step(`When I click Add on "${WORLD_CUP_DATASET}"`, async () => {
      await option.click();
    });
    await test.step('Then its button reads "Added"', async () => {
      await expect(option).toHaveAttribute('aria-pressed', 'true');
      await expect(option).toHaveText('Added');
    });
    const started = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().includes(`/workflows/${V2_ID}/runs/stream`),
    );
    await test.step('When I click "Continue with 1 dataset"', async () => {
      await expect(ask.getByTestId('run-intake-continue')).toHaveText('Continue with 1 dataset');
      await ask.getByTestId('run-intake-continue').click();
    });
    await test.step('Then I see my answer as a bubble and the run starts with the same request as before', async () => {
      const body = (await started).postDataJSON() as { input: Record<string, unknown> };
      expect(body.input['question']).toBe(QUESTION);
      expect(body.input['datasets']).toEqual([WORLD_CUP_DATASET]);
      // The switches turned off through + (sent false, or left out).
      expect(body.input['approveSteps']).not.toBe(true);
      expect(body.input['buildVisual']).not.toBe(true);
      await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      await expect(runAnswer(page)).toContainText(ANSWER);
      await expect(page.getByTestId('run-user-message').filter({ hasText: WORLD_CUP_DATASET })).toBeVisible();
    });
  });

  test('Optional inputs live behind the plus button', async ({ page }) => {
    const plus = page.getByTestId('run-composer-plus');
    const menu = composerMenu(page);
    const visual = menu.getByRole('switch', { name: 'Visual review with Iris', exact: true });
    const pages = menu.getByTestId('workflow-input-maxPages');
    const chip = page.getByTestId('run-composer-chip-visualReview');
    await test.step('Given I am on the Run tab of "Review a Website"', async () => {
      await openWorkflowPage(page, 'review-website', 'Review a Website');
      await openRunTab(page);
      // Its message is the entry URL: nothing to send yet.
      await expect(sendButton(page)).toBeDisabled();
    });
    await test.step('When I click the "+" button', async () => {
      await expect(plus).toHaveAccessibleName('Add inputs and options');
      await expect(plus).toHaveAttribute('aria-expanded', 'false');
      await plus.click();
    });
    await test.step(
      'Then the menu shows an ADD section and an OPTIONS section with "Visual review with Iris" as a switch',
      async () => {
        await expect(plus).toHaveAttribute('aria-expanded', 'true');
        await expect(menu).toHaveAttribute('role', 'dialog');
        await expect(menu).toHaveAccessibleName('Inputs and options');
        await expect(menu.getByText('Add', { exact: true })).toBeVisible();
        await expect(menu.getByText('Options', { exact: true })).toBeVisible();
        await expect(menu.getByTestId('run-composer-menu-item-maxPages')).toHaveAttribute(
          'aria-expanded',
          'false',
        );
        // The entry URL is the composer's own text, not a menu entry.
        await expect(menu.getByTestId('run-composer-menu-item-url')).toHaveCount(0);
        await expect(visual).toBeChecked();
      },
    );
    await test.step('When I switch "Visual review with Iris" off', async () => {
      await visual.setChecked(false);
      await expect(visual).not.toBeChecked();
      await closeComposerMenu(page);
    });
    await test.step('Then a removable chip for it shows above the composer', async () => {
      await expect(chip).toHaveText(/Visual review with Iris off/);
    });
    await test.step('When I remove the chip', async () => {
      await chip
        .getByRole('button', { name: 'Remove Visual review with Iris off', exact: true })
        .click();
    });
    await test.step('Then the switch is back to its default', async () => {
      await expect(chip).toHaveCount(0);
      await openComposerMenu(page);
      await expect(visual).toBeChecked();
    });
    await test.step('And a text option set in the menu shows as a chip too', async () => {
      await unfoldMenuItem(page, 'maxPages');
      await pages.fill('20');
      await expect(page.getByTestId('run-composer-chip-maxPages')).toHaveText(/Max pages: 20/);
    });
    await test.step('And a click outside the menu closes it', async () => {
      // The menu covers the middle of the chat: click its top right corner.
      const box = (await page.getByTestId('workflow-run-chat-log').boundingBox())!;
      await page.mouse.click(box.x + box.width - 16, box.y + 16);
      await expect(menu).toBeHidden();
      await expect(plus).toHaveAttribute('aria-expanded', 'false');
    });
  });

  test('A run needs its datasets', async ({ page }) => {
    const ask = page.getByTestId('run-intake-datasets');
    await test.step(`Given I am on the Run tab of "${V2}"`, async () => {
      await openWorkflowPage(page, V2_ID, V2);
      await openRunTab(page);
    });
    await test.step(`When I type "${QUESTION}" and click Send`, async () => {
      await composer(page).fill(QUESTION);
      await sendRun(page);
    });
    await test.step('Then the agent asks which datasets to use and nothing runs', async () => {
      await expect(ask).toBeVisible();
      await expect(ask.getByTestId('run-agent-message')).toContainText('Pick one or more datasets.');
      await expect(page.getByTestId('workflow-run-error')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
      await expect(page.getByTestId('run-answer')).toHaveCount(0);
      expect(stub.requests.filter((request) => request.stream)).toHaveLength(0);
    });
    await test.step('And "Continue" is not offered until I add one', async () => {
      const next = ask.getByTestId('run-intake-continue');
      await expect(next).toBeDisabled();
      await ask.getByTestId(`run-intake-option-datasets-${WORLD_CUP_DATASET}`).click();
      await expect(next).toBeEnabled();
      await expect(next).toHaveText('Continue with 1 dataset');
      expect(stub.requests.filter((request) => request.stream)).toHaveLength(0);
    });
  });

  test('Stop ends the run', async ({ page }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    const held = gate();
    stub.hold = (request) =>
      isTurn(request, QUESTION) && afterToolResult(request) ? held.promise : undefined;
    try {
      await test.step(`Given "${V2}" is running on a question`, async () => {
        await openWorkflowPage(page, V2_ID, V2);
        await openRunTab(page);
        await fillRun(page, QUESTION, WORLD_CUP_DATASET);
        await sendRun(page);
        await expect(page.locator('[data-testid="workflow-run-tool"][data-tool="run_readonly_sql"]').first()).toBeVisible();
      });
      await test.step('When I click Stop', async () => {
        await page.getByTestId('workflow-run-stop').click();
      });
      await test.step('Then the run reads "Run stopped" and its Analyse step "Stopped"', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run stopped');
        await expect(runStep(page, 'analyse')).toHaveAttribute('data-status', 'stopped');
        await expect(nodeStatus(page, 'analyse')).toHaveText('Stopped');
        await expect(page.getByTestId('workflow-run-stop')).toHaveCount(0);
        // The composer stays hidden under the stopped run until New question.
        await expect(page.getByTestId('run-composer')).toHaveCount(0);
        await page.getByTestId('workflow-run-new').click();
        await expect(composer(page)).toBeVisible();
        await expect(sendButton(page)).toBeDisabled();
      });
      await test.step('And the run is stored "stopped" on the server, not only on the page', async () => {
        // Stop is the server's (api.md 150); leaving the page would not stop it.
        await expect
          .poll(async () => {
            const res = await page.request.get(`${apiBaseOf(page)}/workflow-runs`);
            const { runs } = (await res.json()) as { runs: { status: string }[] };
            return runs.map((run) => run.status);
          })
          .toEqual(['stopped']);
      });
    } finally {
      held.release();
    }
  });

  test(
    'A run keeps running while I am elsewhere, and its page shows it again',
    { tag: ['@demo', '@story-1.26.5'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER });
      // The answer waits until the test has come back to the page.
      const held = gate();
      stub.hold = (request) =>
        isTurn(request, QUESTION) && afterToolResult(request) ? held.promise : undefined;
      const tasksButton = page
        .getByRole('complementary', { name: 'Navigation rail' })
        .getByTestId('background-tasks-button');
      try {
        await scenarioStep(page, `Given "${V2}" is running on a question`, async () => {
          await openWorkflowPage(page, V2_ID, V2);
          await openRunTab(page);
          await fillRun(page, QUESTION, WORLD_CUP_DATASET);
          await sendRun(page);
          await expect(page.locator('[data-testid="workflow-run-tool"][data-tool="run_readonly_sql"]').first()).toBeVisible();
        });
        await scenarioStep(page, 'When I go to another area', async () => {
          await railItem(page, 'Datasets').click();
          await expect(page.getByTestId('workflow-detail-name')).toHaveCount(0);
        });
        await scenarioStep(
          page,
          'Then the Background tasks button shows the run, 1 running',
          async () => {
            await expect(tasksButton).toHaveAccessibleName('Background tasks, 1 running');
            await tasksButton.click();
            const panel = page.getByRole('dialog', { name: 'Background tasks' });
            const row = panel
              .getByTestId('background-task')
              .filter({ hasText: `${V2}: ${QUESTION}` });
            await expect(row).toHaveAttribute('data-status', 'running');
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
            // Leaving did not stop it: the stored run still runs.
            const stored = await page.request.get(`${apiBaseOf(page)}/workflow-runs`);
            const { runs } = (await stored.json()) as { runs: { status: string }[] };
            expect(runs.map((run) => run.status)).toEqual(['running']);
          },
        );
        await scenarioStep(page, `When I open "${V2}" again`, async () => {
          await openWorkflowPage(page, V2_ID, V2);
        });
        await scenarioStep(
          page,
          'Then the live view is there: the question, Analyse running and its SQL call',
          async () => {
            await expect(page.getByTestId('workflow-run-question')).toHaveText(QUESTION);
            await expect(nodeStatus(page, 'analyse')).toHaveText('Running');
            await expect(page.locator('[data-testid="workflow-run-tool"][data-tool="run_readonly_sql"]').first()).toBeVisible();
            await expect(page.getByTestId('workflow-run-stop')).toBeVisible();
          },
        );
        await scenarioStep(page, 'When the model answers', async () => {
          held.release();
        });
        await scenarioStep(page, 'Then the answer shows and the task ends', async () => {
          await expect(runAnswer(page)).toContainText(ANSWER);
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          // The task reads the run every 3 s until it ends.
          await expect(tasksButton).toHaveAccessibleName('Background tasks');
        });
      } finally {
        held.release();
      }
    },
  );
});

test('the Run tab with an answer has no detectable accessibility violations in either theme', async ({
  page,
}) => {
  stub.reply = answerWithSql({ [QUESTION]: ANSWER });
  await followOsTheme(page);
  await page.addScriptTag({ content: axe.source });
  await openWorkflowPage(page, V2_ID, V2);
  await openRunTab(page);
  await fillRun(page, QUESTION, WORLD_CUP_DATASET);
  await sendRun(page);
  await expect(runAnswer(page)).toContainText(ANSWER);
  await expect(page.getByTestId('workflow-run-new')).toBeVisible();

  async function scan(label: string): Promise<void> {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // Let the theme's colour transitions finish before axe reads colours.
      await page.waitForTimeout(500);
      const results = await page.evaluate(async () => {
        return (window as unknown as { axe: typeof axe }).axe.run(document);
      });
      expect(results.violations, `${V2} ${label}, ${theme}`).toEqual([]);
    }
  }

  await scan('Run panel with an answer');
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();
  await expect(runDock(page).getByTestId('workflow-run-dock-maximize')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await scan('Run panel with an answer, maximized');

  // The query inspector (roadmap 1.25), each tab: opening it restores the panel.
  await runAnswer(page).locator('[data-testid^="query-row-"]').first().click();
  const inspector = page.getByTestId('query-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId('query-funnel-step').first()).toBeVisible();
  await scan('Query inspector, Step by step');
  await inspector.getByTestId('query-inspector-tab-result').click();
  await expect(inspector.getByTestId('query-result-table')).toBeVisible();
  await scan('Query inspector, Result');
  await inspector.getByTestId('query-inspector-tab-sql').click();
  await expect(inspector.getByTestId('query-sql')).toBeVisible();
  await scan('Query inspector, SQL');
});
