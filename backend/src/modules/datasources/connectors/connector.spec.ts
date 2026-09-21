import { BadRequestException } from '@nestjs/common';
import { assertReadOnlySql, clampRows, splitEntity } from './connector';

describe('assertReadOnlySql', () => {
  it('accepts a plain SELECT unchanged', () => {
    expect(assertReadOnlySql('SELECT 1')).toBe('SELECT 1');
  });

  it('accepts a plain WITH statement unchanged', () => {
    const sql = 'WITH t AS (SELECT 1) SELECT * FROM t';
    expect(assertReadOnlySql(sql)).toBe(sql);
  });

  it('trims whitespace and a trailing semicolon', () => {
    expect(assertReadOnlySql('  SELECT 1;  ')).toBe('SELECT 1');
  });

  it('strips a leading line comment before the SELECT', () => {
    expect(assertReadOnlySql('-- explaining the query\nSELECT 1')).toBe(
      'SELECT 1',
    );
  });

  it('strips a leading block comment before the SELECT', () => {
    expect(assertReadOnlySql('/* explaining the query */ SELECT 1')).toBe(
      'SELECT 1',
    );
  });

  it('strips a leading ```sql markdown fence', () => {
    expect(assertReadOnlySql('```sql\nSELECT 1\n```')).toBe('SELECT 1');
  });

  it('strips a leading fence with no language tag', () => {
    expect(assertReadOnlySql('```\nSELECT 1\n```')).toBe('SELECT 1');
  });

  it('strips several stacked comments interleaved with blank lines', () => {
    const sql = [
      '-- one',
      '',
      '/* two */',
      '-- three',
      'SELECT 1',
    ].join('\n');
    expect(assertReadOnlySql(sql)).toBe('SELECT 1');
  });

  it('strips a comment wrapped inside a fenced block', () => {
    const sql = '```sql\n-- explaining the query\nSELECT 1\n```';
    expect(assertReadOnlySql(sql)).toBe('SELECT 1');
  });

  it('still rejects a write statement that follows a leading comment', () => {
    expect(() =>
      assertReadOnlySql('-- comment\nDROP TABLE t'),
    ).toThrow(BadRequestException);
    expect(() => assertReadOnlySql('-- comment\nDROP TABLE t')).toThrow(
      'Only read-only SELECT / WITH queries can be run.',
    );
  });

  it('still rejects a hidden semicolon smuggled inside a fenced block', () => {
    // The fence markers are framing and get stripped, but the semicolon
    // inside the fenced SQL itself is real statement content and survives.
    expect(() =>
      assertReadOnlySql('```sql\nSELECT 1; DROP TABLE t\n```'),
    ).toThrow('Only a single statement may be executed.');
  });

  it('does not let a keyword or semicolon hidden inside a stripped comment reach the executed statement', () => {
    // The DROP and the semicolon here live entirely inside the comment that
    // gets discarded — nothing is "relocated" into the statement that runs,
    // so this is not a bypass: the query that actually executes is a plain
    // single SELECT.
    const result = assertReadOnlySql(
      '/* ignore; DROP TABLE x */ SELECT 1',
    );
    expect(result).toBe('SELECT 1');
  });

  it('rejects an unterminated block comment instead of hanging or stripping past it', () => {
    expect(() => assertReadOnlySql('/* never closed SELECT 1')).toThrow(
      'Only read-only SELECT / WITH queries can be run.',
    );
  });

  it('rejects an empty statement', () => {
    expect(() => assertReadOnlySql('   ')).toThrow('Query is empty.');
  });

  it('rejects an empty statement left over after stripping a comment', () => {
    expect(() => assertReadOnlySql('-- just a comment\n')).toThrow(
      'Query is empty.',
    );
  });

  it('rejects multiple statements', () => {
    expect(() => assertReadOnlySql('SELECT 1; SELECT 2')).toThrow(
      'Only a single statement may be executed.',
    );
  });

  it('rejects a forbidden write/DDL keyword even when the statement starts with SELECT/WITH', () => {
    // Passes the prefix test (starts with "with") so it reaches the
    // forbidden-keyword check.
    expect(() =>
      assertReadOnlySql('WITH x AS (DELETE FROM t) SELECT * FROM x'),
    ).toThrow('Query contains a forbidden (write/DDL) keyword.');
  });

  it('rejects a statement that is not SELECT/WITH', () => {
    expect(() => assertReadOnlySql('EXPLAIN SELECT 1')).toThrow(
      'Only read-only SELECT / WITH queries can be run.',
    );
  });
});

describe('splitEntity', () => {
  it('splits a catalog.schema.table key and trims each part', () => {
    expect(splitEntity(' main . health . claims ')).toEqual([
      'main',
      'health',
      'claims',
    ]);
  });

  it('rejects a key with the wrong number of parts', () => {
    expect(() => splitEntity('main.health')).toThrow(BadRequestException);
    expect(() => splitEntity('main.health')).toThrow(
      'Entity must be catalog.schema.table — got "main.health"',
    );
  });

  it('rejects a key with an empty part', () => {
    expect(() => splitEntity('main..claims')).toThrow(BadRequestException);
  });
});

describe('clampRows', () => {
  it('passes a value within range through, floored', () => {
    expect(clampRows(12.9, 10, 100)).toBe(12);
  });

  it('falls back to the fallback value when the limit is zero or NaN', () => {
    expect(clampRows(0, 10, 100)).toBe(10);
    expect(clampRows(NaN, 10, 100)).toBe(10);
  });

  it('floors a negative limit to 1 rather than falling back', () => {
    // `Math.floor(-5)` is truthy, so the `|| fallback` never kicks in — the
    // final `Math.max(1, …)` is what keeps this sane.
    expect(clampRows(-5, 10, 100)).toBe(1);
  });

  it('caps at the maximum', () => {
    expect(clampRows(1_000, 10, 100)).toBe(100);
  });
});
