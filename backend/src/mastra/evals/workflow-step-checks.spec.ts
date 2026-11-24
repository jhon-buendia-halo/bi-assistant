import { gatesVerdict, layerOf } from './checks/check-layers';
import { questionStatus } from './eval-summary';
import {
  brokeAt,
  expectationsOf,
  referenceTables,
  workflowStepChecks,
} from './workflow-step-checks';
import type { StepCheckInput } from './workflow-step-checks';

const REFERENCE = [{ team: 'France', goals: 4 }];
const RIGHT = {
  sql: 'select',
  rows: [{ team: 'France', goals: 4 }],
  rowCount: 1,
  truncated: false,
};
const WRONG = {
  sql: 'select',
  rows: [{ team: 'Croatia', goals: 2 }],
  rowCount: 1,
  truncated: false,
};
const PLAN = {
  plan: {
    needsClarification: false,
    entities: ['world_cup.v_match_results'],
    clarification: null,
  },
};

function input(over: Partial<StepCheckInput> = {}): StepCheckInput {
  return {
    steps: {
      plan: PLAN,
      analyse: { queries: [RIGHT] },
      validate: { ok: true, queries: [RIGHT], findings: [] },
      'write-answer': { answer: 'France 4' },
    },
    expects: {},
    expectedSql: 'SELECT home_team FROM world_cup.v_match_results',
    referenceRows: REFERENCE,
    endedOnClarification: false,
    checks: [],
    ...over,
  };
}

function statuses(over: Partial<StepCheckInput> = {}) {
  return Object.fromEntries(
    workflowStepChecks(input(over)).map((c) => [c.id, c.status]),
  );
}

describe('check layers (agents-evals R258)', () => {
  it('sorts checks into outcome, path and step', () => {
    expect(layerOf('result-set-match')).toBe('outcome');
    expect(layerOf('check-numbers-grounded')).toBe('outcome');
    expect(layerOf('check-asked-clarification')).toBe('outcome');
    expect(layerOf('check-called-tool')).toBe('path');
    expect(layerOf('check-tool-order')).toBe('path');
    expect(layerOf('step-validate')).toBe('step');
  });

  it('reads the edge set’s two cross-step checks as step checks', () => {
    // Emily has no Plan or Write answer: on 2026-11-23 she failed every
    // insights-analyst-edge question on these two alone.
    expect(layerOf('plan-entities-in-sql')).toBe('step');
    expect(layerOf('headline-figures-in-rows')).toBe('step');
    expect(
      questionStatus([
        { id: 'iae-status-counts-match-sql', status: 'passed' },
        { id: 'plan-entities-in-sql', status: 'failed' },
      ]),
    ).toBe('passed');
  });

  it('leaves a failed step check out of the verdict', () => {
    expect(gatesVerdict('step-plan')).toBe(false);
    expect(
      questionStatus([
        { id: 'check-includes', status: 'passed' },
        { id: 'step-plan', status: 'failed' },
      ]),
    ).toBe('passed');
    expect(questionStatus([{ id: 'step-plan', status: 'passed' }])).toBe(
      'not-scored',
    );
  });
});

describe('expectationsOf', () => {
  it('reads askedClarification and builtVisual', () => {
    expect(
      expectationsOf([
        { type: 'askedClarification', criterion: 'D5' },
        { type: 'builtVisual', args: { built: false }, criterion: 'G4' },
      ] as never),
    ).toEqual({ clarification: true, visual: false });
    expect(
      expectationsOf([{ type: 'noHtml', criterion: 'I4' }] as never),
    ).toEqual({});
  });
});

describe('referenceTables', () => {
  it('names the tables, not the CTEs', () => {
    expect(
      referenceTables(
        'WITH t AS (SELECT * FROM evals."world_cup".goals g JOIN world_cup.matches m ON 1=1) SELECT * FROM t',
      ),
    ).toEqual(['goals', 'matches']);
  });
});

