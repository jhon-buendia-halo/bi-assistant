// Elena's turn (plan Elena 2.4): the analysis attempt is a mock; the
// catalog loader a stub with data that ends years before today.
import type {
  AnalyseAttempt,
  AnalyseRuntime,
  CatalogEntity,
  EntityColumns,
} from '../../../mastra/workflows/analysis.steps';
import { CONVERSATION_GATES_CONTEXT_KEY } from '../../../mastra/workflows/conversation-turn.steps';
import {
  DASHBOARD_TOOLS_RUNTIME_KEY,
  type DashboardToolsRuntime,
} from '../../../mastra/tools/dashboard.tools';
import {
  EXPORT_TOOLS_RUNTIME_KEY,
  type ExportToolsRuntime,
} from '../../../mastra/tools/export.tools';
import type {
  CurrentDashboard,
  DashboardRef,
} from '../../artifacts/entities/artifact.entity';
import { orchestratorState } from './orchestrator-turn';
import {
  runSoloTurn,
  SOLO_REPAIR_HEADER,
  type SoloTurnDeps,
  type SoloTurnState,
} from './solo-turn';

const CATALOG: CatalogEntity[] = [
  {
    entity: 'wc.public.matches',
    dataset: 'World Cup',
    datasourceId: 'ds-pg',
    datasourceKind: 'postgres',
    columnCount: 2,
    dataEndsAt: '2018-07-15',
  },
];
const COLUMNS: EntityColumns[] = [
  {
    entity: 'wc.public.matches',
    columns: [
      { name: 'id', type: 'integer' },
      { name: 'played_on', type: 'date' },
    ],
    more: 0,
  },
];

const ANSWERED: AnalyseAttempt = {
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
  text: 'There were **64** matches.',
  stopped: false,
};

/** An attempt that ran no query: `Ran a query` fails. */
const NO_QUERY: AnalyseAttempt = {
  calls: [],
  queries: [],
  text: 'There were about 60 matches.',
  stopped: false,
};

const ASKED: AnalyseAttempt = {
  calls: [],
  queries: [],
  text: '',
  stopped: false,
  clarification: { question: 'Which tournament?', options: ['Men', 'Women'] },
};

const CURRENT: CurrentDashboard = {
  artifactId: 'art-1',
  version: 1,
  title: 'Goals by team',
  blueprint: {
    title: 'Goals by team',
    summary: '',
    theme: { palette: ['#111111'] },
    layout: 'grid',
    filters: [],
    widgets: [],
    columns: [],
  } as unknown as CurrentDashboard['blueprint'],
  query: { sql: 'SELECT 1', datasourceId: 'ds-pg' },
  columns: ['team', 'goals'],
  rowCount: 32,
  widgetCount: 3,
  filterCount: 1,
};

function fixture(
  attempts: AnalyseAttempt[],
  overrides: Partial<SoloTurnDeps<string>> = {},
) {
  const analyse = jest.fn<
    ReturnType<AnalyseRuntime['analyse']>,
    Parameters<AnalyseRuntime['analyse']>
  >();
  for (const attempt of attempts) analyse.mockResolvedValueOnce(attempt);
  const context = new Map<string, unknown>();
  const state: SoloTurnState = orchestratorState();
  const deps: SoloTurnDeps<string> = {
    analyse,
    state,
    datasets: ['World Cup'],
    signal: new AbortController().signal,
    requestContext: { set: (key, value) => context.set(key, value) },
    message: 'How many matches were played?',
    asksForDashboard: false,
    loadCatalog: () => Promise.resolve({ catalog: CATALOG, columns: COLUMNS }),
    ...overrides,
  };
  return { deps, analyse, context, state };
}

const QUESTION = { question: 'How many matches were played?' };

