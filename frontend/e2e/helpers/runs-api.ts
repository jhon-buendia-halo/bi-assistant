import { expect, type Page } from '@playwright/test';
import { WORLD_CUP_DATASET } from './app-actions';
import { apiBaseOf } from './api';

/**
 * Runs a workflow through the streamed run API (`POST /workflows/:id/runs/stream`,
 * api.md 119) and reads the whole stream. The catalogue holds two workflows;
 * the helpers here send Insights Analyst, whose Analyse step runs one
 * agent turn through the turn path: the specs that check what reaches the
 * model send a run.
 */

export interface RunEvent {
  type: string;
  [key: string]: unknown;
}

export interface StoredRun {
  id: string;
  status: 'success' | 'failed' | 'stopped';
  answer?: { content?: string; [key: string]: unknown };
  panelItems?: {
    id: string;
    kind?: string;
    title?: string;
    [key: string]: unknown;
  }[];
  visualizations?: { id: string; [key: string]: unknown }[];
  workflow?: { steps: { id: string; status: string }[] };
  [key: string]: unknown;
}

export interface RunResult {
  /** The HTTP status; anything but 200 means nothing ran (118's refusals). */
  status: number;
  /** The `run` event's id (the stored run); undefined when the run was refused. */
  runId?: string;
  events: RunEvent[];
  /** The terminal `done` event's run, when the run ended in `done`. */
  run?: StoredRun;
  /** The terminal `error` event's text, when the turn failed. */
  error?: string;
  /** The Markdown of the answer, the `text` events joined. */
  text: string;
  /** The raw body, for a refusal. */
  body: string;
}

/** Runs workflow `id` on `input`, reading the stream to its end. */
export async function runWorkflow(
  page: Page,
  id: string,
  input: Record<string, string | number | boolean | string[]>,
  context?: { fromRunId: string },
): Promise<RunResult> {
  const response = await page.request.post(
    `${apiBaseOf(page)}/workflows/${encodeURIComponent(id)}/runs/stream`,
    { data: { input, ...(context ? { context } : {}) }, timeout: 120_000 },
  );
  const body = await response.text();
  const events: RunEvent[] = [];
  for (const frame of body.split('\n\n')) {
    const line = frame.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice('data: '.length)) as RunEvent);
    } catch {
      /* a partial frame carries no event */
    }
  }
  const runEvent = events.find((e) => e.type === 'run');
  const done = events.find((e) => e.type === 'done');
  const error = events.find((e) => e.type === 'error');
  return {
    status: response.status(),
    runId: runEvent ? String(runEvent.runId) : undefined,
    events,
    run: done ? (done.run as StoredRun) : undefined,
    error: error ? String(error.content) : undefined,
    text: events
      .filter((e) => e.type === 'text')
      .map((e) => String(e.content))
      .join(''),
    body,
  };
}

/** The catalogue's first workflow, the one these helpers run (workflows R1). */
export const V2_WORKFLOW_ID = 'answer-business-question';
export const V2_WORKFLOW_NAME = 'Answer a Business Question';

/**
 * Runs Insights Analyst (`answer-business-question`) on `question` over the
 * datasets (the World Cup one by default). Its Analyse step is one agent turn
 * of `insights-analyst`, offered `list_entities`, `describe_entity`,
 * `sample_rows`, `run_readonly_sql`, `ask_clarification` and its on-demand
 * skills (no visual, panel or workflow tools).
 */
export async function runQuestion(
  page: Page,
  question: string,
  options: {
    datasets?: string[];
    fromRunId?: string;
    buildVisual?: boolean;
    approveSteps?: boolean;
  } = {},
): Promise<RunResult> {
  return runWorkflow(
    page,
    V2_WORKFLOW_ID,
    {
      question,
      datasets: options.datasets ?? [WORLD_CUP_DATASET],
      // Off unless asked: Build visual (workflows R41) makes one more model call.
      buildVisual: options.buildVisual ?? false,
      // Off unless asked: with approvals on, a run stops after each agent's work.
      approveSteps: options.approveSteps ?? false,
    },
    options.fromRunId ? { fromRunId: options.fromRunId } : undefined,
  );
}

/** `runQuestion`, expecting a run that ended in `done`. */
export async function runQuestionOk(
  page: Page,
  question: string,
  options: {
    datasets?: string[];
    fromRunId?: string;
    buildVisual?: boolean;
    approveSteps?: boolean;
  } = {},
): Promise<RunResult> {
  const result = await runQuestion(page, question, options);
  expect(result.status, result.body).toBe(200);
  expect(result.error, result.body).toBeUndefined();
  expect(result.run, result.body).toBeDefined();
  return result;
}
