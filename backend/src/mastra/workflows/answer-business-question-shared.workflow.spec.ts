// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs the same control flow and step events.
jest.mock('@mastra/core/workflows', () =>
  jest.requireActual<typeof import('../testing/workflows.stub')>(
    '../testing/workflows.stub',
  ),
);
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: (names: string[]) =>
      Promise.resolve(
        names.map((name) => ({
          name,
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          tables: ['wc.public.matches', 'wc.public.teams'],
          entities: [
            {
              key: 'wc.public.matches',
              columns: [{ name: 'id' }, { name: 'year' }],
            },
          ],
        })),
      ),
  }),
}));

import { RequestContext } from '@mastra/core/request-context';
import { answerBusinessQuestionWorkflow } from './answer-business-question.workflow';
import {
  ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  type AnalyseAttempt,
  type AnalysisPlan,
} from './answer-business-question.steps';
import {
  ANSWER_BUSINESS_QUESTION_SHARED_WORKFLOW_ID,
  PUBLISH_RUN_CONTEXT_STEP,
} from './answer-business-question-shared.steps';
import { answerBusinessQuestionSharedWorkflow } from './answer-business-question-shared.workflow';
import {
  READ_IMAGES_RUNTIME_KEY,
  type ReadImagesRuntime,
} from './read-images.steps';
import {
  RUN_CONTEXT_KEY,
  RUN_CONTEXT_KEYS,
  RunContextBoard,
} from './run-context';

interface StubNode {
  id: string;
  description?: string;
  entries?: StubEntry[];
}
type StubEntry =
  | { type: 'step'; step: StubNode }
  | { type: 'branch'; pairs: [unknown, StubNode][] }
  | { type: 'dountil'; step: StubNode }
  | { type: 'map'; id: string };

interface StubStream {
  fullStream: AsyncIterable<{
    type: string;
    payload?: { id?: string; status?: string; output?: unknown };
  }>;
  result: Promise<{ status: string; result?: unknown; error?: unknown }>;
}

interface StubWorkflow extends StubNode {
  entries: StubEntry[];
  createRun(): Promise<{
    stream(args: { inputData: unknown; requestContext: unknown }): StubStream;
  }>;
}

const shared = answerBusinessQuestionSharedWorkflow as unknown as StubWorkflow;
const original = answerBusinessQuestionWorkflow as unknown as StubWorkflow;

/** The ids of a workflow's own top-level entries, in order. */
function topLevel(node: StubNode): string[] {
  return (node.entries ?? []).map((entry) =>
    entry.type === 'step' || entry.type === 'dountil'
      ? entry.step.id
      : entry.type === 'map'
        ? entry.id
        : 'branch',
  );
}

const PLAN: AnalysisPlan = {
  question: 'How many matches are in the data?',
  measures: ['match count'],
  entities: ['wc.public.matches'],
  scope: 'Every match in the data.',
  assumptions: [],
  needsClarification: false,
  clarification: null,
};

const GOOD_ATTEMPT: AnalyseAttempt = {
  calls: [{ tool: 'run_readonly_sql', rowCount: 1, failed: false }],
  queries: [
    {
      sql: 'SELECT count(*) AS match_count FROM wc.public.matches',
      rationale: 'I count the matches.',
      rows: [{ match_count: 16 }],
      rowCount: 1,
      truncated: false,
    },
  ],
  text: 'There are 16 matches.',
  stopped: false,
};

function turn() {
  return {
    plan: jest.fn(() => Promise.resolve({ plan: PLAN, stopped: false })),
    analyse: jest.fn(() => Promise.resolve(GOOD_ATTEMPT)),
    buildVisual: jest.fn(),
    writeAnswer: jest.fn(() =>
      Promise.resolve({
        answer: {
          headline: 'The data holds 16 matches.',
          answer: 'The data holds 16 matches.',
        },
        stopped: false,
      }),
    ),
  };
}

