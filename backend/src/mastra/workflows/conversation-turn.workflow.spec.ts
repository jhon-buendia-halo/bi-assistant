// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { RequestContext } from '@mastra/core/request-context';
import { insightsLeadConversationWorkflow } from './conversation-turn.workflow';
import {
  CONVERSATION_TURN_RUNTIME_KEY,
  INSIGHTS_LEAD_ENGINE_ID,
  type ConversationTurnRuntime,
} from './conversation-turn.steps';

interface StubStream {
  fullStream: AsyncIterable<{
    type: string;
    payload?: { id?: string; status?: string };
  }>;
  result: Promise<{ status: string; result?: unknown; error?: unknown }>;
}
interface StubWorkflow {
  id: string;
  options?: {
    shouldPersistSnapshot?: (s: { workflowStatus: string }) => boolean;
  };
  steps: { id: string; description?: string }[];
  createRun(): Promise<{
    stream(args: { inputData: unknown; requestContext: unknown }): StubStream;
  }>;
}

const workflow = insightsLeadConversationWorkflow as unknown as StubWorkflow;

async function run(runtime?: ConversationTurnRuntime) {
  const requestContext = new RequestContext();
  if (runtime) requestContext.set(CONVERSATION_TURN_RUNTIME_KEY, runtime);
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

describe("Elena's conversation engine (plan Elena 1.3)", () => {
  it('is one Answer step, and keeps a snapshot only while suspended', () => {
    expect(workflow.id).toBe(INSIGHTS_LEAD_ENGINE_ID);
    expect(workflow.steps.map((s) => [s.id, s.description])).toEqual([
      ['answer', 'Answer'],
    ]);
    const persist = workflow.options?.shouldPersistSnapshot;
    expect(persist?.({ workflowStatus: 'suspended' })).toBe(true);
    expect(persist?.({ workflowStatus: 'success' })).toBe(false);
  });

  it("returns the runtime's turn answer", async () => {
    const turn = jest.fn(() =>
      Promise.resolve({ answer: 'There were 64 matches.', stopped: false }),
    );
    const { events, result } = await run({ turn });
    expect(turn).toHaveBeenCalledWith({ question: 'How many matches?' });
    expect(events).toEqual(['answer:running', 'answer:success']);
    expect(result).toEqual({
      status: 'success',
      result: { answer: 'There were 64 matches.' },
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
