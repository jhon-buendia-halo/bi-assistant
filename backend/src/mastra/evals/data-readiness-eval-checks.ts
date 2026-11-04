import type {
  EvalCustomCheck,
  EvalCustomCheckInput,
  EvalRawToolCall,
} from './assistant.evals';
import { readinessModelOutput } from '../tools/readiness.tools';
import { callInput, callsOf, fieldText } from './rfp-eval-checks';

/**
 * The custom checks of the `data-readiness` eval set (agents.md 8.1, 2.10):
 * deterministic checks over the Data Readiness Agent's tool calls and its
 * answer. The central one, `quotedNumbersFromTools`, proves rules D2-D3: every
 * score-like number the answer quotes is a number some readiness tool
 * returned in this conversation. A check answers `undefined` when it passes
 * and the reason when it fails.
 */

/** The tools that return a `ReadinessSummary` (agents.md 3.13). */
export const SUMMARY_TOOLS = ['assess_data_readiness', 'get_readiness_report'];

/** Every readiness tool (agents.md 3.13). */
export const READINESS_TOOLS = [...SUMMARY_TOOLS, 'list_readiness_reports'];

/** The framework's skill tools (agents.md 3.9); not data calls. */
const SKILL_TOOLS = new Set(['skill', 'skill_read', 'skill_search']);

/** The dimensions the engine never assesses (rule D4). */
export const UNASSESSED_DIMENSIONS = ['accuracy', 'currency'];

/**
 * Numbers the agent may quote when it explains the method, from the
 * `data-readiness` skill (agents.md 7.4): severity thresholds, band floors,
 * severity weights, the timeliness ages, the pre-1900 date rule, the ten
 * dimensions (eight assessed, two not) and the 20 top findings. They are
 * never a score of this data, so they do not count as invented.
 */
export const METHOD_CONSTANTS = [
  0.1, 0.4, 1, 2, 8, 10, 20, 50, 70, 85, 95, 365, 730, 1900,
];

/** A summary's dimension score, as the checks read it. */
export interface DimensionScoreView {
  dimension: string;
  score: number;
  assessed: boolean;
}

/** A check with an id made from its description. */
export function drCheck(
  description: string,
  run: EvalCustomCheck['run'],
): EvalCustomCheck {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return { id: `dr-${slug}`, description, run };
}

function names(calls: EvalRawToolCall[]): string {
  return calls.map((call) => call.name).join(' → ') || 'no tool call';
}

/**
 * A call's output as an object (a JSON string is parsed), as the model saw
 * it: `assess_data_readiness` and `get_readiness_report` return
 * `{ summary, report }` raw, and the model is handed only `summary`
 * (`readinessModelOutput`, agents.md 3.13), so the checks read that.
 */
function outputObject(call: EvalRawToolCall): Record<string, unknown> | null {
  let output = call.output;
  if (typeof output === 'string') {
    try {
      output = JSON.parse(output);
    } catch {
      return null;
    }
  }
  output = readinessModelOutput(output);
  return output && typeof output === 'object'
    ? (output as Record<string, unknown>)
    : null;
}

/** The successful readiness tool results of the run, in call order. */
export function readinessOutputs(
  calls: EvalRawToolCall[],
  tools: string[] = READINESS_TOOLS,
): Record<string, unknown>[] {
  return calls
    .filter((call) => tools.includes(call.name) && !call.failed)
    .map(outputObject)
    .filter((out): out is Record<string, unknown> => out !== null);
}

/** The last successful `ReadinessSummary` of the run, if any. */
export function lastSummary(
  calls: EvalRawToolCall[],
): Record<string, unknown> | undefined {
  const summaries = readinessOutputs(calls, SUMMARY_TOOLS);
  return summaries[summaries.length - 1];
}

