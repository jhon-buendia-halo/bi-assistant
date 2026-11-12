// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { readFileSync } from 'fs';
import { join } from 'path';
import { RequestContext } from '@mastra/core/request-context';
import { deepAnalysisWorkflow } from './deep-analysis.workflow';
import {
  DEEP_ANALYSIS_RUNTIME_KEY,
  DEEP_ANALYSIS_STEPS,
  DEEP_ANALYSIS_WORKFLOW_ID,
  failedAngle,
  type DeepAnalysisRuntime,
} from './deep-analysis.steps';

interface StubWorkflow {
  id: string;
  options?: { shouldPersistSnapshot?: () => boolean };
  steps: {
    id: string;
    description?: string;
    inputSchema: { shape: Record<string, unknown> };
    outputSchema: { shape: Record<string, unknown> };
  }[];
  createRun(): Promise<{
    stream(args: { inputData: unknown; requestContext?: unknown }): {
      fullStream: AsyncIterable<{
        type: string;
        payload?: { id?: string; status?: string };
      }>;
      result: Promise<{ status: string; result?: unknown; error?: unknown }>;
    };
  }>;
}

const workflow = deepAnalysisWorkflow as unknown as StubWorkflow;

const ANGLES = [
  { title: 'By payer', question: 'Which payers deny most?' },
  { title: 'By month', question: 'How did denials trend?' },
];

function fakeRuntime(overrides: Partial<DeepAnalysisRuntime> = {}) {
  const calls: string[] = [];
  const stored: { path: string; markdown: string }[] = [];
  const runtime: DeepAnalysisRuntime = {
    reportId: 'run-1',
    now: () => '2026-01-01T00:00:00.000Z',
    plan: jest.fn((question: string) => {
      calls.push(`plan:${question}`);
      return Promise.resolve({ title: 'Denial drivers', angles: ANGLES });
    }),
    investigate: jest.fn(({ angle, index, total }) => {
      calls.push(`investigate:${index + 1}/${total}:${angle.title}`);
      return Promise.resolve({
        ...angle,
        findings: `${angle.title} findings`,
        sql: [`select ${index + 1}`],
      });
    }),
    write: jest.fn(({ findings }) => {
      calls.push(`write:${findings.length}`);
      return Promise.resolve({
        title: '',
        executiveSummary: 'Denials rose to 12.4%.',
        report: '## Findings by angle\n\nPayer A.',
      });
    }),
    store: jest.fn((path: string, markdown: string) => {
      calls.push(`store:${path}`);
      stored.push({ path, markdown });
      return Promise.resolve();
    }),
    ...overrides,
  };
  return { runtime, calls, stored };
}

async function run(question: string, runtime?: DeepAnalysisRuntime) {
  const requestContext = new RequestContext();
  if (runtime) requestContext.set(DEEP_ANALYSIS_RUNTIME_KEY, runtime);
  const output = (await workflow.createRun()).stream({
    inputData: { question, datasets: ['World Cup Core'] },
    requestContext,
  });
  const events: string[] = [];
  for await (const event of output.fullStream) {
    if (event.payload?.id) {
      events.push(`${event.payload.id}:${event.payload.status}`);
    }
  }
  return { events, result: await output.result };
}

