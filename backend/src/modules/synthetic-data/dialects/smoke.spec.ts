import { smokeCheckStatements } from './smoke';

describe('smokeCheckStatements', () => {
  it('passes escapes, doubled backticks, comments and semicolons inside quotes', () => {
    const script =
      "SELECT 'a\\'b;', `c``d;`; -- x ' (\n/* ( ' */ SELECT (1);\n";
    expect(smokeCheckStatements(script)).toEqual([]);
  });

  it('passes an empty script', () => {
    expect(smokeCheckStatements('')).toEqual([]);
  });

  it('flags an unterminated single quote', () => {
    expect(smokeCheckStatements("SELECT 'abc;")[0]).toMatch(
      /unterminated single quote/,
    );
  });

  it('flags a string closed only by an escaped quote', () => {
    expect(smokeCheckStatements("SELECT 'abc\\';")[0]).toMatch(/single quote/);
  });

  it('flags an unterminated backtick', () => {
    expect(smokeCheckStatements('SELECT `abc;')[0]).toMatch(/backtick/);
  });

  it('flags unclosed and extra parentheses', () => {
    expect(smokeCheckStatements('SELECT (1;')[0]).toMatch(
      /unclosed parenthesis/,
    );
    expect(smokeCheckStatements('SELECT 1);')[0]).toMatch(
      /closing parenthesis/,
    );
  });

  it('flags an unterminated block comment', () => {
    expect(smokeCheckStatements('SELECT 1; /* open')[0]).toMatch(
      /block comment/,
    );
  });

  it('reports the failing statement number', () => {
    expect(smokeCheckStatements('SELECT 1; SELECT (2;')[0]).toMatch(
      /^statement 2:/,
    );
  });
});
