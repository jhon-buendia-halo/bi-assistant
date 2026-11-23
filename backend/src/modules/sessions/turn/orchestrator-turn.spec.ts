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

import { createHash } from 'crypto';
import { RequestContext } from '@mastra/core/request-context';
import { CHIEF_OF_STAFF_AGENT_KEY } from '../../../mastra/agent-constants';
import { analyseSystemBlocks } from '../../../mastra/workflows/analysis.prompts';
import { MICHAEL_ALONE_LINE } from '../../../mastra/workflows/orchestrated-answer-michael.prompts';
import {
  ORCHESTRATOR_TOOLS_RUNTIME_KEY,
  type OrchestratorToolsRuntime,
} from '../../../mastra/workflows/orchestrated-answer-michael.steps';
import type {
  AnalyseAttempt,
  AnalysisPlan,
} from '../../../mastra/workflows/analysis.steps';
import { orchestratorTools as avertTools } from '../../../mastra/tools/orchestrator.tools';
import {
  blueprintFromDraft,
  type DashboardDraft,
} from '../../../mastra/workflows/bi-dashboard.schemas';
import type {
  CurrentDashboard,
  DashboardRef,
} from '../../artifacts/entities/artifact.entity';
import {
  currentDashboardBlock,
  ORCHESTRATOR_HISTORY_MESSAGES,
  orchestratorState,
  orchestratorTools,
  runOrchestratorTurn,
  type OrchestratorTeam,
  type OrchestratorTurnDeps,
} from './orchestrator-turn';
import type { StreamEvent } from './stream-events';
import type { ExportContent } from '../../../mastra/workflows/export-request';
import type { ConversationExportRef } from '../../conversation-export/conversation-export.contract';

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
    buildsDashboard: false,
    exportsConversation: false,
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

  it('shows her tool calls as the step activity, signed, a team call naming its teammate and a skill call its file', async () => {
    const { deps, events } = fixture([
      {
        type: 'tool-call',
        payload: {
          toolCallId: 'c0',
          toolName: 'skill_read',
          args: {
            skillName: 'avery-playbooks',
            path: 'references/ranking.md',
          },
        },
      },
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
          name: 'skill_read',
          input: 'references/ranking.md',
          agent: 'chief-of-staff',
        }),
      },
      {
        type: 'tool',
        content: JSON.stringify({
          name: 'analyse_data',
          input: 'Count matches',
          agent: 'chief-of-staff',
          teammate: 'insights-analyst',
        }),
      },
      {
        type: 'tool-result',
        content: JSON.stringify({ tool: 'analyse_data', reply: 'ok' }),
      },
    ]);
  });

  it("keeps a team call's whole brief (up to 2,000 characters) and what the teammate handed back; no reply on her own calls", async () => {
    const brief = `Who scored most? ${'x'.repeat(2_500)}`;
    const { deps, events } = fixture([
      {
        type: 'tool-call',
        payload: {
          toolCallId: 'c1',
          toolName: 'answer_from_data',
          args: { brief },
        },
      },
      {
        type: 'tool-result',
        payload: { toolCallId: 'c1', result: { result: 'France, 14.' } },
      },
      {
        type: 'tool-call',
        payload: {
          toolCallId: 'c2',
          toolName: 'skill',
          args: { name: 'avery-playbooks' },
        },
      },
      {
        type: 'tool-result',
        payload: { toolCallId: 'c2', result: 'the skill' },
      },
    ]);
    await runOrchestratorTurn(deps, { question: 'q' });
    const frames = events.map(
      (e) => JSON.parse(e.content as string) as Record<string, string>,
    );
    expect(frames[0].input).toBe(brief.slice(0, 2_000));
    expect(frames[1]).toEqual({
      tool: 'answer_from_data',
      reply: 'France, 14.',
    });
    expect(frames[3]).toEqual({ tool: 'skill' });
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

  it('Avery + Michael (5.23): offers only answer_from_data, and every team tool with no run', () => {
    const alone = new RequestContext();
    alone.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, {
      hasImages: false,
      buildsVisual: false,
      tools: ['answer_from_data', 'ask_clarification'],
    });
    expect(Object.keys(avertTools(alone))).toEqual(['answer_from_data']);
    expect(Object.keys(avertTools(new RequestContext()))).toEqual([
      'read_reference_images',
      'plan_analysis',
      'analyse_data',
      'answer_from_data',
      'write_answer',
      'build_visual',
      'build_dashboard',
      'export_conversation',
    ]);
  });

  it('Avery + Michael (5.23): Michael works from her brief alone, and his reply is the answer, then her closing words', async () => {
    const { deps, members } = fixture(
      async (tools) => {
        const said = await tools.answerFromData(
          'How many matches were played? Count every match.',
        );
        expect(said).toContain(
          "Michael's reply above is the answer the user reads: do not repeat it.",
        );
        return [text('Want it by stage?')];
      },
      {
        deps: {
          tools: ['answer_from_data', 'ask_clarification'],
          earlierQueries: [
            { ref: 'Q1', sql: 'SELECT 1', rationale: 'Earlier.' },
          ],
        },
      },
    );
    const done = await runOrchestratorTurn(deps, { question: 'How many?' });
    // No Olivia: no plan call, no plan block; her brief, then the alone line.
    expect(members.plan).not.toHaveBeenCalled();
    const call = members.analyse.mock.calls[0][0];
    expect(call.planBlock).not.toContain('Analysis plan for this turn');
    expect(call.planBlock).toContain(
      'Brief from Avery, the Chief of Staff: How many matches were played? Count every match.',
    );
    expect(call.planBlock).toContain(MICHAEL_ALONE_LINE);
    expect(call.planBlock).toContain(
      'Queries behind the answer the user just read',
    );
    expect(call.plan).toMatchObject({ question: 'How many?', measures: [] });
    expect(members.writeAnswer).not.toHaveBeenCalled();
    expect(done).toEqual({
      answer: 'There are 64 matches.\n\nWant it by stage?',
      stopped: false,
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

/** A small dashboard on goals by team, as Clara would submit it. */
const GOALS_DRAFT: DashboardDraft = {
  title: 'Goals by team',
  summary: 'Goals per team.',
  theme: { mode: 'light', accent: '#2563eb', palette: ['#2563eb'] },
  layout: 'A KPI, then a bar chart.',
  filters: [{ id: 'team', label: 'Team', kind: 'select', column: 'team' }],
  widgets: [
    {
      id: 'goals',
      title: 'Goals',
      kind: 'kpi',
      span: 4,
      measures: [
        {
          label: 'Goals',
          column: 'goals',
          aggregation: 'sum',
          format: 'number',
          unit: '',
        },
      ],
      dimension: '',
      description: 'All goals.',
      filteredBy: ['team'],
    },
  ],
  columns: [
    { name: 'team', type: 'string', description: 'The team.' },
    { name: 'goals', type: 'number', description: 'Goals.' },
  ],
};

const CURRENT: CurrentDashboard = {
  artifactId: 'a-1',
  version: 2,
  title: 'Goals by team',
  blueprint: blueprintFromDraft(GOALS_DRAFT, [{ team: 'Brazil', goals: 3 }]),
  query: {
    sql: 'SELECT team, sum(goals) AS goals FROM g GROUP BY team',
    datasourceId: 'ds-pg',
  },
  columns: ['team', 'goals'],
  rowCount: 1,
  widgetCount: 1,
  filterCount: 1,
};

const REF: DashboardRef = {
  artifactId: 'a-1',
  version: 1,
  title: 'Goals by team',
  action: 'created',
  widgetCount: 1,
  filterCount: 1,
  rowCount: 32,
  saved: false,
};

/** The run's facts block Avery's stream got. */
function factsOf(streams: { options: Record<string, unknown> }[]): string {
  const context = streams[0].options['context'] as { content: string }[];
  return context[0].content;
}

describe('Avery hands dashboards to Clara (agents.md 2.21, 5.22)', () => {
  it('with the gate closed: build_dashboard is hidden and the facts say nothing of dashboards', async () => {
    const { deps, streams } = fixture([text('Done.')], {
      team: team({ buildDashboard: jest.fn() }),
    });
    await runOrchestratorTurn(deps, { question: 'How many matches?' });
    expect(factsOf(streams)).not.toContain('dashboard');
    const runtime = orchestratorTools(deps, 'q', undefined);
    expect(runtime.buildsDashboard).toBe(false);
    const context = new RequestContext();
    context.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, runtime);
    expect(Object.keys(avertTools(context))).not.toContain('build_dashboard');
    expect(await runtime.buildDashboard('Goals')).toBe(
      'This run builds no dashboard.',
    );
  });

  it("with the gate open: offers build_dashboard and says the user asked for one, or names the conversation's dashboard", async () => {
    const asked = fixture([text('Done.')], {
      team: team({ buildDashboard: jest.fn() }),
      deps: { buildsDashboard: true },
    });
    await runOrchestratorTurn(asked.deps, { question: 'A dashboard of goals' });
    expect(factsOf(asked.streams).split('\n').at(-1)).toBe(
      'The user asked for a dashboard: build_dashboard is available.',
    );
    const runtime = orchestratorTools(asked.deps, 'q', undefined);
    const context = new RequestContext();
    context.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, runtime);
    expect(Object.keys(avertTools(context))).toContain('build_dashboard');

    const carried = fixture([text('Done.')], {
      team: team({ buildDashboard: jest.fn() }),
      deps: { buildsDashboard: true, currentDashboard: CURRENT },
    });
    await runOrchestratorTurn(carried.deps, { question: 'Add a stage filter' });
    expect(factsOf(carried.streams).split('\n').at(-1)).toBe(
      'The conversation has a dashboard: "Goals by team", version 2 (1 widgets, 1 filters). build_dashboard changes it into version 3.',
    );
  });

  it('briefs Clara with the catalog, the current dashboard and the earlier queries, and tells Avery what she built', async () => {
    const buildDashboard = jest.fn(() =>
      Promise.resolve({
        dashboard: { ...REF, version: 3, action: 'updated' as const },
        saved: { ...CURRENT, version: 3 },
        reply: 'I added a stage filter.',
        stopped: false,
      }),
    );
    const { deps, events } = fixture(
      async (tools) => {
        await tools.buildDashboard('Add a filter by stage.');
        return [
          {
            type: 'tool-call',
            payload: {
              toolCallId: 'b1',
              toolName: 'build_dashboard',
              args: { brief: 'Add a filter by stage.' },
            },
          },
          {
            type: 'tool-result',
            payload: {
              toolCallId: 'b1',
              toolName: 'build_dashboard',
              result: { result: 'Built.' },
            },
          },
          text('Your dashboard now filters by stage.'),
        ];
      },
      {
        team: team({ buildDashboard }),
        deps: {
          buildsDashboard: true,
          currentDashboard: CURRENT,
          earlierQueries: [{ ref: 'Q1', sql: 'SELECT 1', rationale: 'One.' }],
        },
      },
    );
    const done = await runOrchestratorTurn(deps, {
      question: 'add a filter by stage',
    });
    const input = (buildDashboard.mock.calls[0] as unknown[])[0] as {
      question: string;
      brief: string;
      catalogBlock: string;
      current?: CurrentDashboard;
      earlierBlock: string;
    };
    expect(input).toMatchObject({
      question: 'add a filter by stage',
      brief: 'Add a filter by stage.',
      current: CURRENT,
    });
    expect(input.catalogBlock).toContain('World Cup');
    expect(input.earlierBlock).toContain('Q1');
    expect(deps.state.dashboard).toMatchObject({ version: 3 });
    expect(deps.state.dashboardCalls).toBe(1);
    // Her words are what she handed back to Avery, not the user's answer.
    const result = events.find((e) => e.type === 'tool-result');
    expect(JSON.parse(result?.content ?? '{}')).toEqual({
      tool: 'build_dashboard',
      reply: 'I added a stage filter.',
    });
    expect(done).toEqual({
      answer: 'Your dashboard now filters by stage.',
      stopped: false,
    });
  });

  it('builds at most twice per run, the second changing the first one, and names it in the work so far', async () => {
    const buildDashboard = jest
      .fn()
      .mockResolvedValueOnce({
        dashboard: REF,
        saved: { ...CURRENT, version: 1 },
        reply: '',
        stopped: false,
      })
      .mockResolvedValueOnce({
        dashboard: { ...REF, version: 2, action: 'updated' },
        saved: { ...CURRENT, version: 2 },
        reply: '',
        stopped: false,
      });
    const { deps } = fixture([], {
      team: team({ buildDashboard }),
      deps: { buildsDashboard: true },
    });
    const runtime = orchestratorTools(deps, 'A dashboard of goals', undefined);
    const first = await runtime.buildDashboard('Goals by team.');
    expect(first).toBe(
      [
        'Built dashboard "Goals by team", version 1 (created): 1 widgets, 1 filters, 32 rows.',
        'Its columns: team, goals.',
        'The user sees the dashboard with the answer: do not describe it in figures.',
      ].join('\n'),
    );
    const calls = buildDashboard.mock.calls as {
      current?: CurrentDashboard;
    }[][];
    expect(calls[0][0].current).toBeUndefined();
    await runtime.buildDashboard('Make it dark.');
    expect(calls[1][0].current?.version).toBe(1);
    expect(await runtime.buildDashboard('Again.')).toBe(
      'Clara already built twice in this run: close from the dashboard she has.',
    );
    expect(buildDashboard).toHaveBeenCalledTimes(2);

    const resumed = fixture([text('Done.')], {
      deps: { state: deps.state },
    });
    await runOrchestratorTurn(resumed.deps, {
      question: 'q',
      answered: { question: 'Which?', options: ['A'], answer: 'A' },
    });
    const context = resumed.streams[0].options['context'] as {
      content: string;
    }[];
    expect(context[1].content).toContain(
      'Clara already built the dashboard "Goals by team", version 2.',
    );
  });

  it('tells Avery when Clara built nothing, or the run was stopped', async () => {
    const failing = fixture([], {
      team: team({
        buildDashboard: jest.fn().mockResolvedValue({
          reply: 'I could not bind the stage.',
          error: 'Clara submitted no dashboard.',
          stopped: false,
        }),
      }),
      deps: { buildsDashboard: true },
    });
    const runtime = orchestratorTools(failing.deps, 'q', undefined);
    expect(await runtime.buildDashboard('Goals.')).toBe(
      'Clara built no dashboard: Clara submitted no dashboard.',
    );
    expect(failing.deps.state.dashboard).toBeUndefined();

    const stopped = fixture([], {
      team: team({
        buildDashboard: jest
          .fn()
          .mockResolvedValue({ reply: '', stopped: true }),
      }),
      deps: { buildsDashboard: true },
    });
    expect(
      await orchestratorTools(stopped.deps, 'q', undefined).buildDashboard(
        'Goals.',
      ),
    ).toBe('The run was stopped.');
  });

  it("gives Clara the current dashboard's draft with its ids, its query, columns and row count", () => {
    const block = currentDashboardBlock(CURRENT);
    expect(block).toContain('version 2. Change it into version 3');
    expect(block).toContain('keep every id');
    expect(block).toContain('"id":"goals"');
    expect(block).toContain(
      'Its data query (datasource ds-pg): SELECT team, sum(goals) AS goals FROM g GROUP BY team',
    );
    expect(block).toContain('Its columns: team, goals');
    expect(block).toContain('Its rows: 1');
  });
});

/** What Avery writes for an export: every figure copied from TURNS' answers. */
const CONTENT: ExportContent = {
  formats: ['pdf', 'pptx'],
  title: 'Penetración de productos en Intellify',
  summary: [
    'Los 38 clientes activos tienen de media 6,3 de los 11 productos.',
    'El dashboard está en la versión 2.',
  ],
  turns: [
    { number: 1, headline: 'Media de 6,3 productos por cliente', points: [] },
    { number: 2, headline: 'Dashboard, versión 2', points: [] },
  ],
  includeSql: false,
};

const TURNS = {
  questions: [
    'haz una comparacion por clientes usando las metricas de penetracion y coberturas',
    'ahora crea un dashboard',
  ],
  answers: [
    '**Los 38 clientes activos tienen de media 6,3 de los 11 productos (58% de penetración).**',
    'He creado el dashboard (versión 1). El dashboard está ya en la versión 2 y tiene 11 widgets.',
  ],
};

const EXPORTED: ConversationExportRef = {
  id: 'x-1',
  title: CONTENT.title,
  createdAt: '2026-11-23T10:00:00.000Z',
  files: [
    { format: 'pdf', fileName: 'p.pdf', bytes: 10, pages: 9 },
    { format: 'pptx', fileName: 'p.pptx', bytes: 20, slides: 8 },
  ],
};

describe("Avery's export_conversation (agents.md 2.21, 3.18)", () => {
  it('with the gate closed: the tool is hidden and the facts say nothing of an export', async () => {
    const exportConversation = jest.fn();
    const { deps, streams } = fixture([text('Done.')], {
      team: team({ exportConversation }),
    });
    await runOrchestratorTurn(deps, { question: 'How many matches?' });
    expect(factsOf(streams)).not.toContain('export');
    const runtime = orchestratorTools(deps, 'q', undefined);
    expect(runtime.exportsConversation).toBe(false);
    const context = new RequestContext();
    context.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, runtime);
    expect(Object.keys(avertTools(context))).not.toContain(
      'export_conversation',
    );
    expect(await runtime.exportConversation(CONTENT)).toBe(
      'This run exports nothing.',
    );
    expect(exportConversation).not.toHaveBeenCalled();
  });

  it('with the gate open: offers the tool and lists the earlier questions, in order', async () => {
    const { deps, streams } = fixture([text('Done.')], {
      team: team({ exportConversation: jest.fn() }),
      deps: { exportsConversation: true, earlierTurns: TURNS },
    });
    await runOrchestratorTurn(deps, { question: 'Exporta la conversación' });
    expect(factsOf(streams).split('\n').at(-1)).toBe(
      'The user asked to export the conversation: export_conversation is available. Its earlier questions, in order: 1. "haz una comparacion por clientes usando las metricas de penetracion y coberturas" 2. "ahora crea un dashboard"',
    );
    const runtime = orchestratorTools(deps, 'q', undefined);
    const context = new RequestContext();
    context.set(ORCHESTRATOR_TOOLS_RUNTIME_KEY, runtime);
    expect(Object.keys(avertTools(context))).toContain('export_conversation');
  });

  it('cuts each earlier question at 140 characters in the facts', async () => {
    const long = 'q'.repeat(200);
    const { deps, streams } = fixture([text('Done.')], {
      team: team({ exportConversation: jest.fn() }),
      deps: {
        exportsConversation: true,
        earlierTurns: { questions: [long], answers: ['A.'] },
      },
    });
    await runOrchestratorTurn(deps, { question: 'Export it to PDF' });
    expect(factsOf(streams)).toContain(`1. "${'q'.repeat(140)}…"`);
  });

  it('exports with checked figures, keeps the export on the state and tells Avery the counts', async () => {
    const exportConversation = jest
      .fn()
      .mockResolvedValue({ export: EXPORTED });
    const { deps } = fixture([text('Done.')], {
      team: team({ exportConversation }),
      deps: { exportsConversation: true, earlierTurns: TURNS },
    });
    const runtime = orchestratorTools(deps, 'q', undefined);
    expect(await runtime.exportConversation(CONTENT)).toBe(
      'Exported "Penetración de productos en Intellify": PDF (9 pages), PowerPoint (8 slides). The user sees the download card with the answer: do not repeat the summary.',
    );
    expect(exportConversation).toHaveBeenCalledWith(CONTENT);
    expect(deps.state.export).toEqual(EXPORTED);
  });

  it('refuses figures that no answer gives, before anything is drawn', async () => {
    const exportConversation = jest.fn();
    const { deps } = fixture([text('Done.')], {
      team: team({ exportConversation }),
      deps: { exportsConversation: true, earlierTurns: TURNS },
    });
    const runtime = orchestratorTools(deps, 'q', undefined);
    expect(
      await runtime.exportConversation({
        ...CONTENT,
        summary: [
          'Medical llega al 97,4% de los clientes.',
          'Hay 38 clientes.',
        ],
      }),
    ).toBe(
      "These figures are not in the conversation's answers: 97,4. Use only figures from the answers, then call export_conversation again.",
    );
    expect(exportConversation).not.toHaveBeenCalled();
    expect(deps.state.export).toBeUndefined();
  });

  it('runs at most twice in a run, a refused call included', async () => {
    const exportConversation = jest
      .fn()
      .mockResolvedValue({ export: EXPORTED });
    const { deps } = fixture([text('Done.')], {
      team: team({ exportConversation }),
      deps: { exportsConversation: true, earlierTurns: TURNS },
    });
    const runtime = orchestratorTools(deps, 'q', undefined);
    await runtime.exportConversation({ ...CONTENT, title: 'Top 99 clients' });
    await runtime.exportConversation(CONTENT);
    expect(await runtime.exportConversation(CONTENT)).toBe(
      'export_conversation already ran twice in this run: close from what it said.',
    );
    expect(exportConversation).toHaveBeenCalledTimes(1);
  });

  it('tells Avery why when no file was made (no browser)', async () => {
    const { deps } = fixture([text('Done.')], {
      team: team({
        exportConversation: jest.fn().mockResolvedValue({
          error:
            'Exporting needs Microsoft Edge or Google Chrome on this computer.',
        }),
      }),
      deps: { exportsConversation: true, earlierTurns: TURNS },
    });
    expect(
      await orchestratorTools(deps, 'q', undefined).exportConversation(CONTENT),
    ).toBe(
      'The conversation was not exported: Exporting needs Microsoft Edge or Google Chrome on this computer.',
    );
  });
});

/**
 * What Michael and Avery receive in Answer a Business Question (Avery +
 * Michael) (agents.md 5.23), pinned to its value before the two other
 * Answer a Business Question workflows were removed: Michael's analyse
 * request (its input and the system blocks it streams with) on a first
 * call, a second one and a call resumed after a clarification; Avery's
 * messages, her run facts with each gate, and what her tool tells her.
 */
describe('Avery + Michael: what Michael and Avery receive is pinned', () => {
  const MICHAEL_TOOLS = [
    'answer_from_data',
    'build_dashboard',
    'export_conversation',
    'ask_clarification',
  ];

  async function received(
    deps: Partial<OrchestratorTurnDeps> & {
      members?: jest.Mocked<OrchestratorTeam>;
    },
    input: Parameters<typeof runOrchestratorTurn>[1],
  ) {
    const replies: string[] = [];
    const { members: given, ...rest } = deps;
    const {
      deps: full,
      members,
      streams,
    } = fixture(
      async (tools) => {
        replies.push(
          await tools.answerFromData(
            'How many matches were played in the 2022 World Cup? Count every match.',
          ),
        );
        replies.push(
          await tools.answerFromData('Count the group matches separately.'),
        );
        replies.push(await tools.answerFromData('A third call.'));
        return [text('Want it by stage?')];
      },
      {
        ...(given ? { team: given } : {}),
        deps: {
          tools: MICHAEL_TOOLS,
          history: [
            { role: 'user', content: 'Which teams played?' },
            { role: 'assistant', content: '32 teams played.' },
          ],
          earlierQueries: [
            {
              ref: 'Q1',
              sql: 'SELECT DISTINCT team FROM wc.public.matches',
              rationale: 'The teams.',
            },
          ],
          ...rest,
        },
      },
    );
    const done = await runOrchestratorTurn(full, input);
    return {
      requests: members.analyse.mock.calls.map(([call]) => ({
        call,
        system: analyseSystemBlocks({
          catalogBlock: call.catalogBlock,
          planBlock: call.planBlock,
          imageNotes: call.imageNotes,
        }),
      })),
      replies,
      avery: streams.map((stream) => ({
        messages: stream.messages,
        context: stream.options['context'],
        maxSteps: stream.options['maxSteps'],
      })),
      done,
    };
  }

  it("Michael's analyse requests and Avery's messages hash to the base value", async () => {
    const cases = [
      await received({}, { question: 'How many matches?' }),
      await received(
        {},
        {
          question: 'How many matches?',
          answered: {
            question: 'Which tournament?',
            options: ['2018', '2022'],
            answer: '2022',
          },
        },
      ),
      await received(
        {
          buildsDashboard: true,
          members: team({ buildDashboard: jest.fn() }),
        },
        { question: 'Build a dashboard of the matches' },
      ),
      await received(
        {
          exportsConversation: true,
          earlierTurns: TURNS,
          members: team({ exportConversation: jest.fn() }),
        },
        { question: 'Export the conversation' },
      ),
    ];
    expect(cases[0].requests).toHaveLength(2);
    expect(cases[0].requests[0].system[1]).toContain(MICHAEL_ALONE_LINE);
    expect(JSON.stringify(cases[2].avery[0].context)).toContain(
      'build_dashboard is available',
    );
    const digest = createHash('sha256')
      .update(JSON.stringify(cases))
      .digest('hex');
    expect(digest).toBe(
      'a8641df1f40ea6bc9b309d0184afa3ebfa930298aa416863e41899b7b8a0d8ea',
    );
  });
});
