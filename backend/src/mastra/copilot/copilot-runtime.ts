// The process-wide GitHub Copilot runtime (BA-159, story 1.10.3, ADR-0037):
// one CopilotClient per backend process, signed in with the machine's GitHub
// login, started on first use and stopped on shutdown (llm-settings R55–R59).
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CopilotClient } from '@github/copilot-sdk';
import {
  COPILOT_NOT_SIGNED_IN,
  copilotRuntimeFailedMessage,
  copilotSignedInMessage,
  type CopilotRuntimeApi,
  type CopilotStatusView,
} from './copilot-contracts';

/** Builds the SDK client; tests inject a fake. */
export type CopilotClientFactory = (workingDirectory: string) => CopilotClient;

export interface CopilotRuntimeOptions {
  createClient?: CopilotClientFactory;
  /** An empty folder the runtime works in; created when missing. */
  workingDirectory?: string;
  /** How long a positive sign-in check is trusted. */
  signedInCacheMs?: number;
  /** How long a graceful stop may take before the client is force-stopped. */
  stopTimeoutMs?: number;
  now?: () => number;
}

const DEFAULT_SIGNED_IN_CACHE_MS = 60_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;

const defaultClientFactory: CopilotClientFactory = (workingDirectory) =>
  new CopilotClient({ workingDirectory, logLevel: 'error' });

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export class CopilotRuntime implements CopilotRuntimeApi {
  private readonly createClient: CopilotClientFactory;
  private readonly workingDirectory: string;
  private readonly signedInCacheMs: number;
  private readonly stopTimeoutMs: number;
  private readonly now: () => number;
  private started: Promise<CopilotClient> | null = null;
  private signedInUntil = 0;

  constructor(options: CopilotRuntimeOptions = {}) {
    this.createClient = options.createClient ?? defaultClientFactory;
    this.workingDirectory =
      options.workingDirectory ?? join(tmpdir(), 'qti-copilot');
    this.signedInCacheMs =
      options.signedInCacheMs ?? DEFAULT_SIGNED_IN_CACHE_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /** Starts the client once; concurrent callers share the start, a failure is retried next call. */
  client(): Promise<CopilotClient> {
    if (!this.started) {
      const attempt = this.start();
      this.started = attempt;
      attempt.catch(() => {
        if (this.started === attempt) this.started = null;
      });
    }
    return this.started;
  }

  private async start(): Promise<CopilotClient> {
    mkdirSync(this.workingDirectory, { recursive: true });
    const client = this.createClient(this.workingDirectory);
    try {
      await client.start();
    } catch (err) {
      await client.forceStop().catch(() => undefined);
      throw err;
    }
    return client;
  }

  async status(): Promise<CopilotStatusView> {
    let client: CopilotClient;
    try {
      client = await this.client();
    } catch (err) {
      return this.notSignedIn(copilotRuntimeFailedMessage(messageOf(err)));
    }
    try {
      const auth = await client.getAuthStatus();
      if (!auth.isAuthenticated) return this.notSignedIn(COPILOT_NOT_SIGNED_IN);
      const login = auth.login ?? auth.host ?? 'GitHub user';
      return {
        signedIn: true,
        login,
        method: auth.authType ?? null,
        message: copilotSignedInMessage(login),
      };
    } catch (err) {
      return this.notSignedIn(copilotRuntimeFailedMessage(messageOf(err)));
    }
  }

  async ensureSignedIn(): Promise<void> {
    if (this.now() < this.signedInUntil) return;
    const status = await this.status();
    if (!status.signedIn) throw new Error(status.message);
    this.signedInUntil = this.now() + this.signedInCacheMs;
  }

  async listModels(): Promise<string[]> {
    await this.ensureSignedIn();
    const client = await this.client();
    const models = await client.listModels();
    const ids: string[] = [];
    for (const model of models) {
      if (model?.id && !ids.includes(model.id)) ids.push(model.id);
    }
    return ids;
  }

  async stop(): Promise<void> {
    const started = this.started;
    this.started = null;
    this.signedInUntil = 0;
    if (!started) return;
    let client: CopilotClient;
    try {
      client = await started;
    } catch {
      return; // never started
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.stopTimeoutMs);
      timer.unref?.();
    });
    try {
      const outcome = await Promise.race([
        client.stop().then(() => 'stopped' as const),
        timedOut,
      ]);
      if (outcome === 'timeout') await client.forceStop();
    } catch {
      await client.forceStop().catch(() => undefined);
    } finally {
      clearTimeout(timer);
    }
  }

  private notSignedIn(message: string): CopilotStatusView {
    this.signedInUntil = 0;
    return { signedIn: false, login: null, method: null, message };
  }
}

let runtime: CopilotRuntime | null = null;

/** The process-wide runtime, created lazily. */
export function getCopilotRuntime(): CopilotRuntimeApi {
  runtime ??= new CopilotRuntime();
  return runtime;
}

/** Stops the process-wide runtime, if it was ever used. */
export async function stopCopilotRuntime(): Promise<void> {
  const current = runtime;
  runtime = null;
  if (current) await current.stop();
}
