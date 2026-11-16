jest.mock('@mastra/core/evals', () => ({ runEvals: jest.fn() }));

import { dataQualityRequest } from '../workflows/answer-business-question.prompts';
import {
  DATA_QUALITY_CHECK_EVAL_SET,
  DATA_QUALITY_EXPECTED_PICKS,
} from './data-quality-check.evals';
import type { DataQualityEvalInput } from './isolated-call-targets';
import { EVAL_SETS, evalSetTargetId, setsOfTarget } from './eval-sets';

const cases = DATA_QUALITY_CHECK_EVAL_SET.cases;
const inputOf = (id: string) =>
  cases.find((c) => c.id === id)!.input as DataQualityEvalInput;

const answerOf = (numbers: number[]) =>
  JSON.stringify({
    issues: numbers.map((finding) => ({
      finding,
      impact: 'It changes this answer.',
    })),
  });

const runChecks = async (id: string, answer: string) => {
  const failures: string[] = [];
  for (const check of cases.find((c) => c.id === id)!.customChecks ?? []) {
    const reason = await check.run({
      answer,
      toolCalls: [],
      datasets: [],
      vars: {},
    });
    if (reason) failures.push(`${check.id}: ${reason}`);
  }
  return failures;
};

describe('data-quality-check eval set (agents.md 8.1, 5.11)', () => {
  it('runs Sarah’s Check data quality call over Edge Cases', () => {
    expect(DATA_QUALITY_CHECK_EVAL_SET).toMatchObject({
      id: 'data-quality-check',
      fixtureId: 'edge-cases',
      agentKey: 'data-readiness',
      target: 'data-readiness:check-data-quality',
    });
    expect(evalSetTargetId(DATA_QUALITY_CHECK_EVAL_SET)).toBe(
      'data-readiness:check-data-quality',
    );
  });

  it('is registered and found by its target', () => {
    expect(EVAL_SETS).toContain(DATA_QUALITY_CHECK_EVAL_SET);
    expect(setsOfTarget('data-readiness:check-data-quality')).toEqual([
      DATA_QUALITY_CHECK_EVAL_SET,
    ]);
  });

  it('has eight cases with dq- ids and a frozen input', () => {
    expect(cases).toHaveLength(8);
    for (const c of cases) {
      expect(c.id).toMatch(/^dq-/);
      expect(inputOf(c.id).sql.length).toBeGreaterThan(0);
    }
  });

  it('keeps every request within the 30-finding cap and builds a request', () => {
    for (const c of cases) {
      const input = inputOf(c.id);
      expect(input.findings.length).toBeLessThanOrEqual(30);
      expect(dataQualityRequest(input)).toContain(
        `Question: ${input.question}`,
      );
    }
    expect(inputOf('dq-thirty-findings-two-relevant').findings).toHaveLength(
      30,
    );
    expect(inputOf('dq-no-findings').findings).toEqual([]);
  });

  it('lists the findings most severe first', () => {
    const rank = { high: 0, medium: 1, low: 2, info: 3 } as Record<
      string,
      number
    >;
    for (const c of cases) {
      const ranks = inputOf(c.id).findings.map((f) => rank[f.severity]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it('expects the findings of the columns the SQL uses', () => {
    const top = inputOf('dq-picks-used-columns-only').findings;
    const picked = DATA_QUALITY_EXPECTED_PICKS['dq-picks-used-columns-only'];
    expect(picked.map((n) => top[n - 1].field).sort()).toEqual([
      'email',
      'order_id',
    ]);
    const wide = inputOf('dq-thirty-findings-two-relevant').findings;
    expect(
      DATA_QUALITY_EXPECTED_PICKS['dq-thirty-findings-two-relevant']
        .map((n) => wide[n - 1].field)
        .sort(),
    ).toEqual(['birth_date', 'email']);
    expect(DATA_QUALITY_EXPECTED_PICKS['dq-no-findings']).toEqual([]);
  });

  it('passes a correct reply and fails wrong ones on every case', async () => {
    for (const c of cases) {
      const expected = DATA_QUALITY_EXPECTED_PICKS[c.id];
      expect(await runChecks(c.id, answerOf(expected))).toEqual([]);
      const count = inputOf(c.id).findings.length;
      // an out-of-range number and a missed relevant finding both fail
      expect(
        (await runChecks(c.id, answerOf([...expected, count + 1]))).join(),
      ).toMatch(/findings-in-range/);
      expect(
        (await runChecks(c.id, 'I can only help with readiness.')).length,
      ).toBeGreaterThan(0);
    }
    expect(
      (await runChecks('dq-awkward-column-name', answerOf([]))).join(),
    ).toMatch(/picks-exact-findings: missed/);
  });

  it('judges only the impact, one rubric on the cases that pick something', () => {
    for (const c of cases) {
      const picks = DATA_QUALITY_EXPECTED_PICKS[c.id].length > 0;
      expect(Boolean(c.judgeRubric)).toBe(picks);
    }
  });
});
