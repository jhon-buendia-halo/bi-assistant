import { narrowCliEvalCases, selectCliEvalCases } from './eval-cli-selection';

const SETS = [
  {
    id: 'world-cup',
    cases: [
      { id: 'champion-2022', category: 'lookup' },
      { id: 'shootouts', split: 'held-out', category: 'aggregation' },
      { id: 'shot-conversion-2022', split: 'held-out', category: 'ratio' },
    ],
  },
  { id: 'formula-1', cases: [{ id: 'f1-champion-2023', category: 'lookup' }] },
  // Defined in code: no split, no category.
  { id: 'rfp', cases: [{ id: 'rfp-skill-first' }] },
];

describe('selectCliEvalCases', () => {
  it('runs every case of the set EVAL_SET names', () => {
    expect(selectCliEvalCases({ EVAL_SET: 'world-cup' }, SETS)).toEqual({
      caseIds: ['champion-2022', 'shootouts', 'shot-conversion-2022'],
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
        'Set EVAL_SET to one question set (world-cup, formula-1, rfp) or EVAL_CASES to comma-separated case ids',
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
      error: 'Unknown question set "tennis" (known: world-cup, formula-1, rfp)',
    });
  });

  it('refuses unknown case ids, listing every one', () => {
    expect(
      selectCliEvalCases({ EVAL_CASES: 'shootouts,nope,also-nope' }, SETS),
    ).toEqual({ error: 'Unknown eval case(s): nope, also-nope' });
  });
});

describe('narrowCliEvalCases (agents-evals R222)', () => {
  const WORLD_CUP = ['champion-2022', 'shootouts', 'shot-conversion-2022'];
  const narrow = (env: Record<string, string>, caseIds = WORLD_CUP) =>
    narrowCliEvalCases({ EVAL_SET: 'world-cup', ...env }, SETS, caseIds);

  it('keeps the selection when neither filter is set or both are blank', () => {
    expect(narrow({})).toEqual({ caseIds: WORLD_CUP });
    expect(narrow({ EVAL_SPLIT: ' ', EVAL_CATEGORY: ' , ' })).toEqual({
      caseIds: WORLD_CUP,
    });
  });

  it('keeps the questions of one split, a case with none counting as dev', () => {
    expect(narrow({ EVAL_SPLIT: 'held-out' })).toEqual({
      caseIds: ['shootouts', 'shot-conversion-2022'],
    });
    expect(narrow({ EVAL_SPLIT: ' dev ' })).toEqual({
      caseIds: ['champion-2022'],
    });
  });

  it('keeps the questions of the listed categories, in selection order', () => {
    expect(narrow({ EVAL_CATEGORY: 'ratio, lookup' })).toEqual({
      caseIds: ['champion-2022', 'shot-conversion-2022'],
    });
  });

  it('combines the two filters', () => {
    expect(
      narrow({ EVAL_SPLIT: 'held-out', EVAL_CATEGORY: 'ratio,lookup' }),
    ).toEqual({ caseIds: ['shot-conversion-2022'] });
  });

  it('refuses an unknown split', () => {
    expect(narrow({ EVAL_SPLIT: 'test' })).toEqual({
      error: 'Unknown EVAL_SPLIT "test"; use dev or held-out',
    });
  });

  it('refuses an unknown category, uncategorised included, naming the eighteen', () => {
    for (const value of ['joins', 'uncategorised']) {
      const result = narrow({ EVAL_CATEGORY: `lookup,${value}` });
      expect('error' in result ? result.error : '').toMatch(
        new RegExp(
          `^Unknown EVAL_CATEGORY "${value}"\\. Known categories: lookup, .+\\.$`,
        ),
      );
    }
  });

  it('refuses a set the filters leave empty, naming the set and the filters that are set', () => {
    expect(
      narrowCliEvalCases(
        { EVAL_SET: 'formula-1', EVAL_SPLIT: 'held-out' },
        SETS,
        ['f1-champion-2023'],
      ),
    ).toEqual({
      error: 'No question of set "formula-1" matches EVAL_SPLIT=held-out',
    });
    expect(
      narrowCliEvalCases({ EVAL_SET: 'rfp', EVAL_CATEGORY: 'lookup' }, SETS, [
        'rfp-skill-first',
      ]),
    ).toEqual({
      error: 'No question of set "rfp" matches EVAL_CATEGORY=lookup',
    });
  });

  it('names the listed cases when EVAL_CASES selected them', () => {
    expect(
      narrowCliEvalCases(
        {
          EVAL_CASES: 'champion-2022',
          EVAL_SPLIT: 'held-out',
          EVAL_CATEGORY: 'lookup, ratio',
        },
        SETS,
        ['champion-2022'],
      ),
    ).toEqual({
      error:
        'No question of the listed cases matches EVAL_SPLIT=held-out EVAL_CATEGORY=lookup,ratio',
    });
  });
});
