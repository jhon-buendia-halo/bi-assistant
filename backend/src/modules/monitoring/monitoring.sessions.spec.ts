import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DuckDBConnection } from '@mastra/duckdb';
import type { SessionsRepository } from '../sessions/repositories/sessions.repository';
import type { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
import { MonitoringService } from './monitoring.service';
import { SpanEventsRepository } from './repositories/span-events.repository';
import {
  cloneTrace,
  createSpanEventsTable,
  flowRows,
  GEN_2,
  insertSpanEvents,
  THREAD_ID,
  TRACE_1,
  TRACE_2,
  TRACE_3,
} from './testing/span-events.fixture';

/**
 * Sessions, their flow and one turn's tree, read from a real DuckDB (in
 * memory) holding the export's rows, through the SQL the app runs.
 *
 * - THREAD_ID: the export's two finished turns ("World Cup goals").
 * - session-rfp: turn 2 copied a day earlier, run by the RFP Builder, its
 *   model call failed.
 * - session-live: the export's third run (no end rows) given a thread an
 *   hour later: running.
 */

const HOUR = 3_600_000;
const RFP = 'session-rfp';
const LIVE = 'session-live';

function sessionsWith(names: Record<string, string>): SessionsRepository {
  return {
    get: (id: string) =>
      Promise.resolve(names[id] ? { id, name: names[id] } : null),
  } as unknown as SessionsRepository;
}

function runsWith(
  docs: Record<string, { workflowName: string; question?: string }>,
): WorkflowRunsRepository {
  return {
    get: (id: string) =>
      Promise.resolve(
        docs[id] ? { id, input: {}, ...docs[id] } : null,
      ),
  } as unknown as WorkflowRunsRepository;
}

async function serviceWith(
  rows: Record<string, unknown>[] | null,
): Promise<MonitoringService> {
  const db = new DuckDBConnection({ path: ':memory:' });
  if (rows) {
    await createSpanEventsTable(db);
    await insertSpanEvents(db, rows);
  }
  return new MonitoringService(
    new SpanEventsRepository(db),
    sessionsWith({ [THREAD_ID]: 'World Cup goals' }),
    runsWith({}),
  );
}

function fixtureSessions(): Record<string, unknown>[] {
  const rows = flowRows();
  const rfp = cloneTrace(rows, TRACE_2, {
    suffix: 'rfp',
    shiftMs: -24 * HOUR,
    threadId: RFP,
  }).map((r) => {
    const out = { ...r };
    if (r.spanType === 'agent_run') {
      out.entityId = 'rfp';
      out.entityName = 'RFP Builder';
    }
    if (r.spanId === `${GEN_2}-rfp` && r.eventType === 'end') {
      out.error = { message: 'Overloaded', name: 'APICallError' };
    }
    return out;
  });
  const live = cloneTrace(rows, TRACE_3, {
    suffix: 'live',
    shiftMs: HOUR,
    threadId: LIVE,
  });
  return [...rows, ...rfp, ...live];
}

describe('MonitoringService sessions (DuckDB span_events)', () => {
  let service: MonitoringService;

  beforeAll(async () => {
    service = await serviceWith(fixtureSessions());
  });

  describe('listSessions', () => {
    it('lists one row per thread of agent runs, most recent first', async () => {
      const page = await service.listSessions({});
      expect(page.total).toBe(3);
      expect(page.page).toBe(1);
      expect(page.pageSize).toBe(25);
      expect(page.items.map((s) => s.id)).toEqual([LIVE, THREAD_ID, RFP]);
    });

    it("sums the session's calls: tokens, cost and model time equal the LLM calls of the session", async () => {
      const { items } = await service.listSessions({});
      const row = items.find((s) => s.id === THREAD_ID)!;
      const calls = (await service.listCalls({ session: THREAD_ID })).items;
      const sum = (pick: (c: (typeof calls)[number]) => number | null) =>
        calls.reduce((n, c) => n + (pick(c) ?? 0), 0);
      expect(calls).toHaveLength(2);
      expect(row.inputTokens).toBe(sum((c) => c.inputTokens));
      expect(row.outputTokens).toBe(sum((c) => c.outputTokens));
      expect(row.modelMs).toBe(sum((c) => c.durationMs));
      expect(row.costUsd).toBeCloseTo(
        sum((c) => c.costUsd),
        10,
      );
      expect(row).toMatchObject({
        name: 'World Cup goals',
        agents: [{ id: 'assistant', name: 'Questions to Insights Assistant' }],
        turns: 2,
        firstAt: '2026-11-10T19:43:43.223Z',
        lastAt: '2026-11-10T19:44:01.629Z',
        wallMs: 18310 + 2592,
        modelMs: 18261 + 2579,
        toolCalls: 3,
        inputTokens: 79225,
        outputTokens: 2644,
        errors: 0,
        status: 'succeeded',
      });
    });

    it('marks a session with a failed span as failed; an unknown session has no name', async () => {
      const { items } = await service.listSessions({});
      const row = items.find((s) => s.id === RFP)!;
      expect(row).toMatchObject({
        name: null,
        agents: [{ id: 'rfp', name: 'RFP Builder' }],
        turns: 1,
        errors: 1,
        status: 'failed',
        firstAt: '2026-11-09T19:44:01.629Z',
      });
    });

    it('marks a session with a turn still going as running', async () => {
      const { items } = await service.listSessions({});
      const row = items.find((s) => s.id === LIVE)!;
      expect(row).toMatchObject({
        turns: 1,
        wallMs: null,
        modelMs: null,
        inputTokens: null,
        costUsd: null,
        toolCalls: 0,
        errors: 0,
        status: 'running',
      });
    });

    it.each([
      [{ agent: 'rfp' }, [RFP]],
      [{ agent: 'assistant' }, [LIVE, THREAD_ID]],
      [{ agent: 'nobody' }, []],
      [{ from: '2026-11-10T19:44:00Z' }, [LIVE, THREAD_ID]],
      [{ from: '2026-11-10T20:00:00Z' }, [LIVE]],
      [{ to: '2026-11-10T19:43:43.223Z' }, [THREAD_ID, RFP]],
      [
        { from: '2026-11-10T19:44:00Z', to: '2026-11-10T19:45:00Z' },
        [THREAD_ID],
      ],
      [{ agent: 'assistant', to: '2026-11-10T12:00:00Z' }, []],
    ])('filters by %j', async (query, ids) => {
      const page = await service.listSessions(query);
      expect(page.items.map((s) => s.id)).toEqual(ids);
      expect(page.total).toBe(ids.length);
    });

    it('takes filter values as parameters, never as SQL', async () => {
      const page = await service.listSessions({ agent: "x' OR '1'='1" });
      expect(page.total).toBe(0);
    });

    it('builds the agent facet from every session, whatever the filters, sorted by name', async () => {
      const page = await service.listSessions({ agent: 'rfp' });
      expect(page.facets).toEqual({
        agents: [
          { id: 'assistant', name: 'Questions to Insights Assistant' },
          { id: 'rfp', name: 'RFP Builder' },
        ],
      });
    });

    it('rejects an invalid query with the LLM calls messages', async () => {
      await expect(service.listSessions({ pageSize: '10' })).rejects.toThrow(
        new BadRequestException('Page size must be 25, 50 or 100'),
      );
      await expect(service.listSessions({ page: '0' })).rejects.toThrow(
        new BadRequestException('Page must be a positive whole number'),
      );
      await expect(service.listSessions({ from: 'soon' })).rejects.toThrow(
        new BadRequestException('From is not a valid date'),
      );
    });

    it('pages with LIMIT / OFFSET and counts every session', async () => {
      const base = flowRows();
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < 30; i++) {
        rows.push(
          ...cloneTrace(base, TRACE_2, {
            suffix: `p${i}`,
            shiftMs: i * 60_000,
            threadId: `paged-${String(i).padStart(2, '0')}`,
          }),
        );
      }
      const paged = await serviceWith(rows);
      const first = await paged.listSessions({});
      expect(first.total).toBe(30);
      expect(first.items).toHaveLength(25);
      expect(first.items[0].id).toBe('paged-29');
      const second = await paged.listSessions({ page: '2' });
      expect(second.items.map((s) => s.id)).toEqual([
        'paged-04',
        'paged-03',
        'paged-02',
        'paged-01',
        'paged-00',
      ]);
      expect((await paged.listSessions({ pageSize: '50' })).items).toHaveLength(
        30,
      );
      const beyond = await paged.listSessions({ page: '9' });
      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(30);
    });
  });

  describe('an empty or missing trace store', () => {
    it('returns an empty page when span_events does not exist yet', async () => {
      const empty = await serviceWith(null);
      await expect(
        empty.listSessions({ page: '2', pageSize: '50' }),
      ).resolves.toEqual({
        items: [],
        total: 0,
        page: 2,
        pageSize: 50,
        facets: { agents: [] },
      });
    });

    it('returns an empty page when no agent run has a thread', async () => {
      const noThreads = await serviceWith(
        flowRows().filter((r) => r.traceId === TRACE_3),
      );
      const page = await noThreads.listSessions({});
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
      expect(page.facets.agents).toEqual([]);
    });

    it('answers 404 for a session or a trace when the store is missing', async () => {
      const empty = await serviceWith(null);
      await expect(empty.getSession(THREAD_ID)).rejects.toThrow(
        NotFoundException,
      );
      await expect(empty.getTrace(TRACE_1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSession', () => {
    it('answers 404 "Session not found" for an unknown id', async () => {
      await expect(service.getSession('nope')).rejects.toThrow(
        new NotFoundException('Session not found'),
      );
    });

    it('returns the row with its two turns, questions, answers and paths', async () => {
      const detail = await service.getSession(THREAD_ID);
      expect(detail).toMatchObject({
        id: THREAD_ID,
        name: 'World Cup goals',
        turns: 2,
        status: 'succeeded',
      });
      expect(
        detail.turnList.map((t) => [t.index, t.traceId, t.question, t.status]),
      ).toEqual([
        [1, TRACE_1, 'Which team scored the most goals in total?', 'succeeded'],
        [2, TRACE_2, 'And the second?', 'succeeded'],
      ]);
      expect(detail.turnList[0].steps.map((s) => s.kind)).toEqual([
        'model',
        'tools',
        'model',
        'tools',
        'model',
        'tools',
        'model',
      ]);
      expect(detail.turnList[1].answer).toMatch(/^\*\*Croatia\*\* is second/);
    });

    it("returns a failed turn's error", async () => {
      const detail = await service.getSession(RFP);
      expect(detail.turnList).toHaveLength(1);
      expect(detail.turnList[0]).toMatchObject({
        status: 'failed',
        error: 'Overloaded',
        agent: { id: 'rfp', name: 'RFP Builder' },
      });
    });

    it('returns a running turn with no duration and no answer', async () => {
      const detail = await service.getSession(LIVE);
      expect(detail.turnList[0]).toMatchObject({
        status: 'running',
        durationMs: null,
        answer: null,
        question: 'And the second?',
      });
    });
  });

  describe('getTrace', () => {
    it('answers 404 "Trace not found" for an unknown trace', async () => {
      await expect(service.getTrace('nope')).rejects.toThrow(
        new NotFoundException('Trace not found'),
      );
    });

    it('returns the tree with framework spans hidden by default', async () => {
      const tree = await service.getTrace(TRACE_1);
      expect(tree.spans).toHaveLength(11);
      expect(tree.hiddenFramework).toBe(17);
      expect(tree.spans[0]).toMatchObject({
        label: 'agent run · assistant',
        depth: 0,
        startMs: 0,
      });
      expect(tree.durationMs).toBe(18310);
    });

    it('shows them with framework=true and never reads model_chunk rows', async () => {
      const withChunk = await serviceWith([
        ...flowRows(),
        {
          eventType: 'start',
          timestamp: '2026-11-10 19:43:44.300',
          traceId: TRACE_1,
          spanId: 'chunk-0000000001',
          parentSpanId: '01a4130fe46f6d51',
          entityType: 'agent',
          entityId: 'assistant',
          name: "chunk: 'text-delta'",
          spanType: 'model_chunk',
        },
      ]);
      const tree = await withChunk.getTrace(TRACE_1, 'true');
      expect(tree.hiddenFramework).toBe(0);
      expect(tree.spans).toHaveLength(28);
      expect(tree.spans.some((s) => s.type === 'model_chunk')).toBe(false);
      expect((await withChunk.getTrace(TRACE_1, 'false')).spans).toHaveLength(
        11,
      );
    });
  });
});
