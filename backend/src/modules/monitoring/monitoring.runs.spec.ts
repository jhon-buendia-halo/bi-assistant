import { DuckDBConnection } from '@mastra/duckdb';
import type { SessionsRepository } from '../sessions/repositories/sessions.repository';
import type { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
import { MonitoringService } from './monitoring.service';
import { SpanEventsRepository } from './repositories/span-events.repository';
import {
  cloneTrace,
  createSpanEventsTable,
  flowRows,
  insertSpanEvents,
  THREAD_ID,
  TRACE_1,
  TRACE_2,
} from './testing/span-events.fixture';

/**
 * 1.23.20: a run's agent call carries the run host id `run-<id>` as its
 * thread (ADR-0041); Monitoring names it from the stored run.
 */

const FOUND = 'run-found';
const DELETED = 'run-deleted';
const UNKNOWN = 'run-unknown';

async function serviceWith(): Promise<MonitoringService> {
  const db = new DuckDBConnection({ path: ':memory:' });
  await createSpanEventsTable(db);
  const rows = flowRows();
  await insertSpanEvents(db, [
    ...rows.filter((r) => r.traceId === TRACE_1),
    ...cloneTrace(rows, TRACE_2, {
      suffix: 'found',
      shiftMs: 1000,
      threadId: FOUND,
    }),
    ...cloneTrace(rows, TRACE_2, {
      suffix: 'deleted',
      shiftMs: 2000,
      threadId: DELETED,
    }),
    ...cloneTrace(rows, TRACE_2, {
      suffix: 'unknown',
      shiftMs: 3000,
      threadId: UNKNOWN,
    }),
  ]);
  const sessions = {
    get: (id: string) =>
      Promise.resolve(
        id === THREAD_ID ? { id, name: 'World Cup goals' } : null,
      ),
  } as unknown as SessionsRepository;
  const runs = {
    get: (id: string) =>
      Promise.resolve(
        id === 'found'
          ? {
              id,
              workflowName: 'Assistant',
              question: 'Top scorers?',
              input: {},
            }
          : null,
      ),
  } as unknown as WorkflowRunsRepository;
  return new MonitoringService(new SpanEventsRepository(db), sessions, runs);
}

describe('MonitoringService: runs (ADR-0041)', () => {
  let service: MonitoringService;

  beforeAll(async () => {
    service = await serviceWith();
  });

  it('names a run thread from its stored run and links it', async () => {
    const page = await service.listCalls({ pageSize: '100' });
    const found = page.items.filter((i) => i.session?.id === FOUND);
    expect(found.length).toBeGreaterThan(0);
    for (const row of found) {
      expect(row.session).toEqual({
        id: FOUND,
        name: 'Assistant: Top scorers?',
        runId: 'found',
      });
    }
  });

  it('leaves a deleted run and an unknown run unnamed and unlinked', async () => {
    const page = await service.listCalls({ pageSize: '100' });
    for (const id of [DELETED, UNKNOWN]) {
      const rows = page.items.filter((i) => i.session?.id === id);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0].session).toEqual({ id, name: null });
    }
  });

  it('keeps a chat session as it was', async () => {
    const page = await service.listCalls({ pageSize: '100' });
    const chat = page.items.find((i) => i.session?.id === THREAD_ID);
    expect(chat?.session).toEqual({ id: THREAD_ID, name: 'World Cup goals' });
  });

  it('offers the run in the session facet, and filters by it', async () => {
    const page = await service.listCalls({ pageSize: '100', session: FOUND });
    expect(page.facets.sessions).toContainEqual({
      id: FOUND,
      name: 'Assistant: Top scorers?',
      runId: 'found',
    });
    expect(page.items.every((i) => i.session?.id === FOUND)).toBe(true);
  });

  it('shows a run on the call detail and its execution flow', async () => {
    const [row] = (await service.listCalls({ session: FOUND })).items;
    const call = await service.getCall(row.id);
    expect(call.session).toMatchObject({ id: FOUND, runId: 'found' });
    const flow = await service.getSession(FOUND);
    expect(flow.name).toBe('Assistant: Top scorers?');
    expect(flow.runId).toBe('found');
    expect(flow.turns).toBeGreaterThan(0);
  });

  it('lists the run among the sessions', async () => {
    const page = await service.listSessions({});
    const run = page.items.find((i) => i.id === FOUND);
    expect(run).toMatchObject({
      name: 'Assistant: Top scorers?',
      runId: 'found',
    });
  });
});
