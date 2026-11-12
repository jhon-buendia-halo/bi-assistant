import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.fixture';
import { WORLD_CUP_DATASET } from './helpers/app-actions';
import { apiFetch, apiJson } from './helpers/api';
import { RunResult, runWorkflow } from './helpers/runs-api';
import { fillRun, openRunTab, openWorkflowPage, runAnswer } from './helpers/run-ui';
import {
  createUserAgent,
  publishAgent,
  saveLenaiSettings,
  seedWorldCupDataset,
} from './helpers/agents-api';
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
import { worldCupKey, worldCupScalar } from './helpers/world-cup-db';

/**
 * Mirrors the Feature "Agent panel" in specs/capabilities/agent-panel/spec.md
 * (roadmap 1.14.18, BA-231), through workflow runs: a run's panel items,
 * phases and files are read from the stream and the stored run (api.md 119,
 * 121, 125-126), and its phases from the Run tab. The model is the recording
 * OpenAI-compatible stub: each scenario scripts the tool calls of its turn
 * (`show_in_panel`, `update_workflow`, `run_readonly_sql`).
 */

/** Marks the designer's (non-streamed) request: it carries its skill. */
const DESIGNER_SKILL_TAG = '<interactive-visuals-skill>';
const VISUAL_TITLE = 'Goals per team';
const STAGE_SQL = `SELECT stage, COUNT(*) AS matches FROM ${worldCupKey('matches')} GROUP BY stage`;
const STAGE_RATIONALE = 'Count the matches per stage.';
/** A table's default title: the rationale's first sentence (agents.md 3.11). */
const STAGE_TITLE = 'Count the matches per stage';
/** The designer's spec-mode answer over STAGE_SQL's columns. */
const VISUAL_SPEC = {
  title: VISUAL_TITLE,
  description: 'Matches played at each stage of the tournament.',
  spec: {
    spec: 1,
    chart: { form: 'bar', select: ['stage', 'matches'], x: 'stage', y: 'matches' },
  },
};

const FINDINGS_MD = '# Findings\n\nBrazil scored most.';
const SUMMARY_MD = '# Summary notes\n\nGermany reached the final.';

const WORKFLOW_AGENT = 'Process guide';
/** A user agent whose prompt has a `## Workflow` section (agent-panel R8). */
const WORKFLOW_INSTRUCTIONS = [
  'Guide the user through a short analysis of the World Cup data.',
  '',
  '## Workflow',
  '1. Understand: Tell me what you want to find out.',
  '2. Analyse — [[skill:curated-knowledge]]: Review the queries I run.',
  '3. Report: Review the report and approve it.',
  '',
  '## Style',
  'Answer briefly.',
].join('\n');
const STEPS = ['Understand', 'Analyse', 'Report'];
const FREE_AGENT = 'Free guide';

const ERR_RENAME =
  'Your ## Workflow section defines the steps; set their status instead';

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

