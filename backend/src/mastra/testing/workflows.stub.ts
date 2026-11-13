/**
 * Jest stand-in for `@mastra/core/workflows`: the real module pulls in
 * ESM-only packages Jest cannot require. Specs opt in with
 * `jest.mock('@mastra/core/workflows', () => jest.requireActual(<this>))`.
 *
 * It runs `.then()`, `.branch()`, `.dountil()` and `.map()` entries and
 * nested workflows, and streams the same step events as @mastra/core 1.66's
 * default engine (checked against it on 2026-11-09 and, for the control
 * flow, on 2026-11-13; suspend/resume on 2026-11-12): `workflow-step-start`
 * (`running`, the step's input as `payload.payload`) and
 * `workflow-step-result` with `success`, `failed` (the run stops, `result`
 * is `{ status: 'failed', error }`) or `bailed`. As the engine does:
 * - a nested workflow's events name its steps `<workflow id>.<step id>`
 *   (at every depth), and the nested workflow itself starts and ends as a
 *   step;
 * - a bail ends the `.then()` sequence it is in: the run's own (a success
 *   with the bailed value), or a nested workflow's (which then succeeds
 *   with that value); a bail inside a branch or a loop ends only that step;
 * - `.branch()` runs every step whose condition holds and passes on an
 *   object keyed by their ids; none holding passes on `{}`;
 * - `.dountil()` runs its step, then its condition on the step's output
 *   (`iterationCount` from 1), feeding the output back until it holds;
 * - `.map(fn, { id })` runs `fn` as a step named `id` (default
 *   `mapping_<workflow id>_<n>`), with `getStepResult` and `getInitData`;
 * - a step's `suspend(payload)` suspends the run: `workflow-step-suspended`
 *   (`suspended`, `suspendPayload`) for the step and each workflow around
 *   it, and `result` is `{ status: 'suspended', suspended: [path], steps:
 *   { <top step>: { status, suspendPayload } } }`, the path the step ids
 *   from the top. `run.resumeStream({ step: path, resumeData })` runs the
 *   step again with `resumeData` and `suspendData` (each workflow on the
 *   path starts again as a step), then goes on where the run stopped.
 * No schemas are validated and nothing is persisted.
 */

interface StepContext {
  inputData: unknown;
  requestContext: unknown;
  bail: (value: unknown) => unknown;
  suspend: (payload: unknown) => unknown;
  resumeData?: unknown;
  suspendData?: unknown;
  getInitData: () => unknown;
  getStepResult: (step: unknown) => unknown;
}

interface StubStep {
  id: string;
  description?: string;
  execute: (args: StepContext) => Promise<unknown>;
}

type Condition = (args: {
  inputData: unknown;
  iterationCount?: number;
  requestContext?: unknown;
}) => Promise<boolean>;

type MapFn = (args: StepContext) => Promise<unknown>;

type Entry =
  | { type: 'step'; step: StubStep | StubWorkflow }
  | { type: 'branch'; pairs: [Condition, StubStep | StubWorkflow][] }
  | { type: 'dountil'; step: StubStep | StubWorkflow; condition: Condition }
  | { type: 'map'; id: string; fn: MapFn };

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
    suspendPayload?: unknown;
  };
}

interface StubResult {
  status: 'success' | 'failed' | 'suspended';
  result?: unknown;
  error?: unknown;
  suspended?: string[][];
  steps?: Record<string, { status: string; suspendPayload?: unknown }>;
}

/** Where one level of entries stood when the run suspended. */
interface Frame {
  entryIndex: number;
  /** The entry's input. */
  data: unknown;
  initData: unknown;
  results: Record<string, unknown>;
  iterationCount?: number;
  pairIndex?: number;
  keyed?: Record<string, unknown>;
}

/** How a sequence or a step ended. */
type Outcome =
  | { kind: 'success'; output: unknown }
  | { kind: 'bailed'; output: unknown }
  | { kind: 'failed'; error: unknown }
  | {
      kind: 'suspended';
      payload: unknown;
      /** Step ids from this level down to the suspended step. */
      path: string[];
      /** One frame per level of entries, from this level down. */
      frames: Frame[];
    };

