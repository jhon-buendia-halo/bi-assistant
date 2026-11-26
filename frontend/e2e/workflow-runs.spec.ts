import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axe from 'axe-core';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { scenarioStep } from './support/demo-captions';
import { WORLD_CUP_DATASET, followOsTheme } from './helpers/app-actions';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import { apiBaseOf } from './helpers/api';
import {
  LlmStub,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
} from './helpers/llm-stub';
import {
  ASK_STEP_ID,
  ASK_WORKFLOW_ID,
  ASK_WORKFLOW_NAME,
  runWorkflow,
  type StoredRun,
} from './helpers/runs-api';
import { worldCupKey, worldCupScalar } from './helpers/world-cup-db';
import {
  answerPickAsk,
  closeComposerMenu,
  composer,
  composerMenu,
  fillRun,
  openComposerMenu,
  pickDataset,
  pickedDataset,
  sendButton,
  sendRun,
  unfoldMenuItem,
} from './helpers/run-ui';

/**
 * Mirrors the Feature "Workflow runs" in specs/capabilities/workflows/spec.md:
 * Answer a Business Question (Avery + Michael) runs from its page's Run tab
 * (workflows R21), on the recording stub model and the World Cup dataset. The
 * stub moves Avery itself (helpers/v2-steps.ts `averyMove`): she briefs
 * Michael through answer_from_data, and these scripts answer Michael's turn.
 */

const ASK_ID = ASK_WORKFLOW_ID;
const ASK = ASK_WORKFLOW_NAME;
const QUESTION = 'Which team scored the most goals?';
const ANSWER = 'Brazil scored the most goals in this data.';
const SECOND_QUESTION = 'And the fewest?';
const SECOND_ANSWER = 'Zaire scored the fewest goals in this data.';
const SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
/** Its one step: Avery's turn, Michael's included. */
const STEP = ASK_STEP_ID;

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  // Background
  stub = await startLlmStub();
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

/** A data directory of a test's own app (the queue test's), removed after it. */
let ownDir: string | undefined;

test.afterEach(async () => {
  await stub.close();
});

test.afterAll(() => {
  if (ownDir) fs.rmSync(ownDir, { recursive: true, force: true });
  ownDir = undefined;
});

/** The stored runs' statuses, newest first (api.md 120). */
async function storedStatuses(page: Page): Promise<string[]> {
  const res = await page.request.get(`${apiBaseOf(page)}/workflow-runs`);
  const { runs } = (await res.json()) as { runs: { status: string }[] };
  return runs.map((run) => run.status);
}

async function storedRun(page: Page, id: string): Promise<StoredRun> {
  const res = await page.request.get(`${apiBaseOf(page)}/workflow-runs/${id}`);
  return (await res.json()) as StoredRun;
}

// ------------------------------------------------------------------ the stub

/** The last user message of a request: which run's turn it belongs to. */
function lastUserText(request: StubRequest): string {
  const users = request.messages.filter((message) => message.role === 'user');
  return users.length === 0 ? '' : messageText(users[users.length - 1]);
}

/**
 * A streamed call of Michael's turn whose latest user message is `text`
 * (not one of Avery's calls, which the stub answers itself).
 */
function isTurn(request: StubRequest, text: string): boolean {
  return (
    request.stream &&
    request.step === undefined &&
    !request.avery &&
    lastUserText(request) === text
  );
}

/** The model's last message in the request was a tool result. */
function afterToolResult(request: StubRequest): boolean {
  return request.messages.at(-1)?.role === 'tool';
}

/** The offered tool whose name is (or ends with) `name`. */
function toolName(request: StubRequest, name: string): string {
  return request.tools.find((tool) => tool === name || tool.endsWith(name)) ?? name;
}

/** Each question queries once with SQL, then answers its text. */
function answerWithSql(answers: Record<string, string>): (r: StubRequest) => StubReply {
  return (request) => {
    const question = Object.keys(answers).find((q) => isTurn(request, q));
    if (question === undefined) return { text: 'The stub model answered this question.' };
    if (!afterToolResult(request)) {
      return {
        toolCall: {
          name: toolName(request, 'run_readonly_sql'),
          arguments: { sql: SQL, rationale: 'Counting matches per stage.' },
        },
      };
    }
    return { text: answers[question] };
  };
}

/** A promise a test resolves by hand. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

// ------------------------------------------------------------------ the UI

function railItem(page: Page, name: string): Locator {
  return page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name, exact: true });
}

/** The Run panel on the right of the canvas: the Chat (the run form). */
function runDock(page: Page): Locator {
  return page.getByTestId('workflow-run-dock');
}

async function openWorkflowPage(page: Page, id: string, name: string): Promise<void> {
  await railItem(page, 'Workflows').click();
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible();
  await page.getByTestId(`workflow-${id}`).click();
  await expect(page.getByTestId('workflow-detail-name')).toHaveText(name);
}

async function openRunTab(page: Page): Promise<void> {
  await page.getByTestId('workflow-execute').click();
  await expect(composer(page)).toBeVisible();
}


