import { VISUAL_RUNTIME_SCRIPT, toNumber } from './visual-runtime';
import {
  US_MAP_RUNTIME_MEMBERS,
  usMapFold,
  usMapStep,
  usStateCode,
  usStateTiles,
} from './visual-runtime-map';

beforeAll(() => {
  // The pure helpers call `toNumber` as an embedded global, as in the browser.
  Object.assign(globalThis, { toNumber, usStateCode });
});

const TOP = [
  ['FL', 262],
  ['TX', 202],
  ['GA', 192],
  ['CA', 162],
  ['AZ', 89],
  ['NY', 88],
  ['IN', 77],
  ['HI', 61],
  ['IL', 57],
  ['NJ', 49],
  ['PR', 5],
  ['DC', 2],
  ['ME', 2],
  ['SD', 1],
];

function fixtureRows(): Record<string, unknown>[] {
  return TOP.map(([state, employees]) => ({ state, employees }));
}

describe('usStateTiles', () => {
  const tiles = usStateTiles();

  it('has 52 tiles with unique codes and unique cells', () => {
    expect(tiles).toHaveLength(52);
    expect(new Set(tiles.map((t) => t.code)).size).toBe(52);
    expect(new Set(tiles.map((t) => `${t.col},${t.row}`)).size).toBe(52);
  });

  it('keeps every tile inside the 12 by 8 grid', () => {
    for (const tile of tiles) {
      expect(tile.col).toBeGreaterThanOrEqual(0);
      expect(tile.col).toBeLessThanOrEqual(11);
      expect(tile.row).toBeGreaterThanOrEqual(0);
      expect(tile.row).toBeLessThanOrEqual(7);
    }
  });

  it('includes DC and PR', () => {
    const codes = tiles.map((t) => t.code);
    expect(codes).toEqual(expect.arrayContaining(['DC', 'PR']));
  });
});

describe('usStateCode', () => {
  it('reads codes in any case, with spaces', () => {
    expect(usStateCode('FL')).toBe('FL');
    expect(usStateCode('fl')).toBe('FL');
    expect(usStateCode('  tx ')).toBe('TX');
  });

  it('reads full names in any case', () => {
    expect(usStateCode('Florida')).toBe('FL');
    expect(usStateCode('NEW york')).toBe('NY');
    expect(usStateCode('district of columbia')).toBe('DC');
  });

  it('reads the District of Columbia spellings', () => {
    expect(usStateCode('Washington DC')).toBe('DC');
    expect(usStateCode('Washington, D.C.')).toBe('DC');
    expect(usStateCode('Washington')).toBe('WA');
  });

  it('returns null for blank, null and non-states', () => {
    expect(usStateCode('')).toBeNull();
    expect(usStateCode('   ')).toBeNull();
    expect(usStateCode(null)).toBeNull();
    expect(usStateCode(undefined)).toBeNull();
    expect(usStateCode('Ontario')).toBeNull();
    expect(usStateCode('XX')).toBeNull();
  });
});

describe('usMapFold', () => {
  it('folds the fixture into tiles, min and max', () => {
    const folded = usMapFold(fixtureRows(), 'state', 'employees');
    expect(Object.keys(folded.byCode)).toHaveLength(TOP.length);
    expect(folded.byCode.FL.value).toBe(262);
    expect(folded.min).toBe(1);
    expect(folded.max).toBe(262);
    expect(folded.unmatched).toEqual([]);
  });

  it('sums several rows of the same state, across spellings', () => {
    const folded = usMapFold(
      [
        { s: 'FL', v: 10 },
        { s: 'florida', v: 5 },
        { s: 'TX', v: 1 },
      ],
      's',
      'v',
    );
    expect(folded.byCode.FL.value).toBe(15);
    expect(folded.byCode.FL.raw).toBe('FL');
    expect(folded.max).toBe(15);
  });

  it('reads numbers that arrive as strings', () => {
    const folded = usMapFold(
      [
        { s: 'FL', v: '12.5' },
        { s: 'TX', v: '3' },
      ],
      's',
      'v',
    );
    expect(folded.byCode.FL.value).toBe(12.5);
    expect(folded.min).toBe(3);
  });

  it('keeps aside rows that name no tile, summed by name', () => {
    const folded = usMapFold(
      [
        { s: 'FL', v: 1 },
        { s: 'Ontario', v: 4 },
        { s: 'Ontario', v: 6 },
        { s: null, v: 2 },
      ],
      's',
      'v',
    );
    expect(folded.unmatched).toEqual([
      { name: 'Ontario', value: 10 },
      { name: '(blank)', value: 2 },
    ]);
    expect(Object.keys(folded.byCode)).toEqual(['FL']);
  });

  it('gives a single state equal min and max', () => {
    const folded = usMapFold([{ s: 'ME', v: 7 }], 's', 'v');
    expect(folded.min).toBe(7);
    expect(folded.max).toBe(7);
  });

  it('has no min and max when nothing matched', () => {
    const folded = usMapFold([{ s: 'Ontario', v: 7 }], 's', 'v');
    expect(Object.keys(folded.byCode)).toHaveLength(0);
    expect(folded.min).toBeNull();
    expect(folded.max).toBeNull();
  });
});

describe('usMapStep', () => {
  it('puts the smallest in step 0 and the largest in step 4', () => {
    expect(usMapStep(0, 0, 100)).toBe(0);
    expect(usMapStep(100, 0, 100)).toBe(4);
  });

  it('cuts the range into five equal bands', () => {
    expect(usMapStep(19.9, 0, 100)).toBe(0);
    expect(usMapStep(20, 0, 100)).toBe(1);
    expect(usMapStep(40, 0, 100)).toBe(2);
    expect(usMapStep(60, 0, 100)).toBe(3);
    expect(usMapStep(79.9, 0, 100)).toBe(3);
    expect(usMapStep(80, 0, 100)).toBe(4);
  });

  it('gives the top step when every value is equal', () => {
    expect(usMapStep(5, 5, 5)).toBe(4);
  });
});

describe('the assembled script', () => {
  it('parses', () => {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- parsing the script is the test
    expect(() => new Function(VISUAL_RUNTIME_SCRIPT)).not.toThrow();
  });

  it('embeds every member of the map file', () => {
    for (const member of US_MAP_RUNTIME_MEMBERS) {
      const name = /function\s+([A-Za-z0-9_$]+)/.exec(member.toString());
      expect(name).not.toBeNull();
      expect(VISUAL_RUNTIME_SCRIPT).toContain(`function ${name![1]}(`);
    }
  });
});
