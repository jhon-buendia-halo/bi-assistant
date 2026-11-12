import path from 'node:path';
import type { Page } from '@playwright/test';
import axe from 'axe-core';
import { test, expect } from './fixtures/app.fixture';
import {
  WORLD_CUP_DATASET,
  WORLD_CUP_SESSION,
  followOsTheme,
  openSessions,
} from './helpers/app-actions';
import { apiJson } from './helpers/api';
import { seedPastChat } from './helpers/past-chats';
import { worldCupKey } from './helpers/world-cup-db';
import {
  createUserAgent,
  publishAgent,
  seedWorldCupDataset,
} from './helpers/agents-api';
import { saveLenaiSettings } from './helpers/agents-api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  startLlmStub,
  systemTexts,
} from './helpers/llm-stub';
import { scenarioStep } from './support/demo-captions';

/**
 * Mirrors the Feature "Session management" in
 * specs/capabilities/agent-answers/spec.md: the Runs page and its Past chats
 * tab (R63, R66; roadmap 1.23.21), the Past chats list, the Workflow chips
 * of the page header and the list (R57, R59, R63; roadmap 1.23.6) and the
 * session id in the page header (R62; roadmap 1.14.18). Chats can no longer
 * be started (1.23.22): the New conversation screen and its tests are gone. "The conversation and its history survive
 * a restart" is covered by the datasources Feature's World Cup workflow.
 *
 * Several stories add to this file: keep each test as its owner wrote it.
 */

const EVIDENCE = path.resolve(__dirname, '../../evidence/1.14.17');

let datasourceId = '';

test.beforeEach(async ({ page }) => {
  // Background: a "World Cup Core" dataset exists.
  datasourceId = await seedWorldCupDataset(page);
});

/** The Past chats tab's list: the old sessions (past-chats R63). */
const sessionsList = (page: Page) =>
  page.getByRole('navigation', { name: 'Past chats', exact: true });
/** The page header's Workflow chip (R57). */
const headerWorkflow = (page: Page) =>
  page.locator('header').getByTestId('session-workflow');

/** The Past chats row of the session named `name`. */
const sessionRow = (page: Page, name: string) =>
  sessionsList(page)
    .getByRole('listitem')
    .filter({
      has: page.getByRole('button', { name: new RegExp(`^${name}`) }),
    });

/** Writes past chats into the data dir (no route starts one), oldest first. */
function seedSessions(appDataDir: string, names: string[]): string[] {
  const start = Date.now() - names.length * 60_000;
  return names.map((name, index) =>
    seedPastChat(appDataDir, {
      name,
      datasets: [WORLD_CUP_DATASET],
      workflowId: 'agent:assistant',
      createdAt: new Date(start + index * 60_000),
    }),
  );
}

test('deletes a session after confirmation', async ({ appDataDir, page }) => {
  // Given a "World Cup analysis" session exists and is open
  seedSessions(appDataDir, [WORLD_CUP_SESSION]);
  await page.reload();
  await openSessions(page);
  await sessionRow(page, WORLD_CUP_SESSION)
    .getByRole('button', { name: new RegExp(`^${WORLD_CUP_SESSION}`) })
    .click();
  await expect(
    page.getByRole('heading', { name: WORLD_CUP_SESSION }),
  ).toBeVisible();

  await openSessions(page);
  let question = '';
  page.once('dialog', (dialog) => {
    question = dialog.message();
    void dialog.accept();
  });
  await page
    .getByRole('button', { name: `Options for ${WORLD_CUP_SESSION}` })
    .click();
  await page.getByRole('button', { name: 'Delete session' }).click();

  await expect(
    page.getByText(`Session "${WORLD_CUP_SESSION}" deleted`),
  ).toBeVisible();
  expect(question).toContain(`Delete “${WORLD_CUP_SESSION}”?`);
  await expect(sessionsList(page)).toBeVisible();
  await expect(sessionRow(page, WORLD_CUP_SESSION)).toHaveCount(0);
});

test('cancelling the delete confirmation keeps the session', async ({
  appDataDir,
  page,
}) => {
  seedSessions(appDataDir, [WORLD_CUP_SESSION]);
  await page.reload();
  await openSessions(page);
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page
    .getByRole('button', { name: `Options for ${WORLD_CUP_SESSION}` })
    .click();
  await page.getByRole('button', { name: 'Delete session' }).click();

  await expect(sessionRow(page, WORLD_CUP_SESSION)).toHaveCount(1);
  await page.reload();
  await openSessions(page);
  await expect(sessionRow(page, WORLD_CUP_SESSION)).toHaveCount(1);
});

