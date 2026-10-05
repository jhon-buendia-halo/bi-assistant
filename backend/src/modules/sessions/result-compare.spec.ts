import { compareResults, normalizeValue, rowKey } from './result-compare';

describe('normalizeValue', () => {
  it('collapses connector-specific typings of the same number', () => {
    expect(normalizeValue('1204')).toBe(normalizeValue(1204));
    expect(normalizeValue(' 12.5 ')).toBe(normalizeValue(12.5));
    expect(normalizeValue(BigInt(7))).toBe(normalizeValue(7));
  });

  it('rounds to six significant digits', () => {
    expect(normalizeValue(0.1 + 0.2)).toBe(normalizeValue(0.3));
    expect(normalizeValue(1.23456789)).toBe('1.23457');
  });

  it('folds case and whitespace in text', () => {
    expect(normalizeValue('  Denied   Claim ')).toBe('denied claim');
  });

  it('gives null and undefined one shared marker', () => {
    expect(normalizeValue(null)).toBe('∅');
    expect(normalizeValue(undefined)).toBe('∅');
  });

  it('renders dates and booleans canonically', () => {
    expect(normalizeValue(new Date('2026-01-01T00:00:00.000Z'))).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(normalizeValue(false)).toBe('false');
  });
});

describe('rowKey', () => {
  it('ignores column names and column order', () => {
    expect(rowKey({ a: 1, b: 'x' })).toBe(rowKey({ label: 'X', total: '1' }));
  });
});

describe('compareResults', () => {
  it('matches the same rows in a different order', () => {
    const result = compareResults([{ n: 1 }, { n: 2 }], [{ n: 2 }, { n: '1' }]);
    expect(result).toEqual({ match: true, reason: '' });
  });

  it('matches two empty result sets', () => {
    expect(compareResults([], []).match).toBe(true);
  });

  it('counts duplicates — it is a multiset, not a set', () => {
    const result = compareResults([{ n: 1 }, { n: 1 }], [{ n: 1 }]);
    expect(result.match).toBe(false);
    expect(result.reason).toContain('2 expected rows vs 1 returned');
    expect(result.reason).toContain('missing');
  });

  it('rejects a different column count outright', () => {
    const result = compareResults([{ n: 1 }], [{ n: 1, extra: 'x' }]);
    expect(result.match).toBe(false);
    expect(result.reason).toBe('column count differs (expected 1, got 2)');
  });

  it('reports missing and unexpected rows', () => {
    const result = compareResults([{ n: 1 }], [{ n: 2 }]);
    expect(result.match).toBe(false);
    expect(result.reason).toContain('missing [1]');
    expect(result.reason).toContain('unexpected [2]');
  });

  it('previews at most two differing rows', () => {
    const result = compareResults([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }], []);
    expect(result.reason).toContain('(+2 more)');
  });
});

