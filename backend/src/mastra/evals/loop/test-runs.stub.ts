/**
 * Builders of stored eval runs for the loop tools' unit tests, in the shapes
 * of data-model 3.8 and api.md 2.6. Not built (`*.stub.ts`).
 */
import type { EvalCaseIndexEntry } from '../eval-case-index';
import type { ModelUsageEntry } from '../eval-usage';
import { readRunRecord } from './run-source';
import type { LoopRun } from './run-source';

type Json = Record<string, unknown>;

/** A case index of the questions the tests name. */
export function testIndex(
  entries: Record<string, Partial<EvalCaseIndexEntry>>,
): Map<string, EvalCaseIndexEntry> {
  return new Map(
    Object.entries(entries).map(([id, e]) => [
      id,
      {
        setId: e.setId ?? 'demo',
        split: e.split ?? 'dev',
        category: e.category ?? 'lookup',
        question: e.question ?? `Question ${id}?`,
      },
    ]),
  );
}

export function usage(
  inputTokens: number,
  outputTokens: number,
  model = 'gpt-4o-mini',
): ModelUsageEntry[] {
  return [
    {
      agent: 'assistant',
      model,
      inputTokens,
      cachedInputTokens: 0,
      outputTokens,
      reasoningTokens: 0,
      calls: 1,
      unreportedCalls: 0,
    },
  ];
}

/** A stored result; `status` sets `passed` to match. */
export function storedResult(
  id: string,
  status: 'passed' | 'failed' | 'not-scored',
  extra: Json = {},
): Json {
  return {
    id,
    question: `Question ${id}?`,
    category: 'lookup',
    split: 'dev',
    scores: {},
    checkResults: [],
    answer: `Answer of ${id}`,
    toolCalls: [],
    status,
    passed: status === 'passed',
    durationMs: 10,
    passes: status === 'passed' ? 1 : 0,
    runs: 1,
    flaky: false,
    ...extra,
  };
}

/** A stored run record with its results. */
export function storedRun(
  jobId: string,
  results: Json[],
  extra: Json = {},
): Json {
  return {
    jobId,
    agentKey: 'assistant',
    datasourceId: 'ds-1',
    datasets: ['Demo'],
    caseIds: results.map((r) => r.id),
    status: 'completed',
    results,
    totalCases: results.length,
    startedAt: '2026-10-20T10:00:00.000Z',
    finishedAt: '2026-10-20T10:05:00.000Z',
    judge: { mode: 'off' },
    repeats: 1,
    model: 'openai/gpt-4o-mini',
    source: 'cli',
    ...extra,
  };
}

/** A run as the loop tools read it. */
export function loopRun(
  jobId: string,
  results: Json[],
  extra: Json = {},
  index: Map<string, EvalCaseIndexEntry> = new Map(),
): LoopRun {
  return readRunRecord(storedRun(jobId, results, extra), undefined, index);
}

/** `n` results of one category and split: `passed` of them pass. */
export function results(
  prefix: string,
  n: number,
  passed: number,
  extra: Json = {},
): Json[] {
  return Array.from({ length: n }, (_, i) =>
    storedResult(`${prefix}-${i + 1}`, i < passed ? 'passed' : 'failed', extra),
  );
}
