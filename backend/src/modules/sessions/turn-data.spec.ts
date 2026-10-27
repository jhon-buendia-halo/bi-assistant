import { synthesizeToolOnlyTurn } from './turn-data';
import { USAGE_SINK_CONTEXT_KEY } from '../../mastra/usage-sink';

/** A requestContext holding only what the synthesis reads. */
function contextWith(sink?: unknown) {
  return {
    get: (key: string) => (key === USAGE_SINK_CONTEXT_KEY ? sink : undefined),
  };
}

describe('synthesizeToolOnlyTurn usage sink (agents-evals R219)', () => {
  const data = [{ tool: 'run_readonly_sql', input: 'select 1' }];
  const result = { text: 'Done.', usage: { inputTokens: 5 } };
  const run = (context?: ReturnType<typeof contextWith>) =>
    synthesizeToolOnlyTurn(
      { generate: jest.fn().mockResolvedValue(result) } as never,
      'How many?',
      data,
      new AbortController().signal,
      {},
      undefined,
      context as never,
    );

  it('reports the synthesis as an assistant call with the raw result', async () => {
    const sink = jest.fn();

    await expect(run(contextWith(sink))).resolves.toBe('Done.');

    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith('assistant', result, undefined);
  });

  it('is a no-op without a sink', async () => {
    await expect(run(contextWith())).resolves.toBe('Done.');
    await expect(run()).resolves.toBe('Done.');
  });

  it('never fails the turn when the sink throws', async () => {
    const sink = jest.fn(() => {
      throw new Error('boom');
    });

    await expect(run(contextWith(sink))).resolves.toBe('Done.');
    expect(sink).toHaveBeenCalled();
  });
});
