import { optionCount } from './option-count';
import type { CheckToolCall, CheckTurn } from './turn';

const context = { dialect: 'postgres' as const };

function ask(options: unknown, argsReadable = true): CheckToolCall {
  return {
    name: 'ask_clarification',
    args: { question: 'Best by which measure?', options },
    argsReadable,
    result: { delivered: true },
  };
}

const turn = (...toolCalls: CheckToolCall[]): CheckTurn => ({
  question: 'Which team performed best?',
  answer: 'Best by which measure?',
  toolCalls,
});

const labels = (...names: string[]) => names.map((label) => ({ label }));

describe('optionCount (R120, I5)', () => {
  it('passes one clarification with 2 to 4 distinct options', () => {
    for (const options of [
      labels('Most goals', 'Most wins'),
      labels('Most goals', 'Most wins', 'Fewest goals conceded', 'Possession'),
    ]) {
      expect(optionCount.evaluate(turn(ask(options)), {}, context)).toEqual({
        passed: true,
      });
    }
  });

  it('reads the options as the tool takes them: one per line, or a list of strings', () => {
    for (const options of [
      'Most titles — count of championships\nMost wins\nMost goals',
      '- Most titles\n- Most wins',
      ['Most titles', 'Most wins'],
    ]) {
      expect(optionCount.evaluate(turn(ask(options)), {}, context)).toEqual({
        passed: true,
      });
    }
    expect(
      optionCount.evaluate(turn(ask('Only one option')), {}, context).reason,
    ).toBe('the clarification offered 1 option; it needs 2 to 4');
    expect(
      optionCount.evaluate(turn(ask('Goals\ngoals')), {}, context).reason,
    ).toBe('the clarification offers "goals" twice');
  });

  it('passes a turn that asked nothing', () => {
    expect(optionCount.evaluate(turn(), {}, context).passed).toBe(true);
  });

  it('fails a second clarification', () => {
    expect(
      optionCount.evaluate(
        turn(ask(labels('a', 'b')), ask(labels('c', 'd'))),
        {},
        context,
      ).reason,
    ).toBe('ask_clarification was called 2 times; at most once per question');
  });

  it.each([
    [labels('Only one'), 'the clarification offered 1 option; it needs 2 to 4'],
    [
      labels('a', 'b', 'c', 'd', 'e'),
      'the clarification offered 5 options; it needs 2 to 4',
    ],
    [labels('Goals', ' '), 'an option of the clarification has no label'],
    [labels('Goals', 'goals'), 'the clarification offers "goals" twice'],
    [undefined, 'the clarification carried no options'],
  ])('fails %p', (options, reason) => {
    expect(optionCount.evaluate(turn(ask(options)), {}, context)).toEqual({
      passed: false,
      reason,
    });
  });

  it('skips a stored record whose arguments were clipped', () => {
    expect(
      optionCount.evaluate(turn(ask(undefined, false)), {}, context).passed,
    ).toBe(true);
  });
});
