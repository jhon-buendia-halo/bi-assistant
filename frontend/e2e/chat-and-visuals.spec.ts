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
import { gate, runAnswer, runQuestionInTab } from './helpers/run-ui';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Chat and visuals" in
 * specs/capabilities/agent-answers/spec.md, now through the Run tab of
 * Questions to Insights v2: a run streams its reasoning and tool activity, renders the answer's
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
    return lastUserText(request) === QUESTION &&
      request.messages.at(-1)?.role === 'tool'
      ? held.promise
      : undefined;
  };

  try {
    await runQuestionInTab(page, QUESTION, WORLD_CUP_DATASET);
    await expect(page.getByTestId('workflow-run-live')).toContainText(
      'Thinking',
    );
    await expect(page.getByTestId('workflow-run-tool')).toContainText(
      'run_readonly_sql',
    );
    held.release();

    // The answer's Markdown is rendered, not shown as source.
    await expect(runAnswer(page).locator('strong')).toHaveText('Argentina');
    await expect(runAnswer(page)).toContainText('France won in 2018.');
    await expect(runAnswer(page)).not.toContainText('**');
    await expect(page.getByTestId('workflow-run-status')).toHaveText(
      'Run succeeded',
    );

    await runAnswer(page)
      .getByText(/Data used \(1 query\)/)
      .click();
    await expect(
      runAnswer(page).locator('pre', { hasText: SQL }),
    ).toBeVisible();

    // A slow run can be stopped.
    await page.getByTestId('workflow-input-question').fill(SLOW_QUESTION);
    await page.getByTestId('workflow-run').click();
    await expect(page.getByTestId('workflow-run-stop')).toBeVisible();
    await page.getByTestId('workflow-run-stop').click();
    await expect(page.getByTestId('workflow-run')).toHaveText('Execute');
    await expect(page.getByTestId('workflow-run-stop')).toHaveCount(0);
    await expect(page.getByTestId('workflow-run-live')).toHaveCount(0);
  } finally {
    held.release();
    never.release();
  }
});
