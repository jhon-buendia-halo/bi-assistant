import type { EvalCustomCheck, EvalRawToolCall } from './assistant.evals';
import {
  answerNamesAll,
  answerStatesNone,
  answerStatesNumbers,
  endsOnClarifyingQuestion,
  hasMarkdownTable,
  markdownTableRows,
  numbersInText,
  ranSuccessfulSql,
  usesStoredValue,
} from './analyst-v2-eval-checks';

/**
 * The answers below are real: Questions to Insights v2 (3 tools) on
 * claude-sonnet-5-5 over the seeded World Cup sample, baseline run of
 * 2026-11-13. Each check is run on the answer of the case it belongs to.
 */
const TIES_ANSWER = `In this dataset, three players tie for the 2018 lead with 2 goals each:

| Player | Team | Goals | Penalties |
|---|---|---|---|
| Antoine Griezmann | France | 2 | 1 |
| Ivan Perišić | Croatia | 2 | 0 |
| Mario Mandžukić | Croatia | 2 | 0 |

Mandžukić also scored 1 own goal. I excluded it from his total.`;

const SHARE_ANSWER = `In this dataset, **6 of the 24 goals (25%)** at the 2022 World Cup came from penalties.

| Goal type | Goals | Share |
|---|---|---|
| Open play | 13 | 54.2% |
| Header | 5 | 20.8% |
| Penalty | 6 | 25.0% |`;

const COMPARE_ANSWER = `In this dataset, the average rose slightly, from 2.88 goals per match in 2018 to 3.00 in 2022 (+0.125, about +4%).

| Tournament | Matches in data | Total goals | Avg goals per match |
|---|---|---|---|
| 2018 | 8 | 23 | 2.875 |
| 2022 | 8 | 24 | 3.000 |`;

const OUT_OF_COVERAGE_LEAK = `The dataset doesn't include the 2014 World Cup, so I can't answer this from the data. It only has the 2018 and 2022 tournaments.

From general knowledge rather than the data: Germany won the 2014 World Cup. Mario Götze scored in the 113th minute.`;

const OUT_OF_COVERAGE_CLEAN =
  "The data has no 2014 tournament: it only covers the 2018 and 2022 World Cups. I can't give a 2014 result from it.";

const FREE_KICK_ANSWER = `Only **one** goal in the data came directly from a free kick. **Kieran Trippier** scored it for England in the 5th minute of match 7.`;

const STADIUM_ANSWER = `Two stadiums tied for the most matches, with 3 each:

- **Lusail Stadium** (Lusail, Qatar, 2022 tournament)
- **Saint Petersburg Stadium** (Saint Petersburg, Russia, 2018 tournament)

Al Bayt, Fisht and Luzhniki each hosted 2 matches.`;

function run(
  check: EvalCustomCheck,
  answer: string,
  toolCalls: EvalRawToolCall[] = [],
) {
  return check.run({ answer, toolCalls, datasets: ['World Cup'], vars: {} });
}

function sql(
  text: string,
  overrides: Partial<EvalRawToolCall> = {},
): EvalRawToolCall {
  return {
    name: 'run_readonly_sql',
    input: { sql: text, rationale: 'r' },
    output: { rows: [] },
    failed: false,
    ...overrides,
  };
}

describe('endsOnClarifyingQuestion', () => {
  // The answer the v2 eval target scores when a run ends on a clarification:
  // the question, then one `- <option>` line per option.
  const CLARIFICATION = [
    'What do you mean by "most dominant"?',
    '- Most matches won — wins across the knockout matches in the data',
    '- Most goals scored — total goals across 2018 and 2022',
    '- Best goal difference — goals scored minus conceded',
  ].join('\n');

  it('passes one question with 2-4 options', () => {
    expect(run(endsOnClarifyingQuestion(), CLARIFICATION)).toBeUndefined();
  });

  it('fails an answer, a question without options, or one with more around it', () => {
    expect(run(endsOnClarifyingQuestion(), TIES_ANSWER)).toBe(
      'the answer does not open with a question',
    );
    expect(run(endsOnClarifyingQuestion(), 'Which measure?\n- Wins')).toBe(
      'the question offers 1 options, not 2-4',
    );
    expect(
      run(
        endsOnClarifyingQuestion(),
        `${CLARIFICATION}\nFrance won 4 matches.`,
      ),
    ).toBe('the answer holds more than the question and its options');
  });
});

describe('numbersInText', () => {
  it('reads digits, decimals and thousands separators', () => {
    expect(numbersInText('88,966 fans, 2.875 goals, 25%')).toEqual([
      88966, 2.875, 25,
    ]);
  });

  it('reads number words, so "Only one goal" states 1', () => {
    expect(numbersInText(FREE_KICK_ANSWER)).toContain(1);
    expect(numbersInText('someone and anyone')).toEqual([]);
  });
});

