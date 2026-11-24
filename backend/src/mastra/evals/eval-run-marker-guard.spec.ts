// The cases' scorers are built at import and never run here.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy({}, { get: () => () => ({ id: 'stub-check' }) }),
}));
// The check scorers are built when the sets load: a stand-in that never runs.
jest.mock('@mastra/core/evals', () => ({
  runEvals: jest.fn(),
  createScorer: (config: Record<string, unknown>) => {
    const scorer: Record<string, unknown> = { ...config };
    for (const step of ['analyze', 'generateScore', 'generateReason']) {
      scorer[step] = () => scorer;
    }
    return scorer;
  },
}));
jest.mock('../agents/assistant.agent', () => ({ assistantAgent: {} }));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessAgent: { id: 'data-readiness' },
}));
jest.mock('../agents/insights-analyst.agent', () => ({
  insightsAnalystAgent: { id: 'insights-analyst' },
}));
jest.mock('../agents/query-explainer.agent', () => ({
  queryExplainerAgent: { id: 'query-explainer' },
  explainQueryWithModel: jest.fn(),
}));
jest.mock('../agents/result-explorer.agent', () => ({
  resultExplorerAgent: { id: 'result-explorer' },
  interpretResultWithModel: jest.fn(),
}));
jest.mock('../agents/eval-judge.agent', () => ({
  evalJudgeAgent: {},
  evalJudgeOutputSchema: {},
}));
jest.mock('../model-resolver', () => ({
  resolveAgentModel: jest.fn(),
  resolveAgentModelConfig: jest.fn().mockResolvedValue('anthropic/claude-test'),
}));
jest.mock('../tool-services', () => ({
  getDatasetToolServices: () => ({ getDatasets: () => Promise.resolve([]) }),
}));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import type { AnySpan } from '@mastra/core/observability';
import { runEvals } from '@mastra/core/evals';
import { runAssistantEvalCase, type EvalTarget } from './assistant.evals';
import {
  EVAL_SETS,
  evalSetAgentKey,
  evalSetTargetId,
  evalTargetOf,
} from './eval-sets';
import { EVAL_RUN_CONTEXT_KEY } from './eval-trace-marker';
import { EvalRunMarker, currentEvalRunId } from './eval-run-scope';

/**
 * The guard of ADR-0054 over every eval target in `EVAL_SETS`: a target's
 * model calls are marked because everything a case does with its target —
 * each hook the runner calls and the dispatch of the target's agent (or
 * whole-run stand-in) to `runEvals` — runs inside the run's scope, where the
 * marker processor stamps every span. A target added later is enumerated
 * here too; a hook or a dispatch the runner made outside the scope fails it.
 */

/** Where the case used a member of its target, and the run it was in. */
type Use = { member: string; evalRunId: string | undefined };

/**
 * The target, every member the runner uses recorded with the scope it was
 * used in. Hooks are stubbed and the agents are never loaded: what is under
 * test is where the runner uses them, not what they do.
 */
function watched(target: EvalTarget, uses: Use[]): EvalTarget {
  const record = (member: string) =>
    uses.push({ member, evalRunId: currentEvalRunId() });
  return new Proxy(target, {
    get(own, property): unknown {
      if (typeof property !== 'string') return Reflect.get(own, property);
      if (property === 'agent' || property === 'runTarget') {
        if (!(property in own)) return undefined;
        record(property);
        return { id: `${own.agentKey}:${property}` };
      }
      const value: unknown = Reflect.get(own, property, own);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        record(property);
        if (property === 'orientation') return '';
        if (property === 'prepareQuestion') {
          return Promise.resolve((args[0] as { question: string }).question);
        }
        return undefined;
      };
    },
  });
}

/** Every target id in `EVAL_SETS`, with the agent key of its first set. */
function everyTarget(): { targetId: string; agentKey: string }[] {
  const byId = new Map<string, string>();
  for (const set of EVAL_SETS) {
    const targetId = evalSetTargetId(set);
    if (!byId.has(targetId)) byId.set(targetId, evalSetAgentKey(set));
  }
  return [...byId].map(([targetId, agentKey]) => ({ targetId, agentKey }));
}

describe('every eval target is marked (ADR-0054)', () => {
  const targets = everyTarget();

  it('enumerates the targets of every set', () => {
    expect(targets.length).toBeGreaterThanOrEqual(10);
  });

  for (const { targetId, agentKey } of targets) {
    it(`${targetId}: runs every use of its target inside the run's scope, so every span it starts carries the marker`, async () => {
      const uses: Use[] = [];
      const target = watched(evalTargetOf(targetId, agentKey), uses);
      const evalCase = EVAL_SETS.find(
        (set) => evalSetTargetId(set) === targetId,
      )!.cases[0];
      let dispatch: { evalRunId?: string; marker?: unknown; target?: unknown } =
        {};
      jest.mocked(runEvals).mockImplementationOnce((config) => {
        // A span the dispatched target starts, as the processor sees it.
        const span = { metadata: {} } as unknown as AnySpan;
        new EvalRunMarker().process(span);
        dispatch = {
          evalRunId: currentEvalRunId(),
          marker: span.metadata?.[EVAL_RUN_CONTEXT_KEY],
          target: config.target,
        };
        return Promise.resolve({ scores: {} } as never);
      });

      const result = await runAssistantEvalCase(
        evalCase,
        ['Guard'],
        undefined,
        undefined,
        target,
        undefined,
        { evalRunId: 'job-guard' },
      );

      expect(result.error).toBeUndefined();
      const { target: dispatched, ...scope } = dispatch;
      expect(scope).toEqual({ evalRunId: 'job-guard', marker: 'job-guard' });
      // The target's own agent (or its whole-run stand-in), as watched.
      expect((dispatched as { id?: string } | undefined)?.id).toMatch(
        /:(runTarget|agent)$/,
      );
      expect(uses.map((use) => use.member)).toEqual(
        expect.arrayContaining(['orientation']),
      );
      expect(uses.filter((use) => use.evalRunId !== 'job-guard')).toEqual([]);
      expect(currentEvalRunId()).toBeUndefined();
    });
  }
});
