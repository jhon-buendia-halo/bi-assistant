// The real engine pulls in ESM-only packages Jest cannot require; the stub
// runs `.then()`, `.branch()`, `.dountil()` and nested workflows with the
// engine's step events (see it).
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
import type { z } from 'zod';
import type { ExplorableQuery } from '../../modules/sessions/query-evidence/explorable-queries';
import type { ExplorerSpec } from '../agents/result-explorer.prompts';
import { answerBusinessQuestionWorkflow } from './answer-business-question.workflow';
import {
  ANSWER_BUSINESS_QUESTION_RUNTIME_KEY,
  ANSWER_BUSINESS_QUESTION_STEPS,
  ANSWER_BUSINESS_QUESTION_WORKFLOW_ID,
  turnSummaryOf,
  type AnalyseAttempt,
  type AnalysisPlan,
  type AnswerBusinessQuestionRuntime,
} from './answer-business-question.steps';
import {
  READ_IMAGES_OUTCOME_ID,
  READ_IMAGES_RUNTIME_KEY,
  type ReadImagesRuntime,
} from './read-images.steps';
import {
  ContractViolationError,
  contractJsonSchema,
} from './workflow-contract';

interface StubNode {
  id: string;
  description?: string;
  inputSchema?: z.ZodCatch<z.ZodType>;
  outputSchema?: z.ZodType;
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
    payload?: {
      id?: string;
      status?: string;
      output?: unknown;
      suspendPayload?: unknown;
    };
  }>;
  result: Promise<{
    status: string;
    result?: unknown;
    error?: unknown;
    suspended?: string[][];
    steps?: Record<string, { suspendPayload?: unknown }>;
  }>;
}

interface StubRun {
  stream(args: { inputData: unknown; requestContext: unknown }): StubStream;
  resumeStream(args: {
    step: string[];
    resumeData: unknown;
    requestContext: unknown;
  }): StubStream;
}

interface StubWorkflow extends StubNode {
  entries: StubEntry[];
  createRun(): Promise<StubRun>;
}

const workflow = answerBusinessQuestionWorkflow as unknown as StubWorkflow;

