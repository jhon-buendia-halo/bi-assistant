import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
} from './helpers/llm-stub';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Workflow runs" in specs/capabilities/workflows/spec.md:
 * Questions to Insights v2 runs from its page's Run tab (workflows R21), on
 * the recording stub model and the World Cup dataset.
 */

const V2_ID = 'qti-v2-turn';
const V2 = 'Questions to Insights v2';
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

function detailsPanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Details panel' });
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

function datasetCard(page: Page, name: string): Locator {
  return page.getByTestId('workflow-input-datasets').getByRole('button', { name });
}

async function fillRun(page: Page, question: string, dataset?: string): Promise<void> {
  if (dataset !== undefined) {
    await datasetCard(page, dataset).click();
    await expect(datasetCard(page, dataset)).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByTestId('workflow-input-question').fill(question);
}

function runStep(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-run-step-${id}`);
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
    'I run Questions to Insights v2 on a question',
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
          const panel = detailsPanel(page);
          await expect(panel.getByLabel('Question', { exact: true })).toHaveAttribute(
            'placeholder',
            'Ask a question about your data',
          );
          await expect(datasetCard(page, WORLD_CUP_DATASET)).toHaveAttribute('aria-pressed', 'false');
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
          await expect(runStep(page, 'analyse').getByText('Running', { exact: true })).toBeVisible();
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
          await runAnswer(page).getByText(/Data used \(1 query\)/).click();
          await expect(runAnswer(page).locator('pre', { hasText: SQL })).toBeVisible();
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          for (const id of V2_STEPS) {
            await expect(nodeStatus(page, id)).toHaveText('Done');
            await expect(runStep(page, id).getByText('Done', { exact: true })).toBeVisible();
          }
          await expect(nodeStatus(page, 'clarify')).toHaveText('Skipped');
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
        await expect(page.getByTestId('workflow-input-question')).toHaveValue(FOLLOW_UP);
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
          await page.getByTestId('workflow-run').click();
          await expect(runAnswer(page)).toContainText(ANSWER);
          await expect(runAnswer(page).getByText('Verified', { exact: true })).toBeVisible();
        },
      );
    },
  );

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
      await expect(page.getByTestId('workflow-run-result')).toHaveCount(0);
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
        await expect(runStep(page, 'analyse').getByText('Stopped', { exact: true })).toBeVisible();
        await expect(nodeStatus(page, 'analyse')).toHaveText('Stopped');
        await expect(page.getByTestId('workflow-run')).toHaveText('Execute');
        await expect(page.getByTestId('workflow-run-stop')).toHaveCount(0);
      });
    } finally {
      held.release();
    }
  });

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

  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // Let the theme's colour transitions finish before axe reads colours.
    await page.waitForTimeout(500);
    const results = await page.evaluate(async () => {
      return (window as unknown as { axe: typeof axe }).axe.run(document);
    });
    expect(results.violations, `${V2} Run tab with an answer, ${theme}`).toEqual([]);
  }
});
