import { EVAL_CATEGORIES } from './eval-set-files';
import {
  JUDGE_OFF,
  judgeCriterion,
  judgeLabel,
  judgeSettingFromEnv,
  parseJudgeSetting,
  shouldJudge,
} from './judge-option';

describe('parseJudgeSetting (agents-evals R143)', () => {
  it('defaults to off when no option is given', () => {
    expect(parseJudgeSetting(undefined, undefined)).toEqual({
      setting: { mode: 'off' },
    });
    expect(parseJudgeSetting(null, undefined)).toEqual({
      setting: { mode: 'off' },
    });
    expect(JUDGE_OFF).toEqual({ mode: 'off' });
  });

  it('accepts off and on, and ignores a category list sent with them', () => {
    expect(parseJudgeSetting('off', ['ambiguous'])).toEqual({
      setting: { mode: 'off' },
    });
    expect(parseJudgeSetting('on', ['ambiguous'])).toEqual({
      setting: { mode: 'on' },
    });
  });

  it('refuses any other option', () => {
    expect(parseJudgeSetting('sometimes', undefined)).toEqual({
      error: 'Unknown judge option "sometimes"',
    });
    expect(parseJudgeSetting('ON', undefined)).toEqual({
      error: 'Unknown judge option "ON"',
    });
    expect(parseJudgeSetting(true, undefined)).toEqual({
      error: 'Unknown judge option "true"',
    });
  });

  it('keeps the listed categories in category-list order, without repeats', () => {
    expect(
      parseJudgeSetting('categories', [
        'out-of-scope',
        'ambiguous',
        'out-of-scope',
      ]),
    ).toEqual({
      setting: {
        mode: 'categories',
        categories: ['ambiguous', 'out-of-scope'],
      },
    });
  });

  it('needs a non-empty category list for categories', () => {
    const error = { error: 'Pick at least one category to judge' };
    expect(parseJudgeSetting('categories', undefined)).toEqual(error);
    expect(parseJudgeSetting('categories', [])).toEqual(error);
    expect(parseJudgeSetting('categories', 'ambiguous')).toEqual(error);
  });

  it('refuses a listed value that is not a category, naming the known ones', () => {
    expect(parseJudgeSetting('categories', ['ambiguous', 'joins'])).toEqual({
      error: `Unknown judge category "joins". Known categories: ${EVAL_CATEGORIES.join(', ')}.`,
    });
  });
});

describe('judgeSettingFromEnv (agents-evals R153)', () => {
  it('reads EVAL_JUDGE, off when unset or blank', () => {
    expect(judgeSettingFromEnv({})).toEqual({ setting: { mode: 'off' } });
    expect(judgeSettingFromEnv({ EVAL_JUDGE: '  ' })).toEqual({
      setting: { mode: 'off' },
    });
    expect(judgeSettingFromEnv({ EVAL_JUDGE: ' on ' })).toEqual({
      setting: { mode: 'on' },
    });
    expect(judgeSettingFromEnv({ EVAL_JUDGE: 'sometimes' })).toEqual({
      error: 'Unknown judge option "sometimes"',
    });
  });

  it('reads the categories comma-separated, ignoring blanks', () => {
    expect(
      judgeSettingFromEnv({
        EVAL_JUDGE: 'categories',
        EVAL_JUDGE_CATEGORIES: ' out-of-scope, ,ambiguous,',
      }),
    ).toEqual({
      setting: {
        mode: 'categories',
        categories: ['ambiguous', 'out-of-scope'],
      },
    });
    expect(judgeSettingFromEnv({ EVAL_JUDGE: 'categories' })).toEqual({
      error: 'Pick at least one category to judge',
    });
  });
});

describe('shouldJudge (agents-evals R144)', () => {
  it('never judges with the option off or absent', () => {
    expect(shouldJudge({ mode: 'off' }, 'ambiguous')).toBe(false);
    expect(shouldJudge(undefined, 'ambiguous')).toBe(false);
  });

  it('judges every category with the option on', () => {
    expect(shouldJudge({ mode: 'on' }, 'ambiguous')).toBe(true);
    expect(shouldJudge({ mode: 'on' }, undefined)).toBe(true);
  });

  it('judges only the listed categories with categories', () => {
    const setting = {
      mode: 'categories' as const,
      categories: ['ambiguous' as const],
    };
    expect(shouldJudge(setting, 'ambiguous')).toBe(true);
    expect(shouldJudge(setting, 'out-of-scope')).toBe(false);
    expect(shouldJudge(setting, undefined)).toBe(false);
  });
});

describe('judgeCriterion (agents-evals R145)', () => {
  it.each([
    ['ambiguous', 'I5'],
    ['out-of-scope', 'G2'],
    ['non-existent', 'G2'],
    ['reasoning', 'G3'],
    ['visual', 'G4'],
    ['fuzzy-scope', 'I7'],
    ['default-filter', 'I2'],
    ['lookup', 'G1'],
    ['discovery', 'G1'],
    [undefined, 'G1'],
  ])('maps %s to %s', (category, criterion) => {
    expect(judgeCriterion(category)).toBe(criterion);
  });
});

describe('judgeLabel (agents-evals R152)', () => {
  it('names the option as the report prints it', () => {
    expect(judgeLabel({ mode: 'off' })).toBe('off');
    expect(judgeLabel({ mode: 'on' })).toBe('on');
    expect(
      judgeLabel({ mode: 'categories', categories: ['ambiguous', 'visual'] }),
    ).toBe('on for ambiguous, visual');
  });
});
