import { BadRequestException } from '@nestjs/common';
import { DuckDBConnection } from '@mastra/duckdb';
import type { EvalRunView } from '../agents/eval-runs.service';
import type { EvalRunsRepository } from '../agents/repositories/eval-runs.repository';
import type { QualityAgent } from './agent-quality';
import { AgentQualityService } from './agent-quality.service';
import { SpanEventsRepository } from './repositories/span-events.repository';
import {
  TRACE_1,
  TRACE_2,
  cloneTrace,
  createSpanEventsTable,
  flowRows,
  insertSpanEvents,
} from './testing/span-events.fixture';

const NOW = new Date('2026-11-22T12:00:00Z');
const CATALOGUE: QualityAgent[] = [
  {
    key: 'assistant',
    agentId: 'assistant',
    name: 'Emily',
    role: 'Data Analyst',
    sets: [{ id: 'set-a', name: 'Alpha', caseIds: ['a1'] }],
  },
  {
    key: 'query-explainer',
    agentId: 'query-explainer',
    name: 'Dana',
    role: '',
    sets: [{ id: 'set-d', name: 'Dee', caseIds: ['d1'] }],
  },
];

function evalRuns(
  byAgent: Record<string, EvalRunView[]> = {},
): EvalRunsRepository {
  return {
    list: (key: string) => Promise.resolve(byAgent[key] ?? []),
  } as unknown as EvalRunsRepository;
}

async function serviceWith(
  rows: Record<string, unknown>[] | null,
  runs: Record<string, EvalRunView[]> = {},
): Promise<AgentQualityService> {
  const db = new DuckDBConnection({ path: ':memory:' });
  if (rows) {
    await createSpanEventsTable(db);
    await insertSpanEvents(db, rows);
  }
  return new AgentQualityService(
    new SpanEventsRepository(db),
    evalRuns(runs),
    CATALOGUE,
  );
}

/** A clone of a trace whose rows all carry the eval marker. */
function markedClone(
  rows: Record<string, unknown>[],
  traceId: string,
  suffix: string,
): Record<string, unknown>[] {
  return cloneTrace(rows, traceId, { suffix }).map((r) => ({
    ...r,
    metadata: {
      ...((r.metadata as object | undefined) ?? {}),
      'eval-run-id': 'job-1',
    },
  }));
}

const RUN: EvalRunView = {
  jobId: 'job-1',
  agentKey: 'assistant',
  datasourceId: 'ds',
  datasets: [],
  caseIds: ['a1'],
  status: 'completed',
  results: [
    {
      id: 'a1',
      question: 'q',
      scores: {},
      checkResults: [],
      answer: '',
      toolCalls: [],
      passed: true,
      durationMs: 1,
    },
  ],
  totalCases: 1,
  startedAt: '2026-11-20T10:00:00.000Z',
  finishedAt: '2026-11-20T10:01:00.000Z',
  setId: 'set-a',
  provider: 'openai',
  model: 'stub',
};

