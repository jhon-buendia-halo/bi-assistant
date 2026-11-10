// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: (names: string[]) =>
      Promise.resolve(
        names.map((name) => ({
          name,
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          tables: ['wc.public.matches', 'wc.public.teams'],
          entities: [
            {
              key: 'wc.public.matches',
              columns: [{ name: 'id' }, { name: 'year' }],
            },
          ],
        })),
      ),
  }),
}));

import { RequestContext } from '@mastra/core/request-context';
import { qtiV2TurnWorkflow } from './qti-v2-turn.workflow';
import {
  QTI_V2_TURN_RUNTIME_KEY,
  QTI_V2_TURN_WORKFLOW_ID,
  type QtiV2TurnRuntime,
} from './qti-v2-turn.steps';

interface StubWorkflow {
  id: string;
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

const workflow = qtiV2TurnWorkflow as unknown as StubWorkflow;

async function run(question: string, analyse: QtiV2TurnRuntime['analyse']) {
  const requestContext = new RequestContext();
  requestContext.set(QTI_V2_TURN_RUNTIME_KEY, { analyse });
  const output = (await workflow.createRun()).stream({
    inputData: { question, datasets: ['World Cup'] },
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

describe('qti-v2-turn workflow (agents.md 5.11, ADR-0034)', () => {
  it('runs the four steps in order, with their titles', () => {
    expect(workflow.id).toBe(QTI_V2_TURN_WORKFLOW_ID);
    expect(workflow.steps.map((s) => [s.id, s.description])).toEqual([
      ['receive-question', 'Receive question'],
      ['load-catalog', 'Load catalog'],
      ['analyse', 'Analyse'],
      ['wrap-up', 'Wrap up'],
    ]);
  });

  it('hands Analyse the trimmed question and the catalog, and wraps up its SQL calls', async () => {
    const analyse = jest.fn<
      ReturnType<QtiV2TurnRuntime['analyse']>,
      Parameters<QtiV2TurnRuntime['analyse']>
    >(() =>
      Promise.resolve({
        calls: [
          { tool: 'list_entities', failed: false },
          { tool: 'run_readonly_sql', rowCount: 4, failed: false },
          { tool: 'run_readonly_sql', failed: true },
        ],
        stopped: false,
      }),
    );
    const { events, result } = await run('  How many matches?  ', analyse);
    expect(events).toEqual([
      'receive-question:running',
      'receive-question:success',
      'load-catalog:running',
      'load-catalog:success',
      'analyse:running',
      'analyse:success',
      'wrap-up:running',
      'wrap-up:success',
    ]);
    expect(analyse).toHaveBeenCalledWith({
      question: 'How many matches?',
      catalog: [
        {
          entity: 'wc.public.matches',
          dataset: 'World Cup',
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          columnCount: 2,
        },
        {
          entity: 'wc.public.teams',
          dataset: 'World Cup',
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          columnCount: null,
        },
      ],
      catalogBlock: [
        'Catalog loaded for this turn: 2 entities.',
        '- wc.public.matches (dataset: World Cup; 2 columns)',
        '- wc.public.teams (dataset: World Cup; ? columns)',
      ].join('\n'),
    });
    expect(result).toEqual({
      status: 'success',
      result: { sqlQueries: 2, failedQueries: 1, rows: 4 },
    });
  });

  it('fails Receive question on an empty question, before the agent runs', async () => {
    const analyse = jest.fn();
    const { events, result } = await run('   ', analyse);
    expect(events).toEqual([
      'receive-question:running',
      'receive-question:failed',
    ]);
    expect(analyse).not.toHaveBeenCalled();
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe('The question is empty');
  });

  it('fails Analyse with the agent error and never wraps up', async () => {
    const { events, result } = await run('Go', () =>
      Promise.reject(new Error('model down')),
    );
    expect(events.slice(-2)).toEqual(['analyse:running', 'analyse:failed']);
    expect(result).toMatchObject({ status: 'failed' });
    expect((result.error as Error).message).toBe('model down');
  });

  it('ends at Analyse when the turn was stopped', async () => {
    const { events, result } = await run('Go', () =>
      Promise.resolve({ calls: [], stopped: true }),
    );
    expect(events.slice(-2)).toEqual(['analyse:running', 'analyse:bailed']);
    expect(events).not.toContain('wrap-up:running');
    expect(result.status).toBe('success');
  });

  it('fails Analyse when the run has no turn runtime', async () => {
    const output = (await workflow.createRun()).stream({
      inputData: { question: 'Go', datasets: [] },
      requestContext: new RequestContext(),
    });
    for await (const event of output.fullStream) void event;
    const result = await output.result;
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe(
      'The Analyse step has no turn to run',
    );
  });
});
