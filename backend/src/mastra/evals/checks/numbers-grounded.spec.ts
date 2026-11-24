import {
  numbersGrounded,
  statedNumbers,
  withoutStageNames,
} from './numbers-grounded';
import type { CheckToolCall, CheckTurn } from './turn';

const context = { dialect: 'postgres' as const };

function rows(
  data: Record<string, unknown>[],
  name = 'run_readonly_sql',
): CheckToolCall {
  return {
    name,
    args: { sql: 'SELECT …', rationale: 'Why.' },
    argsReadable: true,
    result: { columns: Object.keys(data[0] ?? {}), rows: data },
  };
}

function turn(
  answer: string,
  toolCalls: CheckToolCall[],
  question = 'Which team scored the most goals in total?',
): CheckTurn {
  return { question, answer, toolCalls };
}

const verdict = (t: CheckTurn, args = {}) =>
  numbersGrounded.evaluate(t, args, context);

describe('numbersGrounded (R115, G1)', () => {
  const france14 = rows([{ team: 'France', goals: 14 }]);

  it('passes when the figure is in the fetched rows, and fails an invented one (plan 3.5 example)', () => {
    expect(verdict(turn('France, with 14 goals.', [france14]))).toEqual({
      passed: true,
    });
    expect(verdict(turn('France, with 16 goals.', [france14]))).toEqual({
      passed: false,
      reason:
        'the answer states 16, which no tool result of this turn holds or rounds to',
    });
  });

  it('grounds numbers the question states', () => {
    expect(
      verdict(
        turn(
          'Argentina won the 2022 World Cup.',
          [rows([{ champion: 'Argentina' }])],
          'Who won the 2022 World Cup?',
        ),
      ).passed,
    ).toBe(true);
  });

  it('accepts a rounding at the answer’s own precision, and a fraction shown as a percentage', () => {
    const accuracy = [rows([{ team: 'Croatia', pass_accuracy: 0.871345 }])];
    for (const text of ['87.13%', '87.1%', '87%', '0.87', '87.13 percent']) {
      expect(verdict(turn(`Croatia: ${text}`, accuracy)).passed).toBe(true);
    }
    expect(verdict(turn('Croatia: 88%', accuracy)).passed).toBe(false);
    expect(verdict(turn('Croatia: 87.2%', accuracy)).passed).toBe(false);
  });

  it('accepts a share of two numbers of one row, or of two one-row results', () => {
    expect(
      verdict(
        turn('Croatia completed 87.1% of its passes.', [
          rows([
            { team: 'Croatia', completed: 520, attempted: 597 },
            { team: 'Brazil', completed: 400, attempted: 500 },
          ]),
        ]),
      ).passed,
    ).toBe(true);
    expect(
      verdict(
        turn('The team with more possession won 25% of them (2 of 8).', [
          rows([{ won: 2 }]),
          rows([{ matches: 8 }]),
        ]),
      ).passed,
    ).toBe(true);
    // An integer is never a ratio: 16 is not "32 / 2".
    expect(
      verdict(turn('France, with 16 goals.', [rows([{ a: 32, b: 2 }])])).passed,
    ).toBe(false);
  });

  it('reads a live timestamp, which the driver hands over as a Date, as the stored record writes it', () => {
    // Live, `pg` parses timestamptz into a Date, which has no own fields:
    // "15 July 2018, 15:00" failed every live run as "states 15" (2026-11-18).
    const live = rows([
      { kicked_off_at: new Date('2018-07-15T15:00:00.000Z') },
    ]);
    expect(
      verdict(turn('Played on 15 July 2018 (2018-07-15), 15:00 UTC.', [live])),
    ).toEqual({ passed: true });
    expect(verdict(turn('Played on 16 July 2018.', [live])).reason).toBe(
      'the answer states 16, which no tool result of this turn holds or rounds to',
    );
  });

  it('reads thousands, a European grouping, dates and row counts', () => {
    const venue = [rows([{ venue: 'Lusail Stadium', attendance: 88966 }])];
    expect(verdict(turn('Lusail Stadium, 88,966.', venue)).passed).toBe(true);
    expect(verdict(turn('Lusail Stadium, 88.966.', venue)).passed).toBe(true);
    expect(
      verdict(
        turn('The final was on 18 December 2022.', [
          rows([{ kicked_off_at: '2022-12-18T15:00:00.000Z' }]),
        ]),
      ).passed,
    ).toBe(true);
    expect(
      verdict(
        turn('3 teams completed most passes.', [
          rows([{ t: 'Croatia' }, { t: 'Brazil' }, { t: 'England' }]),
        ]),
      ).passed,
    ).toBe(true);
  });

  it('does not read list markers, code, glued numbers or ignored phrases', () => {
    expect(
      statedNumbers(
        '1. France — 14\n2) Brazil\n- 3. x\nUse `LIMIT 5`.\n```sql\nSELECT 7\n```\nF1, 1st, 2x, the 1970s',
      ).map((number) => number.text),
    ).toEqual(['14']);
    // Two rows, so the row count does not ground the 1 of "Formula 1".
    const standings = [
      rows([
        { driver: 'Max Verstappen', points: 575 },
        { driver: 'Sergio Pérez', points: 285 },
      ]),
    ];
    expect(
      verdict(
        turn('In Formula 1, Verstappen finished on 575 points.', standings),
        { ignore: ['Formula 1'] },
      ).passed,
    ).toBe(true);
    expect(
      verdict(
        turn('In Formula 1, Verstappen finished on 575 points.', standings),
      ).reason,
    ).toBe(
      'the answer states 1, which no tool result of this turn holds or rounds to',
    );
  });

  it('does not read the number of a stage name (BA-188, possession-vs-result)', () => {
    // Every figure came from the query; the 16 named a stage the sample lacks.
    expect(
      verdict(
        turn(
          'The team with more possession won 2 of 8 (25%) and lost 6. The dataset records 2022 knockout matches from the quarter-finals onward; no round-of-16 matches are present.',
          [rows([{ won: 2, lost: 6, matches: 8 }])],
          'In the 2022 knockout rounds, did the team with more possession usually win?',
        ),
      ),
    ).toEqual({ passed: true });
    for (const stage of [
      'Japan went out in the round of 16.',
      'Japan went out in the Round of 16.',
      'Japan went out in the round-of-16 tie.',
      'Japan went out in the round_of_16.',
      'Japan went out in the ROUND OF 32.',
      'Japan reached the last 16.',
      'Japan reached the last 16',
      'Japan reached the **last 16**.',
      'Japan reached the last 16!',
      'Japan went out at the last 16 stage.',
      'Japan lost a last-16 tie.',
      'Japan lost its last 16 match to Croatia.',
      '- Last 16\n- Quarter-finals',
    ]) {
      expect([stage, statedNumbers(withoutStageNames(stage))]).toEqual([
        stage,
        [],
      ]);
      expect([stage, verdict(turn(stage, [])).passed]).toEqual([stage, true]);
    }
  });

  it('still checks a count that only looks like a stage name', () => {
    for (const [count, stated] of [
      ['Japan won 9 of the last 16 matches.', '16'],
      ['Japan qualified in the last 16 years.', '16'],
      ['Japan played the last 16 games at home.', '16'],
      ['Japan lost the last 16 rounds.', '16'],
      ['Japan reached the last 16.5 km.', '16.5'],
      [
        'Japan and 15 other sides, 16 teams, reached the round of 16.',
        '15, 16',
      ],
    ]) {
      expect([count, verdict(turn(count, [rows([{ n: 9 }])])).reason]).toEqual([
        count,
        `the answer states ${stated}, which no tool result of this turn holds or rounds to`,
      ]);
    }
    // In the question or a result, a stage name still grounds its number.
    expect(
      verdict(turn('16 teams play it.', [], 'Who played in the round of 16?'))
        .passed,
    ).toBe(true);
    expect(
      verdict(turn('16 teams play it.', [rows([{ stage: 'Round of 16' }])]))
        .passed,
    ).toBe(true);
  });

  it('grounds nothing on tool arguments, failed calls or list_entities', () => {
    const argsOnly: CheckToolCall = {
      ...rows([{ team: 'France' }]),
      args: { sql: 'SELECT … LIMIT 16', limit: 16 },
    };
    expect(verdict(turn('16 teams.', [argsOnly])).passed).toBe(false);
    expect(
      verdict(
        turn('France scored 4-2.', [
          {
            name: 'run_readonly_sql',
            args: { sql: 'SELECT 4, 2' },
            argsReadable: true,
            error: 'Datasource "postgres 1" is not used',
          },
        ]),
      ),
    ).toEqual({
      passed: false,
      reason:
        'the answer states 4, 2, but no tool call of this turn returned data',
    });
    // The baseline's "Pelé scored a total of 6 goals": 6 was only a column count.
    expect(
      verdict(
        turn('Pelé scored a total of 6 goals in the 1970 World Cup.', [
          {
            name: 'list_entities',
            args: {},
            argsReadable: true,
            result: {
              entities: [{ entity: 'api.world_cup.goals', columnCount: 6 }],
            },
          },
        ]),
      ).passed,
    ).toBe(false);
  });

  it('ignores the digits of a datasource id', () => {
    expect(
      verdict(
        turn('5087 goals.', [
          {
            ...rows([{ n: 1 }], 'describe_entity'),
            result: { datasourceId: '23ebd2e8-5087-4398-aee9-4866cb76a81b' },
          },
        ]),
      ).passed,
    ).toBe(false);
  });

  it('reads what a clipped stored result left', () => {
    expect(
      verdict(
        turn('France, with 14 goals.', [
          {
            name: 'run_readonly_sql',
            args: {},
            argsReadable: false,
            resultText:
              '{"rows": [{"team": "France", "goals": 14}, {"team": "Bra… (truncated)',
          },
        ]),
      ).passed,
    ).toBe(true);
  });

  it('passes an answer with no numbers, and names at most five', () => {
    expect(verdict(turn('Argentina won.', [])).passed).toBe(true);
    expect(
      verdict(turn('1 2 3 4 5 6 7 and 8 again 8.', [rows([{ n: 0 }])])).reason,
    ).toBe(
      // 1 is grounded: the result returned one row.
      'the answer states 2, 3, 4, 5, 6 and 2 more, which no tool result of this turn holds or rounds to',
    );
    expect(numbersGrounded.describe({ ignore: ['Formula 1'] }, context)).toBe(
      'Checks that every number in the answer comes from a tool result (ignoring "Formula 1")',
    );
  });
});

