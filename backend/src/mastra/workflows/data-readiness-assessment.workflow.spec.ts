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
  READ_IMAGES_OUTCOME_ID,
  READ_IMAGES_RUNTIME_KEY,
  READ_IMAGES_STEP_ID,
  type ReadImagesRuntime,
} from './read-images.steps';
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
    findingRows: jest.fn(() => {
      calls.push('finding-rows');
      return Promise.resolve({
        sourceCount: 2,
        failedSourceCount: 0,
        stopped: false,
      });
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

async function run(
  given: MockedRuntime | undefined,
  question = '',
  images?: { paths: string[]; reader: ReadImagesRuntime },
) {
  const requestContext = new RequestContext();
  if (given) requestContext.set(DATA_READINESS_ASSESSMENT_RUNTIME_KEY, given);
  if (images) requestContext.set(READ_IMAGES_RUNTIME_KEY, images.reader);
  const output = (await workflow.createRun()).stream({
    inputData: {
      question,
      dataset: 'World Cup',
      ...(images ? { images: images.paths } : {}),
    },
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
  it('runs its seven steps in order (Read images is the optional branch) and never persists a snapshot', () => {
    expect(workflow.id).toBe(DATA_READINESS_ASSESSMENT_WORKFLOW_ID);
    expect(workflow.steps.map((s) => [s.id, s.description])).toEqual([
      ['resolve-dataset', 'Resolve dataset'],
      ['profile-source', 'Profile source'],
      ['score-readiness', 'Score readiness'],
      ['save-report', 'Save report'],
      ['finding-rows', 'Rows behind findings'],
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
      DATA_READINESS_ASSESSMENT_STEPS.filter(
        (step) => step.id !== READ_IMAGES_STEP_ID,
      ).map((step) => ({
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
      'finding-rows',
      'explain:r-1:Worst problems?',
    ]);
    // No images: Read images is skipped and the notes are ''.
    expect(events.filter((e) => e.startsWith('read-images:'))).toEqual([]);
    expect(given.explain).toHaveBeenCalledWith(
      expect.objectContaining({ imageNotes: '' }),
    );
    expect(
      events.filter(
        (e) =>
          e.endsWith(':success') && !e.startsWith(`${READ_IMAGES_OUTCOME_ID}:`),
      ),
    ).toEqual([
      'resolve-dataset:success',
      'profile-source:success',
      'score-readiness:success',
      'save-report:success',
      'finding-rows:success',
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
      imageNotes: '',
    });
  });

  it("reads the reference images first and hands Zoe's notes to Explain report", async () => {
    const given = runtime();
    const notes = '## Reference images\nA scorecard screenshot.';
    const readImages = jest.fn(() =>
      Promise.resolve({ imageNotes: notes, imageCount: 1, stopped: false }),
    );
    const { events, result } = await run(given, '', {
      paths: ['inputs/images/1.png'],
      reader: { readImages },
    });
    expect(readImages).toHaveBeenCalledWith({
      question: '',
      images: ['inputs/images/1.png'],
    });
    expect(events.filter((e) => e.endsWith(':success')).slice(0, 3)).toEqual([
      'read-images:success',
      `${READ_IMAGES_OUTCOME_ID}:success`,
      'resolve-dataset:success',
    ]);
    // The notes travel through every step's data to Explain report.
    expect(given.explain).toHaveBeenCalledWith(
      expect.objectContaining({ imageNotes: notes }),
    );
    expect(result.status).toBe('success');
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

  // Roadmap 1.27.11: the rows behind the report's top findings become the
  // answer's sources before the agent explains the report.
  it('looks up the rows behind the findings after Save report and before Explain report', async () => {
    const given = runtime();
    const { events } = await run(given);
    expect(given.calls.slice(-3)).toEqual([
      'save',
      'finding-rows',
      expect.stringMatching(/^explain:r-1:/),
    ]);
    expect(given.findingRows).toHaveBeenCalledTimes(1);
    expect(events).toContain('finding-rows:success');
  });

  it('goes on to Explain report when some finding queries failed', async () => {
    const given = runtime({
      findingRows: jest.fn().mockResolvedValue({
        sourceCount: 3,
        failedSourceCount: 2,
        stopped: false,
      }),
    });
    const { events, result } = await run(given);
    expect(events).toContain('finding-rows:success');
    expect(given.explain).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'success',
      result: { reportId: 'r-1', answer: 'The dataset is Managed (84).' },
    });
  });

  it('ends at Rows behind findings when the run is stopped there: the agent never runs', async () => {
    const given = runtime({
      findingRows: jest.fn().mockResolvedValue({
        sourceCount: 1,
        failedSourceCount: 0,
        stopped: true,
      }),
    });
    const { events, result } = await run(given);
    expect(given.explain).not.toHaveBeenCalled();
    expect(events).not.toContain('explain-report:success');
    expect(result).toMatchObject({
      status: 'success',
      result: { reportId: 'r-1', stopped: true },
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
