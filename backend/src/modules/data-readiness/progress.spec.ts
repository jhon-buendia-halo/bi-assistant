import { MAX_PROFILED_ROWS, maxProfiledRows } from './progress';

describe('maxProfiledRows (BA-323)', () => {
  it('defaults to MAX_PROFILED_ROWS', () => {
    expect(maxProfiledRows({})).toBe(MAX_PROFILED_ROWS);
  });
  it('honours a positive integer override', () => {
    expect(maxProfiledRows({ READINESS_MAX_PROFILED_ROWS: '10' })).toBe(10);
  });
  it.each(['0', '-5', 'abc', '1.5', ''])('ignores %p', (raw) => {
    expect(maxProfiledRows({ READINESS_MAX_PROFILED_ROWS: raw })).toBe(
      MAX_PROFILED_ROWS,
    );
  });
});
