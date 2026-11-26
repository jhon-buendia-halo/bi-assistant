import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { apiFetch, apiJson } from './helpers/api';
import { ASK_STEP_ID, ASK_WORKFLOW_ID, RunResult, runWorkflow } from './helpers/runs-api';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import { seedRunVisual } from './helpers/past-chats';
import {
  LlmStub,
  STUB_ANSWER,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
  turnRequests,
} from './helpers/llm-stub';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Agent panel" in specs/capabilities/agent-panel/spec.md
 * (roadmap 1.14.18, BA-231), through runs of Answer a Business Question
 * (Avery + Michael): a run's panel items and its code-defined step are read
 * from the stream and the stored run (api.md 119, 121, 125-126, 130). The
 * model is the recording OpenAI-compatible stub: it moves Avery itself
 * (helpers/v2-steps.ts `averyMove`), and each scenario scripts the tool calls
 * of Michael's turn (`run_readonly_sql`).
 */

const VISUAL_TITLE = 'Goals per team';
const STAGE_SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
const STAGE_RATIONALE = 'Count the matches per stage.';
/** The spec-mode visual an earlier version designed over STAGE_SQL's columns. */
const VISUAL_SPEC = {
  title: VISUAL_TITLE,
  description: 'Matches played at each stage of the tournament.',
  spec: {
    spec: 1,
    chart: {
      form: 'bar',
      select: ['stage', 'matches'],
      x: 'stage',
      y: 'matches',
    },
  },
};

let stub: LlmStub;

test.beforeEach(async ({ page }) => {
  // Background: the LLM stub is the provider, World Cup data is loaded.
  stub = await startLlmStub();
  await seedWorldCupDataset(page);
  await saveLenaiSettings(page, stub.baseUrl);
});

test.afterEach(async () => {
  await stub.close();
});

// ---------------------------------------------------------------- scripting

interface ToolCallScript {
  name: string;
  arguments: Record<string, unknown>;
}

interface TurnScript {
  /** Text the turn's latest user message contains. */
  question: string;
  /** The tool calls the model makes, one per model request, in order. */
  calls: ToolCallScript[];
  /** The text the model answers once the calls are done. */
  answer: string;
}

/** Index of the latest user message of a request. */
function lastUserIndex(request: StubRequest): number {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    if (request.messages[i].role === 'user') return i;
  }
  return -1;
}

/** The latest user message's text and how many tool results follow it. */
function position(request: StubRequest): { question: string; step: number } {
  const index = lastUserIndex(request);
  if (index < 0) return { question: '', step: 0 };
  return {
    question: messageText(request.messages[index]),
    step: request.messages
      .slice(index + 1)
      .filter((message) => message.role === 'tool').length,
  };
}

function turnOf(
  turns: TurnScript[],
  request: StubRequest,
): TurnScript | undefined {
  const { question } = position(request);
  return turns.find((turn) => question.includes(turn.question));
}

/** Scripts every turn by its latest user message (never the whole history). */
function script(turns: TurnScript[]): void {
  stub.reply = (request): StubReply => {
    if (!request.stream) return { text: STUB_ANSWER };
    const turn = turnOf(turns, request);
    if (!turn) return { text: STUB_ANSWER };
    const { step } = position(request);
    if (step < turn.calls.length) {
      const call = turn.calls[step];
      const name =
        request.tools.find((tool) => tool === call.name) ??
        request.tools.find((tool) => tool.endsWith(call.name)) ??
        call.name;
      return { toolCall: { name, arguments: call.arguments } };
    }
    return { text: turn.answer };
  };
}

/** The tool results the model received in the last request of a turn. */
function toolResultsOf(question: string): string[] {
  const request = turnRequests(stub, question).at(-1);
  expect(request, `a streamed call for "${question}"`).toBeDefined();
  const index = lastUserIndex(request!);
  return request!.messages
    .slice(index + 1)
    .filter((message) => message.role === 'tool')
    .map(messageText);
}

// ------------------------------------------------------------------ runs

interface RunDoc {
  id: string;
  panelItems: { id: string; kind: string; title: string; visualId?: string }[];
  visualizations?: { id: string; title: string }[];
  /** Its code-defined steps, as the run stored them. */
  steps?: { id: string; title: string; status: string }[];
  /** Which of them ran (api.md 2.1): 1-based numbers. */
  workflowState?: { current: number | null; done: number[] };
}

/** Runs the workflow `workflowId` and returns its stored run, expecting `done`. */
async function runOk(
  page: Page,
  workflowId: string,
  input: Record<string, string | number | boolean | string[]>,
): Promise<{ result: RunResult; run: RunDoc }> {
  const result = await runWorkflow(page, workflowId, input);
  expect(result.status, result.body).toBe(200);
  expect(result.error, result.body).toBeUndefined();
  expect(result.run, result.body).toBeDefined();
  return { result, run: result.run as unknown as RunDoc };
}

/** A run of Answer a Business Question (Avery + Michael) on `question` over the World Cup dataset. */
function runAskOn(page: Page, question: string) {
  return runOk(page, ASK_WORKFLOW_ID, {
    question,
    datasets: [WORLD_CUP_DATASET],
  });
}

function runRoute(runId: string, rest: string): string {
  return `/workflow-runs/${runId}/${rest}`;
}

/** The step events the stream sent for one step, in order. */
function stepStatuses(result: RunResult, id: string): string[] {
  return result.events
    .filter((event) => event.type === 'step' && event.id === id)
    .map((event) => String(event.status));
}

const STAGE_TURN: TurnScript = {
  question: 'How many matches were played at each stage?',
  calls: [
    {
      name: 'run_readonly_sql',
      arguments: { sql: STAGE_SQL, rationale: STAGE_RATIONALE },
    },
  ],
  answer: 'The group stage holds most of the matches.',
};

