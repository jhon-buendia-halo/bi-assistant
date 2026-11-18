import type { EvalCustomCheck } from './assistant.evals';
import {
  METHOD_CONSTANTS,
  dimensionFindingCounts,
  dimensionPages,
  drCheck,
  fieldText,
  numbersIn,
  quotedNumbers,
  readinessOutputs,
  sameNumber,
  topFindingCounts,
} from './data-readiness-eval-checks';

/**
 * The custom checks of the `readiness-workflow` set (agents.md 8.1, story
 * 1.29.7): Explain report as the Assess Data Readiness workflow runs it.
 * The saved report is `details.report`: its summary, the one Explain
 * report's prompt carried (data-readiness R4; what `get_readiness_report`
 * hands the model), so a check compares the answer with it, not with what
 * the agent chose to read, and still fails with no tool call. Each answers
 * `undefined` when it passes and the reason when it fails.
 */

/** A dimension's entry of the saved report's `dimensionScores`. */
function dimensionOf(
  report: Record<string, unknown> | undefined,
  dimension: string,
): Record<string, unknown> | undefined {
  const scores = report?.['dimensionScores'];
  return Array.isArray(scores)
    ? (scores as Record<string, unknown>[]).find(
        (d) => d?.['dimension'] === dimension,
      )
    : undefined;
}

function quotesNumber(answer: string, value: number): boolean {
  return quotedNumbers(answer).some((q) => sameNumber(q, value));
}

/** Plain numbers of the answer, thousands separators removed. */
function plainNumbers(answer: string): number[] {
  return [...answer.matchAll(/(?<![\w.,])\d[\d,]*(?:\.\d+)?(?![\w])/g)].map(
    (match) => Number(match[0].replace(/,/g, '')),
  );
}

/** The answer gives the saved report's overall score and maturity band. */
export function quotesReportScoreAndMaturity(): EvalCustomCheck {
  return drCheck(
    'the answer gives the saved report overall score and maturity',
    ({ answer, details }) => {
      const report = details?.report;
      const score = report?.['overallScore'];
      const maturity = report?.['maturity'];
      if (typeof score !== 'number' || typeof maturity !== 'string') {
        return 'the run holds no saved report to compare with';
      }
      if (!quotesNumber(answer, score)) {
        return `the overall score ${score} is not in the answer — it began "${answer.trim().slice(0, 160)}"`;
      }
      return answer.toLowerCase().includes(maturity.toLowerCase())
        ? undefined
        : `the maturity "${maturity}" is not in the answer`;
    },
  );
}

/**
 * D2-D3 inside the workflow: every score-like number of the answer is in the
 * saved report's summary (the one Explain report's prompt carried,
 * data-readiness R4), in a readiness result Explain report read, a count of
 * a complete finding list of either, or a method constant.
 */
export function numbersFromReport(allow: number[] = []): EvalCustomCheck {
  return drCheck(
    'every score-like number in the answer is in the saved report or a result read',
    ({ answer, toolCalls, details }) => {
      const quoted = quotedNumbers(answer);
      if (!quoted.length) return undefined;
      const outputs = readinessOutputs(toolCalls);
      // The summary the prompt carried counts as a result read.
      const read = details?.report ? [details.report, ...outputs] : outputs;
      const allowed = [
        ...numbersIn(read),
        ...topFindingCounts(read),
        ...dimensionFindingCounts(outputs),
        ...METHOD_CONSTANTS,
        ...allow,
      ];
      const invented = quoted.filter(
        (q) => !allowed.some((value) => sameNumber(q, value)),
      );
      if (!invented.length) return undefined;
      return (
        `the answer quotes ${invented.length} number(s) the report does not hold: ` +
        invented
          .slice(0, 5)
          .map((q) => `${q.value} in "${q.context}"`)
          .join('; ')
      ).slice(0, 600);
    },
  );
}

/**
 * The completeness findings were read whole and the answer states their
 * total, which equals the saved report's completeness finding count.
 */
export function completenessTotalEqualsReport(): EvalCustomCheck {
  return drCheck(
    'the answer gives a completeness total equal to the saved report count',
    ({ answer, toolCalls, details }) => {
      const expected = dimensionOf(details?.report, 'completeness')?.[
        'findingCount'
      ];
      if (typeof expected !== 'number') {
        return 'the saved report holds no completeness finding count';
      }
      const pages = dimensionPages(toolCalls, 'completeness');
      const total = pages[pages.length - 1]?.['total'];
      if (total !== expected) {
        return `the completeness pages state a total of ${fieldText(total) || 'none'}; the saved report counts ${expected}`;
      }
      return plainNumbers(answer).includes(expected)
        ? undefined
        : `the answer does not give the completeness total of ${expected}`;
    },
  );
}

/**
 * The answer names a planted problem: `entity` and `count` appear in it, and
 * the same count sits in the saved report, a result Explain report read or a
 * finding source (so it was read, not recalled).
 */
export function namesPlantedFinding(
  entity: string,
  count: number,
): EvalCustomCheck {
  return drCheck(
    `the answer names the ${count} problem rows of ${entity} the report holds`,
    ({ answer, toolCalls, details }) => {
      if (!answer.toLowerCase().includes(entity.toLowerCase())) {
        return `the answer does not name ${entity}`;
      }
      if (!plainNumbers(answer).includes(count)) {
        return `the answer does not give the count ${count}`;
      }
      const grounded = [
        ...numbersIn(details?.report ?? {}),
        ...numbersIn(readinessOutputs(toolCalls)),
        ...numbersIn((details?.findingSources ?? []).map((s) => s.output)),
      ];
      return grounded.includes(count)
        ? undefined
        : `no finding of the report or its sources holds ${count}`;
    },
  );
}

/** The answer mentions every one of `texts`, in any case. */
export function answerStates(
  texts: string[],
  description: string,
): EvalCustomCheck {
  return drCheck(`the answer ${description}`, ({ answer }) => {
    const lower = answer.toLowerCase();
    const missing = texts.filter((t) => !lower.includes(t.toLowerCase()));
    return missing.length
      ? `the answer does not mention ${missing.join(', ')}`
      : undefined;
  });
}

/**
 * The answer gives the saved report's validity score, and each of `counts`
 * the agent had in front of it (the report or a result it read).
 */
export function quotesValidityFigures(counts: number[]): EvalCustomCheck {
  return drCheck(
    'the answer gives the report validity score and the invalid-value counts it read',
    ({ answer, toolCalls, details }) => {
      const score = dimensionOf(details?.report, 'validity')?.['score'];
      if (typeof score !== 'number') {
        return 'the saved report holds no validity score';
      }
      if (!quotesNumber(answer, score)) {
        return `the validity score ${score} is not in the answer`;
      }
      const read = [
        ...numbersIn(details?.report ?? {}),
        ...numbersIn(readinessOutputs(toolCalls)),
        ...numbersIn((details?.findingSources ?? []).map((s) => s.output)),
      ];
      const stated = plainNumbers(answer);
      const missing = counts.filter(
        (count) => read.includes(count) && !stated.includes(count),
      );
      return missing.length
        ? `the answer leaves out ${missing.join(', ')} from the report`
        : undefined;
    },
  );
}

/** The answer holds no money amount (a revenue figure from nowhere). */
export function noMoneyAmount(): EvalCustomCheck {
  return drCheck('the answer gives no money amount', ({ answer }) => {
    const hit = answer.match(
      /[$€£]\s?\d[\d,.]*|\b\d[\d,.]*\s?(?:USD|EUR|GBP)\b/,
    );
    return hit ? `the answer contains "${hit[0]}"` : undefined;
  });
}
