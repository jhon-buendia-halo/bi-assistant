import { excelSerialAsDate } from './file-preview';

describe('excelSerialAsDate (the preview grid shows dates, not serials)', () => {
  it('turns a serial in a DATE column into its date', () => {
    expect(excelSerialAsDate('43287', 'DATE')).toBe('2018-07-06');
  });

  it('keeps the time of day in a TIMESTAMP column', () => {
    expect(excelSerialAsDate('43287.5', 'TIMESTAMP')).toBe(
      '2018-07-06 12:00:00',
    );
  });

  it('leaves other columns, text and empty cells alone', () => {
    expect(excelSerialAsDate('43287', 'DOUBLE')).toBe('43287');
    expect(excelSerialAsDate('2018-07-06', 'DATE')).toBe('2018-07-06');
    expect(excelSerialAsDate(null, 'DATE')).toBeNull();
    expect(excelSerialAsDate(' ', 'DATE')).toBe(' ');
  });
});
