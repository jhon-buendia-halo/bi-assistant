// The services pull in the Mastra agent stack; the controller only forwards
// the request body to them, which is what these tests check.
jest.mock('./agents.service', () => ({ AgentsService: class {} }));
jest.mock('./eval-runs.service', () => ({ EvalRunsService: class {} }));
jest.mock('./agent-prompts.service', () => ({ AgentPromptsService: class {} }));

import { AgentsController } from './agents.controller';
import type { AgentPromptsService } from './agent-prompts.service';
import type { AgentsService } from './agents.service';
import type { EvalRunsService } from './eval-runs.service';

function build(start: jest.Mock) {
  return new AgentsController(
    {} as AgentsService,
    { start } as unknown as EvalRunsService,
    {} as AgentPromptsService,
  );
}

describe('AgentsController POST /agents/:key/evals/run (api.md 36)', () => {
  it('forwards the judge option and its categories to the run', async () => {
    const start = jest.fn().mockResolvedValue({ jobId: 'job-1' });
    const answer = await build(start).runEvals('assistant', {
      datasourceId: 'wc',
      caseIds: ['champion-2022'],
      judge: 'categories',
      judgeCategories: ['ambiguous'],
    });
    expect(start).toHaveBeenCalledWith('assistant', 'wc', ['champion-2022'], {
      judge: 'categories',
      judgeCategories: ['ambiguous'],
      repeats: undefined,
    });
    expect(answer).toEqual({
      ok: true,
      message: 'Eval run started',
      jobId: 'job-1',
    });
  });

  it('leaves the option out when the body has none, so the run defaults to off', async () => {
    const start = jest.fn().mockResolvedValue({ jobId: 'job-1' });
    await build(start).runEvals('assistant', { datasourceId: 'wc' });
    expect(start).toHaveBeenCalledWith('assistant', 'wc', undefined, {
      judge: undefined,
      judgeCategories: undefined,
      repeats: undefined,
    });
  });

  it('forwards the repeats as sent, for the service to check (R209)', async () => {
    const start = jest.fn().mockResolvedValue({ jobId: 'job-1' });
    await build(start).runEvals('assistant', {
      datasourceId: 'wc',
      repeats: 3,
    });
    expect(start).toHaveBeenCalledWith(
      'assistant',
      'wc',
      undefined,
      expect.objectContaining({ repeats: 3 }),
    );
  });

  it('answers a refused repeats value in Style A', async () => {
    const start = jest
      .fn()
      .mockResolvedValue({ error: 'Repeats must be 1, 3 or 5 (got "2")' });
    await expect(
      build(start).runEvals('assistant', { datasourceId: 'wc', repeats: 2 }),
    ).resolves.toEqual({
      ok: false,
      message: 'Repeats must be 1, 3 or 5 (got "2")',
    });
  });

  it('answers a refused option in Style A', async () => {
    const start = jest
      .fn()
      .mockResolvedValue({ error: 'Unknown judge option "sometimes"' });
    await expect(
      build(start).runEvals('assistant', {
        datasourceId: 'wc',
        judge: 'sometimes',
      }),
    ).resolves.toEqual({
      ok: false,
      message: 'Unknown judge option "sometimes"',
    });
  });
});

describe('AgentsController GET /agents/:key/evals/runs/:jobId/download (api.md 39)', () => {
  it('notes in the report that the compared run used other repeats (R218)', async () => {
    const run = {
      jobId: 'job-12345678',
      agentKey: 'assistant',
      datasourceId: 'wc',
      datasets: ['World Cup'],
      caseIds: [],
      status: 'completed',
      results: [],
      totalCases: 0,
      startedAt: '2026-10-20T10:00:00.000Z',
      judge: { mode: 'off' },
      repeats: 3,
      source: 'app',
      comparison: {
        previousRunId: 'job-0',
        regressions: [],
        improvements: [],
        unchanged: [],
      },
    };
    const evalRuns = {
      status: jest.fn().mockResolvedValue(run),
      datasourceName: jest.fn().mockResolvedValue('World Cup PostgreSQL'),
      comparedRunRepeats: jest.fn().mockResolvedValue(1),
    };
    const controller = new AgentsController(
      {} as AgentsService,
      evalRuns as unknown as EvalRunsService,
      {} as AgentPromptsService,
    );
    const res = { setHeader: jest.fn(), send: jest.fn() };
    await controller.evalRunDownload('job-12345678', res as never);
    expect(evalRuns.comparedRunRepeats).toHaveBeenCalledWith(run);
    const markdown = String((res.send.mock.calls[0] as [string])[0]);
    expect(markdown).toContain('Repeats: 3');
    expect(markdown).toContain('Note: the previous run used Repeats 1.');
    expect(markdown).toContain('- **Datasource:** World Cup PostgreSQL');
  });
});
