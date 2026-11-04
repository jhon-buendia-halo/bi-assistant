import { noHtml } from './no-html';

const context = { dialect: 'postgres' as const };
const verdict = (answer: string) =>
  noHtml.evaluate(
    {
      question: 'What data do I have available to analyse?',
      answer,
      toolCalls: [],
    },
    {},
    context,
  );

describe('noHtml (R117, I4)', () => {
  it.each([
    ['<div class="chart">Goals</div>', 'HTML'],
    ['Line one<br/>line two', 'HTML'],
    ['</p>', 'HTML'],
    ['```html\n<b>x</b>\n```', 'code'],
    ['```javascript\nconst x = 1;\n```', 'code'],
    ['Style it with .bar { fill: steelblue; }', 'CSS'],
    ['Add <script src="x.js"> to the page.', 'HTML'],
    ['Call document.getElementById("chart").', 'JavaScript'],
    ['Use function draw(data) { return data; }', 'JavaScript'],
    ['data.map((row) => { return row; })', 'JavaScript'],
    ['let total = 14', 'JavaScript'],
    ['CREATE TABLE world_cup.goals (id int)', 'a raw schema dump'],
    ['| Column | Type |\n|---|---|\n| id | integer |', 'a raw schema dump'],
  ])('fails %s', (answer, what) => {
    const result = verdict(answer);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain(`the answer contains ${what}: "`);
  });

  it('fails a list of columns with their types', () => {
    expect(
      verdict(
        'The goals table has:\n- goal_id integer\n- match_id integer\n- minute (int)\n- scorer_name text',
      ).reason,
    ).toMatch(/^the answer contains a raw schema dump: "/);
  });

  it.each([
    // The baseline's discovery answer, shortened.
    'You have access to the following entities within the World Cup dataset:\n\n1. **Tournaments**: Records of each World Cup tournament.\n2. **Matches**: Details on each match played, including scores and participating teams.\n3. **Goals**: Data on the goals scored in each match, including who scored them and any assists.',
    'France scored 14 goals; the final ended 4-2 (a < b and c > d).',
    'Kick-off dates are stored as text and the date of each match is known.',
    'See <https://example.com> for more.',
    '',
  ])('passes prose: %s', (answer) => {
    expect(verdict(answer)).toEqual({ passed: true });
  });
});
