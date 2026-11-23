import type { EvalRunView } from '../agents/eval-runs.service';
import {
  buildAgentQualityPage,
  evalFigures,
  liveFigures,
  normaliseRuns,
  passCubed,
  type LiveCall,
  type QualityAgent,
  type QualityFilter,
} from './agent-quality';

const AGENT: QualityAgent = {
  key: 'assistant',
  agentId: 'assistant',
  name: 'Emily',
  role: 'Data Analyst',
  sets: [
    { id: 'set-a', name: 'Alpha', caseIds: ['a1', 'a2', 'a3', 'a4', 'a5'] },
    { id: 'set-b', name: 'Beta', caseIds: ['b1', 'b2'] },
  ],
};
const OTHER: QualityAgent = {
  key: 'insights-analyst',
  agentId: 'insights-analyst',
  name: 'Michael',
  role: 'Analyst',
  sets: [{ id: 'set-m', name: 'Mike', caseIds: ['m1'] }],
};

const FILTER: QualityFilter = {
  from: null,
  to: new Date('2026-12-01T00:00:00Z'),
};

function result(
  id: string,
  passed: boolean,
  calls: { error?: string }[] = [],
): EvalRunView['results'][number] {
  return {
    id,
    question: id,
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: calls.map((c) => ({ name: 't', ...c })),
    passed,
    durationMs: 1,
  };
}

let n = 0;
function run(over: Partial<EvalRunView> & { day: number }): EvalRunView {
  n += 1;
  const { day, ...rest } = over;
  const at = `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`;
  return {
    jobId: `job-${n}`,
    agentKey: 'assistant',
    datasourceId: 'ds',
    datasets: [],
    caseIds: ['a1'],
    status: 'completed',
    results: [result('a1', true)],
    totalCases: 1,
    startedAt: at,
    finishedAt: at,
    setId: 'set-a',
    provider: 'openai',
    model: 'gpt-x',
    ...rest,
  };
}

describe('normaliseRuns', () => {
  it('keeps completed runs only, newest first, by finishedAt then startedAt', () => {
    const old = run({ day: 1 });
    const fresh = run({ day: 5 });
    const noFinish = run({ day: 3, finishedAt: undefined });
    const failed = run({ day: 9, status: 'failed' });
    const out = normaliseRuns(AGENT, [old, failed, fresh, noFinish]);
    expect(out.map((r) => r.run)).toEqual([fresh, noFinish, old]);
  });

  it('derives the set of an old run from its case ids', () => {
    const one = run({ day: 1, setId: undefined, caseIds: ['b1', 'b2'] });
    const spans = run({ day: 2, setId: undefined, caseIds: ['a1', 'b1'] });
    const none = run({ day: 3, setId: undefined, caseIds: [] });
    const stored = run({ day: 4, setId: null });
    const out = normaliseRuns(AGENT, [one, spans, none, stored]);
    const by = (r: EvalRunView) => out.find((o) => o.run === r)!.setId;
    expect(by(one)).toBe('set-b');
    expect(by(spans)).toBeNull();
    expect(by(none)).toBeNull();
    expect(by(stored)).toBeNull();
  });

  it('reads a missing model as Unknown and a missing provider as null', () => {
    const [old] = normaliseRuns(AGENT, [
      run({ day: 1, model: undefined, provider: undefined }),
    ]);
    expect(old.model).toBe('Unknown');
    expect(old.provider).toBeNull();
  });
});

describe('passCubed', () => {
  function runs(...passes: boolean[][]): ReturnType<typeof normaliseRuns> {
    // passes[i] = results of run i, case a1..; newest run last in input.
    return normaliseRuns(
      AGENT,
      passes.map((p, i) =>
        run({
          day: i + 1,
          results: p.map((passed, j) => result(`a${j + 1}`, passed)),
        }),
      ),
    );
  }

  it('is unknown-model for Unknown', () => {
    expect(passCubed(AGENT, runs([true]), 'Unknown', undefined)).toEqual({
      state: 'unknown-model',
    });
  });

  it('needs runs with 0, 1 or 2 runs', () => {
    expect(passCubed(AGENT, [], 'gpt-x', undefined)).toEqual({
      state: 'needs-runs',
      runs: 0,
    });
    expect(passCubed(AGENT, runs([true]), 'gpt-x', undefined)).toEqual({
      state: 'needs-runs',
      runs: 1,
    });
    expect(passCubed(AGENT, runs([true], [true]), 'gpt-x', undefined)).toEqual({
      state: 'needs-runs',
      runs: 2,
    });
  });

  it('is the share of eligible cases that passed all of their last 3 runs', () => {
    // a1 passes 3/3; a2 fails once; a3 only in the last 2 runs (not eligible)
    const out = runs(
      [true, true],
      [true, false, true],
      [true, true, true],
      [true, true],
    );
    // 4 runs, newest first: [t,t] [t,t,t] [t,f,t] [t,t]
    expect(passCubed(AGENT, out, 'gpt-x', undefined)).toEqual({
      state: 'ok',
      value: 0.5,
      cases: 2,
      totalCases: 3,
    });
  });

  it('keeps only the newest 3 results of a case', () => {
    const out = runs([false], [true], [true], [true]);
    expect(passCubed(AGENT, out, 'gpt-x', undefined)).toMatchObject({
      state: 'ok',
      value: 1,
    });
  });

  it('leaves out a case no longer in the suite', () => {
    const dropped = normaliseRuns(
      AGENT,
      [1, 2, 3].map((day) =>
        run({
          day,
          results: [result('a1', true), result('gone', false)],
        }),
      ),
    );
    expect(passCubed(AGENT, dropped, 'gpt-x', undefined)).toEqual({
      state: 'ok',
      value: 1,
      cases: 1,
      totalCases: 1,
    });
  });

  it('limits the universe to the chosen set', () => {
    const mixed = normaliseRuns(
      AGENT,
      [1, 2, 3].map((day) =>
        run({
          day,
          setId: null,
          results: [result('a1', true), result('b1', false)],
        }),
      ),
    );
    expect(passCubed(AGENT, mixed, 'gpt-x', 'set-b')).toMatchObject({
      value: 0,
      cases: 1,
      totalCases: 1,
    });
  });
});