describe('answerStatesNumbers', () => {
  it('passes the share answer on 25 or on 6 of 24', async () => {
    const check = answerStatesNumbers([
      [{ value: 25, tolerance: 0.5 }],
      [{ value: 6 }, { value: 24 }],
    ]);
    expect(await run(check, SHARE_ANSWER)).toBeUndefined();
    expect(await run(check, 'Penalties made 6 of 24 goals.')).toBeUndefined();
  });

  it('fails an answer with a different share and lists what it states', async () => {
    const check = answerStatesNumbers([[{ value: 25, tolerance: 0.5 }]]);
    expect(await run(check, 'About 30% came from penalties.')).toMatch(
      /expected the answer to state 25.*30/,
    );
  });

  it('accepts a rounded average inside the tolerance and not outside', async () => {
    const check = answerStatesNumbers([
      [
        { value: 2.875, tolerance: 0.03 },
        { value: 3, tolerance: 0.03 },
      ],
    ]);
    expect(await run(check, COMPARE_ANSWER)).toBeUndefined();
    expect(await run(check, 'It went from 2.5 to 3.0.')).toBeDefined();
  });

  it('passes a one-goal answer written in words', async () => {
    const check = answerStatesNumbers([[{ value: 1 }]]);
    expect(await run(check, FREE_KICK_ANSWER)).toBeUndefined();
  });
});

describe('answerNamesAll', () => {
  it('ignores case and accents (Perišić = Perisic)', async () => {
    const check = answerNamesAll(['Griezmann', 'Perisic', 'Mandzukic']);
    expect(await run(check, TIES_ANSWER)).toBeUndefined();
  });

  it('names the player a LIMIT 1 answer left out', async () => {
    const check = answerNamesAll(['Griezmann', 'Perisic', 'Mandzukic']);
    expect(
      await run(check, 'The top scorer was Antoine Griezmann with 2 goals.'),
    ).toBe('the answer does not name Perisic, Mandzukic');
  });

  it('finds both stadiums of the tie', async () => {
    const check = answerNamesAll(['Lusail', 'Saint Petersburg']);
    expect(await run(check, STADIUM_ANSWER)).toBeUndefined();
  });
});

describe('answerStatesNone', () => {
  const check = answerStatesNone(['Germany', 'Gotze']);

  it('fails the answer that adds the 2014 winner from general knowledge', async () => {
    expect(await run(check, OUT_OF_COVERAGE_LEAK)).toMatch(/"Germany"/);
  });

  it('passes the answer that states only the coverage', async () => {
    expect(await run(check, OUT_OF_COVERAGE_CLEAN)).toBeUndefined();
  });

  it('matches an accented name through its plain spelling', async () => {
    expect(
      await run(answerStatesNone(['Gotze']), 'Mario Götze scored.'),
    ).toBeDefined();
  });
});

describe('hasMarkdownTable', () => {
  it('counts the data rows of the ties table', () => {
    expect(markdownTableRows(TIES_ANSWER)).toBe(3);
  });

  it('passes a table of three rows, fails a bullet list', async () => {
    expect(await run(hasMarkdownTable(3), TIES_ANSWER)).toBeUndefined();
    expect(await run(hasMarkdownTable(3), STADIUM_ANSWER)).toBe(
      'expected a Markdown table of at least 3 rows, the answer has 0',
    );
  });

  it('fails a table with fewer rows than asked', async () => {
    expect(await run(hasMarkdownTable(3), COMPARE_ANSWER)).toMatch(
      /the answer has 2/,
    );
  });

  it('does not count a pipe line without a separator row', () => {
    expect(markdownTableRows('| a | b |\n| 1 | 2 |')).toBe(0);
  });
});

describe('ranSuccessfulSql', () => {
  it('passes one successful query', async () => {
    expect(
      await run(ranSuccessfulSql(), 'x', [
        { name: 'describe_entity', input: {}, output: {}, failed: false },
        sql('select 1'),
      ]),
    ).toBeUndefined();
  });

  it('fails when only a failed query ran, or none', async () => {
    const check = ranSuccessfulSql();
    expect(
      await run(check, 'x', [sql('select', { failed: true })]),
    ).toBeDefined();
    expect(await run(check, 'x')).toBeDefined();
  });
});

describe('usesStoredValue', () => {
  const check = usesStoredValue('free_kick');

  it('passes the real query that filtered on the stored code', async () => {
    expect(
      await run(check, FREE_KICK_ANSWER, [
        sql(
          "select g.id, p.full_name from world_cup.world_cup.goals g where g.goal_type='free_kick' order by g.match_id",
        ),
      ]),
    ).toBeUndefined();
  });

  it('fails a guessed literal, and a lookup that failed', async () => {
    expect(
      await run(check, 'x', [
        sql("select * from goals where goal_type = 'free kick'"),
      ]),
    ).toMatch(/no successful query filters on 'free_kick'/);
    expect(
      await run(check, 'x', [
        sql("select * from goals where goal_type='free_kick'", {
          failed: true,
        }),
      ]),
    ).toBeDefined();
  });
});
