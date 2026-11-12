/**
 * Jest stand-in for `@mastra/core/workflows`: the real module pulls in
 * ESM-only packages Jest cannot require. Specs opt in with
 * `jest.mock('@mastra/core/workflows', () => jest.requireActual(<this>))`.
 *
 * It runs `.then()` steps in order and streams the same step events as
 * @mastra/core 1.66's default engine (checked against it on 2026-11-09):
 * `workflow-step-start` (`running`, the step's input as `payload.payload`)
 * and `workflow-step-result` with
 * `success`, `failed` (the run stops, `result` is `{ status: 'failed',
 * error }`) or `bailed` (the run stops with the bailed value as a success).
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

export function createStep<T>(config: T): T {
  return config;
}

export function createWorkflow<T extends { id: string }>(config: T) {
  const steps: StubStep[] = [];
  const workflow = {
    ...config,
    steps,
    then(step: unknown) {
      steps.push(step as StubStep);
      return workflow;
    },
    commit() {
      return workflow;
    },
    createRun() {
      return Promise.resolve({
        stream: (args: { inputData: unknown; requestContext?: unknown }) =>
          runSteps(steps, args.inputData, args.requestContext),
      });
    },
  };
  return workflow;
}

function runSteps(
  steps: readonly StubStep[],
  inputData: unknown,
  requestContext: unknown,
): { fullStream: AsyncIterable<StubEvent>; result: Promise<StubResult> } {
  let settle!: (result: StubResult) => void;
  const result = new Promise<StubResult>((resolve) => (settle = resolve));
  async function* events(): AsyncGenerator<StubEvent> {
    yield { type: 'workflow-start' };
    let data = inputData;
    for (const step of steps) {
      yield {
        type: 'workflow-step-start',
        // As the default engine does, the step's input is `payload.payload`.
        payload: { id: step.id, status: 'running', payload: data },
      };
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
            payload: { id: step.id, status: 'bailed', output: bailed.value },
          };
          yield { type: 'workflow-finish' };
          settle({ status: 'success', result: bailed.value });
          return;
        }
        data = output;
        yield {
          type: 'workflow-step-result',
          payload: { id: step.id, status: 'success', output },
        };
      } catch (error) {
        yield {
          type: 'workflow-step-result',
          payload: { id: step.id, status: 'failed' },
        };
        yield { type: 'workflow-finish' };
        settle({ status: 'failed', error });
        return;
      }
    }
    yield { type: 'workflow-finish' };
    settle({ status: 'success', result: data });
  }
  return { fullStream: events(), result };
}
