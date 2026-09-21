import { splitSqlStatements } from './sql-statements';

describe('splitSqlStatements', () => {
  it('splits on top-level semicolons and drops the terminator', () => {
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });

  it('ignores a trailing statement with no terminator', () => {
    expect(splitSqlStatements('SELECT 1;\nSELECT 2')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });

  it('skips blank statements from stray semicolons', () => {
    expect(splitSqlStatements(';;\nSELECT 1;;')).toEqual(['SELECT 1']);
  });

  // The whole reason this module exists: a dump's data is full of semicolons.
  it('keeps a semicolon inside a string literal', () => {
    expect(splitSqlStatements("SELECT 'a;b';")).toEqual(["SELECT 'a;b'"]);
  });

  it('handles a doubled quote inside a string literal', () => {
    expect(splitSqlStatements("SELECT 'it''s; fine';SELECT 2;")).toEqual([
      "SELECT 'it''s; fine'",
      'SELECT 2',
    ]);
  });

  it('keeps a semicolon inside a quoted identifier', () => {
    expect(splitSqlStatements('SELECT "od;d" FROM t;')).toEqual([
      'SELECT "od;d" FROM t',
    ]);
  });

  it('keeps a semicolon inside a line comment', () => {
    expect(splitSqlStatements('-- a ; comment\nSELECT 1;')).toEqual([
      '-- a ; comment\nSELECT 1',
    ]);
  });

  it('keeps a semicolon inside a nested block comment', () => {
    expect(splitSqlStatements('/* a ; /* b ; */ c */ SELECT 1;')).toEqual([
      '/* a ; /* b ; */ c */ SELECT 1',
    ]);
  });

  it('keeps a semicolon inside a dollar-quoted body', () => {
    expect(splitSqlStatements('SELECT $$a;b$$;SELECT 2;')).toEqual([
      'SELECT $$a;b$$',
      'SELECT 2',
    ]);
  });

  it('keeps a semicolon inside a tagged dollar-quoted body', () => {
    expect(splitSqlStatements('SELECT $fn$a;b$fn$;')).toEqual([
      'SELECT $fn$a;b$fn$',
    ]);
  });

  it('does not treat a bare dollar sign as a quote', () => {
    expect(splitSqlStatements("SELECT 1 $ 2;SELECT '$';")).toEqual([
      'SELECT 1 $ 2',
      "SELECT '$'",
    ]);
  });

  it('returns nothing for an empty or whitespace-only script', () => {
    expect(splitSqlStatements('')).toEqual([]);
    expect(splitSqlStatements('   \n\t ')).toEqual([]);
  });

  it('splits a multi-row INSERT the way pg_dump emits it', () => {
    const sql = [
      'INSERT INTO t VALUES',
      "\t(1, 'a;1'),",
      "\t(2, 'b;2');",
      'CREATE INDEX i ON t (id);',
    ].join('\n');
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'b;2'");
    expect(statements[1]).toBe('CREATE INDEX i ON t (id)');
  });
});
