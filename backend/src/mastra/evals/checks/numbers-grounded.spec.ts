import { numbersGrounded, statedNumbers } from './numbers-grounded';
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

describe('numbersGrounded (R114, G1)', () => {
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
