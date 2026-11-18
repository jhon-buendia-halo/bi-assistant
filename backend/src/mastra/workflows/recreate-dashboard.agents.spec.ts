/**
 * The model calls of Read dashboard and Map data (agents.md 5.17) under the
 * guarded call (workflows R43): one retry of a reset or a cut reply with
 * the same request, a cut reply twice is a failure and never an empty
 * blueprint or mapping, and a deadline per try. The agents are stubbed:
 * Jest cannot load Mastra's ESM.
 */
const readDashboard = jest.fn<Promise<unknown>, unknown[]>();
const mapData = jest.fn<Promise<unknown>, unknown[]>();
jest.mock('../agents/dashboard-reader.agent', () => ({
  dashboardReaderAgent: {
    generate: (...args: unknown[]) => readDashboard(...args),
  },
}));
jest.mock('../agents/data-mapper.agent', () => ({
  dataMapperAgent: { generate: (...args: unknown[]) => mapData(...args) },
}));
jest.mock('../agents/analysis-planner.agent', () => ({
  analysisPlannerAgent: {},
}));
jest.mock('../agents/answer-writer.agent', () => ({ answerWriterAgent: {} }));
jest.mock('../agents/data-readiness.agent', () => ({}));

import type { AgentExchange } from '../agent-threads';
import { ModelTimeoutError, ReplyCutError } from './model-call';
import {
  mapDataWithModel,
  readDashboardWithModel,
} from './recreate-dashboard.agents';
import {
  SAMPLE_BLUEPRINT_REPLY,
  SAMPLE_CATALOG,
  SAMPLE_COLUMNS,
  SAMPLE_MAPPING_REPLY,
} from './recreate-dashboard.sample';
import {
  blueprintOf,
  type DashboardBlueprint,
} from './recreate-dashboard.steps';

const IMAGE = { data: Buffer.from('png bytes'), mediaType: 'image/png' };
const READ_INPUT = { question: 'Recreate it', image: IMAGE };
const MAP_INPUT = {
  question: 'Map it',
  blueprint: blueprintOf(SAMPLE_BLUEPRINT_REPLY) as DashboardBlueprint,
  catalog: SAMPLE_CATALOG,
  columns: SAMPLE_COLUMNS,
};
const reset = () =>
  new TypeError('fetch failed', {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
  });

describe('Read dashboard and Map data under the guarded call (workflows R43)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    readDashboard.mockReset();
    mapData.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('retries Read dashboard once after a reset, with the same request, and reports one line', async () => {
    readDashboard
      .mockRejectedValueOnce(reset())
      .mockResolvedValueOnce({ object: SAMPLE_BLUEPRINT_REPLY, text: '' });
    const lines: string[] = [];
    const pending = readDashboardWithModel(READ_INPUT, {
      onRetry: (line) => lines.push(line),
    });
    await jest.advanceTimersByTimeAsync(2_000);
    const read = await pending;
    expect(read.stopped).toBe(false);
    expect(read.blueprint.title).toBe(SAMPLE_BLUEPRINT_REPLY.title);
    expect(readDashboard).toHaveBeenCalledTimes(2);
    expect(readDashboard.mock.calls[1][0]).toEqual(
      readDashboard.mock.calls[0][0],
    );
    expect(lines).toEqual([
      'Read dashboard: the model call failed (fetch failed). Trying once more in 2 seconds.',
    ]);
  });

  it('reads Read dashboard again after one cut reply', async () => {
    readDashboard
      .mockResolvedValueOnce({
        object: undefined,
        text: '{"title": "Sales',
        finishReason: 'length',
      })
      .mockResolvedValueOnce({
        object: SAMPLE_BLUEPRINT_REPLY,
        text: '',
        finishReason: 'stop',
      });
    const exchanges: AgentExchange[] = [];
    const pending = readDashboardWithModel(READ_INPUT, {
      onExchange: (exchange) => void exchanges.push(exchange),
    });
    await jest.advanceTimersByTimeAsync(2_000);
    expect((await pending).blueprint.title).toBe(SAMPLE_BLUEPRINT_REPLY.title);
    // Only the reply that was read is recorded.
    expect(exchanges).toHaveLength(1);
  });

  it('fails Map data with ReplyCutError when its reply is cut twice, never an empty mapping', async () => {
    mapData.mockResolvedValue({
      object: undefined,
      text: '{"approach": "',
      finishReason: 'length',
    });
    const pending = mapDataWithModel(MAP_INPUT, {}).catch(
      (error: Error) => error,
    );
    await jest.advanceTimersByTimeAsync(2_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ReplyCutError);
    expect((error as Error).message).toContain(
      "Map data failed: the model's reply was cut at its output limit (8000 tokens)",
    );
    expect(mapData).toHaveBeenCalledTimes(2);
  });

  it('fails Map data with ModelTimeoutError past five minutes, and does not retry it', async () => {
    mapData.mockImplementation(() => new Promise(() => undefined));
    const pending = mapDataWithModel(MAP_INPUT, {
      abortSignal: new AbortController().signal,
    }).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    const error = await pending;
    expect(error).toBeInstanceOf(ModelTimeoutError);
    expect((error as Error).message).toContain(
      'Map data failed: the model did not answer within 5 minutes',
    );
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(mapData).toHaveBeenCalledTimes(1);
  });

  it('maps as before when the reply is whole', async () => {
    mapData.mockResolvedValue({
      object: SAMPLE_MAPPING_REPLY,
      text: '',
      finishReason: 'stop',
    });
    const mapped = await mapDataWithModel(MAP_INPUT, {});
    expect(mapped.stopped).toBe(false);
    expect(mapped.mapping.widgets.length).toBeGreaterThan(0);
    expect(mapData).toHaveBeenCalledTimes(1);
  });

  it('a Stop is a stop, not retried', async () => {
    const run = new AbortController();
    mapData.mockImplementation(() => {
      run.abort();
      return Promise.reject(reset());
    });
    await expect(
      mapDataWithModel(MAP_INPUT, { abortSignal: run.signal }),
    ).resolves.toMatchObject({ stopped: true });
    expect(mapData).toHaveBeenCalledTimes(1);
  });
});
