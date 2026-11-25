/**
 * API-level proof of `GET /conversations` (api.md 168): the conversations of
 * a conversational binding, one row each, newest activity first; 400 without
 * `workflowId`; 404 for a workflow that has no conversations.
 *
 * Drives the BUILT backend (`nest build` first) with a fresh `APP_DATA_DIR`
 * seeded with stored runs. Needs no Postgres and no LLM.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { type Backend, boot, stop } from './backend-process';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-conversations-'));

jest.setTimeout(120_000);

const run = (overrides: Record<string, unknown>) => ({
  workflowName: 'Elena',
  input: {},
  status: 'success',
  steps: [],
  datasets: [],
  ownerId: 'local',
  ...overrides,
});

describe('GET /conversations (api.md 168)', () => {
  let backend: Backend | undefined;

  const get = (path: string) => fetch(`${backend!.url}${path}`);

  beforeAll(async () => {
    // Boot once so the schema exists, seed, boot again.
    backend = await boot(dataDir);
    await stop(backend);
    const db = new BetterSqlite3(join(dataDir, 'app.sqlite'));
    const insert = db.prepare('INSERT INTO workflow_runs (doc) VALUES (?)');
    const runs = [
      run({
        id: 'a1',
        workflowId: 'agent:insights-lead',
        conversationId: 'a1',
        question: 'Who scored most?',
        datasets: ['World Cup'],
        startedAt: '2026-11-01T10:00:00.000Z',
        finishedAt: '2026-11-01T10:01:00.000Z',
      }),
      run({
        id: 'a2',
        workflowId: 'agent:insights-lead',
        conversationId: 'a1',
        question: 'And in 2022?',
        datasets: ['World Cup'],
        startedAt: '2026-11-01T11:00:00.000Z',
        finishedAt: '2026-11-01T11:01:00.000Z',
      }),
      run({
        id: 'b1',
        workflowId: 'agent:insights-lead',
        conversationId: 'b1',
        question: 'Archived one',
        archivedAt: '2026-11-02T00:00:00.000Z',
        startedAt: '2026-11-01T09:00:00.000Z',
      }),
    ];
    for (const r of runs) insert.run(JSON.stringify(r));
    db.close();
    backend = await boot(dataDir);
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists the conversations of Elena, one row each', async () => {
    const res = await get('/conversations?workflowId=agent:insights-lead');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      conversations: Record<string, unknown>[];
    };
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]).toMatchObject({
      id: 'a1',
      title: 'Who scored most?',
      datasets: ['World Cup'],
      runCount: 2,
      lastRunId: 'a2',
      status: 'success',
      lastActivityAt: '2026-11-01T11:01:00.000Z',
    });
  });

  it('lists the archived ones with archived=true and filters with q', async () => {
    const archived = (await (
      await get('/conversations?workflowId=agent:insights-lead&archived=true')
    ).json()) as { conversations: { id: string }[] };
    expect(archived.conversations.map((c) => c.id)).toEqual(['b1']);
    const none = (await (
      await get('/conversations?workflowId=agent:insights-lead&q=zzz')
    ).json()) as { conversations: unknown[] };
    expect(none.conversations).toEqual([]);
  });

  it('answers 400 without workflowId', async () => {
    const res = await get('/conversations');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe(
      'workflowId is required',
    );
  });

  it('answers 404 for a workflow that is not conversational', async () => {
    const res = await get('/conversations?workflowId=nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as { message: string }).message).toBe(
      'Workflow "nope" has no conversations',
    );
  });
});
