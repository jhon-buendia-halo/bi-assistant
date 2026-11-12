import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import {
  createUserAgent,
  publishAgent,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Workflow runs" in specs/capabilities/workflows/spec.md:
 * agent workflows run from their page's Run tab (workflows R21), on the
 * recording stub model and the World Cup dataset.
 */

const QUESTION = 'Which team scored the most goals?';
const ANSWER = 'Brazil scored the most goals in this data.';
const FOLLOW_UP = 'And the fewest?';
const FOLLOW_UP_ANSWER = 'Bolivia scored the fewest goals in this data.';
const SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
const CLARIFY_QUESTION = 'Which team performed best?';
const CLARIFY = 'Which measure of best do you mean?';
const OPTIONS = ['Most titles', 'Highest win rate'];
const V2_QUESTION = 'How many matches were played in each stage?';
const V2_STEPS = ['receive-question', 'load-catalog', 'analyse', 'wrap-up'];
const HEALTH = 'Health plan analyst';
const HEALTH_INSTRUCTIONS = 'Always name the plan year in your answer.';

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

/** A streamed call of the turn whose latest user message is `text`. */
function isTurn(request: StubRequest, text: string): boolean {
  return request.stream && lastUserText(request) === text;
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
  await expect(page.getByTestId('workflow-panel-tab-run')).toHaveAttribute(
    'aria-selected',
    'true',
  );
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
    'I run the Assistant on a question',
    { tag: ['@demo', '@story-1.23.15'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER, [FOLLOW_UP]: FOLLOW_UP_ANSWER });
      // The first answer waits until the test has seen the step running.
      const held = gate();
      stub.hold = (request) =>
        isTurn(request, QUESTION) && afterToolResult(request) ? held.promise : undefined;

      await scenarioStep(page, 'When I open the Assistant from Workflows and click Execute', async () => {
        await openWorkflowPage(page, 'agent:assistant', 'Assistant');
        await openRunTab(page);
      });
      await scenarioStep(
        page,
        'Then the Run tab shows the question, the datasets to pick and Careful',
        async () => {
          const panel = detailsPanel(page);
          await expect(panel.getByLabel('Question', { exact: true })).toHaveAttribute(
            'placeholder',
            'Ask a question about your data',
          );
          await expect(datasetCard(page, WORLD_CUP_DATASET)).toHaveAttribute('aria-pressed', 'false');
          await expect(
            panel.getByLabel('Careful: cross-check the result with an independent query'),
          ).not.toBeChecked();
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
        'Then the Answer step is running on the canvas and in the Run tab, with its SQL call',
        async () => {
          await expect(nodeStatus(page, 'answer')).toHaveText('Running');
          await expect(runStep(page, 'answer').getByText('Running', { exact: true })).toBeVisible();
          await expect(page.getByTestId('workflow-run-live')).toContainText('Thinking');
          await expect(page.getByTestId('workflow-run-tool')).toContainText('run_readonly_sql');
          await expect(page.getByTestId('workflow-run-stop')).toBeVisible();
          held.release();
        },
      );
      await scenarioStep(page, "And I see the stub's answer with its SQL", async () => {
        await expect(runAnswer(page)).toContainText(ANSWER);
        await runAnswer(page).getByText(/Data used \(1 query\)/).click();
        await expect(runAnswer(page).locator('pre', { hasText: SQL })).toBeVisible();
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
        await expect(nodeStatus(page, 'answer')).toHaveText('Done');
      });
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
            .map((m) => `${m.role}:${messageText(m)}`);          const question = texts.findIndex((t) => t.startsWith('user:') && t.includes(QUESTION));
          const answer = texts.findIndex((t) => t.startsWith('assistant:') && t.includes(ANSWER));
          const next = texts.findIndex((t) => t === `user:${FOLLOW_UP}`);
          expect(question, 'the earlier question').toBeGreaterThanOrEqual(0);
          expect(answer, 'the earlier answer').toBeGreaterThan(question);
          expect(next, 'the follow-up after both').toBeGreaterThan(answer);
        },
      );
      await scenarioStep(
        page,
        `When I run "Questions to Insights v2" on "${V2_QUESTION}" over "${WORLD_CUP_DATASET}"`,
        async () => {
          stub.reply = answerWithSql({ [V2_QUESTION]: ANSWER });
          await openWorkflowPage(page, 'qti-v2-turn', 'Questions to Insights v2');
          await openRunTab(page);
          await fillRun(page, V2_QUESTION, WORLD_CUP_DATASET);
          await page.getByTestId('workflow-run').click();
        },
      );
      await scenarioStep(page, 'Then its four canvas nodes go Done and I see its answer', async () => {
        for (const id of V2_STEPS) {
          await expect(nodeStatus(page, id)).toHaveText('Done');
          await expect(runStep(page, id).getByText('Done', { exact: true })).toBeVisible();
        }
        await expect(runAnswer(page)).toContainText(ANSWER);
      });
    },
  );

  test('Careful mode cross-checks', async ({ page }) => {
    const verify = answerWithSql({ [QUESTION]: ANSWER });
    stub.reply = (request) =>
      systemTexts(request).some((text) => text.includes('You independently derive the SQL'))
        ? { text: JSON.stringify({ sql: SQL }) }
        : verify(request);

    await test.step('Given I am on the Assistant\'s Run tab with a question and a dataset', async () => {
      await openWorkflowPage(page, 'agent:assistant', 'Assistant');
      await openRunTab(page);
      await fillRun(page, QUESTION, WORLD_CUP_DATASET);
    });
    await test.step('When I turn Careful on and click Execute', async () => {
      await detailsPanel(page)
        .getByLabel('Careful: cross-check the result with an independent query')
        .check();
      await page.getByTestId('workflow-run').click();
    });
    await test.step('Then the answer carries the "Cross-checked" chip', async () => {
      await expect(runAnswer(page)).toContainText(ANSWER);
      await expect(runAnswer(page).getByText('Cross-checked', { exact: true })).toBeVisible();
    });
    await test.step('And the recorded run had the cross-check asked of the model', async () => {
      expect(
        stub.requests.some((request) =>
          systemTexts(request).some((text) => text.includes('You independently derive the SQL')),
        ),
        'a verifier call',
      ).toBe(true);
    });
  });

  test('A run needs its datasets', async ({ page }) => {
    await test.step('Given I am on the Assistant\'s Run tab', async () => {
      await openWorkflowPage(page, 'agent:assistant', 'Assistant');
      await openRunTab(page);
    });
    await test.step(`When I type "${QUESTION}" and click Execute with no dataset picked`, async () => {
      await fillRun(page, QUESTION);
      await page.getByTestId('workflow-run').click();
    });
    await test.step('Then I see "Select at least one dataset" and no result', async () => {
      await expect(page.getByTestId('workflow-run-error')).toHaveText('Select at least one dataset');
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
      await test.step('Given the Assistant is running on a question', async () => {
        await openWorkflowPage(page, 'agent:assistant', 'Assistant');
        await openRunTab(page);
        await fillRun(page, QUESTION, WORLD_CUP_DATASET);
        await page.getByTestId('workflow-run').click();
        await expect(page.getByTestId('workflow-run-tool')).toContainText('run_readonly_sql');
      });
      await test.step('When I click Stop', async () => {
        await page.getByTestId('workflow-run-stop').click();
      });
      await test.step('Then the run reads "Run stopped" and its Answer step "Stopped"', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run stopped');
        await expect(runStep(page, 'answer').getByText('Stopped', { exact: true })).toBeVisible();
        await expect(nodeStatus(page, 'answer')).toHaveText('Stopped');
        await expect(page.getByTestId('workflow-run')).toHaveText('Execute');
        await expect(page.getByTestId('workflow-run-stop')).toHaveCount(0);
      });
    } finally {
      held.release();
    }
  });

  test('A clarifying question becomes options', async ({ page }) => {
    stub.reply = (request) => {
      if (isTurn(request, CLARIFY_QUESTION)) {
        return {
          toolCall: {
            name: toolName(request, 'ask_clarification'),
            arguments: { question: CLARIFY, options: OPTIONS },
          },
        };
      }
      return { text: ANSWER };
    };
    await test.step(`Given the Assistant asked "${CLARIFY}" with two options`, async () => {
      await openWorkflowPage(page, 'agent:assistant', 'Assistant');
      await openRunTab(page);
      await fillRun(page, CLARIFY_QUESTION, WORLD_CUP_DATASET);
      await page.getByTestId('workflow-run').click();
      const card = runAnswer(page).locator('div.card', { hasText: CLARIFY });
      await expect(card.getByRole('button', { name: /1\s*Most titles/ })).toBeVisible();
    });
    await test.step('When I pick "Highest win rate"', async () => {
      await runAnswer(page).getByRole('button', { name: /2\s*Highest win rate/ }).click();
    });
    await test.step('Then a new run answers, given the question and my pick', async () => {
      await expect(runAnswer(page)).toContainText(ANSWER);
      await expect(page.getByTestId('workflow-run-context')).toHaveText(
        `Follows up on “${CLARIFY_QUESTION}”`,
      );
      const pick = stub.requests.filter((request) => isTurn(request, OPTIONS[1]));
      expect(pick.length, `"${OPTIONS[1]}" sent as the next run's question`).toBeGreaterThan(0);
      expect(
        pick[0].messages.some(
          (message) => message.role === 'assistant' && messageText(message).includes(CLARIFY),
        ),
      ).toBe(true);
    });
  });

  test("A user agent's workflow runs over its own datasets", async ({ page }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    let id = '';
    await test.step(
      `Given a published user agent "${HEALTH}" over "${WORLD_CUP_DATASET}" with its own instructions`,
      async () => {
        id = await createUserAgent(page, {
          name: HEALTH,
          description: 'Answers questions about the 2026 health plan',
          instructions: HEALTH_INSTRUCTIONS,
          datasets: [WORLD_CUP_DATASET],
        });
        await publishAgent(page, id);
      },
    );
    await test.step("And I am on its workflow's Run tab", async () => {
      await openWorkflowPage(page, `agent:${id}`, HEALTH);
      await openRunTab(page);
    });
    await test.step(`Then its dataset "${WORLD_CUP_DATASET}" is shown read-only, with no picker`, async () => {
      await expect(page.getByTestId('workflow-run-datasets')).toContainText(WORLD_CUP_DATASET);
      await expect(page.getByTestId('workflow-input-datasets')).toHaveCount(0);
    });
    await test.step(`When I run it on "${QUESTION}"`, async () => {
      await fillRun(page, QUESTION);
      await page.getByTestId('workflow-run').click();
    });
    await test.step('Then I see its answer, and its instructions reached the model', async () => {
      await expect(runAnswer(page)).toContainText(ANSWER);
      const turn = stub.requests.filter((request) => isTurn(request, QUESTION));
      expect(turn.length).toBeGreaterThan(0);
      expect(
        turn[0].messages.some(
          (message) => message.role === 'system' && messageText(message).includes(HEALTH_INSTRUCTIONS),
        ),
      ).toBe(true);
    });
  });
});

test('the Run tab with an answer has no detectable accessibility violations in either theme', async ({
  page,
}) => {
  stub.reply = answerWithSql({ [QUESTION]: ANSWER });
  await followOsTheme(page);
  await page.addScriptTag({ content: axe.source });
  await openWorkflowPage(page, 'agent:assistant', 'Assistant');
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
    expect(results.violations, `Assistant Run tab with an answer, ${theme}`).toEqual([]);
  }
});
