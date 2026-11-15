// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);
// Load catalog reads the datasets through the dataset tools' services.
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: (names: string[]) =>
      Promise.resolve(
        names.map((name) => ({
          name,
          datasourceId: 'd-1',
          datasourceKind: 'postgres',
          tables: ['shop.orders'],
          entities: [
            {
              key: 'shop.orders',
              columns: [
                { name: 'order_date', type: 'date' },
                { name: 'Region', type: 'text' },
                { name: 'total_amount', type: 'numeric' },
                { name: 'order_id', type: 'int' },
              ],
            },
          ],
        })),
      ),
  }),
}));

import { RequestContext } from '@mastra/core/request-context';
import { recreateDashboardWorkflow } from './recreate-dashboard.workflow';
import {
  SAMPLE_BLUEPRINT_REPLY,
  SAMPLE_MAPPING_REPLY,
} from './recreate-dashboard.sample';
import {
  RECREATE_DASHBOARD_DEFAULT_QUESTION,
  RECREATE_DASHBOARD_RUNTIME_KEY,
  RECREATE_DASHBOARD_STEPS,
  RECREATE_DASHBOARD_WORKFLOW_ID,
  blueprintOf,
  emptyBlueprint,
  emptyMapping,
  mappingExplanation,
  mappingOf,
  renderDashboardBundle,
  type DashboardBlueprint,
  type MockBundle,
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
const CATALOGUE_STEP_IDS = new Set(
  RECREATE_DASHBOARD_STEPS.map((step) => step.id),
);

const BLUEPRINT = blueprintOf(SAMPLE_BLUEPRINT_REPLY) as DashboardBlueprint;

type MapInput = Parameters<RecreateDashboardRuntime['mapData']>[0];

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
      return Promise.resolve();
    }),
    loadArtifact: jest.fn(({ artifact }: { artifact: string }) => {
      calls.push(`loadArtifact:${artifact}`);
      return Promise.resolve(BLUEPRINT);
    }),
    readDashboard: jest.fn((input: { question: string; image: string }) => {
      calls.push(`readDashboard:${input.image}:${input.question}`);
      return Promise.resolve({ blueprint: BLUEPRINT, stopped: false });
    }),
    mapData: jest.fn((input: MapInput) => {
      calls.push(
        `mapData:${input.catalog.map((entry) => entry.entity).join(',')}:${input.columns[0]?.columns.length}`,
      );
      return Promise.resolve({
        mapping: mappingOf(
          SAMPLE_MAPPING_REPLY,
          input.blueprint,
          input.catalog,
          input.columns,
        ),
        stopped: false,
      });
    }),
    saveDashboard: jest.fn((input: { bundle: MockBundle }) => {
      calls.push(`saveDashboard:${input.bundle.title}`);
      return Promise.resolve({ visualId: 'v-1', title: input.bundle.title });
    }),
    ...overrides,
  };
}

async function run(
  given: MockedRuntime | undefined,
  question = '',
  source: { image?: string; artifact?: string } = {
    image: 'inputs/image.png',
  },
) {
  const requestContext = new RequestContext();
  if (given) requestContext.set(RECREATE_DASHBOARD_RUNTIME_KEY, given);
  const output = (await workflow.createRun()).stream({
    inputData: { question, ...source, datasets: ['Shop'] },
    requestContext,
  });
  const events: string[] = [];
  for await (const event of output.fullStream) {
    // The catalogue's steps only: the map between them is the engine's own.
    if (event.payload?.id && CATALOGUE_STEP_IDS.has(event.payload.id)) {
      events.push(`${event.payload.id}:${event.payload.status}`);
    }
  }
  return { events, result: await output.result };
}

