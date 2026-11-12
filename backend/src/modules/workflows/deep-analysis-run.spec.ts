// The real Mastra instance pulls in ESM-only packages Jest cannot require.
jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));
// The catalogue is a fake here (workflows.service.spec proves the entry).
jest.mock('./workflows.service', () => ({ WorkflowsService: class {} }));
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
  RUN_HOST_ID_PREFIX: 'run-',
}));
// The deep-analysis workflow runs on the engine stand-in.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../../mastra/testing/workflows.stub')>(
    '../../mastra/testing/workflows.stub',
  ),
);

import BetterSqlite3 from 'better-sqlite3';
import { SqliteDocStore } from '../../infrastructure/database/sqlite-doc-store';
import type { MastraService } from '../../mastra/mastra.service';
import { deepAnalysisWorkflow } from '../../mastra/workflows/deep-analysis.workflow';
import { DEEP_ANALYSIS_STEPS } from '../../mastra/workflows/deep-analysis.steps';
import { CODE_WORKFLOWS } from '../../mastra/workflows/workflow-catalog';
import type { DatasetsRepository } from '../datasets/repositories/datasets.repository';
import type { SessionsService } from '../sessions/sessions.service';
import { WorkflowRunsRepository } from './repositories/workflow-runs.repository';
import { DEEP_ANALYSIS_REPORT_ITEM_ID } from './deep-analysis-run';
import {
  WorkflowRunsService,
  type RunStreamEvent,
} from './workflow-runs.service';
import type { WorkflowsService } from './workflows.service';

type StubWorkflow = {
  createRun(): Promise<{
    stream(args: { inputData: unknown; requestContext?: unknown }): {
      fullStream: AsyncIterable<unknown>;
      result: Promise<unknown>;
    };
  }>;
};

const QUESTION = 'Why are denials rising?';
const DATASET = 'World Cup Core';

const PLAN = {
  object: {
    title: 'Denial drivers',
    angles: [
      { title: 'By payer', question: 'Which payers deny most?' },
      { title: 'By month', question: 'How did denials trend?' },
    ],
  },
};
const REPORT = {
  object: {
    title: 'Denial drivers deep dive',
    executiveSummary: 'Denials rose to 12.4% driven by payer A.',
    report:
      '## Findings by angle\n\nPayer A.\n\n## Anomalies and drivers\n\nNone.\n\n## Recommendations\n\nAudit payer A.',
  },
};
function finding(n: number) {
  return {
    text: `Angle ${n}: the rate is ${n}0%.\n\nSQL used\n\n\`\`\`sql\nselect ${n}\n\`\`\``,
  };
}
const RESPONSES = [PLAN, finding(1), finding(2), REPORT];

/** The deep-analysis workflow as `GET /workflows/deep-analysis` shows it. */
const source = CODE_WORKFLOWS.find((w) => w.id === 'deep-analysis')!;
const DETAIL = {
  id: 'deep-analysis',
  name: 'Deep analysis',
  description: source.description,
  kind: 'code',
  owner: 'Official',
  agents: [{ key: 'assistant', name: 'Questions to Insights Assistant' }],
  stepCount: 4,
  bar: 'steps',
  trigger: 'run',
  input: source.input,
  datasets: [],
  missingDatasets: [],
  starterQuestions: [],
  steps: DEEP_ANALYSIS_STEPS.map((step) => ({
    id: step.id,
    title: step.title,
    kind: step.kind,
    summary: step.summary,
    input: [...step.input],
    output: [...step.output],
    exits: [...step.exits],
  })),
};

