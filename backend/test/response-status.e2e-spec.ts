/**
 * API-level proof of the success statuses specs/system/api.md states for
 * POST routes that do not answer the framework's default 201 (section 1.4):
 * the two streams answer 200 once they start, even when the stream carries
 * an `error` event (3.1, 3.4), and the developer endpoint test (55) and the
 * testing-data load (56) answer 200 with a Style A body. `POST /auth/logout`
 * (63) and `POST /admin/agents/transfer` (86) are org server routes, proven
 * in `org-auth.e2e-spec.ts` and `org-admin.e2e-spec.ts`.
 *
 * It drives the BUILT backend (`npm run build` first) in local mode with a
 * fresh `APP_DATA_DIR`. Needs no Postgres and no LLM.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Backend,
  bearer,
  boot,
  signInLocally,
  stop,
} from './backend-process';

const dataDir = mkdtempSync(join(tmpdir(), 'qti-response-status-'));

jest.setTimeout(120_000);

describe('POST routes the spec answers with 200 (api.md 1.4)', () => {
  let backend: Backend | undefined;
  /** Demo User's local auth session (admin R71). */
  let token = '';

  const post = (path: string, body: unknown) =>
    fetch(`${backend!.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bearer(token) },
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
    token = await signInLocally(backend.url);
  });

  afterAll(async () => {
    await stop(backend);
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('the chat stream answers 200 and reports a failure in the stream (3.1)', async () => {
    const res = await post('/sessions/no-such-session/messages/stream', {
      content: 'Who won?',
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(await frames(res)).toEqual([
      { type: 'error', content: 'Session no-such-session not found' },
    ]);
  });

  it('the knowledge bootstrap stream answers 200 and reports a failure in the stream (3.4)', async () => {
    const res = await post('/knowledge/bootstrap/stream', {});
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    // Here the error text is in `message`, not `content` (api.md 3.4).
    expect(await frames(res)).toEqual([
      { type: 'error', message: 'datasetId is required' },
    ]);
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