describe('numbersGrounded: worked-out and rounded figures (R115, fixed 2026-11-19)', () => {
  const teams = rows([
    { team: 'France', goals: 14, matches: 6 },
    { team: 'Croatia', goals: 9, matches: 6 },
    { team: 'Argentina', goals: 8, matches: 3 },
    { team: 'Belgium', goals: 4, matches: 3 },
  ]);
  const ok = (answer: string, calls = [teams], question?: string) =>
    verdict(turn(answer, calls, question)).passed;

  it('grounds a lead, a sum and a column total', () => {
    expect(ok('France leads Croatia by 5 goals.')).toBe(true);
    expect(ok('France and Croatia scored 23 between them.')).toBe(true);
    expect(ok('The four teams scored 35 goals in total.')).toBe(true);
    expect(ok('France scored 19 goals.')).toBe(false);
    // A sum or difference grounds only a number its line says was worked out.
    expect(ok('France beat Croatia 4-5.')).toBe(false);
  });

  it('grounds a complement of two one-row results', () => {
    const total = rows([{ goals: 47 }]);
    const assisted = rows([{ assisted: 2 }]);
    expect(ok('The other 45 goals have no assist.', [total, assisted])).toBe(
      true,
    );
  });

  it('grounds a count of distinct values in a column', () => {
    const cards = rows([
      { match_id: 'a', card: 'yellow' },
      { match_id: 'a', card: 'yellow' },
      { match_id: 'b', card: 'yellow' },
    ]);
    expect(ok('The 3 cards came from 2 matches.', [cards])).toBe(true);
  });

  it('reads a hedged number as rounded to its last non-zero digit', () => {
    const passes = rows([{ team: 'Croatia', attempted: 3971 }]);
    expect(ok('It covers almost 4,000 attempted passes.', [passes])).toBe(true);
    expect(ok('It covers 4,000 attempted passes.', [passes])).toBe(false);
    const months = rows([
      { month: 'Feb', cancelled: 319 },
      { month: 'Nov', cancelled: 419 },
    ]);
    expect(ok('Roughly 300 to 420 a month were cancelled.', [months])).toBe(
      true,
    );
  });

  it('reads a magnitude suffix', () => {
    const paid = rows([{ total: 262384938.16 }]);
    expect(ok('Card is 43.0% of the 262.4M total.', [paid])).toBe(false);
    expect(ok('The total is 262.4M.', [paid])).toBe(true);
    expect(ok('The total is 263.4M.', [paid])).toBe(false);
  });

  it('skips dates, years, unit sizes and a rank column', () => {
    const last = new Date().getFullYear() - 1;
    expect(
      ok(`In ${last}, from 1 Jan to 31 Dec ${last} or ${last}-12-31.`, []),
    ).toBe(true);
    const cups = rows([{ year: 2018 }, { year: 2022 }]);
    expect(ok('The 2018 and 2022 cups, and 2020 between them.', [cups])).toBe(
      true,
    );
    expect(ok('Brazil also won in 1994.', [cups])).toBe(false);
    expect(ok('Played on 16 July.', [])).toBe(false);
    expect(
      ok('No goal came after 120 minutes, or 90 minutes in normal time.', []),
    ).toBe(true);
    expect(ok('Hours divided by 24; the shares add up to 100%.', [])).toBe(
      true,
    );
    const table = [
      '| Rank | Team | Goals |',
      '|---|---|---|',
      '| 1 | France | 14 |',
      '| 2 | Croatia | 9 |',
      '| 3 | Argentina | 8 |',
      '| 4= | Belgium | 4 |',
    ].join('\n');
    expect(ok(table)).toBe(true);
    expect(ok(table.replace('| 14 |', '| 15 |'))).toBe(false);
  });
});

