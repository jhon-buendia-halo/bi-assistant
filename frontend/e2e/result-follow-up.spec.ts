import { pickDataset } from './helpers/run-ui';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  StubRequest,
  messageText,
  startLlmStub,
} from './helpers/llm-stub';
import { isResultExplorerCall } from './helpers/v2-steps';
import { worldCupKey, worldCupScalar } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "A follow-up over an earlier result" in
 * specs/capabilities/workflows/spec.md (R36, roadmap 1.28.8): a follow-up
 * run of Answer a Business Question that asks for the next page answers
 * with that page of the earlier answer's query, without planning. The
 * `result-explorer` reply (Interpret follow-up) comes from the LLM stub's
 * `explore`.
 */

const V2_ID = 'answer-business-question';
const V2 = 'Answer a Business Question';
const QUESTION = 'List every match with its squad members.';
const FOLLOW_UP = 'next page';

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  stub = await startLlmStub();
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

function lastUserText(request: StubRequest): string {
  const users = request.messages.filter((message) => message.role === 'user');
  return users.length === 0 ? '' : messageText(users[users.length - 1]);
}

function isTurn(request: StubRequest, text: string): boolean {
  return (
    request.stream &&
    request.step === undefined &&
    lastUserText(request) === text
  );
}

function afterToolResult(request: StubRequest): boolean {
  return request.messages.at(-1)?.role === 'tool';
}

function toolName(request: StubRequest, name: string): string {
  return (
    request.tools.find((tool) => tool === name || tool.endsWith(name)) ?? name
  );
}

function isExplorerCall(request: StubRequest): boolean {
  return isResultExplorerCall(
    request.messages.filter((m) => m.role === 'system').map(messageText),
  );
}

function railItem(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

async function openWorkflowPage(
  page: Page,
  id: string,
  name: string,
): Promise<void> {
  await railItem(page, 'Workflows').click();
  await expect(
    page.getByRole('heading', { name: 'Workflows', exact: true }),
  ).toBeVisible();
  await page.getByTestId(`workflow-${id}`).click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(name);
}

async function fillRun(
  page: Page,
  question: string,
  dataset: string,
): Promise<void> {
  await page.getByTestId('workflow-execute').click();
  await expect(page.getByTestId('workflow-run')).toBeVisible();
  // The searchable dataset picker of the run form (ui.md 4.4b).
  await pickDataset(page, dataset);
  await page.getByTestId('workflow-input-question').fill(question);
}

test.describe('Feature: A follow-up over an earlier result', () => {
  test(
    'A follow-up asking for the next page answers with that page of the earlier result',
    { tag: ['@demo', '@story-1.28.8'] },
    async ({ page }) => {
      // The fixture's tables are small (16 matches): every match with every
      // squad member gives a result of over a thousand rows.
      const from = `${worldCupKey('matches')} m CROSS JOIN ${worldCupKey('squad_members')} s`;
      const total = Number(
        await worldCupScalar(`SELECT COUNT(*) FROM ${from}`),
      );
      expect(total).toBeGreaterThan(100);
      const rows = `Rows 51–100 of ${total.toLocaleString('en-US')}`;
      const sql = `SELECT m.id AS match_id, m.stage, s.player_id, s.shirt_number FROM ${from}`;
      stub.reply = (request) => {
        if (!isTurn(request, QUESTION))
          return { text: 'The stub model answered this question.' };
        return afterToolResult(request)
          ? { text: 'These are the matches with their squad members.' }
          : {
              toolCall: {
                name: toolName(request, 'run_readonly_sql'),
                arguments: {
                  sql,
                  rationale: 'Listing each match with its squad members.',
                },
              },
            };
      };
      // Nathan reads "next page" as the earlier result's next page.
      stub.explore = () => ({
        action: 'explore',
        query: null,
        filters: [],
        sort: [],
        page: { move: 'next', to: null },
        understood: 'Page 2',
      });
      const answer = page.getByTestId('run-answer');
      const inspector = page.getByTestId('query-inspector');
      let before = 0;

      await scenarioStep(
        page,
        `Given I ran "${QUESTION}" on "${WORLD_CUP_DATASET}"`,
        async () => {
          await openWorkflowPage(page, V2_ID, V2);
          await fillRun(page, QUESTION, WORLD_CUP_DATASET);
          await page.getByTestId('workflow-run').click();
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          // A first run has no earlier result: Nathan is not asked.
          expect(stub.requests.filter(isExplorerCall)).toHaveLength(0);
          before = stub.requests.length;
        },
      );
      await scenarioStep(
        page,
        `When I follow up with "${FOLLOW_UP}"`,
        async () => {
          await page.getByTestId('workflow-follow-up-input').fill(FOLLOW_UP);
          await page.getByTestId('workflow-run-follow-up').click();
          await expect(page.getByTestId('workflow-run-question')).toHaveText(
            FOLLOW_UP,
          );
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
        },
      );
      await scenarioStep(
        page,
        'Then the answer shows rows 51–100 of the earlier result',
        async () => {
          await expect(answer).toContainText(rows);
          await expect(answer).toContainText('Understood as: Page 2');
          await expect(answer.getByRole('table')).toBeVisible();
        },
      );
      await scenarioStep(
        page,
        'And no new analysis was planned or run',
        async () => {
          const sent = stub.requests.slice(before);
          expect(sent.filter(isExplorerCall)).toHaveLength(1);
          expect(
            sent.filter((request) => request.step === 'plan'),
          ).toHaveLength(0);
          expect(
            sent.filter((request) => isTurn(request, FOLLOW_UP)),
          ).toHaveLength(0);
        },
      );
      await scenarioStep(page, "When I open the answer's query", async () => {
        await answer.getByTestId('query-row-0').click();
        await expect(inspector).toBeVisible();
        await inspector.getByTestId('query-inspector-tab-result').click();
      });
      await scenarioStep(
        page,
        'Then the inspector opens on page 2 of the full result',
        async () => {
          await expect(
            inspector.getByTestId('query-result-page-label'),
          ).toHaveText(rows);
        },
      );
    },
  );
});
