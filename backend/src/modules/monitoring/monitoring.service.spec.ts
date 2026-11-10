import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DuckDBConnection } from '@mastra/duckdb';
import type { SessionsRepository } from '../sessions/repositories/sessions.repository';
import { MonitoringService } from './monitoring.service';
import { SpanEventsRepository } from './repositories/span-events.repository';
import {
  createSpanEventsTable,
  fixtureRows,
  GEN_1,
  GEN_2,
  GEN_3,
  insertSpanEvents,
  THREAD_ID,
} from './testing/span-events.fixture';

/**
 * Integration-style: real DuckDB (in memory) with a `span_events` table
 * created from the export's column list and filled with the fixture rows,
 * read through the same SQL the app runs against observability.duckdb.
 */

const FAILED = 'f00000000000fa11';
const UNPRICED = 'u0000000000000c0';

/** A finished generation built from turn 2's end row, with overrides. */
function generation(
  spanId: string,
  startedAt: string,
  endedAt: string,
  overrides: Record<string, unknown> = {},
  attributes: Record<string, unknown> = {},
): Record<string, unknown>[] {
  const end = fixtureRows().find(
    (r) => r.spanId === GEN_2 && r.eventType === 'end',
  )!;
  const base = {
    ...end,
    traceId: `trace-${spanId}`,
    spanId,
    attributes: { ...(end.attributes as object), ...attributes },
    ...overrides,
  };
  return [
    {
      ...base,
      eventType: 'start',
      timestamp: startedAt,
      cursorId: undefined,
      endedAt: undefined,
      output: undefined,
      error: undefined,
    },
    { ...base, eventType: 'end', timestamp: endedAt, endedAt },
  ];
}

function sessionsWith(names: Record<string, string>): SessionsRepository {
  return {
    get: (id: string) =>
      Promise.resolve(names[id] ? { id, name: names[id] } : null),
  } as unknown as SessionsRepository;
}

async function serviceWith(
  rows: Record<string, unknown>[] | null,
  names: Record<string, string> = { [THREAD_ID]: 'World Cup goals' },
): Promise<MonitoringService> {
  const db = new DuckDBConnection({ path: ':memory:' });
  if (rows) {
    await createSpanEventsTable(db);
    await insertSpanEvents(db, rows);
  }
  return new MonitoringService(
    new SpanEventsRepository(db),
    sessionsWith(names),
  );
}

