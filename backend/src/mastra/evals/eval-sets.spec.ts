// The cases' scorers are built at import and never run here. The stub gives
// each kind the id the real `checks` give it (`check-<kind in kebab case>`,
// so two of one kind in a case share an id), which the uniqueness test reads.
jest.mock('@mastra/evals/checks', () => ({
  checks: new Proxy(
    {},
    {
      get: (_target, kind: string) => () => ({
        id: `check-${kind.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
      }),
    },
  ),
}));
jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));
jest.mock('../agents/assistant.agent', () => ({ assistantAgent: {} }));
jest.mock('../agents/data-readiness.agent', () => ({
  dataReadinessAgent: { id: 'data-readiness' },
  dataReadinessStepAgent: { id: 'data-readiness-step' },
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
jest.mock('../model-resolver', () => ({ resolveAgentModel: jest.fn() }));
jest.mock('../../modules/sessions/turn-data', () => ({
  synthesizeToolOnlyTurn: jest.fn(),
  toolDataRecord: jest.fn(),
}));

import {
  EVAL_SETS,
  evalSetTargetId,
  evalTargetFor,
  evalTargetIdFor,
  evalTargetOf,
  setsOfTarget,
  targetIdOfSets,
} from './eval-sets';

/**
 * Every registered set, whatever its builder: the properties the runner
 * relies on (`runEvals` keys scores by scorer id, so a repeated id loses a
 * verdict without a sound).
 */
describe('every eval set', () => {
  for (const set of EVAL_SETS) {
    describe(`set ${set.id}`, () => {
      it('has unique case ids', () => {
        const ids = set.cases.map((evalCase) => evalCase.id);
        expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
      });

      for (const evalCase of set.cases) {
        it(`${evalCase.id}: scorer and custom check ids are unique`, () => {
          const ids = [
            ...evalCase.scorers.map((scorer): string => scorer.id as string),
            ...(evalCase.customChecks ?? []).map((check) => check.id),
            ...(evalCase.judgeRubric ? ['judge'] : []),
          ];
          const repeated = ids.filter((id, i) => ids.indexOf(id) !== i);
          expect([...new Set(repeated)]).toEqual([]);
        });
      }
    });
  }

  it('has case ids that are unique across all sets', () => {
    const ids = EVAL_SETS.flatMap((set) => set.cases.map((c) => c.id));
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });
});

describe('the target a run uses', () => {
  it('is the set target, else the agent key, else the assistant', () => {
    expect(evalSetTargetId({})).toBe('assistant');
    expect(evalSetTargetId({ agentKey: 'result-explorer' })).toBe(
      'result-explorer',
    );
    expect(
      evalSetTargetId({
        agentKey: 'data-readiness',
        target: 'data-readiness:check-data-quality',
      }),
    ).toBe('data-readiness:check-data-quality');
  });

  it('is one id for sets of one target and an error across targets', () => {
    const chat = { agentKey: 'data-readiness' };
    const check = {
      agentKey: 'data-readiness',
      target: 'data-readiness:check-data-quality',
    };
    expect(targetIdOfSets([chat, chat], 'x')).toEqual({
      targetId: 'data-readiness',
    });
    expect(targetIdOfSets([], 'x')).toEqual({ targetId: 'x' });
    expect(targetIdOfSets([chat, check], 'x')).toEqual({
      error:
        'The selected questions run on several targets (data-readiness, data-readiness:check-data-quality) — run one set at a time',
    });
  });

  it('is the agent key for an agent whose sets are all on its own target', () => {
    expect(evalTargetIdFor('query-explainer')).toEqual({
      targetId: 'query-explainer',
    });
  });

  it("refuses to run all of an agent's sets when they use several targets", () => {
    // Sarah's chat set and her Check data quality set (story 1.28.4).
    expect(evalTargetIdFor('data-readiness')).toEqual({
      error: expect.stringContaining('run one set at a time') as string,
    });
  });

  it.each(['analysis-planner', 'answer-writer', 'image-reader'])(
    'builds the isolated-call target of %s',
    (agentKey) => {
      const target = evalTargetFor(agentKey);
      expect(target.agentKey).toBe(agentKey);
      expect(target.sendsKnowledge).toBe(false);
      expect(target.orientation({ datasets: [], snapshots: [] } as never)).toBe(
        '',
      );
    },
  );

  it('builds the check-data-quality target on Sarah’s agent key', () => {
    const target = evalTargetOf(
      'data-readiness:check-data-quality',
      'data-readiness',
    );
    expect(target.agentKey).toBe('data-readiness');
    expect(target.sendsKnowledge).toBe(false);
    expect(target.runTarget).not.toBe(target.agent);
  });

  it('builds the whole-workflow target from its target id', () => {
    const workflow = evalTargetOf(
      'data-readiness:assessment-workflow',
      'data-readiness',
    );
    expect(workflow.agentKey).toBe('data-readiness');
    expect(workflow.sessionAgentKey).toBe('data-readiness');
    expect(workflow.runTarget).not.toBe(workflow.agent);
    const chat = evalTargetOf('data-readiness', 'data-readiness');
    expect(chat.runTarget).toBeUndefined();
  });

  it('still throws for an agent without evals', () => {
    expect(() => evalTargetFor('no-such-agent')).toThrow(
      'Agent "no-such-agent" has no evals to run',
    );
  });

  it('finds no registered set for an unregistered target', () => {
    expect(setsOfTarget('no-such-target')).toEqual([]);
  });
});