describe('evalFigures', () => {
  it('is none without any completed run', () => {
    const fig = evalFigures(AGENT, [run({ day: 1, status: 'failed' })], FILTER);
    expect(fig.state).toBe('none');
    expect(fig.pass3).toBeNull();
    expect(fig.lastRun).toBeNull();
  });

  it('is no-match when runs exist but none is in scope', () => {
    const fig = evalFigures(AGENT, [run({ day: 1 })], {
      ...FILTER,
      model: 'other',
    });
    expect(fig.state).toBe('no-match');
    expect(fig.pass3).toBeNull();
  });

  it('scopes by set, period and model; a multi-set run counts only without a set', () => {
    const a = run({ day: 2 });
    const multi = run({ day: 4, setId: null });
    expect(
      evalFigures(AGENT, [a, multi], { ...FILTER, set: 'set-a' }).lastRun
        ?.jobId,
    ).toBe(a.jobId);
    expect(evalFigures(AGENT, [a, multi], FILTER).lastRun?.jobId).toBe(
      multi.jobId,
    );
    const windowed = evalFigures(AGENT, [a, multi], {
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-11-03T00:00:00Z'),
    });
    expect(windowed.runs).toBe(1);
    expect(windowed.lastRun?.jobId).toBe(a.jobId);
  });

  it('includes runs on the period edges', () => {
    const r = run({ day: 2 });
    const edge = new Date(r.finishedAt!);
    expect(evalFigures(AGENT, [r], { from: edge, to: edge }).state).toBe('ok');
  });

  it('takes M from the newest run in scope and never mixes models', () => {
    const oldOther = run({ day: 1, model: 'm-old' });
    const newest = run({ day: 6, model: 'm-new', provider: 'azure' });
    const fig = evalFigures(AGENT, [oldOther, newest], FILTER);
    expect(fig.model).toBe('m-new');
    expect(fig.provider).toBe('azure');
    expect(fig.runs).toBe(1);
    expect(
      evalFigures(AGENT, [oldOther, newest], { ...FILTER, model: 'm-old' })
        .model,
    ).toBe('m-old');
  });

  it('reports the last run counts and an Unknown model without pass^3', () => {
    const r = run({
      day: 2,
      model: undefined,
      results: [result('a1', true), result('a2', false)],
    });
    const fig = evalFigures(AGENT, [r], FILTER);
    expect(fig.model).toBe('Unknown');
    expect(fig.lastRun).toEqual({
      jobId: r.jobId,
      at: r.finishedAt,
      passed: 1,
      total: 2,
    });
    expect(fig.pass3).toEqual({ state: 'unknown-model' });
  });

  it('computes tool calls per question and the error rate over every result', () => {
    const r1 = run({
      day: 1,
      results: [
        result('a1', true, [{}, { error: 'boom' }]),
        result('a2', true, [{}]),
      ],
    });
    const r2 = run({ day: 2, results: [result('a1', true, [{}])] });
    const fig = evalFigures(AGENT, [r1, r2], FILTER);
    expect(fig.questions).toBe(3);
    expect(fig.toolCalls).toBe(4);
    expect(fig.toolCallsPerQuestion).toBeCloseTo(4 / 3);
    expect(fig.toolErrorRate).toBe(0.25);
  });

  it('gives a null rate with no tool calls and no results', () => {
    const none = evalFigures(
      AGENT,
      [run({ day: 1, results: [result('a1', true)] })],
      FILTER,
    );
    expect(none.toolCallsPerQuestion).toBe(0);
    expect(none.toolErrorRate).toBeNull();
    const empty = evalFigures(AGENT, [run({ day: 1, results: [] })], FILTER);
    expect(empty.toolCallsPerQuestion).toBeNull();
    expect(empty.toolErrorRate).toBeNull();
    expect(empty.lastRun?.total).toBe(0);
  });
});

