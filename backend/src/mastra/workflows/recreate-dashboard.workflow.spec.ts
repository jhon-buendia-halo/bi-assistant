// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { RequestContext } from '@mastra/core/request-context';
import { recreateDashboardWorkflow } from './recreate-dashboard.workflow';
import { SAMPLE_BLUEPRINT_REPLY } from './recreate-dashboard.sample';
import {
  RECREATE_DASHBOARD_DEFAULT_QUESTION,
  RECREATE_DASHBOARD_RUNTIME_KEY,
  RECREATE_DASHBOARD_STEPS,
  RECREATE_DASHBOARD_WORKFLOW_ID,
  blueprintOf,
  emptyBlueprint,
  renderDashboardBundle,
  savedDashboardAnswer,
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

const BLUEPRINT = blueprintOf(SAMPLE_BLUEPRINT_REPLY) as DashboardBlueprint;

type SaveInput = Parameters<RecreateDashboardRuntime['saveDashboard']>[0];

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
    saveDashboard: jest.fn((input: SaveInput) => {
      calls.push(`saveDashboard:${input.blueprint.title}`);
      return Promise.resolve({
        visualId: 'v-1',
        artifactId: 'a-1',
        artifactName: 'Sales board',
      });
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

  it('loads the image, reads the dashboard and saves it as an artifact', async () => {
    const given = runtime();
    const { events, result } = await run(given);
    expect(given.calls).toEqual([
      'loadImage:inputs/image.png',
      `readDashboard:inputs/image.png:${RECREATE_DASHBOARD_DEFAULT_QUESTION}`,
      'saveDashboard:Sales Performance 2025',
    ]);
    expect(events.filter((event) => event.endsWith(':success'))).toEqual([
      'load-image:success',
      'read-dashboard:success',
      'save-dashboard:success',
    ]);
    expect(result.status).toBe('success');
    expect(result.result).toEqual({
      artifactId: 'a-1',
      artifactName: 'Sales board',
      visualId: 'v-1',
      title: 'Sales Performance 2025',
      widgetCount: 4,
      filterCount: 2,
      answer: savedDashboardAnswer({
        blueprint: BLUEPRINT,
        artifactName: 'Sales board',
      }),
      blueprint: BLUEPRINT,
    });
  });

  it('stores the dashboard drawn alone, and an answer that names the artifact', async () => {
    const given = runtime();
    await run(given);
    const [saved] = given.saveDashboard.mock.calls[0] as [SaveInput];
    expect(saved.blueprint).toEqual(BLUEPRINT);
    // No mapping yet: no status marks in the drawing.
    expect(saved.bundle).toEqual(renderDashboardBundle(BLUEPRINT, null));
    expect(saved.answer('Q4 board')).toContain(
      'Saved in Artifacts as **Q4 board**.',
    );
  });

  it("passes the run's own instructions to the reader", async () => {
    const given = runtime();
    await run(given, '  Only the top row ');
    expect(given.readDashboard).toHaveBeenCalledWith({
      question: 'Only the top row',
      image: 'inputs/image.png',
    });
  });

  it('ends at Read dashboard when the run is stopped there: nothing is saved', async () => {
    const given = runtime({
      readDashboard: jest.fn(() =>
        Promise.resolve({ blueprint: emptyBlueprint(), stopped: true }),
      ),
    });
    const { result } = await run(given);
    expect(given.saveDashboard).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.result).toMatchObject({ stopped: true });
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
