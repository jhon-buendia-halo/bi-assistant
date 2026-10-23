import {
  CommonVocabulary,
  containsPhrase,
  normalizeText,
  sampleSchemaNames,
  schemaNamesFromSql,
  STOPWORDS,
  tokenize,
} from './common-words';

describe('leak check normalisation (agents-evals R229)', () => {
  it('strips accents, lowers case, straightens quotes and dashes', () => {
    expect(normalizeText('Café “Márquez” ‘x’ — 2024–25\n\tend')).toBe(
      'cafe "marquez" \'x\' - 2024-25 end',
    );
  });

  it('splits words on anything but letters and digits', () => {
    expect(tokenize("customer_id DON'T stop-loss 88,966")).toEqual([
      'customer',
      'id',
      'don',
      't',
      'stop',
      'loss',
      '88',
      '966',
    ]);
  });

  it('finds a phrase as whole words only', () => {
    expect(
      containsPhrase('the pet parents week campaign', 'pet parents week'),
    ).toBe(true);
    expect(containsPhrase('carpet parents weekly', 'pet parents week')).toBe(
      false,
    );
  });
});

describe('schema names (R229: common words)', () => {
  it('reads table, column and view alias names from DDL, not rows', () => {
    const sql = `CREATE TABLE finance.loans (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  principal_minor bigint NOT NULL,
  CONSTRAINT loans_ck CHECK (principal_minor > 0)
);
CREATE VIEW v_open_loans AS
SELECT loan.id AS loan_id, loan.principal_minor AS principal FROM loans loan;
INSERT INTO finance.loans VALUES (1, 'Zebrafish Holdings');
CREATE TABLE late (never_read int\n);`;
    expect(schemaNamesFromSql(sql).sort()).toEqual(
      [
        'id',
        'loan_id',
        'loans',
        'principal',
        'principal_minor',
        'v_open_loans',
      ].sort(),
    );
  });

  it('covers every bundled sample, gzipped seeds included', () => {
    const names = sampleSchemaNames();
    for (const name of [
      'world_cup',
      'tournament_year',
      'portfolios',
      'customer_id',
      'policy_sales',
      'circuit_layout',
    ]) {
      expect(names).toContain(name);
    }
  });
});

describe('CommonVocabulary (R229)', () => {
  const vocabulary = new CommonVocabulary(
    [
      'Answer from the rows. Each pet, parent and week counts; the Fiscal Year runs July to June.',
    ],
    ['policy_sales', 'state_code'],
  );

  it('calls stopwords, base words, schema words and single letters common', () => {
    expect(STOPWORDS.has('which')).toBe(true);
    for (const word of [
      'which',
      'answer',
      'rows',
      'policy',
      'sales',
      'code',
      'x',
    ]) {
      expect(vocabulary.isCommonWord(word)).toBe(true);
    }
    expect(vocabulary.isCommonWord('harborline')).toBe(false);
  });

  it('calls a phrase common only when it is in the base whole, or all schema words', () => {
    expect(vocabulary.isCommonPhrase('fiscal year')).toBe(true);
    expect(vocabulary.isCommonPhrase('policy sales')).toBe(true);
    expect(vocabulary.isCommonPhrase('pet')).toBe(true);
    // Common words that together name one thing are not common.
    expect(vocabulary.isCommonPhrase('pet parent week')).toBe(false);
    expect(vocabulary.isCommonPhrase('harborline')).toBe(false);
  });
});
