import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { createWorldCupSession } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import { apiJson } from './helpers/api';
import {
  LlmStub,
  StubRequest,
  messageText,
  startLlmStub,
} from './helpers/llm-stub';

/**
 * Mirrors the rating scenarios of the Feature "Chat answers and reliability
 * signals" in specs/capabilities/sessions-chat/spec.md ("Saving an answer
 * as a verified query", "Adding, editing and clearing the note of a
 * thumbs-down" and "A thumbs-up removes the note of a thumbs-down"; R36).
 * The model is the recording stub: it runs one SQL query on the World Cup
 * database, so the answer carries data and offers the thumbs. The memory
 * lever is off (its default), so no rating reaches the memory.
 */

const QUESTION = 'Who won the most penalty shoot-outs?';
const ANSWER = 'Argentina won the most penalty shoot-outs in this data.';
const SQL =
  'SELECT stage, COUNT(*) AS matches FROM world_cup.world_cup.matches GROUP BY stage';

let stub: LlmStub;
let sessionId: string;

/** The turn is told from the request's last user message. */
function isQuestionTurn(request: StubRequest): boolean {
  const users = request.messages.filter((message) => message.role === 'user');
  return users.length > 0 && messageText(users.at(-1)!) === QUESTION;
}

test.beforeEach(async ({ page }) => {
  // Background
  stub = await startLlmStub();
  stub.reply = (request) => {
    if (
      request.stream &&
      isQuestionTurn(request) &&
      request.messages.at(-1)?.role !== 'tool'
    ) {
      return {
        toolCall: {
          name: 'run_readonly_sql',
          arguments: { sql: SQL, rationale: 'Count the matches per stage.' },
        },
      };
    }
    return { text: ANSWER };
  };
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
  sessionId = await createWorldCupSession(page);
  // Given an answer that ran SQL is shown
  await page.getByPlaceholder('Ask a follow-up question…').fill(QUESTION);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(ANSWER)).toBeVisible();
  await expect(page.getByText(/Data used \(1 query\)/)).toBeVisible();
});

test.afterEach(async () => {
  await stub.close();
});

function toast(page: Page, message: string): Locator {
  return page
    .getByRole('region', { name: 'Notifications' })
    .getByText(message, { exact: true })
    .last();
}

function thumbsUp(page: Page): Locator {
  return page.getByRole('button', { name: 'Save as verified query' });
}

function thumbsDown(page: Page): Locator {
  return page.getByRole('button', { name: 'Mark answer as wrong' });
}

/** The answer as stored (`GET /sessions/:id`, api.md 2). */
async function storedAnswer(
  page: Page,
): Promise<{ feedback?: string; feedbackNote?: string; verified?: boolean }> {
  const session = await apiJson<{
    messages: {
      role: string;
      feedback?: string;
      feedbackNote?: string;
      verified?: boolean;
    }[];
  }>(page, 'GET', `/sessions/${encodeURIComponent(sessionId)}`);
  return session.messages.filter((m) => m.role === 'assistant').at(-1)!;
}

/** Marks the answer wrong and saves `note` through the note form. */
async function markWrongWithNote(page: Page, note: string): Promise<void> {
  await thumbsDown(page).click();
  await expect(toast(page, 'Answer marked as wrong')).toBeVisible();
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.getByLabel('What was wrong?').fill(note);
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(toast(page, 'Note saved')).toBeVisible();
}

test('saving an answer as a verified query', async ({ page }) => {
  await thumbsUp(page).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();
  await expect(page.getByText('Verified', { exact: true })).toBeVisible();
  await expect(thumbsUp(page)).toHaveAttribute('aria-pressed', 'true');

  await thumbsDown(page).click();
  await expect(toast(page, 'Answer marked as wrong')).toBeVisible();
  await expect(page.getByText('Verified', { exact: true })).toHaveCount(0);
  await expect(thumbsDown(page)).toHaveAttribute('aria-pressed', 'true');
  expect(await storedAnswer(page)).toMatchObject({ feedback: 'down' });
});

test('adding, editing and clearing the note of a thumbs-down', async ({
  page,
}) => {
  const note = 'It counted penalty shoot-out wins as wins.';
  // No note is offered before the answer is marked wrong.
  await expect(page.getByRole('button', { name: 'Add a note' })).toHaveCount(0);

  await thumbsDown(page).click();
  await expect(toast(page, 'Answer marked as wrong')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a note' })).toBeVisible();
  await page.getByRole('button', { name: 'Add a note' }).click();
  const field = page.getByLabel('What was wrong?');
  await expect(field).toHaveAttribute(
    'placeholder',
    'Optional: what the right reading is',
  );
  await expect(field).toHaveAttribute('maxlength', '4000');
  await field.fill(note);
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(toast(page, 'Note saved')).toBeVisible();
  await expect(page.getByText(`Note: ${note}`)).toBeVisible();
  await expect(page.getByLabel('What was wrong?')).toHaveCount(0);
  // The note is stored on the answer, with its thumbs-down.
  expect(await storedAnswer(page)).toMatchObject({
    feedback: 'down',
    feedbackNote: note,
  });

  // Cancel keeps the saved note.
  await page.getByRole('button', { name: 'Edit note' }).click();
  await expect(page.getByLabel('What was wrong?')).toHaveValue(note);
  await page.getByLabel('What was wrong?').fill('Wrong season.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(`Note: ${note}`)).toBeVisible();
  expect((await storedAnswer(page)).feedbackNote).toBe(note);

  // Saving it empty clears it.
  await page.getByRole('button', { name: 'Edit note' }).click();
  await page.getByLabel('What was wrong?').fill('');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(toast(page, 'Note removed')).toBeVisible();
  await expect(page.getByText(/^Note: /)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a note' })).toBeVisible();
  const cleared = await storedAnswer(page);
  expect(cleared.feedback).toBe('down');
  expect(cleared.feedbackNote).toBeUndefined();
});

test('a thumbs-up removes the note of a thumbs-down', async ({ page }) => {
  // Given an answer is marked wrong with the note "Wrong season."
  await markWrongWithNote(page, 'Wrong season.');
  await expect(page.getByText('Note: Wrong season.')).toBeVisible();

  await thumbsUp(page).click();
  await expect(toast(page, 'Answer saved as a verified query')).toBeVisible();
  await expect(page.getByText(/^Note: /)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add a note' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit note' })).toHaveCount(0);
  const stored = await storedAnswer(page);
  expect(stored.feedback).toBe('up');
  expect(stored.feedbackNote).toBeUndefined();
});
