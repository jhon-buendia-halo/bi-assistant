import {
  buildExhibits,
  csvField,
  EXHIBIT_NAMES,
  exhibitCsv,
  toCsv,
} from './exhibits';
import { EMPTY_PACKAGE_DATA } from './exhibits.queries';
import { fixtureData, fixtureRfp } from './rfp-package.stub';

describe('exhibits', () => {
  it('escapes CSV fields as RFC 4180 says', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('cr\r')).toBe('"cr\r"');
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField(0.113)).toBe('0.113');
    expect(csvField(false)).toBe('false');
    expect(csvField(['Medical', 'Dental'])).toBe('Medical; Dental');
  });

  it('writes a header row and CRLF after every record', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          { a: 1, b: 'x,y' },
          { a: null, b: 2 },
        ],
      ),
    ).toBe('a,b\r\n1,"x,y"\r\n,2\r\n');
    expect(toCsv(['a', 'b'], [])).toBe('a,b\r\n');
  });

  it('builds the four exhibits in order', () => {
    const exhibits = buildExhibits(fixtureRfp(), fixtureData());
    expect(exhibits.map((e) => e.name)).toEqual([...EXHIBIT_NAMES]);
    const [census, plans, financials, carriers] = exhibits;
    // A: one row per state, census columns then state and its employees.
    expect(census.rows).toHaveLength(2);
    expect(census.rows[1]).toMatchObject({
      documentId: 'census-ic100100-2026-8680',
      totalEmployees: 26786,
      state: 'WI',
      stateEmployees: 6786,
    });
    expect(census.columns.slice(-2)).toEqual(['state', 'stateEmployees']);
    expect(plans.rows.map((r) => r.id)).toEqual([
      'pd-medical-1',
      'pd-dental-1',
    ]);
    expect(financials.rows[0]).toMatchObject({
      coverageId: 'cov-1',
      renewalIncreasePct: 0.113,
    });
    // D: the invited carriers without their ids.
    expect(carriers.rows[1]).toEqual({
      position: 2,
      insurerName: 'Delta Dental',
      lines: ['Dental'],
      incumbent: false,
      contactEmail: null,
      notes: 'Quote "PPO, DHMO" options',
    });
    expect(exhibitCsv(carriers)).toBe(
      'position,insurerName,lines,incumbent,contactEmail,notes\r\n' +
        '1,Aetna,Medical,true,rfp@aetna.example.com,\r\n' +
        '2,Delta Dental,Dental,false,,"Quote ""PPO, DHMO"" options"\r\n',
    );
  });

  it('keeps only header rows when there is no data', () => {
    const rfp = { ...fixtureRfp(), lines: [], carriers: [] };
    for (const exhibit of buildExhibits(rfp, EMPTY_PACKAGE_DATA)) {
      expect(exhibit.rows).toEqual([]);
      expect(exhibitCsv(exhibit)).toBe(exhibit.columns.join(',') + '\r\n');
    }
  });
});
