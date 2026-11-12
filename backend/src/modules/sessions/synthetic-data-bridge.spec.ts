import { BadRequestException } from '@nestjs/common';
import {
  column,
  idCol,
  profile,
  rel,
  table,
} from '../synthetic-data/generator/world-cup-profile.stub';
import type { SampledProfile } from '../synthetic-data/types';
import {
  SyntheticDataBridge,
  resolveTables,
  syntheticPanelItemId,
  type SyntheticDataBridgeDeps,
} from './synthetic-data-bridge';

const KEYS = [
  'world_cup.public.teams',
  'world_cup.public.players',
  'world_cup.public.matches',
];

const DATASETS = [
  {
    name: 'World Cup',
    datasourceId: 'ds-pg',
    datasourceKind: 'postgres' as const,
    tables: KEYS,
  },
  {
    name: 'Sales',
    datasourceId: 'ds-dbx',
    datasourceKind: 'databricks' as const,
    tables: ['main.sales.orders'],
  },
  {
    name: 'Orders API',
    datasourceId: 'ds-rest',
    datasourceKind: 'rest' as const,
    tables: ['api.orders.orders'],
  },
];

function worldCup(): SampledProfile {
  return profile(
    [
      table('teams', [idCol(), column('name', 'text')]),
      table('players', [
        idCol(),
        column('team_id', 'bigint', { strategy: 'foreign-key' }),
        column('photo', 'bytea', {
          strategy: 'null-only',
          note: 'Type not synthesized: generated as NULL',
        }),
      ]),
      table('matches', [idCol()]),
    ],
    [rel('players', ['team_id'], 'teams')],
  );
}

function build(sessionDatasets: string[] = ['World Cup']) {
  const profiled = worldCup();
  const synthetic = {
    profile: jest.fn().mockResolvedValue(profiled),
    getProfile: jest.fn().mockReturnValue(undefined),
    scriptText: jest.fn(
      (p: SampledProfile, r: { defaultRowCount?: number; seed?: number }) => ({
        fileName: 'world-cup-synthetic-postgresql-seed1.sql',
        text: '-- Synthetic data for dataset "World Cup"\n',
        bytes: 42,
        sha256: 'abc',
        plan: {
          seed: r.seed ?? 1,
          targetSchema: 'synthetic',
          includeConstraints: true,
          format: 'sql' as const,
          tables: p.tables.map((t) => ({
            key: t.key,
            targetName: t.name,
            rows: r.defaultRowCount ?? 100,
          })),
          relationships: [],
          droppedRelationships: p.relationships.filter(
            (x) => !p.tables.some((t) => t.key === x.toTable),
          ),
        },
      }),
    ),
  };
  const writeFile = jest.fn().mockResolvedValue(undefined);
  const showFile = jest.fn().mockResolvedValue({ id: 'item-1' });
  const deps: SyntheticDataBridgeDeps = {
    sessionDatasetNames: jest.fn().mockResolvedValue(sessionDatasets),
    datasets: jest.fn((names: string[]) =>
      Promise.resolve(DATASETS.filter((d) => names.includes(d.name))),
    ),
    synthetic,
    writeFile,
    showFile,
  };
  return {
    bridge: new SyntheticDataBridge(deps),
    synthetic,
    writeFile,
    showFile,
    profiled,
  };
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => 'resolved',
    (e: Error) => e.message,
  );

describe('SyntheticDataBridge: dataset resolution (agents.md 3.13, 3.14)', () => {
  it('uses the only dataset when none is named', async () => {
    const ctx = build();
    await ctx.bridge.profileSample({ sessionId: 's-1' });
    expect(ctx.synthetic.profile).toHaveBeenCalledWith(
      { datasetName: 'World Cup', tables: KEYS },
      { signal: undefined },
    );
  });

  it('asks for a name when the session has several, and refuses one outside it', async () => {
    const ctx = build(['World Cup', 'Sales']);
    expect(await failure(ctx.bridge.profileSample({ sessionId: 's-1' }))).toBe(
      'This session has several datasets: World Cup, Sales. Name the one to assess.',
    );
    expect(
      await failure(
        ctx.bridge.generateScript({ sessionId: 's-1', datasetName: 'Ops' }),
      ),
    ).toBe(
      'Dataset "Ops" is not in this session. Choose one of: World Cup, Sales.',
    );
  });

  it('refuses a dataset that is not PostgreSQL or Databricks', async () => {
    const ctx = build(['Orders API']);
    expect(await failure(ctx.bridge.profileSample({ sessionId: 's-1' }))).toBe(
      'Synthetic data supports PostgreSQL and Databricks datasets only',
    );
  });
});