/** The leaf steps of a workflow, nested workflows walked depth first. */
function leafSteps(node: StubNode): StubNode[] {
  if (!node.entries) return [node];
  return node.entries.flatMap((entry) =>
    entry.type === 'map'
      ? []
      : entry.type === 'branch'
        ? entry.pairs.flatMap(([, step]) => leafSteps(step))
        : leafSteps(entry.step),
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

const CLARIFYING: AnalysisPlan = {
  ...PLAN,
  needsClarification: true,
  clarification: {
    question: 'Dominant by what measure?',
    options: ['Matches won', 'Goals scored'],
  },
};

const GOOD_ATTEMPT: AnalyseAttempt = {
  calls: [
    { tool: 'list_entities', failed: false },
    { tool: 'run_readonly_sql', rowCount: 1, failed: false },
  ],
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

const FAILED_ATTEMPT: AnalyseAttempt = {
  calls: [{ tool: 'run_readonly_sql', failed: true }],
  queries: [
    {
      sql: 'SELECT nope',
      rows: [],
      rowCount: 0,
      truncated: false,
      error: 'column "nope" does not exist',
    },
  ],
  text: '',
  stopped: false,
};

/** The runtime's step calls (its flags left out). */
type TurnCalls = Required<
  Omit<AnswerBusinessQuestionRuntime, 'checksDataQuality' | 'followUp'>
>;

/** A runtime whose model steps are mocks, each answering as scripted. */
type ScriptedTurn = {
  [K in keyof TurnCalls]: jest.Mock<
    ReturnType<TurnCalls[K]>,
    Parameters<TurnCalls[K]>
  >;
} & {
  checksDataQuality?: boolean;
  followUp?: AnswerBusinessQuestionRuntime['followUp'];
};

/** A runtime whose model steps answer as scripted. */
function runtime(
  overrides: Partial<AnswerBusinessQuestionRuntime> = {},
): ScriptedTurn {
  return {
    plan: jest.fn(() => Promise.resolve({ plan: PLAN, stopped: false })),
    analyse: jest.fn(() => Promise.resolve(GOOD_ATTEMPT)),
    // Called only when the run asks for it (`checksDataQuality`).
    checkDataQuality: jest.fn(() =>
      Promise.resolve({
        findings: [],
        dataQuality: {
          tables: [],
          reportIds: [],
          findingCount: 0,
          issues: 0,
          skipped: [],
        },
        stopped: false,
      }),
    ),
    writeAnswer: jest.fn(() =>
      Promise.resolve({
        answer: {
          headline: 'The data holds 16 matches.',
          answer: 'The data holds 16 matches.\n\nHow I got this: …',
        },
        stopped: false,
      }),
    ),
    ...overrides,
  } as ScriptedTurn;
}

async function run(
  question: string,
  turn: ScriptedTurn | AnswerBusinessQuestionRuntime | undefined,
  datasets: unknown = ['World Cup'],
  images?: { paths: string[]; reader: ReadImagesRuntime },
) {
  const requestContext = new RequestContext();
  if (turn) requestContext.set(ANSWER_BUSINESS_QUESTION_RUNTIME_KEY, turn);
  if (images) requestContext.set(READ_IMAGES_RUNTIME_KEY, images.reader);
  const engineRun = await workflow.createRun();
  const drained = await drain(
    engineRun.stream({
      inputData: {
        question,
        datasets,
        ...(images ? { images: images.paths } : {}),
      },
      requestContext,
    }),
  );
  return { ...drained, engineRun, requestContext };
}

/** Read images' notes on one reference image, as a runtime returns them. */
const NOTES = '## Reference images\nA bar chart of goals per team.';

/** A Read images runtime that describes the images as `NOTES`. */
function reader(): { readImages: jest.Mock } {
  return {
    readImages: jest.fn(() =>
      Promise.resolve({ imageNotes: NOTES, imageCount: 1, stopped: false }),
    ),
  };
}

/** A run with one reference image. */
const ONE_IMAGE = () => ({ paths: ['inputs/images/1.png'], reader: reader() });

/** The events of a run without images: Read images' branch is not taken. */
const NO_IMAGES = [
  `${READ_IMAGES_OUTCOME_ID}:running`,
  `${READ_IMAGES_OUTCOME_ID}:success`,
];

/** A stream's step events (`<id>:<status>`), step outputs and result. */
async function drain(output: StubStream) {
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

/** Resume a suspended run with the user's answer, at the path it gave. */
async function resume(
  started: Awaited<ReturnType<typeof run>>,
  answer: string,
  path = started.result.suspended![0],
) {
  return drain(
    started.engineRun.resumeStream({
      step: path,
      resumeData: { answer },
      requestContext: started.requestContext,
    }),
  );
}

/** The plan loop's events of a round where Plan needed no clarification. */
const CLEAR_PLAN_ROUND = [
  'question-path.plan-round:running',
  'question-path.plan-round.plan:running',
  'question-path.plan-round.plan:success',
  'question-path.plan-round.plan-round-outcome:running',
  'question-path.plan-round.plan-round-outcome:success',
  'question-path.plan-round:success',
];

describe('answer-business-question workflow (agents.md 5.11, ADR-0034)', () => {
  it('builds the thirteen catalogue steps, in order, with their titles', () => {
    expect(workflow.id).toBe(ANSWER_BUSINESS_QUESTION_WORKFLOW_ID);
    expect(leafSteps(workflow).map((s) => [s.id, s.description])).toEqual([
      ['read-images', 'Read images'],
      ['receive-question', 'Receive question'],
      ['load-catalog', 'Load catalog'],
      ['interpret-follow-up', 'Interpret follow-up'],
      ['plan', 'Plan'],
      ['clarify', 'Clarify'],
      ['analyse', 'Analyse'],
      ['validate', 'Validate'],
      ['check-data-quality', 'Check data quality'],
      ['write-answer', 'Write answer'],
      ['wrap-up', 'Wrap up'],
      ['page-result', 'Page result'],
      ['page-answer', 'Page answer'],
    ]);
  });

  it('is built with a .branch() to Read images and its outcome map first, then Interpret follow-up and a .branch() to the question path (.dountil() around the plan round, a .branch() to the analysis, .dountil() around the analysis attempt) or to the explore path', () => {
    expect(workflow.entries.map((entry) => entry.type)).toEqual([
      'branch',
      'map',
      'step',
      'step',
      'step',
      'branch',
    ]);
    const top = workflow.entries[5] as Extract<StubEntry, { type: 'branch' }>;
    expect(top.pairs.map(([, step]) => step.id)).toEqual([
      'question-path',
      'explore-result',
    ]);
    const questionPath = top.pairs[0][1];
    expect(questionPath.entries?.map((entry) => entry.type)).toEqual([
      'map',
      'dountil',
      'branch',
    ]);
    const readImages = workflow.entries[0] as Extract<
      StubEntry,
      { type: 'branch' }
    >;
    expect(readImages.pairs.map(([, step]) => step.id)).toEqual([
      'read-images',
    ]);
    expect(workflow.entries[1]).toMatchObject({ id: READ_IMAGES_OUTCOME_ID });
    const planLoop = questionPath.entries![1] as Extract<
      StubEntry,
      { type: 'dountil' }
    >;
    expect(planLoop.step.id).toBe('plan-round');
    expect(planLoop.step.entries?.map((entry) => entry.type)).toEqual([
      'step',
      'branch',
      'map',
    ]);
    expect(leafSteps(planLoop.step).map((step) => step.id)).toEqual([
      'plan',
      'clarify',
    ]);
    const branch = questionPath.entries![2] as Extract<
      StubEntry,
      { type: 'branch' }
    >;
    expect(branch.pairs.map(([, step]) => step.id)).toEqual(['analysis-path']);
    const path = branch.pairs[0][1];
    expect(path.entries?.map((entry) => entry.type)).toEqual([
      'dountil',
      'branch',
    ]);
    const loop = path.entries![0] as Extract<StubEntry, { type: 'dountil' }>;
    expect(loop.step.id).toBe('analysis-attempt');
    expect(leafSteps(loop.step).map((step) => step.id)).toEqual([
      'analyse',
      'validate',
    ]);
    expect(leafSteps(top.pairs[1][1]).map((step) => step.id)).toEqual([
      'page-result',
      'page-answer',
    ]);
  });

  // The agent's Graph tab draws the catalogue (agents-evals R108): its
  // field names and JSON Schemas must be the built steps' own schemas, in
  // order (agents.md 5.12: one source of truth). The engine sees each
  // declared input schema wrapped so it never refuses (`withContract` does).
  it("matches the step catalogue's ids, fields and JSON Schemas", () => {
    expect(
      leafSteps(workflow).map((step) => ({
        id: step.id,
        input: contractJsonSchema(step.inputSchema!.unwrap(), 'input'),
        output: contractJsonSchema(step.outputSchema!, 'output'),
      })),
    ).toEqual(
      ANSWER_BUSINESS_QUESTION_STEPS.map((step) => ({
        id: step.id,
        input: step.inputSchema,
        output: step.outputSchema,
      })),
    );
    expect(
      Object.fromEntries(
        ANSWER_BUSINESS_QUESTION_STEPS.map((step) => [
          step.id,
          [step.input, step.output],
        ]),
      ),
    ).toEqual({
      'read-images': [
        ['question', 'images'],
        ['imageNotes', 'imageCount'],
      ],
      'receive-question': [
        ['question', 'datasets', 'imageNotes'],
        ['question', 'datasets', 'imageNotes'],
      ],
      'load-catalog': [
        ['question', 'datasets', 'imageNotes'],
        ['question', 'catalog', 'columns', 'imageNotes'],
      ],
      'interpret-follow-up': [
        ['question', 'catalog', 'columns', 'imageNotes'],
        ['question', 'catalog', 'columns', 'imageNotes', 'followUp', 'stopped'],
      ],
      plan: [
        ['question', 'catalog', 'columns', 'imageNotes', 'clarification'],
        ['question', 'catalog', 'plan', 'stopped', 'imageNotes'],
      ],
      clarify: [
        ['question', 'catalog', 'plan', 'stopped', 'imageNotes'],
        ['question', 'catalog', 'columns', 'imageNotes', 'clarification'],
      ],
      analyse: [
        ['question', 'catalog', 'plan', 'attempt', 'findings', 'imageNotes'],
        [
          'question',
          'catalog',
          'plan',
          'attempt',
          'calls',
          'queries',
          'text',
          'stopped',
          'imageNotes',
        ],
      ],
      validate: [
        [
          'question',
          'catalog',
          'plan',
          'attempt',
          'calls',
          'queries',
          'text',
          'stopped',
          'imageNotes',
        ],
        [
          'ok',
          'attempt',
          'findings',
          'question',
          'catalog',
          'plan',
          'calls',
          'queries',
          'imageNotes',
        ],
      ],
      'check-data-quality': [
        [
          'question',
          'plan',
          'queries',
          'findings',
          'calls',
          'imageNotes',
          'catalog',
        ],
        [
          'question',
          'plan',
          'queries',
          'findings',
          'calls',
          'imageNotes',
          'dataQuality',
        ],
      ],
      'write-answer': [
        ['question', 'plan', 'queries', 'findings', 'calls', 'imageNotes'],
        ['headline', 'answer', 'calls'],
      ],
      'wrap-up': [
        ['answer', 'calls'],
        ['sqlQueries', 'failedQueries', 'rows', 'answer'],
      ],
      'page-result': [
        ['question', 'catalog', 'columns', 'imageNotes', 'followUp', 'stopped'],
        [
          'title',
          'columns',
          'rows',
          'page',
          'pageCount',
          'matchedRows',
          'capped',
          'view',
          'understood',
        ],
      ],
      'page-answer': [
        [
          'title',
          'columns',
          'rows',
          'page',
          'pageCount',
          'matchedRows',
          'capped',
          'view',
          'understood',
        ],
        ['sqlQueries', 'failedQueries', 'rows', 'answer'],
      ],
    });
  });

  it('runs with its inputs validated (validateInputs: true)', () => {
    expect(
      (
        answerBusinessQuestionWorkflow as unknown as {
          options: { validateInputs?: boolean };
        }
      ).options.validateInputs,
    ).toBe(true);
  });

  it('plans, analyses, validates and writes the answer on a clear question', async () => {
    const turn = runtime();
    const { events, outputs, result } = await run(
      '  How many matches?  ',
      turn,
    );
    expect(events).toEqual([
      // No images: the branch to Read images is not taken (it is skipped).
      ...NO_IMAGES,
      'receive-question:running',
      'receive-question:success',
      'load-catalog:running',
      'load-catalog:success',
      'interpret-follow-up:running',
      'interpret-follow-up:success',
      'question-path:running',
      'question-path.question-input:running',
      'question-path.question-input:success',
      ...CLEAR_PLAN_ROUND,
      'question-path.analysis-path:running',
      'question-path.analysis-path.analysis-attempt:running',
      'question-path.analysis-path.analysis-attempt.analyse:running',
      'question-path.analysis-path.analysis-attempt.analyse:success',
      'question-path.analysis-path.analysis-attempt.validate:running',
      'question-path.analysis-path.analysis-attempt.validate:success',
      'question-path.analysis-path.analysis-attempt:success',
      'question-path.analysis-path.answer-path:running',
      // No data-quality check asked: its branch is not taken.
      'question-path.analysis-path.answer-path.quality-outcome:running',
      'question-path.analysis-path.answer-path.quality-outcome:success',
      'question-path.analysis-path.answer-path.write-answer:running',
      'question-path.analysis-path.answer-path.write-answer:success',
      'question-path.analysis-path.answer-path.wrap-up:running',
      'question-path.analysis-path.answer-path.wrap-up:success',
      'question-path.analysis-path.answer-path:success',
      'question-path.analysis-path:success',
      'question-path:success',
    ]);
    expect(turn.checkDataQuality).not.toHaveBeenCalled();
    const catalogBlock = [
      'Catalog loaded for this turn: 2 entities.',
      '- wc.public.matches (dataset: World Cup; 2 columns)',
      '- wc.public.teams (dataset: World Cup; ? columns)',
    ].join('\n');
    // Plan also sees each entity's columns (names and types).
    expect(turn.plan).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'How many matches?',
        catalogBlock: [
          catalogBlock,
          '',
          'Columns of each entity (name type):',
          // The stand-in's columns have no type.
          '- wc.public.matches: id, year',
        ].join('\n'),
        imageNotes: '',
      }),
    );
    expect(turn.analyse).toHaveBeenCalledTimes(1);
    expect(turn.analyse).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'How many matches?',
        catalogBlock,
        plan: PLAN,
        attempt: 1,
        planBlock: `Analysis plan for this turn:\n${JSON.stringify(PLAN)}`,
        imageNotes: '',
      }),
    );
    expect(
      outputs.get('question-path.analysis-path.analysis-attempt.validate'),
    ).toMatchObject({ ok: true, attempt: 1 });
    expect(turn.writeAnswer).toHaveBeenCalledWith({
      question: 'How many matches?',
      plan: PLAN,
      queries: GOOD_ATTEMPT.queries,
      findings: expect.arrayContaining([
        expect.objectContaining({ check: 'Ran a query', passed: true }),
      ]) as unknown,
      imageNotes: '',
    });
    expect(result).toEqual({
      status: 'success',
      result: {
        'question-path': {
          'analysis-path': {
            'answer-path': {
              sqlQueries: 1,
              failedQueries: 0,
              rows: 1,
              answer: 'The data holds 16 matches.\n\nHow I got this: …',
            },
          },
        },
      },
    });
  });

  describe('a follow-up over an earlier result (roadmap 1.27.8)', () => {
    const EARLIER: ExplorableQuery = {
      ref: 'Q1',
      sql: 'SELECT m.id AS match_id, m.stage FROM wc.public.matches m CROSS JOIN wc.public.squad_members s',
      datasourceId: 'ds-pg',
      columns: ['match_id', 'stage'],
      kinds: { match_id: 'number', stage: 'text' },
      sampleValues: { match_id: [1], stage: ['final'] },
      rationale: 'I list each match with its squad members.',
    };
    const NEXT_PAGE: ExplorerSpec = {
      action: 'explore',
      query: 0,
      interpretation: {
        request: { filters: [], sort: [], page: 2, pageSize: 50 },
        understood: 'page 2',
      },
    };
    const VIEW = {
      filters: [],
      sort: [],
      page: 2,
      pageSize: 50,
      matchedRows: 1264,
      capped: false,
    };
    const PAGE = {
      title: EARLIER.rationale!,
      columns: ['match_id', 'stage'],
      rows: Array.from({ length: 50 }, (_, i) => ({
        match_id: 3 + i,
        stage: 'final',
      })),
      page: 2,
      pageCount: 26,
      matchedRows: 1264,
      capped: false,
      view: VIEW,
      understood: 'page 2',
    };
    const followUpTurn = (
      spec: ExplorerSpec | Error,
      followUp: ExplorableQuery[] = [EARLIER],
    ) =>
      runtime({
        followUp,
        interpretFollowUp: jest.fn(() =>
          spec instanceof Error
            ? Promise.reject(spec)
            : Promise.resolve({ spec, stopped: false }),
        ),
        pageResult: jest.fn(() => Promise.resolve(PAGE)),
        deliverAnswer: jest.fn(() => Promise.resolve()),
      });

    it('makes no model call on a run without earlier queries, and plans the question', async () => {
      const turn = followUpTurn(NEXT_PAGE, []);
      const { events, outputs, result } = await run('Next page', turn);
      expect(turn.interpretFollowUp).not.toHaveBeenCalled();
      expect(outputs.get('interpret-follow-up')).toMatchObject({
        followUp: null,
      });
      expect(turn.plan).toHaveBeenCalledTimes(1);
      expect(events.some((event) => event.startsWith('explore-result'))).toBe(
        false,
      );
      expect(turn.pageResult).not.toHaveBeenCalled();
      expect(turnSummaryOf(result.result)?.answer).toContain('16 matches');
    });

    it('pages the earlier result instead of planning: Page result, then Page answer delivers the answer', async () => {
      const turn = followUpTurn(NEXT_PAGE);
      const { events, result } = await run('  next page  ', turn);
      expect(events).toEqual([
        `${READ_IMAGES_OUTCOME_ID}:running`,
        `${READ_IMAGES_OUTCOME_ID}:success`,
        'receive-question:running',
        'receive-question:success',
        'load-catalog:running',
        'load-catalog:success',
        'interpret-follow-up:running',
        'interpret-follow-up:success',
        'explore-result:running',
        'explore-result.page-result:running',
        'explore-result.page-result:success',
        'explore-result.page-answer:running',
        'explore-result.page-answer:success',
        'explore-result:success',
      ]);
      expect(turn.interpretFollowUp).toHaveBeenCalledTimes(1);
      expect(turn.interpretFollowUp).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'next page', view: null }),
      );
      expect(turn.plan).not.toHaveBeenCalled();
      expect(turn.analyse).not.toHaveBeenCalled();
      expect(turn.writeAnswer).not.toHaveBeenCalled();
      expect(turn.pageResult).toHaveBeenCalledWith({
        query: 0,
        request: NEXT_PAGE.interpretation.request,
        understood: 'page 2',
      });
      expect(turn.deliverAnswer).toHaveBeenCalledTimes(1);
      const answer = turn.deliverAnswer.mock.calls[0][0];
      expect(answer.split('\n')[0]).toBe('Rows 51–100 of 1,264');
      expect(result).toEqual({
        status: 'success',
        result: {
          'explore-result': {
            sqlQueries: 1,
            failedQueries: 0,
            rows: 50,
            answer,
          },
        },
      });
      expect(turnSummaryOf(result.result)?.answer).toBe(answer);
    });

    it('plans the question when result-explorer reads a new question or fails', async () => {
      for (const reply of [
        { ...NEXT_PAGE, action: 'new-question' as const },
        new Error('The provider failed'),
      ]) {
        const turn = followUpTurn(reply);
        const { events, result } = await run('Goals per team?', turn);
        expect(turn.interpretFollowUp).toHaveBeenCalledTimes(1);
        expect(turn.plan).toHaveBeenCalledTimes(1);
        expect(turn.pageResult).not.toHaveBeenCalled();
        expect(events).toContain('question-path:success');
        expect(result.status).toBe('success');
      }
    });

    it('takes neither branch when the turn was stopped while the words were read', async () => {
      const turn = followUpTurn(NEXT_PAGE);
      turn.interpretFollowUp.mockResolvedValueOnce({
        spec: NEXT_PAGE,
        stopped: true,
      });
      const { events, result } = await run('next page', turn);
      expect(events.at(-1)).toBe('interpret-follow-up:success');
      expect(turn.plan).not.toHaveBeenCalled();
      expect(turn.pageResult).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'success', result: {} });
    });

    it('fails Page result with the reason the page cannot be read; no answer is delivered', async () => {
      const turn = followUpTurn(NEXT_PAGE);
      turn.pageResult.mockRejectedValueOnce(
        new Error('Page 2000 is past the 50,000-row limit'),
      );
      const { events, result } = await run('page 2000', turn);
      expect(events).toContain('explore-result.page-result:failed');
      expect(turn.deliverAnswer).not.toHaveBeenCalled();
      expect(result.status).toBe('failed');
      expect(String(result.error)).toContain('past the 50,000-row limit');
    });
  });

  describe('the optional data-quality check (agents.md 5.11)', () => {
    const QUALITY_FINDING = {
      check: 'Data quality: public.matches.winner (completeness, high)',
      passed: false,
      detail: '62% of winner is null. The count of wins may be low.',
    };
    const MEASURED = {
      tables: ['wc.public.matches'],
      reportIds: ['r-1'],
      findingCount: 3,
      issues: 1,
      skipped: [],
    };

    it('runs Check data quality when the run asks for it, on the tables the queries read, and hands its findings to Write answer', async () => {
      const turn = runtime({
        checksDataQuality: true,
        checkDataQuality: jest.fn(() =>
          Promise.resolve({
            findings: [QUALITY_FINDING],
            dataQuality: MEASURED,
            stopped: false,
          }),
        ),
      });
      const { events, outputs } = await run('How many matches?', turn);
      expect(events).toEqual(
        expect.arrayContaining([
          'question-path.analysis-path.answer-path.check-data-quality:running',
          'question-path.analysis-path.answer-path.check-data-quality:success',
        ]),
      );
      expect(
        events.indexOf(
          'question-path.analysis-path.answer-path.check-data-quality:success',
        ),
      ).toBeLessThan(
        events.indexOf(
          'question-path.analysis-path.answer-path.write-answer:running',
        ),
      );
      // Only the catalog's tables the SQL names (wc.public.teams is not).
      expect(turn.checkDataQuality).toHaveBeenCalledWith({
        question: 'How many matches?',
        queries: GOOD_ATTEMPT.queries,
        tables: [
          {
            entity: 'wc.public.matches',
            dataset: 'World Cup',
            datasourceKind: 'postgres',
          },
        ],
      });
      expect(
        outputs.get(
          'question-path.analysis-path.answer-path.check-data-quality',
        ),
      ).toMatchObject({ dataQuality: MEASURED });
      const written = turn.writeAnswer.mock.calls[0][0];
      // Validate's findings first, then the data-quality one.
      expect(written.findings.at(-1)).toEqual(QUALITY_FINDING);
      expect(written.findings[0]).toMatchObject({ check: 'Ran a query' });
    });

    it('leaves the findings as they were when the turn is stopped during the check', async () => {
      const turn = runtime({
        checksDataQuality: true,
        checkDataQuality: jest.fn(() =>
          Promise.resolve({
            findings: [QUALITY_FINDING],
            dataQuality: MEASURED,
            stopped: true,
          }),
        ),
      });
      await run('How many matches?', turn);
      const written = turn.writeAnswer.mock.calls[0][0];
      expect(written.findings).not.toContainEqual(QUALITY_FINDING);
    });

    it('fails Check data quality when the run asks for it but its runtime has no check', async () => {
      const turn = runtime({
        checksDataQuality: true,
        checkDataQuality: undefined,
      });
      const { result } = await run('How many matches?', turn);
      expect(result.status).toBe('failed');
      expect(String(result.error)).toContain(
        'The Check data quality step has no check to run',
      );
    });
  });

  it('retries the analysis once when Validate fails, handing it the findings', async () => {
    const turn = runtime({
      analyse: jest
        .fn()
        .mockResolvedValueOnce(FAILED_ATTEMPT)
        .mockResolvedValueOnce(GOOD_ATTEMPT),
    });
    const { events, outputs } = await run('How many matches?', turn);
    expect(
      events.filter((event) => /\.(analyse|validate):/.test(event)),
    ).toEqual([
      'question-path.analysis-path.analysis-attempt.analyse:running',
      'question-path.analysis-path.analysis-attempt.analyse:success',
      'question-path.analysis-path.analysis-attempt.validate:running',
      'question-path.analysis-path.analysis-attempt.validate:success',
      'question-path.analysis-path.analysis-attempt.analyse:running',
      'question-path.analysis-path.analysis-attempt.analyse:success',
      'question-path.analysis-path.analysis-attempt.validate:running',
      'question-path.analysis-path.analysis-attempt.validate:success',
    ]);
    expect(turn.analyse).toHaveBeenCalledTimes(2);
    const second = turn.analyse.mock.calls[1][0] as unknown as {
      attempt: number;
      planBlock: string;
    };
    expect(second.attempt).toBe(2);
    expect(second.planBlock).toContain(
      'Attempt 1 of this analysis failed validation.',
    );
    expect(second.planBlock).toContain(
      '- Ran a query: None of the 1 SQL query succeeded.',
    );
    expect(
      outputs.get('question-path.analysis-path.analysis-attempt.validate'),
    ).toMatchObject({ ok: true, attempt: 2 });
    expect(turn.writeAnswer).toHaveBeenCalledTimes(1);
  });

  it('writes the answer after a second failed attempt, with its findings', async () => {
    const turn = runtime({
      analyse: jest.fn(() => Promise.resolve(FAILED_ATTEMPT)),
    });
    const { result } = await run('How many matches?', turn);
    expect(turn.analyse).toHaveBeenCalledTimes(2);
    expect(turn.writeAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        findings: expect.arrayContaining([
          expect.objectContaining({ check: 'Ran a query', passed: false }),
        ]) as unknown,
      }),
    );
    expect(result.status).toBe('success');
  });

  it('suspends at Clarify with the plan question when the plan needs clarification: no analysis yet', async () => {
    const turn = runtime({
      plan: jest.fn(() =>
        Promise.resolve({ plan: CLARIFYING, stopped: false }),
      ),
    });
    const { events, result } = await run('Which team was dominant?', turn);
    expect(events.slice(-5)).toEqual([
      'question-path.plan-round.plan:success',
      'question-path.plan-round.clarify:running',
      'question-path.plan-round.clarify:suspended',
      'question-path.plan-round:suspended',
      'question-path:suspended',
    ]);
    expect(
      events.some((event) => event.startsWith('question-path.analysis-path')),
    ).toBe(false);
    expect(turn.analyse).not.toHaveBeenCalled();
    expect(result.status).toBe('suspended');
    // The path from the top, handed back unchanged on resume (ADR-0043).
    expect(result.suspended).toEqual([
      ['question-path', 'plan-round', 'clarify'],
    ]);
    expect(result.steps?.['question-path']?.suspendPayload).toEqual(
      CLARIFYING.clarification,
    );
  });

  it('resumes Clarify with the answer, goes back to Plan with it, then analyses and writes the answer', async () => {
    const turn = runtime({
      plan: jest
        .fn()
        .mockResolvedValueOnce({ plan: CLARIFYING, stopped: false })
        // Even when the model asks again, an answered plan never does.
        .mockResolvedValueOnce({ plan: CLARIFYING, stopped: false }),
    });
    const started = await run('Which team was dominant?', turn);
    const { events, outputs, result } = await resume(started, 'Matches won');
    expect(events.slice(0, 7)).toEqual([
      'question-path:running',
      'question-path.plan-round:running',
      'question-path.plan-round.clarify:running',
      'question-path.plan-round.clarify:success',
      'question-path.plan-round.plan-round-outcome:running',
      'question-path.plan-round.plan-round-outcome:success',
      'question-path.plan-round:success',
    ]);
    expect(events.slice(7, 13)).toEqual(CLEAR_PLAN_ROUND);
    // Clarify hands Plan its own input back, with the answer.
    expect(outputs.get('question-path.plan-round.clarify')).toEqual({
      question: 'Which team was dominant?',
      catalog: expect.any(Array) as unknown,
      columns: expect.any(Array) as unknown,
      imageNotes: '',
      clarification: { ...CLARIFYING.clarification, answer: 'Matches won' },
    });
    expect(turn.plan).toHaveBeenCalledTimes(2);
    expect(turn.plan.mock.calls[1][0]).toMatchObject({
      question: 'Which team was dominant?',
      clarification: { ...CLARIFYING.clarification, answer: 'Matches won' },
    });
    expect(outputs.get('question-path.plan-round.plan')).toMatchObject({
      plan: { needsClarification: false, clarification: null },
    });
    expect(turn.analyse).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(turnSummaryOf(result.result)?.answer).toContain('16 matches');
  });

  it('suspends at Analyse when the agent asks a clarifying question, and resumes it with the answer in the same attempt', async () => {
    const asked = {
      question: 'Which tournament?',
      options: ['2018', '2022'],
    };
    const turn = runtime({
      analyse: jest
        .fn()
        .mockResolvedValueOnce({ ...GOOD_ATTEMPT, clarification: asked })
        .mockResolvedValueOnce(GOOD_ATTEMPT),
    });
    const started = await run('How many matches?', turn);
    expect(started.events.slice(-4)).toEqual([
      'question-path.analysis-path.analysis-attempt.analyse:suspended',
      'question-path.analysis-path.analysis-attempt:suspended',
      'question-path.analysis-path:suspended',
      'question-path:suspended',
    ]);
    expect(started.result.status).toBe('suspended');
    expect(started.result.suspended).toEqual([
      ['question-path', 'analysis-path', 'analysis-attempt', 'analyse'],
    ]);
    expect(started.result.steps?.['question-path']?.suspendPayload).toEqual(
      asked,
    );
    expect(turn.writeAnswer).not.toHaveBeenCalled();

    const { events, result } = await resume(started, '2022');
    expect(events.slice(0, 5)).toEqual([
      'question-path:running',
      'question-path.analysis-path:running',
      'question-path.analysis-path.analysis-attempt:running',
      'question-path.analysis-path.analysis-attempt.analyse:running',
      'question-path.analysis-path.analysis-attempt.analyse:success',
    ]);
    expect(turn.analyse).toHaveBeenCalledTimes(2);
    // The agent goes on with its question and the answer, same attempt.
    expect(turn.analyse.mock.calls[1][0]).toMatchObject({
      attempt: 1,
      answered: { ...asked, answer: '2022' },
    });
    expect(turn.writeAnswer).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
  });

  it('ends the loop and writes no answer when Analyse stops', async () => {
    const turn = runtime({
      analyse: jest.fn(() =>
        Promise.resolve({ ...GOOD_ATTEMPT, stopped: true }),
      ),
    });
    const { events, result } = await run('Go', turn);
    expect(events).toContain(
      'question-path.analysis-path.analysis-attempt.analyse:bailed',
    );
    expect(events.some((event) => event.includes('validate'))).toBe(false);
    expect(events.some((event) => event.includes('write-answer'))).toBe(false);
    expect(turn.analyse).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: 'success',
      result: { 'question-path': { 'analysis-path': {} } },
    });
  });

  it('ends at Plan when the turn was stopped while it planned', async () => {
    const turn = runtime({
      plan: jest.fn(() => Promise.resolve({ plan: PLAN, stopped: true })),
    });
    const { events, result } = await run('Go', turn);
    expect(events.slice(-4)).toEqual([
      'question-path.plan-round.plan:running',
      'question-path.plan-round.plan:bailed',
      'question-path.plan-round:success',
      'question-path:success',
    ]);
    expect(
      events.some((event) => event.startsWith('question-path.analysis-path')),
    ).toBe(false);
    expect(turn.analyse).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('fails Analyse on an output that breaks its contract, and never writes an answer', async () => {
    const turn = runtime({
      analyse: jest.fn(() =>
        Promise.resolve({
          ...GOOD_ATTEMPT,
          calls: [
            {
              tool: 'run_readonly_sql',
              rowCount: 'many' as unknown as number,
              failed: false,
            },
          ],
        }),
      ),
    });
    const { events, result } = await run('Go', turn);
    expect(events).toContain(
      'question-path.analysis-path.analysis-attempt.analyse:failed',
    );
    expect(events.some((event) => event.includes('write-answer'))).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error).toBeInstanceOf(ContractViolationError);
    expect((result.error as Error).message).toBe(
      'Contract violation in Analyse: calls[0].rowCount Invalid input: expected number, received string',
    );
  });

  it('fails Receive question on a run input that breaks its contract, before any later step', async () => {
    const turn = runtime();
    const { events, result } = await run('Go', turn, 'World Cup');
    expect(events).toEqual([
      ...NO_IMAGES,
      'receive-question:running',
      'receive-question:failed',
    ]);
    expect((result.error as Error).message).toBe(
      'Contract violation in Receive question (input): datasets Invalid input: expected array, received string',
    );
    expect(turn.plan).not.toHaveBeenCalled();
  });

  it('no longer fails Receive question on a blank question: the input node refuses it before the run', async () => {
    const { events, result } = await run('   ', runtime());
    expect(events.slice(2, 4)).toEqual([
      'receive-question:running',
      'receive-question:success',
    ]);
    expect(result.status).toBe('success');
  });

  it('fails a model step with its own error', async () => {
    const { events, result } = await run(
      'Go',
      runtime({
        writeAnswer: jest.fn(() => Promise.reject(new Error('model down'))),
      }),
    );
    expect(events).toContain(
      'question-path.analysis-path.answer-path.write-answer:failed',
    );
    expect(events.some((event) => event.includes('wrap-up'))).toBe(false);
    expect(result).toMatchObject({ status: 'failed' });
    expect((result.error as Error).message).toBe('model down');
  });

  it('fails Plan when the run has no turn runtime', async () => {
    const { result } = await run('Go', undefined, []);
    expect(result.status).toBe('failed');
    expect((result.error as Error).message).toBe(
      'The Plan step has no turn to run',
    );
  });

  // Reference images (agents.md 2.15, 5.11; workflows R35; plan D1-D3).
  describe('reference images', () => {
    it("reads the images first, then hands Zoe's notes to Plan, Analyse and Write answer", async () => {
      const turn = runtime({ checksDataQuality: true });
      const images = ONE_IMAGE();
      const { events, outputs, result } = await run(
        'How many matches?',
        turn,
        ['World Cup'],
        images,
      );
      expect(events.slice(0, 6)).toEqual([
        'read-images:running',
        'read-images:success',
        `${READ_IMAGES_OUTCOME_ID}:running`,
        `${READ_IMAGES_OUTCOME_ID}:success`,
        'receive-question:running',
        'receive-question:success',
      ]);
      expect(images.reader.readImages).toHaveBeenCalledTimes(1);
      expect(images.reader.readImages).toHaveBeenCalledWith({
        question: 'How many matches?',
        images: ['inputs/images/1.png'],
      });
      // Receive question gets the input with the notes, never the images.
      expect(outputs.get('receive-question')).toEqual({
        question: 'How many matches?',
        datasets: ['World Cup'],
        imageNotes: NOTES,
      });
      expect(turn.plan).toHaveBeenCalledWith(
        expect.objectContaining({ imageNotes: NOTES }),
      );
      expect(turn.analyse).toHaveBeenCalledWith(
        expect.objectContaining({ imageNotes: NOTES }),
      );
      // Interpret follow-up passes them on to the question path (roadmap
      // 1.27.8), and Check data quality on to Write answer.
      expect(outputs.get('interpret-follow-up')).toMatchObject({
        imageNotes: NOTES,
        followUp: null,
      });
      expect(
        outputs.get(
          'question-path.analysis-path.answer-path.check-data-quality',
        ),
      ).toMatchObject({ imageNotes: NOTES });
      expect(turn.writeAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ imageNotes: NOTES }),
      );
      expect(result.status).toBe('success');
    });

    it('keeps the notes through a retry of the analysis', async () => {
      const turn = runtime({
        analyse: jest
          .fn()
          .mockResolvedValueOnce(FAILED_ATTEMPT)
          .mockResolvedValueOnce(GOOD_ATTEMPT),
      });
      await run('How many matches?', turn, ['World Cup'], ONE_IMAGE());
      expect(turn.analyse).toHaveBeenCalledTimes(2);
      expect(turn.analyse.mock.calls[1][0]).toMatchObject({
        attempt: 2,
        imageNotes: NOTES,
      });
    });

    it('keeps the notes through a Clarify wait and its resume, without reading the images again', async () => {
      const turn = runtime({
        plan: jest
          .fn()
          .mockResolvedValueOnce({ plan: CLARIFYING, stopped: false })
          .mockResolvedValueOnce({ plan: PLAN, stopped: false }),
      });
      const images = ONE_IMAGE();
      const started = await run(
        'Which team was dominant?',
        turn,
        ['World Cup'],
        images,
      );
      expect(started.result.status).toBe('suspended');
      const { outputs, result } = await resume(started, 'Matches won');
      expect(outputs.get('question-path.plan-round.clarify')).toMatchObject({
        imageNotes: NOTES,
      });
      expect(turn.plan).toHaveBeenCalledTimes(2);
      expect(turn.plan.mock.calls[1][0]).toMatchObject({
        clarification: { ...CLARIFYING.clarification, answer: 'Matches won' },
        imageNotes: NOTES,
      });
      expect(turn.analyse.mock.calls[0][0]).toMatchObject({
        imageNotes: NOTES,
      });
      expect(turn.writeAnswer.mock.calls[0][0]).toMatchObject({
        imageNotes: NOTES,
      });
      expect(images.reader.readImages).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('success');
    });

    it('resumes a run that waited at Clarify before Read images existed: its stored data has no notes, so they are empty (workflows R35)', async () => {
      // What such a run's snapshot holds: Clarify's input (Plan's output)
      // and the plan round's input, both without `imageNotes`.
      const clarify = leafSteps(workflow).find(
        (step) => step.id === 'clarify',
      ) as unknown as {
        execute(params: Record<string, unknown>): Promise<unknown>;
      };
      const stored = {
        question: 'Which team was dominant?',
        catalog: [],
        plan: CLARIFYING,
      };
      const planRoundInput = {
        question: 'Which team was dominant?',
        catalog: [],
        columns: [],
      };
      const output = await clarify.execute({
        inputData: stored,
        resumeData: { answer: 'Matches won' },
        suspend: jest.fn(),
        getInitData: () => planRoundInput,
      });
      expect(output).toEqual({
        ...planRoundInput,
        imageNotes: '',
        clarification: { ...CLARIFYING.clarification, answer: 'Matches won' },
      });
    });

    it("keeps the notes through Analyse's own clarifying question and its resume", async () => {
      const asked = {
        question: 'Which tournament?',
        options: ['2018', '2022'],
      };
      const turn = runtime({
        analyse: jest
          .fn()
          .mockResolvedValueOnce({ ...GOOD_ATTEMPT, clarification: asked })
          .mockResolvedValueOnce(GOOD_ATTEMPT),
      });
      const started = await run(
        'How many matches?',
        turn,
        ['World Cup'],
        ONE_IMAGE(),
      );
      expect(started.result.status).toBe('suspended');
      const { result } = await resume(started, '2022');
      expect(turn.analyse.mock.calls[1][0]).toMatchObject({
        answered: { ...asked, answer: '2022' },
        imageNotes: NOTES,
      });
      expect(turn.writeAnswer.mock.calls[0][0]).toMatchObject({
        imageNotes: NOTES,
      });
      expect(result.status).toBe('success');
    });

    it("fails the run with the model's own error when Read images fails, before Receive question", async () => {
      const turn = runtime();
      const { events, result } = await run('Go', turn, ['World Cup'], {
        paths: ['inputs/images/1.png'],
        reader: {
          readImages: jest.fn(() =>
            Promise.reject(new Error('This model does not accept images')),
          ),
        },
      });
      expect(events).toContain('read-images:failed');
      expect(events.some((event) => event.startsWith('receive-question'))).toBe(
        false,
      );
      expect(result.status).toBe('failed');
      expect((result.error as Error).message).toBe(
        'This model does not accept images',
      );
      expect(turn.plan).not.toHaveBeenCalled();
    });

    it('passes no notes on when the turn was stopped while Read images ran', async () => {
      const turn = runtime();
      await run('Go', turn, ['World Cup'], {
        paths: ['inputs/images/1.png'],
        reader: {
          readImages: jest.fn(() =>
            Promise.resolve({
              imageNotes: NOTES,
              imageCount: 1,
              stopped: true,
            }),
          ),
        },
      });
      expect(turn.plan).toHaveBeenCalledWith(
        expect.objectContaining({ imageNotes: '' }),
      );
    });
  });
});
