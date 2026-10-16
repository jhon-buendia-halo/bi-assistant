import { namesNotIds } from './names-not-ids';
import type { CheckTurn } from './turn';

const context = { dialect: 'postgres' as const };
const answer = (text: string): CheckTurn => ({
  question: 'Which team scored the most goals in total?',
  answer: text,
  toolCalls: [],
});

describe('namesNotIds (R114, I1)', () => {
  // The shapes `check-answers.ts` pinned from real answers, plus the ones
  // the baseline produced ("represented by ID 2", "Team ID **6**").
  it.each([
    'Team ID 5 scored the most.',
    'Team ID **5** scored the most.',
    '1. Team ID 5 2. Team ID 2',
    '- **Team 4**: 87.13%',
    'team_id 5 leads with 14 goals.',
    'ID: 7 is the winner.',
    'The 2022 World Cup is represented by ID 2.',
    'Driver 830 won the most races.',
    'The IDs 3 and 5 tie.',
  ])('fails on a bare identifier: %s', (text) => {
    const verdict = namesNotIds.evaluate(answer(text), {}, context);
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toMatch(
      /^the answer reports a bare identifier \(".+"\) instead of a name$/,
    );
  });

  it.each([
    'France scored the most goals (14).',
    'France led with 14 goals.',
    'Team France scored 14 goals.',
    'France won 7 matches and scored 14 goals.',
    'They went out in the Round of 16.',
    '16 teams reached the knockout stage.',
    'Lionel Messi scored 4 goals; Mbappé was paid 5 million.',
    '',
  ])('passes a named answer: %s', (text) => {
    expect(namesNotIds.evaluate(answer(text), {}, context)).toEqual({
      passed: true,
    });
  });

  it('takes its own entity nouns', () => {
    expect(
      namesNotIds.evaluate(answer('Member 42 claimed the most.'), {}, context)
        .passed,
    ).toBe(true);
    expect(
      namesNotIds.evaluate(
        answer('Member 42 claimed the most.'),
        { nouns: ['member'] },
        context,
      ).passed,
    ).toBe(false);
    expect(namesNotIds.validateArgs?.({ nouns: [] })).toMatch(
      /non-empty array/,
    );
    expect(namesNotIds.describe({ nouns: ['member'] }, context)).toBe(
      'Checks that the answer gives names, not bare ids (nouns "member")',
    );
  });
});