/** What a resume hands down: the frames below, the data and the payload. */
interface Resume {
  frames: Frame[];
  resumeData: unknown;
  suspendData: unknown;
}

export function createStep<T>(config: T): T {
  return config;
}

function isWorkflow(step: unknown): step is StubWorkflow {
  return (step as { isStubWorkflow?: unknown })?.isStubWorkflow === true;
}

export function createWorkflow<T extends { id: string }>(config: T) {
  const entries: Entry[] = [];
  const steps: (StubStep | StubWorkflow)[] = [];
  let maps = 0;
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
    map(fn: MapFn, options?: { id?: string }) {
      entries.push({
        type: 'map',
        id: options?.id ?? `mapping_${config.id}_${maps++}`,
        fn,
      });
      return workflow;
    },
    commit() {
      return workflow;
    },
    deleteWorkflowRunById() {
      return Promise.resolve();
    },
    createRun() {
      let waiting:
        { path: string[]; frames: Frame[]; payload: unknown } | undefined;
      const remember = (
        suspended:
          { path: string[]; frames: Frame[]; payload: unknown } | undefined,
      ) => {
        waiting = suspended;
      };
      return Promise.resolve({
        runId: `stub-run-${Math.random().toString(36).slice(2)}`,
        stream: (args: { inputData: unknown; requestContext?: unknown }) =>
          runWorkflow(
            workflow,
            args.inputData,
            args.requestContext,
            undefined,
            remember,
          ),
        resumeStream: (args: {
          step?: string[];
          resumeData?: unknown;
          requestContext?: unknown;
        }) => {
          if (!waiting) throw new Error('This run is not suspended');
          if (
            args.step &&
            JSON.stringify(args.step) !== JSON.stringify(waiting.path)
          ) {
            throw new Error(`No step is suspended at ${args.step.join('.')}`);
          }
          const resume: Resume = {
            frames: waiting.frames,
            resumeData: args.resumeData,
            suspendData: waiting.payload,
          };
          waiting = undefined;
          return runWorkflow(
            workflow,
            undefined,
            args.requestContext,
            resume,
            remember,
          );
        },
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
  level: { initData: unknown; results: Record<string, unknown> },
  resume?: Resume,
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
      resume,
    );
    if (inner.kind === 'failed') {
      yield { type: 'workflow-step-result', payload: { id, status: 'failed' } };
      return inner;
    }
    if (inner.kind === 'suspended') {
      yield {
        type: 'workflow-step-suspended',
        payload: { id, status: 'suspended', suspendPayload: inner.payload },
      };
      return { ...inner, path: [step.id, ...inner.path] };
    }
    // A bail inside a nested workflow ends it as a success.
    yield {
      type: 'workflow-step-result',
      payload: { id, status: 'success', output: inner.output },
    };
    return { kind: 'success', output: inner.output };
  }
  let bailed: { value: unknown } | undefined;
  let suspended: { payload: unknown } | undefined;
  try {
    const output = await step.execute({
      inputData: data,
      requestContext,
      bail: (value) => {
        bailed = { value };
        return value;
      },
      suspend: (payload) => {
        suspended = { payload };
        return undefined;
      },
      ...(resume
        ? { resumeData: resume.resumeData, suspendData: resume.suspendData }
        : {}),
      getInitData: () => level.initData,
      getStepResult: (target) =>
        level.results[(target as { id?: string })?.id ?? String(target)],
    });
    if (suspended) {
      yield {
        type: 'workflow-step-suspended',
        payload: { id, status: 'suspended', suspendPayload: suspended.payload },
      };
      return {
        kind: 'suspended',
        payload: suspended.payload,
        path: [step.id],
        frames: [],
      };
    }
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

/** Run a workflow's entries in order (or from where they suspended). */
async function* runEntries(
  entries: readonly Entry[],
  inputData: unknown,
  requestContext: unknown,
  prefix: string,
  resume?: Resume,
): AsyncGenerator<StubEvent, Outcome> {
  const frame = resume?.frames[0];
  const below: Resume | undefined = resume
    ? { ...resume, frames: resume.frames.slice(1) }
    : undefined;
  const level = {
    initData: frame ? frame.initData : inputData,
    results: frame ? frame.results : ({} as Record<string, unknown>),
  };
  let data = frame ? frame.data : inputData;
  const suspendedAt = (
    outcome: Extract<Outcome, { kind: 'suspended' }>,
    at: Omit<Frame, 'initData' | 'results'>,
  ): Outcome => ({
    ...outcome,
    frames: [{ ...at, ...level }, ...outcome.frames],
  });
  for (let index = frame?.entryIndex ?? 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const resuming = frame && index === frame.entryIndex ? below : undefined;
    if (entry.type === 'step') {
      const outcome = yield* runStep(
        entry.step,
        data,
        requestContext,
        prefix,
        level,
        resuming,
      );
      if (outcome.kind === 'suspended') {
        return suspendedAt(outcome, { entryIndex: index, data });
      }
      if (outcome.kind !== 'success') return outcome;
      level.results[entry.step.id] = outcome.output;
      data = outcome.output;
    } else if (entry.type === 'map') {
      yield {
        type: 'workflow-step-start',
        payload: {
          id: `${prefix}${entry.id}`,
          status: 'running',
          payload: data,
        },
      };
      const output = await entry.fn({
        inputData: data,
        requestContext,
        bail: (value) => value,
        suspend: () => undefined,
        getInitData: () => level.initData,
        getStepResult: (target) =>
          level.results[(target as { id?: string })?.id ?? String(target)],
      });
      yield {
        type: 'workflow-step-result',
        payload: { id: `${prefix}${entry.id}`, status: 'success', output },
      };
      level.results[entry.id] = output;
      data = output;
    } else if (entry.type === 'branch') {
      const keyed: Record<string, unknown> = resuming
        ? { ...frame?.keyed }
        : {};
      const first = resuming ? (frame?.pairIndex ?? 0) : 0;
      for (let pair = first; pair < entry.pairs.length; pair += 1) {
        const [condition, step] = entry.pairs[pair];
        const resumed = resuming && pair === first;
        if (
          !resumed &&
          !(await condition({ inputData: data, requestContext }))
        ) {
          continue;
        }
        const outcome = yield* runStep(
          step,
          data,
          requestContext,
          prefix,
          level,
          resumed ? resuming : undefined,
        );
        if (outcome.kind === 'failed') return outcome;
        if (outcome.kind === 'suspended') {
          return suspendedAt(outcome, {
            entryIndex: index,
            data,
            pairIndex: pair,
            keyed,
          });
        }
        keyed[step.id] = outcome.output;
      }
      level.results[`branch_${index}`] = keyed;
      data = keyed;
    } else {
      for (
        let iterationCount = resuming ? (frame?.iterationCount ?? 1) : 1;
        ;
        iterationCount += 1
      ) {
        const outcome = yield* runStep(
          entry.step,
          data,
          requestContext,
          prefix,
          level,
          resuming && iterationCount === frame?.iterationCount
            ? resuming
            : undefined,
        );
        if (outcome.kind === 'failed') return outcome;
        if (outcome.kind === 'suspended') {
          return suspendedAt(outcome, {
            entryIndex: index,
            data,
            iterationCount,
          });
        }
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
  resume: Resume | undefined,
  remember: (
    suspended:
      { path: string[]; frames: Frame[]; payload: unknown } | undefined,
  ) => void,
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
      resume,
    );
    yield { type: 'workflow-finish' };
    if (outcome.kind === 'suspended') {
      remember({
        path: outcome.path,
        frames: outcome.frames,
        payload: outcome.payload,
      });
      settle({
        status: 'suspended',
        suspended: [outcome.path],
        steps: {
          [outcome.path[0]]: {
            status: 'suspended',
            suspendPayload: outcome.payload,
          },
        },
      });
      return;
    }
    settle(
      outcome.kind === 'failed'
        ? { status: 'failed', error: outcome.error }
        : { status: 'success', result: outcome.output },
    );
  }
  return { fullStream: events(), result };
}
