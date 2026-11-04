import { buildEvalCaseIndex, evalCaseIndex } from './eval-case-index';
import { loadEvalSets } from './eval-set-files';

describe('evalCaseIndex (agents-evals R215)', () => {
  const index = evalCaseIndex();

  it('holds every case of every question bank set, by its set case id', () => {
    const sets = loadEvalSets();
    const cases = sets.flatMap((set) => set.cases);
    expect(index.size).toBe(cases.length);
    for (const set of sets) {
      for (const evalCase of set.cases) {
        expect(index.get(evalCase.id)).toEqual({
          setId: set.id,
          split: evalCase.split,
          category: evalCase.category,
          question: evalCase.question,
        });
      }
    }
  });

  it('keeps each variant apart through its case-id prefix', () => {
    expect(index.get('champion-2022')).toEqual({
      setId: 'world-cup',
      split: 'dev',
      category: 'lookup',
      question: 'Who won the 2022 World Cup?',
    });
    expect(index.get('rest-champion-2022')?.setId).toBe('world-cup-rest');
    expect(index.get('dbx-champion-2022')?.setId).toBe('world-cup-databricks');
  });

  it('carries the split, held-out included', () => {
    expect(index.get('shot-conversion-2022')).toMatchObject({
      split: 'held-out',
      category: 'ratio',
    });
    expect(index.get('dbx-shot-conversion-2022')?.split).toBe('held-out');
    const heldOut = [...index.values()].filter((e) => e.split === 'held-out');
    expect(heldOut.length).toBeGreaterThan(0);
  });

  it('has no rfp case, which defaults to dev', () => {
    expect([...index.keys()].some((id) => id.startsWith('rfp-'))).toBe(false);
    expect(index.get('unknown-case')).toBeUndefined();
  });

  it('is built once', () => {
    expect(evalCaseIndex()).toBe(index);
  });

  it('indexes any list of sets', () => {
    const built = buildEvalCaseIndex([
      {
        id: 'a-set',
        name: 'A set',
        description: 'd',
        fixtureId: 'world-cup',
        dialect: 'postgres',
        file: 'a.json',
        cases: [
          {
            id: 'x-1',
            category: 'join',
            split: 'held-out',
            tags: [],
            question: 'Q?',
            intent: 'i',
            checks: [],
          },
        ],
      },
    ]);
    expect([...built.entries()]).toEqual([
      [
        'x-1',
        { setId: 'a-set', split: 'held-out', category: 'join', question: 'Q?' },
      ],
    ]);
  });
});
