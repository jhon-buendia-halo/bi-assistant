jest.mock('../datasources/datasources.service', () => ({
  DatasourcesService: class {},
}));
jest.mock('../sessions/sessions.service', () => ({
  SessionsService: class {},
}));
jest.mock('../knowledge/knowledge.service', () => ({
  KnowledgeService: class {},
}));
// The runner is mocked away: this spec is about what the service does around
// a run (preflight, suite selection, telemetry), not about the agent.
jest.mock('../../mastra/evals/assistant.evals', () => ({
  selectSuiteCases: jest.fn(() => [
    { id: 'champion-2022', question: 'Who won the 2022 World Cup?' },
  ]),
  createEvalSession: jest.fn().mockResolvedValue({ id: 'session' }),
  cleanupEvalSession: jest.fn().mockResolvedValue(undefined),
  runAssistantEvalCase: jest.fn().mockResolvedValue({
    id: 'champion-2022',
    question: 'Who won the 2022 World Cup?',
    category: 'control',
    passed: true,
    checkResults: [],
    durationMs: 10,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      calls: 1,
    },
  }),
  // The real helper resolves the set from the suite files; keep the mock
  // honest by handing back the same suite the World Cup questions live in.
  suiteForCases: jest.fn(() =>
    jest
      .requireActual<typeof import('../../mastra/evals/suite-loader')>(
        '../../mastra/evals/suite-loader',
      )
      .loadSuite('world-cup'),
  ),
}));

import { mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EvalRunsService } from './eval-runs.service';
import {
  createEvalSession,
  runAssistantEvalCase,
} from '../../mastra/evals/assistant.evals';

// Run logs are written to the repo by design; point them at a throwaway
// directory so a test run never appends to the real spending history.
const logDir = mkdtempSync(join(tmpdir(), 'eval-log-'));
process.env.EVAL_LOG_DIR = logDir;

