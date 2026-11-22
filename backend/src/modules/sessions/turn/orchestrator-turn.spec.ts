// Avery's turn (agents.md 2.21, 5.22): her stream is scripted, the team is a
// set of mocks; the tools' runtime calls the team as the Answer a Business
// Question steps do, with no gate.
jest.mock('../../../mastra/tool-services', () => ({
  getDatasetToolServices: () => ({
    getDatasets: (names: string[]) =>
      Promise.resolve(
        names.map((name) => ({
          name,
          datasourceId: 'ds-pg',
          datasourceKind: 'postgres',
          tables: ['wc.public.matches'],
          entities: [{ key: 'wc.public.matches', columns: [{ name: 'id' }] }],
        })),
      ),
  }),
}));

import { RequestContext } from '@mastra/core/request-context';
import { CHIEF_OF_STAFF_AGENT_KEY } from '../../../mastra/agent-constants';
import {
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../../../mastra/workflows/orchestrated-answer.steps';
import type {
  AnalyseAttempt,
  AnalysisPlan,
} from '../../../mastra/workflows/answer-business-question.steps';
import { orchestratorTools as avertTools } from '../../../mastra/tools/orchestrator.tools';
import {
  ORCHESTRATOR_HISTORY_MESSAGES,
  orchestratorState,
  orchestratorTools,
  runOrchestratorTurn,
  type OrchestratorTeam,
  type OrchestratorTurnDeps,
} from './orchestrator-turn';
import type { StreamEvent } from './stream-events';

const PLAN: AnalysisPlan = {
  question: 'How many matches?',
  measures: ['match count'],
  entities: ['wc.public.matches'],
  scope: 'Every match.',
  assumptions: [],
  needsClarification: false,
  clarification: null,
};

const ATTEMPT: AnalyseAttempt = {
  calls: [{ tool: 'run_readonly_sql', rowCount: 1, failed: false }],
  queries: [
    {
      sql: 'SELECT count(*) AS n FROM wc.public.matches',
      rationale: 'I count the matches.',
      rows: [{ n: 64 }],
      rowCount: 1,
      truncated: false,
    },
  ],
  text: 'There are 64 matches.',
  stopped: false,
};

function team(overrides: Partial<OrchestratorTeam> = {}) {
  return {
    readImages: jest.fn(() =>
      Promise.resolve({
        imageNotes: 'A bar chart.',
        imageCount: 1,
        stopped: false,
      }),
    ),
    plan: jest.fn(() => Promise.resolve({ plan: PLAN, stopped: false })),
    analyse: jest.fn(() => Promise.resolve(ATTEMPT)),
    writeAnswer: jest.fn(() =>
      Promise.resolve({
        answer: { headline: 'Sixty-four.', answer: 'There were 64 matches.' },
        stopped: false,
      }),
    ),
    ...overrides,
  } as unknown as jest.Mocked<OrchestratorTeam>;
}

type Chunk = { type: string; payload?: unknown };

/** Avery's scripted stream: `script` runs her tools through the runtime. */
function fixture(
  chunks:
    | Chunk[]
    | ((tools: ReturnType<typeof orchestratorTools>) => Promise<Chunk[]>),
  options: {
    team?: jest.Mocked<OrchestratorTeam>;
    deps?: Partial<OrchestratorTurnDeps>;
    question?: string;
  } = {},
) {
  const members = options.team ?? team();
  const events: StreamEvent[] = [];
  const streams: { messages: unknown; options: Record<string, unknown> }[] = [];
  const deps: OrchestratorTurnDeps = {
    getAgent: jest.fn(() => ({
      stream: (messages: unknown, opts: Record<string, unknown>) => {
        streams.push({ messages, options: opts });
        const context = opts['requestContext'] as {
          get(key: string): unknown;
        };
        const tools = context.get(
          ORCHESTRATOR_TOOLS_RUNTIME_KEY,
        ) as OrchestratorToolsRuntime;
        return Promise.resolve({
          fullStream: (async function* () {
            const list =
              typeof chunks === 'function' ? await chunks(tools) : chunks;
            yield* list;
          })(),
        });
      },
    })),
    team: members,
    state: orchestratorState(),
    emit: (event) => events.push(event),
    signal: new AbortController().signal,
    datasets: ['World Cup'],
    images: [],
    buildsVisual: false,
    ...options.deps,
  };
  return { deps, members, events, streams };
}

const text = (t: string): Chunk => ({
  type: 'text-delta',
  payload: { text: t },
});

describe('Avery runs her turn (agents.md 5.22)', () => {
  it('asks the agent registered as the chief of staff', async () => {
    const { deps } = fixture([text('Hello.')]);
    await runOrchestratorTurn(deps, { question: 'Hi' });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deps.getAgent).toHaveBeenCalledWith(CHIEF_OF_STAFF_AGENT_KEY);
  });

  it('calls the team through her tools: plan fills the state, analyse carries her brief, write is quiet', async () => {
    const { deps, members } = fixture(async (tools) => {
      await tools.plan();
      await tools.analyse('Count every match.');
      await tools.writeAnswer();
      return [text('Done.')];
    });
    await runOrchestratorTurn(deps, { question: 'How many matches?' });

    expect(deps.state.plan).toEqual(PLAN);
    expect(members.plan).toHaveBeenCalledTimes(1);
    expect(members.plan.mock.calls[0][0]).toMatchObject({
      question: 'How many matches?',
      catalog: [expect.objectContaining({ dataset: 'World Cup' })],
    });
    expect(members.analyse).toHaveBeenCalledTimes(1);
    const analyse = members.analyse.mock.calls[0][0];
    expect(analyse.attempt).toBe(1);
    expect(analyse.planBlock).toContain(
      'Brief from Avery, the Chief of Staff: Count every match.',
    );
    expect(deps.state.queries).toEqual(ATTEMPT.queries);
    expect(deps.state.attempts).toBe(1);
    expect(members.writeAnswer).toHaveBeenCalledTimes(1);
    expect(members.writeAnswer.mock.calls[0][0]).toMatchObject({ quiet: true });
    expect(deps.state.answer).toBe('There were 64 matches.');
  });

  it('hands Olivia and Jessica her brief (the question restated to stand alone), and none when she gives none', async () => {
    const { deps, members } = fixture(async (tools) => {
      await tools.plan('Who won the 2018 and 2022 World Cups?');
      await tools.analyse('The champion of each tournament.');
      await tools.writeAnswer(
        'Who won the 2018 and 2022 World Cups? The user already knows there are two.',
      );
      return [text('Done.')];
    });
    await runOrchestratorTurn(deps, { question: 'And who won each one?' });
    // The user's own words stay the question; her brief rides along.
    expect(members.plan.mock.calls[0][0]).toMatchObject({
      question: 'And who won each one?',
      brief: 'Who won the 2018 and 2022 World Cups?',
    });
    expect(members.writeAnswer.mock.calls[0][0]).toMatchObject({
      question: 'And who won each one?',
      brief:
        'Who won the 2018 and 2022 World Cups? The user already knows there are two.',
    });

    const bare = fixture(async (tools) => {
      await tools.plan();
      await tools.analyse('Count.');
      await tools.writeAnswer('  ');
      return [text('Done.')];
    });
    await runOrchestratorTurn(bare.deps, { question: 'How many matches?' });
    expect(bare.members.plan.mock.calls[0][0]).not.toHaveProperty('brief');
    expect(bare.members.writeAnswer.mock.calls[0][0]).not.toHaveProperty(
      'brief',
    );
  });

  it("on a follow-up, Michael reads the last answer's queries as a block after her brief", async () => {
    const { deps, members } = fixture(
      async (tools) => {
        await tools.plan();
        await tools.analyse('Now by stage.');
        return [text('Done.')];
      },
      {
        deps: {
          earlierQueries: [
            {
              ref: 'Q1',
              sql: 'SELECT count(*) FROM matches',
              rationale: 'Counts every match.',
            },
          ],
        },
      },
    );
    await runOrchestratorTurn(deps, { question: 'And by stage?' });
    const block = members.analyse.mock.calls[0][0].planBlock;
    expect(block).toContain(
      'Brief from Avery, the Chief of Staff: Now by stage.',
    );
    expect(block).toContain(
      'Queries behind the answer the user just read (reuse or change them rather than starting over; explore_result reads their rows by ref):\n- Q1: Counts every match.\n  SQL: SELECT count(*) FROM matches',
    );
    expect(block.indexOf('Brief from Avery')).toBeLessThan(
      block.indexOf('Queries behind'),
    );
  });

  it("answers Jessica's answer followed by Avery's closing words", async () => {
    const { deps } = fixture(async (tools) => {
      await tools.plan();
      await tools.analyse('Count.');
      await tools.writeAnswer();
      return [text('Want it by year?')];
    });
    const done = await runOrchestratorTurn(deps, { question: 'q' });
    expect(done).toEqual({
      answer: 'There were 64 matches.\n\nWant it by year?',
      stopped: false,
    });
  });

  it("answers Jessica's answer alone when Avery adds nothing, and Avery's words alone when nothing was written", async () => {
    const written = fixture(async (tools) => {
      await tools.analyse('Count.');
      await tools.writeAnswer();
      return [];
    });
    expect(
      (await runOrchestratorTurn(written.deps, { question: 'q' })).answer,
    ).toBe('There were 64 matches.');

    const spoken = fixture([text('Hi, '), text('I am Avery.')]);
    expect(
      (await runOrchestratorTurn(spoken.deps, { question: 'hello' })).answer,
    ).toBe('Hi, I am Avery.');
  });

  it('writes nothing before Michael has results, and tells Avery', async () => {
    let told = '';
    const { deps, members } = fixture(async (tools) => {
      told = await tools.writeAnswer();
      return [];
    });
    await runOrchestratorTurn(deps, { question: 'q' });
    expect(told).toContain('call analyse_data first');
    expect(members.writeAnswer).not.toHaveBeenCalled();
  });

  it('refuses a third analysis and tells her to write from the results', async () => {
    const replies: string[] = [];
    const { deps, members } = fixture(async (tools) => {
      replies.push(await tools.analyse('one'));
      replies.push(await tools.analyse('two'));
      replies.push(await tools.analyse('three'));
      return [];
    });
    await runOrchestratorTurn(deps, { question: 'q' });
    expect(members.analyse).toHaveBeenCalledTimes(2);
    expect(members.analyse.mock.calls.map(([a]) => a.attempt)).toEqual([1, 2]);
    expect(replies[2]).toContain('already analysed twice');
    // The queries of both attempts are kept.
    expect(deps.state.queries).toHaveLength(2);
  });

  it('puts the conversation history before the question in her messages', async () => {
    const { deps, streams } = fixture([text('ok')], {
      deps: {
        history: [
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: 'Earlier answer' },
        ],
      },
    });
    await runOrchestratorTurn(deps, { question: 'And now?' });
    expect(streams[0].messages).toEqual([
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'And now?' },
    ]);
  });

  it('keeps only the last 40 messages of the history', async () => {
    const history = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 ? ('assistant' as const) : ('user' as const),
      content: `m${i}`,
    }));
    const { deps, streams } = fixture([text('ok')], { deps: { history } });
    await runOrchestratorTurn(deps, { question: 'q' });
    const sent = streams[0].messages as { content: string }[];
    expect(sent).toHaveLength(ORCHESTRATOR_HISTORY_MESSAGES + 1);
    expect(sent[0].content).toBe('m10');
  });

  it('returns her clarifying question and stops her stream there', async () => {
    const { deps } = fixture([
      {
        type: 'tool-call',
        payload: {
          toolCallId: 'c1',
          toolName: 'ask_clarification',
          args: {
            question: 'Which tournament?',
            options: ['Men', 'Women'],
          },
        },
      },
      text('never read'),
    ]);
    const done = await runOrchestratorTurn(deps, { question: 'Who won?' });
    expect(done).toEqual({
      answer: '',
      stopped: false,
      clarification: {
        question: 'Which tournament?',
        options: ['Men', 'Women'],
      },
    });
  });

  it('on a resume, her messages carry her question and the answer, and the work so far', async () => {
    const state = orchestratorState();
    state.plan = PLAN;
    const { deps, streams } = fixture([text('Men: 64.')], { deps: { state } });
    await runOrchestratorTurn(deps, {
      question: 'Who won?',
      answered: {
        question: 'Which tournament?',
        options: ['Men', 'Women'],
        answer: 'Men',
      },
    });
    expect(streams[0].messages).toEqual([
      { role: 'user', content: 'Who won?' },
      { role: 'assistant', content: 'Which tournament?\n- Men\n- Women' },
      { role: 'user', content: 'Men' },
    ]);
    const context = streams[0].options['context'] as { content: string }[];
    expect(context.map((c) => c.content).join('\n')).toContain(
      'Olivia already planned',
    );
  });

  it('shows her tool calls as the step activity', async () => {
    const { deps, events } = fixture([
      {
        type: 'tool-call',
        payload: {
          toolCallId: 'c1',
          toolName: 'analyse_data',
          args: { brief: 'Count matches' },
        },
      },
      {
        type: 'tool-result',
        payload: { toolCallId: 'c1', result: { result: 'ok' } },
      },
    ]);
    await runOrchestratorTurn(deps, { question: 'q' });
    expect(events).toEqual([
      {
        type: 'tool',
        content: JSON.stringify({
          name: 'analyse_data',
          input: 'Count matches',
        }),
      },
      {
        type: 'tool-result',
        content: JSON.stringify({ tool: 'analyse_data' }),
      },
    ]);
  });

  it('fails the step on a model error, and answers stopped when the run is stopped', async () => {
    const failing = fixture([
      { type: 'error', payload: { error: new Error('model down') } },
    ]);
    await expect(
      runOrchestratorTurn(failing.deps, { question: 'q' }),
    ).rejects.toThrow('model down');

    const abort = new AbortController();
    const stopped = fixture([text('partial')], {
      deps: { signal: abort.signal },
    });
    abort.abort();
    expect(await runOrchestratorTurn(stopped.deps, { question: 'q' })).toEqual({
      answer: 'partial',
      stopped: true,
    });
  });

  it('offers build_visual only when the run builds a visual', () => {
    const base = { hasImages: false } as const;
    const withVisual = new RequestContext();
    withVisual.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, {
      ...base,
      buildsVisual: true,
    });
    const without = new RequestContext();
    without.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, {
      ...base,
      buildsVisual: false,
    });
    expect(Object.keys(avertTools(withVisual))).toContain('build_visual');
    expect(Object.keys(avertTools(without))).toEqual([
      'read_reference_images',
      'plan_analysis',
      'analyse_data',
      'write_answer',
    ]);
  });

  it("tells Avery a run without a visual builds none, and Ryan's work when it does", async () => {
    const none = fixture([]);
    const runtime = orchestratorTools(none.deps, 'q', undefined);
    expect(await runtime.buildVisual('chart')).toBe(
      'This run builds no visual.',
    );

    const buildVisual = jest.fn(() =>
      Promise.resolve({
        visual: { visualId: 'v-1', title: 'Matches' },
        stopped: false,
      }),
    );
    const built = fixture([], {
      team: team({ buildVisual }),
      deps: { buildsVisual: true },
    });
    built.deps.state.answer = 'A.';
    built.deps.state.queries = ATTEMPT.queries;
    const visual = orchestratorTools(built.deps, 'q', undefined);
    expect(await visual.buildVisual('by year')).toContain('Matches');
    expect(buildVisual).toHaveBeenCalledWith(
      expect.objectContaining({
        question: expect.stringContaining('by year') as string,
        answer: 'A.',
      }),
    );
  });
});