/** Whether `request` asks for the final answer of the turn `question`. */
function isFinalRequest(
  turns: TurnScript[],
  request: StubRequest,
  question: string,
): boolean {
  const turn = turnOf(turns, request);
  return (
    request.stream &&
    turn?.question === question &&
    position(request).step >= turn.calls.length
  );
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

/** A promise a test resolves by hand. */
function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/** Holds the final answer of `question` until the returned release is called. */
function holdFinalAnswer(turns: TurnScript[], question: string): () => void {
  const held = gate();
  stub.hold = (request) =>
    isFinalRequest(turns, request, question) ? held.promise : undefined;
  return () => {
    held.release();
    stub.hold = undefined;
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
    phases: { number: number; title: string; skill?: string; action?: string }[];
    current: number | null;
    done: number[];
    source: string;
    note?: string;
    waiting?: boolean;
    failed?: number;
  };
}

/** Runs the workflow `workflowId` and returns its stored run, expecting `done`. */
async function runOk(
  page: Page,
  workflowId: string,
  input: Record<string, string | number | boolean | string[]>,
  fromRunId?: string,
): Promise<{ result: RunResult; run: RunDoc }> {
  const result = await runWorkflow(
    page,
    workflowId,
    input,
    fromRunId ? { fromRunId } : undefined,
  );
  expect(result.status, result.body).toBe(200);
  expect(result.error, result.body).toBeUndefined();
  expect(result.run, result.body).toBeDefined();
  return { result, run: result.run as unknown as RunDoc };
}

/** The Assistant's run on `question` over the World Cup dataset. */
function runAssistantOn(page: Page, question: string, fromRunId?: string) {
  return runOk(
    page,
    'agent:assistant',
    { question, datasets: [WORLD_CUP_DATASET] },
    fromRunId,
  );
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

/** Creates and publishes a user agent over the World Cup dataset. */
async function liveAgent(
  page: Page,
  name: string,
  instructions: string,
): Promise<string> {
  const id = await createUserAgent(page, {
    name,
    description: 'Walks you through an analysis',
    instructions,
    datasets: [WORLD_CUP_DATASET],
  });
  await publishAgent(page, id);
  return id;
}

/** Runs a user agent's workflow on `question`. */
function runAgentOn(page: Page, id: string, question: string) {
  return runOk(page, `agent:${id}`, { question });
}

const SHOW_FINDINGS: TurnScript = {
  question: 'Write up the findings',
  calls: [
    {
      name: 'show_in_panel',
      arguments: { kind: 'document', title: 'Findings', markdown: FINDINGS_MD },
    },
  ],
  answer: 'The findings are in the panel.',
};

const SHOW_TABLE: TurnScript = {
  question: 'Show me the top scorers as a table',
  calls: [
    {
      name: 'run_readonly_sql',
      arguments: { sql: STAGE_SQL, rationale: STAGE_RATIONALE },
    },
    { name: 'show_in_panel', arguments: { kind: 'table' } },
  ],
  answer: 'The table is in the panel.',
};

const GO_ON: TurnScript = {
  question: 'Go on',
  calls: [{ name: 'update_workflow', arguments: { current: 2, done: '1' } }],
  answer: 'We are analysing now.',
};

// --------------------------------------------------------------- scenarios

test('a composed document is a run panel item and downloads as Markdown', async ({
  page,
}) => {
  script([SHOW_FINDINGS]);
  const { result, run } = await runAssistantOn(page, SHOW_FINDINGS.question);

  // The item is announced while the run streams, before it ends (R12).
  const types = result.events.map((event) => event.type);
  expect(types.indexOf('panel-item')).toBeGreaterThan(-1);
  expect(types.indexOf('panel-item')).toBeLessThan(types.indexOf('done'));
  expect(result.text).toContain(SHOW_FINDINGS.answer);

  // The item is kept with the run (R10).
  expect(run.panelItems.map((item) => [item.kind, item.title])).toEqual([
    ['document', 'Findings'],
  ]);
  const itemId = run.panelItems[0].id;

  // R11, api.md 126: a document downloads as Markdown (the PDF is made by
  // the panel in the browser, which the run page has not got yet).
  const md = await apiFetch(
    page,
    'GET',
    runRoute(run.id, `panel-items/${itemId}/download?format=md`),
  );
  expect(md.status()).toBe(200);
  expect(md.headers()['content-disposition']).toContain('filename="findings.md"');
  expect(await md.text()).toBe(FINDINGS_MD);
});

test('a query result is a run table panel item and downloads as CSV', async ({
  page,
}) => {
  script([SHOW_TABLE]);
  const stages = Number(
    await worldCupScalar('select count(distinct stage) from world_cup.matches'),
  );
  expect(stages).toBeGreaterThan(1);

  const { run } = await runAssistantOn(page, SHOW_TABLE.question);
  expect(run.panelItems).toHaveLength(1);
  expect(run.panelItems[0]).toMatchObject({ kind: 'table', title: STAGE_TITLE });

  const csv = await apiFetch(
    page,
    'GET',
    runRoute(run.id, `panel-items/${run.panelItems[0].id}/download`),
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-disposition']).toMatch(/filename="[^"]+\.csv"/);
  const lines = (await csv.text()).trim().split(/\r?\n/);
  expect(lines[0]).toBe('stage,matches');
  expect(lines).toHaveLength(stages + 1);
});

test('a workspace file is a run panel item with a download', async ({ page }) => {
  const turn: TurnScript = {
    question: 'Show me the summary notes',
    calls: [
      {
        name: 'mastra_workspace_write_file',
        arguments: { path: 'notes/summary.md', content: SUMMARY_MD },
      },
      {
        name: 'show_in_panel',
        arguments: { kind: 'file', path: 'notes/summary.md' },
      },
    ],
    answer: 'The notes are in the panel.',
  };
  script([turn]);
  const { run } = await runAssistantOn(page, turn.question);

  // A `.md` file is shown under its base name (R3).
  const item = run.panelItems.find((entry) => entry.kind === 'file')!;
  expect(item).toMatchObject({ title: 'summary.md' });

  // api.md 125: the file's text as it is now in the run's workspace.
  const file = await apiJson<{ text: string; contentType: string }>(
    page,
    'GET',
    runRoute(run.id, `panel-items/${item.id}/file`),
  );
  expect(file.text).toBe(SUMMARY_MD);
  expect(file.contentType).toBe('text/markdown');

  // R11: a `.md` file downloads as its own bytes.
  const md = await apiFetch(
    page,
    'GET',
    runRoute(run.id, `panel-items/${item.id}/download?format=md`),
  );
  expect(md.headers()['content-disposition']).toContain('filename="summary.md"');
  expect(await md.text()).toBe(SUMMARY_MD);
});

test('an invalid path is refused and the run items do not change', async ({
  page,
}) => {
  const secrets: TurnScript = {
    question: 'Show me the findings and the secrets',
    calls: [
      ...SHOW_FINDINGS.calls,
      {
        name: 'show_in_panel',
        arguments: { kind: 'file', path: '../secrets.md' },
      },
    ],
    answer: 'I could not show that file.',
  };
  script([secrets]);
  const { result, run } = await runAssistantOn(page, secrets.question);

  // The run shows the failed step as it streams…
  expect(
    result.events.some(
      (event) =>
        event.type === 'tool-result' &&
        String(event.content).includes('Invalid file path'),
    ),
  ).toBe(true);
  // …the model receives the tool's exact error…
  expect(toolResultsOf(secrets.question).join('\n')).toContain(
    'Invalid file path \\"../secrets.md\\"',
  );
  expect(result.text).toContain(secrets.answer);
  // …and the run still holds the document, with nothing added.
  expect(run.panelItems.map((item) => item.title)).toEqual(['Findings']);
});

test('the agent brings an existing visual back', async ({ page }) => {
  const stageTurn: TurnScript = {
    question: 'How many matches were played at each stage?',
    calls: [
      {
        name: 'run_readonly_sql',
        arguments: { sql: STAGE_SQL, rationale: STAGE_RATIONALE },
      },
    ],
    answer: 'The group stage holds most of the matches.',
  };
  script([stageTurn]);
  const first = await runAssistantOn(page, stageTurn.question);

  // A follow-up run makes the visual (it needs an earlier answer), shows a
  // document over it and brings the visual back by its id.
  const chartQuestion = 'Chart it, then bring the chart back';
  const scripted = stub.reply;
  stub.reply = (request): StubReply => {
    if (systemTexts(request).some((text) => text.includes(DESIGNER_SKILL_TAG))) {
      return { text: JSON.stringify(VISUAL_SPEC) };
    }
    const { question, step } = position(request);
    if (!request.stream || !question.includes(chartQuestion)) return scripted(request);
    const tool = (name: string) =>
      request.tools.find((entry) => entry === name || entry.endsWith(name)) ?? name;
    if (step === 0) {
      return {
        toolCall: {
          name: tool('run_readonly_sql'),
          arguments: { sql: STAGE_SQL, rationale: STAGE_RATIONALE },
        },
      };
    }
    if (step === 1) return { toolCall: { name: tool('create_visual'), arguments: {} } };
    if (step === 2) return { toolCall: { name: tool('show_in_panel'), arguments: SHOW_FINDINGS.calls[0].arguments } };
    if (step === 3) {
      const created = request.messages.filter((message) => message.role === 'tool').map(messageText)[1] ?? '';
      const visualId = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(created)?.[0];
      return {
        toolCall: {
          name: tool('show_in_panel'),
          arguments: { kind: 'visual', visualId: visualId ?? 'missing' },
        },
      };
    }
    return { text: 'The chart is back in the panel.' };
  };
  const second = await runAssistantOn(page, chartQuestion, first.run.id);
  const visual = second.run.visualizations?.[0];
  expect(visual?.title).toBe(VISUAL_TITLE);
  // One item per visual (R10): showing it again moves it, never adds one.
  expect(second.run.panelItems.map((item) => item.title)).toEqual([
    VISUAL_TITLE,
    'Findings',
  ]);

  // A visual downloads through its own route, never as a panel item (api.md 126).
  const res = await apiFetch(
    page,
    'GET',
    runRoute(second.run.id, `panel-items/visual:${visual!.id}/download`),
  );
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain(
    `Panel item \\"visual:${visual!.id}\\" can't be downloaded`,
  );
  const zip = await apiFetch(
    page,
    'GET',
    runRoute(second.run.id, `visualizations/${visual!.id}/download`),
  );
  expect(zip.status()).toBe(200);
});

test('the workflow never appears among a run\'s panel items', async ({ page }) => {
  script([GO_ON]);
  const id = await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  const { run } = await runAgentOn(page, id, GO_ON.question);

  // update_workflow never adds an item (R13, R19).
  expect(run.panelItems).toEqual([]);
  expect(run.workflow?.phases.map((phase) => phase.title)).toEqual(STEPS);
  // A stored workflow is never a panel item (R10).
  const res = await apiFetch(
    page,
    'GET',
    runRoute(run.id, 'panel-items/phases/file'),
  );
  expect(res.status()).toBe(404);
  expect(await res.text()).toContain('Panel item \\"phases\\" not found');
});

test('the run shows the agent\'s phases and moves them as it goes', async ({
  page,
}) => {
  const turn: TurnScript = {
    question: 'Go on',
    calls: [
      {
        name: 'update_workflow',
        arguments: {
          current: 2,
          done: '1',
          waiting: true,
          todo: '2: Choose the lines to market',
          note: 'Pick the lines to market.',
        },
      },
    ],
    answer: 'Tell me which lines to market.',
  };
  script([turn]);
  const id = await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);

  await openWorkflowPage(page, `agent:${id}`, WORKFLOW_AGENT);
  await openRunTab(page);
  await fillRun(page, turn.question);
  await page.getByTestId('workflow-run').click();
  await expect(runAnswer(page)).toContainText(turn.answer);

  // The phases sit inside the agent's step, Understand done, Analyse current.
  const phases = page.getByTestId('workflow-run-phases');
  await expect(phases.getByRole('listitem')).toHaveText(
    STEPS.map((title) => new RegExp(title)),
  );
  await expect(page.getByTestId('workflow-run-phase-1')).toContainText('Done');
  await expect(page.getByTestId('workflow-run-phase-2')).toHaveAttribute(
    'aria-current',
    'step',
  );
  await expect(page.getByTestId('workflow-run-phase-2')).toContainText('Current');
  await expect(page.getByTestId('workflow-run-phase-3')).not.toContainText('Done');
});

test('the run keeps the moved workflow with its next step and note', async ({
  page,
}) => {
  const turn: TurnScript = {
    question: 'Go on',
    calls: [
      {
        name: 'update_workflow',
        arguments: {
          current: 2,
          done: '1',
          waiting: true,
          todo: '2: Choose the lines to market',
          note: 'Pick the lines to market.',
        },
      },
    ],
    answer: 'Tell me which lines to market.',
  };
  script([turn]);
  const id = await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  const { result, run } = await runAgentOn(page, id, turn.question);

  // The prompt's steps show from the first run, the agent moves them (R19).
  expect(run.workflow?.source).toBe('prompt');
  expect(run.workflow?.phases.map((phase) => phase.title)).toEqual(STEPS);
  expect(run.workflow?.phases[1].skill).toBe('curated-knowledge');
  // "Every open step says what needs to be done."
  expect(run.workflow?.phases[2].action).toBe('Review the report and approve it.');
  expect(run.workflow).toMatchObject({
    current: 2,
    done: [1],
    waiting: true,
    note: 'Pick the lines to market.',
  });
  expect(run.workflow?.phases[1].action).toBe('Choose the lines to market');
  expect(
    result.events.some((event) => event.type === 'workflow'),
    'the workflow moved while the run streamed',
  ).toBe(true);

  // The stored run reads back the same view.
  const stored = await apiJson<RunDoc>(page, 'GET', `/workflow-runs/${run.id}`);
  expect(stored.workflow).toMatchObject({ current: 2, done: [1], waiting: true });
});

test('an agent without a Workflow section creates its own steps', async ({
  page,
}) => {
  const turn: TurnScript = {
    question: 'Guide me through a review',
    calls: [
      {
        name: 'update_workflow',
        arguments: { steps: 'Scope | Analyse | Report', current: 1 },
      },
    ],
    answer: 'Let us start with the scope.',
  };
  script([turn]);
  const id = await liveAgent(page, FREE_AGENT, 'Help the user review the World Cup data.');
  const { run } = await runAgentOn(page, id, turn.question);

  expect(run.workflow?.phases.map((phase) => phase.title)).toEqual([
    'Scope',
    'Analyse',
    'Report',
  ]);
  expect(run.workflow?.current).toBe(1);
  expect(run.workflow?.done).toEqual([]);
  expect(run.workflow?.source).toBe('agent');
});

test("the agent can't rename prompt-defined steps", async ({ page }) => {
  const turn: TurnScript = {
    question: 'Rename the steps',
    calls: [{ name: 'update_workflow', arguments: { steps: 'One | Two' } }],
    answer: 'The steps stay as they are.',
  };
  script([turn]);
  const id = await liveAgent(page, WORKFLOW_AGENT, WORKFLOW_INSTRUCTIONS);
  const { run } = await runAgentOn(page, id, turn.question);

  const results = toolResultsOf(turn.question);
  expect(results).toHaveLength(1);
  expect(results[0]).toContain(ERR_RENAME);
  expect(run.workflow?.phases.map((phase) => phase.title)).toEqual(STEPS);
});

test('shown items survive reopening the run', async ({ page }) => {
  script([SHOW_FINDINGS, SHOW_TABLE]);
  const first = await runAssistantOn(page, SHOW_FINDINGS.question);
  const second = await runAssistantOn(page, SHOW_TABLE.question, first.run.id);
  expect(second.run.panelItems.map((item) => item.title)).toEqual([
    STAGE_TITLE,
  ]);

  // Each stored run reads back its own items, most recently shown first.
  await page.reload();
  const firstStored = await apiJson<RunDoc>(page, 'GET', `/workflow-runs/${first.run.id}`);
  const secondStored = await apiJson<RunDoc>(page, 'GET', `/workflow-runs/${second.run.id}`);
  expect(firstStored.panelItems.map((item) => item.title)).toEqual(['Findings']);
  expect(secondStored.panelItems.map((item) => [item.kind, item.title])).toEqual([
    ['table', STAGE_TITLE],
  ]);
});

// ------------------------------------------- Questions to Insights v2 (R8a)

const V2_STEPS = ['receive-question', 'load-catalog', 'analyse', 'wrap-up'];
const V2_TOOLS = ['list_entities', 'describe_entity', 'run_readonly_sql'];
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
  const { result, run } = await runOk(page, 'qti-v2-turn', {
    question: V2_QUESTION,
    datasets: [WORLD_CUP_DATASET],
  });

  // Every step runs, in order, and ends done (R19).
  for (const id of V2_STEPS) {
    expect(stepStatuses(result, id), id).toEqual(['running', 'success']);
  }
  const startOrder = result.events
    .filter((event) => event.type === 'step' && event.status === 'running')
    .map((event) => String(event.id));
  expect(startOrder).toEqual(V2_STEPS);
  expect(result.text).toContain(V2_ANSWER);

  // The run ran v2 with its three tools, never update_workflow (R8a), and
  // the SQL ran for real.
  const request = turnRequests(stub, V2_QUESTION)[0];
  expect([...request.tools].sort()).toEqual([...V2_TOOLS].sort());
  expect(toolResultsOf(V2_QUESTION).join('\n')).toContain('matches');

  expect(run.workflow?.source).toBe('workflow');
  expect(run.workflow?.phases.map((phase) => phase.title)).toEqual([
    'Receive question',
    'Load catalog',
    'Analyse',
    'Wrap up',
  ]);
  expect(run.workflow?.done).toEqual([1, 2, 3, 4]);
});

test('a failing step of the v2 workflow is marked failed', async ({ page }) => {
  // The stub fails every model call: the connection drops before a reply.
  stub.hold = (request) =>
    request.stream ? Promise.reject(new Error('model down')) : undefined;

  // The provider retries a dropped connection before the step fails.
  const result = await runWorkflow(page, 'qti-v2-turn', {
    question: V2_QUESTION,
    datasets: [WORLD_CUP_DATASET],
  });
  expect(result.status).toBe(200);
  expect(stepStatuses(result, 'receive-question').at(-1)).toBe('success');
  expect(stepStatuses(result, 'load-catalog').at(-1)).toBe('success');
  expect(stepStatuses(result, 'analyse').at(-1)).toBe('failed');
  expect(stepStatuses(result, 'wrap-up').at(-1)).toBe('skipped');
  expect(turnRequests(stub, V2_QUESTION).length).toBeGreaterThan(0);

  // The run ends with the step's error (R8a, agent-answers R61).
  const last = result.events[result.events.length - 1];
  expect(last.type).toBe('error');
  expect(String(last.content)).toBeTruthy();
  expect(result.error).toBe(String(last.content));
});
