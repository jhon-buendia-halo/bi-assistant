import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { runWorkflow } from './helpers/runs-api';
import {
  fillRun,
  openRunTab,
  openWorkflowPage,
  railItem,
  runAnswer,
} from './helpers/run-ui';
import {
  UserAgentInput,
  createSkill,
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
 * specs/capabilities/sessions-chat/spec.md, through the agents' workflow runs
 * (a run's model request equals a chat turn's). The model is a local
 * OpenAI-compatible stub that records what the backend sends it.
 */

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
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Agents', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Agents', exact: true }),
  ).toBeVisible();
}

async function openWorkflows(page: Page): Promise<void> {
  await page
    .getByRole('complementary', { name: 'Navigation rail' })
    .getByRole('button', { name: 'Workflows', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Workflows', exact: true }),
  ).toBeVisible();
}

/** Runs the agent's workflow (`agent:<id>`) on `question`, expecting it to end in `done`. */
async function runAgent(page: Page, id: string, question: string): Promise<void> {
  const result = await runWorkflow(page, `agent:${id}`, { question });
  expect(result.status, result.body).toBe(200);
  expect(result.error, result.body).toBeUndefined();
  expect(result.text).toContain(STUB_ANSWER);
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

test('only the workflows of Live agents and the Assistant can be run, and no agent page offers a chat', async ({
  page,
}) => {
  await createUserAgent(page, {
    name: 'Claims triage',
    datasets: [WORLD_CUP_DATASET],
  });

  await openWorkflows(page);
  await expect(page.getByTestId('workflow-agent:assistant')).toBeVisible();
  await expect(page.getByTestId(`workflow-agent:${historianId}`)).toBeVisible();
  await expect(page.getByText('Claims triage')).toHaveCount(0);

  await openHub(page);
  await expect(page.getByTestId(`agent-card-${historianId}`)).toBeVisible();
  const system = page.getByTestId('agent-section-system');
  await system.getByTestId('agent-show-more-system').click();
  await expect(
    page.getByRole('button', { name: /^Start chat with / }),
  ).toHaveCount(0);

  await openWorkflowPage(page, `agent:${historianId}`, HISTORIAN);
  await expect(page.getByTestId('workflow-execute')).toBeVisible();
  await openRunTab(page);
  // A user agent runs over its own datasets: the Run tab has a question only.
  await expect(page.getByTestId('workflow-input-question')).toBeVisible();
  await expect(page.getByTestId('workflow-input-datasets')).toHaveCount(0);
});

test("a run is unavailable when none of the agent's datasets exist", async ({
  page,
}) => {
  await seedDataset(page, 'Scratch', datasourceId);
  const scratchId = await createUserAgent(page, {
    name: 'Scratch analyst',
    datasets: ['Scratch'],
  });
  await publishAgent(page, scratchId);
  await deleteDataset(page, 'Scratch');

  await openWorkflowPage(page, `agent:${scratchId}`, 'Scratch analyst');
  await openRunTab(page);
  const run = page.getByTestId('workflow-run');
  await expect(run).toBeDisabled();
  await expect(run).toHaveAttribute('title', "None of this agent's datasets exist");
  await expect(page.getByTestId('workflow-run-requirement')).toHaveText(
    "None of this agent's datasets exist",
  );
});

test("the agent's Live instructions and model shape every run", async ({
  page,
}) => {
  await saveAgentDraft(page, historianId, {
    ...historian,
    model: 'historian-deployment',
  });
  await publishAgent(page, historianId);

  await runAgent(page, historianId, 'Who won in 2014?');

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

  await runAgent(page, historianId, 'And in 2010?');

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

  await openWorkflowPage(page, `agent:${cleanerId}`, 'Cleaner');
  await openRunTab(page);
  await fillRun(page, 'Tidy up the data');
  await page.getByTestId('workflow-run').click();
  await expect(runAnswer(page)).toContainText(STUB_ANSWER);

  await runAnswer(page).getByText('Data used (1 query)').click();
  await expect(page.getByText('run_readonly_sql — failed')).toBeVisible();
  await expect(
    page.getByText('Only read-only SELECT / WITH queries can be run.', {
      exact: true,
    }),
  ).toBeVisible();

  expect(rowsBefore).toBeGreaterThan(0);
  expect(await matchRowCount()).toBe(rowsBefore);
});

test('deleting the agent keeps its runs, readable from Runs', async ({
  page,
}) => {
  await runAgent(page, historianId, 'Who won in 2014?');

  await openHub(page);
  await page.getByTestId(`agent-${historianId}`).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId('agent-delete').click();
  await expect(page.getByText(`Agent "${HISTORIAN}" deleted`)).toBeVisible();

  await railItem(page, 'Runs').click();
  const row = page
    .getByTestId('row-run-title')
    .filter({ hasText: 'Who won in 2014?' });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByTestId('run-detail-answer')).toContainText(STUB_ANSWER);
  await expect(page.getByTestId('run-detail-status')).toHaveText('Run succeeded');
});

/** Skill names in the `<available_skills>` catalog of a request. */
function catalogSkills(request: StubRequest): string[] {
  const catalog = systemTexts(request)
    .join('\n')
    .match(/<available_skills>[\s\S]*?<\/available_skills>/);
  if (!catalog) return [];
  return [...catalog[0].matchAll(/<name>([^<]+)<\/name>/g)].map((m) => m[1]);
}

test("the agent's tool selection and skills apply to every run", async ({
  page,
}) => {
  await createSkill(page, {
    name: 'fiscal-calendar',
    description: 'Use when a question names a fiscal year.',
    body: 'Our fiscal year starts on 1 July.',
  });
  // "Offers only Sample rows and has the skill": both are links (ADR-0024).
  const financeId = await createUserAgent(page, {
    name: 'Finance helper',
    instructions:
      'Use [[skill:fiscal-calendar]] for dates and [[tool:sample_rows]] to peek at data.',
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, financeId);

  for (const question of ['Who won in 2014?', 'And in 2010?']) {
    await runAgent(page, financeId, question);
    const request = firstTurnRequest(question);
    expect(request.tools).toContain('sample_rows');
    for (const tool of [
      'ask_clarification',
      'create_visual',
      'update_visual',
    ]) {
      expect(request.tools, `${question}: ${tool}`).not.toContain(tool);
    }
    expect(catalogSkills(request)).toContain('fiscal-calendar');
  }
});

test('a Questions to Insights v2 run runs v2 on every question', async ({
  page,
}) => {
  const V2_TOOLS = ['list_entities', 'describe_entity', 'run_readonly_sql'];

  for (const question of ['How many matches are there?', 'And in 2014?']) {
    const result = await runWorkflow(page, 'qti-v2-turn', {
      question,
      datasets: [WORLD_CUP_DATASET],
    });
    expect(result.status, result.body).toBe(200);
    expect(result.text).toContain(STUB_ANSWER);
    // The run ran v2 (R61): its prompt and only its three data tools.
    const request = firstTurnRequest(question);
    expect(systemTexts(request)[0]).toContain('You are Questions to Insights v2');
    expect(systemTexts(request).join('\n')).not.toContain(BASE_PROMPT_START);
    expect([...request.tools].sort()).toEqual([...V2_TOOLS].sort());
  }
});