describe('workflowStepChecks (agents-evals R259 to R261)', () => {
  it('passes every step of a right run', () => {
    expect(statuses()).toEqual({
      'step-plan': 'passed',
      'step-analyse': 'passed',
      'step-validate': 'passed',
      'step-write': 'passed',
      'step-visual': 'not-scored',
    });
  });

  it('fails Plan when it names none of the reference tables', () => {
    const [plan] = workflowStepChecks(
      input({
        steps: {
          ...input().steps,
          plan: { plan: { ...PLAN.plan, entities: ['world_cup.players'] } },
        },
      }),
    );
    expect(plan.status).toBe('failed');
    expect(plan.reason).toContain('v_match_results');
  });

  it('counts a view over a reference table as naming it', () => {
    const [plan] = workflowStepChecks(
      input({
        expectedSql:
          'SELECT 1 FROM finance.transactions t JOIN finance.accounts a ON 1=1',
        steps: {
          ...input().steps,
          plan: {
            plan: { ...PLAN.plan, entities: ['finance.v_transactions'] },
          },
        },
      }),
    );
    expect(plan.status).toBe('passed');
    const [reverse] = workflowStepChecks(
      input({
        expectedSql: 'SELECT 1 FROM world_cup.v_player_goal_totals',
        steps: {
          ...input().steps,
          plan: { plan: { ...PLAN.plan, entities: ['goals', 'players'] } },
        },
      }),
    );
    expect(reverse.status).toBe('passed');
  });

  it('fails Plan for asking back on a question with a reference answer', () => {
    const s = statuses({
      steps: { plan: { plan: { ...PLAN.plan, needsClarification: true } } },
      endedOnClarification: true,
    });
    expect(s['step-plan']).toBe('failed');
  });

  it('fails Plan for asking back when the case should be answered', () => {
    const s = statuses({
      expects: { clarification: false },
      steps: {
        plan: { plan: { ...PLAN.plan, needsClarification: true } },
      },
      endedOnClarification: true,
    });
    expect(s['step-plan']).toBe('failed');
    expect(s['step-analyse']).toBe('not-scored');
    expect(s['step-write']).toBe('not-scored');
  });

  it('accepts a clarification Analyse asked instead of Plan', () => {
    const s = statuses({
      expects: { clarification: true },
      steps: { plan: PLAN },
      endedOnClarification: true,
      checks: [{ id: 'check-asked-clarification', status: 'passed' }],
    });
    expect(s['step-plan']).toBe('passed');
    expect(s['step-analyse']).toBe('not-scored');
  });

  it('blames Analyse when no query holds the reference, and spares Write', () => {
    const s = statuses({
      steps: {
        plan: PLAN,
        analyse: { queries: [WRONG] },
        validate: { ok: true, queries: [WRONG], findings: [] },
        'write-answer': { answer: 'Croatia 2' },
      },
      checks: [{ id: 'check-includes', status: 'failed' }],
    });
    expect(s['step-analyse']).toBe('failed');
    expect(s['step-validate']).toBe('failed');
    expect(s['step-write']).toBe('not-scored');
  });

  it("finds the reference in a retry's earlier attempt", () => {
    const s = statuses({
      steps: {
        ...input().steps,
        analyse: { queries: [WRONG], earlier: { queries: [RIGHT] } },
      },
    });
    expect(s['step-analyse']).toBe('passed');
  });

  it('passes Validate when it rejects a wrong result', () => {
    const s = statuses({
      steps: {
        ...input().steps,
        validate: { ok: false, queries: [WRONG], findings: [] },
      },
    });
    expect(s['step-validate']).toBe('passed');
  });

  it('fails Validate when it rejects a right result, naming the findings', () => {
    const checks = workflowStepChecks(
      input({
        steps: {
          ...input().steps,
          validate: {
            ok: false,
            queries: [RIGHT],
            findings: [{ check: 'Row count', passed: false, detail: '' }],
          },
        },
      }),
    );
    const validate = checks.find((c) => c.id === 'step-validate');
    expect(validate?.status).toBe('failed');
    expect(validate?.reason).toContain('Row count');
  });

  it('blames Write when the kept result is right and the answer is not', () => {
    const checks = workflowStepChecks(
      input({
        checks: [
          { id: 'check-numbers-grounded', status: 'failed' },
          { id: 'check-called-tool', status: 'failed' },
        ],
      }),
    );
    const write = checks.find((c) => c.id === 'step-write');
    expect(write?.status).toBe('failed');
    expect(write?.reason).toBe(
      'the kept result holds the reference, but the answer fails check-numbers-grounded',
    );
    expect(brokeAt(checks)).toBe('write');
  });

  it('does not score result steps without a reference query', () => {
    const s = statuses({ expectedSql: undefined, referenceRows: undefined });
    expect(s['step-analyse']).toBe('not-scored');
    expect(s['step-validate']).toBe('not-scored');
    expect(s['step-write']).toBe('passed');
  });

  it('scores Build visual against what the case asks', () => {
    expect(
      statuses({
        expects: { visual: true },
        steps: {
          ...input().steps,
          'build-visual': { visual: { skipped: 'no rows to chart' } },
        },
      })['step-visual'],
    ).toBe('failed');
    expect(
      statuses({
        expects: { visual: true },
        steps: {
          ...input().steps,
          'build-visual': { visual: { visualId: 'v1' } },
        },
      })['step-visual'],
    ).toBe('passed');
    expect(
      statuses({
        expects: { visual: false },
        steps: {
          ...input().steps,
          'build-visual': { visual: { visualId: 'v1' } },
        },
      })['step-visual'],
    ).toBe('failed');
  });

  it('names the first failed step in run order', () => {
    expect(
      brokeAt([
        { id: 'step-write', status: 'failed' },
        { id: 'step-analyse', status: 'failed' },
      ]),
    ).toBe('analyse');
    expect(brokeAt([{ id: 'step-plan', status: 'passed' }])).toBeUndefined();
  });
});
