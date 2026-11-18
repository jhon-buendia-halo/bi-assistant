/**
 * A small client for the run endpoints of a backend under test (api.md 119,
 * 121, 138, 150): start a streamed run, answer a waiting one, stop one, read
 * a stored one, each read back as SSE frames (api.md 3.1 framing) or JSON.
 * Shared by the run specs so each one scripts only its model.
 */

/** One SSE frame of a run (api.md 3.6); only the fields the specs read. */
export interface RunFrame {
  seq?: number;
  type: string;
  content?: string;
  runId?: string;
  workflowId?: string;
  id?: string;
  title?: string;
  status?: string;
  attempt?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
  stepId?: string;
  question?: string;
  options?: string[];
  run?: StoredRun;
}

/** A stored run (api.md 121 `WorkflowRun`); only the fields the specs read. */
export interface StoredRun {
  id: string;
  workflowId: string;
  status: string;
  error?: string;
  question?: string;
  answer?: { role: string; content: string };
  datasets: string[];
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  waitingFor?: Record<string, unknown>;
  steps: {
    id: string;
    status: string;
    attempt?: number;
    input?: Record<string, unknown>;
    output?: Record<string, unknown>;
    error?: string;
    toolCalls?: {
      tool: string;
      input?: string;
      rowCount?: number;
      error?: string;
    }[];
  }[];
}

/** A step frame or stored step as `id:status[:attempt]`. */
export const trail = (step: {
  id?: string;
  status?: string;
  attempt?: number;
}): string =>
  `${step.id}:${step.status}${step.attempt ? `:${step.attempt}` : ''}`;

/** The frames of an SSE body. */
export function framesOf(text: string): RunFrame[] {
  return text
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('data: '))
    .map((block) => JSON.parse(block.slice('data: '.length)) as RunFrame);
}

export interface Streamed {
  status: number;
  text: string;
  frames: RunFrame[];
  /** The run `done` carried, when the stream ended with one. */
  run?: StoredRun;
  /** The stream's step frames as `id:status[:attempt]`. */
  steps: string[];
}

async function streamed(res: Response): Promise<Streamed> {
  const text = await res.text();
  const frames = res.status === 200 ? framesOf(text) : [];
  const done = frames.find((frame) => frame.type === 'done');
  return {
    status: res.status,
    text,
    frames,
    run: done?.run,
    steps: frames.filter((frame) => frame.type === 'step').map(trail),
  };
}

export function runClient(baseUrl: () => string) {
  const post = (path: string, body?: object) =>
    fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  return {
    /** 119: run `workflowId` on `body` and read the whole stream. */
    run: async (workflowId: string, body: object) =>
      streamed(
        await post(
          `/workflows/${encodeURIComponent(workflowId)}/runs/stream`,
          body,
        ),
      ),
    /** 138: answer a waiting run and read the stream. */
    resume: async (runId: string, body: object) =>
      streamed(
        await post(
          `/workflow-runs/${encodeURIComponent(runId)}/resume/stream`,
          body,
        ),
      ),
    /** 150: stop a run. */
    stop: async (runId: string) => {
      const res = await post(
        `/workflow-runs/${encodeURIComponent(runId)}/stop`,
      );
      return {
        status: res.status,
        body: (await res.json()) as {
          ok: boolean;
          message: string;
          run: StoredRun;
        },
      };
    },
    /** 121: one stored run. */
    stored: async (runId: string) => {
      const res = await fetch(
        `${baseUrl()}/workflow-runs/${encodeURIComponent(runId)}`,
      );
      return (await res.json()) as StoredRun;
    },
  };
}
