import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  WORLD_CUP_SESSION,
  createWorldCupSession,
} from './helpers/app-actions';
import {
  LlmStub,
  STUB_ANSWER,
  startLlmStub,
  systemTexts,
  turnRequests,
} from './helpers/llm-stub';
import { scenarioStep } from './support/demo-captions';

/**
 * Mirrors `Feature: LLM calls` and `Feature: LLM call detail` in
 * specs/capabilities/monitoring/spec.md (roadmap 1.21.14, 1.21.15). The
 * calls are real: a chat turn against the recording LLM stub, traced by
 * Mastra into the app's trace store and read back by the Monitoring API.
 */

const QUESTION = 'Which team scored the most goals?';
const ASSISTANT = 'Questions to Insights Assistant';
/** saveLenaiSettings' deployment name, the model the calls are made with. */
const MODEL = 'stub-deployment';

const SEGMENTS = [
  'system-prompt',
  'skills',
  'tools',
  'chat-history',
  'dataset',
  'user-prompt',
  'tool-results',
];

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  // Background: an LLM is configured and a session has asked one question.
  stub = await startLlmStub();
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

const railItem = (page: Page, name: string) =>
  page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });

const rows = (page: Page) =>
  page.getByTestId('llm-calls-table').locator('[data-testid^="llm-call-row-"]');

/** The assistant's call of the World Cup session. */
const assistantRow = (page: Page): Locator =>
  rows(page)
    .filter({ hasText: ASSISTANT })
    .filter({ hasText: WORLD_CUP_SESSION });

async function askInSession(page: Page): Promise<void> {
  await createWorldCupSession(page);
  await page.getByPlaceholder('Ask a follow-up question…').fill(QUESTION);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(STUB_ANSWER)).toBeVisible();
}

/**
 * Opens Monitoring until the turn's call is listed: the trace exporter
 * writes the spans shortly after the turn ends, so the table is re-opened
 * (Sessions, then Monitoring) until the row shows.
 */
