// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.branch()` and `.map()` with the engine's step events (see it).
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
          tables: ['wc.public.matches'],
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
import type { ExplorableQuery } from '../../modules/sessions/query-evidence/explorable-queries';
import type { ExplorerSpec } from '../agents/result-explorer.prompts';
import { askAgentWorkflow } from './ask-agent.workflow';
import {
  ASK_AGENT_RUNTIME_KEY,
  ASK_AGENT_WORKFLOW_ID,
  ASK_NEW_QUESTION_REPLY,
  ASK_NO_IMAGES_REPLY,
  ASK_NO_RESULT_REPLY,
  ASKABLE_STEP_IDS,
  type AskAgentRuntime,
  type AskableStepId,
} from './ask-agent.steps';
import type { AnalysisPlan } from './answer-business-question.steps';

interface StubWorkflow {
  id: string;
  options?: { shouldPersistSnapshot?: () => boolean };
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

const workflow = askAgentWorkflow as unknown as StubWorkflow;

const PLAN: AnalysisPlan = {
  question: 'How many matches were played per year?',
  measures: ['match count per year'],
  entities: ['wc.public.matches'],
  scope: 'every tournament',
  assumptions: ['a match counts once'],
  needsClarification: false,
  clarification: null,
};

const EARLIER: ExplorableQuery = {
  ref: 'Q1',
  sql: 'SELECT year, COUNT(*) AS matches FROM wc.public.matches GROUP BY year',
  datasourceId: 'ds-pg',
  columns: ['year', 'matches'],
  kinds: { year: 'number', matches: 'number' },
  sampleValues: { year: [2022], matches: [64] },
  rationale: 'Matches per year.',
};

const NEXT_PAGE: ExplorerSpec = {
  action: 'explore',
  query: 0,
  interpretation: {
    request: { filters: [], sort: [], page: 2, pageSize: 50 },
    understood: 'page 2',
  },
};

const PAGE = {
  title: 'Matches per year.',
  columns: ['year', 'matches'],
  rows: [{ year: 1990, matches: 52 }],
  page: 2,
  pageCount: 2,
  matchedRows: 51,
  capped: false,
  view: {
    filters: [],
    sort: [],
    page: 2,
    pageSize: 50,
    matchedRows: 51,
    capped: false,
  },
  understood: 'page 2',
};

/** The runtime with every function a typed Jest mock. */
type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? jest.Mock<R, A>
    : T[K];
};
type Turn = Mocked<AskAgentRuntime>;

/** A typed mock of one runtime function. */
const mockOf = <K extends keyof AskAgentRuntime>(
  _key: K,
  impl: Turn[K] extends jest.Mock<infer R, infer A> ? (...args: A) => R : never,
) => jest.fn(impl) as unknown as Turn[K];

function runtime(overrides: Partial<Turn> = {}): Turn {
  return {
    answer: mockOf('answer', () =>
      Promise.resolve({ calls: [], stopped: false }),
    ),
    readImages: mockOf('readImages', () =>
      Promise.resolve({
        imageNotes: 'Image 1: a bar chart of goals.',
        imageCount: 1,
        stopped: false,
      }),
    ),
    followUp: [EARLIER],
    interpretFollowUp: mockOf('interpretFollowUp', () =>
      Promise.resolve({ spec: NEXT_PAGE, stopped: false }),
    ),
    pageResult: mockOf('pageResult', () => Promise.resolve(PAGE)),
    plan: mockOf('plan', () => Promise.resolve({ plan: PLAN, stopped: false })),
    earlierAnswer: mockOf('earlierAnswer', () => ({
      plan: PLAN,
      queries: [{ sql: EARLIER.sql, rows: [], rowCount: 0, truncated: false }],
      findings: [],
      imageNotes: '',
    })),
    writeAnswer: mockOf('writeAnswer', () =>
      Promise.resolve({
        answer: { headline: 'Shorter', answer: 'Shorter answer.' },
        stopped: false,
      }),
    ),
    deliverAnswer: mockOf('deliverAnswer', () => Promise.resolve()),
    ...overrides,
  };
}

async function ask(
  askStep: AskableStepId,
  turn: Turn,
  extra: { images?: string[] } = {},
) {
  const requestContext = new RequestContext();
  requestContext.set(ASK_AGENT_RUNTIME_KEY, turn);
  const output = (await workflow.createRun()).stream({
    inputData: {
      question: 'Next page',
      datasets: ['World Cup'],
      askStep,
      ...extra,
    },
    requestContext,
  });
  const events: string[] = [];
  for await (const event of output.fullStream) {
    if (event.payload?.id && event.type === 'workflow-step-result') {
      events.push(`${event.payload.id}:${event.payload.status}`);
    }
  }
  return { events, result: await output.result };
}

/** The steps that ran, without the outcome map. */
function ran(events: string[]): string[] {
  return events.filter((event) => !event.startsWith('ask-agent-outcome'));
}

