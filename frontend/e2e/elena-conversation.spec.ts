import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  startLlmStub,
  turnRequests,
} from './helpers/llm-stub';
import { answerPickAsk, composer, sendRun } from './helpers/run-ui';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Ask Elena" in specs/capabilities/agents-evals/spec.md
 * (R115): a conversation with Elena, the Insights Lead, outside any workflow.
 * Needs the backend units of the Elena epic (agent:insights-lead, endpoint 168).
 */

const KEY = 'insights-lead';
const PANEL_KEY = 'questions-to-insights:agent-conversations-panel';
const QUESTION = 'How many matches were played in each stage?';
const FOLLOW_UP = 'And how many of them went to extra time?';
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

/** Elena queries the World Cup data once with SQL, then answers. */
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

async function openElenaPage(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agent personas', exact: true })
    .click();
  await page.getByTestId(`agent-${KEY}`).click();
  await expect(page.getByTestId('agent-ask-button')).toHaveText('Ask Elena');
}

/** Ask Elena, the first question and the dataset pick: her first answer shows. */
async function startConversation(page: Page): Promise<void> {
  await page.getByTestId('agent-ask-button').click();
  await expect(page.getByTestId('agent-conversation-page')).toBeVisible();
  await composer(page).fill(QUESTION);
  await sendRun(page);
  await answerPickAsk(page, WORLD_CUP_DATASET);
  await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
}

