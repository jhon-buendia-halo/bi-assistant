import {
  ARM_DESCRIPTIONS,
  ENGINE_DEFAULTS,
  armOptions,
  engineConfigHash,
  parseEngineOverride,
  resolveEngineOptions,
  sanitizeEngineOptions,
} from './engine-options';

describe('engine lever memory', () => {
  it('ships off', () => {
    expect(ENGINE_DEFAULTS.memory).toBe('off');
    expect(resolveEngineOptions().memory).toBe('off');
  });

  it('parses from the CLI form, keeping the + of recall+models', () => {
    expect(parseEngineOverride('memory=recall')).toEqual({ memory: 'recall' });
    expect(parseEngineOverride('careful=auto,memory=recall+models')).toEqual({
      careful: 'auto',
      memory: 'recall+models',
    });
    expect(() => parseEngineOverride('memory=on')).toThrow(
      'Engine option "memory" cannot be "on"',
    );
  });

  it('drops an invalid value from untrusted JSON', () => {
    expect(sanitizeEngineOptions({ memory: 'everything' })).toEqual({});
    expect(sanitizeEngineOptions({ memory: 'recall' })).toEqual({
      memory: 'recall',
    });
  });

  it('has a described arm per mode', () => {
    expect(armOptions('memory-recall')).toEqual({ memory: 'recall' });
    expect(armOptions('memory-models')).toEqual({ memory: 'recall+models' });
    expect(ARM_DESCRIPTIONS['memory-recall']).toBeTruthy();
    expect(ARM_DESCRIPTIONS['memory-models']).toBeTruthy();
  });

  it('changes the config hash when on, and keeps pre-lever hashes when off', () => {
    const off = resolveEngineOptions();
    const { memory, ...preLever } = off;
    expect(memory).toBe('off');
    // What a run hashed before the lever existed.
    expect(engineConfigHash(off)).toBe(
      engineConfigHash(preLever as typeof off),
    );
    expect(
      engineConfigHash(resolveEngineOptions({ memory: 'recall' })),
    ).not.toBe(engineConfigHash(off));
    expect(
      engineConfigHash(resolveEngineOptions({ memory: 'recall' })),
    ).not.toBe(
      engineConfigHash(resolveEngineOptions({ memory: 'recall+models' })),
    );
  });
});