/** A summary's `dimensionScores`, keeping only well-formed rows. */
export function dimensionScores(
  summary: Record<string, unknown>,
): DimensionScoreView[] {
  const rows = Array.isArray(summary['dimensionScores'])
    ? (summary['dimensionScores'] as Record<string, unknown>[])
    : [];
  return rows
    .filter(
      (row) =>
        row &&
        typeof row['dimension'] === 'string' &&
        typeof row['score'] === 'number',
    )
    .map((row) => ({
      dimension: String(row['dimension']),
      score: Number(row['score']),
      assessed: row['assessed'] !== false,
    }));
}

/**
 * Every number anywhere in `value`: numeric fields, and numbers written in
 * strings (a finding's description or measured text). A fraction in [0, 1]
 * also counts as its percentage, since "0.42" is quoted as "42 %".
 */
export function numbersIn(value: unknown, into: number[] = []): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    into.push(value);
    if (value > 0 && value < 1) into.push(value * 100);
  } else if (typeof value === 'string') {
    for (const match of value.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)) {
      const parsed = Number(match[0].replace(/,/g, ''));
      if (Number.isFinite(parsed)) numbersIn(parsed, into);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) numbersIn(item, into);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) numbersIn(item, into);
  }
  return into;
}

/**
 * Counts an answer may give by counting a summary's `topFindings`: how many
 * there are, and how many per dimension, per severity and per dimension and
 * severity ("7 findings, 6 of them high"). Only counted when the summary
 * lists every finding (`findingCount` equals the list's length), so a count
 * of a cut list is never taken for a count of the data.
 */
export function topFindingCounts(outputs: Record<string, unknown>[]): number[] {
  const counts: number[] = [];
  for (const output of outputs) {
    const top = output['topFindings'];
    if (!Array.isArray(top) || output['findingCount'] !== top.length) continue;
    const groups = new Map<string, number>();
    for (const finding of top as Record<string, unknown>[]) {
      const dimension = fieldText(finding?.['dimension']);
      const severity = fieldText(finding?.['severity']);
      for (const key of [
        `d:${dimension}`,
        `s:${severity}`,
        `ds:${dimension}:${severity}`,
      ]) {
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
    }
    counts.push(top.length, ...groups.values());
  }
  return counts;
}

/** A number quoted in the answer, with the text it was found in. */
export interface QuotedNumber {
  value: number;
  /** Decimal places as written: "87.5" has 1. */
  decimals: number;
  context: string;
}

/** Words that make a nearby number a score, a band, a count or a measure (D2). */
const SCORE_WORDS =
  /\b(score[sd]?|overall|readiness|completeness|accuracy|validity|consistency|integrity|uniqueness|timeliness|currency|reasonability|accessibility|optimised|optimized|managed|defined|repeatable|initial|findings?|checks?)\b/i;

/**
 * The score-like numbers of an answer: a number followed by `%`, or a number
 * on a line (or table row) that names a score word, within 40 characters of
 * it. Dates, years in ISO dates, list markers and the denominators of
 * "out of 100" and "/100" are left out.
 */
export function quotedNumbers(answer: string): QuotedNumber[] {
  const quoted: QuotedNumber[] = [];
  const text = answer
    // ISO dates and times are when a report ran, not a score.
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?/g, ' ')
    // Clock times ("23:21:22", "09:00") are when a report ran, not a score.
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\b/g, ' ')
    // Denominators, not quoted values.
    .replace(/\s*(?:\/\s*100\b|out of 100\b)/gi, ' ')
    // Ordered list markers.
    .replace(/^\s*\d+[.)]\s/gm, ' ');
  for (const line of text.split(/\n/)) {
    for (const match of line.matchAll(
      /(?<![\w.])-?\d[\d,]*(?:\.\d+)?(?![\w])/g,
    )) {
      const raw = match[0];
      const index = match.index ?? 0;
      const after = line.slice(index + raw.length, index + raw.length + 2);
      const window = line.slice(
        Math.max(0, index - 40),
        index + raw.length + 40,
      );
      const before = line.slice(Math.max(0, index - 12), index);
      const following = line.slice(index + raw.length, index + raw.length + 12);
      // "the 3 most severe findings", "top 5": how many are shown, not a figure.
      if (
        /\b(?:top|the|these|those|first|last)\s+$/i.test(before) ||
        /^\s+(?:most|weakest|lowest|highest|worst|biggest|main|key)\b/i.test(
          following,
        )
      ) {
        continue;
      }
      // "nearly 4 years ago": a calendar reading of an age the engine gives
      // in days, not a score, band, finding or count (D2). Days stay checked.
      if (/^\s*(?:years?|months?|weeks?)\b/i.test(following)) continue;
      const isPercent = /^\s?%/.test(after);
      if (!isPercent && !SCORE_WORDS.test(window)) continue;
      const value = Number(raw.replace(/,/g, ''));
      if (!Number.isFinite(value)) continue;
      const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
      quoted.push({ value, decimals, context: window.trim() });
    }
  }
  return quoted;
}

