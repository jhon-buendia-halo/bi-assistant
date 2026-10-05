jest.mock('../../mastra/mastra.service', () => ({ MastraService: class {} }));

import { AgentsService, describeModel } from './agents.service';
import { loadSuite } from '../../mastra/evals/suite-loader';

describe('AgentsService.evalSets', () => {
  const service = new AgentsService({} as any);

  it('lists each case with its check descriptions, difficulty and variant count', () => {
    const set = service.evalSets('assistant').find((s) => s.id === 'world-cup');
    expect(set).toBeDefined();
    const suite = loadSuite('world-cup');
    expect(set!.cases).toHaveLength(suite.cases.length);

    const champion = set!.cases.find((c) => c.id === 'champion-2022');
    expect(champion).toMatchObject({
      category: 'control',
      difficulty: 'easy',
      variants: 2,
    });
    // Every declared check is listed, under the id the harness reports.
    const declared =
      suite.cases.find((c) => c.id === 'champion-2022')!.checks ?? [];
    expect(champion?.checks).toHaveLength(declared.length);
    const everyCheck = set!.cases.flatMap((c) =>
      c.checks.map((check) => check.id),
    );
    expect(everyCheck).toContain('check-final-sql-succeeded');
    expect(
      set!.cases
        .flatMap((c) => c.checks)
        .find((check) => check.id === 'check-final-sql-succeeded'),
    ).toMatchObject({ name: 'Final SQL Succeeded Check' });
  });

  it('offers every suite as a set, and nothing for other agents', () => {
    const ids = service.evalSets('assistant').map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['world-cup', 'banking']));
    expect(service.evalSets('visualization')).toEqual([]);
  });
});

describe('describeModel', () => {
  it('splits a router id reached through a custom url into provider and model', () => {
    expect(
      describeModel({ modelId: 'databricks/my-endpoint', provider: 'openai-compatible' }),
    ).toEqual({ id: 'my-endpoint', provider: 'databricks' });
    expect(describeModel({ modelId: 'lenai/gpt-4o', provider: '' })).toEqual({
      id: 'gpt-4o',
      provider: 'lenai',
    });
  });

  it('leaves a gateway-resolved model alone', () => {
    expect(describeModel({ modelId: 'gpt-4o-mini', provider: 'openai' })).toEqual({
      id: 'gpt-4o-mini',
      provider: 'openai',
    });
  });
});
