import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { runWorkflow } from './helpers/runs-api';
import { runAnswer, runQuestionInTab } from './helpers/run-ui';
import {
  UserAgentInput,
  createUserAgent,
  publishAgent,
  saveLenaiSettings,
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
 * specs/capabilities/agent-answers/spec.md. Agents are a library with no Run:
 * the workflow this spec runs is Insights Analyst (`answer-business-question`),
 * whose model request equals a chat turn's. The model is a local
 * OpenAI-compatible stub that records what the backend sends it.
 */

const HISTORIAN = 'Cup historian';
const HISTORIAN_DESCRIPTION = 'Answers questions about World Cup history';
const HISTORIAN_INSTRUCTIONS =
  'Answer as a football historian and always name the tournament year.';
const STARTERS = ['Who won in 2014?', 'Which country hosted in 2002?'];
const BASE_PROMPT_START = 'You are the Questions to Insights assistant';

let stub: LlmStub;
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
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
  historianId = await createUserAgent(page, historian);
  await publishAgent(page, historianId);
});

test.afterEach(async () => {
  await stub.close();
});

async function openHub(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agent personas', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agent personas', exact: true }),
  ).toBeVisible();
}

async function openWorkflows(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'User journeys', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'User journeys', exact: true }),
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

/** Rows of `world_cup.matches` in the suite's World Cup database. */
async function matchRowCount(): Promise<number> {
  return Number(await worldCupScalar('select count(*) from world_cup.matches'));
}

test('only Insights Analyst can be run, and no agent page offers a chat', async ({
  page,
}) => {
  await createUserAgent(page, {
    name: 'Claims triage',
    datasets: [WORLD_CUP_DATASET],
  });

  // Given a Live user agent and a draft one, Then Workflows lists only v2.
  await openWorkflows(page);
  await expect(
    page.getByTestId('workflow-answer-business-question'),
  ).toBeVisible();
  await expect(page.getByTestId('workflow-agent:assistant')).toHaveCount(0);
  await expect(page.getByTestId(`workflow-agent:${historianId}`)).toHaveCount(
    0,
  );
  await expect(page.getByText(HISTORIAN)).toHaveCount(0);
  await expect(page.getByText('Claims triage')).toHaveCount(0);

  // And no agent card offers a chat.
  await openHub(page);
  await expect(page.getByTestId(`agent-card-${historianId}`)).toBeVisible();
  // Every card shows: the hub has no Show more (agents-evals R3).
  await expect(page.getByTestId('agent-card-sql-fixer')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Start chat with / }),
  ).toHaveCount(0);
});

test("an Answer a Business Question run can't write: the read-only guard rejects a DELETE", async ({
  page,
}) => {
  // The model tries a DELETE, then answers.
  stub.reply = (request) =>
    request.messages[request.messages.length - 1]?.role === 'tool'
      ? { text: STUB_ANSWER }
      : {
          toolCall: {
            name:
              request.tools.find((tool) => tool.endsWith('run_readonly_sql')) ??
              'run_readonly_sql',
            arguments: {
              sql: 'DELETE FROM world_cup.matches',
              rationale: 'Clearing the matches table.',
            },
          },
        };
  const rowsBefore = await matchRowCount();

  await runQuestionInTab(page, 'Tidy up the data', WORLD_CUP_DATASET);
  await expect(runAnswer(page)).toContainText(STUB_ANSWER);

  // No query succeeded, so Validate sent Analyse back once (workflows R27):
  // the DELETE was tried, and refused, in both attempts.
  await expect(page.getByTestId('query-coverage-chip')).toHaveText([
    'Failed',
    'Failed',
  ]);
  for (const index of [0, 1]) {
    await page.getByTestId(`query-row-${index}`).click();
    await expect(page.getByTestId('query-inspector-position')).toHaveText(
      `Source ${index + 1} of 2`,
    );
    await expect(
      page
        .getByTestId('query-inspector')
        .getByText('Only read-only SELECT / WITH queries can be run.', {
          exact: true,
        }),
    ).toBeVisible();
  }
  await page.getByTestId('query-inspector-close').click();

  expect(rowsBefore).toBeGreaterThan(0);
  expect(await matchRowCount()).toBe(rowsBefore);
});

test('an Answer a Business Question run runs v2 on every question', async ({
  page,
}) => {
  // Its five tools and the framework's skill tools (agents.md 2.11, 3.9).
  const V2_TOOLS = [
    'list_entities',
    'describe_entity',
    'sample_rows',
    'run_readonly_sql',
    'ask_clarification',
    'explore_result',
    'skill',
    'skill_search',
    'skill_read',
  ];

  for (const question of ['How many matches are there?', 'And in 2014?']) {
    const result = await runWorkflow(page, 'answer-business-question', {
      question,
      datasets: [WORLD_CUP_DATASET],
      approveSteps: false,
    });
    expect(result.status, result.body).toBe(200);
    expect(result.text).toContain(STUB_ANSWER);
    // The run ran v2 (R61): its prompt and only its own tools.
    const request = firstTurnRequest(question);
    expect(systemTexts(request)[0]).toContain('You are Questions to Insights');
    expect(systemTexts(request).join('\n')).not.toContain(BASE_PROMPT_START);
    expect([...request.tools].sort()).toEqual([...V2_TOOLS].sort());
  }
});