/** Whether `quoted` is `allowed` as written: equal, or `allowed` rounded to the quoted decimals. */
export function sameNumber(quoted: QuotedNumber, allowed: number): boolean {
  const tolerance = 0.5 * 10 ** -quoted.decimals + 1e-9;
  return Math.abs(Math.abs(allowed) - Math.abs(quoted.value)) <= tolerance;
}

/**
 * D2-D3: every score-like number the answer quotes is a number a readiness
 * tool returned in this conversation, a count of a complete `topFindings`
 * list (`topFindingCounts`), or a method constant of the skill.
 * An answer that quotes such numbers with no successful readiness call fails.
 */
export function quotedNumbersFromTools(): EvalCustomCheck {
  return drCheck(
    'every score-like number in the answer is one a readiness tool returned',
    ({ answer, toolCalls }) => {
      const quoted = quotedNumbers(answer);
      if (!quoted.length) return undefined;
      const outputs = readinessOutputs(toolCalls);
      const allowed = [
        ...numbersIn(outputs),
        ...topFindingCounts(outputs),
        ...METHOD_CONSTANTS,
      ];
      const invented = quoted.filter(
        (q) => !allowed.some((value) => sameNumber(q, value)),
      );
      if (!invented.length) return undefined;
      return (
        `the answer quotes ${invented.length} number(s) no readiness tool returned: ` +
        invented
          .slice(0, 5)
          .map((q) => `${q.value} in "${q.context}"`)
          .join('; ')
      ).slice(0, 600);
    },
  );
}

/** The answer quotes the overall score of the last summary (D9). */
export function quotesOverallScore(): EvalCustomCheck {
  return drCheck(
    'the answer quotes the overall score the tool returned',
    ({ answer, toolCalls }) => {
      const summary = lastSummary(toolCalls);
      const overall = summary?.['overallScore'];
      if (typeof overall !== 'number') {
        return `no successful readiness summary to compare with; tools: ${names(toolCalls)}`;
      }
      const quoted = quotedNumbers(answer);
      return quoted.some((q) => sameNumber(q, overall))
        ? undefined
        : `the overall score ${overall} is not in the answer — it began "${answer.trim().slice(0, 160)}"`;
    },
  );
}

/** One of `tools` was called and succeeded. */
export function oneSucceeded(tools: string[]): EvalCustomCheck {
  return drCheck(
    `${tools.map((t) => `"${t}"`).join(' or ')} was called and succeeded`,
    ({ toolCalls }) =>
      toolCalls.some((call) => tools.includes(call.name) && !call.failed)
        ? undefined
        : `no successful ${tools.join(' / ')} call; tools: ${names(toolCalls)}`,
  );
}

/** The first data call (skill tools aside) is `first`. */
export function firstDataCall(first: string): EvalCustomCheck {
  return drCheck(`the first data tool call is "${first}"`, ({ toolCalls }) => {
    const call = toolCalls.find((c) => !SKILL_TOOLS.has(c.name));
    return call?.name === first
      ? undefined
      : `the first data call was ${call?.name ?? 'none'}; tools: ${names(toolCalls)}`;
  });
}

