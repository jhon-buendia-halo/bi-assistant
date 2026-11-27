/**
 * API-level proof of the success statuses specs/system/api.md states for
 * POST routes that do not answer the framework's default 201 (section 1.4):
 * the two streams answer 200 once they start, even when the stream carries
 * an `error` event (3.1, 3.4), and the developer endpoint test (55) and the
 * testing-data load (56) answer 200 with a Style A body.
 *
 * It drives the BUILT backend (`npm run build` first) with a
 * fresh `APP_DATA_DIR`. Needs no Postgres and no LLM.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Backend, boot, stop } from './backend-process';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-response-status-'));

jest.setTimeout(120_000);

describe('POST routes the spec answers with 200 (api.md 1.4)', () => {
  let backend: Backend | undefined;

  const post = (path: string, body: unknown) =>
    fetch(`${backend!.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    backend = await boot(dataDir);
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('the chat write routes removed in 1.23.27 answer 404', async () => {
    for (const path of [
      '/sessions',
      '/sessions/s1/messages',
      '/sessions/s1/messages/stream',
      '/sessions/s1/messages/feedback',
      '/sessions/s1/visualizations',
      '/sessions/s1/visualizations/v1/tailor',
      '/sessions/s1/deep-analysis',
    ]) {
      expect({ path, status: (await post(path, {})).status }).toEqual({
        path,
        status: 404,
      });
    }
  });

  it('the deep-analysis report download removed in 1.23.35 answers 404 (48)', async () => {
    const res = await fetch(
      `${backend!.url}/sessions/s1/deep-analysis/job-1/download`,
    );
    expect(res.status).toBe(404);
  });

  it('the developer endpoint test answers 200 with a Style A body (55)', async () => {
    const res = await post('/developer-settings/test-endpoint', {
      endpoint: 'http://127.0.0.1:1',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/^Unreachable/);
  });

  it("the visual designer's run routes removed with ADR-0059 answer 404 (130, 131, 134)", async () => {
    for (const path of [
      '/workflow-runs/r1/visualizations',
      '/workflow-runs/r1/visualizations/v1/tailor',
      '/workflow-runs/r1/visualizations/v1/repair',
    ]) {
      const res = await post(path, { instruction: 'x', error: 'x' });
      const body = (await res.json()) as { message: string };
      expect({ path, status: res.status, message: body.message }).toEqual({
        path,
        status: 404,
        message: `Cannot POST ${path}`,
      });
    }
  });

  it("refuses a draft run's resume before the stream (169, Style B): 404 agent, 400 no dataset, 404 run", async () => {
    const json = async (res: Response) =>
      ({ status: res.status, ...((await res.json()) as object) }) as {
        status: number;
        message?: string;
      };
    const resume = (agentId: string, runId: string) =>
      post(`/agents/${agentId}/draft-runs/${runId}/resume/stream`, {
        stepId: 'answer',
        answer: 'Matches won',
      });
    expect(await json(await resume('nope', 'r1'))).toMatchObject({
      status: 404,
      message: 'Agent "nope" not found',
    });
    const agentOf = async (name: string, datasets: string[]) => {
      const created = (await (
        await post('/agents', { name, datasets })
      ).json()) as { agent?: { id: string }; message?: string };
      if (!created.agent) throw new Error(created.message);
      return created.agent.id;
    };
    const noData = await agentOf('No data agent', ['Gone']);
    expect(await json(await resume(noData, 'r1'))).toMatchObject({
      status: 400,
      message: 'Select at least one dataset to preview',
    });
    // A dataset on a datasource nobody can reach: the refusals need no data.
    const { datasource } = (await (
      await post('/datasources', {
        kind: 'postgres',
        name: 'Closed port',
        config: {
          host: '127.0.0.1',
          port: 1,
          database: 'none',
          user: 'none',
          password: 'none',
          ssl: false,
        },
      })
    ).json()) as { datasource: { id: string } };
    await post('/datasets', {
      name: 'Resume Core',
      tables: ['world_cup.world_cup.matches'],
      entities: [
        {
          key: 'world_cup.world_cup.matches',
          columns: [{ name: 'match_number', type: 'integer', nullable: false }],
        },
      ],
      datasourceId: datasource.id,
      datasourceKind: 'postgres',
    });
    const withData = await agentOf('Resume agent', ['Resume Core']);
    expect(await json(await resume(withData, 'r-unknown'))).toMatchObject({
      status: 404,
      message: 'Run "r-unknown" not found',
    });
  });

  it('the testing-data load answers 200 with a Style A body (56)', async () => {
    const res = await post('/testing-data/not-a-sample/load', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      message: 'Unknown sample fixture "not-a-sample"',
    });
  });
});
