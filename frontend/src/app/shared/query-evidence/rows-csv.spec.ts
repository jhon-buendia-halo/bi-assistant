import { rowsToCsv } from './rows-csv';

describe('rowsToCsv (plan m1-25 3c)', () => {
  it('writes the columns as the header and one CRLF line per row', () => {
    expect(
      rowsToCsv(['team', 'goals'], [{ team: 'Brazil', goals: 12 }, { team: 'Chile', goals: 0 }]),
    ).toBe('team,goals\r\nBrazil,12\r\nChile,0\r\n');
  });

  it('quotes commas, quotes and line breaks, doubling quotes', () => {
    expect(rowsToCsv(['a'], [{ a: 'x,y' }, { a: 'say "hi"' }, { a: 'l1\nl2' }])).toBe(
      'a\r\n"x,y"\r\n"say ""hi"""\r\n"l1\nl2"\r\n',
    );
  });

  it('leaves null and missing cells empty and writes objects as JSON', () => {
    expect(rowsToCsv(['a', 'b'], [{ a: null }, { a: { k: 1 }, b: true }])).toBe(
      'a,b\r\n,\r\n"{""k"":1}",true\r\n',
    );
  });
});
