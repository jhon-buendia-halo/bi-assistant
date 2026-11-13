import { GRAPH_PLAN, GRAPH_VALIDATE_FAILED } from './workflow-graph.testing';
import { planOutputOf, validateOutputOf } from './workflow-step-output';

describe('planOutputOf', () => {
  it('reads a plan, itself or under `plan`', () => {
    expect(planOutputOf({ ...GRAPH_PLAN })).toEqual(GRAPH_PLAN);
    expect(planOutputOf({ plan: { ...GRAPH_PLAN } })).toEqual(GRAPH_PLAN);
  });

  it('ignores a plan the step received and passes on', () => {
    expect(planOutputOf({ stopped: false, plan: { ...GRAPH_PLAN } }, true)).toBeNull();
    expect(planOutputOf({ ...GRAPH_PLAN }, true)).toEqual(GRAPH_PLAN);
  });

  it('keeps a clarification with its options', () => {
    const plan = planOutputOf({
      ...GRAPH_PLAN,
      needsClarification: true,
      clarification: { question: 'Which tournament?', options: ['2018', '2022'] },
    });
    expect(plan?.clarification).toEqual({ question: 'Which tournament?', options: ['2018', '2022'] });
  });

  it('is null for any other output', () => {
    expect(planOutputOf(undefined)).toBeNull();
    expect(planOutputOf({ answer: 'x' })).toBeNull();
    expect(planOutputOf({ measures: 'x', entities: [], needsClarification: false })).toBeNull();
  });
});

describe('validateOutputOf', () => {
  it('reads a validation beside the fields it passes on', () => {
    expect(
      validateOutputOf({ ...GRAPH_VALIDATE_FAILED, question: 'Q', plan: { ...GRAPH_PLAN }, queries: [] }),
    ).toEqual(GRAPH_VALIDATE_FAILED);
  });

  it('reads a validation with its findings', () => {
    expect(validateOutputOf({ ...GRAPH_VALIDATE_FAILED })).toEqual(GRAPH_VALIDATE_FAILED);
    expect(validateOutputOf({ validation: { ...GRAPH_VALIDATE_FAILED } })).toEqual(GRAPH_VALIDATE_FAILED);
  });

  it('is null for any other output', () => {
    expect(validateOutputOf({ ok: true })).toBeNull();
    expect(validateOutputOf({ ok: true, findings: [{ check: 'x' }] })).toBeNull();
    expect(validateOutputOf(null)).toBeNull();
  });
});
