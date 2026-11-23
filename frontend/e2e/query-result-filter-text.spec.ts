import { fillRun as fillRunInTab, openRunTab, sendRun } from './helpers/run-ui';
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
import { worldCupKey, worldCupScalar } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Filter a query's result in words" in
 * specs/capabilities/agent-answers/spec.md (R82): the query inspector's
 * Result tab on a stored run of Answer a Business Question. The
 * `result-explorer` reply comes from the LLM stub's `explore`.
 */

const V2_ID = 'answer-business-question';
const V2 = 'Answer a Business Question';
const QUESTION = 'List the first matches of the data.';
const WORDS = 'only the Final stage';

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

/** Opens the Run tab, adds `dataset` through +, turns approvals off and types `question`. */
async function fillRun(
  page: Page,
  question: string,
  dataset: string,
): Promise<void> {
  await openRunTab(page);
  await fillRunInTab(page, question, dataset);
}

test.describe("Feature: Filter a query's result in words", () => {
  test(
    'I filter the result of an answer query by typing what I want',
    { tag: ['@demo', '@story-1.28.5'] },
    async ({ page }) => {
      const finals = Number(
        await worldCupScalar(
          `SELECT COUNT(*) FROM ${worldCupKey('matches')} WHERE stage = 'final'`,
        ),
      );
      expect(finals).toBeGreaterThan(0);
      const sql = `SELECT * FROM ${worldCupKey('matches')} LIMIT 100`;
      stub.reply = (request) => {
        if (!isTurn(request, QUESTION))
          return { text: 'The stub model answered this question.' };
        return afterToolResult(request)
          ? { text: 'These are the first matches of the data.' }
          : {
              toolCall: {
                name: toolName(request, 'run_readonly_sql'),
                arguments: { sql, rationale: 'Listing matches.' },
              },
            };
      };
      stub.explore = () => ({
        action: 'explore',
        query: null,
        filters: [
          {
            column: 'stage',
            op: 'eq',
            value: 'final',
            valueTo: null,
            values: null,
          },
        ],
        sort: [],
        page: { move: 'first', to: null },
        understood: 'Stage is final',
      });
      const inspector = page.getByTestId('query-inspector');

      await scenarioStep(
        page,
        `Given I ran "${QUESTION}" on "${WORLD_CUP_DATASET}" and opened its query`,
        async () => {
          await openWorkflowPage(page, V2_ID, V2);
          await fillRun(page, QUESTION, WORLD_CUP_DATASET);
          await sendRun(page);
          await expect(page.getByTestId('workflow-run-status')).toHaveText(
            'Run succeeded',
          );
          await page
            .getByTestId('run-answer')
            .getByTestId('query-row-0')
            .click();
          await expect(inspector).toBeVisible();
          await inspector.getByTestId('query-inspector-tab-result').click();
          await expect(
            inspector.getByTestId('query-result-table'),
          ).toBeVisible();
        },
      );
      await scenarioStep(
        page,
        `When I type "${WORDS}" in Filter in words and apply it`,
        async () => {
          await inspector.getByTestId('query-filter-text').fill(WORDS);
          await inspector.getByTestId('query-filter-text-apply').click();
        },
      );
      await scenarioStep(page, 'Then it shows what it understood', async () => {
        await expect(
          inspector.getByTestId('query-filter-understood'),
        ).toHaveText('Understood as: Stage is final');
      });
      await scenarioStep(
        page,
        'And only the matching rows are listed',
        async () => {
          await expect(
            inspector.getByTestId('query-filter-chip'),
          ).toContainText('stage is final');
          await expect(
            inspector.getByTestId('query-result-page-label'),
          ).toContainText(`of ${finals.toLocaleString('en-US')} matching`);
        },
      );
    },
  );
});
