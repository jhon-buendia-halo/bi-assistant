import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/app.fixture';
import {
  apiBase,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
import { V2_WORKFLOW_NAME, runQuestionOk } from './helpers/runs-api';
import {
  LlmStub,
  STUB_ANSWER,
  StubRequest,
  messageText,
  startLlmStub,
  systemTexts,
  turnRequests,
} from './helpers/llm-stub';
import { worldCupKey } from './helpers/world-cup-db';
import { scenarioStep } from './support/demo-captions';

/**
 * Mirrors `Feature: LLM calls`, `Feature: LLM call detail` and
 * `Feature: Session flow` in specs/capabilities/monitoring/spec.md (roadmap
 * 1.21.14–1.21.16). The
 * calls are real: a run's agent turn against the recording LLM stub, traced
 * by Mastra into the app's trace store and read back by the Monitoring API.
 * The runs are of Questions to Insights v2 (`qti-v2-turn`), whose Analyse
 * step is one turn of the `assistant-v2` agent; a run's calls are named
 * `Questions to Insights v2: <the question>` (monitoring R45).
 */

const QUESTION = 'Which team scored the most goals?';
/** The name Monitoring gives the v2 run on `question` (R45). */
const runName = (question: string) => `${V2_WORKFLOW_NAME}: ${question}`;
/** The name the `assistant-v2` agent's calls are attributed to. */
const AGENT = 'Questions to Insights v2';
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
/** The World Cup datasource, for scripted tool calls. */
let datasourceId: string;

test.beforeEach(async ({ page }) => {
  // Background: an LLM is configured.
  stub = await startLlmStub();
  datasourceId = await seedWorldCupDataset(page);
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

/** The v2 agent's call of the run on QUESTION. */
const assistantRow = (page: Page): Locator =>
  rows(page)
    .filter({ hasText: AGENT })
    .filter({ hasText: runName(QUESTION) });

/** Runs Questions to Insights v2 on QUESTION and waits for its answer. */
async function askInRun(page: Page): Promise<void> {
  const result = await runQuestionOk(page, QUESTION);
  expect(result.text).toContain(STUB_ANSWER);
}

/**
 * Opens Monitoring until the turn's call is listed: the trace exporter
 * writes the spans shortly after the turn ends, so the table is re-opened
 * (Sessions, then Monitoring) until the row shows.
 */
async function openMonitoringWithCall(page: Page): Promise<void> {
  await expect(async () => {
    await railItem(page, 'Runs').click();
    await railItem(page, 'Monitoring').click();
    await expect(page.getByTestId('monitoring-page')).toBeVisible();
    await expect(assistantRow(page).first()).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
}

test.describe('Feature: LLM calls', () => {
  test(
    'Inspect the context window of a Questions to Insights v2 call',
    { tag: ['@demo', '@story-1.21.15'] },
    async ({ page }) => {
      await scenarioStep(
        page,
        `Given I ran Questions to Insights v2 on "${QUESTION}"`,
        async () => {
          await askInRun(page);
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
          await expect(cells.nth(1)).toHaveText(AGENT);
          await expect(cells.nth(2)).toContainText(MODEL);
          await expect(cells.nth(3)).toHaveText(runName(QUESTION));
          await expect(cells.nth(4)).toHaveText(/^\s*[\d,]+ \/ [\d,]+\s*$/);
          await expect(cells.nth(7)).toHaveText('Succeeded');
        },
      );
      await scenarioStep(
        page,
        `When I filter by the agent "${AGENT}" and the status "Succeeded"`,
        async () => {
          await page
            .getByTestId('llm-filter-agent')
            .selectOption({ label: AGENT });
          await page.getByTestId('llm-filter-status').selectOption('succeeded');
        },
      );
      await scenarioStep(
        page,
        `Then every call listed is a succeeded "${AGENT}" call`,
        async () => {
          await expect(assistantRow(page).first()).toBeVisible();
          // Plan's and Write answer's calls (their own agents since Olivia
          // and Jessica, agents.md 5.11) leave the list once the filter applies.
          await expect(
            rows(page).filter({ hasText: `${AGENT}: ` }),
          ).toHaveCount(0);
          const count = await rows(page).count();
          expect(count).toBeGreaterThan(0);
          for (let i = 0; i < count; i += 1) {
            const cells = rows(page).nth(i).locator('td');
            await expect(cells.nth(1)).toHaveText(AGENT);
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
          await expect(detail.getByRole('heading', { level: 2 })).toHaveText(
            `${AGENT} · ${MODEL}`,
            { useInnerText: true },
          );
          await expect(page.getByTestId('context-bar')).toBeVisible();
          const boxes = detail.locator(
            SEGMENTS.map(
              (key) => `[data-testid="context-segment-${key}"]`,
            ).join(', '),
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
          await page
            .getByTestId('context-segment-toggle-system-prompt')
            .click();
          await page.getByTestId('context-segment-toggle-user-prompt').click();
        },
      );
      await scenarioStep(
        page,
        'Then I see the exact system prompt the model got and my question',
        async () => {
          const toggle = page.getByTestId(
            'context-segment-toggle-system-prompt',
          );
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
      await scenarioStep(
        page,
        'When I click "Monitoring" to go back',
        async () => {
          await page.getByTestId('llm-call-back').click();
        },
      );
      await scenarioStep(
        page,
        'Then I see the table with my filters kept',
        async () => {
          await expect(page.getByTestId('llm-calls-table')).toBeVisible();
          await expect(
            page.getByTestId('llm-filter-agent').locator('option:checked'),
          ).toHaveText(AGENT);
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
      await askInRun(page);
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

      // The facets list the call's model and run.
      await expect(
        page
          .getByTestId('llm-filter-model')
          .locator('option', { hasText: MODEL }),
      ).toHaveCount(1);
      await expect(
        page
          .getByTestId('llm-filter-session')
          .locator('option', { hasText: runName(QUESTION) }),
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

  test(
    'A new install has no LLM calls and no sessions',
    { tag: ['@story-1.21.14', '@story-1.21.16'] },
    async ({ page }) => {
      await railItem(page, 'Monitoring').click();
      await expect(
        page.getByRole('heading', { name: 'Monitoring', exact: true }),
      ).toBeVisible();
      await expect(railItem(page, 'Monitoring')).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(page.getByTestId('llm-calls-empty')).toHaveText(
        'No LLM calls yet.',
      );
      await page.getByTestId('monitoring-tab-sessions').click();
      await expect(page.getByTestId('monitoring-sessions-empty')).toHaveText(
        'No runs yet.',
      );
    },
  );

  test(
    'A call or a session that does not exist',
    { tag: ['@story-1.21.15', '@story-1.21.16'] },
    async ({ page }) => {
      const base = apiBase(page);
      const call = await page.request.get(
        `${base}/monitoring/llm-calls/does-not-exist`,
      );
      expect(call.status()).toBe(404);
      expect(((await call.json()) as { message: string }).message).toBe(
        'LLM call not found',
      );
      const session = await page.request.get(
        `${base}/monitoring/sessions/does-not-exist`,
      );
      expect(session.status()).toBe(404);
      expect(((await session.json()) as { message: string }).message).toBe(
        'Session not found',
      );
    },
  );
});

test.describe('Feature: LLM call detail', () => {
  test(
    'The call facts, an empty box, and the rail back to the table',
    { tag: ['@story-1.21.15'] },
    async ({ page }) => {
      await askInRun(page);
      await openMonitoringWithCall(page);
      await page
        .getByTestId('llm-filter-agent')
        .selectOption({ label: AGENT });
      await assistantRow(page).first().click();

      const detail = page.getByTestId('llm-call-detail');
      await expect(detail).toBeVisible();
      await expect(railItem(page, 'Monitoring')).toHaveAttribute(
        'aria-current',
        'page',
      );
      const facts = page.getByTestId('llm-call-facts');
      for (const fact of [
        'Started',
        'Duration',
        'Status',
        'Provider',
        'Tokens',
      ]) {
        await expect(facts).toContainText(fact);
      }
      await expect(page.getByTestId('llm-call-status')).toHaveText('Succeeded');
      await expect(
        detail.getByRole('heading', { name: 'Context window' }),
      ).toBeVisible();
      await expect(page.getByTestId('context-caption')).toHaveText(/tokens/);
      // A run's one turn: nothing earlier in the chat.
      await expect(
        page.getByTestId('context-segment-chat-history'),
      ).toContainText('Nothing in this call.');
      await expect(
        page.getByTestId('llm-call-steps').locator('tbody tr'),
      ).not.toHaveCount(0);
      await expect(page.getByTestId('llm-call-back')).toHaveText('Monitoring');

      // The rail returns to the table with the filter as it was left.
      await railItem(page, 'Monitoring').click();
      await expect(page.getByTestId('llm-calls-table')).toBeVisible();
      await expect(page.getByTestId('monitoring-tab-calls')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page.getByTestId('llm-filter-agent').locator('option:checked'),
      ).toHaveText(AGENT);
    },
  );
});

// ------------------------------------------------ Session flow (1.21.16)

const FIRST_QUESTION = 'Which team scored the most goals in total?';
const FIRST_ANSWER = 'France scored the most goals, with 14 in 6 matches.';
const SECOND_QUESTION = 'And the second?';
const SECOND_ANSWER = 'Croatia came second, with 9 goals.';

/** The text of the request's last user message. */
function lastUserText(request: StubRequest): string {
  const users = request.messages.filter((m) => m.role === 'user');
  return users.length ? messageText(users[users.length - 1]) : '';
}

/** True when a tool result came after the request's last user message. */
function afterToolResult(request: StubRequest): boolean {
  const lastUser = request.messages.map((m) => m.role).lastIndexOf('user');
  return request.messages.slice(lastUser + 1).some((m) => m.role === 'tool');
}

/**
 * Turn 1 inspects the matches table with describe_entity, then answers;
 * turn 2 answers at once.
 */
function scriptTwoTurns(): void {
  stub.reply = (request) => {
    if (!request.stream) return { text: STUB_ANSWER };
    const question = lastUserText(request);
    if (question === FIRST_QUESTION) {
      if (afterToolResult(request)) return { text: FIRST_ANSWER };
      return {
        toolCall: {
          name:
            request.tools.find((tool) => tool.endsWith('describe_entity')) ??
            'describe_entity',
          arguments: { entity: worldCupKey('matches'), datasourceId },
        },
      };
    }
    if (question === SECOND_QUESTION) return { text: SECOND_ANSWER };
    return { text: STUB_ANSWER };
  };
}

/** Runs Questions to Insights v2 on `question` and checks the answer it streamed. */
async function ask(
  page: Page,
  question: string,
  answer: string,
): Promise<string> {
  const result = await runQuestionOk(page, question);
  expect(result.text).toContain(answer);
  return result.runId!;
}

/** The run's row on the Runs tab (named after its question, R45). */
const sessionRow = (page: Page, question = FIRST_QUESTION): Locator =>
  page
    .getByTestId('monitoring-sessions-table')
    .locator('[data-testid^="monitoring-session-row-"]')
    .filter({ hasText: runName(question) });

/**
 * Opens Monitoring → Runs until both runs show one turn each: the trace
 * exporter writes the spans shortly after each turn ends.
 */
async function openRunsWithTwoRuns(page: Page): Promise<void> {
  await expect(async () => {
    await railItem(page, 'Runs').click();
    await railItem(page, 'Monitoring').click();
    await page.getByTestId('monitoring-tab-sessions').click();
    for (const question of [FIRST_QUESTION, SECOND_QUESTION]) {
      await expect(
        sessionRow(page, question).first().locator('td').nth(2),
      ).toHaveText('1', { timeout: 2_000 });
    }
  }).toPass({ timeout: 45_000 });
}

test.describe('Feature: Session flow', () => {
  test(
    "Read a session's execution flow and a turn's timeline",
    { tag: ['@demo', '@story-1.21.16'] },
    async ({ page }) => {
      scriptTwoTurns();
      await scenarioStep(
        page,
        'Given I ran Questions to Insights v2 on two questions',
        async () => {
          await ask(page, FIRST_QUESTION, FIRST_ANSWER);
          await ask(page, SECOND_QUESTION, SECOND_ANSWER);
        },
      );
      await scenarioStep(
        page,
        'When I open Monitoring and choose the Runs tab',
        async () => {
          await openRunsWithTwoRuns(page);
        },
      );
      await scenarioStep(
        page,
        'Then I see each run with its turn, its agent and status',
        async () => {
          await expect(
            page.getByTestId('monitoring-tab-sessions'),
          ).toHaveAttribute('aria-selected', 'true');
          await expect(page.getByTestId('monitoring-note')).toHaveText(
            'Runs with recorded agent calls, most recent first.',
          );
          const cells = sessionRow(page).first().locator('td');
          await expect(cells.nth(0)).toHaveText(runName(FIRST_QUESTION));
          await expect(cells.nth(1)).toContainText(AGENT);
          await expect(cells.nth(2)).toHaveText('1');
          await expect(sessionRow(page, SECOND_QUESTION)).toHaveCount(1);
          await expect(cells.nth(9)).toHaveText('Succeeded');
        },
      );
      await scenarioStep(page, 'When I open the first run', async () => {
        await sessionRow(page).first().click();
      });
      await scenarioStep(
        page,
        'Then I read the question, its answer and the steps the agent took',
        async () => {
          const detail = page.getByTestId('monitoring-session-detail');
          await expect(detail).toBeVisible();
          await expect(detail.getByRole('heading', { level: 2 })).toHaveText(
            runName(FIRST_QUESTION),
          );
          await expect(page.getByTestId('session-totals')).toContainText(
            'Turns',
          );
          await expect(page.getByTestId('turn-question-1')).toHaveText(
            FIRST_QUESTION,
          );
          await expect(page.getByTestId('turn-answer-1')).toHaveText(
            FIRST_ANSWER,
          );
          await expect(page.getByTestId('turn-question-2')).toHaveCount(0);
          // Turn 1: a model request, the describe_entity call, the answer.
          const steps1 = page.getByTestId('turn-steps-1');
          await expect(
            steps1.locator('[data-testid^="turn-step-model-"]'),
          ).toHaveCount(2);
          await expect(steps1.getByTestId('turn-step-tool')).toContainText(
            'describe_entity',
          );
        },
      );
      await scenarioStep(page, "When I open turn 1's timeline", async () => {
        await page.getByTestId('turn-timeline-toggle-1').click();
      });
      const waterfall = page.getByTestId('trace-waterfall');
      const spanRows = waterfall.locator('[data-testid^="trace-span-row-"]');
      await scenarioStep(
        page,
        'Then I see the agent run, the model call and its requests on a time axis',
        async () => {
          await expect(
            page.getByTestId('turn-timeline-toggle-1'),
          ).toHaveAttribute('aria-expanded', 'true');
          await expect(spanRows.filter({ hasText: 'agent run' })).toHaveCount(
            1,
          );
          await expect(spanRows.filter({ hasText: 'model call' })).toHaveCount(
            1,
          );
          await expect(spanRows.filter({ hasText: /request \d/ })).toHaveCount(
            2,
          );
          await expect(
            spanRows.filter({ hasText: 'describe_entity' }).first(),
          ).toBeVisible();
          await expect(waterfall.getByTestId('trace-axis')).toBeVisible();
        },
      );
      await scenarioStep(page, 'When I select request 2', async () => {
        await spanRows.filter({ hasText: 'request 2' }).click();
      });
      await scenarioStep(
        page,
        'Then the panel shows its details and an Open call link',
        async () => {
          await expect(
            spanRows.filter({ hasText: 'request 2' }),
          ).toHaveAttribute('aria-pressed', 'true');
          const panel = waterfall.getByTestId('trace-span-panel');
          await expect(panel.getByTestId('trace-span-panel-label')).toHaveText(
            'request 2',
          );
          await expect(panel).toContainText('Request');
          await expect(panel.getByTestId('trace-span-open-call')).toBeVisible();
        },
      );
      let shownBefore = 0;
      await scenarioStep(page, 'When I switch on framework spans', async () => {
        await expect(
          waterfall.getByTestId('trace-framework-hidden'),
        ).toHaveText(/^\(\d+ hidden\)$/);
        shownBefore = await spanRows.count();
        await waterfall.getByTestId('trace-framework-toggle').click();
      });
      await scenarioStep(
        page,
        'Then more spans are listed and none is hidden',
        async () => {
          await expect(
            waterfall.getByTestId('trace-framework-toggle'),
          ).toHaveAttribute('aria-checked', 'true');
          await expect
            .poll(() => spanRows.count())
            .toBeGreaterThan(shownBefore);
          await expect(
            waterfall.getByTestId('trace-framework-hidden'),
          ).toHaveCount(0);
        },
      );
      await scenarioStep(
        page,
        "When I click Open call on turn 1's first model step",
        async () => {
          await page
            .getByTestId('turn-steps-1')
            .locator('[data-testid^="step-open-call-"]')
            .first()
            .click();
        },
      );
      await scenarioStep(
        page,
        'Then I see the call, with a back control reading "Session"',
        async () => {
          await expect(page.getByTestId('llm-call-detail')).toBeVisible();
          await expect(page.getByTestId('context-bar')).toBeVisible();
          await expect(page.getByTestId('llm-call-back')).toHaveText('Session');
        },
      );
      await scenarioStep(page, 'When I click "Session"', async () => {
        await page.getByTestId('llm-call-back').click();
      });
      await scenarioStep(page, 'Then I am back on the session', async () => {
        await expect(
          page.getByTestId('monitoring-session-detail'),
        ).toBeVisible();
        await expect(page.getByTestId('turn-question-1')).toHaveText(
          FIRST_QUESTION,
        );
      });
      await scenarioStep(page, 'When I click "Monitoring"', async () => {
        await page.getByTestId('monitoring-session-back').click();
      });
      await scenarioStep(
        page,
        'Then I see the Runs tab with the run listed',
        async () => {
          await expect(
            page.getByTestId('monitoring-tab-sessions'),
          ).toHaveAttribute('aria-selected', 'true');
          await expect(sessionRow(page).first()).toBeVisible();
        },
      );
    },
  );

  test(
    'Filters, a clamped answer, tool details and the back controls',
    { tag: ['@story-1.21.16'] },
    async ({ page }) => {
      const longAnswer = Array.from(
        { length: 10 },
        (_, i) => `Answer line ${i + 1}.`,
      ).join('\n\n');
      scriptTwoTurns();
      const twoTurns = stub.reply;
      stub.reply = (request) =>
        request.stream &&
        lastUserText(request) === FIRST_QUESTION &&
        afterToolResult(request)
          ? { text: longAnswer }
          : twoTurns(request);

      await ask(page, FIRST_QUESTION, 'Answer line 10.');
      await ask(page, SECOND_QUESTION, SECOND_ANSWER);
      await openRunsWithTwoRuns(page);

      // Filters narrow the sessions; no session matches an old date range.
      await page
        .getByTestId('session-filter-agent')
        .selectOption({ label: AGENT });
      await expect(sessionRow(page).first()).toBeVisible();
      await expect(page.getByTestId('session-filters-clear')).toBeEnabled();
      await page.getByTestId('session-filter-range').selectOption('custom');
      await page.getByTestId('session-filter-from').fill('2020-01-01T00:00');
      await page.getByTestId('session-filter-to').fill('2020-01-02T00:00');
      await expect(page.getByTestId('monitoring-sessions-empty')).toHaveText(
        'No runs match these filters.',
      );
      await page.getByTestId('session-filters-clear').click();
      await expect(sessionRow(page).first()).toBeVisible();
      await expect(page.getByTestId('session-filters-clear')).toBeDisabled();

      // Open a session of the chosen agent.
      await page
        .getByTestId('session-filter-agent')
        .selectOption({ label: AGENT });
      await sessionRow(page).first().click();
      await expect(page.getByTestId('monitoring-session-detail')).toBeVisible();
      await expect(railItem(page, 'Monitoring')).toHaveAttribute(
        'aria-current',
        'page',
      );
      const totals = page.getByTestId('session-totals');
      for (const fact of [
        'Turns',
        'Wall time',
        'Model time',
        'Tool calls',
        'Tokens',
        'Cost',
        'Errors',
      ]) {
        await expect(totals).toContainText(fact);
      }
      const tool = page
        .getByTestId('turn-steps-1')
        .getByTestId('turn-step-tool');
      await expect(tool).toContainText('describe_entity');
      await expect(tool).toContainText('matches');
      await expect(
        page
          .getByTestId('turn-steps-1')
          .locator('[data-testid^="step-open-call-"]')
          .first(),
      ).toHaveText(/Open call/);

      // The long answer shows six lines until "Show more".
      const answer = page.getByTestId('turn-answer-1');
      await expect(answer).toHaveClass(/line-clamp-6/);
      const more = page.getByTestId('turn-answer-more-1');
      await expect(more).toHaveText('Show more');
      await more.click();
      await expect(answer).not.toHaveClass(/line-clamp-6/);
      await expect(more).toHaveText('Show less');

      // A tool row's details show its input and output; Hide timeline closes it.
      const toggle = page.getByTestId('turn-timeline-toggle-1');
      await toggle.click();
      const waterfall = page.getByTestId('trace-waterfall');
      await expect(waterfall.getByTestId('trace-legend')).toBeVisible();
      await waterfall
        .locator('[data-testid^="trace-span-row-"]')
        .filter({ hasText: 'describe_entity' })
        .first()
        .click();
      const panel = waterfall.getByTestId('trace-span-panel');
      await expect(panel.getByTestId('trace-span-input')).toBeVisible();
      await expect(panel.getByTestId('trace-span-output')).toBeVisible();
      await expect(toggle).toHaveText(/Hide timeline/);
      await toggle.click();
      await expect(page.getByTestId('trace-waterfall')).toHaveCount(0);
      await expect(toggle).toHaveText(/Open timeline/);

      // Back keeps the Sessions tab and the agent filter …
      await page.getByTestId('monitoring-session-back').click();
      await expect(page.getByTestId('monitoring-tab-sessions')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page.getByTestId('session-filter-agent').locator('option:checked'),
      ).toHaveText(AGENT);
      // … and so does the rail.
      await sessionRow(page).first().click();
      await expect(page.getByTestId('monitoring-session-detail')).toBeVisible();
      await railItem(page, 'Monitoring').click();
      await expect(page.getByTestId('monitoring-tab-sessions')).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page.getByTestId('session-filter-agent').locator('option:checked'),
      ).toHaveText(AGENT);
    },
  );
});

const RUN_QUESTION = 'Which team scored the most goals in a run?';

test.describe('Feature: Runs in Monitoring', () => {
  test(
    "A workflow run's call is attributed to the run",
    { tag: ['@demo', '@story-1.23.20'] },
    async ({ page }) => {
      const runName = `${V2_WORKFLOW_NAME}: ${RUN_QUESTION}`;
      await scenarioStep(
        page,
        `Given I ran the "${V2_WORKFLOW_NAME}" workflow on a question`,
        async () => {
          await runQuestionOk(page, RUN_QUESTION);
        },
      );
      await scenarioStep(page, 'When I open Monitoring', async () => {
        await expect(async () => {
          await railItem(page, 'Runs').click();
          await railItem(page, 'Monitoring').click();
          await expect(page.getByTestId('monitoring-page')).toBeVisible();
          await expect(
            rows(page).filter({ hasText: runName }).first(),
          ).toBeVisible({ timeout: 2_000 });
        }).toPass({ timeout: 45_000 });
      });
      await scenarioStep(
        page,
        `Then the call is listed under the run "${V2_WORKFLOW_NAME}: <title>"`,
        async () => {
          await expect(
            rows(page).filter({ hasText: runName }).first(),
          ).toContainText(AGENT);
          await expect(
            page
              .getByTestId('llm-filter-session')
              .locator('option', { hasText: runName }),
          ).toHaveCount(1);
        },
      );
      await scenarioStep(
        page,
        'When I open the call and follow its run link',
        async () => {
          await rows(page).filter({ hasText: runName }).first().click();
          await page.getByTestId('llm-call-session-link').click();
        },
      );
      await scenarioStep(
        page,
        'Then I see the run with one turn, its path and its waterfall',
        async () => {
          const detail = page.getByTestId('monitoring-session-detail');
          await expect(detail.getByRole('heading', { level: 2 })).toHaveText(
            runName,
          );
          await expect(page.getByTestId('session-run-chip')).toBeVisible();
          await expect(page.getByTestId('session-open-chat')).toHaveCount(0);
          await expect(page.getByTestId('turn-question-1')).toHaveText(
            RUN_QUESTION,
          );
          await expect(page.getByTestId('turn-question-2')).toHaveCount(0);
          await page.getByTestId('turn-timeline-toggle-1').click();
          await expect(page.getByTestId('trace-waterfall')).toBeVisible();
        },
      );
    },
  );
});
