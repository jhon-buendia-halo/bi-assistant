import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CopilotClient } from '@github/copilot-sdk';
import {
  COPILOT_NOT_SIGNED_IN,
  copilotRuntimeFailedMessage,
  copilotSignedInMessage,
} from './copilot-contracts';
import { CopilotRuntime } from './copilot-runtime';

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    start: jest.fn(() => Promise.resolve()),
    stop: jest.fn(() => Promise.resolve([])),
    forceStop: jest.fn(() => Promise.resolve()),
    getAuthStatus: jest.fn(() =>
      Promise.resolve({
        isAuthenticated: true,
        authType: 'gh-cli',
        login: 'octocat',
        host: 'https://github.com',
      }),
    ),
    listModels: jest.fn(() =>
      Promise.resolve([{ id: 'gpt-5' }, { id: 'claude' }, { id: 'gpt-5' }]),
    ),
    ...overrides,
  };
}

type FakeClient = ReturnType<typeof fakeClient>;

describe('CopilotRuntime', () => {
  const workingDirectory = join(
    mkdtempSync(join(tmpdir(), 'qti-copilot-spec-')),
    'work',
  );

  function runtimeWith(...clients: FakeClient[]) {
    const createClient = jest.fn(() => {
      const next = clients.shift();
      if (!next) throw new Error('no more fake clients');
      return next as unknown as CopilotClient;
    });
    return {
      runtime: new CopilotRuntime({ createClient, workingDirectory }),
      createClient,
    };
  }

  it('reports the signed-in login and method', async () => {
    const { runtime } = runtimeWith(fakeClient());
    await expect(runtime.status()).resolves.toEqual({
      signedIn: true,
      login: 'octocat',
      method: 'gh-cli',
      message: copilotSignedInMessage('octocat'),
    });
  });

  it('reports not signed in without throwing', async () => {
    const client = fakeClient({
      getAuthStatus: jest.fn(() =>
        Promise.resolve({ isAuthenticated: false, statusMessage: 'nope' }),
      ),
    });
    const { runtime } = runtimeWith(client);
    await expect(runtime.status()).resolves.toEqual({
      signedIn: false,
      login: null,
      method: null,
      message: COPILOT_NOT_SIGNED_IN,
    });
    await expect(runtime.ensureSignedIn()).rejects.toThrow(
      COPILOT_NOT_SIGNED_IN,
    );
  });

  it('reports a start failure and retries the start on the next call', async () => {
    const broken = fakeClient({
      start: jest.fn(() => Promise.reject(new Error('spawn failed'))),
    });
    const { runtime, createClient } = runtimeWith(broken, fakeClient());
    await expect(runtime.status()).resolves.toEqual({
      signedIn: false,
      login: null,
      method: null,
      message: copilotRuntimeFailedMessage('spawn failed'),
    });
    expect(broken.forceStop).toHaveBeenCalled();
    await expect(runtime.status()).resolves.toMatchObject({ signedIn: true });
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it('ensureSignedIn throws the runtime-failed text', async () => {
    const { runtime } = runtimeWith(
      fakeClient({ start: jest.fn(() => Promise.reject(new Error('boom'))) }),
    );
    await expect(runtime.ensureSignedIn()).rejects.toThrow(
      copilotRuntimeFailedMessage('boom'),
    );
  });

  it('shares one start between concurrent callers and caches sign-in', async () => {
    const client = fakeClient();
    const { runtime, createClient } = runtimeWith(client);
    await Promise.all([
      runtime.client(),
      runtime.client(),
      runtime.ensureSignedIn(),
    ]);
    await runtime.ensureSignedIn();
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(client.start).toHaveBeenCalledTimes(1);
    expect(client.getAuthStatus).toHaveBeenCalledTimes(1);
  });

  it('lists model ids in order without duplicates', async () => {
    const { runtime } = runtimeWith(fakeClient());
    await expect(runtime.listModels()).resolves.toEqual(['gpt-5', 'claude']);
  });

  it('stops the client and force-stops when the stop hangs', async () => {
    const hanging = fakeClient({ stop: jest.fn(() => new Promise(() => {})) });
    const createClient = jest.fn(() => hanging as unknown as CopilotClient);
    const runtime = new CopilotRuntime({
      createClient,
      workingDirectory,
      stopTimeoutMs: 10,
    });
    await runtime.client();
    await runtime.stop();
    expect(hanging.stop).toHaveBeenCalled();
    expect(hanging.forceStop).toHaveBeenCalled();
  });

  it('stop is a no-op when never started', async () => {
    const { runtime, createClient } = runtimeWith();
    await expect(runtime.stop()).resolves.toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
  });
});