describe("Elena's turn (plan Elena 2.4)", () => {
  it('answers from one attempt when every check passes, and keeps its checks', async () => {
    const { deps, analyse } = fixture([ANSWERED]);
    const done = await runSoloTurn(deps, QUESTION);
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(analyse.mock.calls[0][0]).toMatchObject({
      question: QUESTION.question,
      attempt: 1,
      catalog: CATALOG,
    });
    expect(analyse.mock.calls[0][0].planBlock).toContain(
      'Run facts: datasets World Cup.',
    );
    expect(done).toMatchObject({
      answer: 'There were **64** matches.',
      stopped: false,
      attempts: 1,
    });
    expect(done.checks.every((check) => check.passed)).toBe(true);
    // The data-date check runs: the catalog and the question reach it.
    expect(done.checks.map((check) => check.check)).toContain(
      "Measured from the data's date",
    );
    // No plan, no measures finding (plan Elena 2.6).
    expect(done.checks.map((check) => check.check)).not.toContain(
      'Measures covered (warning only)',
    );
  });

  it('runs exactly one repair round with the failed checks when a check fails', async () => {
    const { deps, analyse, state } = fixture([NO_QUERY, ANSWERED]);
    const done = await runSoloTurn(deps, QUESTION);
    expect(analyse).toHaveBeenCalledTimes(2);
    const repair = analyse.mock.calls[1][0];
    expect(repair.attempt).toBe(2);
    expect(repair.planBlock).toContain(
      `${SOLO_REPAIR_HEADER}\n- Ran a query: No SQL query ran.`,
    );
    expect(repair.planBlock).toContain('There were about 60 matches.');
    expect(done).toMatchObject({
      answer: 'There were **64** matches.',
      attempts: 2,
    });
    expect(done.checks.every((check) => check.passed)).toBe(true);
    expect(state.attempts).toBe(2);
  });

  it('checks nothing and repairs nothing when she only replies, calling no tool and stating no figure', async () => {
    const reply: AnalyseAttempt = {
      calls: [],
      queries: [],
      text: "You're welcome. Ask me anything else about the World Cup.",
      stopped: false,
    };
    const { deps, analyse } = fixture([reply], { message: 'Thanks!' });
    const done = await runSoloTurn(deps, { question: 'Thanks!' });
    expect(analyse).toHaveBeenCalledTimes(1);
    expect(done).toMatchObject({ answer: reply.text, attempts: 1, checks: [] });
  });

  it('never runs a second repair round, even when the repair fails its checks too', async () => {
    const { deps, analyse } = fixture([NO_QUERY, NO_QUERY]);
    const done = await runSoloTurn(deps, QUESTION);
    expect(analyse).toHaveBeenCalledTimes(2);
    expect(done.attempts).toBe(2);
    expect(done.checks.find((c) => c.check === 'Ran a query')?.passed).toBe(
      false,
    );
  });

  it("keeps attempt 1's answer and checks when the repair round errs", async () => {
    const { deps } = fixture([
      NO_QUERY,
      { ...NO_QUERY, text: '', retryError: 'The model is overloaded' },
    ]);
    const done = await runSoloTurn(deps, QUESTION);
    expect(done.answer).toBe('There were about 60 matches.');
    expect(done.attempts).toBe(2);
    expect(done.checks.find((c) => c.check === 'Ran a query')?.passed).toBe(
      false,
    );
  });

  it('suspends on her clarifying question with no check, then goes on with the answer', async () => {
    const { deps, analyse } = fixture([ASKED, ANSWERED]);
    const waiting = await runSoloTurn(deps, QUESTION);
    expect(waiting).toMatchObject({
      answer: '',
      stopped: false,
      clarification: ASKED.clarification,
      attempts: 1,
    });
    expect(analyse).toHaveBeenCalledTimes(1);
    const answered = {
      question: 'Which tournament?',
      options: ['Men', 'Women'],
      answer: 'Men',
    };
    const done = await runSoloTurn(deps, { ...QUESTION, answered });
    expect(analyse).toHaveBeenCalledTimes(2);
    expect(analyse.mock.calls[1][0]).toMatchObject({ attempt: 1, answered });
    expect(done).toMatchObject({
      answer: 'There were **64** matches.',
      attempts: 1,
    });
  });

  it('closes both gates when the message asks for neither: no dashboard or export runtime', async () => {
    const submitter = dashboardSubmitter();
    const { deps, context } = fixture([ANSWERED], { dashboard: submitter });
    await runSoloTurn(deps, QUESTION);
    expect(context.get(CONVERSATION_GATES_CONTEXT_KEY)).toEqual({
      dashboard: false,
      export: false,
    });
    expect(context.has(DASHBOARD_TOOLS_RUNTIME_KEY)).toBe(false);
    expect(context.has(EXPORT_TOOLS_RUNTIME_KEY)).toBe(false);
    expect(submitter.save).not.toHaveBeenCalled();
  });

  it('opens the dashboard gate when asked, or when the conversation has one, and names it in her facts', async () => {
    const asked = fixture([ANSWERED], {
      dashboard: dashboardSubmitter(),
      asksForDashboard: true,
    });
    await runSoloTurn(asked.deps, QUESTION);
    expect(asked.context.get(CONVERSATION_GATES_CONTEXT_KEY)).toEqual({
      dashboard: true,
      export: false,
    });
    expect(asked.analyse.mock.calls[0][0].planBlock).toContain(
      'The user asked for a dashboard: submit_dashboard is available.',
    );
    const carried = fixture([ANSWERED], {
      dashboard: dashboardSubmitter(),
      currentDashboard: CURRENT,
    });
    await runSoloTurn(carried.deps, QUESTION);
    expect(carried.context.get(DASHBOARD_TOOLS_RUNTIME_KEY)).toBeDefined();
    const block = carried.analyse.mock.calls[0][0].planBlock;
    expect(block).toContain('submit_dashboard changes it into version 2.');
    expect(block).toContain('change only what the user asks');
  });

  it('opens the export gate with the export runtime, its figure check reading the earlier answers', async () => {
    const run = jest.fn().mockResolvedValue({ error: 'no browser' });
    const { deps, context } = fixture([ANSWERED], {
      exporting: {
        turns: { questions: ['How many goals?'], answers: ['There were 172.'] },
        run,
      },
    });
    await runSoloTurn(deps, QUESTION);
    expect(context.get(CONVERSATION_GATES_CONTEXT_KEY)).toEqual({
      dashboard: false,
      export: true,
    });
    const runtime = context.get(EXPORT_TOOLS_RUNTIME_KEY) as ExportToolsRuntime;
    expect(runtime.exportsConversation).toBe(true);
    // A figure no answer gives is refused before anything is drawn.
    expect(
      await runtime.exportConversation({
        title: 'Goals',
        summary: ['There were 999 goals.'],
        turns: [{ number: 1, headline: 'Goals', points: [] }],
        formats: ['pdf'],
        includeSql: false,
      }),
    ).toContain('999');
    expect(run).not.toHaveBeenCalled();
  });

  it('saves the dashboard once, from her last accepted submission across both attempts', async () => {
    const submitter = dashboardSubmitter(['first', 'last']);
    const { deps, state } = fixture([NO_QUERY, ANSWERED], {
      dashboard: submitter,
      asksForDashboard: true,
      message: 'Make a dashboard of the matches',
    });
    await runSoloTurn(deps, QUESTION);
    expect(submitter.save).toHaveBeenCalledTimes(1);
    expect(submitter.save).toHaveBeenCalledWith(
      'last',
      undefined,
      'Make a dashboard of the matches',
    );
    expect(state.dashboard?.artifactId).toBe('art-9');
  });

  it('saves no dashboard when the run is stopped', async () => {
    const submitter = dashboardSubmitter(['only']);
    const { deps } = fixture([{ ...ANSWERED, stopped: true }], {
      dashboard: submitter,
      asksForDashboard: true,
    });
    const done = await runSoloTurn(deps, QUESTION);
    expect(done.stopped).toBe(true);
    expect(submitter.save).not.toHaveBeenCalled();
  });
});

/** A submitter whose `accepted()` reads the last of `accepted` at call time. */
function dashboardSubmitter(accepted: string[] = []) {
  const ref = {
    artifactId: 'art-9',
    version: 1,
    title: 'Matches',
    action: 'created',
    rowCount: 64,
    widgetCount: 2,
    filterCount: 0,
  } as unknown as DashboardRef;
  return {
    runtime: { submit: jest.fn() } as unknown as DashboardToolsRuntime,
    accepted: () => accepted.at(-1),
    save: jest.fn(() => Promise.resolve({ ref, saved: CURRENT })),
  };
}