describe('AgentQualityService', () => {
  it('counts the live calls of the fixture per Mastra agent id', async () => {
    const service = await serviceWith(flowRows());
    const page = await service.getAgentQuality({}, NOW);
    const assistant = page.rows.find((r) => r.agentKey === 'assistant')!;
    expect(assistant.live.calls).toBe(3);
    expect(assistant.live.p95Ms).not.toBeNull();
    expect(assistant.live.pricedCalls).toBeGreaterThan(0);
    const explainer = page.rows.find((r) => r.agentKey === 'query-explainer')!;
    expect(explainer.live.calls).toBe(0);
    expect(page.facets.models).toContain('claude-sonnet-5-5');
  });

  it('excludes calls of a marked trace and counts an unmarked clone', async () => {
    const rows = flowRows();
    const baseline = (
      await (await serviceWith(rows)).getAgentQuality({}, NOW)
    ).rows.find((r) => r.agentKey === 'assistant')!.live.calls;

    const marked = await serviceWith([
      ...rows,
      ...markedClone(rows, TRACE_1, 'ev'),
    ]);
    const withMarked = await marked.getAgentQuality({}, NOW);
    expect(
      withMarked.rows.find((r) => r.agentKey === 'assistant')!.live.calls,
    ).toBe(baseline);

    const unmarked = await serviceWith([
      ...rows,
      ...cloneTrace(rows, TRACE_1, { suffix: 'live' }),
    ]);
    const withUnmarked = await unmarked.getAgentQuality({}, NOW);
    expect(
      withUnmarked.rows.find((r) => r.agentKey === 'assistant')!.live.calls,
    ).toBe(baseline + 1);
  });

  it('classifies a call by any marked span of its trace', async () => {
    const rows = flowRows();
    const clone = cloneTrace(rows, TRACE_2, { suffix: 'one' });
    // only a non-generation span carries the marker
    const tool = clone.find((r) => r.spanType !== 'model_generation')!;
    tool.metadata = { 'eval-run-id': 'job-9' };
    const service = await serviceWith([...rows, ...clone]);
    const baseline = (
      await (await serviceWith(rows)).getAgentQuality({}, NOW)
    ).rows.find((r) => r.agentKey === 'assistant')!.live.calls;
    expect(
      (await service.getAgentQuality({}, NOW)).rows.find(
        (r) => r.agentKey === 'assistant',
      )!.live.calls,
    ).toBe(baseline);
  });

  it('filters live calls by period and model; Unknown matches none', async () => {
    const service = await serviceWith(flowRows());
    const after = await service.getAgentQuality(
      { from: '2026-11-11T00:00:00Z' },
      NOW,
    );
    expect(after.rows.find((r) => r.agentKey === 'assistant')!.live.calls).toBe(
      0,
    );
    const model = await service.getAgentQuality(
      { model: 'claude-sonnet-5-5' },
      NOW,
    );
    expect(model.rows.find((r) => r.agentKey === 'assistant')!.live.calls).toBe(
      3,
    );
    const other = await service.getAgentQuality({ model: 'nope' }, NOW);
    expect(other.rows.find((r) => r.agentKey === 'assistant')!.live.calls).toBe(
      0,
    );
    const unknown = await service.getAgentQuality({ model: 'Unknown' }, NOW);
    expect(
      unknown.rows.find((r) => r.agentKey === 'assistant')!.live.calls,
    ).toBe(0);
  });

  it('gives 0 live calls and no error when there is no trace table', async () => {
    const service = await serviceWith(null, { assistant: [RUN] });
    const page = await service.getAgentQuality({}, NOW);
    expect(page.rows.every((r) => r.live.calls === 0)).toBe(true);
    expect(page.rows.find((r) => r.agentKey === 'assistant')!.eval.state).toBe(
      'ok',
    );
    expect(page.rows.find((r) => r.agentKey === 'assistant')!.eval.model).toBe(
      'stub',
    );
    expect(
      page.rows.find((r) => r.agentKey === 'assistant')!.eval.pass3,
    ).toEqual({ state: 'needs-runs', runs: 1 });
    expect(page.facets.models).toEqual(['stub']);
  });

  it('joins runs by registry key and shows none for an agent without runs', async () => {
    const service = await serviceWith(flowRows(), { assistant: [RUN] });
    const page = await service.getAgentQuality({}, NOW);
    const [dana, emily] = page.rows;
    expect(dana.name).toBe('Dana');
    expect(dana.eval.state).toBe('none');
    expect(emily.eval.lastRun).toMatchObject({ jobId: 'job-1', passed: 1 });
  });

  it('rejects bad dates with the contract messages', async () => {
    const service = await serviceWith(null);
    await expect(service.getAgentQuality({ from: 'x' }, NOW)).rejects.toThrow(
      new BadRequestException('From is not a valid date'),
    );
    await expect(
      service.getAgentQuality(
        { from: '2026-11-02T00:00:00Z', to: '2026-11-01T00:00:00Z' },
        NOW,
      ),
    ).rejects.toThrow('From must not be after To');
  });
});
