import { defaultEffort, effortLevelsFor, nearestEffort } from './effort-levels';

describe('effortLevelsFor', () => {
  it.each([
    ['gpt-5', ['minimal', 'low', 'medium', 'high']],
    ['gpt-5-mini', ['minimal', 'low', 'medium', 'high']],
    ['gpt-5-nano-2025-08-07', ['minimal', 'low', 'medium', 'high']],
    [
      'mmc-tech-gpt-5-mini-272k-2025-08-07',
      ['minimal', 'low', 'medium', 'high'],
    ],
    ['gpt-5-pro', ['high']],
    ['gpt-5.1', ['none', 'low', 'medium', 'high']],
    ['gpt-5.2', ['none', 'low', 'medium', 'high', 'xhigh']],
    [
      'mmc-tech-gpt-52-272k-2025-12-11',
      ['none', 'low', 'medium', 'high', 'xhigh'],
    ],
    ['gpt-5.2-pro', ['medium', 'high', 'xhigh']],
    ['openai/gpt-5.5', ['none', 'low', 'medium', 'high', 'xhigh']],
    [
      'mmc-tech-gpt-55-1m-2026-04-24',
      ['none', 'low', 'medium', 'high', 'xhigh'],
    ],
    ['gpt-5.6', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-astra', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6.1-sol', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['gpt-6-luna', ['none', 'low', 'medium', 'high', 'xhigh', 'max']],
    ['o3', ['low', 'medium', 'high']],
    ['o4-mini', ['low', 'medium', 'high']],
    ['claude-opus-5-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['anthropic/claude-haiku-5-5', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-opus-4-7', ['low', 'medium', 'high', 'xhigh', 'max']],
    ['claude-sonnet-4-6', ['low', 'medium', 'high', 'max']],
    ['claude-opus-4-5-20251101', ['low', 'medium', 'high']],
    ['stub-deployment', ['low', 'medium', 'high']],
    ['my-deployment', ['low', 'medium', 'high']],
  ])('%s offers %j', (model, levels) => {
    expect(effortLevelsFor(model)).toEqual(levels);
  });

  it.each([
    'gpt-4.1',
    'gpt-4o-mini',
    'mmc-tech-gpt-41-mini-1m-2025-04-14',
    'gpt-3.5-turbo',
    'claude-haiku-4-5',
    'claude-3-5-sonnet-20241022',
    'claude-sonnet-4-5',
    'claude-opus-4-1',
    '',
  ])('%s offers none', (model) => {
    expect(effortLevelsFor(model)).toEqual([]);
  });
});

describe('defaultEffort', () => {
  it('prefers high, else the first level, else none', () => {
    expect(defaultEffort(['minimal', 'low', 'medium', 'high'])).toBe('high');
    expect(defaultEffort(['high'])).toBe('high');
    expect(defaultEffort(['none'])).toBe('none');
    expect(defaultEffort([])).toBeNull();
  });
});

describe('nearestEffort', () => {
  it('keeps an accepted level', () => {
    expect(nearestEffort(['low', 'medium', 'high'], 'medium')).toBe('medium');
  });

  it('moves to the closest level, ties going up', () => {
    expect(nearestEffort(['high'], 'low')).toBe('high');
    expect(nearestEffort(['none', 'low', 'medium', 'high'], 'minimal')).toBe(
      'low',
    );
    expect(nearestEffort(['low', 'medium', 'high'], 'max')).toBe('high');
    expect(nearestEffort(['minimal', 'low', 'medium', 'high'], 'none')).toBe(
      'minimal',
    );
  });
});
