import type { EvalCustomCheck, EvalRawToolCall } from './assistant.evals';

/**
 * Custom checks of the `analyst-v2` set (agents.md 8.1): deterministic parts of
 * what the data-analyst answer must do. The dataset tools hand the model their
 * raw output (no `toModelOutput`), so the checks read `rows` as the model saw
 * them. Judge rubrics grade the rest (headline, assumptions, no parametric
 * facts).
 */

/** Lower-case, accents removed (Perišić = Perisic), for name matching. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

/**
 * Every number in a text: digits (thousands separators removed, `88,966` ->
 * 88966) and the words zero to twelve ("Only one goal" states 1).
 */
export function numbersInText(text: string): number[] {
  const found: string[] = text.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const digits = found
    .map((raw) => Number(raw.replace(/,(?=\d{3}\b)/g, '').replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
  const tokens: string[] = text.toLowerCase().match(/\b[a-z]+\b/g) ?? [];
  const words = tokens
    .map((word) => NUMBER_WORDS.indexOf(word))
    .filter((index) => index >= 0);
  return [...digits, ...words];
}

/** A figure the answer must state, within `tolerance` (0 = exact). */
export interface ExpectedNumber {
  value: number;
  tolerance?: number;
}

function stated(numbers: number[], expected: ExpectedNumber): boolean {
  const tolerance = expected.tolerance ?? 0;
  return numbers.some((n) => Math.abs(n - expected.value) <= tolerance + 1e-9);
}

/**
 * The answer states every number of at least one of the alternative groups
 * (several groups when two shapes of answer are both right: a total, or its
 * parts). The expected values come from the bundled fixture's seed.
 */
export function answerStatesNumbers(
  groups: ExpectedNumber[][],
): EvalCustomCheck {
  const label = groups
    .map((group) => group.map((n) => n.value).join(' and '))
    .join(' or ');
  return {
    id: 'states-numbers',
    description: `The answer states ${label}`,
    run: ({ answer }) => {
      const numbers = numbersInText(answer);
      if (groups.some((group) => group.every((n) => stated(numbers, n)))) {
        return undefined;
      }
      return `expected the answer to state ${label}; the numbers in it are ${[...new Set(numbers)].slice(0, 12).join(', ') || 'none'}`;
    },
  };
}

/** The answer names every one of `names` (case and accents ignored). */
export function answerNamesAll(names: string[]): EvalCustomCheck {
  return {
    id: 'names-all',
    description: `The answer names ${names.join(', ')}`,
    run: ({ answer }) => {
      const text = fold(answer);
      const missing = names.filter((name) => !text.includes(fold(name)));
      return missing.length
        ? `the answer does not name ${missing.join(', ')}`
        : undefined;
    },
  };
}

/** The answer states none of `terms`: facts only general knowledge would give. */
export function answerStatesNone(terms: string[]): EvalCustomCheck {
  return {
    id: 'states-none',
    description: `The answer never says ${terms.join(', ')}`,
    run: ({ answer }) => {
      const text = fold(answer);
      const hit = terms.find((term) => text.includes(fold(term)));
      return hit
        ? `the answer says "${hit}", which no query supports`
        : undefined;
    },
  };
}

/** Data rows of the Markdown tables in a text (header and separator excluded). */
export function markdownTableRows(text: string): number {
  const lines = text.split('\n').map((line) => line.trim());
  let rows = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const isRow = (line: string) => line.startsWith('|') && line.endsWith('|');
    const isSeparator = (line: string) =>
      /^\|[\s:|-]+\|$/.test(line) && line.includes('-');
    if (isRow(lines[i]) && isSeparator(lines[i + 1])) {
      let j = i + 2;
      while (j < lines.length && isRow(lines[j])) {
        rows++;
        j++;
      }
      i = j;
    }
  }
  return rows;
}

/** The answer holds a Markdown table of at least `minRows` data rows. */
export function hasMarkdownTable(minRows = 3): EvalCustomCheck {
  return {
    id: 'has-table',
    description: `The answer has a Markdown table of at least ${minRows} rows`,
    run: ({ answer }) => {
      const rows = markdownTableRows(answer);
      return rows >= minRows
        ? undefined
        : `expected a Markdown table of at least ${minRows} rows, the answer has ${rows}`;
    },
  };
}

function sqlOf(call: EvalRawToolCall): string {
  const input = call.input;
  if (input && typeof input === 'object' && 'sql' in input) {
    const sql = (input as { sql?: unknown }).sql;
    return typeof sql === 'string' ? sql : '';
  }
  return '';
}

/** The successful `run_readonly_sql` calls, in call order. */
export function successfulSql(calls: EvalRawToolCall[]): EvalRawToolCall[] {
  return calls.filter(
    (call) => call.name === 'run_readonly_sql' && !call.failed,
  );
}

/** At least one `run_readonly_sql` call ran without an error: the answer is grounded in a query. */
export function ranSuccessfulSql(): EvalCustomCheck {
  return {
    id: 'sql-succeeded',
    description: 'At least one run_readonly_sql call succeeded',
    run: ({ toolCalls }) =>
      successfulSql(toolCalls).length > 0
        ? undefined
        : 'no run_readonly_sql call succeeded',
  };
}

/**
 * A successful query filtered on the value as stored (`free_kick`, not
 * "free kick"): the model looked the format up (sample_rows or a DISTINCT)
 * instead of guessing it, or corrected a first guess.
 */
export function usesStoredValue(value: string): EvalCustomCheck {
  return {
    id: 'uses-stored-value',
    description: `A successful query uses the stored value '${value}'`,
    run: ({ toolCalls }) =>
      successfulSql(toolCalls).some((call) =>
        sqlOf(call).includes(`'${value}'`),
      )
        ? undefined
        : `no successful query filters on '${value}'; the SQL was: ${
            successfulSql(toolCalls).map(sqlOf).join(' | ').slice(0, 300) ||
            'none'
          }`,
  };
}

/**
 * The run ended on one clarifying question with 2-4 options: the answer is
 * the question, then one `- <option>` line per option (how the v2 eval
 * target scores a run that ended on a clarification).
 */
export function endsOnClarifyingQuestion(): EvalCustomCheck {
  return {
    id: 'ends-on-clarification',
    description: 'The run ended on one clarifying question with 2-4 options',
    run: ({ answer }) => {
      const lines = answer
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      const options = lines.filter((line) => line.startsWith('- '));
      if (!lines[0]?.endsWith('?')) {
        return 'the answer does not open with a question';
      }
      if (options.length < 2 || options.length > 4) {
        return `the question offers ${options.length} options, not 2-4`;
      }
      return lines.length === options.length + 1
        ? undefined
        : 'the answer holds more than the question and its options';
    },
  };
}
