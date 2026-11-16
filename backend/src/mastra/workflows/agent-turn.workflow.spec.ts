// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { RequestContext } from '@mastra/core/request-context';
import { agentTurnWorkflow } from './agent-turn.workflow';
import {
  AGENT_TURN_RUNTIME_KEY,
  AGENT_TURN_STEPS,
  AGENT_TURN_WORKFLOW_ID,
  type AgentTurnRuntime,
} from './agent-turn.steps';

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

const workflow = agentTurnWorkflow as unknown as StubWorkflow;

async function run(answer?: AgentTurnRuntime['answer']) {
  const requestContext = new RequestContext();
  if (answer) requestContext.set(AGENT_TURN_RUNTIME_KEY, { answer });
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

describe('agent-turn workflow (agents.md 5.1, 5.12; ADR-0040)', () => {
  it('is one Answer step, and never persists a snapshot', () => {
    expect(workflow.id).toBe(AGENT_TURN_WORKFLOW_ID);
    expect(workflow.steps.map((s) => [s.id, s.description])).toEqual([
      ['answer', 'Answer'],
    ]);
    expect(workflow.options?.shouldPersistSnapshot?.()).toBe(false);
  });

  // The workflow drawing reads the catalogue (agents.md 5.12): its field
  // names must be the built step's own schema fields.
  it("matches the step catalogue's ids and input and output fields", () => {
    const built = workflow.steps as unknown as {
      id: string;
      inputSchema: { shape: Record<string, unknown> };
      outputSchema: { shape: Record<string, unknown> };
    }[];
    expect(
      built.map((step) => ({
        id: step.id,
        input: Object.keys(step.inputSchema.shape),
        output: Object.keys(step.outputSchema.shape),
      })),
    ).toEqual(
      AGENT_TURN_STEPS.map((step) => ({
        id: step.id,
        input: [...step.input],
        output: [...step.output],
      })),
    );
    const own = workflow as unknown as {
      inputSchema: { shape: Record<string, unknown> };
      outputSchema: { shape: Record<string, unknown> };
    };
    expect(Object.keys(own.inputSchema.shape)).toEqual([
      ...AGENT_TURN_STEPS[0].input,
    ]);
    expect(Object.keys(own.outputSchema.shape)).toEqual([
      ...AGENT_TURN_STEPS[0].output,
    ]);
  });

  it("returns the agent turn's outcome", async () => {
    const outcome = {
      calls: [{ tool: 'run_readonly_sql', rowCount: 4, failed: false }],
      stopped: false,
    };
    const answer = jest.fn(() => Promise.resolve(outcome));
    const { events, result } = await run(answer);
    expect(answer).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['answer:running', 'answer:success']);
    expect(result).toEqual({ status: 'success', result: outcome });
  });

  it('fails with the agent turn’s own error', async () => {
    const failure = new Error('model down');
    const { events, result } = await run(() => Promise.reject(failure));
    expect(events).toEqual(['answer:running', 'answer:failed']);
    expect(result.status).toBe('failed');
    expect(result.error).toBe(failure);
  });

  it('ends the run when the turn was stopped', async () => {
    const { events, result } = await run(() =>
      Promise.resolve({ calls: [], stopped: true }),
    );
    expect(events).toEqual(['answer:running', 'answer:bailed']);
    expect(result).toEqual({
      status: 'success',
      result: { calls: [], stopped: true },
    });
  });

  it('fails when the run has no turn runtime', async () => {
    const { result } = await run();
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe(
      'The Answer step has no turn to run',
    );
  });
});
