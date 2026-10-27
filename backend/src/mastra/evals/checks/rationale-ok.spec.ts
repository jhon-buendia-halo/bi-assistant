import { rationaleOk, sentenceCount } from './rationale-ok';
import type { CheckToolCall, CheckTurn } from './turn';

const context = { dialect: 'postgres' as const };

function call(
  name: string,
  rationale: unknown,
  argsReadable = true,
): CheckToolCall {
  return {
    name,
    args: {
      ...(name === 'sample_rows' ? { entity: 'world_cup.goals' } : {}),
      ...(name === 'run_readonly_sql' ? { sql: 'SELECT 1' } : {}),
      ...(rationale !== undefined ? { rationale } : {}),
    },
    argsReadable,
    result: { rows: [] },
  };
}

const turn = (...toolCalls: CheckToolCall[]): CheckTurn => ({
  question: 'Who won the 2022 World Cup?',
  answer: 'Argentina.',
  toolCalls,
});

const verdict = (t: CheckTurn) => rationaleOk.evaluate(t, {}, context);

describe('rationaleOk (R116, I3)', () => {
  it('passes one or two business sentences on every SQL and sampling call', () => {
    // Rationales the baseline recorded.
    expect(
      verdict(
        turn(
          call(
            'run_readonly_sql',
            'The question asks for the winner of the 2022 World Cup, so I need to look up the tournament details and find out which team was the champion for that specific year.',
          ),
          call(
            'sample_rows',
            'This query retrieves the knockout matches that went to a penalty shootout. This will help identify which teams advanced as a result.',
          ),
          call('list_entities', undefined),
        ),
      ),
    ).toEqual({ passed: true });
  });

  it('fails a call with no rationale, naming the step', () => {
    expect(
      verdict(
        turn(call('list_entities', undefined), call('sample_rows', '  ')),
      ),
    ).toEqual({
      passed: false,
      reason: 'step 2 (sample_rows): gave no rationale',
    });
  });

  it('fails more than two sentences', () => {
    const reason = verdict(
      turn(
        call('run_readonly_sql', 'First I look. Then I count. Then I sort.'),
      ),
    ).reason;
    expect(reason).toMatch(
      /^step 1 \(run_readonly_sql\): the rationale has 3 sentences, at most two/,
    );
  });

  it.each([
    ['SELECT the champion FROM tournaments.', 'SQL keyword "SELECT"'],
    ['I group by team to count goals.', 'SQL clause "group by"'],
    ['I use COUNT(*) per team.', 'SQL function "COUNT("'],
    // The baseline's "the exact venue_id with the best attendance".
    [
      'I need to confirm the exact venue_id with the best attendance.',
      'column-style name "venue_id"',
    ],
    [
      'I read world_cup.matches for the final.',
      'column-style name "world_cup"',
    ],
    ['I check `stage` for the final.', 'name in backticks "`stage`"'],
  ])('fails SQL in the rationale: %s', (rationale, what) => {
    expect(verdict(turn(call('run_readonly_sql', rationale))).reason).toContain(
      `the rationale names ${what}`,
    );
  });

  it('allows ordinary words that are also SQL words, in lower case', () => {
    expect(
      verdict(
        turn(
          call(
            'run_readonly_sql',
            'I select the matches from 2022 where the final was played, e.g. Lusail, to join them to their teams.',
          ),
        ),
      ).passed,
    ).toBe(true);
  });

  it('passes a turn with no SQL or sampling, and skips arguments a stored record clipped', () => {
    expect(verdict(turn()).passed).toBe(true);
    expect(
      verdict(turn(call('run_readonly_sql', undefined, false))).passed,
    ).toBe(true);
  });
});

describe('sentenceCount', () => {
  it.each([
    ['One sentence.', 1],
    ['One sentence without a stop', 1],
    ['Average 2.5 goals. Then compare', 2],
    ['Check it! Then "Count" it? Done.', 3],
    ['', 0],
  ])('%s → %d', (text, count) => {
    expect(sentenceCount(text)).toBe(count);
  });
});