describe('width tolerance', () => {
  // Careful mode's verifier projects only what the question asked for, while
  // the analysis agent also selects the figures its answer and visuals lean on.
  const wide = [
    { line: 'Dental', kept: 2963, total: 2963, rate: 1 },
    { line: 'Vision', kept: 2963, total: 2963, rate: 1 },
  ];

  it('rejects a different column count outright by default', () => {
    const narrow = [
      { line: 'Dental', rate: 1 },
      { line: 'Vision', rate: 1 },
    ];
    const result = compareResults(wide, narrow);
    expect(result.match).toBe(false);
    expect(result.reason).toBe('column count differs (expected 4, got 2)');
  });

  it('matches a narrower projection of the same facts when tolerant', () => {
    const narrow = [
      { line: 'Dental', rate: 1 },
      { line: 'Vision', rate: 1 },
    ];
    const result = compareResults(wide, narrow, { widthTolerant: true });
    expect(result.match).toBe(true);
    expect(result.shapeDiffers).toBe(true);
    expect(result.reason).toBe('');
  });

  it('is symmetric about which side is wider', () => {
    const narrow = [
      { line: 'Dental', rate: 1 },
      { line: 'Vision', rate: 1 },
    ];
    const result = compareResults(narrow, wide, { widthTolerant: true });
    expect(result.match).toBe(true);
    expect(result.shapeDiffers).toBe(true);
  });

  // The case that motivated this: the analysis query divided a sum by itself,
  // so every rate was 1, while the verifier computed the real rates. The width
  // gate used to report "column count differs" and bury the disagreement.
  it('reports a real difference instead of the width when the figures differ', () => {
    const verifier = [
      { line: 'Dental', rate: 0.82 },
      { line: 'Vision', rate: 0.79 },
    ];
    const result = compareResults(wide, verifier, { widthTolerant: true });
    expect(result.match).toBe(false);
    expect(result.shapeDiffers).toBeUndefined();
    expect(result.reason).toContain('figures differ');
  });

  it('does not match when the narrower result has a different row count', () => {
    const narrow = [{ line: 'Dental', rate: 1 }];
    const result = compareResults(wide, narrow, { widthTolerant: true });
    expect(result.match).toBe(false);
  });

  describe('leadingRows (careful mode cross-check)', () => {
    // The live Retail run: the answer listed every category, the verifier
    // returned only the winner — same fact, capped at low as a disagreement.
    const ranking = [
      { category: 'Outdoor', units: 92 },
      { category: 'Footwear', units: 82 },
      { category: 'Electronics', units: 80 },
    ];

    it('agrees when the verifier returns the top row of the same ranking', () => {
      const result = compareResults(ranking, [{ category: 'Outdoor' }], {
        widthTolerant: true,
        leadingRows: true,
      });
      expect(result.match).toBe(true);
      expect(result.shapeDiffers).toBe(true);
    });

    it('is symmetric about which side is shorter', () => {
      const result = compareResults(
        [{ category: 'Outdoor', units: 92 }],
        ranking,
        { widthTolerant: true, leadingRows: true },
      );
      expect(result.match).toBe(true);
    });

    it('disagrees when the verifier picks a different leader', () => {
      const result = compareResults(ranking, [{ category: 'Footwear' }], {
        widthTolerant: true,
        leadingRows: true,
      });
      expect(result.match).toBe(false);
    });

    it('is off unless asked for — eval grading keeps strict row counts', () => {
      const result = compareResults(ranking, [{ category: 'Outdoor' }], {
        widthTolerant: true,
      });
      expect(result.match).toBe(false);
    });
  });

  it('still compares exactly when the widths agree', () => {
    const other = [
      { line: 'Dental', kept: 2963, total: 2963, rate: 1 },
      { line: 'Vision', kept: 1, total: 2963, rate: 1 },
    ];
    const result = compareResults(wide, other, { widthTolerant: true });
    expect(result.match).toBe(false);
    expect(result.shapeDiffers).toBeUndefined();
  });
});

