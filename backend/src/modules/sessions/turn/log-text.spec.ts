import { logSql } from './log-text';

describe('logSql', () => {
  it('collapses newlines and runs of whitespace to single spaces', () => {
    const databricks =
      'Table not found. Verify the spelling.\nSearch path: a.b\n\tIf you did not qualify\r\nTo tolerate the error on drop';
    const out = logSql(databricks);
    expect(out).not.toMatch(/[\r\n\t]/);
    expect(out).toBe(
      'Table not found. Verify the spelling. Search path: a.b If you did not qualify To tolerate the error on drop',
    );
  });

  it('caps long text at 500 characters with an ellipsis', () => {
    const out = logSql('x'.repeat(2000));
    expect(out).toHaveLength(500);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves short single-line text unchanged', () => {
    expect(logSql('select 1')).toBe('select 1');
  });
});
