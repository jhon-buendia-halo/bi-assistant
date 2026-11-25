import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
} from './helpers/llm-stub';
import { composer, gate, runAnswer, runQuestionInTab, sendRun } from './helpers/run-ui';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Chat and visuals" in
 * specs/capabilities/agent-answers/spec.md, now through the Run tab of
 * Answer a Business Question (Avery + Michael): a run streams Avery's relay
 * with Michael's tool activity, renders the answer's
 * Markdown and its SQL, and can be stopped. The model is the recording stub.
 */

const QUESTION = 'Who won the last two tournaments?';
const SLOW_QUESTION = 'Start a slow response';
const ANSWER = '**Argentina** won the 2022 World Cup, while France won in 2018.';
const SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;

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

/** Queries once, then answers the question's Markdown. */
function queryThenAnswer(request: StubRequest): StubReply {
  if (request.messages.at(-1)?.role === 'tool') return { text: ANSWER };
  return {
    toolCall: {
      name:
        request.tools.find((tool) => tool.endsWith('run_readonly_sql')) ??
        'run_readonly_sql',
      arguments: { sql: SQL, rationale: 'Counting matches per stage.' },
    },
  };
}

test('renders a streamed run: reasoning, tool activity, final Markdown, and supports stopping', async ({
  page,
}) => {
  const held = gate();
  const never = gate();
  stub.reply = queryThenAnswer;
  stub.hold = (request) => {
    if (!request.stream) return undefined;
    if (lastUserText(request) === SLOW_QUESTION) return never.promise;
    // Michael's turn, once his query returned (not Avery's call after his reply).
    return !request.avery &&
      lastUserText(request) === QUESTION &&
      request.messages.at(-1)?.role === 'tool'
      ? held.promise
      : undefined;
  };

  try {
    await runQuestionInTab(page, QUESTION, WORLD_CUP_DATASET);
    // Michael's query, in words under him in Avery's relay (ui.md 4.4b).
    await expect(
      page
        .locator(
          '[data-testid="workflow-run-relay-teammate-step"][data-tool="run_readonly_sql"]',
        )
        .first(),
    ).toBeVisible();
    held.release();

    // The answer's Markdown is rendered, not shown as source.
    await expect(runAnswer(page).locator('strong')).toHaveText('Argentina');
    await expect(runAnswer(page)).toContainText('France won in 2018.');
    await expect(runAnswer(page)).not.toContainText('**');
    await expect(page.getByTestId('workflow-run-status')).toHaveText(
      'Run succeeded',
    );

    await page.getByTestId('query-row-0').click();
    await page.getByTestId('query-inspector-tab-sql').click();
    await expect(page.getByTestId('query-sql')).toHaveText(SQL);
    await page.getByTestId('query-inspector-close').click();

    // A slow run can be stopped (New question brings the composer back).
    await page.getByTestId('workflow-run-new').click();
    await composer(page).fill(SLOW_QUESTION);
    await sendRun(page);
    await expect(page.getByTestId('workflow-run-stop')).toBeVisible();
    await page.getByTestId('workflow-run-stop').click();
    await expect(page.getByTestId('workflow-run-stop')).toHaveCount(0);
    await expect(page.getByTestId('workflow-run-live')).toHaveCount(0);
    // While a run is shown the input stays hidden: New question brings it back.
    await expect(page.getByTestId('run-composer')).toHaveCount(0);
    await page.getByTestId('workflow-run-new').click();
    await expect(composer(page)).toBeVisible();
    await expect(page.getByTestId('run-composer-send')).toBeDisabled();
  } finally {
    held.release();
    never.release();
  }
});