describe('EvalRunsService dataset validation', () => {
  const datasets = { list: jest.fn() };
  const repository = {
    insert: jest.fn(),
    save: jest.fn(),
    mostRecentCompleted: jest.fn(),
  };
  const knowledge = { definitionBlock: jest.fn().mockResolvedValue('') };
  const service = () =>
    new EvalRunsService(
      datasets as any,
      repository as any,
      {} as any,
      {} as any,
      knowledge as any,
    );

  beforeEach(() => jest.clearAllMocks());

  it('rejects the reported F1 selection before persisting a run or calling a model', async () => {
    datasets.list.mockResolvedValue([
      {
        name: 'Nick F1 Data source',
        datasourceId: 'f1',
        datasourceKind: 'postgres',
        tables: ['formula1.formula1.race'],
      },
      {
        name: 'F1 Test',
        datasourceId: 'f1',
        datasourceKind: 'postgres',
        tables: ['formula1.formula1.driver'],
      },
    ]);
    const result = await service().start('assistant', 'f1');
    expect(result).toEqual({
      error: expect.stringContaining('bundled World Cup sample'),
    });
    expect(repository.insert).not.toHaveBeenCalled();
    expect(createEvalSession).not.toHaveBeenCalled();
    expect(runAssistantEvalCase).not.toHaveBeenCalled();
  });

  it('still starts and completes a run with the fixture scope', async () => {
    datasets.list.mockResolvedValue([
      {
        name: 'Sample',
        datasourceId: 'wc',
        datasourceKind: 'postgres',
        tables: [
          'tournaments',
          'teams',
          'matches',
          'venues',
          'players',
          'goals',
          'match_team_statistics',
          'v_match_results',
          'v_player_goal_totals',
        ].map((table) => `world_cup.world_cup.${table}`),
      },
    ]);
    const runner = service();
    const result = await runner.start('assistant', 'wc');
    expect(result).toEqual({ jobId: expect.any(String) });
    await new Promise((resolve) => setImmediate(resolve));
    expect(runAssistantEvalCase).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'champion-2022' }),
      ['Sample'],
      'session',
      '',
      expect.objectContaining({ id: 'world-cup' }),
    );
    if (!('jobId' in result)) throw new Error('Run did not start');
    const view = await runner.status(result.jobId);
    expect(view?.status).toBe('completed');
    expect(view?.suiteId).toBe('world-cup');
    expect(view?.suiteName).toBe('World Cup');
    // The suite is part of the baseline's identity: a health-insurance run
    // must never be compared against a World Cup one.
    expect(repository.mostRecentCompleted).toHaveBeenCalledWith(
      'assistant',
      result.jobId,
      'wc',
      ['Sample'],
      'world-cup',
    );
  });

  // Regression: the run used to be scoped to every dataset on the datasource.
  // After `fixtures:register` that is all three fixtures at once, so a genomics
  // run saw World Cup tables — extra schema for the model to wade through, and
  // an out-of-scope question quietly becoming answerable.
  it('scopes the run to the suite\'s own datasets when the datasource has them', async () => {
    const worldCupTables = [
      'tournaments',
      'teams',
      'matches',
      'venues',
      'players',
      'goals',
      'match_team_statistics',
      'v_match_results',
      'v_player_goal_totals',
    ].map((table) => `world_cup.world_cup.${table}`);
    datasets.list.mockResolvedValue([
      {
        name: 'World Cup',
        datasourceId: 'fixtures',
        datasourceKind: 'postgres',
        tables: worldCupTables,
      },
      {
        name: 'Genomics',
        datasourceId: 'fixtures',
        datasourceKind: 'postgres',
        tables: ['world_cup.genomics.variants'],
      },
      {
        name: 'Health Insurance',
        datasourceId: 'fixtures',
        datasourceKind: 'postgres',
        tables: ['world_cup.health_insurance.claims'],
      },
    ]);
    const runner = service();
    const result = await runner.start('assistant', 'fixtures');
    expect(result).toEqual({ jobId: expect.any(String) });
    await new Promise((resolve) => setImmediate(resolve));
    expect(runAssistantEvalCase).toHaveBeenCalledWith(
      expect.anything(),
      ['World Cup'],
      'session',
      '',
      expect.objectContaining({ id: 'world-cup' }),
    );
    if (!('jobId' in result)) throw new Error('Run did not start');
    expect((await runner.status(result.jobId))?.datasets).toEqual(['World Cup']);
  });

  describe('explicit dataset scope', () => {
    const worldCupTables = [
      'tournaments',
      'teams',
      'matches',
      'venues',
      'players',
      'goals',
      'match_team_statistics',
      'v_match_results',
      'v_player_goal_totals',
    ].map((table) => `world_cup.world_cup.${table}`);
    beforeEach(() =>
      datasets.list.mockResolvedValue([
        {
          name: 'World Cup',
          datasourceId: 'fixtures',
          datasourceKind: 'postgres',
          tables: ['world_cup.world_cup.matches'],
        },
        {
          name: 'My World Cup',
          datasourceId: 'fixtures',
          datasourceKind: 'postgres',
          tables: worldCupTables,
        },
      ]),
    );

    it('runs against the datasets the caller names, not the set default', async () => {
      const runner = service();
      const result = await runner.start(
        'assistant',
        'fixtures',
        undefined,
        undefined,
        ['My World Cup'],
      );
      expect(result).toEqual({ jobId: expect.any(String) });
      if (!('jobId' in result)) throw new Error('Run did not start');
      expect((await runner.status(result.jobId))?.datasets).toEqual([
        'My World Cup',
      ]);
    });

    it('rejects a dataset name the datasource does not have', async () => {
      expect(
        await service().start('assistant', 'fixtures', undefined, undefined, [
          'Nope',
        ]),
      ).toEqual({ error: 'That datasource has no dataset named Nope' });
      expect(repository.insert).not.toHaveBeenCalled();
    });
  });

  it('rejects an unknown suite before touching the datasets', async () => {
    datasets.list.mockResolvedValue([]);
    expect(await service().start('assistant', 'wc', undefined, 'nope')).toEqual(
      { error: expect.stringContaining('Unknown eval suite "nope"') },
    );
    expect(datasets.list).not.toHaveBeenCalled();
  });

  it('tallies tokens and categories, and writes a run log', async () => {
    datasets.list.mockResolvedValue([
      {
        name: 'Sample',
        datasourceId: 'wc',
        datasourceKind: 'postgres',
        tables: [
          'tournaments',
          'teams',
          'matches',
          'venues',
          'players',
          'goals',
          'match_team_statistics',
          'v_match_results',
          'v_player_goal_totals',
        ].map((table) => `world_cup.world_cup.${table}`),
      },
    ]);
    const runner = service();
    const result = await runner.start('assistant', 'wc');
    if (!('jobId' in result)) throw new Error('Run did not start');
    await new Promise((resolve) => setImmediate(resolve));

    const view = await runner.status(result.jobId);
    expect(view?.usage).toMatchObject({ totalTokens: 120, calls: 1 });
    expect(view?.categories).toEqual({ control: { total: 1, passed: 1 } });
    // No rate is configured for the test model, so cost stays unknown rather
    // than being reported as zero.
    expect(view?.estimatedCostUsd).toBeUndefined();
    expect(view?.model).toBeTruthy();

    const written = readdirSync(join(logDir, 'evals'));
    expect(written.some((file) => file.endsWith('.json'))).toBe(true);
    expect(written).toContain('index.ndjson');
  });
});
