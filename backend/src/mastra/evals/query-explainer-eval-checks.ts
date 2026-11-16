import type { EvalCustomCheck } from './assistant.evals';

/**
 * Custom checks of the `query-explainer` set (agents.md 8.1, 2.12): what is
 * deterministic about Hannah's explanation. The scored answer is the
 * explanation as JSON text, as the app stores it: `{ steps, fallback?, at,
 * stageCounts }` (`explainForEval`), so each check reads the shape the app
 * reads, and the judge reads the same text.
 */

/** The step fields the checks read. */
interface AnswerStep {
  verb?: unknown;
  text?: unknown;
  table?: unknown;
}

interface ExplanationAnswer {
  steps?: unknown;
  fallback?: unknown;
  stageCounts?: { status?: string; reason?: unknown };
}

/** The answer read as an explanation, or the reason it is not one. */
function explanationIn(answer: string): ExplanationAnswer | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return 'The answer is not a JSON explanation';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'The answer is not a JSON object';
  }
  return parsed;
}

function stepsOf(explanation: ExplanationAnswer): AnswerStep[] {
  return Array.isArray(explanation.steps)
    ? (explanation.steps as AnswerStep[])
    : [];
}

/** The last name of a table: `world_cup.world_cup.goals` -> `goals`. */
function tailOf(name: string): string {
  return (
    name
      .replace(/["`[\]]/g, '')
      .toLowerCase()
      .split('.')
      .pop() ?? ''
  );
}

/**
 * The reply was a usable JSON object: the steps are the model's, not the
 * code-built start and Show of `fallbackExplanation`.
 */
export function notFallback(): EvalCustomCheck {
  return {
    id: 'not-fallback',
    description:
      'The reply was a JSON object with steps (the explanation is not the code-built fallback)',
    run: ({ answer }) => {
      const explanation = explanationIn(answer);
      if (typeof explanation === 'string') return explanation;
      if (explanation.fallback === true) {
        return 'The explanation is flagged fallback: the reply was no JSON object, or held no step';
      }
      return stepsOf(explanation).length > 0
        ? undefined
        : 'The explanation has no step';
    },
  };
}

/**
 * The first step is `start`, on a table the query reads. `tables` are the
 * tables the case's statement reads (their last name is compared: the
 * explanation writes the catalogue's full name).
 */
export function startsFromATableItReads(
  tables: readonly string[],
): EvalCustomCheck {
  const wanted = tables.map(tailOf);
  return {
    id: 'starts-from-a-table-it-reads',
    description: `The first step is a start on a table the query reads (${tables.join(', ')})`,
    run: ({ answer }) => {
      const explanation = explanationIn(answer);
      if (typeof explanation === 'string') return explanation;
      const first = stepsOf(explanation)[0];
      if (!first) return 'The explanation has no step';
      if (first.verb !== 'start') {
        return `The first step is "${String(first.verb)}", not start`;
      }
      const table = typeof first.table === 'string' ? first.table : '';
      return wanted.includes(tailOf(table))
        ? undefined
        : `The start step reads "${table}", which the query does not read (it reads ${tables.join(', ')})`;
    },
  };
}

export const MAX_STEP_TEXT_IN_BUSINESS_WORDS = 160;

/**
 * SQL words a business reader should not meet. WHERE is read as written in
 * capitals only (it is also an English word); the others in any case, as
 * whole words (`joined` and `limited` are not them).
 */
const ANY_CASE_SQL =
  /\b(?:SELECT|JOIN|GROUP\s+BY|ORDER\s+BY|LIMIT)\b|\bCOUNT\s*\(/i;
const CAPITAL_SQL = /\bWHERE\b/;

function sqlWordIn(text: string): string | undefined {
  return ANY_CASE_SQL.exec(text)?.[0] ?? CAPITAL_SQL.exec(text)?.[0];
}

/** No step text is over 160 characters or holds a SQL keyword. */
export function textsInBusinessWords(): EvalCustomCheck {
  return {
    id: 'texts-in-business-words',
    description: `No step text is over ${MAX_STEP_TEXT_IN_BUSINESS_WORDS} characters or holds SQL (SELECT, JOIN, GROUP BY, WHERE, ORDER BY, LIMIT, COUNT()`,
    run: ({ answer }) => {
      const explanation = explanationIn(answer);
      if (typeof explanation === 'string') return explanation;
      const problems: string[] = [];
      for (const [i, step] of stepsOf(explanation).entries()) {
        const text = typeof step.text === 'string' ? step.text : '';
        if (text.length > MAX_STEP_TEXT_IN_BUSINESS_WORDS) {
          problems.push(`step ${i + 1} is ${text.length} characters long`);
        }
        const word = sqlWordIn(text);
        if (word) problems.push(`step ${i + 1} holds "${word}": "${text}"`);
      }
      return problems.length ? problems.join('; ') : undefined;
    },
  };
}

/** The step counts were run on the real data and `checkStageCounts` passed. */
export function countsVerified(): EvalCustomCheck {
  return {
    id: 'counts-verified',
    description:
      'The step counts ran on the real data and checkStageCounts verified them (stageCounts.status is verified)',
    run: ({ answer }) => {
      const explanation = explanationIn(answer);
      if (typeof explanation === 'string') return explanation;
      const counts = explanation.stageCounts;
      if (counts?.status === 'verified') return undefined;
      const reason =
        typeof counts?.reason === 'string' ? `: ${counts.reason}` : '';
      return `The step counts are ${counts?.status ?? 'missing'}${reason}`;
    },
  };
}