/** A step's node on the canvas; its status in the run shown is `data-status`. */
function runStep(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-node-${id}`);
}

function nodeStatus(page: Page, id: string): Locator {
  return page.getByTestId(`workflow-node-${id}`).getByTestId('workflow-node-status');
}

function runAnswer(page: Page): Locator {
  return page.getByTestId('run-answer');
}

/**
 * Michael's SQL call in the live relay of Avery's step (ui.md 4.4b *relay*):
 * her answer_from_data, then his calls under it.
 */
function sqlCall(page: Page): Locator {
  return page
    .locator('[data-testid="workflow-run-relay-teammate-step"][data-tool="run_readonly_sql"]')
    .first();
}

// ------------------------------------------------------------------ scenarios

test.describe('Feature: Workflow runs', () => {
  test(
    'I run Answer a Business Question on a question',
    { tag: ['@demo', '@story-1.23.15'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER, [SECOND_QUESTION]: SECOND_ANSWER });
      // The first answer waits until the test has seen the step running.
      const held = gate();
      stub.hold = (request) =>
        isTurn(request, QUESTION) && afterToolResult(request) ? held.promise : undefined;

      await scenarioStep(
        page,
        `When I open "${ASK}" from Workflows and click Run workflow`,
        async () => {
          await openWorkflowPage(page, ASK_ID, ASK);
          await openRunTab(page);
        },
      );
      await scenarioStep(page, 'Then the Run tab shows the composer and no Careful', async () => {
        const panel = runDock(page);
        await expect(page.getByRole('complementary', { name: 'Details panel' })).toHaveCount(0);
        await expect(panel.getByTestId('run-composer')).toHaveAccessibleName(/^Message \S/);
        await expect(composer(page)).toHaveValue('');
        await expect(composer(page)).toHaveAttribute('placeholder', /^Message \S/);
        // Nothing to send yet; no Execute button any more.
        await expect(sendButton(page)).toHaveAccessibleName('Send');
        await expect(sendButton(page)).toBeDisabled();
        await expect(page.getByTestId('workflow-run')).toHaveCount(0);
        await expect(pickedDataset(page, WORLD_CUP_DATASET)).toHaveCount(0);
        await openComposerMenu(page);
        await expect(composerMenu(page).getByRole('switch', { name: /^Careful/ })).toHaveCount(0);
        await closeComposerMenu(page);
      });
      await scenarioStep(
        page,
        `When I type "${QUESTION}", click Send and add "${WORLD_CUP_DATASET}" when the agent asks`,
        async () => {
          await composer(page).fill(QUESTION);
          await sendRun(page);
          await answerPickAsk(page, WORLD_CUP_DATASET);
        },
      );
      await scenarioStep(
        page,
        'Then the Orchestrate step is running on the canvas and in the Run tab, with its SQL call',
        async () => {
          await expect(nodeStatus(page, STEP)).toHaveText('Running');
          await expect(runStep(page, STEP)).toHaveAttribute('data-status', 'running');
          await expect(sqlCall(page)).toBeVisible();
          await expect(page.getByTestId('workflow-run-stop')).toBeVisible();
          held.release();
        },
      );
      await scenarioStep(
        page,
        "And I see the stub's answer with its SQL, and its step Done",
        async () => {
          await expect(runAnswer(page)).toContainText(ANSWER);
          await page.getByTestId('query-row-0').click();
          await page.getByTestId('query-inspector-tab-sql').click();
          await expect(page.getByTestId('query-sql')).toHaveText(SQL);
          await page.getByTestId('query-inspector-close').click();
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          await expect(nodeStatus(page, STEP)).toHaveText('Done');
          await expect(runStep(page, STEP)).toHaveAttribute('data-status', 'success');
        },
      );
      await scenarioStep(page, 'Then the composer is hidden while the answer shows', async () => {
        await expect(page.getByTestId('run-composer')).toHaveCount(0);
        await expect(composer(page)).toHaveCount(0);
        await expect(page.getByTestId('workflow-follow-up-input')).toHaveCount(0);
        await expect(page.getByTestId('workflow-run-follow-up')).toHaveCount(0);
        await expect(page.getByTestId('workflow-run-stop')).toHaveCount(0);
      });
      await scenarioStep(
        page,
        `When I click New question, type "${SECOND_QUESTION}" and click Send`,
        async () => {
          await page.getByTestId('workflow-run-new').click();
          // The dataset stays added: nothing is missing, so the run starts.
          await expect(pickedDataset(page, WORLD_CUP_DATASET)).toBeVisible();
          await composer(page).fill(SECOND_QUESTION);
          await sendRun(page);
        },
      );
      await scenarioStep(page, 'Then I see the second answer', async () => {
        await expect(page.getByTestId('run-intake-datasets')).toHaveCount(0);
        await expect(page.getByTestId('workflow-run-question')).toHaveText(SECOND_QUESTION);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
        await expect(runAnswer(page)).toContainText(SECOND_ANSWER);
      });
    },
  );

  test(
    'I open a query of an answer in the inspector and read how it was built',
    { tag: ['@demo', '@story-1.25.4'] },
    async ({ page }) => {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: new URL(page.url()).origin,
      });
      const total = Number(await worldCupScalar(`SELECT COUNT(*) FROM ${worldCupKey('matches')}`));
      const sql = `SELECT COUNT(*) AS total_matches FROM ${worldCupKey('matches')}`;
      const question = 'How many matches does the data hold?';
      stub.reply = (request) => {
        if (!isTurn(request, question)) return { text: 'The stub model answered this question.' };
        return afterToolResult(request)
          ? { text: `The data holds ${total.toLocaleString('en-US')} matches.` }
          : {
              toolCall: {
                name: toolName(request, 'run_readonly_sql'),
                arguments: { sql, rationale: 'Counting all the matches.' },
              },
            };
      };
      const sheet = page.getByTestId('query-inspector');

      await scenarioStep(page, `When I run "${question}" on "${WORLD_CUP_DATASET}"`, async () => {
        await openWorkflowPage(page, ASK_ID, ASK);
        await openRunTab(page);
        await fillRun(page, question, WORLD_CUP_DATASET);
        await sendRun(page);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      });
      await scenarioStep(page, 'Then I see the coverage line and a query row with its chip', async () => {
        await expect(page.getByTestId('query-coverage-line')).toContainText('table was read');
        const row = page.getByTestId('query-row-0');
        await expect(row).toContainText('Counting all the matches.');
        await expect(row.getByTestId('query-coverage-chip')).toHaveText('Whole table');
        await expect(runAnswer(page).getByText('How I worked this out')).toHaveCount(0);
        await expect(runAnswer(page).getByText(/Data used/)).toHaveCount(0);
      });
      const chip = runAnswer(page).getByTestId('figure-ref').first();
      await scenarioStep(page, 'And a figure of the answer carries a numbered source', async () => {
        await expect(chip).toHaveText('1');
        await expect(chip).toHaveAttribute('data-query-index', '0');
        await chip.hover();
        await expect(page.getByTestId('figure-ref-card')).toContainText('Counting all the matches.');
        await expect(page.getByTestId('figure-ref-card')).toContainText('Click to see how it was computed');
      });
      await scenarioStep(page, 'When I open the query from the chip', async () => {
        await chip.click();
      });
      await scenarioStep(page, 'Then the inspector opens beside the answer and I read its last step', async () => {
        await expect(sheet).toBeVisible();
        await expect(sheet).toHaveAttribute('aria-modal', 'false');
        await expect(page.getByTestId('query-inspector-close')).toBeFocused();
        await expect(page.getByTestId('query-inspector-position')).toHaveText('Source 1 of 1');
        await expect(page.getByTestId('query-inspector-title')).toHaveText('Counting all the matches.');
        await expect(page.getByTestId('query-inspector-meta')).toContainText('PostgreSQL');
        await expect(page.getByTestId('query-inspector-tab-steps')).toHaveAttribute('aria-selected', 'true');
        const steps = page.getByTestId('query-funnel-step');
        await expect(steps.first()).toHaveAttribute('data-verb', 'start');
        await expect(steps.last()).toHaveAttribute('data-verb', 'show');
        await expect(steps.last()).toContainText('Show');
        // The sheet opens over the canvas, right of the Run panel on the left,
        // so the answer stays visible.
        const sheetBox = (await page.getByTestId('query-inspector-sheet').boundingBox())!;
        const dockBox = (await runDock(page).boundingBox())!;
        expect(sheetBox.x).toBeGreaterThanOrEqual(dockBox.x + dockBox.width - 1);
        expect(sheetBox.width).toBeLessThanOrEqual(720);
        await expect(runAnswer(page)).toBeVisible();
      });
      await scenarioStep(page, 'When I switch to Result and to SQL', async () => {
        await page.getByTestId('query-inspector-tab-result').click();
        await expect(page.getByTestId('query-result-table')).toContainText('total_matches');
        await expect(page.getByTestId('query-result-table')).toContainText(String(total));
        await page.getByTestId('query-inspector-tab-sql').click();
        await expect(page.getByTestId('query-sql')).toHaveText(sql);
      });
      await scenarioStep(page, 'And I copy the SQL', async () => {
        await page.getByTestId('query-copy-sql').click();
        await expect(page.getByText('SQL copied to clipboard')).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sql);
      });
      await scenarioStep(page, 'And I press Escape', async () => {
        await page.keyboard.press('Escape');
      });
      await scenarioStep(page, 'Then the inspector closes and the focus is back on the chip', async () => {
        await expect(sheet).toHaveCount(0);
        await expect(runAnswer(page).getByTestId('figure-ref').first()).toBeFocused();
      });
    },
  );

  test(
    'I open the query of a stored run from the Runs page',
    { tag: ['@demo', '@story-1.25.5'] },
    async ({ page }) => {
      const sql = `SELECT COUNT(*) AS total_matches FROM ${worldCupKey('matches')}`;
      const question = 'How many matches does the data hold?';
      stub.reply = (request) => {
        if (!isTurn(request, question)) return { text: 'The stub model answered this question.' };
        return afterToolResult(request)
          ? { text: 'The data holds many matches.' }
          : {
              toolCall: {
                name: toolName(request, 'run_readonly_sql'),
                arguments: { sql, rationale: 'Counting all the matches.' },
              },
            };
      };

      await scenarioStep(page, `Given I ran "${question}" on "${WORLD_CUP_DATASET}"`, async () => {
        await openWorkflowPage(page, ASK_ID, ASK);
        await openRunTab(page);
        await fillRun(page, question, WORLD_CUP_DATASET);
        await sendRun(page);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      });
      await scenarioStep(page, 'When I open that run from the Runs page', async () => {
        await railItem(page, 'Runs').click();
        await page.getByTestId(/^run-[0-9a-f]{8}-/).first().getByRole('button').first().click();
        // A finished run opens on its workflow's page, drawn with that run (workflows R19).
        await expect(page.getByTestId('workflow-detail-name')).toHaveText(ASK);
        await expect(page.getByTestId('workflow-run-question')).toHaveText(question);
        await expect(runAnswer(page)).toContainText('The data holds many matches.');
      });
      await scenarioStep(page, 'Then I see its coverage line and its query row', async () => {
        const answer = runAnswer(page);
        await expect(answer.getByTestId('query-coverage-line')).toContainText('table was read');
        await expect(answer.getByTestId('query-row-0')).toContainText('Counting all the matches.');
        await expect(answer.getByText(/Data used/)).toHaveCount(0);
      });
      await scenarioStep(page, 'When I open the query from its row', async () => {
        await page.getByTestId('query-row-0').click();
      });
      await scenarioStep(page, 'Then the inspector shows its steps and the focus is on its close button', async () => {
        await expect(page.getByTestId('query-inspector-position')).toHaveText('Source 1 of 1');
        await expect(page.getByTestId('query-funnel-step').last()).toHaveAttribute('data-verb', 'show');
        await expect(page.getByTestId('query-inspector-close')).toBeFocused();
        const sheet = (await page.getByTestId('query-inspector-sheet').boundingBox())!;
        expect(sheet.width).toBeLessThanOrEqual(720);
      });
      await scenarioStep(page, 'When I press Escape', async () => {
        await page.keyboard.press('Escape');
      });
      await scenarioStep(page, 'Then it closes and the focus is back on the row', async () => {
        await expect(page.getByTestId('query-inspector')).toHaveCount(0);
        await expect(page.getByTestId('query-row-0')).toBeFocused();
      });
    },
  );

  test(
    "I rate a run's answer and it becomes a verified query",
    { tag: ['@demo', '@story-1.23.19'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER });

      await scenarioStep(page, `Given I ran "${ASK}" on "${QUESTION}"`, async () => {
        await openWorkflowPage(page, ASK_ID, ASK);
        await openRunTab(page);
        await fillRun(page, QUESTION, WORLD_CUP_DATASET);
        await sendRun(page);
        await expect(runAnswer(page)).toContainText(ANSWER);
        await expect(runAnswer(page).getByText('Verified', { exact: true })).toHaveCount(0);
      });
      await scenarioStep(page, "When I give the run's answer a thumbs-up", async () => {
        await runAnswer(page).getByRole('button', { name: 'Save as verified query' }).click();
      });
      await scenarioStep(
        page,
        'Then I see "Answer saved as a verified query" and the Verified badge',
        async () => {
          await expect(page.getByText('Answer saved as a verified query')).toBeVisible();
          await expect(runAnswer(page).getByText('Verified', { exact: true })).toBeVisible();
        },
      );
      await scenarioStep(
        page,
        'When I run the same question again, then its answer shows Verified',
        async () => {
          // New question keeps the dataset added; the question is typed again.
          await page.getByTestId('workflow-run-new').click();
          await composer(page).fill(QUESTION);
          await sendRun(page);
          await expect(runAnswer(page)).toContainText(ANSWER);
          await expect(runAnswer(page).getByText('Verified', { exact: true })).toBeVisible();
        },
      );
    },
  );

  test('Enter runs the question, the run hides the composer and New question brings it back', async ({
    page,
  }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    await scenarioStep(page, `Given I am on the Run panel of "${ASK}" with "${WORLD_CUP_DATASET}" added`, async () => {
      await openWorkflowPage(page, ASK_ID, ASK);
      await openRunTab(page);
      await pickDataset(page, WORLD_CUP_DATASET);
      await closeComposerMenu(page);
      await expect(pickedDataset(page, WORLD_CUP_DATASET)).toBeVisible();
    });
    await scenarioStep(page, 'When I press Shift+Enter, the composer adds a line and nothing runs', async () => {
      await composer(page).fill('Which team');
      await composer(page).press('Shift+Enter');
      await expect(composer(page)).toHaveValue('Which team\n');
      await expect(page.getByTestId('run-user-message')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
    });
    await scenarioStep(page, 'When I type the question and press Enter', async () => {
      await composer(page).fill(QUESTION);
      await composer(page).press('Enter');
    });
    await scenarioStep(page, 'Then the workflow runs and I see the answer', async () => {
      await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      await expect(runAnswer(page)).toContainText(ANSWER);
      await expect(page.getByTestId('workflow-run-question')).toHaveText(QUESTION);
    });
    await scenarioStep(page, 'And the composer and any follow-up are gone under the answer', async () => {
      await expect(page.getByTestId('run-composer')).toHaveCount(0);
      await expect(composer(page)).toHaveCount(0);
      await expect(page.getByTestId('workflow-follow-up-input')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run-follow-up')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run')).toHaveCount(0);
    });
    await scenarioStep(page, 'When I click New question', async () => {
      await page.getByTestId('workflow-run-new').click();
    });
    await scenarioStep(page, 'Then the run is cleared, the composer is empty and focused, and the dataset stays added', async () => {
      await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
      await expect(runAnswer(page)).toHaveCount(0);
      await expect(composer(page)).toBeVisible();
      await expect(composer(page)).toHaveValue('');
      await expect(composer(page)).toBeFocused();
      await expect(sendButton(page)).toBeDisabled();
      await expect(pickedDataset(page, WORLD_CUP_DATASET)).toBeVisible();
      await expect(page.getByTestId('workflow-run-new')).toHaveCount(0);
    });
  });

  test('Asking on home runs Answer a Business Question on its page', async ({ page }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    const ask = page.getByTestId('welcome-ask');
    await scenarioStep(page, `Given I am on home with "${WORLD_CUP_DATASET}" as the only dataset`, async () => {
      await page.reload();
      await expect(ask.getByLabel('What do you want to know?')).toBeVisible();
      await expect(page.getByTestId('welcome-setup')).toHaveCount(0);
    });
    await scenarioStep(page, 'Then that dataset is already picked', async () => {
      await expect(
        ask.getByRole('button', { name: `Remove ${WORLD_CUP_DATASET}`, exact: true }),
      ).toBeVisible();
    });
    await scenarioStep(page, 'When I type the question and press Enter', async () => {
      const question = page.getByTestId('welcome-question');
      await question.fill(QUESTION);
      await question.press('Enter');
    });
    await scenarioStep(page, `Then "${ASK}" opens, runs on my question and I see the answer`, async () => {
      await expect(page.getByTestId('workflow-detail-name')).toHaveText(ASK);
      await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      await expect(runAnswer(page)).toContainText(ANSWER);
      await expect(page.getByTestId('workflow-run-question')).toHaveText(QUESTION);
    });
    await scenarioStep(page, 'And home lists the run under Recent runs', async () => {
      await page.reload();
      await expect(
        page.getByTestId('welcome-runs').getByRole('button', { name: ASK }),
      ).toBeVisible();
    });
  });

  test('The Run panel maximizes, folds and resizes from the keyboard', async ({ page }) => {
    const dock = runDock(page);
    const maximize = dock.getByTestId('workflow-run-dock-maximize');
    const toggle = dock.getByTestId('workflow-state-toggle');
    const width = async () => (await dock.boundingBox())!.width;
    await scenarioStep(page, `Given I am on the Run panel of "${ASK}"`, async () => {
      await openWorkflowPage(page, ASK_ID, ASK);
      await openRunTab(page);
      await expect(maximize).toHaveAttribute('aria-pressed', 'false');
    });
    const normal = await width();
    await scenarioStep(page, 'When I maximize it, it grows; when I restore it, it returns', async () => {
      await maximize.click();
      await expect(maximize).toHaveAttribute('aria-pressed', 'true');
      await expect(maximize).toHaveAccessibleName('Restore Run panel');
      await expect.poll(width).toBeGreaterThan(normal);
      await maximize.click();
      await expect(maximize).toHaveAttribute('aria-pressed', 'false');
      await expect(maximize).toHaveAccessibleName('Maximize Run panel');
      await expect.poll(width).toBe(normal);
    });
    await scenarioStep(page, 'When I fold it, it narrows to a strip; when I unfold it, it returns', async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('workflow-run-chat')).toHaveCount(0);
      await expect.poll(width).toBeLessThan(normal);
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect.poll(width).toBe(normal);
    });
    await scenarioStep(page, 'When I press Arrow Right on the resize separator, the panel grows', async () => {
      const separator = dock.getByRole('separator', { name: 'Resize Run panel' });
      await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
      const before = Number(await separator.getAttribute('aria-valuenow'));
      await separator.focus();
      await page.keyboard.press('ArrowRight');
      await expect
        .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
        .toBeGreaterThan(before);
      await expect.poll(width).toBeGreaterThan(normal);
    });
  });

  test('The agent asks for a missing required dataset with option cards', async ({ page }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    const ask = page.getByTestId('run-intake-datasets');
    const option = ask.getByTestId(`run-intake-option-datasets-${WORLD_CUP_DATASET}`);
    await scenarioStep(page, `Given I am on the Run tab of "${ASK}" and no dataset is added`, async () => {
      await openWorkflowPage(page, ASK_ID, ASK);
      await openRunTab(page);
      await expect(pickedDataset(page, WORLD_CUP_DATASET)).toHaveCount(0);
    });
    await scenarioStep(page, `When I type "${QUESTION}" and click Send`, async () => {
      await composer(page).fill(QUESTION);
      await sendRun(page);
    });
    await scenarioStep(page, 'Then I see my message as a bubble on the right', async () => {
      await expect(page.getByTestId('run-user-message')).toHaveText(QUESTION);
    });
    await scenarioStep(page, 
      'And an agent message on the left asks which datasets to use, with option cards from the catalogue and the read-only footnote',
      async () => {
        await expect(ask.getByTestId('run-agent-message')).toHaveText(
          /^\s*Happy to\. First, which data should \S+ look at\? Pick one or more datasets\.\s*$/,
        );
        const card = option.locator('xpath=ancestor::li[1]');
        await expect(card).toContainText(WORLD_CUP_DATASET);
        await expect(card).toContainText(/PostgreSQL · \d+ tables?/);
        await expect(option).toHaveAccessibleName(`Add ${WORLD_CUP_DATASET}`);
        await expect(option).toHaveAttribute('aria-pressed', 'false');
        await expect(option).toHaveText('Add');
        await expect(ask).toContainText('only reads your data with read-only SQL.');
        // The composer now filters the cards.
        await expect(composer(page)).toHaveAttribute('placeholder', 'Or type a dataset name…');
      },
    );
    await scenarioStep(page, `When I click Add on "${WORLD_CUP_DATASET}"`, async () => {
      await option.click();
    });
    await scenarioStep(page, 'Then its button reads "Added"', async () => {
      await expect(option).toHaveAttribute('aria-pressed', 'true');
      await expect(option).toHaveText('Added');
    });
    const started = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().includes(`/workflows/${ASK_ID}/runs/stream`),
    );
    await scenarioStep(page, 'When I click "Continue with 1 dataset"', async () => {
      await expect(ask.getByTestId('run-intake-continue')).toHaveText('Continue with 1 dataset');
      await ask.getByTestId('run-intake-continue').click();
    });
    await scenarioStep(page, 'Then I see my answer as a bubble and the run starts with the same request as before', async () => {
      const body = (await started).postDataJSON() as { input: Record<string, unknown> };
      expect(body.input['question']).toBe(QUESTION);
      expect(body.input['datasets']).toEqual([WORLD_CUP_DATASET]);
      await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
      await expect(runAnswer(page)).toContainText(ANSWER);
      await expect(page.getByTestId('run-user-message').filter({ hasText: WORLD_CUP_DATASET })).toBeVisible();
    });
  });

  test('Optional inputs live behind the plus button', async ({ page }) => {
    const plus = page.getByTestId('run-composer-plus');
    const menu = composerMenu(page);
    await scenarioStep(page, 'Given I am on the Run tab of "Consumption Gap Analysis"', async () => {
      await openWorkflowPage(page, 'consumption-gap-analysis', 'Consumption Gap Analysis');
      await openRunTab(page);
    });
    await scenarioStep(page, 'When I click the "+" button', async () => {
      await expect(plus).toHaveAccessibleName('Add inputs and options');
      await expect(plus).toHaveAttribute('aria-expanded', 'false');
      await plus.click();
    });
    await scenarioStep(
      page,
      'Then the menu shows an ADD section with "Saved dashboard" and no OPTIONS section',
      async () => {
        await expect(plus).toHaveAttribute('aria-expanded', 'true');
        await expect(menu).toHaveAttribute('role', 'dialog');
        await expect(menu).toHaveAccessibleName('Inputs and options');
        await expect(menu.getByText('Add', { exact: true })).toBeVisible();
        await expect(menu.getByTestId('run-composer-menu-item-artifact')).toContainText('Saved dashboard');
        await expect(menu.getByText('Options', { exact: true })).toHaveCount(0);
      },
    );
    await scenarioStep(page, 'And a click outside the menu closes it', async () => {
      // The menu covers the middle of the chat: click its top right corner.
      const box = (await page.getByTestId('workflow-run-chat-log').boundingBox())!;
      await page.mouse.click(box.x + box.width - 16, box.y + 16);
      await expect(menu).toBeHidden();
      await expect(plus).toHaveAttribute('aria-expanded', 'false');
    });
  });

  test('A run needs its datasets', async ({ page }) => {
    const ask = page.getByTestId('run-intake-datasets');
    await scenarioStep(page, `Given I am on the Run tab of "${ASK}"`, async () => {
      await openWorkflowPage(page, ASK_ID, ASK);
      await openRunTab(page);
    });
    await scenarioStep(page, `When I type "${QUESTION}" and click Send`, async () => {
      await composer(page).fill(QUESTION);
      await sendRun(page);
    });
    await scenarioStep(page, 'Then the agent asks which datasets to use and nothing runs', async () => {
      await expect(ask).toBeVisible();
      await expect(ask.getByTestId('run-agent-message')).toContainText('Pick one or more datasets.');
      await expect(page.getByTestId('workflow-run-error')).toHaveCount(0);
      await expect(page.getByTestId('workflow-run-status')).toHaveCount(0);
      await expect(page.getByTestId('run-answer')).toHaveCount(0);
      expect(stub.requests.filter((request) => request.stream)).toHaveLength(0);
    });
    await scenarioStep(page, 'And "Continue" is not offered until I add one', async () => {
      const next = ask.getByTestId('run-intake-continue');
      await expect(next).toBeDisabled();
      await ask.getByTestId(`run-intake-option-datasets-${WORLD_CUP_DATASET}`).click();
      await expect(next).toBeEnabled();
      await expect(next).toHaveText('Continue with 1 dataset');
      expect(stub.requests.filter((request) => request.stream)).toHaveLength(0);
    });
  });

  test('Stop ends the run', async ({ page }) => {
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    const held = gate();
    stub.hold = (request) =>
      isTurn(request, QUESTION) && afterToolResult(request) ? held.promise : undefined;
    try {
      await scenarioStep(page, `Given "${ASK}" is running on a question`, async () => {
        await openWorkflowPage(page, ASK_ID, ASK);
        await openRunTab(page);
        await fillRun(page, QUESTION, WORLD_CUP_DATASET);
        await sendRun(page);
        await expect(sqlCall(page)).toBeVisible();
      });
      await scenarioStep(page, 'When I click Stop', async () => {
        await page.getByTestId('workflow-run-stop').click();
      });
      await scenarioStep(page, 'Then the run reads "Run stopped" and its Orchestrate step "Stopped"', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run stopped');
        await expect(runStep(page, STEP)).toHaveAttribute('data-status', 'stopped');
        await expect(nodeStatus(page, STEP)).toHaveText('Stopped');
        await expect(page.getByTestId('workflow-run-stop')).toHaveCount(0);
        // The composer stays hidden under the stopped run until New question.
        await expect(page.getByTestId('run-composer')).toHaveCount(0);
        await page.getByTestId('workflow-run-new').click();
        await expect(composer(page)).toBeVisible();
        await expect(sendButton(page)).toBeDisabled();
      });
      await scenarioStep(page, 'And the run is stored "stopped" on the server, not only on the page', async () => {
        // Stop is the server's (api.md 150); leaving the page would not stop it.
        await expect
          .poll(async () => {
            const res = await page.request.get(`${apiBaseOf(page)}/workflow-runs`);
            const { runs } = (await res.json()) as { runs: { status: string }[] };
            return runs.map((run) => run.status);
          })
          .toEqual(['stopped']);
      });
    } finally {
      held.release();
    }
  });

  test('A run waits in the queue while every slot is busy', async ({ launchApp }) => {
    const OTHER = 'How many matches were played per stage?';
    stub.reply = answerWithSql({ [QUESTION]: ANSWER, [OTHER]: ANSWER });
    // The run in the only slot waits until the test has seen mine queued.
    const held = gate();
    stub.hold = (request) =>
      isTurn(request, OTHER) && afterToolResult(request) ? held.promise : undefined;
    // Its own app with one run slot: the default `page` app keeps 8.
    ownDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qti-e2e-queue-'));
    const { page } = await launchApp(ownDir, { WORKFLOW_MAX_LIVE_RUNS: '1' });
    await seedWorldCupDataset(page);
    await saveLenaiSettings(page, stub.baseUrl);
    const tasksButton = page
      .getByRole('complementary', { name: 'Navigation rail' })
      .getByTestId('background-tasks-button');
    let busy: ReturnType<typeof runWorkflow> | undefined;
    try {
      await scenarioStep(page, 'Given every one of the run slots is taken by a run that is running', async () => {
        busy = runWorkflow(page, ASK_ID, {
          question: OTHER,
          datasets: [WORLD_CUP_DATASET],
        });
        await expect.poll(() => storedStatuses(page)).toEqual(['running']);
      });
      await scenarioStep(page, `When I click Execute on a question in "${ASK}"`, async () => {
        await openWorkflowPage(page, ASK_ID, ASK);
        await openRunTab(page);
        await fillRun(page, QUESTION, WORLD_CUP_DATASET);
        await sendRun(page);
      });
      await scenarioStep(page, 'Then the Chat shows the status "Queued…" and every node on the canvas stays idle', async () => {
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Queued…');
        await expect(runStep(page, STEP)).not.toHaveAttribute('data-status', /running|success/);
        await expect(page.getByTestId('workflow-run-stop')).toBeVisible();
      });
      await scenarioStep(page, 'And the Background tasks button lists the run with "Waiting for a free slot"', async () => {
        // The run in the slot was started through the API, so only mine is a task here.
        await expect(tasksButton).toHaveAccessibleName('Background tasks, 1 running');
        await tasksButton.click();
        const panel = page.getByRole('dialog', { name: 'Background tasks' });
        const row = panel.getByTestId('background-task').filter({ hasText: QUESTION });
        await expect(row).toContainText('Waiting for a free slot');
        await page.keyboard.press('Escape');
        await expect(panel).toBeHidden();
      });
      await scenarioStep(page, 'And the run is stored "queued" on the server, with no steps', async () => {
        await expect.poll(() => storedStatuses(page)).toEqual(['queued', 'running']);
      });
      await scenarioStep(page, 'When one of the running runs ends', async () => {
        held.release();
        const first = await busy!;
        expect(first.run?.status).toBe('success');
      });
      await scenarioStep(page, 'Then my run starts and its steps go Running then Done as in any run', async () => {
        await expect(runAnswer(page)).toContainText(ANSWER);
        await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
        await expect(runStep(page, STEP)).toHaveAttribute('data-status', 'success');
        await expect.poll(() => storedStatuses(page)).toEqual(['success', 'success']);
      });
    } finally {
      held.release();
    }
  });

  test('A run the app stopped in starts again after a restart', async ({ app, page }) => {
    test.skip(app.target !== 'web', 'restarting the backend alone needs the web target');
    stub.reply = answerWithSql({ [QUESTION]: ANSWER });
    // The first attempt hangs after its query, as a run cut off by a crash.
    const held = gate();
    stub.hold = (request) =>
      isTurn(request, QUESTION) && afterToolResult(request) ? held.promise : undefined;
    let runId = '';
    try {
      await scenarioStep(page, `Given "${ASK}" is running on a question`, async () => {
        await openWorkflowPage(page, ASK_ID, ASK);
        await openRunTab(page);
        await fillRun(page, QUESTION, WORLD_CUP_DATASET);
        await sendRun(page);
        await expect(sqlCall(page)).toBeVisible();
        const res = await page.request.get(`${apiBaseOf(page)}/workflow-runs`);
        const { runs } = (await res.json()) as { runs: { id: string; status: string }[] };
        expect(runs.map((run) => run.status)).toEqual(['running']);
        runId = runs[0].id;
        expect((await storedRun(page, runId)).attempts).toBe(1);
      });
      await scenarioStep(page, 'When the app stops and starts again', async () => {
        // The second attempt is answered at once.
        stub.hold = undefined;
        await app.restartCli();
      });
      await scenarioStep(page, 'Then the run is queued again and starts from scratch', async () => {
        await expect.poll(async () => (await storedRun(page, runId)).attempts).toBe(2);
      });
      await scenarioStep(page, 'And after it ends I see its answer, and the run is stored "success" with 2 attempts', async () => {
        await expect.poll(async () => (await storedRun(page, runId)).status, { timeout: 30_000 }).toBe('success');
        const run = await storedRun(page, runId);
        expect(run.attempts).toBe(2);
        expect(run.answer?.content).toContain(ANSWER);
        await railItem(page, 'Runs').click();
        const row = page.getByTestId(`run-${runId}`);
        await expect(row.getByTestId('row-run-status')).toHaveText('Done');
      });
    } finally {
      held.release();
    }
  });

  test(
    'A run keeps running while I am elsewhere, and its page shows it again',
    { tag: ['@demo', '@story-1.26.5'] },
    async ({ page }) => {
      stub.reply = answerWithSql({ [QUESTION]: ANSWER });
      // The answer waits until the test has come back to the page.
      const held = gate();
      stub.hold = (request) =>
        isTurn(request, QUESTION) && afterToolResult(request) ? held.promise : undefined;
      const tasksButton = page
        .getByRole('complementary', { name: 'Navigation rail' })
        .getByTestId('background-tasks-button');
      try {
        await scenarioStep(page, `Given "${ASK}" is running on a question`, async () => {
          await openWorkflowPage(page, ASK_ID, ASK);
          await openRunTab(page);
          await fillRun(page, QUESTION, WORLD_CUP_DATASET);
          await sendRun(page);
          await expect(sqlCall(page)).toBeVisible();
        });
        await scenarioStep(page, 'When I go to another area', async () => {
          await railItem(page, 'Datasets').click();
          await expect(page.getByTestId('workflow-detail-name')).toHaveCount(0);
        });
        await scenarioStep(
          page,
          'Then the Background tasks button shows the run, 1 running',
          async () => {
            await expect(tasksButton).toHaveAccessibleName('Background tasks, 1 running');
            await tasksButton.click();
            const panel = page.getByRole('dialog', { name: 'Background tasks' });
            const row = panel
              .getByTestId('background-task')
              .filter({ hasText: `${ASK}: ${QUESTION}` });
            await expect(row).toHaveAttribute('data-status', 'running');
            await page.keyboard.press('Escape');
            await expect(panel).toBeHidden();
            // Leaving did not stop it: the stored run still runs.
            const stored = await page.request.get(`${apiBaseOf(page)}/workflow-runs`);
            const { runs } = (await stored.json()) as { runs: { status: string }[] };
            expect(runs.map((run) => run.status)).toEqual(['running']);
          },
        );
        await scenarioStep(page, `When I open "${ASK}" again`, async () => {
          await openWorkflowPage(page, ASK_ID, ASK);
        });
        await scenarioStep(
          page,
          'Then the live view is there: the question, Orchestrate running and its SQL call',
          async () => {
            await expect(page.getByTestId('workflow-run-question')).toHaveText(QUESTION);
            await expect(nodeStatus(page, STEP)).toHaveText('Running');
            await expect(sqlCall(page)).toBeVisible();
            await expect(page.getByTestId('workflow-run-stop')).toBeVisible();
          },
        );
        await scenarioStep(page, 'When the model answers', async () => {
          held.release();
        });
        await scenarioStep(page, 'Then the answer shows and the task ends', async () => {
          await expect(runAnswer(page)).toContainText(ANSWER);
          await expect(page.getByTestId('workflow-run-status')).toHaveText('Run succeeded');
          // The task reads the run every 3 s until it ends.
          await expect(tasksButton).toHaveAccessibleName('Background tasks');
        });
      } finally {
        held.release();
      }
    },
  );
});

test('the Run tab with an answer has no detectable accessibility violations in either theme', async ({
  page,
}) => {
  stub.reply = answerWithSql({ [QUESTION]: ANSWER });
  await followOsTheme(page);
  await page.addScriptTag({ content: axe.source });
  await openWorkflowPage(page, ASK_ID, ASK);
  await openRunTab(page);
  await fillRun(page, QUESTION, WORLD_CUP_DATASET);
  await sendRun(page);
  await expect(runAnswer(page)).toContainText(ANSWER);
  await expect(page.getByTestId('workflow-run-new')).toBeVisible();

  async function scan(label: string): Promise<void> {
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // Let the theme's colour transitions finish before axe reads colours.
      await page.waitForTimeout(500);
      const results = await page.evaluate(async () => {
        return (window as unknown as { axe: typeof axe }).axe.run(document);
      });
      expect(results.violations, `${ASK} ${label}, ${theme}`).toEqual([]);
    }
  }

  await scan('Run panel with an answer');
  await runDock(page).getByTestId('workflow-run-dock-maximize').click();
  await expect(runDock(page).getByTestId('workflow-run-dock-maximize')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await scan('Run panel with an answer, maximized');

  // The query inspector (roadmap 1.25), each tab: opening it restores the panel.
  await runAnswer(page).locator('[data-testid^="query-row-"]').first().click();
  const inspector = page.getByTestId('query-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector.getByTestId('query-funnel-step').first()).toBeVisible();
  await scan('Query inspector, Step by step');
  await inspector.getByTestId('query-inspector-tab-result').click();
  await expect(inspector.getByTestId('query-result-table')).toBeVisible();
  await scan('Query inspector, Result');
  await inspector.getByTestId('query-inspector-tab-sql').click();
  await expect(inspector.getByTestId('query-sql')).toBeVisible();
  await scan('Query inspector, SQL');
});
