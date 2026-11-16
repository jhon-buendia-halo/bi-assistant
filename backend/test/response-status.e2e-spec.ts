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
  /** The `data:` frames of a stream (api.md 3.1). */
  const frames = async (res: Response) =>
    (await res.text())
      .split('\n\n')
      .filter((frame) => frame.startsWith('data: '))
      .map(
        (frame) =>
          JSON.parse(frame.slice(6)) as {
            type: string;
            content?: string;
            message?: string;
          },
      );

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

  it('the ontology bootstrap stream answers 200 and reports a failure in the stream (3.4)', async () => {
    const res = await post(
      '/datasets/no-such-dataset/ontology/bootstrap/stream',
      {},
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    // Here the error text is in `message`, not `content` (api.md 3.4). The
    // dataset stage is reported before the lookup fails.
    const events = (await frames(res)) as { type: string }[];
    expect(events.at(-1)).toEqual({
      type: 'error',
      message: 'Dataset "no-such-dataset" not found',
    });
    expect(events.slice(0, -1).every((e) => e.type === 'progress')).toBe(true);
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

  it('the testing-data load answers 200 with a Style A body (56)', async () => {
    const res = await post('/testing-data/not-a-sample/load', {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: false,
      message: 'Unknown sample fixture "not-a-sample"',
    });
  });
});