function build(
  responses: unknown[] = RESPONSES,
  options: { abortAfterPlan?: AbortController } = {},
) {
  const db = new BetterSqlite3(':memory:');
  const generate = jest.fn<
    Promise<unknown>,
    [unknown, Record<string, unknown>?]
  >();
  for (const response of responses) {
    generate.mockImplementationOnce(() => {
      if (options.abortAfterPlan && generate.mock.calls.length > 1) {
        options.abortAfterPlan.abort();
        return Promise.reject(new Error('This operation was aborted'));
      }
      return Promise.resolve(response);
    });
  }
  generate.mockRejectedValue(new Error('no more responses'));
  const filesystem = {
    writeFile: jest.fn().mockResolvedValue(undefined),
    readFile: jest.fn().mockResolvedValue('# stored report'),
  };
  const streamWorkflow = jest.fn(
    async (key: string, inputData: unknown, requestContext?: unknown) => {
      if (key !== 'deep-analysis') throw new Error(`no stand-in for ${key}`);
      const workflow = deepAnalysisWorkflow as unknown as StubWorkflow;
      return (await workflow.createRun()).stream({ inputData, requestContext });
    },
  );
  const mastra = {
    getAgent: jest.fn().mockReturnValue({ generate }),
    ensureSessionWorkspace: jest
      .fn()
      .mockResolvedValue({ id: 'workspace-1', filesystem }),
    streamWorkflow,
    runWorkflow: jest.fn(),
    deleteMemoryThread: jest.fn().mockResolvedValue(undefined),
  };
  const host = (runId: string) => ({
    id: `run-${runId}`,
    name: 'Deep analysis',
    datasets: [DATASET],
    run: true,
    messages: [],
    visualizations: [],
  });
  const sessions = {
    get: jest.fn((id: string) =>
      Promise.resolve({ ...host(id.slice(4)), id, name: 'Denials review' }),
    ),
    createRunHost: jest.fn((spec: { runId: string }) =>
      Promise.resolve(host(spec.runId)),
    ),
    backgroundAgentOptions: jest
      .fn()
      .mockResolvedValue({ maxSteps: 15, context: [], requestContext: {} }),
    finishRunHost: jest.fn((id: string) =>
      Promise.resolve({ ...host(id.slice(4)), panelItems: [] }),
    ),
    toView: jest.fn((doc: { panelItems?: unknown[] }) =>
      Promise.resolve({ ...doc, panelItems: doc.panelItems ?? [] }),
    ),
    deleteRunHostResources: jest.fn().mockResolvedValue(undefined),
  };
  const workflows = {
    get: jest.fn((id: string) =>
      id === 'deep-analysis'
        ? Promise.resolve(structuredClone(DETAIL))
        : Promise.reject(new Error(`no workflow ${id}`)),
    ),
    list: jest.fn(() => Promise.resolve([DETAIL])),
  };
  const repository = new WorkflowRunsRepository(
    new SqliteDocStore(db, 'workflow_runs'),
  );
  const service = new WorkflowRunsService(
    workflows as unknown as WorkflowsService,
    sessions as unknown as SessionsService,
    {
      list: jest
        .fn()
        .mockResolvedValue([{ name: DATASET, datasourceKind: 'postgres' }]),
    } as unknown as DatasetsRepository,
    mastra as unknown as MastraService,
    repository,
  );
  return { db, service, repository, generate, filesystem, sessions, mastra };
}

async function stream(ctx: ReturnType<typeof build>, abort?: AbortController) {
  const prepared = await ctx.service.prepare('deep-analysis', {
    input: { question: QUESTION, datasets: [DATASET] },
  });
  const events: RunStreamEvent[] = [];
  const run = await ctx.service.stream(
    prepared,
    (event) => events.push(event),
    abort?.signal,
  );
  return { run, events };
}

function stepEvents(events: RunStreamEvent[]): string[] {
  return events.flatMap((event) =>
    event.type === 'step' ? [`${event.id}:${event.status}`] : [],
  );
}

