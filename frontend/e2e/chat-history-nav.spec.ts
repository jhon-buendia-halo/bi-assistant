import { expect, test } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  WORLD_CUP_SESSION,
  openSessions,
} from './helpers/app-actions';
import { seedPastChat } from './helpers/past-chats';

/**
 * The chat-history navigation (ui.md, Chat-history navigation), on a host
 * other than the Business view: a past chat with several questions.
 */
test('a past chat with several questions has a history navigation that scrolls to a question', async ({
  appDataDir,
  page,
}) => {
  const long = 'A long answer line.\n\n'.repeat(60);
  seedPastChat(appDataDir, {
    name: WORLD_CUP_SESSION,
    datasets: [WORLD_CUP_DATASET],
    workflowId: 'agent:assistant',
    turns: [
      { question: 'Which team scored the most goals?', answer: long },
      { question: 'And per stage?', answer: long },
      { question: 'Only the finals', answer: long },
    ],
  });
  await page.reload();
  await openSessions(page);
  await page
    .getByRole('navigation', { name: 'Past chats', exact: true })
    .getByRole('button', { name: new RegExp(`^${WORLD_CUP_SESSION}`) })
    .click();
  await expect(page.getByTestId('past-chat-banner')).toBeVisible();

  await test.step('three ticks; the last question is in view at the end', async () => {
    const nav = page.getByRole('navigation', { name: 'Chat history' });
    await expect(nav).toBeVisible();
    await expect(page.getByTestId('session-chat-history-tick')).toHaveCount(3);
    await expect(
      page.getByTestId('session-chat-history-item-2'),
    ).toHaveAttribute('aria-current', 'true');
  });

  await test.step('hovering lists the questions; picking one scrolls to it', async () => {
    await page.getByTestId('session-chat-history-nav').hover();
    const first = page.getByTestId('session-chat-history-item-0');
    await expect(first).toBeVisible();
    await expect(first).toHaveText('Which team scored the most goals?');
    await first.click();
    await expect(first).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-history-id="0"]')).toBeInViewport();
  });
});
