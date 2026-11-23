import { AsyncLocalStorage } from 'node:async_hooks';
import type { AnySpan, SpanOutputProcessor } from '@mastra/core/observability';
import { EVAL_RUN_CONTEXT_KEY } from './eval-trace-marker';

/**
 * The eval run a piece of work belongs to, carried by the async call chain
 * rather than by the request context (ADR-0054). A target that calls an app
 * function which builds its own request context, or none, still runs inside
 * the case's scope, so every span it starts is marked.
 */
const evalRunScope = new AsyncLocalStorage<string>();

/** Runs `work` as part of eval run `evalRunId`; as is when there is none. */
export function inEvalRun<T>(
  evalRunId: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  return evalRunId ? evalRunScope.run(evalRunId, work) : work();
}

/** The eval run the current async call chain belongs to, if any. */
export function currentEvalRunId(): string | undefined {
  return evalRunScope.getStore();
}

/**
 * The span output processor that writes the eval marker into the
 * `metadata` of every span started (or ended) inside an eval run's scope,
 * whatever request context the span was created with. Mastra runs output
 * processors synchronously when a span starts, in the caller's async
 * context, and the span object is the one later exported on end, so the
 * marker is on every exported event of the span. Outside a scope it does
 * nothing: live traffic is untouched.
 */
export class EvalRunMarker implements SpanOutputProcessor {
  readonly name = 'eval-run-marker';

  process(span?: AnySpan): AnySpan | undefined {
    const evalRunId = currentEvalRunId();
    if (
      span &&
      evalRunId &&
      span.metadata?.[EVAL_RUN_CONTEXT_KEY] === undefined
    ) {
      span.metadata = { ...span.metadata, [EVAL_RUN_CONTEXT_KEY]: evalRunId };
    }
    return span;
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
