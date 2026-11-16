/**
 * Statement smoke check for a Databricks SQL script: splits on `;` outside quotes, backticks and comments,
 * then checks each statement for balanced quotes, backticks and parentheses. Returns problems (empty = ok).
 */
export function smokeCheckStatements(script: string): string[] {
  const problems: string[] = [];
  let index = 0;
  let hasCode = false;
  let depth = 0;
  let open: string | null = null;
  let negative = false;

  const finish = (): void => {
    if (!hasCode) return;
    index++;
    if (open !== null)
      problems.push(`statement ${index}: unterminated ${open}`);
    if (negative)
      problems.push(`statement ${index}: unexpected closing parenthesis`);
    else if (depth !== 0)
      problems.push(`statement ${index}: ${depth} unclosed parenthesis`);
    hasCode = false;
    depth = 0;
    open = null;
    negative = false;
  };

  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
    if (ch === '-' && script[i + 1] === '-') {
      while (i < script.length && script[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && script[i + 1] === '*') {
      const end = script.indexOf('*/', i + 2);
      if (end === -1) {
        hasCode = true;
        open = 'block comment';
        break;
      }
      i = end + 1;
      continue;
    }
    if (/\s/.test(ch)) continue;
    hasCode = true;
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let closed = false;
      for (; j < script.length; j++) {
        if (ch !== '`' && script[j] === '\\') {
          j++;
          continue;
        }
        if (script[j] === ch) {
          closed = true;
          break;
        }
      }
      if (!closed) {
        open =
          ch === "'"
            ? 'single quote'
            : ch === '"'
              ? 'double quote'
              : 'backtick';
        break;
      }
      i = j;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) {
        negative = true;
        depth = 0;
      }
    } else if (ch === ';') finish();
  }
  finish();
  return problems;
}
