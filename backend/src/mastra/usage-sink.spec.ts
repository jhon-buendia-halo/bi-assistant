import { RequestContext } from '@mastra/core/request-context';
import { USAGE_SINK_CONTEXT_KEY, usageSinkFrom } from './usage-sink';
import type { UsageSink } from './usage-sink';

describe('usageSinkFrom (agents-evals R219)', () => {
  it('returns the sink an eval attempt put on the requestContext', () => {
    const calls: unknown[][] = [];
    const sink: UsageSink = (...args) => {
      calls.push(args);
    };
    const requestContext = new RequestContext();
    requestContext.set(USAGE_SINK_CONTEXT_KEY, sink);
    const result = { totalUsage: { inputTokens: 1, outputTokens: 1 } };
    usageSinkFrom(requestContext)?.('sql-fixer', result, 'gpt-4o-mini');
    usageSinkFrom(requestContext)?.('designer', result);
    expect(calls).toEqual([
      ['sql-fixer', result, 'gpt-4o-mini'],
      ['designer', result, undefined],
    ]);
  });

  it('is undefined outside an eval, so nothing is recorded', () => {
    expect(usageSinkFrom(undefined)).toBeUndefined();
    expect(usageSinkFrom(new RequestContext())).toBeUndefined();
    const requestContext = new RequestContext();
    requestContext.set(USAGE_SINK_CONTEXT_KEY, 'not a function');
    expect(usageSinkFrom(requestContext)).toBeUndefined();
  });

  it('never lets a broken sink fail the call it measures', () => {
    const requestContext = new RequestContext();
    requestContext.set(USAGE_SINK_CONTEXT_KEY, () => {
      throw new Error('broken');
    });
    expect(() => usageSinkFrom(requestContext)?.('judge', {})).not.toThrow();
  });

  it('reads any object with get, as the tools receive the context', () => {
    const seen: string[] = [];
    const context = {
      get: (key: string) =>
        key === USAGE_SINK_CONTEXT_KEY
          ? (agent: string) => seen.push(agent)
          : undefined,
    };
    usageSinkFrom(context)?.('assistant', {});
    expect(seen).toEqual(['assistant']);
    expect(USAGE_SINK_CONTEXT_KEY).toBe('eval-usage-sink');
  });
});
