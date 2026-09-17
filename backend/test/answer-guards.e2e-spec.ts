/**
 * Live-database proof that the answer-quality guards fire on real data.
 *
 * Unit fixtures can be authored to trip any heuristic; what they cannot show is
 * that the guards stay quiet on a correct answer over a real warehouse, or that
 * the faults they hunt — a rate pinned at 1, a group key blank on most rows —
 * occur naturally in data nobody wrote for the test. Every SQL statement below
 * was verified against the World Cup fixture, and the expectations name the
 * figures it returns, so a fixture change breaks the spec instead of silently
 * rewriting the ground truth.
 *
 * Runs only under `test:e2e`; without the docker fixture the suite skips so CI
 * stays green.
 */

import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { WORLD_CUP_CONNECTION, worldCupPool, runSql } from './world-cup';
import {
  inspectResult,
  type DataWarning,
} from '../src/modules/projects/result-guards';
import { compareResults } from '../src/modules/projects/result-compare';

/**
 * `describe.skip` is decided while jest collects the file, long before any
 * async hook could await `worldCupReachable()`, so the probe runs in a child
 * process — same connection settings, same query, just synchronous. Gating in
 * `beforeAll` instead would report a docker-less run as a suite of passing
 * tests, which is worse than a visible skip.
 */