describe('numbersGrounded: coverage notes (R115, fixed 2026-11-23)', () => {
  // From a real Opus workflow answer (top-scoring-team, 2026-11-23): the
  // per-stage counts the query returned add up to the 16 matches it states.
  const stages = rows([
    { tournament_year: 2018, stage: 'final', matches: '1' },
    { tournament_year: 2018, stage: 'quarter_final', matches: '4' },
    { tournament_year: 2018, stage: 'semi_final', matches: '2' },
    { tournament_year: 2018, stage: 'third_place', matches: '1' },
    { tournament_year: 2022, stage: 'final', matches: '1' },
    { tournament_year: 2022, stage: 'quarter_final', matches: '4' },
    { tournament_year: 2022, stage: 'semi_final', matches: '2' },
    { tournament_year: 2022, stage: 'third_place', matches: '1' },
  ]);
  const ok = (answer: string, calls = [stages]) =>
    verdict(turn(answer, calls)).passed;

  it('grounds a whole column total without a "total" word', () => {
    expect(
      ok('It holds only 16 matches: the quarter-finals to the final.'),
    ).toBe(true);
    expect(ok('It holds only 17 matches.')).toBe(false);
  });

  it('does not read a match clock mark as a figure', () => {
    expect(ok('An extra-time goal is one recorded after minute 90.', [])).toBe(
      true,
    );
    expect(ok('Nothing came after the 120th minute.', [])).toBe(true);
    expect(ok('He scored in minute 37.', [])).toBe(false);
  });
});
