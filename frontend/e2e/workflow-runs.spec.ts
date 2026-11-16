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
import { fillRun, pickDataset, pickedDataset } from './helpers/run-ui';

/**
 * Mirrors the Feature "Workflow runs" in specs/capabilities/workflows/spec.md:
 * Answer a Business Question runs from its page's Run tab (workflows R21), on
 * the recording stub model and the World Cup dataset.
 */

const V2_ID = 'answer-business-question';
const V2 = 'Answer a Business Question';
const QUESTION = 'Which team scored the most goals?';
const ANSWER = 'Brazil scored the most goals in this data.';
const FOLLOW_UP = 'And the fewest?';
const FOLLOW_UP_ANSWER = 'Bolivia scored the fewest goals in this data.';
const SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
/** The steps a clear question runs (Clarify, the other way after Plan, is skipped). */
const V2_STEPS = [
  'receive-question',
  'load-catalog',
  'plan',
  'analyse',
  'validate',
  'write-answer',
  'wrap-up',
];

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
  await railItem(page, 'Workflows').click();
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  await page.getByTestId(`workflow-${id}`).click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(name);
}

async function openRunTab(page: Page): Promise<void> {
  await page.getByTestId('workflow-execute').click();
  await expect(page.getByTestId('workflow-run')).toBeVisible();
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
      stub.reply = answerWithSql({ [QUESTION]: ANSWER, [FOLLOW_UP]: FOLLOW_UP_ANSWER });
      // The first answer waits until the test has seen the step running.
      const held = gate();
      stub.hold = (request) =>
        isTurn(request, QUESTION) && afterToolResult(request) ? held.promise : undefined;

      await scenarioStep(page, `When I open "${V2}" from Workflows and click Execute`, async () => {
        await openWorkflowPage(page, V2_ID, V2);
        await openRunTab(page);
      });
      await scenarioStep(
        page,
        'Then the Run tab shows the question and the datasets to pick, and no Careful',
        async () => {
          const panel = runDock(page);
          await expect(page.getByRole('complementary', { name: 'Details panel' })).toHaveCount(0);
          await expect(panel.getByLabel('Question', { exact: true })).toHaveAttribute(
            'placeholder',
            'Ask a question about your data',
          );
          await expect(pickedDataset(page, WORLD_CUP_DATASET)).toHaveCount(0);
          await expect(panel.getByLabel(/^Careful/)).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        `When I pick "${WORLD_CUP_DATASET}", type "${QUESTION}" and click Execute`,
        async () => {
          await fillRun(page, QUESTION, WORLD_CUP_DATASET);
          await page.getByTestId('workflow-run').click();
        },
      );
      await scenarioStep(
        page,
        'Then the Analyse step is running on the canvas and in the Run tab, with its SQL call',
        async () => {
          await expect(nodeStatus(page, 'analyse')).toHaveText('Running');
          await expect(runStep(page, 'analyse')).toHaveAttribute('data-status', 'running');
          await expect(page.getByTestId('workflow-run-live')).toContainText('Thinking');
          await expect(page.getByTestId('workflow-run-tool')).toContainText('run_readonly_sql');
          await expect(page.getByTestId('workflow-run-stop')).toBeVisible();
          held.release();
        },
      );
      await scenarioStep(
        page,
        "And I see the stub's answer with its SQL, and every step Done but Clarify",
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
          await expect(nodeStatus(page, 'clarify')).toHaveText('Skipped');
          // The data-quality check runs only when asked for, and its line says so.
          await expect(nodeStatus(page, 'check-data-quality')).toHaveText('Skipped');
          await expect(runStep(page, 'check-data-quality')).toHaveAttribute(
            'data-status',
            'skipped',
          );
          await expect(
            runStep(page, 'check-data-quality').getByTestId('workflow-node-activity'),
          ).toHaveText('Off for this run');
        },
      );
      await scenarioStep(page, `When I follow up with "${FOLLOW_UP}"`, async () => {
        await page.getByTestId('workflow-follow-up-input').fill(FOLLOW_UP);
        await page.getByTestId('workflow-run-follow-up').click();
      });
      await scenarioStep(page, 'Then I see the second answer', async () => {
        await expect(runAnswer(page)).toContainText(FOLLOW_UP_ANSWER);
        await expect(page.getByTestId('workflow-run-context')).toHaveText(
          `Follows up on “${QUESTION}”`,
        );
        await expect(page.getByTestId('workflow-run-question')).toHaveText(FOLLOW_UP);
      });
      await scenarioStep(
        page,
        'And the follow-up reached the model after the earlier question and answer',
        async () => {
          const followUp = stub.requests.filter((request) => isTurn(request, FOLLOW_UP));
          expect(followUp.length, `a streamed call for "${FOLLOW_UP}"`).toBeGreaterThan(0);
          const texts = followUp[0].messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => `${m.role}:${messageText(m)}`);
          const question = texts.findIndex((t) => t.startsWith('user:') && t.includes(QUESTION));
          const answer = texts.findIndex((t) => t.startsWith('assistant:') && t.includes(ANSWER));
          const next = texts.findIndex((t) => t === `user:${FOLLOW_UP}`);
          expect(question, 'the earlier question').toBeGreaterThanOrEqual(0);
          expect(answer, 'the earlier answer').toBeGreaterThan(question);
          expect(next, 'the follow-up after both').toBeGreaterThan(answer);
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
        await page.getByTestId('workflow-run').click();
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
        // The sheet stays clear of the Run panel and the answer stays visible.
        const sheetBox = (await page.getByTestId('query-inspector-sheet').boundingBox())!;
        const dockBox = (await runDock(page).boundingBox())!;
        expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(dockBox.x + 1);
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
        await page.getByTestId('workflow-run').click();
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
    'Answer a Business Question checks data quality with Sarah when asked',
    { tag: ['@demo'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER });

      await scenarioStep(page, `Given I open "${V2}" and its Run tab`, async () => {
        await openWorkflowPage(page, V2_ID, V2);
        await openRunTab(page);
      });
      await scenarioStep(
        page,
        `When I tick "Check data quality", pick "${WORLD_CUP_DATASET}", ask "${QUESTION}" and click Execute`,
        async () => {
          await page.getByTestId('workflow-input-checkDataQuality').check();
          await fillRun(page, QUESTION, WORLD_CUP_DATASET);
          await page.getByTestId('workflow-run').click();
        },
      );
      await scenarioStep(
        page,
        'Then "Check data quality" ends Done, after Validate and before Write answer in How it ran',
        async () => {
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          await expect(nodeStatus(page, 'check-data-quality')).toHaveText('Done');
          await expect(runStep(page, 'check-data-quality')).toHaveAttribute('data-status', 'success');
          const order = await page
            .getByTestId('workflow-run-story')
            .locator('[data-testid^="workflow-run-story-step-"]')
            .evaluateAll((els) =>
              els.map((e) =>
                (e.getAttribute('data-testid') ?? '').replace('workflow-run-story-step-', ''),
              ),
            );
          expect(order.indexOf('check-data-quality')).toBeGreaterThan(order.indexOf('validate'));
          expect(order.indexOf('check-data-quality')).toBeLessThan(order.indexOf('write-answer'));
        },
      );
      await scenarioStep(
        page,
        "And Sarah's model call reached the stub, and the answer shows a readiness card",
        async () => {
          const asked = stub.requests.filter((request) => request.step === 'quality');
          expect(asked.length, "Sarah's structured call").toBeGreaterThan(0);
          await expect(runAnswer(page)).toContainText(ANSWER);
          await expect(runAnswer(page).getByTestId('readiness-card')).toBeVisible();
        },
      );
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
        await page.getByTestId('workflow-run').click();
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
          // New question keeps the dataset picked; the question is typed again.
          await page.getByTestId('workflow-run-new').click();
          await page.getByTestId('workflow-input-question').fill(QUESTION);
          await page.getByTestId('workflow-run').click();
          await expect(runAnswer(page)).toContainText(ANSWER);
          await expect(runAnswer(page).getByText('Verified', { exact: true })).toBeVisible();
        },
      );
    },
  );

  test('Enter runs the question, New question starts over and a follow-up replaces the form', async ({
    page,
  }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    await test.step(`Given I am on the Run panel of "${V2}" with "${WORLD_CUP_DATASET}" picked`, async () => {
      await openWorkflowPage(page, V2_ID, V2);
      await openRunTab(page);
      await pickDataset(page, WORLD_CUP_DATASET);
    });
    await test.step('When I type the question and press Enter', async () => {
      const question = page.getByTestId('workflow-input-question');
      await question.fill(QUESTION);
      await question.press('Enter');
    });
    await test.step('Then the workflow runs and I see the answer', async () => {
      await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      await expect(runAnswer(page)).toContainText(ANSWER);
      await expect(page.getByTestId('workflow-run-question')).toHaveText(QUESTION);
    });
    await test.step('And the follow-up composer replaces the run form under the answer', async () => {
      const followUp = page.getByTestId('workflow-follow-up-input');
      await expect(followUp).toBeVisible();
      await expect(followUp).toHaveAccessibleName('Follow-up question');
      await expect(followUp).toHaveJSProperty('tagName', 'TEXTAREA');
      await expect(page.getByTestId('workflow-run-follow-up')).toBeDisabled();
      await expect(page.getByTestId('workflow-input-question')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run')).toHaveCount(0);
    });
    await test.step('When I click New question', async () => {
      await page.getByTestId('workflow-run-new').click();
    });
    await test.step('Then the run is cleared, the question is empty and the dataset stays picked', async () => {
      await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
      await expect(runAnswer(page)).toHaveCount(0);
      await expect(page.getByTestId('workflow-follow-up-input')).toHaveCount(0);
      await expect(page.getByTestId('workflow-input-question')).toHaveValue('');
      await expect(page.getByTestId('workflow-input-question')).toBeFocused();
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
    await test.step('When I press Arrow Left on the resize separator, the panel grows', async () => {
      const separator = dock.getByRole('separator', { name: 'Resize Run panel' });
      await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
      const before = Number(await separator.getAttribute('aria-valuenow'));
      await separator.focus();
      await page.keyboard.press('ArrowLeft');
      await expect
        .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
        .toBeGreaterThan(before);
      await expect.poll(width).toBeGreaterThan(normal);
    });
  });

  test('A run needs its datasets', async ({ page }) => {
    await test.step(`Given I am on the Run tab of "${V2}"`, async () => {
      await openWorkflowPage(page, V2_ID, V2);
      await openRunTab(page);
    });
    await test.step(`When I type "${QUESTION}" and click Execute with no dataset picked`, async () => {
      await fillRun(page, QUESTION);
      await page.getByTestId('workflow-run').click();
    });
    await test.step('Then I see "Select at least one dataset" and no result', async () => {
      // The run form refuses it on the field, before any request (ui.md 4.4b).
      await expect(page.getByTestId('workflow-input-error-datasets')).toHaveText(
        'Select at least one dataset',
      );
      await expect(page.getByTestId('workflow-run-error')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
      await expect(page.getByTestId('run-answer')).toHaveCount(0);
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
        await page.getByTestId('workflow-run').click();
        await expect(page.getByTestId('workflow-run-tool')).toContainText('run_readonly_sql');
      });
      await test.step('When I click Stop', async () => {
        await page.getByTestId('workflow-run-stop').click();
      });
      await test.step('Then the run reads "Run stopped" and its Analyse step "Stopped"', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run stopped');
        await expect(runStep(page, 'analyse')).toHaveAttribute('data-status', 'stopped');
        await expect(nodeStatus(page, 'analyse')).toHaveText('Stopped');
        await expect(page.getByTestId('workflow-run')).toHaveText('Execute');
        await expect(page.getByTestId('workflow-run-stop')).toHaveCount(0);
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
          await page.getByTestId('workflow-run').click();
          await expect(page.getByTestId('workflow-run-tool')).toContainText('run_readonly_sql');
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
            await expect(page.getByTestId('workflow-run-live')).toContainText('Thinking');
            await expect(page.getByTestId('workflow-run-tool')).toContainText('run_readonly_sql');
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
  await page.getByTestId('workflow-run').click();
  await expect(runAnswer(page)).toContainText(ANSWER);
  await expect(page.getByTestId('workflow-follow-up-input')).toBeVisible();

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
