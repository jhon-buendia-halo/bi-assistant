/**
 * Jest stand-in for `@mastra/core/workflows`: the real module pulls in
 * ESM-only packages Jest cannot require. Specs opt in with
 * `jest.mock('@mastra/core/workflows', () => jest.requireActual(<this>))`.
 *
 * It runs `.then()`, `.branch()` and `.dountil()` entries and nested
 * workflows, and streams the same step events as @mastra/core 1.66's
 * default engine (checked against it on 2026-11-09 and, for the control
 * flow, on 2026-11-13): `workflow-step-start` (`running`, the step's input
 * as `payload.payload`) and `workflow-step-result` with `success`,
 * `failed` (the run stops, `result` is `{ status: 'failed', error }`) or
 * `bailed`. As the engine does:
 * - a nested workflow's events name its steps `<workflow id>.<step id>`
 *   (at every depth), and the nested workflow itself starts and ends as a
 *   step;
 * - a bail ends the `.then()` sequence it is in: the run's own (a success
 *   with the bailed value), or a nested workflow's (which then succeeds
 *   with that value); a bail inside a branch or a loop ends only that step;
 * - `.branch()` runs every step whose condition holds and passes on an
 *   object keyed by their ids; none holding passes on `{}`;
 * - `.dountil()` runs its step, then its condition on the step's output
 *   (`iterationCount` from 1), feeding the output back until it holds.
 * No schemas are validated and nothing is persisted.
 */

interface StubStep {
  id: string;
  description?: string;
  execute: (args: {
    inputData: unknown;
    requestContext: unknown;
    bail: (value: unknown) => unknown;
  }) => Promise<unknown>;
}

type Condition = (args: {
  inputData: unknown;
  iterationCount?: number;
  requestContext?: unknown;
}) => Promise<boolean>;

type Entry =
  | { type: 'step'; step: StubStep | StubWorkflow }
  | { type: 'branch'; pairs: [Condition, StubStep | StubWorkflow][] }
  | { type: 'dountil'; step: StubStep | StubWorkflow; condition: Condition };

interface StubWorkflow {
  id: string;
  description?: string;
  steps: (StubStep | StubWorkflow)[];
  entries: Entry[];
  isStubWorkflow: true;
}

interface StubEvent {
  type: string;
  payload?: {
    id?: string;
    status?: string;
    payload?: unknown;
    output?: unknown;
  };
}

interface StubResult {
  status: 'success' | 'failed';
  result?: unknown;
  error?: unknown;
}

/** How a sequence or a step ended. */
type Outcome =
  | { kind: 'success'; output: unknown }
  | { kind: 'bailed'; output: unknown }
  | { kind: 'failed'; error: unknown };

export function createStep<T>(config: T): T {
  return config;
}

function isWorkflow(step: unknown): step is StubWorkflow {
  return (step as { isStubWorkflow?: unknown })?.isStubWorkflow === true;
}

export function createWorkflow<T extends { id: string }>(config: T) {
  const entries: Entry[] = [];
  const steps: (StubStep | StubWorkflow)[] = [];
  const workflow = {
    ...config,
    isStubWorkflow: true as const,
    steps,
    entries,
    then(step: unknown) {
      entries.push({ type: 'step', step: step as StubStep });
      steps.push(step as StubStep);
      return workflow;
    },
    branch(pairs: [Condition, unknown][]) {
      entries.push({
        type: 'branch',
        pairs: pairs as [Condition, StubStep][],
      });
      return workflow;
    },
    dountil(step: unknown, condition: Condition) {
      entries.push({ type: 'dountil', step: step as StubStep, condition });
      return workflow;
    },
    commit() {
      return workflow;
    },
    createRun() {
      return Promise.resolve({
        stream: (args: { inputData: unknown; requestContext?: unknown }) =>
          runWorkflow(workflow, args.inputData, args.requestContext),
      });
    },
  };
  return workflow;
}

/** Run one step (or nested workflow), yielding its events. */
async function* runStep(
  step: StubStep | StubWorkflow,
  data: unknown,
  requestContext: unknown,
  prefix: string,
): AsyncGenerator<StubEvent, Outcome> {
  const id = `${prefix}${step.id}`;
  // As the default engine does, the step's input is `payload.payload`.
  yield {
    type: 'workflow-step-start',
    payload: { id, status: 'running', payload: data },
  };
  if (isWorkflow(step)) {
    const inner = yield* runEntries(
      step.entries,
      data,
      requestContext,
      `${id}.`,
    );
    if (inner.kind === 'failed') {
      yield { type: 'workflow-step-result', payload: { id, status: 'failed' } };
      return inner;
    }
    // A bail inside a nested workflow ends it as a success.
    yield {
      type: 'workflow-step-result',
      payload: { id, status: 'success', output: inner.output },
    };
    return { kind: 'success', output: inner.output };
  }
  let bailed: { value: unknown } | undefined;
  try {
    const output = await step.execute({
      inputData: data,
      requestContext,
      bail: (value) => {
        bailed = { value };
        return value;
      },
    });
    if (bailed) {
      yield {
        type: 'workflow-step-result',
        payload: { id, status: 'bailed', output: bailed.value },
      };
      return { kind: 'bailed', output: bailed.value };
    }
    yield {
      type: 'workflow-step-result',
      payload: { id, status: 'success', output },
    };
    return { kind: 'success', output };
  } catch (error) {
    yield { type: 'workflow-step-result', payload: { id, status: 'failed' } };
    return { kind: 'failed', error };
  }
}

/** Run a workflow's entries in order, yielding their events. */
async function* runEntries(
  entries: readonly Entry[],
  inputData: unknown,
  requestContext: unknown,
  prefix: string,
): AsyncGenerator<StubEvent, Outcome> {
  let data = inputData;
  for (const entry of entries) {
    if (entry.type === 'step') {
      const outcome = yield* runStep(entry.step, data, requestContext, prefix);
      if (outcome.kind !== 'success') return outcome;
      data = outcome.output;
    } else if (entry.type === 'branch') {
      const keyed: Record<string, unknown> = {};
      for (const [condition, step] of entry.pairs) {
        if (!(await condition({ inputData: data, requestContext }))) continue;
        const outcome = yield* runStep(step, data, requestContext, prefix);
        if (outcome.kind === 'failed') return outcome;
        keyed[step.id] = outcome.output;
      }
      data = keyed;
    } else {
      for (let iterationCount = 1; ; iterationCount += 1) {
        const outcome = yield* runStep(
          entry.step,
          data,
          requestContext,
          prefix,
        );
        if (outcome.kind === 'failed') return outcome;
        data = outcome.output;
        if (
          await entry.condition({
            inputData: data,
            iterationCount,
            requestContext,
          })
        ) {
          break;
        }
        if (iterationCount >= 100) throw new Error('The loop never ended');
      }
    }
  }
  return { kind: 'success', output: data };
}

function runWorkflow(
  workflow: StubWorkflow,
  inputData: unknown,
  requestContext: unknown,
): { fullStream: AsyncIterable<StubEvent>; result: Promise<StubResult> } {
  let settle!: (result: StubResult) => void;
  const result = new Promise<StubResult>((resolve) => (settle = resolve));
  async function* events(): AsyncGenerator<StubEvent> {
    yield { type: 'workflow-start' };
    const outcome = yield* runEntries(
      workflow.entries,
      inputData,
      requestContext,
      '',
    );
    yield { type: 'workflow-finish' };
    settle(
      outcome.kind === 'failed'
        ? { status: 'failed', error: outcome.error }
        : { status: 'success', result: outcome.output },
    );
  }
  return { fullStream: events(), result };
}