describe('recreateDashboardWorkflow', () => {
  it('is built from the step catalogue and never snapshots', () => {
    expect(workflow.id).toBe(RECREATE_DASHBOARD_WORKFLOW_ID);
    // The steps in sequence; Read dashboard is the branch's (see below).
    expect(workflow.steps.map((step) => [step.id, step.description])).toEqual(
      RECREATE_DASHBOARD_STEPS.filter(
        (step) => step.id !== 'read-dashboard',
      ).map((step) => [step.id, step.title]),
    );
    expect(workflow.options?.shouldPersistSnapshot?.()).toBe(false);
  });

  it('reads the dashboard, maps it to the catalog, draws it and explains the mapping', async () => {
    const given = runtime();
    const { events, result } = await run(given);
    expect(given.calls).toEqual([
      'loadImage:inputs/image.png',
      `readDashboard:inputs/image.png:${RECREATE_DASHBOARD_DEFAULT_QUESTION}`,
      // The catalog of the run's dataset: its entity and four columns.
      'mapData:shop.orders:4',
      'saveDashboard:Sales Performance 2025',
    ]);
    expect(events.filter((event) => event.endsWith(':success'))).toEqual([
      'load-source:success',
      'read-dashboard:success',
      'load-dashboard-catalog:success',
      'map-data:success',
      'render-dashboard:success',
    ]);
    expect(result.status).toBe('success');
    const mapping = mappingOf(
      SAMPLE_MAPPING_REPLY,
      BLUEPRINT,
      [
        {
          entity: 'shop.orders',
          dataset: 'Shop',
          datasourceId: 'd-1',
          datasourceKind: 'postgres',
          columnCount: 4,
        },
      ],
      [
        {
          entity: 'shop.orders',
          columns: [
            { name: 'order_date', type: 'date' },
            { name: 'Region', type: 'text' },
            { name: 'total_amount', type: 'numeric' },
            { name: 'order_id', type: 'int' },
          ],
          more: 0,
        },
      ],
    );
    const answer = mappingExplanation({
      blueprint: BLUEPRINT,
      mapping,
      datasets: ['Shop'],
      entityCount: 1,
      source: 'image',
    });
    expect(result.result).toEqual({
      visualId: 'v-1',
      title: 'Sales Performance 2025',
      widgetCount: 4,
      filterCount: 2,
      mappedCount: 2,
      partialCount: 1,
      unmappedCount: 1,
      answer,
      blueprint: BLUEPRINT,
      mapping,
    });
    // What is stored is the fixed runtime's bundle and the explanation.
    expect(given.saveDashboard).toHaveBeenCalledWith({
      bundle: renderDashboardBundle(BLUEPRINT, mapping),
      answer,
    });
  });

  it('skips Read dashboard for a run on a saved dashboard', async () => {
    const given = runtime();
    const { events, result } = await run(given, '', { artifact: 'a-1' });
    expect(given.calls).toEqual([
      'loadArtifact:a-1',
      'mapData:shop.orders:4',
      'saveDashboard:Sales Performance 2025',
    ]);
    expect(given.loadImage).not.toHaveBeenCalled();
    expect(given.readDashboard).not.toHaveBeenCalled();
    expect(events.filter((event) => event.endsWith(':success'))).toEqual([
      'load-source:success',
      'load-dashboard-catalog:success',
      'map-data:success',
      'render-dashboard:success',
    ]);
    expect(result.status).toBe('success');
    const done = result.result as { blueprint: unknown; answer: string };
    expect(done.blueprint).toEqual(BLUEPRINT);
    // The explanation says the dashboard was not read from an image.
    expect(done.answer).toContain(
      '1. **Saved dashboard.** The dashboard was taken from the saved artifact',
    );
    expect(done.answer).not.toContain('The image was read into');
  });

  it('takes the saved dashboard when the input has both', async () => {
    const given = runtime();
    await run(given, '', { image: 'inputs/image.png', artifact: 'a-1' });
    expect(given.loadArtifact).toHaveBeenCalledWith({ artifact: 'a-1' });
    expect(given.loadImage).not.toHaveBeenCalled();
    expect(given.readDashboard).not.toHaveBeenCalled();
  });

  it('fails when the input has neither an image nor a saved dashboard', async () => {
    const { result } = await run(runtime(), '', {});
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain(
      'The run has neither a dashboard image nor a saved dashboard',
    );
  });

  it("fails with the step's own error when the artifact is gone", async () => {
    const given = runtime({
      loadArtifact: jest.fn(() =>
        Promise.reject(new Error('Artifact "a-1" not found')),
      ),
    });
    const { result } = await run(given, '', { artifact: 'a-1' });
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain(
      'Artifact "a-1" not found',
    );
    expect(given.mapData).not.toHaveBeenCalled();
  });

  it("passes the run's own instructions to both agents", async () => {
    const given = runtime();
    await run(given, '  Use a dark theme ');
    expect(given.readDashboard).toHaveBeenCalledWith({
      question: 'Use a dark theme',
      image: 'inputs/image.png',
    });
    expect(given.mapData).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Use a dark theme',
        blueprint: BLUEPRINT,
      }),
    );
  });

  it('ends after Read dashboard when the run is stopped there', async () => {
    const given = runtime({
      readDashboard: jest.fn(() =>
        Promise.resolve({ blueprint: emptyBlueprint(), stopped: true }),
      ),
    });
    const { result } = await run(given);
    // Load catalog ends the run: nothing is listed and nothing is mapped.
    expect(result.result).toMatchObject({ catalog: [], columns: [] });
    expect(given.mapData).not.toHaveBeenCalled();
    expect(given.saveDashboard).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.result).toMatchObject({ stopped: true });
  });

  it('ends at Map data when the run is stopped there', async () => {
    const given = runtime({
      mapData: jest.fn(() =>
        Promise.resolve({ mapping: emptyMapping(), stopped: true }),
      ),
    });
    const { result } = await run(given);
    expect(given.saveDashboard).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({ stopped: true, entityCount: 1 });
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
      'The Load source step has no dashboard to work on',
    );
  });

  it('refuses a step output that breaks the contract', async () => {
    const given = runtime({
      loadArtifact: jest.fn(() => Promise.resolve({ title: 'No widgets' })),
    });
    const { result } = await run(given, '', { artifact: 'a-1' });
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain(
      'Contract violation in Load source',
    );
  });
});
