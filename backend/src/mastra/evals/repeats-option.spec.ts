import { parseRepeats, repeatsFromEnv } from './repeats-option';

describe('parseRepeats (agents-evals R209, api.md 36)', () => {
  it('reads a missing or null option as 1', () => {
    expect(parseRepeats(undefined)).toEqual({ repeats: 1 });
    expect(parseRepeats(null)).toEqual({ repeats: 1 });
  });

  it.each([1, 3, 5])('takes the number %d', (repeats) => {
    expect(parseRepeats(repeats)).toEqual({ repeats });
  });

  it.each([
    [2, '2'],
    ['3', '3'],
    ['three', 'three'],
    [true, 'true'],
    [0, '0'],
    [[3], '[3]'],
  ])('refuses %j, showing it as "%s"', (value, shown) => {
    expect(parseRepeats(value)).toEqual({
      error: `Repeats must be 1, 3 or 5 (got "${shown}")`,
    });
  });
});

describe('repeatsFromEnv (agents-evals R222)', () => {
  it('reads unset or blank as 1', () => {
    expect(repeatsFromEnv({})).toEqual({ repeats: 1 });
    expect(repeatsFromEnv({ EVAL_REPEATS: '  ' })).toEqual({ repeats: 1 });
  });

  it('reads 1, 3 and 5 as text, trimmed', () => {
    expect(repeatsFromEnv({ EVAL_REPEATS: '3' })).toEqual({ repeats: 3 });
    expect(repeatsFromEnv({ EVAL_REPEATS: ' 5 ' })).toEqual({ repeats: 5 });
    expect(repeatsFromEnv({ EVAL_REPEATS: '1' })).toEqual({ repeats: 1 });
  });

  it.each(['2', 'three', '3.0', '-1'])('refuses %s', (value) => {
    expect(repeatsFromEnv({ EVAL_REPEATS: value })).toEqual({
      error: `Repeats must be 1, 3 or 5 (got "${value}")`,
    });
  });
});
