import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { createWorldCupSession } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  StubRequest,
  messageText,
  startLlmStub,
} from './helpers/llm-stub';

/**
 * Mirrors the clarification scenarios of the Feature "Chat answers and
 * reliability signals" in specs/capabilities/sessions-chat/spec.md
 * ("Answering a clarification" and "A malformed clarification is asked
 * again, never shown without options"). The model is the recording stub.
 */

const QUESTION = 'Which team performed best?';
const CLARIFY = 'Which measure of best do you mean?';
const OPTIONS = ['Most titles', 'Highest win rate — share of matches won'];
const FOLLOW_UP = 'Brazil and Argentina lead on titles in this data.';

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

/** Streamed calls of the turn whose latest user message is `text`. */
function isTurn(request: StubRequest, text: string): boolean {
  const users = request.messages.filter((message) => message.role === 'user');
  return request.stream === true && messageText(users.at(-1)!) === text;
}

/** The model's last message in a request was a tool result. */
function afterToolResult(request: StubRequest): boolean {
  return request.messages.at(-1)?.role === 'tool';
}

async function ask(page: Page, question: string): Promise<void> {
  await page.getByPlaceholder('Ask a follow-up question…').fill(question);
  await page.getByRole('button', { name: 'Send message' }).click();
}

test('answering a clarification', async ({ page }) => {
  stub.reply = (request) => {
    if (isTurn(request, QUESTION)) {
      return {
        toolCall: {
          name: 'ask_clarification',
          arguments: { question: CLARIFY, options: OPTIONS },
        },
      };
    }
    return { text: FOLLOW_UP };
  };
  await createWorldCupSession(page);
  await ask(page, QUESTION);

  const card = page.locator('div.card', { hasText: CLARIFY });
  await expect(card).toBeVisible();
  await expect(
    card.getByRole('button', { name: /1\s*Most titles/ }),
  ).toBeVisible();
  const winRate = card.getByRole('button', { name: /2\s*Highest win rate/ });
  await expect(winRate).toContainText('share of matches won');
  await expect(page.getByText('Thinking')).toHaveCount(0);

  await winRate.click();
  await expect(page.getByText(FOLLOW_UP)).toBeVisible();
  const followUp = stub.requests.filter((request) =>
    isTurn(request, 'Highest win rate'),
  );
  expect(
    followUp.length,
    '"Highest win rate" sent as my next message',
  ).toBeGreaterThan(0);
  // The model gets the question with the answer, so it continues (R44).
  expect(
    followUp[0].messages.some(
      (message) =>
        message.role === 'assistant' && messageText(message).includes(CLARIFY),
    ),
  ).toBe(true);
});

test('a malformed clarification is asked again, never shown without options', async ({
  page,
}) => {
  stub.reply = (request) => {
    if (!isTurn(request, QUESTION)) return { text: FOLLOW_UP };
    // First the options arrive malformed, as some models send them; after
    // the validation error the model asks again with a proper list.
    const options = afterToolResult(request)
      ? OPTIONS
      : '\n<parameter name="label">Most titles';
    return {
      toolCall: {
        name: 'ask_clarification',
        arguments: { question: CLARIFY, options },
      },
    };
  };
  await createWorldCupSession(page);
  await ask(page, QUESTION);

  const cards = page.locator('div.card', { hasText: CLARIFY });
  await expect(cards).toHaveCount(1);
  await expect(
    cards.getByRole('button', { name: /1\s*Most titles/ }),
  ).toBeVisible();
  await expect(
    cards.getByRole('button', { name: /2\s*Highest win rate/ }),
  ).toBeVisible();
  // The model saw the validation error before asking again.
  expect(
    stub.requests.filter((request) => isTurn(request, QUESTION)).length,
  ).toBe(2);
});