async function run(options: {
  board?: RunContextBoard;
  images?: { notes: string };
}) {
  const requestContext = new RequestContext();
  requestContext.set(ANSWER_BUSINESS_QUESTION_RUNTIME_KEY, turn());
  if (options.board) requestContext.set(RUN_CONTEXT_KEY, options.board);
  if (options.images) {
    const notes = options.images.notes;
    const reader: ReadImagesRuntime = {
      readImages: () =>
        Promise.resolve({ imageNotes: notes, imageCount: 1, stopped: false }),
    };
    requestContext.set(READ_IMAGES_RUNTIME_KEY, reader);
  }
  const engineRun = await shared.createRun();
  const output = engineRun.stream({
    inputData: {
      question: 'How many matches?',
      datasets: ['World Cup'],
      ...(options.images ? { images: ['inputs/images/1.png'] } : {}),
    },
    requestContext,
  });
  const events: string[] = [];
  const outputs = new Map<string, unknown>();
  for await (const event of output.fullStream) {
    if (event.payload?.id) {
      events.push(`${event.payload.id}:${event.payload.status}`);
      if (event.type === 'workflow-step-result') {
        outputs.set(event.payload.id, event.payload.output);
      }
    }
  }
  return { events, outputs, result: await output.result };
}

describe('answer-business-question-shared workflow (shared-context experiment)', () => {
  it('has its own id and the original chain with Publish run context right after Load catalog', () => {
    expect(shared.id).toBe(ANSWER_BUSINESS_QUESTION_SHARED_WORKFLOW_ID);
    expect(shared.id).not.toBe(original.id);
    const own = topLevel(shared);
    const base = topLevel(original);
    const at = own.indexOf('load-catalog');
    expect(own[at + 1]).toBe(PUBLISH_RUN_CONTEXT_STEP.id);
    expect(own.filter((id) => id !== PUBLISH_RUN_CONTEXT_STEP.id)).toEqual(
      base,
    );
    const publish = shared.entries.find(
      (entry) =>
        entry.type === 'step' && entry.step.id === PUBLISH_RUN_CONTEXT_STEP.id,
    ) as { step: StubNode };
    expect(publish.step.description).toBe(PUBLISH_RUN_CONTEXT_STEP.title);
  });

  it('completes a run, and Publish run context fills the board and passes its input on unchanged', async () => {
    const board = new RunContextBoard();
    const { events, outputs, result } = await run({ board });
    expect(result.status).toBe('success');
    expect(events).toEqual(
      expect.arrayContaining([
        'load-catalog:success',
        'publish-run-context:running',
        'publish-run-context:success',
        'interpret-follow-up:success',
        'question-path:success',
      ]),
    );
    expect(events.indexOf('publish-run-context:running')).toBeGreaterThan(
      events.indexOf('load-catalog:success'),
    );
    expect(events.indexOf('interpret-follow-up:running')).toBeGreaterThan(
      events.indexOf('publish-run-context:success'),
    );
    expect(board.has(RUN_CONTEXT_KEYS.catalog('wc.public.matches'))).toBe(true);
    expect(board.has(RUN_CONTEXT_KEYS.catalog('wc.public.teams'))).toBe(true);
    expect(outputs.get('publish-run-context')).toEqual(
      outputs.get('load-catalog'),
    );
    // No images: nothing to publish as notes.
    expect(board.has(RUN_CONTEXT_KEYS.imageNotes)).toBe(false);
  });

  it("publishes Read images' notes when the run has images", async () => {
    const board = new RunContextBoard();
    const notes = '## Reference images\nA bar chart of goals per team.';
    const { result } = await run({ board, images: { notes } });
    expect(result.status).toBe('success');
    expect(board.has(RUN_CONTEXT_KEYS.imageNotes)).toBe(true);
    expect(board.get(RUN_CONTEXT_KEYS.imageNotes)?.content).toContain(
      'bar chart',
    );
  });

  it('fails Publish run context with "The run context is missing" when the run has no board', async () => {
    const { events, result } = await run({});
    expect(result.status).toBe('failed');
    expect(String((result.error as Error)?.message ?? result.error)).toContain(
      'The run context is missing',
    );
    expect(events).toContain('publish-run-context:failed');
    expect(events).not.toContain('interpret-follow-up:running');
  });
});
