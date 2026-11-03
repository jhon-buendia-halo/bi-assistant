import {
  LEGACY_ARM,
  memoryArmFromEnv,
  parseEvalArm,
  parseMemoryArm,
} from './memory-arm-option';

const unknown = (shown: string) => ({
  error: `Unknown memory arm "${shown}"; use none, mastra or hindsight-mastra`,
});

describe('parseMemoryArm (agents-evals R231, R232, api.md 36)', () => {
  it('reads a missing or null arm as none', () => {
    expect(parseMemoryArm(undefined)).toEqual({ memory: 'none' });
    expect(parseMemoryArm(null)).toEqual({ memory: 'none' });
  });

  it.each(['none', 'mastra', 'hindsight-mastra'])('takes %s', (memory) => {
    expect(parseMemoryArm(memory)).toEqual({ memory });
  });

  it.each([
    ['sometimes', 'sometimes'],
    ['Mastra', 'Mastra'],
    [' mastra', ' mastra'],
    ['hindsight', 'hindsight'],
    ['', ''],
    [1, '1'],
    [true, 'true'],
    [['mastra'], '["mastra"]'],
  ])('refuses %j, showing it as "%s"', (value, shown) => {
    expect(parseMemoryArm(value)).toEqual(unknown(shown));
  });
});

describe('parseEvalArm (api.md 36)', () => {
  it('reads a missing arm, a null one or one with no memory as no memory', () => {
    for (const value of [undefined, null, {}, { memory: null }]) {
      expect(parseEvalArm(value)).toEqual({ arm: { memory: 'none' } });
    }
  });

  it("reads the arm's memory", () => {
    expect(parseEvalArm({ memory: 'mastra' })).toEqual({
      arm: { memory: 'mastra' },
    });
  });

  it('refuses an unknown memory, and an arm that is not an object', () => {
    expect(parseEvalArm({ memory: 'sometimes' })).toEqual(unknown('sometimes'));
    expect(parseEvalArm('mastra')).toEqual(unknown('mastra'));
    expect(parseEvalArm([])).toEqual(unknown('[]'));
  });
});

describe('memoryArmFromEnv (agents-evals R232)', () => {
  it('reads unset or blank as none', () => {
    expect(memoryArmFromEnv({})).toEqual({ memory: 'none' });
    expect(memoryArmFromEnv({ EVAL_MEMORY: '  ' })).toEqual({ memory: 'none' });
  });

  it('reads the three names, trimmed', () => {
    expect(memoryArmFromEnv({ EVAL_MEMORY: 'none' })).toEqual({
      memory: 'none',
    });
    expect(memoryArmFromEnv({ EVAL_MEMORY: ' mastra ' })).toEqual({
      memory: 'mastra',
    });
    expect(memoryArmFromEnv({ EVAL_MEMORY: 'hindsight-mastra' })).toEqual({
      memory: 'hindsight-mastra',
    });
  });

  it.each(['hindsight', 'MASTRA', 'on'])('refuses %s', (value) => {
    expect(memoryArmFromEnv({ EVAL_MEMORY: value })).toEqual(unknown(value));
  });
});

describe('LEGACY_ARM', () => {
  it('is how a run saved before the arm reads (R231)', () => {
    expect(LEGACY_ARM).toEqual({ memory: 'none' });
    expect(Object.isFrozen(LEGACY_ARM)).toBe(true);
  });
});
