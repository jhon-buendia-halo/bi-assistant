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
 * Mirrors the Feature "Page, sort and filter a query's result" in
 * specs/capabilities/agent-answers/spec.md (R76, R79 to R81): the query
 * inspector's Result tab on a stored run of Answer a Business Question.
 */

const V2_ID = 'answer-business-question';
const V2 = 'Answer a Business Question';
const QUESTION = 'List the first matches of the data.';

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

/** A streamed call of the analysis turn whose latest user message is `text`. */
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

test.describe("Feature: Page, sort and filter a query's result", () => {
  test(
    'I page, sort and filter the full result of an answer query',
    { tag: ['@demo', '@story-1.28.3'] },
    async ({ page }) => {
      // The fixture's tables are small (16 matches): every match with every
      // squad member gives a result of over a thousand rows.
      const from = `${worldCupKey('matches')} m CROSS JOIN ${worldCupKey('squad_members')} s`;
      const total = Number(
        await worldCupScalar(`SELECT COUNT(*) FROM ${from}`),
      );
      expect(total).toBeGreaterThan(200);
      const sql = `SELECT m.id AS match_id, m.stage, s.player_id, s.shirt_number FROM ${from}`;
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
      const inspector = page.getByTestId('query-inspector');
      const label = page.getByTestId('query-result-page-label');

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
      await scenarioStep(page, 'When I click Next', async () => {
        await inspector.getByTestId('query-result-next-page').click();
      });
      await scenarioStep(
        page,
        'Then the label reads Rows 51 to 100 of all the rows',
        async () => {
          await expect(label).toHaveText(
            `Rows 51–100 of ${total.toLocaleString('en-US')}`,
          );
        },
      );
      await scenarioStep(page, 'When I sort a column', async () => {
        await inspector.getByTestId('query-result-sort').first().click();
      });
      await scenarioStep(
        page,
        'Then that column is sorted ascending',
        async () => {
          await expect(
            inspector.locator('th[aria-sort="ascending"]'),
          ).toHaveCount(1);
          await expect(label).toContainText('Rows 1–50 of');
        },
      );
      await scenarioStep(
        page,
        'When I add a filter on the stage column',
        async () => {
          await inspector.getByTestId('query-filter-add').click();
          await inspector
            .getByTestId('query-filter-column')
            .selectOption('stage');
          await inspector
            .getByTestId('query-filter-op')
            .selectOption('not_null');
          await inspector.getByTestId('query-filter-apply').click();
        },
      );
      await scenarioStep(
        page,
        'Then a chip shows and the label says matching',
        async () => {
          await expect(
            inspector.getByTestId('query-filter-chip'),
          ).toContainText('stage is not empty');
          await expect(label).toContainText('matching');
        },
      );
    },
  );
});
