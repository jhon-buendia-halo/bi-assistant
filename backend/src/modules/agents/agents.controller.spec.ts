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
