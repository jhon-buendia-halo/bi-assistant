import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { apiFetch, apiJson } from './helpers/api';
import { RunResult, V2_WORKFLOW_ID, runWorkflow } from './helpers/runs-api';
import { saveLenaiSettings, seedWorldCupDataset } from './helpers/agents-api';
import {
  LlmStub,
  STUB_ANSWER,
  StubReply,
  StubRequest,
  messageText,
  startLlmStub,
  systemTexts,
  turnRequests,
} from './helpers/llm-stub';
import { worldCupKey } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Agent panel" in specs/capabilities/agent-panel/spec.md
 * (roadmap 1.14.18, BA-231), through runs of Questions to Insights v2
 * (`qti-v2-turn`, the one runnable workflow): a run's panel items and its
 * code-defined steps are read from the stream and the stored run (api.md
 * 119, 121, 125-126, 130). The model is the recording OpenAI-compatible
 * stub: each scenario scripts the tool calls of its turn (`run_readonly_sql`).
 */

/** Marks the designer's (non-streamed) request: it carries its skill. */
const DESIGNER_SKILL_TAG = '<interactive-visuals-skill>';
const VISUAL_TITLE = 'Goals per team';
const STAGE_SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
const STAGE_RATIONALE = 'Count the matches per stage.';
/** The designer's spec-mode answer over STAGE_SQL's columns. */
const VISUAL_SPEC = {
  title: VISUAL_TITLE,
  description: 'Matches played at each stage of the tournament.',
  spec: {
    spec: 1,
    chart: { form: 'bar', select: ['stage', 'matches'], x: 'stage', y: 'matches' },
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

function turnOf(turns: TurnScript[], request: StubRequest): TurnScript | undefined {
  const { question } = position(request);
  return turns.find((turn) => question.includes(turn.question));
}

/** Scripts every turn by its latest user message (never the whole history). */
function script(turns: TurnScript[]): void {
  stub.reply = (request): StubReply => {
    if (systemTexts(request).some((text) => text.includes(DESIGNER_SKILL_TAG))) {
      return { text: JSON.stringify(VISUAL_SPEC) };
    }
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
  workflow?: {
    phases: { number: number; title: string }[];
    current: number | null;
    done: number[];
    source: string;
  };
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

/** A run of Questions to Insights v2 on `question` over the World Cup dataset. */
function runV2On(page: Page, question: string) {
  return runOk(page, V2_WORKFLOW_ID, {
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

/** Its steps in catalogue order: Clarify is the other way after Plan. */
const V2_STEP_TITLES = [
  'Receive question',
  'Load catalog',
  'Plan',
  'Clarify',
  'Analyse',
  'Validate',
  'Write answer',
  'Wrap up',
];

// --------------------------------------------------------------- scenarios

test("a visual generated on a v2 answer is the run's panel item, kept on reopening and downloaded only through its own route", async ({
  page,
}) => {
  // Given a Questions to Insights v2 run with an answer.
  script([STAGE_TURN]);
  const { run } = await runV2On(page, STAGE_TURN.question);

  // When I generate an interactive visual from its answer (api.md 130).
  const generated = await apiJson<{
    run: RunDoc;
    visualization: { id: string; title: string };
  }>(page, 'POST', runRoute(run.id, 'visualizations'), {});
  const visual = generated.visualization;
  expect(visual.title).toBe(VISUAL_TITLE);

  // Then the run holds one item for the visual (R10).
  expect(
    generated.run.panelItems.map((item) => [item.id, item.kind, item.title]),
  ).toEqual([[`visual:${visual.id}`, 'visual', VISUAL_TITLE]]);

  // And the stored run reads it back after a reload.
  await page.reload();
  const stored = await apiJson<RunDoc>(page, 'GET', `/workflow-runs/${run.id}`);
  expect(stored.panelItems.map((item) => item.id)).toEqual([
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

test("a v2 run's workflow never appears among its panel items", async ({
  page,
}) => {
  // Given a Questions to Insights v2 run, whose steps are its workflow.
  script([STAGE_TURN]);
  const { run } = await runV2On(page, STAGE_TURN.question);

  // Then its steps are kept as the run's workflow, not as a panel item (R10).
  expect(run.workflow?.phases.map((phase) => phase.title)).toEqual(
    V2_STEP_TITLES,
  );
  expect(run.panelItems).toEqual([]);
  const res = await apiFetch(
    page,
    'GET',
    runRoute(run.id, 'panel-items/phases/file'),
  );
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('Panel item \\"phases\\" not found');
});

// ------------------------------------------- Questions to Insights v2 (R8a)

/** The steps a clear question runs, in order (Clarify is skipped). */
const V2_STEPS = [
  'receive-question',
  'load-catalog',
  'plan',
  'analyse',
  'validate',
  'write-answer',
  'wrap-up',
];
// Its five tools and the framework's skill tools (agents.md 2.11, 3.9).
const V2_TOOLS = [
  'list_entities',
  'describe_entity',
  'sample_rows',
  'run_readonly_sql',
  'ask_clarification',
  'skill',
  'skill_search',
  'skill_read',
];
const V2_QUESTION = 'How many matches were played in 2018?';
const V2_ANSWER = 'There were 64 matches.';

test('Questions to Insights v2 shows its code-defined steps advancing', async ({
  page,
}) => {
  const turn: TurnScript = {
    question: V2_QUESTION,
    calls: [
      {
        name: 'run_readonly_sql',
        arguments: {
          sql: `SELECT COUNT(*) AS matches FROM ${worldCupKey('matches')}`,
          rationale: 'Count the matches.',
        },
      },
    ],
    answer: V2_ANSWER,
  };
  script([turn]);
  const { result, run } = await runV2On(page, V2_QUESTION);

  // Every step runs, in order, and ends done (R19).
  for (const id of V2_STEPS) {
    expect(stepStatuses(result, id), id).toEqual(['running', 'success']);
  }
  const startOrder = result.events
    .filter((event) => event.type === 'step' && event.status === 'running')
    .map((event) => String(event.id));
  expect(startOrder).toEqual(V2_STEPS);
  expect(result.text).toContain(V2_ANSWER);

  // The run ran v2 with its own tools, never update_workflow (R8a), and
  // the SQL ran for real.
  const request = turnRequests(stub, V2_QUESTION)[0];
  expect([...request.tools].sort()).toEqual([...V2_TOOLS].sort());
  expect(toolResultsOf(V2_QUESTION).join('\n')).toContain('matches');

  expect(run.workflow?.source).toBe('workflow');
  expect(run.workflow?.phases.map((phase) => phase.title)).toEqual(
    V2_STEP_TITLES,
  );
  // Every step but Clarify (4), the branch a clear question skips.
  expect(run.workflow?.done).toEqual([1, 2, 3, 5, 6, 7, 8]);
  expect(stepStatuses(result, 'clarify').at(-1)).toBe('skipped');
});

test('a failing step of the v2 workflow is marked failed', async ({ page }) => {
  // The stub fails every model call: the connection drops before a reply.
  stub.hold = (request) =>
    request.stream ? Promise.reject(new Error('model down')) : undefined;

  // The provider retries a dropped connection before the step fails.
  const result = await runWorkflow(page, V2_WORKFLOW_ID, {
    question: V2_QUESTION,
    datasets: [WORLD_CUP_DATASET],
  });
  expect(result.status).toBe(200);
  expect(stepStatuses(result, 'receive-question').at(-1)).toBe('success');
  expect(stepStatuses(result, 'load-catalog').at(-1)).toBe('success');
  expect(stepStatuses(result, 'plan').at(-1)).toBe('success');
  expect(stepStatuses(result, 'analyse').at(-1)).toBe('failed');
  expect(stepStatuses(result, 'validate').at(-1)).toBe('skipped');
  expect(stepStatuses(result, 'write-answer').at(-1)).toBe('skipped');
  expect(stepStatuses(result, 'wrap-up').at(-1)).toBe('skipped');
  expect(turnRequests(stub, V2_QUESTION).length).toBeGreaterThan(0);

  // The run ends with the step's error (R8a, agent-answers R61).
  const last = result.events[result.events.length - 1];
  expect(last.type).toBe('error');
  expect(String(last.content)).toBeTruthy();
  expect(result.error).toBe(String(last.content));
});