describe('ask-agent workflow (workflows R38; agents.md 5.21)', () => {
  it('is registered under its id and never persists a snapshot', () => {
    expect(workflow.id).toBe(ASK_AGENT_WORKFLOW_ID);
    expect(workflow.options?.shouldPersistSnapshot?.()).toBe(false);
  });

  it.each(ASKABLE_STEP_IDS)(
    'asking %s runs only that step, under its own id',
    async (step) => {
      const { events, result } = await ask(step, runtime());
      expect(result.status).toBe('success');
      expect(ran(events)).toEqual([`${step}:success`]);
    },
  );

  it('asks the Analyst alone: the agent turn, with no plan or answer writer', async () => {
    const turn = runtime();
    await ask('analyse', turn);
    expect(turn.answer).toHaveBeenCalledTimes(1);
    expect(turn.plan).not.toHaveBeenCalled();
    expect(turn.writeAnswer).not.toHaveBeenCalled();
    expect(turn.deliverAnswer).not.toHaveBeenCalled();
  });

  it('asks Sarah alone through the same agent turn', async () => {
    const turn = runtime();
    await ask('check-data-quality', turn);
    expect(turn.answer).toHaveBeenCalledTimes(1);
  });

  it("asks Jessica to write again from the earlier answer's queries", async () => {
    const turn = runtime();
    await ask('write-answer', turn);
    expect(turn.earlierAnswer).toHaveBeenCalledTimes(1);
    expect(turn.writeAnswer).toHaveBeenCalledWith({
      question: 'Next page',
      plan: PLAN,
      queries: [expect.objectContaining({ sql: EARLIER.sql })],
      findings: [],
      imageNotes: '',
    });
    expect(turn.answer).not.toHaveBeenCalled();
  });

  it('asks Olivia to plan the question over the catalog: the plan in words is the answer', async () => {
    const turn = runtime();
    await ask('plan', turn);
    const [request] = turn.plan.mock.calls[0];
    expect(request.question).toBe('Next page');
    expect(request.catalogBlock).toContain('wc.public.matches');
    const answer = turn.deliverAnswer.mock.calls[0][0];
    expect(answer).toContain('**How I would analyse it:**');
    expect(answer).toContain('- match count per year');
    expect(answer).toContain('no data was read');
  });

  it('asks Nathan to page the earlier result: Page result, then the page as the answer', async () => {
    const turn = runtime();
    await ask('interpret-follow-up', turn);
    expect(turn.interpretFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Next page' }),
    );
    expect(turn.pageResult).toHaveBeenCalledWith({
      query: 0,
      request: NEXT_PAGE.interpretation.request,
      understood: 'page 2',
    });
    const answer = turn.deliverAnswer.mock.calls[0][0];
    expect(answer).toContain('Rows 51–51 of 51');
    expect(answer).toContain('Query: Matches per year.');
  });

  it('has Nathan say a new question is not his, and never plans it', async () => {
    const turn = runtime({
      interpretFollowUp: mockOf('interpretFollowUp', () =>
        Promise.resolve({
          spec: { action: 'new-question' } as unknown as ExplorerSpec,
          stopped: false,
        }),
      ),
    });
    await ask('interpret-follow-up', turn);
    expect(turn.pageResult).not.toHaveBeenCalled();
    expect(turn.plan).not.toHaveBeenCalled();
    expect(turn.deliverAnswer).toHaveBeenCalledWith(ASK_NEW_QUESTION_REPLY);
  });

  it('has Nathan say so, with no model call, when the earlier answer ran no query', async () => {
    const turn = runtime({ followUp: [] });
    await ask('interpret-follow-up', turn);
    expect(turn.interpretFollowUp).not.toHaveBeenCalled();
    expect(turn.deliverAnswer).toHaveBeenCalledWith(ASK_NO_RESULT_REPLY);
  });

  it("fails the step on Nathan's model error, instead of planning", async () => {
    const turn = runtime({
      interpretFollowUp: mockOf('interpretFollowUp', () =>
        Promise.reject(new Error('The model is down')),
      ),
    });
    const { result } = await ask('interpret-follow-up', turn);
    expect(result.status).toBe('failed');
    expect(turn.deliverAnswer).not.toHaveBeenCalled();
  });

  it("asks Zoe to read the run's images again with the question", async () => {
    const turn = runtime();
    await ask('read-images', turn, { images: ['inputs/images/1.png'] });
    expect(turn.readImages).toHaveBeenCalledWith({
      question: 'Next page',
      images: ['inputs/images/1.png'],
    });
    expect(turn.deliverAnswer).toHaveBeenCalledWith(
      'Image 1: a bar chart of goals.',
    );
  });

  it('has Zoe say so, with no model call, when the run has no image', async () => {
    const turn = runtime();
    await ask('read-images', turn);
    expect(turn.readImages).not.toHaveBeenCalled();
    expect(turn.deliverAnswer).toHaveBeenCalledWith(ASK_NO_IMAGES_REPLY);
  });

  it('delivers nothing when the asked call was stopped', async () => {
    const turn = runtime({
      plan: mockOf('plan', () =>
        Promise.resolve({ plan: PLAN, stopped: true }),
      ),
    });
    await ask('plan', turn);
    expect(turn.deliverAnswer).not.toHaveBeenCalled();
  });
});