describe('MonitoringService (DuckDB span_events)', () => {
  let service: MonitoringService;

  beforeAll(async () => {
    service = await serviceWith([
      ...fixtureRows(),
      ...generation(
        FAILED,
        '2026-11-09 08:00:00',
        '2026-11-09 08:00:02.5',
        {
          entityId: 'rfp',
          entityName: 'RFP Builder',
          threadId: 'deleted-session',
          error: { message: 'Overloaded', name: 'APICallError' },
        },
        { model: 'claude-haiku-4-5', provider: 'anthropic.chat' },
      ),
      ...generation(
        UNPRICED,
        '2026-11-08 12:00:00',
        '2026-11-08 12:00:01',
        { threadId: undefined, metadata: { runId: 'r' } },
        { model: 'gpt-x', provider: 'openai.chat' },
      ),
    ]);
  });

  describe('listCalls', () => {
    it('lists one row per model_generation, newest first', async () => {
      const page = await service.listCalls({});
      expect(page.total).toBe(5);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      expect(page.items.map((r) => r.id)).toEqual([
        GEN_3,
        GEN_2,
        GEN_1,
        FAILED,
        UNPRICED,
      ]);
    });

    it('maps a finished call: times, agent, session, tokens and cost', async () => {
      const { items } = await service.listCalls({});
      const row = items.find((r) => r.id === GEN_1)!;
      expect(row).toEqual({
        id: GEN_1,
        traceId: '475663b72c2cb0693ab26f2cde457a1c',
        startedAt: '2026-11-10T19:43:43.249Z',
        endedAt: '2026-11-10T19:44:01.510Z',
        durationMs: 18261,
        agent: { id: 'assistant', name: 'Questions to Insights Assistant' },
        model: 'claude-sonnet-5-5',
        provider: 'anthropic.messages',
        session: { id: THREAD_ID, name: 'World Cup goals' },
        inputTokens: 61185,
        outputTokens: 2445,
        cacheReadTokens: 43532,
        cacheWriteTokens: 17645,
        reasoningTokens: 234,
        costUsd: expect.closeTo(0.0729317, 7) as number,
        status: 'succeeded',
      });
    });

    it('maps a running call: no end, no usage, no cost, no session', async () => {
      const { items } = await service.listCalls({});
      const row = items.find((r) => r.id === GEN_3)!;
      expect(row.status).toBe('running');
      expect(row.endedAt).toBeNull();
      expect(row.durationMs).toBeNull();
      expect(row.inputTokens).toBeNull();
      expect(row.costUsd).toBeNull();
      expect(row.session).toBeNull();
    });

    it('marks a call with an error as failed; an unknown session has no name', async () => {
      const { items } = await service.listCalls({});
      const row = items.find((r) => r.id === FAILED)!;
      expect(row.status).toBe('failed');
      expect(row.durationMs).toBe(2500);
      expect(row.session).toEqual({ id: 'deleted-session', name: null });
      expect(row.agent).toEqual({ id: 'rfp', name: 'RFP Builder' });
    });

    it('has no cost for a model without a price', async () => {
      const { items } = await service.listCalls({});
      const row = items.find((r) => r.id === UNPRICED)!;
      expect(row.model).toBe('gpt-x');
      expect(row.inputTokens).toBe(18040);
      expect(row.costUsd).toBeNull();
      expect(row.session).toBeNull();
    });

    it.each([
      [{ agent: 'rfp' }, [FAILED]],
      [{ agent: 'assistant' }, [GEN_3, GEN_2, GEN_1, UNPRICED]],
      [{ model: 'claude-haiku-4-5' }, [FAILED]],
      [{ provider: 'openai.chat' }, [UNPRICED]],
      [{ status: 'running' }, [GEN_3]],
      [{ status: 'failed' }, [FAILED]],
      [{ status: 'succeeded' }, [GEN_2, GEN_1, UNPRICED]],
      [{ session: THREAD_ID }, [GEN_2, GEN_1]],
      [{ from: '2026-11-10T19:44:00Z' }, [GEN_3, GEN_2]],
      [{ to: '2026-11-09T08:00:00Z' }, [FAILED, UNPRICED]],
      [
        { from: '2026-11-09T00:00:00Z', to: '2026-11-10T19:43:43.249Z' },
        [GEN_1, FAILED],
      ],
      [
        { agent: 'assistant', status: 'succeeded', session: THREAD_ID },
        [GEN_2, GEN_1],
      ],
      [{ model: 'no-such-model' }, []],
    ])('filters by %j', async (query, ids) => {
      const page = await service.listCalls(query);
      expect(page.items.map((r) => r.id)).toEqual(ids);
      expect(page.total).toBe(ids.length);
    });

    it('takes filter values as parameters, never as SQL', async () => {
      const page = await service.listCalls({ agent: "x' OR '1'='1" });
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('builds the facets from all calls, whatever the filters, sorted by name', async () => {
      const page = await service.listCalls({ status: 'failed' });
      expect(page.facets).toEqual({
        agents: [
          { id: 'assistant', name: 'Questions to Insights Assistant' },
          { id: 'rfp', name: 'RFP Builder' },
        ],
        models: ['claude-haiku-4-5', 'claude-sonnet-5-5', 'gpt-x'],
        providers: ['anthropic.chat', 'anthropic.messages', 'openai.chat'],
        sessions: [
          { id: 'deleted-session', name: null },
          { id: THREAD_ID, name: 'World Cup goals' },
        ],
      });
    });

    it('rejects an invalid query with 400', async () => {
      await expect(service.listCalls({ pageSize: '10' })).rejects.toThrow(
        new BadRequestException('Page size must be 25, 50 or 100'),
      );
    });
  });

  describe('paging', () => {
    it('pages with LIMIT / OFFSET and counts every match', async () => {
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < 30; i++) {
        const minute = String(i).padStart(2, '0');
        rows.push(
          ...generation(
            `paged-${minute}`,
            `2026-11-01 10:${minute}:00`,
            `2026-11-01 10:${minute}:05`,
          ),
        );
      }
      const paged = await serviceWith(rows);
      const first = await paged.listCalls({});
      expect(first.total).toBe(30);
      expect(first.items).toHaveLength(25);
      expect(first.items[0].id).toBe('paged-29');
      const second = await paged.listCalls({ page: '2' });
      expect(second.page).toBe(2);
      expect(second.items.map((r) => r.id)).toEqual([
        'paged-04',
        'paged-03',
        'paged-02',
        'paged-01',
        'paged-00',
      ]);
      const big = await paged.listCalls({ pageSize: '50' });
      expect(big.items).toHaveLength(30);
      const beyond = await paged.listCalls({ page: '9' });
      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(30);
    });

    it('breaks a tie on started-at by spanId', async () => {
      const paged = await serviceWith([
        ...generation('tie-a', '2026-11-01 10:00:00', '2026-11-01 10:00:01'),
        ...generation('tie-b', '2026-11-01 10:00:00', '2026-11-01 10:00:01'),
      ]);
      const page = await paged.listCalls({});
      expect(page.items.map((r) => r.id)).toEqual(['tie-b', 'tie-a']);
    });
  });

  describe('an empty or missing trace store', () => {
    it('returns an empty page when span_events does not exist yet', async () => {
      const empty = await serviceWith(null);
      await expect(
        empty.listCalls({ page: '2', pageSize: '50' }),
      ).resolves.toEqual({
        items: [],
        total: 0,
        page: 2,
        pageSize: 50,
        facets: { agents: [], models: [], providers: [], sessions: [] },
      });
    });

    it('returns an empty page when span_events has no calls', async () => {
      const empty = await serviceWith([]);
      const page = await empty.listCalls({});
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.facets.models).toEqual([]);
    });

    it('answers 404 for a call when the store is missing', async () => {
      const empty = await serviceWith(null);
      await expect(empty.getCall(GEN_1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getCall', () => {
    it('answers 404 "LLM call not found" for an unknown id', async () => {
      await expect(service.getCall('nope')).rejects.toThrow(
        new NotFoundException('LLM call not found'),
      );
    });

    it('answers 404 for a span that is not a model_generation', async () => {
      // 02db36c1c46e4377 is turn 1's first model_step.
      await expect(service.getCall('02db36c1c46e4377')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the call with its facts, steps and context window', async () => {
      const detail = await service.getCall(GEN_1);
      expect(detail.id).toBe(GEN_1);
      expect(detail.status).toBe('succeeded');
      expect(detail.finishReason).toBe('stop');
      expect(detail.timeToFirstTokenMs).toBe(1025);
      expect(detail.error).toBeNull();
      expect(detail.contextLimit).toBe(1_000_000);
      expect(detail.contextTokens).toBe(17647);
      // The fixture keeps only the steps' end rows, so each step starts and
      // ends at the same instant here.
      const step = (
        index: number,
        inputTokens: number,
        outputTokens: number,
        finishReason: string,
      ) => ({ index, inputTokens, outputTokens, finishReason, durationMs: 0 });
      expect(detail.steps).toEqual([
        step(0, 12320, 409, 'tool-calls'),
        step(1, 14738, 918, 'tool-calls'),
        step(2, 16480, 733, 'tool-calls'),
        step(3, 17647, 385, 'stop'),
      ]);
      expect(detail.segments.map((s) => s.key)).toEqual([
        'system-prompt',
        'skills',
        'tools',
        'chat-history',
        'dataset',
        'user-prompt',
        'tool-results',
      ]);
      expect(detail.segments.reduce((sum, s) => sum + s.tokens, 0)).toBe(17647);
      expect(
        detail.segments.find((s) => s.key === 'tool-results')!.items,
      ).toHaveLength(3);
    });

    it('returns a running call with no steps finished and no context size', async () => {
      const detail = await service.getCall(GEN_3);
      expect(detail.status).toBe('running');
      expect(detail.contextTokens).toBeNull();
      expect(detail.finishReason).toBeNull();
      expect(detail.timeToFirstTokenMs).toBeNull();
      expect(detail.steps).toEqual([
        {
          index: 0,
          inputTokens: null,
          outputTokens: null,
          finishReason: null,
          durationMs: null,
        },
      ]);
      expect(detail.segments).toHaveLength(7);
    });

    it("returns a failed call's error message", async () => {
      const detail = await service.getCall(FAILED);
      expect(detail.status).toBe('failed');
      expect(detail.error).toBe('Overloaded');
      expect(detail.contextLimit).toBe(200_000);
    });

    it('has no context limit for a model without a price', async () => {
      const detail = await service.getCall(UNPRICED);
      expect(detail.contextLimit).toBeNull();
      expect(detail.contextTokens).toBe(18040);
    });
  });
});
