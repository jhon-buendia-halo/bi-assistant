import { RequestContext } from '@mastra/core/request-context';
import {
  column,
  idCol,
  profile,
  rel,
  table,
} from '../../modules/synthetic-data/generator/world-cup-profile.stub';
import {
  setSyntheticDataToolServices,
  type SyntheticScriptResult,
} from '../synthetic-data-tool-services';
import { readinessTools } from './readiness.tools';
import {
  PROJECTION_COLUMNS_MAX,
  generateSyntheticDataTool,
  parseTableList,
  profileDataSampleTool,
  sampleProfileProjection,
} from './synthetic-data.tools';

type Execute = (
  input: Record<string, unknown>,
  context: { requestContext: RequestContext; abortSignal?: AbortSignal },
) => Promise<unknown>;

function contextWith(sessionId: string | null = 's-1'): RequestContext {
  const context = new RequestContext();
  if (sessionId !== null) context.set('session-id', sessionId);
  return context;
}

const RESULT: SyntheticScriptResult = {
  fileName: 'world-cup-synthetic-postgresql-seed1.sql',
  path: 'synthetic-data/world-cup-synthetic-postgresql-seed1.sql',
  panelItemId: 'item-1',
  dialect: 'postgres',
  seed: 1,
  targetSchema: 'synthetic',
  bytes: 1234,
  tables: [{ table: 'world_cup.public.teams', rows: 50 }],
  droppedRelationships: [],
  notSynthesized: [],
};

let profileSample: jest.Mock;
let generateScript: jest.Mock;

beforeEach(() => {
  profileSample = jest.fn();
  generateScript = jest.fn().mockResolvedValue(RESULT);
  setSyntheticDataToolServices({
    profileSample: (input) =>
      profileSample(input) as ReturnType<
        Parameters<typeof setSyntheticDataToolServices>[0]['profileSample']
      >,
    generateScript: (input) =>
      generateScript(input) as Promise<SyntheticScriptResult>,
  });
});

describe('the synthetic-data tools (agents.md 3.14)', () => {
  it('come after the readiness tools and before describe_entity, in the Data Readiness Agent', () => {
    expect(Object.keys(readinessTools)).toEqual([
      'assess_data_readiness',
      'get_readiness_report',
      'list_readiness_reports',
      'profile_data_sample',
      'generate_synthetic_data',
      'describe_entity',
      'run_readonly_sql',
      'show_in_panel',
      'ask_clarification',
    ]);
    expect(readinessTools.profile_data_sample).toBe(profileDataSampleTool);
    expect(readinessTools.generate_synthetic_data).toBe(
      generateSyntheticDataTool,
    );
  });

  it('take scalar inputs only, each described', () => {
    for (const tool of [profileDataSampleTool, generateSyntheticDataTool]) {
      const shape = (
        tool.inputSchema as unknown as {
          shape: Record<string, { description?: string; _def: unknown }>;
        }
      ).shape;
      for (const [name, field] of Object.entries(shape)) {
        expect([name, field.description]).toEqual([name, expect.any(String)]);
        const json = JSON.stringify(field._def);
        expect(json).not.toContain('"array"');
        expect(json).not.toContain('"object"');
      }
    }
  });
});

describe('parseTableList (scalar tables)', () => {
  it('reads keys or bare names one per line, ignoring blanks and repeats', () => {
    expect(
      parseTableList(
        'world_cup.public.players\n\n  teams  \r\nplayers\nteams\n',
      ),
    ).toEqual(['world_cup.public.players', 'teams', 'players']);
  });

  it('is undefined when blank, so every table is used', () => {
    expect(parseTableList(undefined)).toBeUndefined();
    expect(parseTableList('  \n \n')).toBeUndefined();
  });
});

