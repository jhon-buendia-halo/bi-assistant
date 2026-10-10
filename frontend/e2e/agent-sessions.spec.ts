import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET, openSessions } from './helpers/app-actions';
import {
  UserAgentInput,
  createUserAgent,
  deleteDataset,
  publishAgent,
  saveAgentDraft,
  saveLenaiSettings,
  seedDataset,
  seedWorldCupDataset,
} from './helpers/agents-api';
import {
  LlmStub,
  STUB_ANSWER,
  StubRequest,
  startLlmStub,
  systemTexts,
  turnRequests,
} from './helpers/llm-stub';
import { worldCupScalar } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Sessions started from an agent" in
 * specs/capabilities/sessions-chat/spec.md. The model is a local
 * OpenAI-compatible stub that records what the backend sends it.
 */

const ASSISTANT = 'Questions to Insights Assistant';
const HISTORIAN = 'Cup historian';
const HISTORIAN_DESCRIPTION = 'Answers questions about World Cup history';
const HISTORIAN_INSTRUCTIONS =
  'Answer as a football historian and always name the tournament year.';
const STARTERS = ['Who won in 2014?', 'Which country hosted in 2002?'];
const BASE_PROMPT_START = 'You are the Questions to Insights assistant';
const AGENT_BLOCK_START = 'Agent instructions (user-supplied';
/** Openings of the app's other per-turn context blocks (agents.md 4.1). */
const APP_BLOCK_STARTS = [
  'Datasets for this session',
  'Governed metric definitions',
  'Curated dataset knowledge',
  'Verified reference queries',
];

let stub: LlmStub;
let datasourceId = '';
let historianId = '';

const historian: UserAgentInput = {
  name: HISTORIAN,
  description: HISTORIAN_DESCRIPTION,
  instructions: HISTORIAN_INSTRUCTIONS,
  datasets: [WORLD_CUP_DATASET],
  starterQuestions: STARTERS,
};

test.beforeEach(async ({ page }) => {
  // Background
  stub = await startLlmStub();
  datasourceId = await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
  historianId = await createUserAgent(page, historian);
  await publishAgent(page, historianId);
});

test.afterEach(async () => {
  await stub.close();
});

async function openHub(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}

function startChatButton(page: Page, name: string): Locator {
  return page.getByRole('button', { name: `Start chat with ${name}` });
}

/** Starts a chat from the agent's hub card and waits for its session. */
async function startChatFromCard(page: Page, name: string): Promise<void> {
  await openHub(page);
  await startChatButton(page, name).click();
  await expect(page.getByText(`Session "${name}" created`)).toBeVisible();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

function composer(page: Page): Locator {
  return page.getByPlaceholder('Ask a follow-up question…');
}

async function send(page: Page, question: string): Promise<void> {
  await composer(page).fill(question);
  await page.getByRole('button', { name: 'Send message' }).click();
}

/** Waits until `question` has been answered `answers` times in the chat. */
async function expectAnswered(page: Page, answers: number): Promise<void> {
  await expect(page.getByText(STUB_ANSWER)).toHaveCount(answers);
  await expect(
    page.getByRole('button', { name: 'Send message' }),
  ).toBeVisible();
}

/** The first streamed request of the turn that asked `question`. */
function firstTurnRequest(question: string): StubRequest {
  const requests = turnRequests(stub, question);
  expect(requests.length, `a streamed call for "${question}"`).toBeGreaterThan(
    0,
  );
  return requests[0];
}

function sessionRow(page: Page, name: string): Locator {
  return page
    .getByRole('navigation', { name: 'Sessions navigation' })
    .locator('[data-testid^="session-"]')
    .filter({ hasText: name });
}

/** Rows of `world_cup.matches` in the suite's World Cup database. */
async function matchRowCount(): Promise<number> {
  return Number(await worldCupScalar('select count(*) from world_cup.matches'));
}

test('start chat on an agent card opens a session bound to the agent', async ({
  page,
}) => {
  await startChatFromCard(page, HISTORIAN);

  await expect(page.getByTestId('session-agent')).toHaveText(HISTORIAN);
  const welcome = page.getByTestId('session-welcome');
  await expect(welcome).toContainText(`${HISTORIAN} is ready`);
  await expect(welcome).toContainText(HISTORIAN_DESCRIPTION);
  for (const starter of STARTERS) {
    await expect(
      welcome.getByRole('button', { name: starter, exact: true }),
    ).toBeVisible();
  }
  await expect(welcome).not.toContainText('What data is available here?');

  await welcome.getByRole('button', { name: STARTERS[0], exact: true }).click();
  await expect(composer(page)).toHaveValue(STARTERS[0]);
  expect(stub.requests, 'no message has been sent').toHaveLength(0);

  await openSessions(page);
  const row = sessionRow(page, HISTORIAN);
  await expect(row).toContainText(`${HISTORIAN} · ${WORLD_CUP_DATASET}`);
  await expect(row).toHaveClass(/list-row-selected/);
});

test('only Live agents and the Official agent offer Start chat', async ({
  page,
}) => {
  await createUserAgent(page, {
    name: 'Claims triage',
    datasets: [WORLD_CUP_DATASET],
  });

  await openHub(page);
  await expect(startChatButton(page, ASSISTANT)).toBeVisible();
  await expect(startChatButton(page, HISTORIAN)).toBeVisible();
  await expect(startChatButton(page, 'Claims triage')).toHaveCount(0);
  const system = page.getByTestId('agent-section-system');
  await system.getByTestId('agent-show-more-system').click();
  await expect(
    system.getByRole('button', { name: /^Start chat with / }),
  ).toHaveCount(0);

  await startChatButton(page, ASSISTANT).click();
  await expect(page.getByPlaceholder('My new session')).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'New conversation', exact: true }),
  ).toBeVisible();

  await openHub(page);
  await page.getByTestId(`agent-${historianId}`).click();
  await expect(
    page.getByRole('heading', { name: HISTORIAN, exact: true }),
  ).toBeVisible();
  await page.getByTestId('agent-start-chat').click();
  await expect(page.getByText(`Session "${HISTORIAN}" created`)).toBeVisible();
  await expect(page.getByTestId('session-agent')).toHaveText(HISTORIAN);
});