describe('a deep-analysis run (agents.md 5.15; plan 1.25.3)', () => {
  let ctx: ReturnType<typeof build>;
  afterEach(() => ctx.db.close());

  it('runs Plan, Investigate, Write and Assemble in order on a run host over the picked datasets', async () => {
    ctx = build();
    const { run, events } = await stream(ctx);

    expect(events[0]).toEqual({
      type: 'run',
      runId: run.id,
      workflowId: 'deep-analysis',
    });
    expect(stepEvents(events)).toEqual([
      'plan:running',
      'plan:success',
      'investigate:running',
      'investigate:success',
      'write:running',
      'write:success',
      'assemble:running',
      'assemble:success',
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', run });
    expect(ctx.sessions.createRunHost).toHaveBeenCalledWith({
      runId: run.id,
      workflowId: 'deep-analysis',
      name: 'Deep analysis',
      datasets: [DATASET],
    });
    // Every assistant call is grounded on the run host, never a chat.
    const hosts = ctx.sessions.backgroundAgentOptions.mock.calls.map(
      (call: unknown[]) => (call[0] as { id: string }).id,
    );
    expect(hosts).toEqual(Array(4).fill(`run-${run.id}`));
    expect(ctx.sessions.finishRunHost).toHaveBeenCalledWith(`run-${run.id}`);
  });

  it('stores the report in the run workspace; the executive summary is the answer, the report its file', async () => {
    ctx = build();
    const { run } = await stream(ctx);
    const path = 'reports/denial-drivers-deep-dive.md';

    expect(ctx.mastra.ensureSessionWorkspace).toHaveBeenCalledWith(
      `run-${run.id}`,
      'Deep analysis',
    );
    expect(ctx.filesystem.writeFile).toHaveBeenCalledTimes(1);
    const [writtenPath, markdown] = ctx.filesystem.writeFile.mock.calls[0] as [
      string,
      string,
    ];
    expect(writtenPath).toBe(path);
    expect(markdown).toContain('# Denial drivers deep dive');
    expect(markdown).toContain(`**Question:** ${QUESTION}`);
    expect(markdown).toContain('## Executive summary');
    expect(markdown).toContain('## Data appendix');
    expect(markdown).toContain('```sql\nselect 2\n```');
    expect(markdown).toContain(`Report ${run.id}`);

    expect(run).toMatchObject({
      status: 'success',
      question: QUESTION,
      datasets: [DATASET],
      output: {
        title: 'Denial drivers deep dive',
        executiveSummary: 'Denials rose to 12.4% driven by payer A.',
        path,
        angles: 2,
      },
      answer: {
        role: 'assistant',
        content: 'Denials rose to 12.4% driven by payer A.',
        report: {
          jobId: run.id,
          title: 'Denial drivers deep dive',
          path,
          angles: 2,
        },
      },
      panelItems: [
        {
          id: DEEP_ANALYSIS_REPORT_ITEM_ID,
          kind: 'file',
          title: 'Denial drivers deep dive',
          path,
          bytes: Buffer.byteLength(markdown, 'utf8'),
        },
      ],
    });
    // Stored as the stream reported it, and read back the same.
    expect(await ctx.service.get(run.id)).toMatchObject({
      status: 'success',
      answer: { report: { jobId: run.id, path } },
      panelItems: [{ id: DEEP_ANALYSIS_REPORT_ITEM_ID, path }],
    });
  });

  it("sends the assistant the deep analysis's phase prompts, one call per step", async () => {
    ctx = build();
    await stream(ctx);
    const prompts = ctx.generate.mock.calls.map(([prompt]) => String(prompt));
    expect(prompts).toHaveLength(4);
    expect(prompts[0]).toMatch(/^Plan a deep analysis of the question below\./);
    expect(prompts[0]).toContain(`<question>\n${QUESTION}\n</question>`);
  });

  it("fails the run at Plan when the planner's reply is unusable, skipping the rest, with no answer", async () => {
    ctx = build([{ text: 'not json' }]);
    const { run, events } = await stream(ctx);

    expect(run.status).toBe('failed');
    expect(run.error).toBe('the planner returned no usable investigation plan');
    expect(run.steps.map((step) => [step.id, step.status])).toEqual([
      ['plan', 'failed'],
      ['investigate', 'skipped'],
      ['write', 'skipped'],
      ['assemble', 'skipped'],
    ]);
    expect(run.answer).toBeUndefined();
    expect(run.panelItems ?? []).toEqual([]);
    expect(ctx.filesystem.writeFile).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: 'done', run });
    expect(ctx.sessions.finishRunHost).toHaveBeenCalled();
  });

  it('keeps a failed angle in the report and still answers', async () => {
    ctx = build([PLAN, finding(1), finding(2), REPORT]);
    ctx.generate.mockReset();
    ctx.generate
      .mockResolvedValueOnce(PLAN)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(finding(2))
      .mockResolvedValueOnce(REPORT);
    const { run } = await stream(ctx);

    expect(run.status).toBe('success');
    const [, markdown] = ctx.filesystem.writeFile.mock.calls[0] as [
      string,
      string,
    ];
    expect(markdown).toContain('_No SQL was recorded for this angle._');
    const writerPrompt = ctx.generate.mock.calls[3][0] as string;
    expect(writerPrompt).toContain(
      'This angle could not be investigated — timeout',
    );
  });

  it('stops when the connection closes: the running step and the rest end stopped or skipped', async () => {
    const abort = new AbortController();
    ctx = build(RESPONSES, { abortAfterPlan: abort });
    const { run, events } = await stream(ctx, abort);

    expect(run.status).toBe('stopped');
    expect(run.steps.map((step) => [step.id, step.status])).toEqual([
      ['plan', 'success'],
      ['investigate', 'stopped'],
      ['write', 'skipped'],
      ['assemble', 'skipped'],
    ]);
    expect(run.answer).toBeUndefined();
    // Nothing is sent once the run stopped.
    expect(events.some((event) => event.type === 'done')).toBe(false);
  });

  it('runs through POST /workflows/deep-analysis/runs too, answering the stored run', async () => {
    ctx = build();
    const run = await ctx.service.run('deep-analysis', {
      input: { question: QUESTION, datasets: [DATASET] },
    });
    expect(run).toMatchObject({
      workflowId: 'deep-analysis',
      status: 'success',
      answer: { content: 'Denials rose to 12.4% driven by payer A.' },
    });
  });

  it('refuses a blank question or no dataset before anything runs', async () => {
    ctx = build();
    await expect(
      ctx.service.prepare('deep-analysis', {
        input: { question: '  ', datasets: [DATASET] },
      }),
    ).rejects.toThrow('Question is required');
    await expect(
      ctx.service.prepare('deep-analysis', {
        input: { question: QUESTION, datasets: [] },
      }),
    ).rejects.toThrow('Select at least one dataset');
    expect(ctx.sessions.createRunHost).not.toHaveBeenCalled();
  });
});