test.describe('Feature: Ask Elena (a conversation with the Insights Lead)', () => {
  test(
    'Ask Elena from her page opens a conversation with the panel collapsed',
    { tag: ['@demo'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        'When I open Elena on Agent personas',
        async () => {
          await openElenaPage(page);
        },
      );
      await scenarioStep(page, 'And I click "Ask Elena"', async () => {
        await page.getByTestId('agent-ask-button').click();
      });
      await scenarioStep(
        page,
        'Then I see the conversation page with the breadcrumb "Agent personas / Elena · Insights Lead" and the chip "Conversation"',
        async () => {
          await expect(
            page.getByTestId('agent-conversation-page'),
          ).toBeVisible();
          await expect(page.getByTestId('agent-conversation-back')).toHaveText(
            'Agent personas',
          );
          await expect(
            page.getByTestId('agent-conversation-breadcrumb'),
          ).toHaveText('Elena · Insights Lead');
          await expect(page.getByTestId('agent-conversation-chip')).toHaveText(
            'Conversation',
          );
        },
      );
      await scenarioStep(
        page,
        'And the conversations panel is collapsed, and the chat has no Run again, no Open in Builder and no view toggle',
        async () => {
          await expect(page.getByTestId('conversations-panel')).toHaveAttribute(
            'data-state',
            'collapsed',
          );
          await expect(page.getByTestId('workflow-run-again')).toHaveCount(0);
          await expect(
            page.getByTestId('workflow-run-open-builder'),
          ).toHaveCount(0);
          await expect(page.getByTestId('workflow-view-builder')).toHaveCount(
            0,
          );
          await expect(composer(page)).toHaveAttribute(
            'placeholder',
            'Message Elena',
          );
        },
      );
    },
  );

  test(
    'A follow-up joins the conversation and the work summary opens to its queries',
    { tag: ['@demo'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        `Given I asked Elena "${QUESTION}"`,
        async () => {
          await openElenaPage(page);
          await startConversation(page);
        },
      );
      await scenarioStep(
        page,
        'Then a work summary sits above her answer with the queries she ran',
        async () => {
          const summary = page.getByTestId('run-work-summary').first();
          await expect(summary).toBeVisible();
          await expect(
            page.getByTestId('run-work-summary-queries').first(),
          ).toHaveText('Ran 1 query');
          await expect(summary).toHaveAttribute('aria-expanded', 'false');
        },
      );
      await scenarioStep(page, `When I send "${FOLLOW_UP}"`, async () => {
        await page.getByTestId('workflow-avery-input').fill(FOLLOW_UP);
        await page.getByTestId('workflow-avery-send').click();
        await expect(page.getByTestId('workflow-run-question')).toHaveText(
          FOLLOW_UP,
        );
        await expect(page.getByTestId('run-answer')).toContainText(ANSWER);
      });
      await scenarioStep(
        page,
        'Then the follow-up is in the same conversation, under the first question',
        async () => {
          await expect(page.getByTestId('workflow-turn-question')).toHaveText(
            QUESTION,
          );
          expect(turnRequests(stub, FOLLOW_UP).length).toBeGreaterThan(0);
        },
      );
      await scenarioStep(page, 'When I open the work summary', async () => {
        await page.getByTestId('run-work-summary').last().click();
      });
      await scenarioStep(
        page,
        'Then I see her query, and clicking it opens the query inspector',
        async () => {
          await expect(
            page.getByTestId('run-work-summary-query-list').last(),
          ).toBeVisible();
          await page.getByTestId('run-work-summary-query').last().click();
          await expect(page.getByTestId('query-inspector-sheet')).toBeVisible();
        },
      );
    },
  );

  test(
    'The conversations panel expands, searches and remembers its state',
    { tag: ['@demo'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        'Given I have a conversation with Elena',
        async () => {
          await openElenaPage(page);
          await startConversation(page);
        },
      );
      await scenarioStep(
        page,
        'When I click "Show conversations"',
        async () => {
          await page.getByTestId('conversations-panel-toggle').click();
        },
      );
      await scenarioStep(
        page,
        'Then the panel opens, groups my conversation under Today and highlights it',
        async () => {
          const panel = page.getByTestId('conversations-panel');
          await expect(panel).toHaveAttribute('data-state', 'expanded');
          await expect(
            panel.getByTestId('conversations-panel-group').first(),
          ).toContainText('Today');
          await expect(
            panel.getByTestId('conversation-item').first(),
          ).toHaveAttribute('aria-current', 'true');
          await expect(
            panel.getByTestId('conversation-item').first(),
          ).toContainText(QUESTION);
        },
      );
      await scenarioStep(
        page,
        'When I search for a word that matches nothing',
        async () => {
          await page.getByTestId('conversations-panel-search').fill('zzzz');
        },
      );
      await scenarioStep(
        page,
        'Then the panel says no conversation matches',
        async () => {
          await expect(
            page.getByTestId('conversations-panel-empty'),
          ).toHaveText('No conversations match "zzzz".');
          await page.getByTestId('conversations-panel-search').fill('');
          await expect(page.getByTestId('conversation-item')).toHaveCount(1);
        },
      );
      await scenarioStep(
        page,
        'And after I reload the app the panel is still open',
        async () => {
          expect(
            await page.evaluate((key) => localStorage.getItem(key), PANEL_KEY),
          ).toBe('expanded');
          await page.reload();
          await openElenaPage(page);
          await page.getByTestId('agent-ask-button').click();
          await expect(page.getByTestId('conversations-panel')).toHaveAttribute(
            'data-state',
            'expanded',
          );
        },
      );
    },
  );

  test(
    'Archiving a conversation moves it under Archived',
    { tag: ['@demo'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        'Given I have a conversation with Elena',
        async () => {
          await openElenaPage(page);
          await startConversation(page);
        },
      );
      await scenarioStep(page, 'When I click "Archive"', async () => {
        await page.getByTestId('workflow-run-archive').click();
      });
      await scenarioStep(
        page,
        'Then the chat starts a new conversation and the panel counts none',
        async () => {
          await expect(page.getByTestId('workflow-avery-notice')).toHaveText(
            'Conversation archived',
          );
          await expect(
            page.getByTestId('conversations-panel-count'),
          ).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        'When I open Archived in the panel',
        async () => {
          await page.getByTestId('conversations-panel-archived').click();
        },
      );
      await scenarioStep(
        page,
        'Then I see my conversation under "Archived conversations"',
        async () => {
          await expect(
            page.getByTestId('conversations-panel-title'),
          ).toHaveText('Archived conversations');
          await expect(page.getByTestId('conversation-item')).toHaveCount(1);
          await expect(page.getByTestId('conversation-item')).toContainText(
            QUESTION,
          );
        },
      );
    },
  );
});
