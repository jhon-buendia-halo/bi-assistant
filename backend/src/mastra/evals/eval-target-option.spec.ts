import { targetOverrideFromEnv } from './eval-target-option';

describe('targetOverrideFromEnv (agents-evals R252)', () => {
  it.each([[{}], [{ EVAL_TARGET: '' }], [{ EVAL_TARGET: '   ' }]])(
    'reads %j as no override (the set’s own target)',
    (env) => {
      expect(targetOverrideFromEnv(env)).toEqual({});
    },
  );

  it.each(['assistant', 'insights-analyst'] as const)(
    'takes %s, trimmed',
    (target) => {
      expect(targetOverrideFromEnv({ EVAL_TARGET: ` ${target} ` })).toEqual({
        target,
      });
    },
  );

  it('refuses any other target, naming the two it takes', () => {
    expect(targetOverrideFromEnv({ EVAL_TARGET: 'query-explainer' })).toEqual({
      error:
        'Unknown EVAL_TARGET "query-explainer"; use assistant or insights-analyst',
    });
  });
});