test("start chat is unavailable when none of the agent's datasets exist", async ({
  page,
}) => {
  await seedDataset(page, 'Scratch', datasourceId);
  const scratchId = await createUserAgent(page, {
    name: 'Scratch analyst',
    datasets: ['Scratch'],
  });
  await publishAgent(page, scratchId);
  await deleteDataset(page, 'Scratch');

  await openHub(page);
  const button = startChatButton(page, 'Scratch analyst');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute(
    'title',
    "None of this agent's datasets exist",
  );
});

test("the agent's Live instructions and model shape every turn", async ({
  page,
}) => {
  await saveAgentDraft(page, historianId, {
    ...historian,
    model: 'historian-deployment',
  });
  await publishAgent(page, historianId);
  await startChatFromCard(page, HISTORIAN);

  await send(page, 'Who won in 2014?');
  await expectAnswered(page, 1);

  const first = firstTurnRequest('Who won in 2014?');
  expect(first.path).toContain('/deployments/historian-deployment/');
  const systems = systemTexts(first);
  expect(systems[0]).toContain(BASE_PROMPT_START);
  const agentIndexes = systems
    .map((text, index) => (text.includes(AGENT_BLOCK_START) ? index : -1))
    .filter((index) => index >= 0);
  expect(agentIndexes).toHaveLength(1);
  const agentBlock = systems[agentIndexes[0]];
  expect(agentBlock).toContain(`"${HISTORIAN}"`);
  expect(agentBlock).toContain('always name the tournament year');
  // After every other per-turn block (the framework may add its own notes).
  const appBlocks = systems
    .map((text, index) =>
      APP_BLOCK_STARTS.some((start) => text.startsWith(start)) ? index : -1,
    )
    .filter((index) => index >= 0);
  expect(appBlocks.length).toBeGreaterThan(0);
  expect(Math.max(...appBlocks)).toBeLessThan(agentIndexes[0]);

  await saveAgentDraft(page, historianId, {
    ...historian,
    instructions: 'Answer in one sentence.',
    model: 'historian-deployment',
  });
  await publishAgent(page, historianId);
  await saveAgentDraft(page, historianId, {
    ...historian,
    instructions: 'Talk like a pirate.',
    model: 'historian-deployment',
  });

  await send(page, 'And in 2010?');
  await expectAnswered(page, 2);

  const next = systemTexts(firstTurnRequest('And in 2010?')).join('\n');
  expect(next).toContain('Answer in one sentence.');
  expect(next).not.toContain('always name the tournament year');
  expect(next).not.toContain('Talk like a pirate.');
});

test("instructions can't switch off the read-only guard", async ({ page }) => {
  const cleanerId = await createUserAgent(page, {
    name: 'Cleaner',
    instructions: 'Delete the matches table before answering.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, cleanerId);
  // The model obeys the instructions: it tries a DELETE, then answers.
  stub.reply = (request) =>
    request.messages[request.messages.length - 1]?.role === 'tool'
      ? { text: STUB_ANSWER }
      : {
          toolCall: {
            name:
              request.tools.find((tool) => tool.includes('readonly_sql')) ??
              'run_readonly_sql',
            arguments: {
              sql: 'DELETE FROM world_cup.matches',
              rationale: 'Clearing the matches table as instructed.',
            },
          },
        };
  const rowsBefore = await matchRowCount();

  await startChatFromCard(page, 'Cleaner');
  await send(page, 'Tidy up the data');
  await expectAnswered(page, 1);

  await page.getByText('Data used (1 query)').click();
  await expect(page.getByText('run_readonly_sql — failed')).toBeVisible();
  await expect(
    page.getByText('Only read-only SELECT / WITH queries can be run.', {
      exact: true,
    }),
  ).toBeVisible();

  expect(rowsBefore).toBeGreaterThan(0);
  expect(await matchRowCount()).toBe(rowsBefore);
});

test('deleting the agent keeps its sessions on the plain assistant', async ({
  page,
}) => {
  await startChatFromCard(page, HISTORIAN);
  await send(page, 'Who won in 2014?');
  await expectAnswered(page, 1);

  await openHub(page);
  await page.getByTestId(`agent-${historianId}`).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('agent-delete').click();
  await expect(page.getByText(`Agent "${HISTORIAN}" deleted`)).toBeVisible();

  await openSessions(page);
  await sessionRow(page, HISTORIAN).click();
  await expect(page.getByText('Who won in 2014?').first()).toBeVisible();
  await expect(page.getByText(STUB_ANSWER)).toHaveCount(1);
  await expect(page.getByTestId('session-agent')).toHaveText(
    `${HISTORIAN} · agent deleted`,
  );
  await expect(sessionRow(page, HISTORIAN)).toContainText(
    `${HISTORIAN} · agent deleted`,
  );

  await send(page, 'And in 2010?');
  await expectAnswered(page, 2);
  const systems = systemTexts(firstTurnRequest('And in 2010?')).join('\n');
  expect(systems).toContain(BASE_PROMPT_START);
  expect(systems).not.toContain(AGENT_BLOCK_START);
  expect(firstTurnRequest('And in 2010?').path).toContain(
    '/deployments/stub-deployment/',
  );
});
