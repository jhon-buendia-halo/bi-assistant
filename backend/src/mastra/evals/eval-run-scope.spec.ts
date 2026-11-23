import type { AnySpan } from '@mastra/core/observability';
import { EVAL_RUN_CONTEXT_KEY } from './eval-trace-marker';
import { EvalRunMarker, currentEvalRunId, inEvalRun } from './eval-run-scope';

/** A span as the processor sees it: only its metadata matters. */
function span(metadata?: Record<string, unknown>): AnySpan {
  return { metadata } as unknown as AnySpan;
}

describe('eval run scope (ADR-0054)', () => {
  it('knows its run inside the scope, across awaits, and none outside', async () => {
    expect(currentEvalRunId()).toBeUndefined();
    await inEvalRun('job-1', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentEvalRunId()).toBe('job-1');
    });
    expect(currentEvalRunId()).toBeUndefined();
  });

  it('opens no scope without a run id', async () => {
    await inEvalRun(undefined, () => {
      expect(currentEvalRunId()).toBeUndefined();
      return Promise.resolve();
    });
  });

  it('keeps two concurrent runs (or a run and live traffic) apart', async () => {
    const seen: (string | undefined)[] = [];
    const record = async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(currentEvalRunId());
    };
    await Promise.all([inEvalRun('job-a', record), record()]);
    expect(seen.sort()).toEqual(['job-a', undefined]);
  });
});

describe('EvalRunMarker (ADR-0054)', () => {
  const marker = new EvalRunMarker();

  it("writes the run id into a span's metadata inside the scope, whatever it held", async () => {
    const bare = span();
    const withRunId = span({ runId: 'r1' });
    await inEvalRun('job-7', () => {
      marker.process(bare);
      marker.process(withRunId);
      return Promise.resolve();
    });
    expect(bare.metadata).toEqual({ [EVAL_RUN_CONTEXT_KEY]: 'job-7' });
    expect(withRunId.metadata).toEqual({
      runId: 'r1',
      [EVAL_RUN_CONTEXT_KEY]: 'job-7',
    });
  });

  it('leaves a span outside any scope as it is', () => {
    const live = span({ runId: 'r1' });
    expect(marker.process(live)).toBe(live);
    expect(live.metadata).toEqual({ runId: 'r1' });
  });

  it('keeps a marker the request context already set', async () => {
    const marked = span({ [EVAL_RUN_CONTEXT_KEY]: 'from-context' });
    await inEvalRun('job-2', () => {
      marker.process(marked);
      return Promise.resolve();
    });
    expect(marked.metadata).toEqual({
      [EVAL_RUN_CONTEXT_KEY]: 'from-context',
    });
  });

  it('passes a dropped span through', async () => {
    await inEvalRun('job-3', () => {
      expect(marker.process(undefined)).toBeUndefined();
      return Promise.resolve();
    });
  });
});
