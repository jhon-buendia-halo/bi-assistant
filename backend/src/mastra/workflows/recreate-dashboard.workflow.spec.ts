// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { RequestContext } from '@mastra/core/request-context';
import { recreateDashboardWorkflow } from './recreate-dashboard.workflow';
import {
  RECREATE_DASHBOARD_DEFAULT_QUESTION,
  RECREATE_DASHBOARD_RUNTIME_KEY,
  RECREATE_DASHBOARD_STEPS,
  RECREATE_DASHBOARD_WORKFLOW_ID,
  emptyBlueprint,
  savedMockAnswer,
  type DashboardBlueprint,
  type RecreateDashboardRuntime,
} from './recreate-dashboard.steps';

interface StubWorkflow {
  id: string;
  options?: { shouldPersistSnapshot?: () => boolean };
  steps: { id: string; description?: string }[];
  createRun(): Promise<{
    stream(args: { inputData: unknown; requestContext: unknown }): {
      fullStream: AsyncIterable<{
        type: string;
        payload?: { id?: string; status?: string };
      }>;
      result: Promise<{ status: string; result?: unknown; error?: unknown }>;
    };
  }>;
}

const workflow = recreateDashboardWorkflow as unknown as StubWorkflow;

const BLUEPRINT: DashboardBlueprint = {
  title: 'Sales',
  summary: 'Sales by month.',
  theme: 'light',
  layout: 'One row.',
  filters: [
    { id: 'region', label: 'Region', kind: 'select', options: ['All'] },
  ],
  widgets: [
    {
      id: 'revenue',
      title: 'Revenue',
      kind: 'kpi',
      position: 'row 1',
      description: 'Total revenue',
      fields: ['revenue'],
      observed: '$1.07M',
      filteredBy: ['region'],
    },
  ],
  columns: [{ name: 'revenue', type: 'number', description: 'Revenue' }],
};

/** Each phase of the runtime as a Jest mock, so a test reads its calls. */
type MockedRuntime = {
  [K in keyof RecreateDashboardRuntime]: jest.Mock;
} & { calls: string[] };

/** A runtime whose every phase succeeds, with each call recorded. */
function runtime(overrides: Partial<MockedRuntime> = {}): MockedRuntime {
  const calls: string[] = [];
  return {
    calls,
    loadImage: jest.fn(({ image }: { image: string }) => {
      calls.push(`loadImage:${image}`);
      return Promise.resolve({ mediaType: 'image/png', sizeBytes: 1234 });
    }),
    readDashboard: jest.fn((input: { question: string; image: string }) => {
      calls.push(`readDashboard:${input.image}:${input.question}`);
      return Promise.resolve({ blueprint: BLUEPRINT, stopped: false });
    }),
    buildMock: jest.fn((input: { blueprint: DashboardBlueprint }) => {
      calls.push(`buildMock:${input.blueprint.widgets.length}`);
      return Promise.resolve({
        title: 'Sales',
        description: 'A mock.',
        codeBytes: 4200,
        stopped: false,
      });
    }),
    saveMock: jest.fn(() => {
      calls.push('saveMock');
      return Promise.resolve({ visualId: 'v-1', title: 'Sales' });
    }),
    ...overrides,
  };
}

async function run(given: MockedRuntime | undefined, question = '') {
  const requestContext = new RequestContext();
  if (given) requestContext.set(RECREATE_DASHBOARD_RUNTIME_KEY, given);
  const output = (await workflow.createRun()).stream({
    inputData: { question, image: 'inputs/image.png' },
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

describe('recreateDashboardWorkflow', () => {
  it('is built from the step catalogue and never snapshots', () => {
    expect(workflow.id).toBe(RECREATE_DASHBOARD_WORKFLOW_ID);
    expect(workflow.steps.map((step) => [step.id, step.description])).toEqual(
      RECREATE_DASHBOARD_STEPS.map((step) => [step.id, step.title]),
    );
    expect(workflow.options?.shouldPersistSnapshot?.()).toBe(false);
  });

  it('loads the image, reads the dashboard, builds and saves the mock', async () => {
    const given = runtime();
    const { events, result } = await run(given);
    expect(given.calls).toEqual([
      'loadImage:inputs/image.png',
      `readDashboard:inputs/image.png:${RECREATE_DASHBOARD_DEFAULT_QUESTION}`,
      'buildMock:1',
      'saveMock',
    ]);
    expect(events.filter((event) => event.endsWith(':success'))).toEqual([
      'load-image:success',
      'read-dashboard:success',
      'build-mock:success',
      'save-mock:success',
    ]);
    expect(result.status).toBe('success');
    expect(result.result).toEqual({
      visualId: 'v-1',
      title: 'Sales',
      widgetCount: 1,
      filterCount: 1,
      answer: savedMockAnswer({ title: 'Sales', blueprint: BLUEPRINT }),
      blueprint: BLUEPRINT,
    });
  });

  it("passes the run's own instructions to both agents", async () => {
    const given = runtime();
    await run(given, '  Use a dark theme ');
    expect(given.readDashboard).toHaveBeenCalledWith({
      question: 'Use a dark theme',
      image: 'inputs/image.png',
    });
    expect(given.buildMock).toHaveBeenCalledWith({
      question: 'Use a dark theme',
      image: 'inputs/image.png',
      blueprint: BLUEPRINT,
    });
    expect(given.saveMock).toHaveBeenCalledWith({ blueprint: BLUEPRINT });
  });

  it('ends at Read dashboard when the run is stopped there', async () => {
    const given = runtime({
      readDashboard: jest.fn(() =>
        Promise.resolve({ blueprint: emptyBlueprint(), stopped: true }),
      ),
    });
    const { result } = await run(given);
    expect(given.buildMock).not.toHaveBeenCalled();
    expect(given.saveMock).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.result).toMatchObject({ stopped: true });
  });

  it('ends at Build mock when the run is stopped there', async () => {
    const given = runtime({
      buildMock: jest.fn(() =>
        Promise.resolve({
          title: '',
          description: '',
          codeBytes: 0,
          stopped: true,
        }),
      ),
    });
    const { result } = await run(given);
    expect(given.saveMock).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({ stopped: true, codeBytes: 0 });
  });

  it("fails with the step's own error when the image is missing", async () => {
    const given = runtime({
      loadImage: jest.fn(() =>
        Promise.reject(new Error('Image "inputs/image.png" not found')),
      ),
    });
    const { result } = await run(given);
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain('not found');
    expect(given.readDashboard).not.toHaveBeenCalled();
  });

  it('fails when a step runs without the runtime', async () => {
    const { result } = await run(undefined);
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain(
      'The Load image step has no dashboard to work on',
    );
  });

  it('refuses a step output that breaks the contract', async () => {
    const given = runtime({
      loadImage: jest.fn(() => Promise.resolve({ mediaType: 'image/png' })),
    });
    const { result } = await run(given);
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain(
      'Contract violation in Load image',
    );
  });
});
