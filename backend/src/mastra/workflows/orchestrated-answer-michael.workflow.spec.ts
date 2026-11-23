// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { RequestContext } from '@mastra/core/request-context';
import { orchestratedAnswerWorkflow } from './orchestrated-answer-michael.workflow';
import {
  ORCHESTRATED_ANSWER_RUNTIME_KEY,
  ORCHESTRATED_ANSWER_STEPS,
  ORCHESTRATED_ANSWER_WORKFLOW_ID,
  type OrchestratedAnswerRuntime,
} from './orchestrated-answer-michael.steps';

interface StubEvent {
  type: string;
  payload?: { id?: string; status?: string };
}
interface StubResult {
  status: string;
  result?: unknown;
  error?: unknown;
  suspended?: string[][];
  steps?: Record<string, { suspendPayload?: unknown }>;
}
interface StubStream {
  fullStream: AsyncIterable<StubEvent>;
  result: Promise<StubResult>;
}
interface StubWorkflow {
  id: string;
  options?: {
    shouldPersistSnapshot?: (s: { workflowStatus: string }) => boolean;
  };
  steps: { id: string; description?: string }[];
  createRun(): Promise<{
    stream(args: { inputData: unknown; requestContext: unknown }): StubStream;
    resumeStream(args: {
      step: string[];
      resumeData: unknown;
      requestContext: unknown;
    }): StubStream;
  }>;
}

const workflow = orchestratedAnswerWorkflow as unknown as StubWorkflow;

async function drain(output: StubStream) {
  const events: string[] = [];
  for await (const event of output.fullStream) {
    if (event.payload?.id) {
      events.push(`${event.payload.id}:${event.payload.status}`);
    }
  }
  return { events, result: await output.result };
}

function context(runtime?: OrchestratedAnswerRuntime) {
  const requestContext = new RequestContext();
  if (runtime) requestContext.set(ORCHESTRATED_ANSWER_RUNTIME_KEY, runtime);
  return requestContext;
}

async function run(runtime?: OrchestratedAnswerRuntime) {
  const requestContext = context(runtime);
  const engineRun = await workflow.createRun();
  const started = await drain(
    engineRun.stream({
      inputData: { question: 'How many matches?', datasets: ['World Cup'] },
      requestContext,
    }),
  );
  return { ...started, engineRun, requestContext };
}

const ASKED = {
  question: 'Which tournament?',
  options: ['Men', 'Women'],
};

describe('orchestrated-answer workflow (agents.md 5.22; workflows R45)', () => {
  it("is one Orchestrate agent step (Avery's), and keeps a snapshot only while suspended", () => {
    expect(workflow.id).toBe(ORCHESTRATED_ANSWER_WORKFLOW_ID);
    expect(workflow.steps.map((s) => [s.id, s.description])).toEqual([
      ['orchestrate', 'Orchestrate'],
    ]);
    expect(ORCHESTRATED_ANSWER_STEPS.map((s) => [s.id, s.kind])).toEqual([
      ['orchestrate', 'agent'],
    ]);
    const persist = workflow.options?.shouldPersistSnapshot;
    expect(persist?.({ workflowStatus: 'suspended' })).toBe(true);
    expect(persist?.({ workflowStatus: 'success' })).toBe(false);
    expect(persist?.({ workflowStatus: 'failed' })).toBe(false);
  });

  it("calls the runtime's orchestrate with the question and returns its answer", async () => {
    const orchestrate = jest.fn(() =>
      Promise.resolve({ answer: 'There were 64 matches.', stopped: false }),
    );
    const { events, result } = await run({ orchestrate });
    expect(orchestrate).toHaveBeenCalledTimes(1);
    expect(orchestrate).toHaveBeenCalledWith({ question: 'How many matches?' });
    expect(events).toEqual(['orchestrate:running', 'orchestrate:success']);
    expect(result).toEqual({
      status: 'success',
      result: { answer: 'There were 64 matches.' },
    });
  });

  it("suspends with Avery's question, then runs her again with the answer", async () => {
    const orchestrate = jest
      .fn()
      .mockResolvedValueOnce({
        answer: '',
        stopped: false,
        clarification: ASKED,
      })
      .mockResolvedValueOnce({ answer: 'Men: 64 matches.', stopped: false });
    const started = await run({ orchestrate });
    expect(started.result.status).toBe('suspended');
    expect(started.result.suspended).toEqual([['orchestrate']]);
    expect(started.result.steps?.orchestrate.suspendPayload).toEqual({
      kind: 'clarify',
      ...ASKED,
    });

    const resumed = await drain(
      started.engineRun.resumeStream({
        step: ['orchestrate'],
        resumeData: { answer: ' Men ' },
        requestContext: started.requestContext,
      }),
    );
    expect(orchestrate).toHaveBeenCalledTimes(2);
    expect(orchestrate).toHaveBeenLastCalledWith({
      question: 'How many matches?',
      answered: { ...ASKED, answer: 'Men' },
    });
    expect(resumed.result).toEqual({
      status: 'success',
      result: { answer: 'Men: 64 matches.' },
    });
  });

  it('bails with what it has when the run is stopped, even if Avery asked', async () => {
    const orchestrate = jest.fn(() =>
      Promise.resolve({
        answer: 'partial',
        stopped: true,
        clarification: ASKED,
      }),
    );
    const { result } = await run({ orchestrate });
    expect(result).toEqual({
      status: 'success',
      result: { answer: 'partial' },
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
