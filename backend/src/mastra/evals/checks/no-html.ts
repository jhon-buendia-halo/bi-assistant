import { fail, PASS } from './check';
import type { DeterministicCheck } from './check';
import { quote } from './turn';

/** A SQL type, as a schema dump writes it after a column name. */
const SQL_TYPE =
  '(?:integer|int|int4|int8|bigint|smallint|text|varchar|character varying|char|numeric|decimal|boolean|bool|date|timestamptz|timestamp|double precision|double|float|real|string)';

/** What the chat must never carry (agents-evals R73), each with its name. */
const FORBIDDEN: readonly [RegExp, string][] = [
  [/```[ \t]*(?:html|css|js|javascript|jsx|ts|typescript|svg|xml)\b/i, 'code'],
  [
    /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][-\w:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/,
    'HTML',
  ],
  [/[\w.#:-]+\s*\{[^{}]*?[a-z-]+\s*:\s*[^{};]+;?[^{}]*\}/i, 'CSS'],
  [/<script\b/i, 'JavaScript'],
  [/\b(?:document|window)\.[a-zA-Z]/, 'JavaScript'],
  [/\bfunction\s*[\w$]*\s*\([^)]*\)\s*\{/, 'JavaScript'],
  [/=>\s*\{/, 'JavaScript'],
  [/\b(?:const|let)\s+[\w$]+\s*=/, 'JavaScript'],
  [/\bCREATE\s+(?:TABLE|VIEW)\b/i, 'a raw schema dump'],
  [
    /\|\s*column(?:\s+name)?\s*\|\s*(?:data\s+)?type\s*\|/i,
    'a raw schema dump',
  ],
];

/** `team_id integer`, `name (text)`, `goals: int`: a column with its type. */
const COLUMN_WITH_TYPE = new RegExp(
  `\\b[a-z_][a-z0-9_]*\\s*[:(]?\\s*${SQL_TYPE}\\b\\)?`,
  'gi',
);

/** Three or more columns listed with their types read as a schema dump. */
function schemaDump(answer: string): string | undefined {
  const matches = answer.match(COLUMN_WITH_TYPE) ?? [];
  // Prose can say "the date" or "as text" once; a dump repeats the shape.
  const typed = matches.filter((match) =>
    /[_:(]|\s(?:integer|int|bigint|varchar|numeric|text|boolean|timestamp)\b/i.test(
      match,
    ),
  );
  return typed.length >= 3 ? typed.slice(0, 3).join(', ') : undefined;
}

/**
 * `noHtml` (agents-evals R73, criterion I4): the answer is prose. No HTML,
 * CSS or JavaScript ("Never paste HTML, CSS or JavaScript into the chat"),
 * and no raw schema dump ("Never dump raw schemas or column lists").
 */
export const noHtml: DeterministicCheck = {
  type: 'noHtml',
  id: 'check-no-html',
  name: 'No HTML Check',
  criterion: 'I4',
  args: { required: [], optional: [] },
  describe: () =>
    'Checks that the answer has no HTML, CSS, JavaScript or raw schema dump',
  evaluate: (turn) => {
    const answer = turn.answer ?? '';
    for (const [pattern, what] of FORBIDDEN) {
      const match = pattern.exec(answer);
      if (match)
        return fail(`the answer contains ${what}: "${quote(match[0])}"`);
    }
    const dump = schemaDump(answer);
    return dump
      ? fail(`the answer contains a raw schema dump: "${quote(dump)}"`)
      : PASS;
  },
};
