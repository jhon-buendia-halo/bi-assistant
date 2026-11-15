// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()` steps in order with the engine's step events (see it).
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);

import { RequestContext } from '@mastra/core/request-context';
import { dataReadinessAssessmentWorkflow } from './data-readiness-assessment.workflow';
import {
  DATA_READINESS_ASSESSMENT_RUNTIME_KEY,
  DATA_READINESS_ASSESSMENT_STEPS,
  DATA_READINESS_ASSESSMENT_WORKFLOW_ID,
  READINESS_DEFAULT_QUESTION,
  type DataReadinessAssessmentRuntime,
} from './data-readiness-assessment.steps';

interface StubWorkflow {
  id: string;
  options?: { shouldPersistSnapshot?: () => boolean };
  steps: {
    id: string;
    description?: string;
    // The engine's input schema is the declared one that never refuses
    // (`engineInputSchema`): its declared shape is the unwrapped one.
    inputSchema: { unwrap(): { shape: Record<string, unknown> } };
    outputSchema: { shape: Record<string, unknown> };
  }[];
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

const workflow = dataReadinessAssessmentWorkflow as unknown as StubWorkflow;

const DIMENSIONS = [
  { dimension: 'completeness', score: 90, assessed: true, findingCount: 2 },
  { dimension: 'accuracy', score: 100, assessed: false, findingCount: 0 },
];

/** Each phase of the runtime as a Jest mock, so a test reads its calls. */
type MockedRuntime = {
  [K in keyof DataReadinessAssessmentRuntime]: jest.Mock;
} & { calls: string[] };

/** A runtime whose every phase succeeds, with each call recorded. */
function runtime(overrides: Partial<MockedRuntime> = {}): MockedRuntime {
  const calls: string[] = [];
  return {
    calls,
    resolve: jest.fn(({ dataset }: { dataset: string }) => {
      calls.push(`resolve:${dataset}`);
      return Promise.resolve({
        dataset,
        datasourceName: 'World Cup DB',
        datasourceKind: 'postgres' as const,
        tableCount: 3,
      });
    }),
    profile: jest.fn(() => {
      calls.push('profile');
      return Promise.resolve({
        entityCount: 3,
        relationshipCount: 2,
        notProfiledCount: 0,
        stopped: false,
      });
    }),
    score: jest.fn(() => {
      calls.push('score');
      return {
        overallScore: 84,
        maturity: 'Managed',
        findingCount: 2,
        dimensionScores: DIMENSIONS,
      };
    }),
    save: jest.fn(() => {
      calls.push('save');
      return Promise.resolve({ reportId: 'r-1' });
    }),
    explain: jest.fn((input: { question: string; reportId: string }) => {
      calls.push(`explain:${input.reportId}:${input.question}`);
      return Promise.resolve({
        answer: 'The dataset is Managed (84).',
        stopped: false,
      });
    }),
    ...overrides,
  };
}

async function run(given: MockedRuntime | undefined, question = '') {
  const requestContext = new RequestContext();
  if (given) requestContext.set(DATA_READINESS_ASSESSMENT_RUNTIME_KEY, given);
  const output = (await workflow.createRun()).stream({
    inputData: { question, dataset: 'World Cup' },
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

describe('data-readiness-assessment workflow (agents.md 5.13)', () => {
  it('runs its six steps in order and never persists a snapshot', () => {
    expect(workflow.id).toBe(DATA_READINESS_ASSESSMENT_WORKFLOW_ID);
    expect(workflow.steps.map((s) => [s.id, s.description])).toEqual([
      ['resolve-dataset', 'Resolve dataset'],
      ['profile-source', 'Profile source'],
      ['score-readiness', 'Score readiness'],
      ['save-report', 'Save report'],
      ['explain-report', 'Explain report'],
      ['wrap-up', 'Wrap up'],
    ]);
    expect(workflow.options?.shouldPersistSnapshot?.()).toBe(false);
  });

  // The workflow drawing reads the catalogue (agents.md 5.12): its field
  // names must be the built step's own schema fields.
  it("matches the step catalogue's ids and input and output fields", () => {
    expect(
      workflow.steps.map((step) => ({
        id: step.id,
        input: Object.keys(step.inputSchema.unwrap().shape),
        output: Object.keys(step.outputSchema.shape),
      })),
    ).toEqual(
      DATA_READINESS_ASSESSMENT_STEPS.map((step) => ({
        id: step.id,
        input: [...step.input],
        output: [...step.output],
      })),
    );
  });

  it('profiles, scores, saves and explains, and returns the summary', async () => {
    const given = runtime();
    const { events, result } = await run(given, '  Worst problems?  ');
    expect(given.calls).toEqual([
      'resolve:World Cup',
      'profile',
      'score',
      'save',
      'explain:r-1:Worst problems?',
    ]);
    expect(events.filter((e) => e.endsWith(':success'))).toEqual([
      'resolve-dataset:success',
      'profile-source:success',
      'score-readiness:success',
      'save-report:success',
      'explain-report:success',
      'wrap-up:success',
    ]);
    expect(result).toMatchObject({
      status: 'success',
      result: {
        reportId: 'r-1',
        overallScore: 84,
        maturity: 'Managed',
        findingCount: 2,
        answer: 'The dataset is Managed (84).',
      },
    });
  });

  it('asks the default question when the run gives none (data-readiness R2)', async () => {
    const given = runtime();
    await run(given, '   ');
    expect(given.explain).toHaveBeenCalledWith({
      question: READINESS_DEFAULT_QUESTION,
      dataset: 'World Cup',
      reportId: 'r-1',
    });
  });

  it('ends at Profile source when the run is stopped there: nothing is scored or stored', async () => {
    const given = runtime({
      profile: jest.fn().mockResolvedValue({
        entityCount: 0,
        relationshipCount: 0,
        notProfiledCount: 0,
        stopped: true,
      }),
    });
    const { events, result } = await run(given);
    expect(given.score).not.toHaveBeenCalled();
    expect(given.save).not.toHaveBeenCalled();
    expect(given.explain).not.toHaveBeenCalled();
    expect(events).not.toContain('score-readiness:success');
    expect(result).toMatchObject({
      status: 'success',
      result: { stopped: true },
    });
  });

  it('ends at Explain report when the agent turn is stopped', async () => {
    const given = runtime({
      explain: jest.fn().mockResolvedValue({ answer: '', stopped: true }),
    });
    const { events, result } = await run(given);
    expect(events).not.toContain('wrap-up:success');
    expect(result).toMatchObject({
      status: 'success',
      result: { reportId: 'r-1', stopped: true },
    });
  });

  it('fails with the reason Resolve dataset gives, and runs nothing after it', async () => {
    const given = runtime({
      resolve: jest
        .fn()
        .mockRejectedValue(
          new Error(
            'Data readiness supports PostgreSQL and Databricks datasources only',
          ),
        ),
    });
    const { result } = await run(given);
    expect(result.status).toBe('failed');
    expect(String(result.error)).toContain(
      'Data readiness supports PostgreSQL and Databricks datasources only',
    );
    expect(given.profile).not.toHaveBeenCalled();
  });

  it('fails Resolve dataset when the run hands it no assessment', async () => {
    const { result } = await run(undefined);
    expect(result.status).toBe('failed');
    expect(String(result.error)).toContain(
      'The Resolve dataset step has no assessment to run',
    );
  });

  it('fails Score readiness with a contract violation when the engine output is wrong', async () => {
    const given = runtime({
      score: jest.fn(() => ({
        overallScore: 'high' as unknown as number,
        maturity: 'Managed',
        findingCount: 0,
        dimensionScores: [],
      })),
    });
    const { result } = await run(given);
    expect(result.status).toBe('failed');
    expect(String(result.error)).toContain(
      'Contract violation in Score readiness: overallScore',
    );
    expect(given.save).not.toHaveBeenCalled();
  });
});