describe('deep-analysis workflow (agents.md 5.15; plan 1.25.3)', () => {
  it('runs Plan, Investigate, Write and Assemble in order, and persists no snapshot', () => {
    expect(workflow.id).toBe(DEEP_ANALYSIS_WORKFLOW_ID);
    expect(workflow.steps.map((s) => [s.id, s.description])).toEqual([
      ['plan', 'Plan'],
      ['investigate', 'Investigate'],
      ['write', 'Write'],
      ['assemble', 'Assemble'],
    ]);
    expect(workflow.options?.shouldPersistSnapshot?.()).toBe(false);
  });

  // The canvas draws the catalogue: its field names must be the built
  // steps' own schema fields, in order.
  it("matches the step catalogue's ids and input and output fields", () => {
    expect(
      workflow.steps.map((step) => ({
        id: step.id,
        input: Object.keys(step.inputSchema.shape),
        output: Object.keys(step.outputSchema.shape),
      })),
    ).toEqual(
      DEEP_ANALYSIS_STEPS.map((step) => ({
        id: step.id,
        input: [...step.input],
        output: [...step.output],
      })),
    );
  });

  it('plans, investigates each angle in turn, writes, then assembles and stores the report', async () => {
    const { runtime, calls, stored } = fakeRuntime();
    const { events, result } = await run(
      '  Why are denials rising?  ',
      runtime,
    );
    expect(events).toEqual([
      'plan:running',
      'plan:success',
      'investigate:running',
      'investigate:success',
      'write:running',
      'write:success',
      'assemble:running',
      'assemble:success',
    ]);
    expect(calls).toEqual([
      'plan:Why are denials rising?',
      'investigate:1/2:By payer',
      'investigate:2/2:By month',
      'write:2',
      'store:reports/denial-drivers.md',
    ]);
    expect(result).toEqual({
      status: 'success',
      result: {
        title: 'Denial drivers',
        executiveSummary: 'Denials rose to 12.4%.',
        path: 'reports/denial-drivers.md',
        angles: 2,
      },
    });
    expect(stored[0].markdown).toContain(
      '**Question:** Why are denials rising?',
    );
    expect(stored[0].markdown).toContain('```sql\nselect 2\n```');
    expect(stored[0].markdown).toContain('Report run-1');
  });

  it("keeps a failed angle's note and still writes the report", async () => {
    const { runtime, stored } = fakeRuntime({
      investigate: jest.fn(({ angle, index }) =>
        Promise.resolve(
          index === 0
            ? failedAngle(angle, 'timeout')
            : { ...angle, findings: 'ok', sql: [] },
        ),
      ),
    });
    const { result } = await run('Q', runtime);
    expect(result.status).toBe('success');
    expect(stored[0].markdown).toContain(
      '_No SQL was recorded for this angle._',
    );
    expect(runtime.write).toHaveBeenCalledWith({
      question: 'Q',
      findings: [
        expect.objectContaining({
          findings: 'This angle could not be investigated — timeout',
        }),
        expect.objectContaining({ findings: 'ok' }),
      ],
    });
  });

  it('fails Plan when the planner returns no angles, and runs nothing after it', async () => {
    const { runtime } = fakeRuntime({
      plan: jest.fn(() => Promise.resolve({ title: 'T', angles: [] })),
    });
    const { events, result } = await run('Q', runtime);
    expect(events).toEqual(['plan:running', 'plan:failed']);
    expect((result.error as Error).message).toBe(
      'the planner returned no angles',
    );
    expect(runtime.investigate).not.toHaveBeenCalled();
  });

  it('fails Write when the writer returns no usable report, and stores nothing', async () => {
    const { runtime } = fakeRuntime({
      write: jest.fn(() =>
        Promise.reject(
          new Error('the report writer returned no usable report'),
        ),
      ),
    });
    const { events, result } = await run('Q', runtime);
    expect(events.slice(-2)).toEqual(['write:running', 'write:failed']);
    expect((result.error as Error).message).toBe(
      'the report writer returned no usable report',
    );
    expect(runtime.store).not.toHaveBeenCalled();
  });

  it('fails Plan without a run to report to, or on a blank question', async () => {
    expect(((await run('Q')).result.error as Error).message).toBe(
      'The deep analysis has no run to report to',
    );
    const { runtime } = fakeRuntime();
    expect(((await run('   ', runtime)).result.error as Error).message).toBe(
      'question is required',
    );
  });

  it('is registered on the Mastra instance as deep-analysis', () => {
    const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    expect(source).toMatch(/'deep-analysis':\s*deepAnalysisWorkflow/);
  });
});