describe('sampleProfileProjection (the model-facing profile)', () => {
  const wide = table(
    'wide',
    Array.from({ length: 45 }, (_, i) =>
      i === 0 ? idCol() : column(`c${i}`, 'text'),
    ),
  );
  const players = table('players', [
    idCol(),
    column('position', 'text', {
      kind: 'categorical',
      strategy: 'categorical',
      nullFraction: 0.0525,
      distinctCount: 7,
      topValues: Array.from({ length: 7 }, (_, i) => ({
        value: `P${i}`,
        fraction: 0.1,
      })),
      patterns: [{ shape: 'A{2}', fraction: 1 }],
    }),
    column('height', 'numeric', {
      kind: 'numeric',
      strategy: 'numeric-range',
      numeric: {
        min: 160,
        max: 203,
        mean: 182,
        quantiles: [],
        integer: true,
        scale: 0,
      },
    }),
  ]);
  const projected = sampleProfileProjection(
    profile([wide, players], [rel('players', ['team_id'], 'wide')]),
  );

  it('caps each table at 40 columns and counts the rest', () => {
    expect(PROJECTION_COLUMNS_MAX).toBe(40);
    expect(projected.tables[0].columns).toHaveLength(40);
    expect(projected.tables[0].columnsOmitted).toBe(5);
    expect(projected.tables[1].columns).toHaveLength(3);
    expect(projected.tables[1]).not.toHaveProperty('columnsOmitted');
  });

  it('keeps the profile id, expiry and table facts; null rates as percentages, at most five values', () => {
    expect(projected).toMatchObject({
      profileId: '00000000-0000-4000-8000-000000000001',
      datasetName: 'World Cup',
      dialect: 'postgres',
      expiresAt: '2026-11-11T11:00:00.000Z',
      relationships: [
        {
          from: 'world_cup.public.players(team_id)',
          to: 'world_cup.public.wide(id)',
          origin: 'declared',
        },
      ],
    });
    expect(projected.tables[1]).toMatchObject({
      table: 'world_cup.public.players',
      method: 'full',
      sampledRows: 100,
      rowCountEstimate: 100,
    });
    const [, position, height] = projected.tables[1].columns;
    expect(position).toEqual({
      name: 'position',
      type: 'text',
      nullPct: 5.3,
      distinct: 7,
      kind: 'categorical',
      generatedAs: 'categorical',
      topValues: Array.from({ length: 5 }, (_, i) => ({
        value: `P${i}`,
        pct: 10,
      })),
      pattern: 'A{2}',
    });
    expect(height.range).toEqual({ min: 160, max: 203 });
    expect(JSON.stringify(projected)).not.toContain('quantiles');
  });
});

describe('profile_data_sample', () => {
  const run = (input: Record<string, unknown>, context = contextWith()) =>
    (profileDataSampleTool.execute as unknown as Execute)(input, {
      requestContext: context,
    });

  it('passes the dataset and parsed tables to the bridge and returns the projection', async () => {
    const sampled = profile([table('teams', [idCol()])], []);
    profileSample.mockResolvedValue(sampled);
    await expect(
      run({ dataset: ' World Cup ', tables: 'teams\n\nplayers' }),
    ).resolves.toEqual(sampleProfileProjection(sampled));
    expect(profileSample).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's-1',
        datasetName: 'World Cup',
        tables: ['teams', 'players'],
      }),
    );
  });

  it('turns a bridge failure into { error } and needs a session', async () => {
    profileSample.mockRejectedValue(
      new Error(
        'Synthetic data supports PostgreSQL and Databricks datasets only',
      ),
    );
    await expect(run({})).resolves.toEqual({
      error: 'Synthetic data supports PostgreSQL and Databricks datasets only',
    });
    await expect(run({}, contextWith(null))).resolves.toEqual({
      error: 'No session in context',
    });
  });
});

describe('generate_synthetic_data', () => {
  const run = (input: Record<string, unknown>) =>
    (generateSyntheticDataTool.execute as unknown as Execute)(input, {
      requestContext: contextWith(),
    });

  it('passes every input to the bridge and returns its result as the model sees it', async () => {
    await expect(
      run({
        dataset: 'World Cup',
        tables: 'teams',
        rowsPerTable: 50,
        seed: 3,
        targetSchema: ' synth ',
        profileId: '  ',
      }),
    ).resolves.toEqual(RESULT);
    expect(generateScript).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's-1',
        datasetName: 'World Cup',
        tables: ['teams'],
        rowsPerTable: 50,
        seed: 3,
        targetSchema: 'synth',
        profileId: undefined,
      }),
    );
  });

  it('returns a limit refusal as { error }', async () => {
    generateScript.mockRejectedValue(
      new Error('rowsPerTable must be a whole number from 1 to 1,000 in chat'),
    );
    await expect(run({ rowsPerTable: 5000 })).resolves.toEqual({
      error: 'rowsPerTable must be a whole number from 1 to 1,000 in chat',
    });
  });
});
