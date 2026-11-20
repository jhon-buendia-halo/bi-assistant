// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { RequestContext } from '@mastra/core/request-context';
import { orchestratedAnswerWorkflow } from './orchestrated-answer.workflow';
import {
  ORCHESTRATED_ANSWER_RUNTIME_KEY,
  ORCHESTRATED_ANSWER_WORKFLOW_ID,
  ORCHESTRATED_PLACEHOLDER_ANSWER,
  type OrchestratedAnswerRuntime,
} from './orchestrated-answer.steps';

interface StubWorkflow {
  id: string;
  options?: { shouldPersistSnapshot?: () => boolean };
  steps: { id: string; description?: string }[];
  createRun(): Promise<{
    stream(args: { inputData: unknown; requestContext: unknown }): {
      fullStream: AsyncIterable<{
        type: string;
        payload?: { id?: string; status?: string };
      }>;
      result: Promise<{ status: string; result?: unknown; error?: unknown }>;
    };
  }>;
}

const workflow = orchestratedAnswerWorkflow as unknown as StubWorkflow;

async function run(runtime?: OrchestratedAnswerRuntime) {
  const requestContext = new RequestContext();
  if (runtime) requestContext.set(ORCHESTRATED_ANSWER_RUNTIME_KEY, runtime);
  const output = (await workflow.createRun()).stream({
    inputData: { question: 'How many matches?', datasets: ['World Cup'] },
    requestContext,
  });
  const events: string[] = [];
  for await (const event of output.fullStream) {
    if (event.payload?.id) {
      events.push(`${event.payload.id}:${event.payload.status}`);
    }
  }
  return { events, result: await output.result };
}

describe('orchestrated-answer workflow (agents.md 5.22; workflows R45)', () => {
  it('is one Orchestrate step, and never persists a snapshot', () => {
    expect(workflow.id).toBe(ORCHESTRATED_ANSWER_WORKFLOW_ID);
    expect(workflow.steps.map((s) => [s.id, s.description])).toEqual([
      ['orchestrate', 'Orchestrate'],
    ]);
    expect(workflow.options?.shouldPersistSnapshot?.()).toBe(false);
  });

  it('delivers the placeholder answer through the runtime and returns it', async () => {
    const deliverAnswer = jest.fn(() => Promise.resolve());
    const { events, result } = await run({ deliverAnswer });
    expect(deliverAnswer).toHaveBeenCalledTimes(1);
    expect(deliverAnswer).toHaveBeenCalledWith(ORCHESTRATED_PLACEHOLDER_ANSWER);
    expect(events).toEqual(['orchestrate:running', 'orchestrate:success']);
    expect(result).toEqual({
      status: 'success',
      result: { answer: ORCHESTRATED_PLACEHOLDER_ANSWER },
    });
  });

  it('fails when the run has no turn runtime', async () => {
    const { result } = await run();
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe(
      'The Orchestrate step has no turn to run',
    );
  });
});