describe('resolveTables (scalar tables, chat limit)', () => {
  const dataset = { name: 'World Cup', tables: KEYS };

  it('takes entity keys or bare names, in dataset order', () => {
    expect(
      resolveTables(dataset, ['matches', 'WORLD_CUP.PUBLIC.TEAMS']),
    ).toEqual(['world_cup.public.teams', 'world_cup.public.matches']);
    expect(resolveTables(dataset, undefined)).toEqual(KEYS);
  });

  it('refuses a name that is not a table of the dataset', () => {
    expect(() => resolveTables(dataset, ['venues'])).toThrow(
      '"venues" is not a table of dataset "World Cup"',
    );
  });

  it('refuses more than 20 tables, named or not', () => {
    const many = {
      name: 'Big',
      tables: Array.from({ length: 21 }, (_, i) => `db.s.t${i}`),
    };
    const text =
      'Choose at most 20 tables in chat; use Profile & synthesize on the dataset for more';
    expect(() => resolveTables(many, undefined)).toThrow(text);
    expect(() => resolveTables(many, many.tables)).toThrow(text);
    expect(resolveTables(many, many.tables.slice(0, 20))).toHaveLength(20);
  });
});

describe('SyntheticDataBridge.generateScript', () => {
  it('profiles, saves the script under synthetic-data/ and stores its file panel item', async () => {
    const ctx = build();
    const result = await ctx.bridge.generateScript({
      sessionId: 's-1',
      rowsPerTable: 50,
    });

    expect(ctx.synthetic.scriptText).toHaveBeenCalledWith(ctx.profiled, {
      defaultRowCount: 50,
    });
    const path = 'synthetic-data/world-cup-synthetic-postgresql-seed1.sql';
    expect(ctx.writeFile).toHaveBeenCalledWith(
      's-1',
      path,
      '-- Synthetic data for dataset "World Cup"\n',
    );
    expect(ctx.showFile).toHaveBeenCalledWith(
      's-1',
      path,
      'Synthetic data — World Cup (seed 1)',
    );
    expect(result).toEqual({
      fileName: 'world-cup-synthetic-postgresql-seed1.sql',
      path,
      panelItemId: 'item-1',
      dialect: 'postgres',
      seed: 1,
      targetSchema: 'synthetic',
      bytes: 42,
      tables: KEYS.map((table) => ({ table, rows: 50 })),
      droppedRelationships: [],
      notSynthesized: [
        {
          table: 'world_cup.public.players',
          column: 'photo',
          reason: 'Type not synthesized: generated as NULL',
        },
      ],
    });
    expect(syntheticPanelItemId(result)).toBe('item-1');
    expect(syntheticPanelItemId({ error: 'x' })).toBeUndefined();
  });

  it.each([0, 1001, 2.5, Number.NaN])(
    'refuses rowsPerTable %p with the chat text, before profiling',
    async (rows) => {
      const ctx = build();
      expect(
        await failure(
          ctx.bridge.generateScript({ sessionId: 's-1', rowsPerTable: rows }),
        ),
      ).toBe('rowsPerTable must be a whole number from 1 to 1,000 in chat');
      expect(ctx.synthetic.profile).not.toHaveBeenCalled();
    },
  );

  it('passes the 256 KB refusal on as the model sees it, and saves nothing', async () => {
    const ctx = build();
    const text =
      'The script would be 300 KB; the chat limit is 256 KB. Ask for fewer rows or use Profile & synthesize on the dataset.';
    ctx.synthetic.scriptText.mockImplementation(() => {
      throw new BadRequestException(text);
    });
    expect(await failure(ctx.bridge.generateScript({ sessionId: 's-1' }))).toBe(
      text,
    );
    expect(ctx.writeFile).not.toHaveBeenCalled();
    expect(ctx.showFile).not.toHaveBeenCalled();
  });

  it('reuses a cached profile, cut to the named tables', async () => {
    const ctx = build();
    ctx.synthetic.getProfile.mockReturnValue(ctx.profiled);
    const result = await ctx.bridge.generateScript({
      sessionId: 's-1',
      profileId: 'p-1',
      tables: ['players'],
      seed: 4,
    });
    expect(ctx.synthetic.profile).not.toHaveBeenCalled();
    const used = ctx.synthetic.scriptText.mock.calls[0][0];
    expect(used.tables.map((t) => t.name)).toEqual(['players']);
    expect(result.droppedRelationships).toEqual([
      {
        from: 'world_cup.public.players(team_id)',
        to: 'world_cup.public.teams(id)',
      },
    ]);
    expect(result.seed).toBe(4);
  });

  it('refuses an expired profile, or one of another dataset', async () => {
    const ctx = build();
    const text = 'Profile "p-9" expired or not found: profile the tables again';
    expect(
      await failure(
        ctx.bridge.generateScript({ sessionId: 's-1', profileId: 'p-9' }),
      ),
    ).toBe(text);
    ctx.synthetic.getProfile.mockReturnValue({
      ...ctx.profiled,
      datasetName: 'Sales',
    });
    expect(
      await failure(
        ctx.bridge.generateScript({ sessionId: 's-1', profileId: 'p-9' }),
      ),
    ).toBe(text);
  });
});