describe('precision tolerance', () => {
  const tolerant = { precisionTolerant: true };
  const agree = (a: unknown, b: unknown) =>
    compareResults([{ n: a }], [{ n: b }], tolerant).match;

  // The false failures that motivated it: health-insurance references round
  // (`ROUND(x, 4)` → Postgres numeric text), answers often do not.
  it.each([
    ['0.4847', '0.48466036711966779917'],
    ['19.83', 19.826756496631376],
    ['561.62', '561.6167525773195900'],
    ['19.83', '19.8316'],
    ['561.62', '561.6152'],
    ['0.2840', 0.2840277839421242],
    [48.47, '48.466'],
    ['1235', '1234.6'],
  ])('matches %p and %p, in either order', (a, b) => {
    expect(agree(a, b)).toBe(true);
    expect(agree(b, a)).toBe(true);
  });

  it.each([
    // The coarser value carries fewer than three significant figures.
    ['0.48', '0.4847'],
    ['0', '0.4'],
    ['12', '12.4'],
    // Same number of decimals: nothing to round, so they simply differ.
    ['0.4847', '0.4848'],
    ['19.83', '19.84'],
    // Agreeing to the coarser decimals is required, not just being close.
    ['19.83', '19.8249'],
  ])('does not match %p and %p', (a, b) => {
    expect(agree(a, b)).toBe(false);
    expect(agree(b, a)).toBe(false);
  });

  it('leaves integers exact', () => {
    expect(agree(1204, '1205')).toBe(false);
    expect(agree(BigInt(1204), '1204')).toBe(true);
  });

  it('keeps the six-significant-figure rule underneath it', () => {
    expect(agree(0.1 + 0.2, '0.3')).toBe(true);
    expect(agree(1.23456789, '1.234568')).toBe(true);
  });

  it('rounds the decimal the text states, not its binary neighbour', () => {
    // 0.48465 is a float just below the tie; read as text it is the tie
    // itself, which Postgres ROUND takes away from zero to 0.4847.
    expect(agree('0.4847', 0.48465)).toBe(true);
    // A tie may also have gone the other way (half-to-even).
    expect(agree('0.4846', '0.48465')).toBe(true);
    expect(agree('-19.84', '-19.835')).toBe(true);
  });

  it('caps the decimals a float appears to show at ten', () => {
    // Different at six significant figures, equal at ten decimal places.
    expect(agree(0.00000123451, 0.00000123449)).toBe(true);
    // Ten places leave these tiny values without three significant figures.
    expect(agree(1.5e-12, 1.6e-12)).toBe(false);
  });

  it('never forgives text, dates or booleans', () => {
    expect(agree('Dental', 'dental ')).toBe(true);
    expect(agree('Dental', 'Vision')).toBe(false);
    expect(agree(true, 'true')).toBe(true);
    expect(agree(true, 1)).toBe(false);
  });

  it('pairs rows one by one, whatever their order', () => {
    const reference = [
      { specialty: 'Family Medicine', share: '0.4847' },
      { specialty: 'Dermatology', share: '0.4309' },
    ];
    const answer = [
      { share: 0.4309498575791013, name: 'Dermatology' },
      { share: 0.4846603671196678, name: 'Family Medicine' },
    ];
    expect(compareResults(reference, answer, tolerant)).toEqual({
      match: true,
      reason: '',
    });
    // Off, the same pair is the false failure this option exists for.
    expect(compareResults(reference, answer).match).toBe(false);
  });

  it('pairs duplicates as a multiset, never two rows onto one', () => {
    const reference = [{ n: '19.83' }, { n: '19.83' }];
    expect(
      compareResults(reference, [{ n: 19.8316 }, { n: 19.8297 }], tolerant)
        .match,
    ).toBe(true);
    const short = compareResults(reference, [{ n: 19.8316 }], tolerant);
    expect(short.match).toBe(false);
    expect(short.reason).toBe('2 expected rows vs 1 returned; missing [19.83]');
    const doubled = compareResults(
      [{ n: '19.83' }],
      [{ n: 19.8316 }, { n: 19.8297 }],
      tolerant,
    );
    expect(doubled.match).toBe(false);
    expect(doubled.reason).toContain('unexpected');
  });

  it('matches cells by value, not by their text order in the row', () => {
    // As text "10" sorts before "5.21", while 9.996 sorts after 5.2093, so
    // lining up sorted text would pair 10 with 5.2093.
    expect(
      compareResults(
        [{ a: '10.0', b: '5.21' }],
        [{ a: 9.996, b: 5.2093 }],
        tolerant,
      ).match,
    ).toBe(true);
  });

  it('reports what stays unpaired in the exact path format', () => {
    const result = compareResults(
      [{ region: 'Gulf Coast Texas', paid: '63185.95' }],
      [{ region: 'Gulf Coast Texas', paid: '68521.15' }],
      tolerant,
    );
    expect(result.match).toBe(false);
    expect(result.reason).toBe(
      'missing [63185.9 | gulf coast texas]; unexpected [68521.1 | gulf coast texas]',
    );
  });

  it('combines with width tolerance: a narrower projection within rounding', () => {
    const wide = [
      { specialty: 'Family Medicine', paid: 58862147, share: 0.48466036 },
      { specialty: 'Dermatology', paid: 6510043, share: 0.43094985 },
    ];
    const narrow = [
      { specialty: 'Dermatology', share: '0.4309' },
      { specialty: 'Family Medicine', share: '0.4847' },
    ];
    const both = { widthTolerant: true, precisionTolerant: true };
    expect(compareResults(narrow, wide, both)).toEqual({
      match: true,
      reason: '',
      shapeDiffers: true,
    });
    expect(compareResults(wide, narrow, both).shapeDiffers).toBe(true);
    // Width tolerance alone still fails on the rounding.
    expect(compareResults(narrow, wide, { widthTolerant: true }).match).toBe(
      false,
    );
    const coarse = [
      { specialty: 'Dermatology', share: '0.43' },
      { specialty: 'Family Medicine', share: '0.48' },
    ];
    const result = compareResults(coarse, wide, both);
    expect(result.match).toBe(false);
    expect(result.reason).toBe(
      'the figures differ (compared 2 columns against 3)',
    );
  });

  it('leaves the exact path untouched when off', () => {
    expect(compareResults([{ n: '0.4847' }], [{ n: 0.48466 }])).toEqual({
      match: false,
      reason: 'missing [0.4847]; unexpected [0.48466]',
    });
  });
});
