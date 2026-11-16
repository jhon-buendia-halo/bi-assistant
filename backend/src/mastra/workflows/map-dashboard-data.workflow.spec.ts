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
import { mapDashboardDataWorkflow } from './map-dashboard-data.workflow';
import {
  READ_IMAGES_OUTCOME_ID,
  READ_IMAGES_RUNTIME_KEY,
  READ_IMAGES_STEP_ID,
  type ReadImagesRuntime,
} from './read-images.steps';
import {
  MAP_DASHBOARD_DATA_DEFAULT_QUESTION,
  MAP_DASHBOARD_DATA_EDGES,
  MAP_DASHBOARD_DATA_RUNTIME_KEY,
  MAP_DASHBOARD_DATA_STEPS,
  MAP_DASHBOARD_DATA_WORKFLOW_ID,
  mapDashboardQuestion,
  type MapDashboardDataRuntime,
} from './map-dashboard-data.steps';
import {
  SAMPLE_BLUEPRINT_REPLY,
  SAMPLE_CATALOG,
  SAMPLE_COLUMNS,
  SAMPLE_MAPPING_REPLY,
} from './recreate-dashboard.sample';
import {
  blueprintOf,
  emptyMapping,
  mappingExplanation,
  mappingOf,
  renderDashboardBundle,
  type DashboardBlueprint,
  type MockBundle,
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

const workflow = mapDashboardDataWorkflow as unknown as StubWorkflow;

const BLUEPRINT = blueprintOf(SAMPLE_BLUEPRINT_REPLY) as DashboardBlueprint;
// What the mocked dataset services list: the sample catalog.
const MAPPING = mappingOf(
  SAMPLE_MAPPING_REPLY,
  BLUEPRINT,
  SAMPLE_CATALOG,
  SAMPLE_COLUMNS,
);

type MapInput = Parameters<MapDashboardDataRuntime['mapData']>[0];

/** Each phase of the runtime as a Jest mock, so a test reads its calls. */
type MockedRuntime = {
  [K in keyof MapDashboardDataRuntime]: jest.Mock;
} & { calls: string[] };

/** A runtime whose every phase succeeds, with each call recorded. */
function runtime(overrides: Partial<MockedRuntime> = {}): MockedRuntime {
  const calls: string[] = [];
  return {
    calls,
    loadDashboard: jest.fn(({ artifact }: { artifact: string }) => {
      calls.push(`loadDashboard:${artifact}`);
      return Promise.resolve({ name: 'Sales board', blueprint: BLUEPRINT });
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
    saveMappedDashboard: jest.fn((input: { bundle: MockBundle }) => {
      calls.push(`saveMappedDashboard:${input.bundle.title}`);
      return Promise.resolve({ visualId: 'v-1', title: input.bundle.title });
    }),
    ...overrides,
  };
}

async function run(
  given: MockedRuntime | undefined,
  question = '',
  images?: { paths: string[]; reader: ReadImagesRuntime },
) {
  const requestContext = new RequestContext();
  if (given) requestContext.set(MAP_DASHBOARD_DATA_RUNTIME_KEY, given);
  if (images) requestContext.set(READ_IMAGES_RUNTIME_KEY, images.reader);
  const output = (await workflow.createRun()).stream({
    inputData: {
      question,
      artifact: 'a-1',
      datasets: ['Shop'],
      ...(images ? { images: images.paths } : {}),
    },
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

describe('mapDashboardDataWorkflow', () => {
  it('is built from the step catalogue and never snapshots', () => {
    expect(workflow.id).toBe(MAP_DASHBOARD_DATA_WORKFLOW_ID);
    // Read images is the branch's step, not a `.then()` one.
    expect(workflow.steps.map((step) => [step.id, step.description])).toEqual(
      MAP_DASHBOARD_DATA_STEPS.filter(
        (step) => step.id !== READ_IMAGES_STEP_ID,
      ).map((step) => [step.id, step.title]),
    );
    expect(workflow.options?.shouldPersistSnapshot?.()).toBe(false);
  });

  it('connects every step from Start to End, with one agent step', () => {
    const ids = MAP_DASHBOARD_DATA_STEPS.map((step) => step.id);
    expect(ids).toEqual([
      'read-images',
      'load-dashboard',
      'load-dashboard-catalog',
      'map-data',
      'render-dashboard',
    ]);
    // Read images is optional: Start goes to Load dashboard (no images) or
    // branches to it, which goes on to Load dashboard (agents.md 5.18).
    expect(
      MAP_DASHBOARD_DATA_EDGES.map((edge) => [edge.from, edge.to, edge.kind]),
    ).toEqual([
      ['start', 'load-dashboard', 'next'],
      ['start', 'read-images', 'branch'],
      ['read-images', 'load-dashboard', 'next'],
      ['load-dashboard', 'load-dashboard-catalog', 'next'],
      ['load-dashboard-catalog', 'map-data', 'next'],
      ['map-data', 'render-dashboard', 'next'],
      ['render-dashboard', 'end', 'next'],
    ]);
    expect(
      MAP_DASHBOARD_DATA_STEPS.filter((step) => step.kind === 'agent').map(
        (step) => [step.id, step.modelOnly],
      ),
    ).toEqual([
      ['read-images', true],
      ['map-data', true],
    ]);
  });

  it('loads the saved dashboard, maps it to the catalog, draws it and explains the mapping', async () => {
    const given = runtime();
    const { events, result } = await run(given);
    expect(given.calls).toEqual([
      'loadDashboard:a-1',
      // The catalog of the run's dataset: its entity and four columns.
      'mapData:shop.orders:4',
      'saveMappedDashboard:Sales Performance 2025',
    ]);
    // No images: Read images is skipped and the notes are ''.
    expect(events.filter((event) => event.startsWith('read-images:'))).toEqual(
      [],
    );
    expect(given.mapData).toHaveBeenCalledWith(
      expect.objectContaining({ imageNotes: '' }),
    );
    expect(
      events.filter(
        (event) =>
          event.endsWith(':success') &&
          !event.startsWith(`${READ_IMAGES_OUTCOME_ID}:`),
      ),
    ).toEqual([
      'load-dashboard:success',
      'load-dashboard-catalog:success',
      'map-data:success',
      'render-dashboard:success',
    ]);
    expect(result.status).toBe('success');
    const answer = mappingExplanation({
      blueprint: BLUEPRINT,
      mapping: MAPPING,
      datasets: ['Shop'],
      entityCount: 1,
      artifactName: 'Sales board',
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
      mapping: MAPPING,
    });
    // What is stored is the fixed runtime's bundle and the explanation.
    expect(given.saveMappedDashboard).toHaveBeenCalledWith({
      bundle: renderDashboardBundle(BLUEPRINT, MAPPING),
      answer,
    });
  });

  it("passes the run's instructions to the mapper, the default when empty", async () => {
    const given = runtime();
    await run(given, '  Prefer the orders table ');
    expect(given.mapData).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Prefer the orders table',
        blueprint: BLUEPRINT,
      }),
    );
    expect(mapDashboardQuestion('  ')).toBe(
      MAP_DASHBOARD_DATA_DEFAULT_QUESTION,
    );
  });

  it("reads the reference images first and hands Zoe's notes to Map data", async () => {
    const given = runtime();
    const readImages = jest.fn(() =>
      Promise.resolve({
        imageNotes: '## Reference images\nA bar chart of sales.',
        imageCount: 1,
        stopped: false,
      }),
    );
    const { events, result } = await run(given, '', {
      paths: ['inputs/images/1.png'],
      reader: { readImages },
    });
    expect(readImages).toHaveBeenCalledWith({
      question: '',
      images: ['inputs/images/1.png'],
    });
    expect(
      events.filter((event) => event.endsWith(':success')).slice(0, 2),
    ).toEqual(['read-images:success', `${READ_IMAGES_OUTCOME_ID}:success`]);
    expect(given.mapData).toHaveBeenCalledWith(
      expect.objectContaining({
        imageNotes: '## Reference images\nA bar chart of sales.',
      }),
    );
    expect(result.status).toBe('success');
  });

  it('ends at Map data when the run is stopped there: nothing is stored', async () => {
    const given = runtime({
      mapData: jest.fn(() =>
        Promise.resolve({ mapping: emptyMapping(), stopped: true }),
      ),
    });
    const { result } = await run(given);
    expect(given.saveMappedDashboard).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.result).toMatchObject({ stopped: true, entityCount: 1 });
  });

  it("fails with the step's own error when the artifact is gone", async () => {
    const given = runtime({
      loadDashboard: jest.fn(() =>
        Promise.reject(new Error('Artifact "a-1" not found')),
      ),
    });
    const { result } = await run(given);
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain(
      'Artifact "a-1" not found',
    );
    expect(given.mapData).not.toHaveBeenCalled();
  });

  it('fails when a step runs without the runtime', async () => {
    const { result } = await run(undefined);
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain(
      'The Load dashboard step has no dashboard to work on',
    );
  });

  it('refuses a step output that breaks the contract', async () => {
    const given = runtime({
      loadDashboard: jest.fn(() =>
        Promise.resolve({ name: 'x', blueprint: { title: 'No widgets' } }),
      ),
    });
    const { result } = await run(given);
    expect(result.status).toBe('failed');
    expect(String((result.error as Error).message)).toContain(
      'Contract violation in Load dashboard',
    );
  });
});
