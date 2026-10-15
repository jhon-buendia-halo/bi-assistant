import { listField, optionalField, parseRows, yesNoField } from './rfp-rows';

describe('parseRows (agents.md 3.10, scalar inputs)', () => {
  it('splits rows on lines and fields on " | ", trimmed', () => {
    expect(
      parseRows('Medical | as-is | all\n  Dental |alternate| p1, p2  ', 3),
    ).toEqual({
      rows: [
        ['Medical', 'as-is', 'all'],
        ['Dental', 'alternate', 'p1, p2'],
      ],
    });
  });

  it('drops leading list markers and ignores blank lines', () => {
    expect(
      parseRows(
        '- a | b\n\n* c | d\r\n1. e | f\n  2) g | h\n• i | j\n   \n',
        2,
      ),
    ).toEqual({
      rows: [
        ['a', 'b'],
        ['c', 'd'],
        ['e', 'f'],
        ['g', 'h'],
        ['i', 'j'],
      ],
    });
  });

  it('refuses a row with the wrong field count, naming it', () => {
    expect(parseRows('a | b | c\n\n- d | e', 3)).toEqual({
      error: 'Row 2 "d | e": expected 3 fields separated by " | "',
    });
    expect(parseRows('a | b | c | d', 3)).toEqual({
      error: 'Row 1 "a | b | c | d": expected 3 fields separated by " | "',
    });
  });

  it('gives no rows for an empty text', () => {
    expect(parseRows('', 4)).toEqual({ rows: [] });
    expect(parseRows('\n  \n', 4)).toEqual({ rows: [] });
  });
});

describe('field helpers', () => {
  it('reads "-" and empty as absent', () => {
    expect(optionalField('-')).toBeUndefined();
    expect(optionalField('  ')).toBeUndefined();
    expect(optionalField(' Self-Funded ')).toBe('Self-Funded');
  });

  it('splits comma lists', () => {
    expect(listField('Dental, Vision ,')).toEqual(['Dental', 'Vision']);
    expect(listField('-')).toEqual([]);
  });

  it('reads yes and no, with or without a leading word', () => {
    expect(yesNoField('incumbent yes')).toBe(true);
    expect(yesNoField('required NO')).toBe(false);
    expect(yesNoField('yes')).toBe(true);
    expect(yesNoField('maybe')).toBeUndefined();
  });
});