/** D5: the `data-readiness` skill is loaded before the first `assess_data_readiness`. */
export function skillBeforeAssess(skill = 'data-readiness'): EvalCustomCheck {
  return drCheck(
    `the "${skill}" skill is loaded before the first assessment`,
    ({ toolCalls }) => {
      const assess = toolCalls.findIndex(
        (c) => c.name === 'assess_data_readiness',
      );
      if (assess < 0) return `"assess_data_readiness" was not called`;
      const loaded = toolCalls
        .slice(0, assess)
        .some(
          (c) =>
            c.name === 'skill' &&
            fieldText(callInput(c)['name']).replace(/\/SKILL\.md$/i, '') ===
              skill,
        );
      return loaded
        ? undefined
        : `no skill("${skill}") call before the assessment; tools: ${names(toolCalls)}`;
    },
  );
}

/** `name` was called at most `max` times. */
export function calledAtMost(name: string, max: number): EvalCustomCheck {
  return drCheck(`"${name}" called at most ${max}×`, ({ toolCalls }) => {
    const count = callsOf(toolCalls, name).length;
    return count > max ? `"${name}" was called ${count}×` : undefined;
  });
}

/**
 * The readiness tools received only the inputs agents.md 3.13 defines
 * (`dataset`, `reportId`): no attempt to pass a score in.
 */
export function onlyDefinedInputs(): EvalCustomCheck {
  const allowed = new Set(['dataset', 'reportId']);
  return drCheck(
    'readiness tools were called only with dataset and reportId',
    ({ toolCalls }) => {
      const bad = toolCalls.find(
        (call) =>
          READINESS_TOOLS.includes(call.name) &&
          Object.keys(callInput(call)).some((key) => !allowed.has(key)),
      );
      return bad
        ? `"${bad.name}" was called with ${JSON.stringify(callInput(bad)).slice(0, 300)}`
        : undefined;
    },
  );
}

/**
 * The answer names the lowest-scoring assessed dimension of the last summary
 * (any of them, on a tie).
 */
export function namesWeakestDimension(): EvalCustomCheck {
  return drCheck(
    'the answer names the lowest-scoring assessed dimension',
    ({ answer, toolCalls }) => {
      const summary = lastSummary(toolCalls);
      if (!summary) {
        return `no successful readiness summary; tools: ${names(toolCalls)}`;
      }
      const assessed = dimensionScores(summary).filter((d) => d.assessed);
      if (!assessed.length) return 'the summary has no assessed dimension';
      const lowest = Math.min(...assessed.map((d) => d.score));
      const weakest = assessed.filter((d) => d.score === lowest);
      return weakest.some((d) =>
        new RegExp(`\\b${d.dimension}\\b`, 'i').test(answer),
      )
        ? undefined
        : `the answer names none of the weakest dimension(s) ${weakest
            .map((d) => `${d.dimension} (${d.score})`)
            .join(', ')}`;
    },
  );
}

/**
 * D4: accuracy and currency get no score. A line naming one of them must not
 * pair it with a percentage, an "x/100", or a number right after it
 * ("Accuracy: 80", "| Accuracy | 80 |").
 */
export function noScoreForUnassessed(): EvalCustomCheck {
  return drCheck('accuracy and currency are given no score', ({ answer }) => {
    for (const line of answer.split(/\n/)) {
      for (const dim of UNASSESSED_DIMENSIONS) {
        const at = line.toLowerCase().indexOf(dim);
        if (at < 0) continue;
        const rest = line.slice(at + dim.length);
        if (
          /^\W{0,4}\d/.test(rest) ||
          /^[^.\n]{0,40}?\d+(?:\.\d+)?\s?(?:%|\/\s*100)/.test(rest)
        ) {
          return `the answer scores ${dim}: "${line.trim().slice(0, 160)}"`;
        }
      }
    }
    return undefined;
  });
}

/** The answer never matches `pattern`. */
export function answerExcludes(
  pattern: RegExp,
  description: string,
): EvalCustomCheck {
  return drCheck(`answer ${description}`, ({ answer }) => {
    const hit = answer.match(pattern);
    return hit ? `the answer contains "${hit[0]}"` : undefined;
  });
}

/** Re-exported for the set and its spec. */
export type { EvalCustomCheckInput };
