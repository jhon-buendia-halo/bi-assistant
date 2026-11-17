import {
  MockFileSourcesApi,
  excludedRows,
  parseRange,
} from './mock-file-sources-api';

const file = (name: string, size = 100) =>
  new File([new Uint8Array(size)], name);

describe('excludedRows', () => {
  const shown = [1, 2, 3, 4, 5, 6, 7, 12482, 12483];

  it('strikes the rows above the header and the last row when asked', () => {
    const out = excludedRows(shown, 3, 'A3:F12483', true);
    expect([...out]).toEqual([1, 2, 12483]);
  });

  it('keeps the last row when it is not excluded', () => {
    expect(excludedRows(shown, 3, 'A3:F12483', false).has(12483)).toBeFalse();
  });

  it('strikes the rows outside the range', () => {
    const out = excludedRows(shown, 3, 'A5:F12482', false);
    expect([...out]).toEqual([1, 2, 3, 4, 12483]);
  });

  it('parses ranges', () => {
    expect(parseRange('A3:H12482')).toEqual({ first: 3, last: 12482 });
    expect(parseRange('nope')).toBeNull();
  });
});

describe('MockFileSourcesApi', () => {
  let api: MockFileSourcesApi;
  beforeEach(() => (api = new MockFileSourcesApi()));

  it('proposes the Region, Targets and Notes sheets for an .xlsx', async () => {
    const { file: f } = await api.upload(file('sales_2026.xlsx'));
    expect(f.schema).toBe('sales_2026');
    expect(f.sheets.map((s) => s.sheet)).toEqual([
      'Region',
      'Targets',
      'Notes',
    ]);
    expect(f.sheets[0].headerRow).toBe(3);
    expect(f.sheets[2].warnings).toEqual([{ code: 'no-table' }]);
  });

  it('gives a .csv one sheet with the header on row 1', async () => {
    const { file: f } = await api.upload(file('customers.csv'));
    expect(f.sheets.length).toBe(1);
    expect(f.sheets[0].headerRow).toBe(1);
  });

  it('refuses .xls and other extensions with the plan messages', async () => {
    await expectAsync(api.upload(file('old.xls'))).toBeRejectedWithError(
      '.xls files are not supported — save the workbook as .xlsx',
    );
    await expectAsync(api.upload(file('a.pdf'))).toBeRejectedWithError(
      'Only .xlsx and .csv files can be imported',
    );
  });

  it('recomputes the preview from the header row and the last-row switch', async () => {
    const { file: f } = await api.upload(file('sales_2026.xlsx'));
    const base = { fileId: f.id, sheet: 'Region' };
    const a = await api.preview({
      ...base,
      headerRow: 3,
      excludeLastRow: true,
    });
    const b = await api.preview({
      ...base,
      headerRow: 3,
      excludeLastRow: false,
    });
    expect(a.warnings.some((w) => w.code === 'total-row')).toBeTrue();
    expect(b.warnings.some((w) => w.code === 'total-row')).toBeFalse();
    expect(b.totalRows).toBe(a.totalRows + 1);
    const c = await api.preview({ ...base, headerRow: 4 });
    expect(c.headerRow).toBe(4);
    expect(c.range.startsWith('A4:')).toBeTrue();
  });
});