test('the Past chats tab finds a session by name or ID', async ({
  appDataDir,
  page,
}) => {
  const names = Array.from({ length: 11 }, (_, i) => `Session ${i + 1}`);
  const ids = seedSessions(appDataDir, [...names, 'Cup history']);
  const cupId = ids.at(-1)!;
  await page.reload();
  await openSessions(page);

  // Ten sessions per page, newest activity first.
  const rows = sessionsList(page).getByRole('listitem');
  await expect(rows).toHaveCount(10);
  await expect(rows.first()).toContainText('Cup history');
  const pagination = page.getByTestId('sessions-pagination');
  await expect(pagination).toContainText('1–10 of 12');
  await expect(pagination).toContainText('Page 1 of 2');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(rows).toHaveCount(2);
  await expect(pagination).toContainText('11–12 of 12');

  // Each row shows its datasets, its workflow and its id.
  const search = page.getByPlaceholder('Search sessions by name or ID…');
  await search.fill('cup HISTORY');
  await expect(rows).toHaveCount(1);
  await expect(pagination).toContainText('1–1 of 1');
  const row = sessionRow(page, 'Cup history');
  await expect(row).toContainText(WORLD_CUP_DATASET);
  await expect(row.getByTestId('row-session-workflow')).toHaveText(
    'Assistant',
  );
  await expect(row.getByTestId('row-session-id')).toHaveText(
    `ID ${cupId.slice(0, 8)}`,
  );
  await page.screenshot({ path: path.join(EVIDENCE, 'sessions-page.png') });

  await search.fill(cupId.slice(0, 8).toUpperCase());
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Cup history');

  await search.fill('nothing like this');
  await expect(
    page.getByText('No sessions match "nothing like this".'),
  ).toBeVisible();

  await search.fill('');
  await expect(rows).toHaveCount(10);
  await sessionRow(page, 'Cup history')
    .getByRole('button', { name: /^Cup history/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Cup history' }),
  ).toBeVisible();
});

test('I copy the session id to share it', async ({ appDataDir, page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  const [id] = seedSessions(appDataDir, [WORLD_CUP_SESSION]);
  await page.reload();
  await openSessions(page);
  await sessionRow(page, WORLD_CUP_SESSION)
    .getByRole('button', { name: new RegExp(`^${WORLD_CUP_SESSION}`) })
    .click();

  const button = page.locator('header').getByTestId('session-id');
  await expect(button).toHaveText(`ID ${id.slice(0, 8)}`);
  await expect(button).toHaveAttribute(
    'title',
    `Session ID ${id} (click to copy)`,
  );

  await button.click();
  await expect(page.getByText('Session ID copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
});

// ------------------------------------------ Workflow-first (roadmap 1.23.6)

const HISTORIAN = 'Cup historian';

/** Creates and publishes a user agent over World Cup Core; returns its id. */
async function publishHistorian(page: Page): Promise<string> {
  const id = await createUserAgent(page, {
    name: HISTORIAN,
    description: 'Answers questions about World Cup history.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  return id;
}


test("a deleted agent's chat names its workflow as deleted", async ({
  appDataDir,
  page,
}) => {
  // Given a chat started from the workflow of the published agent
  const id = await publishHistorian(page);
  const sessionId = seedPastChat(appDataDir, {
    name: HISTORIAN,
    datasets: [WORLD_CUP_DATASET],
    agentId: id,
    agentName: HISTORIAN,
    workflowId: `agent:${id}`,
  });
  // And the agent is deleted
  await apiJson(page, 'DELETE', `/agents/${encodeURIComponent(id)}`);
  await page.reload();

  const deleted = `${HISTORIAN} · agent deleted`;
  await openSessions(page);
  const chip = sessionRow(page, HISTORIAN).getByTestId('row-session-workflow');
  await expect(chip).toHaveText(deleted);
  await expect(chip).toHaveAttribute('title', `Workflow: ${deleted}`);

  await sessionRow(page, HISTORIAN)
    .getByRole('button', { name: new RegExp(`^${HISTORIAN}`) })
    .click();
  await expect(page.locator('header').getByTestId('session-id')).toHaveText(
    `ID ${sessionId.slice(0, 8)}`,
  );
  await expect(headerWorkflow(page)).toHaveText(deleted);
});

test('a chat saved before workflows names the workflow of its agent', async ({
  appDataDir,
  page,
}) => {
  // Saved with an agent binding and no `workflowId` (past-chats R65).
  const id = seedPastChat(appDataDir, {
    name: 'Saved RFP chat',
    datasets: [WORLD_CUP_DATASET],
    agentKey: 'rfp',
    agentName: 'RFP Builder',
  });
  await page.reload();

  await openSessions(page);
  const row = sessionRow(page, 'Saved RFP chat');
  await expect(row.getByTestId('row-session-workflow')).toHaveText(
    'RFP Builder',
  );
  await row.getByRole('button', { name: /^Saved RFP chat/ }).click();
  await expect(page.locator('header').getByTestId('session-id')).toHaveText(
    `ID ${id.slice(0, 8)}`,
  );
  await expect(
    page.locator('header').getByText('Workflow', { exact: true }),
  ).toBeVisible();
  await expect(headerWorkflow(page)).toHaveText('RFP Builder');
});

// ------------------------------------------------------------------ Runs

/**
 * Feature "Session management", plan 1.24.11: the Runs page lists stored
 * runs and, in its Past chats tab, the old sessions, which open read-only.
 */
const QUESTION = 'Which team scored the most goals?';
const ANSWER = 'Brazil scored the most goals in this data.';
const OLD_QUESTION = 'How many matches were played at each stage?';
const OLD_ANSWER = 'The group stage holds most of the matches.';
const OLD_CHAT = 'Stage counts chat';
const OLD_SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
const VISUAL_TITLE = 'Matches by stage';
const SKILL_TAG = '<interactive-visuals-skill>';
const SPEC_REPLY = {
  title: VISUAL_TITLE,
  description: 'The group stage is played far more often than any knockout round.',
  spec: {
    spec: 1,
    chart: {
      form: 'bar',
      select: ['stage', 'matches'],
      x: 'stage',
      y: 'matches',
      sort: { by: 'y', dir: 'desc' },
    },
  },
};

test.describe('Runs and Past chats', () => {
  let stub: LlmStub;

  function reply(request: StubRequest): StubReply {
    if (systemTexts(request).some((text) => text.includes(SKILL_TAG))) {
      return { text: JSON.stringify(SPEC_REPLY) };
    }
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
    const old = text.includes(OLD_QUESTION);
    if (old && !request.messages.some((m) => m.role === 'tool')) {
      return {
        toolCall: {
          name: 'run_readonly_sql',
          arguments: { sql: OLD_SQL, rationale: 'Count the matches per stage.' },
        },
      };
    }
    return { text: old ? OLD_ANSWER : ANSWER };
  }

  test.beforeEach(async ({ page }) => {
    stub = await startLlmStub();
    stub.reply = reply;
    await saveLenaiSettings(page, stub.baseUrl);
  });

  test.afterEach(async () => {
    await stub.close();
  });

  const rail = (page: Page) =>
    page.getByRole('complementary', { name: 'Navigation rail' });
  const composerBox = (page: Page) =>
    page.getByPlaceholder('Ask a follow-up question…');

  /** A stored run of the Assistant, made through the API. */
  async function seedRun(page: Page): Promise<string> {
    const run = await apiJson<{ id: string }>(
      page,
      'POST',
      '/workflows/agent%3Aassistant/runs',
      { input: { question: QUESTION, datasets: [WORLD_CUP_DATASET] } },
    );
    return run.id;
  }

  /** An old chat with a transcript and a visual, written into the data dir. */
  function seedOldChat(appDataDir: string): string {
    return seedPastChat(appDataDir, {
      name: OLD_CHAT,
      datasets: [WORLD_CUP_DATASET],
      workflowId: 'agent:assistant',
      turns: [
        {
          question: OLD_QUESTION,
          answer: OLD_ANSWER,
          data: [
            {
              tool: 'run_readonly_sql',
              input: OLD_SQL,
              columns: ['stage', 'matches'],
              rows: [
                { stage: 'Group stage', matches: 48 },
                { stage: 'Round of 16', matches: 8 },
                { stage: 'Final', matches: 1 },
              ],
              rowCount: 3,
              rationale: 'Count the matches per stage.',
            },
          ],
        },
      ],
      visual: {
        title: VISUAL_TITLE,
        description: SPEC_REPLY.description,
        spec: SPEC_REPLY.spec,
      },
    });
  }

  test(
    'I find my past runs under Runs and my old chats under Past chats',
    { tag: ['@demo', '@story-1.23.21'] },
    async ({ appDataDir, page }) => {
      let runId = '';
      await scenarioStep(page, 'Given a run and an old chat made earlier', async () => {
        runId = await seedRun(page);
        seedOldChat(appDataDir);
        await page.reload();
      });
      await scenarioStep(page, 'When I open Runs', async () => {
        await rail(page).getByRole('button', { name: 'Runs', exact: true }).click();
      });
      await scenarioStep(page, 'Then I see the run I made earlier', async () => {
        await expect(page.getByTestId('runs-tab-runs')).toHaveAttribute('aria-selected', 'true');
        const row = page.getByTestId(`run-${runId}`);
        await expect(row.getByTestId('row-run-title')).toHaveText(QUESTION);
        await expect(row.getByTestId('row-run-workflow')).toHaveText('Assistant');
        await expect(row.getByTestId('row-run-status')).toHaveText('Done');
      });
      await scenarioStep(page, 'When I open it', async () => {
        await page.getByTestId(`run-${runId}`).getByRole('button').first().click();
      });
      await scenarioStep(page, 'Then I see its input and its answer', async () => {
        await expect(page.getByTestId('run-detail-input')).toContainText(QUESTION);
        await expect(page.getByTestId('run-detail-input')).toContainText(WORLD_CUP_DATASET);
        await expect(page.getByTestId('run-detail-answer')).toContainText(ANSWER);
        await expect(page.getByTestId('run-detail-status')).toHaveText('Run succeeded');
      });
      await scenarioStep(page, 'When I click Run again', async () => {
        await page.getByTestId('run-again').click();
      });
      await scenarioStep(page, 'Then the Assistant opens on Run with the same input', async () => {
        await expect(page.getByTestId('workflow-detail-name')).toHaveText('Assistant');
        await expect(page.getByTestId('workflow-panel-tab-run')).toHaveAttribute(
          'aria-selected',
          'true',
        );
        await expect(page.getByTestId('workflow-input-question')).toHaveValue(QUESTION);
        await expect(
          page.getByTestId('workflow-input-datasets').getByRole('button', { name: WORLD_CUP_DATASET }),
        ).toHaveAttribute('aria-pressed', 'true');
      });
      await scenarioStep(page, 'When I open Past chats and open the old chat', async () => {
        await rail(page).getByRole('button', { name: 'Runs', exact: true }).click();
        await page.getByTestId('runs-tab-past-chats').click();
        await sessionRow(page, OLD_CHAT).getByRole('button', { name: /^Stage counts chat/ }).click();
      });
      await scenarioStep(page, 'Then I see the past-chat banner and its transcript', async () => {
        await expect(page.getByTestId('past-chat-banner')).toContainText('This is a past chat');
        await expect(page.getByText(OLD_QUESTION, { exact: true })).toBeVisible();
        await expect(page.getByText(OLD_ANSWER, { exact: true })).toBeVisible();
      });
      await scenarioStep(page, 'And there is no composer', async () => {
        await expect(composerBox(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Send message' })).toHaveCount(0);
      });
      await scenarioStep(page, 'When I open its visual in the panel and download it', async () => {
        const panel = page.getByRole('complementary', { name: 'Details panel' });
        if (!(await panel.isVisible())) {
          await page.getByRole('button', { name: 'Expand right panel' }).first().click();
        }
        await expect(
          panel.locator('iframe[title="Interactive visualization"]'),
        ).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Tailor' })).toHaveCount(0);
        await expect(panel.getByRole('button', { name: 'Refresh data' })).toHaveCount(0);
        const download = page.waitForEvent('download');
        await panel.getByRole('button', { name: 'Download bundle' }).click();
        expect((await download).suggestedFilename()).toMatch(/\.zip$/);
      });
    },
  );

  test('no control on a past chat sends, rates, tailors or refreshes', async ({
    appDataDir,
    page,
  }) => {
    seedOldChat(appDataDir);
    await page.reload();
    await openSessions(page);
    await sessionRow(page, OLD_CHAT).getByRole('button', { name: /^Stage counts chat/ }).click();
    await expect(page.getByTestId('past-chat-banner')).toBeVisible();
    await expect(page.getByText(OLD_ANSWER, { exact: true })).toBeVisible();

    const main = page.getByRole('main');
    await expect(main.locator('textarea')).toHaveCount(0);
    for (const name of [
      'Send message',
      'Careful mode',
      'Deep analysis',
      'Save as verified query',
      'Mark answer as wrong',
      'Generate interactive visuals',
    ]) {
      await expect(page.getByRole('button', { name }), name).toHaveCount(0);
    }
    const panel = page.getByRole('complementary', { name: 'Details panel' });
    if (!(await panel.isVisible())) {
      await page.getByRole('button', { name: 'Expand right panel' }).first().click();
    }
    await expect(panel.locator('iframe[title="Interactive visualization"]')).toBeVisible();
    for (const name of ['Tailor', 'Refresh data']) {
      await expect(panel.getByRole('button', { name }), name).toHaveCount(0);
    }
    // Deleting stays in the list.
    await openSessions(page);
    await expect(sessionRow(page, OLD_CHAT).getByRole('button', { name: /^Options for/ })).toBeVisible();
  });

  test('the Runs page has no detectable accessibility violations in either theme', async ({
    page,
  }) => {
    await seedRun(page);
    await followOsTheme(page);
    await page.reload();
    await rail(page).getByRole('button', { name: 'Runs', exact: true }).click();
    await expect(page.getByTestId('runs-list')).toBeVisible();
    await page.addScriptTag({ content: axe.source });
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.waitForTimeout(500);
      const results = await page.evaluate(async () => {
        return (window as unknown as { axe: typeof axe }).axe.run(document);
      });
      expect(results.violations, theme).toEqual([]);
    }
  });
});
