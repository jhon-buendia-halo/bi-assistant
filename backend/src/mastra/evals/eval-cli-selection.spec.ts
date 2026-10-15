import { selectCliEvalCases } from './eval-cli-selection';

const SETS = [
  { id: 'world-cup', cases: [{ id: 'champion-2022' }, { id: 'shootouts' }] },
  { id: 'formula-1', cases: [{ id: 'f1-champion-2023' }] },
];

describe('selectCliEvalCases', () => {
  it('runs every case of the set EVAL_SET names', () => {
    expect(selectCliEvalCases({ EVAL_SET: 'world-cup' }, SETS)).toEqual({
      caseIds: ['champion-2022', 'shootouts'],
    });
  });

  it('runs exactly the cases EVAL_CASES lists, trimmed', () => {
    expect(
      selectCliEvalCases({ EVAL_CASES: ' shootouts , champion-2022 ' }, SETS),
    ).toEqual({ caseIds: ['shootouts', 'champion-2022'] });
  });

  it('refuses when neither is set, naming the sets', () => {
    expect(selectCliEvalCases({}, SETS)).toEqual({
      error:
        'Set EVAL_SET to one question set (world-cup, formula-1) or EVAL_CASES to comma-separated case ids',
    });
    expect(
      selectCliEvalCases({ EVAL_SET: ' ', EVAL_CASES: ',' }, SETS),
    ).toEqual(selectCliEvalCases({}, SETS));
  });

  it('refuses both at once', () => {
    expect(
      selectCliEvalCases(
        { EVAL_SET: 'world-cup', EVAL_CASES: 'shootouts' },
        SETS,
      ),
    ).toEqual({ error: 'Set EVAL_SET or EVAL_CASES, not both' });
  });

  it('refuses an unknown set', () => {
    expect(selectCliEvalCases({ EVAL_SET: 'tennis' }, SETS)).toEqual({
      error: 'Unknown question set "tennis" (known: world-cup, formula-1)',
    });
  });

  it('refuses unknown case ids, listing every one', () => {
    expect(
      selectCliEvalCases({ EVAL_CASES: 'shootouts,nope,also-nope' }, SETS),
    ).toEqual({ error: 'Unknown eval case(s): nope, also-nope' });
  });
});
