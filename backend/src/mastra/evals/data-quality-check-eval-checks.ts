import type { EvalCustomCheck } from './assistant.evals';

/**
 * The custom checks of the `data-quality-check` eval set (agents.md 8.1,
 * 5.11): Sarah's Check data quality call answers `{ issues: [{ finding,
 * impact }] }` as JSON text (`finding` is the 1-based number of an engine
 * finding in her request). A check answers `undefined` when it passes and
 * the reason when it fails.
 */

interface ParsedIssue {
  finding: unknown;
  impact: unknown;
}

/** The issues of the answer, or the reason it holds none. */
function issuesOf(answer: string): ParsedIssue[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return 'the answer is not JSON';
  }
  const issues = (parsed as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return 'the answer has no "issues" list';
  return issues as ParsedIssue[];
}

/** The finding numbers of the issues, in order (non-numbers as NaN). */
function numbersOf(issues: ParsedIssue[]): number[] {
  return issues.map((issue) =>
    typeof issue?.finding === 'number' ? issue.finding : NaN,
  );
}

/** The reply is a JSON object with an `issues` list of `{ finding, impact }`. */
export function replyIsIssues(): EvalCustomCheck {
  return {
    id: 'reply-is-issues',
    description:
      'The reply is JSON with an issues list; each issue has a finding number and an impact sentence',
    run: ({ answer }) => {
      const issues = issuesOf(answer);
      if (typeof issues === 'string') return issues;
      for (const issue of issues) {
        if (typeof issue?.finding !== 'number') {
          return `an issue has no finding number: ${JSON.stringify(issue)}`;
        }
        if (typeof issue.impact !== 'string' || !issue.impact.trim()) {
          return `finding ${issue.finding} has no impact sentence`;
        }
      }
      return undefined;
    },
  };
}

/** Every finding number is a listed one (1..count) and none is repeated. */
export function findingsInRange(count: number): EvalCustomCheck {
  return {
    id: 'findings-in-range',
    description: `Every finding number is one of the ${count} listed (1 to ${count}), none repeated`,
    run: ({ answer }) => {
      const issues = issuesOf(answer);
      if (typeof issues === 'string') return issues;
      const numbers = numbersOf(issues);
      const bad = numbers.filter(
        (n) => !Number.isInteger(n) || n < 1 || n > count,
      );
      if (bad.length > 0) {
        return `finding number(s) ${bad.join(', ')} are not in the listed 1 to ${count}`;
      }
      const repeated = numbers.filter((n, i) => numbers.indexOf(n) !== i);
      return repeated.length > 0
        ? `finding number(s) ${[...new Set(repeated)].join(', ')} repeated`
        : undefined;
    },
  };
}

/**
 * The picked numbers are exactly `expected`: each relevant one included,
 * each irrelevant one left out. An empty `expected` means no issue at all.
 */
export function picksExactly(expected: number[]): EvalCustomCheck {
  const want = [...new Set(expected)].sort((a, b) => a - b);
  return {
    id: 'picks-exact-findings',
    description: want.length
      ? `Picks exactly the findings ${want.join(', ')} and no other`
      : 'Picks no finding (issues is empty)',
    run: ({ answer }) => {
      const issues = issuesOf(answer);
      if (typeof issues === 'string') return issues;
      const got = [...new Set(numbersOf(issues))].sort((a, b) => a - b);
      const missing = want.filter((n) => !got.includes(n));
      const extra = got.filter((n) => !want.includes(n));
      if (missing.length === 0 && extra.length === 0) return undefined;
      const parts: string[] = [];
      if (missing.length) parts.push(`missed ${missing.join(', ')}`);
      if (extra.length) parts.push(`also picked ${extra.join(', ')}`);
      return `${parts.join('; ')} (expected ${want.length ? want.join(', ') : 'none'}, got ${got.length ? got.join(', ') : 'none'})`;
    },
  };
}

/** What Sarah's chat prompt makes her say: a refusal, a tool call, a score. */
const CHAT_REPLY =
  /\b(i can only|i can't help|i cannot help|outside (of )?my|not (a )?data[- ]readiness|only (help|answer)[^.]*readiness|let me (run|assess|check)|assess_data_readiness|get_readiness_report|overall (readiness )?score|readiness score)\b/i;

/** No impact sentence is the chat agent's refusal, tool talk or a score lead. */
export function noChatReply(): EvalCustomCheck {
  return {
    id: 'no-chat-reply',
    description:
      'No impact sentence declines the request, offers to run a tool or leads with a readiness score',
    run: ({ answer }) => {
      const issues = issuesOf(answer);
      if (typeof issues === 'string') return issues;
      const hit = issues
        .map((issue) => (typeof issue?.impact === 'string' ? issue.impact : ''))
        .find((impact) => CHAT_REPLY.test(impact));
      return hit ? `an impact reads like a chat reply: "${hit}"` : undefined;
    },
  };
}