function call(over: Partial<LiveCall> = {}): LiveCall {
  return {
    agentId: 'assistant',
    startedAt: '2026-11-10T10:00:00Z',
    endedAt: '2026-11-10T10:00:02Z',
    status: 'succeeded',
    model: 'claude-sonnet-5-5',
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    ...over,
  };
}

describe('liveFigures', () => {
  it('is empty with no calls', () => {
    expect(liveFigures([])).toEqual({
      calls: 0,
      p95Ms: null,
      pricedCalls: 0,
      costPerCallUsd: null,
    });
  });

  it('takes the nearest-rank p95 of finished calls, running excluded', () => {
    const calls = Array.from({ length: 20 }, (_, i) =>
      call({
        endedAt: new Date(Date.parse('2026-11-10T10:00:00Z') + (i + 1) * 1000),
      }),
    );
    calls.push(call({ status: 'running', endedAt: null }));
    const fig = liveFigures(calls);
    expect(fig.calls).toBe(21);
    expect(fig.p95Ms).toBe(19000);
  });

  it('counts failed calls in latency', () => {
    expect(liveFigures([call({ status: 'failed' })]).p95Ms).toBe(2000);
  });

  it('averages the cost over priced calls only', () => {
    const fig = liveFigures([
      call(),
      call({ model: 'unpriced-model-x' }),
      call({ inputTokens: 0, outputTokens: 0 }),
    ]);
    expect(fig.calls).toBe(3);
    expect(fig.pricedCalls).toBe(2);
    expect(fig.costPerCallUsd).toBeGreaterThan(0);
    const single = liveFigures([call()]).costPerCallUsd!;
    expect(fig.costPerCallUsd).toBeCloseTo(single / 2);
  });

  it('has no cost when no call is priced', () => {
    const fig = liveFigures([call({ model: 'unpriced-model-x' })]);
    expect(fig.pricedCalls).toBe(0);
    expect(fig.costPerCallUsd).toBeNull();
  });
});

describe('buildAgentQualityPage', () => {
  const runs = new Map([
    ['assistant', [run({ day: 2 })]],
    ['insights-analyst', [] as EvalRunView[]],
  ]);
  const base = {
    agents: [AGENT, OTHER],
    runs,
    liveCalls: [call(), call({ agentId: 'insights-analyst' })],
    liveModels: ['live-model', ''],
    filter: FILTER,
  };

  it('has one row per agent, by persona name, with its own live calls', () => {
    const page = buildAgentQualityPage(base);
    expect(page.rows.map((r) => r.name)).toEqual(['Emily', 'Michael']);
    expect(page.rows[0].live.calls).toBe(1);
    expect(page.rows[1].eval.state).toBe('none');
    expect(page.from).toBeNull();
    expect(page.to).toBe('2026-12-01T00:00:00.000Z');
  });

  it('narrows rows by agent and by set, but never the facets', () => {
    const byAgent = buildAgentQualityPage({
      ...base,
      filter: { ...FILTER, agent: 'insights-analyst' },
    });
    expect(byAgent.rows.map((r) => r.agentKey)).toEqual(['insights-analyst']);
    const bySet = buildAgentQualityPage({
      ...base,
      filter: { ...FILTER, set: 'set-m' },
    });
    expect(bySet.rows.map((r) => r.agentKey)).toEqual(['insights-analyst']);
    const clash = buildAgentQualityPage({
      ...base,
      filter: { ...FILTER, agent: 'assistant', set: 'set-m' },
    });
    expect(clash.rows).toEqual([]);
    const unknown = buildAgentQualityPage({
      ...base,
      filter: { ...FILTER, set: 'nope' },
    });
    expect(unknown.rows).toEqual([]);
    expect(unknown.facets).toEqual(byAgent.facets);
    expect(byAgent.facets.agents).toEqual([
      { key: 'assistant', name: 'Emily' },
      { key: 'insights-analyst', name: 'Michael' },
    ]);
    expect(byAgent.facets.sets).toEqual([
      { id: 'set-a', name: 'Alpha', agentKey: 'assistant' },
      { id: 'set-b', name: 'Beta', agentKey: 'assistant' },
      { id: 'set-m', name: 'Mike', agentKey: 'insights-analyst' },
    ]);
  });

  it('lists run and live models sorted, Unknown last', () => {
    const page = buildAgentQualityPage({
      ...base,
      runs: new Map([
        [
          'assistant',
          [run({ day: 2, model: 'zeta' }), run({ day: 3, model: undefined })],
        ],
      ]),
    });
    expect(page.facets.models).toEqual(['live-model', 'zeta', 'Unknown']);
  });
});