/** Its one step: Avery's turn, Michael's included. */
const ASK_STEP_TITLES = ['Orchestrate'];

// --------------------------------------------------------------- scenarios

test("a stored visual of a run is the run's panel item, kept on reopening and downloaded only through its own route", async ({
  appDataDir,
  page,
}) => {
  // Given an Answer a Business Question (Avery + Michael) run with an answer.
  script([STAGE_TURN]);
  const { run } = await runAskOn(page, STAGE_TURN.question);

  // And a visual an earlier version designed from its answer (the designer is
  // gone; the stored visual stays viewable).
  const visual = seedRunVisual(appDataDir, run.id, {
    title: VISUAL_TITLE,
    description: VISUAL_SPEC.description,
    spec: VISUAL_SPEC.spec,
  });
  expect(visual.title).toBe(VISUAL_TITLE);

  // Then the run holds one item for the visual (R10).
  const stored = await apiJson<RunDoc>(page, 'GET', `/workflow-runs/${run.id}`);
  expect(
    stored.panelItems.map((item) => [item.id, item.kind, item.title]),
  ).toEqual([[`visual:${visual.id}`, 'visual', VISUAL_TITLE]]);

  // And the stored run reads it back after a reload.
  await page.reload();
  const reloaded = await apiJson<RunDoc>(
    page,
    'GET',
    `/workflow-runs/${run.id}`,
  );
  expect(reloaded.panelItems.map((item) => item.id)).toEqual([
    `visual:${visual.id}`,
  ]);

  // A visual downloads through its own route, never as a panel item (api.md 126).
  const res = await apiFetch(
    page,
    'GET',
    runRoute(run.id, `panel-items/visual:${visual.id}/download`),
  );
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain(
    `Panel item \\"visual:${visual.id}\\" can't be downloaded`,
  );
  const zip = await apiFetch(
    page,
    'GET',
    runRoute(run.id, `visualizations/${visual.id}/download`),
  );
  expect(zip.status()).toBe(200);
});

test("a run's workflow never appears among its panel items", async ({
  page,
}) => {
  // Given an Answer a Business Question (Avery + Michael) run, whose step is its workflow.
  script([STAGE_TURN]);
  const { run } = await runAskOn(page, STAGE_TURN.question);

  // Then its steps are kept as the run's workflow, not as a panel item (R10).
  expect(run.steps?.map((step) => step.title)).toEqual(ASK_STEP_TITLES);
  expect(run.panelItems).toEqual([]);
  const res = await apiFetch(
    page,
    'GET',
    runRoute(run.id, 'panel-items/phases/file'),
  );
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('Panel item \\"phases\\" not found');
});

// ------------------------------- Answer a Business Question (Avery + Michael) (R8a)

// Michael's tools and the framework's skill tools (agents.md 2.11, 3.9).
const MICHAEL_TOOLS = [
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
const ASK_QUESTION = 'How many matches were played in 2018?';
const ASK_ANSWER = 'There were 64 matches.';

test('Answer a Business Question shows its code-defined step advancing', async ({
  page,
}) => {
  const turn: TurnScript = {
    question: ASK_QUESTION,
    calls: [
      {
        name: 'run_readonly_sql',
        arguments: {
          sql: `SELECT COUNT(*) AS matches FROM ${worldCupKey('matches')}`,
          rationale: 'Count the matches.',
        },
      },
    ],
    answer: ASK_ANSWER,
  };
  script([turn]);
  const { result, run } = await runAskOn(page, ASK_QUESTION);

  // Its one step runs and ends done (R19).
  expect(stepStatuses(result, ASK_STEP_ID)).toEqual(['running', 'success']);
  const startOrder = result.events
    .filter((event) => event.type === 'step' && event.status === 'running')
    .map((event) => String(event.id));
  expect(startOrder).toEqual([ASK_STEP_ID]);
  expect(result.text).toContain(ASK_ANSWER);

  // Avery briefed Michael through answer_from_data; Michael ran with his own
  // tools, never update_workflow (R8a), and the SQL ran for real.
  const avery = stub.requests.find((request) => request.avery);
  expect(avery?.tools).toContain('answer_from_data');
  const request = turnRequests(stub, ASK_QUESTION)[0];
  expect([...request.tools].sort()).toEqual([...MICHAEL_TOOLS].sort());
  expect(toolResultsOf(ASK_QUESTION).join('\n')).toContain('matches');

  expect(run.steps?.map((step) => [step.title, step.status])).toEqual([
    ['Orchestrate', 'success'],
  ]);
  expect(run.workflowState?.done).toEqual([1]);
});

test('a failing step of the workflow is marked failed', async ({ page }) => {
  // The stub fails every model call: the connection drops before a reply.
  stub.hold = (request) =>
    request.stream ? Promise.reject(new Error('model down')) : undefined;

  // The provider retries a dropped connection before the step fails.
  const result = await runWorkflow(page, ASK_WORKFLOW_ID, {
    question: ASK_QUESTION,
    datasets: [WORLD_CUP_DATASET],
  });
  expect(result.status).toBe(200);
  expect(stepStatuses(result, ASK_STEP_ID).at(-1)).toBe('failed');
  expect(
    stub.requests.filter((request) => request.avery).length,
  ).toBeGreaterThan(0);

  // The run ends with the step's error (R8a, agent-answers R61).
  const last = result.events[result.events.length - 1];
  expect(last.type).toBe('error');
  expect(String(last.content)).toBeTruthy();
  expect(result.error).toBe(String(last.content));
});