function fixtureIsUp(): boolean {
  const probe = `
    const { Pool } = require(${JSON.stringify(require.resolve('pg'))});
    const pool = new Pool({ ...${JSON.stringify(WORLD_CUP_CONNECTION)}, max: 1, connectionTimeoutMillis: 3000 });
    pool.query('SELECT 1')
      .then(() => pool.end())
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  `;
  try {
    execFileSync(process.execPath, ['-e', probe], {
      stdio: 'ignore',
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

const describeLive = fixtureIsUp() ? describe : describe.skip;

/* The statements under test. Verified against the fixture — do not reword. */

/** Two genuinely different measures: completions over attempts. */
const PASS_ACCURACY_SQL = `
SELECT t.common_name, SUM(s.passes_completed)::numeric / SUM(s.passes_attempted) AS pass_accuracy
FROM world_cup.match_team_statistics s JOIN world_cup.teams t ON t.id = s.team_id
GROUP BY t.common_name ORDER BY pass_accuracy DESC, t.common_name
`;

/** The production defect, ported to this schema: one measure aliased twice. */
const DEGENERATE_PASS_ACCURACY_SQL = `
SELECT t.common_name,
  SUM(s.passes_completed) AS completed,
  SUM(s.passes_completed) AS attempted,
  SUM(s.passes_completed)::numeric / SUM(s.passes_completed) AS pass_accuracy
FROM world_cup.match_team_statistics s JOIN world_cup.teams t ON t.id = s.team_id
GROUP BY t.common_name
`;

/** Same figures as PASS_ACCURACY_SQL plus the numerator and denominator. */
const WIDE_PASS_ACCURACY_SQL = `
SELECT t.common_name,
  SUM(s.passes_completed) AS completed,
  SUM(s.passes_attempted) AS attempted,
  SUM(s.passes_completed)::numeric / SUM(s.passes_attempted) AS pass_accuracy
FROM world_cup.match_team_statistics s JOIN world_cup.teams t ON t.id = s.team_id
GROUP BY t.common_name
`;

/** Every card in the fixture is a yellow, so the share cannot vary. */
const YELLOW_SHARE_SQL = `
SELECT t.common_name, COUNT(*) FILTER (WHERE d.card_type = 'yellow')::numeric / COUNT(*) AS yellow_share
FROM world_cup.disciplinary_events d JOIN world_cup.teams t ON t.id = d.team_id
GROUP BY t.common_name ORDER BY t.common_name
`;

/** Assists are recorded on 2 of 47 goals; the rest group under a blank name. */
const ASSISTS_SQL = `
SELECT p.full_name AS assisting_player, COUNT(*) AS goals
FROM world_cup.goals g LEFT JOIN world_cup.players p ON p.id = g.assist_player_id
GROUP BY p.full_name ORDER BY goals DESC
`;

const UNORDERED_TOP_SCORERS_SQL = `
SELECT t.common_name, COUNT(*) AS goals
FROM world_cup.goals g JOIN world_cup.teams t ON t.id = g.scoring_team_id
GROUP BY t.common_name LIMIT 3
`;

const RANKED_TOP_SCORERS_SQL = `
SELECT t.common_name, COUNT(*) AS goals
FROM world_cup.goals g JOIN world_cup.teams t ON t.id = g.scoring_team_id
GROUP BY t.common_name ORDER BY goals DESC, t.common_name LIMIT 5
`;

const ALL_TEAM_GOALS_SQL = `
SELECT t.common_name, COUNT(*) AS goals
FROM world_cup.goals g JOIN world_cup.teams t ON t.id = g.scoring_team_id
GROUP BY t.common_name ORDER BY goals DESC, t.common_name
`;

const codesOf = (warnings: DataWarning[]): string[] =>
  warnings.map((warning) => warning.code).sort();

const messageOf = (warnings: DataWarning[], code: string): string =>
  warnings.find((warning) => warning.code === code)?.message ?? '';

const num = (value: unknown): number => Number(value);

describeLive('answer-quality guards on live World Cup data', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = worldCupPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * The load-bearing negative case. These guards run on every answer, so a
   * false positive here would attach a warning to correct work and train the
   * reader to ignore all of them.
   */
  it('stays silent on a healthy ratio of two different measures', async () => {
    const rows = await runSql(pool, PASS_ACCURACY_SQL);

    expect(rows).toHaveLength(12);
    expect(rows[0]['common_name']).toBe('Croatia');
    expect(num(rows[0]['pass_accuracy'])).toBeCloseTo(0.8713, 4);
    expect(rows[1]['common_name']).toBe('Brazil');
    expect(num(rows[1]['pass_accuracy'])).toBeCloseTo(0.8705, 4);
    expect(rows[2]['common_name']).toBe('England');
    expect(num(rows[2]['pass_accuracy'])).toBeCloseTo(0.8687, 4);

    expect(inspectResult(PASS_ACCURACY_SQL, rows)).toEqual([]);
  });

  /**
   * The reported bug: numerator and denominator are the same SUM under two
   * names, the assistant reads the column as a pass accuracy and narrates a
   * flawless 100%. Both guards must speak — the SQL-level one names the defect,
   * the data-level one shows its effect.
   */
  it('flags a ratio whose numerator and denominator are the same expression', async () => {
    const rows = await runSql(pool, DEGENERATE_PASS_ACCURACY_SQL);

    expect(rows).toHaveLength(12);
    expect(rows.every((row) => num(row['pass_accuracy']) === 1)).toBe(true);

    const warnings = inspectResult(DEGENERATE_PASS_ACCURACY_SQL, rows);
    expect(codesOf(warnings)).toEqual(
      expect.arrayContaining(['constant-metric', 'degenerate-ratio']),
    );

    // Naming both aliases is what makes the warning actionable: it points at
    // the two select-list items to fix, not just at the flat result.
    const degenerate = messageOf(warnings, 'degenerate-ratio');
    expect(degenerate).toContain('completed');
    expect(degenerate).toContain('attempted');

    expect(messageOf(warnings, 'constant-metric')).toContain('pass_accuracy');
  });

  /**
   * Not a query bug: the fixture really does record only yellow cards. The
   * warning is still right, because a metric that is 1 everywhere explains no
   * difference between the rows it is compared across.
   */
  it('flags a metric that is constant because the data makes it constant', async () => {
    const rows = await runSql(pool, YELLOW_SHARE_SQL);

    expect(rows.map((row) => row['common_name'])).toEqual([
      'Argentina',
      'Brazil',
      'Croatia',
      'England',
      'Netherlands',
    ]);
    expect(rows.every((row) => num(row['yellow_share']) === 1)).toBe(true);

    const warnings = inspectResult(YELLOW_SHARE_SQL, rows);
    expect(codesOf(warnings)).toEqual(['constant-metric']);
    expect(messageOf(warnings, 'constant-metric')).toContain('yellow_share');
  });

  /**
   * A LEFT JOIN over a sparsely populated foreign key: 45 of 47 goals have no
   * recorded assist, so "top assist providers" is really one player and a
   * bucket of nothing. Unflagged, that blank row reads as a dominant group.
   */
  it('flags a group key left blank by the data', async () => {
    const rows = await runSql(pool, ASSISTS_SQL);

    expect(rows).toHaveLength(2);
    expect(rows[0]['assisting_player']).toBeNull();
    expect(num(rows[0]['goals'])).toBe(45);
    expect(rows[1]['assisting_player']).toBe('Lionel Messi');
    expect(num(rows[1]['goals'])).toBe(2);

    const warnings = inspectResult(ASSISTS_SQL, rows);
    expect(codesOf(warnings)).toEqual(['blank-group-key']);
    expect(messageOf(warnings, 'blank-group-key')).toContain(
      'assisting_player',
    );
  });

  /**
   * LIMIT without ORDER BY: the engine keeps whatever it reached first, so the
   * "top 3 scoring teams" here drops France, the tournament's leading scorer,
   * and nothing in the rows says so.
   */
  it('flags a top-N that was never ranked', async () => {
    const sample = await runSql(pool, UNORDERED_TOP_SCORERS_SQL);
    const ranked = await runSql(pool, ALL_TEAM_GOALS_SQL);

    expect(ranked[0]['common_name']).toBe('France');
    expect(num(ranked[0]['goals'])).toBe(14);

    const sampled = sample.map((row) => row['common_name']);
    expect(sampled).toHaveLength(3);
    expect(sampled).not.toContain('France');
    expect(sampled).not.toEqual(
      ranked.slice(0, 3).map((row) => row['common_name']),
    );

    expect(codesOf(inspectResult(UNORDERED_TOP_SCORERS_SQL, sample))).toContain(
      'unordered-limit',
    );
  });

  /** ORDER BY is the whole difference: the same shape, ranked, is not flagged. */
  it('does not flag a top-N that was ranked', async () => {
    const rows = await runSql(pool, RANKED_TOP_SCORERS_SQL);

    expect(codesOf(inspectResult(RANKED_TOP_SCORERS_SQL, rows))).not.toContain(
      'unordered-limit',
    );
  });

  /**
   * Landing exactly on the cap means the answer was cut short, and a total
   * computed over a truncated result is wrong rather than approximate.
   */
  it('flags a result that stopped exactly on the row cap', async () => {
    const rows = await runSql(pool, YELLOW_SHARE_SQL);

    expect(rows).toHaveLength(5);
    expect(codesOf(inspectResult(YELLOW_SHARE_SQL, rows, 5))).toContain(
      'row-cap-reached',
    );
    // One row of headroom and the cap is not the explanation for the row count.
    expect(codesOf(inspectResult(YELLOW_SHARE_SQL, rows, 6))).not.toContain(
      'row-cap-reached',
    );
  });

  /**
   * Ties make "top 5" a choice, not a fact: Belgium and England both scored 4,
   * so the fifth row is whichever the engine happened to order first, and four
   * more teams sit level on 2 just below. Asserted against the live totals so
   * the golden set cannot quietly start expecting one of them.
   */
  it('shows that a genuine tie makes the top-N boundary ambiguous', async () => {
    const ranked = await runSql(pool, ALL_TEAM_GOALS_SQL);
    const goalsBy = new Map(
      ranked.map((row) => [String(row['common_name']), num(row['goals'])]),
    );

    expect(goalsBy.get('Belgium')).toBe(4);
    expect(goalsBy.get('England')).toBe(4);
    for (const team of ['Brazil', 'Morocco', 'Russia', 'Netherlands']) {
      expect(goalsBy.get(team)).toBe(2);
    }

    const topFive = await runSql(pool, RANKED_TOP_SCORERS_SQL);
    expect(topFive).toHaveLength(5);

    // The cut falls inside the 4-goal tie: one of the two is reported, the
    // other is dropped, and both are equally correct answers.
    const fifth = String(topFive[4]['common_name']);
    expect(['Belgium', 'England']).toContain(fifth);
    const tiedAtBoundary = ranked.filter(
      (row) => num(row['goals']) === num(topFive[4]['goals']),
    );
    expect(tiedAtBoundary).toHaveLength(2);
  });

  /**
   * Careful mode compares a verifier's minimal projection against the analysis
   * query's wider one. Both are computed here from the same figures, so any
   * disagreement the comparator reports is about shape, not facts.
   */
  it('separates a width difference from a disagreement on the figures', async () => {
    const narrow = await runSql(pool, PASS_ACCURACY_SQL);
    const wide = await runSql(pool, WIDE_PASS_ACCURACY_SQL);

    expect(Object.keys(narrow[0])).toHaveLength(2);
    expect(Object.keys(wide[0])).toHaveLength(4);

    const strict = compareResults(wide, narrow);
    expect(strict.match).toBe(false);
    expect(strict.reason).toContain('column count differs');

    const tolerant = compareResults(wide, narrow, { widthTolerant: true });
    expect(tolerant.match).toBe(true);
    expect(tolerant.shapeDiffers).toBe(true);
    expect(tolerant.reason).toBe('');
  });

  /**
   * The regression the reported bug asks for: the degenerate query's rates are
   * all 1 and the correct query's are not, which is a real contradiction. Under
   * widthTolerant that must be reported as a difference in the figures — the
   * earlier behaviour buried it under a column-count complaint, so a wrong
   * answer looked like a harmless shape mismatch and passed review.
   */
  it('reports a real disagreement as figures, not as a shape complaint', async () => {
    const degenerate = await runSql(pool, DEGENERATE_PASS_ACCURACY_SQL);
    const correct = await runSql(pool, PASS_ACCURACY_SQL);

    expect(degenerate).toHaveLength(correct.length);
    expect(degenerate.every((row) => num(row['pass_accuracy']) === 1)).toBe(
      true,
    );
    expect(correct.every((row) => num(row['pass_accuracy']) < 0.9)).toBe(true);

    const comparison = compareResults(degenerate, correct, {
      widthTolerant: true,
    });
    expect(comparison.match).toBe(false);
    expect(comparison.shapeDiffers).toBeUndefined();
    expect(comparison.reason).toContain('figures');
    expect(comparison.reason).not.toContain('column count differs');
  });
});