async function openMonitoringWithCall(page: Page): Promise<void> {
  await expect(async () => {
    await railItem(page, 'Sessions').click();
    await railItem(page, 'Monitoring').click();
    await expect(page.getByTestId('monitoring-page')).toBeVisible();
    await expect(assistantRow(page).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
}

test.describe('Feature: LLM calls', () => {
  test(
    'Inspect the context window of an assistant call',
    { tag: ['@demo', '@story-1.21.15'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        `Given I asked "${QUESTION}" in the session "${WORLD_CUP_SESSION}"`,
        async () => {
          await askInSession(page);
        },
      );
      await scenarioStep(
        page,
        'When I open Monitoring on the rail',
        async () => {
          await openMonitoringWithCall(page);
        },
      );
      await scenarioStep(
        page,
        'Then I see the call with its agent, model, session, tokens and status',
        async () => {
          await expect(
            page.getByRole('heading', { name: 'Monitoring', exact: true }),
          ).toBeVisible();
          const row = assistantRow(page).first();
          const cells = row.locator('td');
          await expect(cells.nth(1)).toHaveText(ASSISTANT);
          await expect(cells.nth(2)).toContainText(MODEL);
          await expect(cells.nth(3)).toHaveText(WORLD_CUP_SESSION);
          await expect(cells.nth(4)).toHaveText(/^\s*[\d,]+ \/ [\d,]+\s*$/);
          await expect(cells.nth(7)).toHaveText('Succeeded');
        },
      );
      await scenarioStep(
        page,
        `When I filter by the agent "${ASSISTANT}" and the status "Succeeded"`,
        async () => {
          await page
            .getByTestId('llm-filter-agent')
            .selectOption({ label: ASSISTANT });
          await page.getByTestId('llm-filter-status').selectOption('succeeded');
        },
      );
      await scenarioStep(
        page,
        'Then every call listed is a succeeded assistant call',
        async () => {
          await expect(assistantRow(page).first()).toBeVisible();
          const count = await rows(page).count();
          expect(count).toBeGreaterThan(0);
          for (let i = 0; i < count; i += 1) {
            const cells = rows(page).nth(i).locator('td');
            await expect(cells.nth(1)).toHaveText(ASSISTANT);
            await expect(cells.nth(7)).toHaveText('Succeeded');
          }
        },
      );
      await scenarioStep(page, 'When I open the call', async () => {
        await assistantRow(page).first().click();
      });
      await scenarioStep(
        page,
        'Then I see its seven context-window boxes, from "System prompt" to "Tool calls and results"',
        async () => {
          const detail = page.getByTestId('llm-call-detail');
          await expect(detail).toBeVisible();
          await expect(
            detail.getByRole('heading', { level: 2 }),
          ).toHaveText(`${ASSISTANT} · ${MODEL}`, { useInnerText: true });
          await expect(page.getByTestId('context-bar')).toBeVisible();
          const boxes = detail.locator(
            SEGMENTS.map((key) => `[data-testid="context-segment-${key}"]`).join(
              ', ',
            ),
          );
          await expect(boxes).toHaveCount(7);
          for (const [index, key] of SEGMENTS.entries()) {
            await expect(boxes.nth(index)).toHaveAttribute(
              'data-testid',
              `context-segment-${key}`,
            );
          }
          await expect(
            page.getByTestId('context-segment-owner-system-prompt'),
          ).toHaveText('US Health');
          await expect(
            page.getByTestId('context-segment-owner-user-prompt'),
          ).toHaveText('Custom');
        },
      );
      await scenarioStep(
        page,
        'When I click "Show text" on the "System prompt" and "User prompt" boxes',
        async () => {
          await page.getByTestId('context-segment-toggle-system-prompt').click();
          await page.getByTestId('context-segment-toggle-user-prompt').click();
        },
      );
      await scenarioStep(
        page,
        'Then I see the exact system prompt the model got and my question',
        async () => {
          const toggle = page.getByTestId('context-segment-toggle-system-prompt');
          await expect(toggle).toHaveText('Hide text');
          await expect(toggle).toHaveAttribute('aria-expanded', 'true');
          // The first line of the system message the stub received.
          const sent = systemTexts(turnRequests(stub, QUESTION)[0])[0];
          const firstLine = sent
            .split('\n')
            .map((line) => line.trim())
            .find((line) => line.length > 0)!;
          await expect(
            page.getByTestId('context-segment-text-system-prompt'),
          ).toContainText(firstLine.slice(0, 80));
          await expect(
            page.getByTestId('context-segment-text-user-prompt'),
          ).toContainText(QUESTION);
        },
      );
      await scenarioStep(page, 'When I click "Monitoring" to go back', async () => {
        await page.getByTestId('llm-call-back').click();
      });
      await scenarioStep(
        page,
        'Then I see the table with my filters kept',
        async () => {
          await expect(page.getByTestId('llm-calls-table')).toBeVisible();
          await expect(
            page.getByTestId('llm-filter-agent').locator('option:checked'),
          ).toHaveText(ASSISTANT);
          await expect(page.getByTestId('llm-filter-status')).toHaveValue(
            'succeeded',
          );
          await expect(page.getByTestId('llm-filters-clear')).toBeEnabled();
        },
      );
    },
  );

  test(
    'Page size, an empty filter result and Clear filters',
    { tag: ['@story-1.21.14'] },
    async ({ page }) => {
      await askInSession(page);
      await openMonitoringWithCall(page);

      // Every call fits on the first page: the summary covers them all and
      // neither Previous nor Next leads anywhere.
      const total = await rows(page).count();
      await expect(page.getByTestId('llm-page-summary')).toHaveText(
        `1–${total} of ${total}`,
      );
      await expect(page.getByTestId('llm-page-prev')).toBeDisabled();
      await expect(page.getByTestId('llm-page-next')).toBeDisabled();
      await expect(page.getByTestId('llm-filters-clear')).toBeDisabled();

      await page.getByTestId('llm-page-size').selectOption('50');
      await expect(page.getByTestId('llm-page-size')).toHaveValue('50');
      await expect(page.getByTestId('llm-page-summary')).toHaveText(
        `1–${total} of ${total}`,
      );

      // The facets list the call's model and session.
      await expect(
        page.getByTestId('llm-filter-model').locator('option', { hasText: MODEL }),
      ).toHaveCount(1);
      await expect(
        page
          .getByTestId('llm-filter-session')
          .locator('option', { hasText: WORLD_CUP_SESSION }),
      ).toHaveCount(1);

      // No call failed.
      await page.getByTestId('llm-filter-status').selectOption('failed');
      await expect(page.getByTestId('llm-calls-empty')).toHaveText(
        'No LLM calls match these filters.',
      );
      await expect(page.getByTestId('llm-filters-clear')).toBeEnabled();

      await page.getByTestId('llm-filters-clear').click();
      await expect(rows(page)).toHaveCount(total);
      await expect(page.getByTestId('llm-filter-status')).toHaveValue('');
      await expect(page.getByTestId('llm-filters-clear')).toBeDisabled();
      // The page size is not a filter: it stays.
      await expect(page.getByTestId('llm-page-size')).toHaveValue('50');
    },
  );
});
