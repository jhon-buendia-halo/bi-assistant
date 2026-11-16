import type { SyntheticValue } from '../dialects/writer';
import type { GeneratedTable } from './contract';
import { generateTables, valueKey } from './generate';
import { validateScriptRequest } from './plan';
import { worldCupProfile } from './world-cup-profile.stub';

const WC = 'world_cup.public.';

function run(
  request: Record<string, unknown> = {},
  p = worldCupProfile(),
): Map<string, GeneratedTable> {
  const plan = validateScriptRequest(p, request);
  return new Map([...generateTables(p, plan)].map((t) => [t.key, t]));
}

const columnOf = (t: GeneratedTable, name: string): SyntheticValue[] => {
  const j = t.columns.findIndex((c) => c.name === name);
  return t.rows.map((r) => r[j]);
};

describe('generateTables on a World Cup-like profile (run it first)', () => {
  it('generates every table with the requested row counts', () => {
    const tables = run({ defaultRowCount: 50 });
    const counts = Object.fromEntries(
      [...tables.values()].map((t) => [t.key.slice(WC.length), t.rows.length]),
    );
    // Printed on purpose: the first proof the generator runs end to end.
    console.log('World Cup synthetic row counts', counts);
    expect(counts).toEqual({
      confederations: 50,
      countries: 50,
      teams: 50,
      tournaments: 50,
      tournament_teams: 50,
      players: 50,
      squad_members: 50,
      matches: 50,
      goals: 50,
    });
  });

  it('draws every FK value from the parent keys', () => {
    const tables = run({ defaultRowCount: 50 });
    const keysOf = (table: string, col = 'id'): Set<string> =>
      new Set(columnOf(tables.get(WC + table)!, col).map(valueKey));
    const check = (
      table: string,
      col: string,
      parent: string,
      parentCol = 'id',
    ): void => {
      const parentKeys = keysOf(parent, parentCol);
      for (const v of columnOf(tables.get(WC + table)!, col)) {
        if (v !== null) expect(parentKeys.has(valueKey(v))).toBe(true);
      }
    };
    check('countries', 'confederation_code', 'confederations', 'code');
    check('teams', 'country_code', 'countries', 'code');
    check('matches', 'home_team_id', 'teams');
    check('goals', 'match_id', 'matches');
    check('squad_members', 'player_id', 'players');
  });
});
