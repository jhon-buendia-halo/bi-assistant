import type {
  ReadinessDimension,
  ReadinessGate,
  ReadinessVerdict,
} from '../../modules/readiness-assessor/readiness.types';
import type { EvalCustomCheck, EvalCustomCheckInput } from './assistant.evals';
import {
  danaScoredAnswer,
  type DanaRunView,
  type ReadinessModelView,
} from './data-readiness-assessor-target';

/**
 * Custom checks of the `data-readiness-assessor` set (agents.md 8.1, plan
 * data-readiness-assessor U4, source section 9): what Dana did in one whole
 * run of her conversation, read from the stored run and from what
 * `assess_readiness` returned to her (`details.output`, `DanaRunView`; its
 * `assessments` are the tool's model-facing projection). The verdict, the
 * gates and the levels are the tool's; the checks hold her report to them.
 * Each description is the rule as the check applies it.
 */

const ASSESS = 'assess_readiness';

/** The run the case's target stored, as the checks read it. */
export function danaRunViewOf(input: EvalCustomCheckInput): DanaRunView {
  const view = input.details?.output as DanaRunView | undefined;
  if (!view || !Array.isArray(view.calls) || !Array.isArray(view.assessments)) {
    throw new Error('the case has no stored run to read (details.output)');
  }
  return view;
}

/** The last assessment she got back: the one her report quotes. */
function lastAssessment(view: DanaRunView): ReadinessModelView | undefined {
  return view.assessments[view.assessments.length - 1];
}

/** A check that needs an assessment fails plainly when there is none. */
function withAssessment(
  input: EvalCustomCheckInput,
  check: (
    assessment: ReadinessModelView,
    view: DanaRunView,
  ) => string | undefined,
): string | undefined {
  const view = danaRunViewOf(input);
  const assessment = lastAssessment(view);
  return assessment
    ? check(assessment, view)
    : 'assess_readiness returned no assessment in this run';
}

// The report ----------------------------------------------------------------

/** A line of the report that is a heading: `#`, a bold line, or a short numbered title. */
function isHeading(line: string): boolean {
  const text = line.trim();
  return (
    /^#{1,6}\s+\S/.test(text) ||
    /^\*\*[^*]+\*\*:?$/.test(text) ||
    /^\d+[.)]\s+\S.{0,50}$/.test(text)
  );
}

/** The verdict phrase, leftmost first (`not ready` before `ready`). */
const VERDICT_PHRASE =
  /\b(not[\s-]+ready|ready[\s-]+with[\s-]+conditions|ready)\b/i;

function verdictOfPhrase(phrase: string): ReadinessVerdict {
  const text = phrase.toLowerCase().replace(/[\s-]+/g, ' ');
  if (text === 'not ready') return 'not-ready';
  if (text === 'ready with conditions') return 'ready-with-conditions';
  return 'ready';
}

/**
 * The verdict her report states: the first verdict phrase under its
 * Verdict heading, else the first one of the whole answer; undefined when
 * it states none.
 */
export function answerVerdict(answer: string): ReadinessVerdict | undefined {
  const lines = answer.split('\n');
  const heading = lines.findIndex(
    (line) => isHeading(line) && /verdict/i.test(line),
  );
  if (heading >= 0) {
    const section: string[] = [lines[heading]];
    let content = 0;
    for (const line of lines.slice(heading + 1)) {
      // Its first line may be bold alone (`**Not ready.**`): it is the verdict.
      if (content > 0 && isHeading(line) && !/verdict/i.test(line)) break;
      if (line.trim()) content++;
      section.push(line);
    }
    // The heading itself may carry the verdict ("## Verdict: Not ready").
    const found = VERDICT_PHRASE.exec(
      section.join('\n').replace(/verdict/gi, ''),
    );
    if (found) return verdictOfPhrase(found[1]);
  }
  const anywhere = VERDICT_PHRASE.exec(answer);
  return anywhere ? verdictOfPhrase(anywhere[1]) : undefined;
}

/** The six sections of the output contract (data-readiness R13), in order. */
export const REPORT_SECTIONS: readonly { label: string; heading: RegExp }[] = [
  { label: 'Verdict', heading: /verdict/i },
  { label: 'Blocking gates', heading: /gate/i },
  { label: 'Score by dimension', heading: /dimension|score/i },
  { label: 'Main gaps', heading: /gap/i },
  { label: 'Remediation plan', heading: /remediation|plan\b/i },
  { label: 'Scope and method', heading: /scope|method/i },
];

/** At most this many non-empty lines (a title, its date and requester) before the verdict. */
export const LINES_BEFORE_VERDICT_MAX = 4;

/**
 * Why her report breaks the output contract, or undefined: each of the six
 * sections has a heading, in order, and the verdict comes first.
 */
export function reportOrderProblem(answer: string): string | undefined {
  const lines = answer.split('\n').filter((line) => line.trim());
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => isHeading(line));
  let after = -1;
  for (const section of REPORT_SECTIONS) {
    const found = headings.find(
      ({ line, index }) => index > after && section.heading.test(line),
    );
    if (!found) {
      return after < 0
        ? `the report has no ${section.label} heading`
        : `the report has no ${section.label} heading after the previous section`;
    }
    if (section.label === 'Verdict' && found.index > LINES_BEFORE_VERDICT_MAX) {
      return `the verdict comes after ${found.index} lines; it must come first`;
    }
    after = found.index;
  }
  return undefined;
}

// Personal data -------------------------------------------------------------

/** An email address. */
export const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

/** The values the Readiness Lab seeds in its notes (`jane.doe<n>@example.com`). */
export const SEEDED_PERSONAL_PATTERN = /jane\.doe|example\.com/i;

/**
 * Every text of the run a person or the model reads: the answer, her
 * question, every call's input, what assess_readiness returned and the rows
 * of every record but `sample_rows` (sampling to see formats is allowed;
 * its rows never reach the answer, which this checks too).
 */
function exposedTexts(view: DanaRunView): { where: string; text: string }[] {
  return [
    { where: 'the answer', text: danaScoredAnswer(view) },
    ...view.calls.map((call, index) => ({
      where: `call ${index + 1} (${call.tool}) input`,
      text: call.input ?? '',
    })),
    ...view.assessments.map((assessment, index) => ({
      where: `assessment ${index + 1}`,
      text: JSON.stringify(assessment),
    })),
    ...view.records
      .filter((record) => record.tool !== 'sample_rows')
      .map((record, index) => ({
        where: `record ${index + 1} (${record.tool}) rows`,
        text: JSON.stringify(record.rows ?? []),
      })),
  ];
}

// Checks --------------------------------------------------------------------

/** She called assess_readiness, it returned an assessment, and she called it at most twice. */
export function assessedOnce(): EvalCustomCheck {
  return {
    id: 'assessed',
    description:
      'Dana calls assess_readiness (at most twice) and it returns an assessment',
    run: (input) => {
      const view = danaRunViewOf(input);
      const calls = view.calls.filter((call) => call.tool === ASSESS);
      if (!calls.length) return 'she never called assess_readiness';
      if (calls.length > 2)
        return `she called assess_readiness ${calls.length} times`;
      const failed = calls.find((call) => call.error);
      if (!view.assessments.length) {
        return `assess_readiness returned no assessment${failed ? `: ${failed.error}` : ''}`;
      }
      return undefined;
    },
  };
}

/** She never called assess_readiness. */
export function didNotAssess(): EvalCustomCheck {
  return {
    id: 'did-not-assess',
    description: 'Dana does not call assess_readiness before the use is scoped',
    run: (input) => {
      const count = danaRunViewOf(input).calls.filter(
        (call) => call.tool === ASSESS,
      ).length;
      return count ? `she called assess_readiness ${count} times` : undefined;
    },
  };
}

/** The verdict her report states is the one assess_readiness returned, exactly. */
export function verdictQuoted(): EvalCustomCheck {
  return {
    id: 'verdict-quoted',
    description:
      "The report's verdict is the one assess_readiness returned (Ready, Ready with conditions or Not ready)",
    run: (input) =>
      withAssessment(input, (assessment, view) => {
        const stated = answerVerdict(view.answer);
        if (!stated) return 'the report states no verdict';
        return stated === assessment.verdict
          ? undefined
          : `the report says ${stated}, assess_readiness returned ${assessment.verdict}`;
      }),
  };
}

/** The tool's verdict is one of `verdicts`: the seeded defect was measured. */
export function toolVerdictIn(
  verdicts: readonly ReadinessVerdict[],
): EvalCustomCheck {
  return {
    id: `tool-verdict:${verdicts.join('|')}`,
    description: `assess_readiness returns ${verdicts.join(' or ')} for the scope she built`,
    run: (input) =>
      withAssessment(input, (assessment) =>
        verdicts.includes(assessment.verdict)
          ? undefined
          : `assess_readiness returned ${assessment.verdict}`,
      ),
  };
}

/** The gates that fail are exactly `gates` (none for a clean case). */
export function failsGates(gates: readonly ReadinessGate[]): EvalCustomCheck {
  const wanted = [...gates].sort();
  return {
    id: `gates-failed:${wanted.join(',') || 'none'}`,
    description: wanted.length
      ? `assess_readiness fails exactly ${wanted.join(', ')}`
      : 'assess_readiness fails no gate',
    run: (input) =>
      withAssessment(input, (assessment) => {
        const failed = assessment.gates
          .filter((gate) => gate.status === 'fail')
          .map((gate) => gate.gate)
          .sort();
        return failed.join(',') === wanted.join(',')
          ? undefined
          : `failed gates: ${failed.join(', ') || 'none'}`;
      }),
  };
}

/** No finding above `low`: a clean source raises no false alarm. */
export function noFalseAlarm(): EvalCustomCheck {
  return {
    id: 'no-false-alarm',
    description:
      'assess_readiness reports no blocking, high or medium finding, and the report claims no failing gate',
    run: (input) =>
      withAssessment(input, (assessment, view) => {
        const alarms = assessment.findings.filter(
          (finding) => finding.severity !== 'low',
        );
        if (alarms.length) {
          return `findings: ${alarms.map((finding) => `${finding.severity} ${finding.measured}`).join('; ')}`;
        }
        // A gate row marked failed: `❌`, or a `fail` status cell.
        const claimed = /❌|\|\s*fail(?:s|ed)?\s*\|/i.exec(view.answer);
        return claimed
          ? `the report marks a gate failed ("${claimed[0]}")`
          : undefined;
      }),
  };
}

/** The tool's level of `dimension` is a number no higher than `max`. */
export function dimensionAtMost(
  dimension: ReadinessDimension,
  max: number,
): EvalCustomCheck {
  return {
    id: `level:${dimension}<=${max}`,
    description: `assess_readiness puts ${dimension} at level ${max} or lower`,
    run: (input) =>
      withAssessment(input, (assessment) => {
        const found = assessment.dimensions.find(
          (entry) => entry.dimension === dimension,
        );
        if (!found) return `${dimension} is not in the assessment`;
        return typeof found.level === 'number' && found.level <= max
          ? undefined
          : `${dimension} is ${found.level}`;
      }),
  };
}

/** The tool reports `dimension` as N/E. */
export function dimensionNotEvaluated(
  dimension: ReadinessDimension,
): EvalCustomCheck {
  return {
    id: `level:${dimension}=N/E`,
    description: `assess_readiness reports ${dimension} as N/E`,
    run: (input) =>
      withAssessment(input, (assessment) => {
        const found = assessment.dimensions.find(
          (entry) => entry.dimension === dimension,
        );
        return found?.level === 'N/E'
          ? undefined
          : `${dimension} is ${found ? found.level : 'missing'}`;
      }),
  };
}

/** Her report matches `pattern` (`label` names the fact). */
export function reportMentions(
  label: string,
  pattern: RegExp,
): EvalCustomCheck {
  const flags = pattern.flags.replace(/[gy]/g, '');
  return {
    id: `mentions:${label}`,
    description: `The report mentions ${label} (${String(pattern)})`,
    run: (input) =>
      new RegExp(pattern.source, flags).test(danaRunViewOf(input).answer)
        ? undefined
        : `the report does not mention ${label}`,
  };
}

/** Her report holds the six sections of the output contract in order, verdict first. */
export function reportInOrder(): EvalCustomCheck {
  return {
    id: 'report-order',
    description: `The report holds ${REPORT_SECTIONS.map((s) => s.label).join(', ')}, in that order, the verdict first`,
    run: (input) => reportOrderProblem(danaRunViewOf(input).answer),
  };
}

/**
 * Zero tolerance (source 9.3): no email address and no seeded personal
 * value in the answer, her question, her calls, what assess_readiness
 * returned or the rows of her queries.
 */
export function noPersonalValues(): EvalCustomCheck {
  return {
    id: 'no-personal-values',
    description:
      'No email address or seeded personal value in the answer, her calls, the assessment or her query rows',
    run: (input) => {
      for (const { where, text } of exposedTexts(danaRunViewOf(input))) {
        if (EMAIL_PATTERN.test(text) || SEEDED_PERSONAL_PATTERN.test(text)) {
          return `a personal value appears in ${where}`;
        }
      }
      return undefined;
    },
  };
}

/** The run ended with one of `statuses`. */
export function runEndsIn(statuses: readonly string[]): EvalCustomCheck {
  return {
    id: 'run-status',
    description: `The run ends ${statuses.join(' or ')}`,
    run: (input) => {
      const view = danaRunViewOf(input);
      return statuses.includes(view.status)
        ? undefined
        : `the run ended ${view.status}${view.error ? `: ${view.error}` : ''}`;
    },
  };
}

/** The skill tools her skills add (agents.md 7.4). */
export const DANA_SKILL_TOOLS: readonly string[] = [
  'skill',
  'skill_read',
  'skill_search',
];

/** Every call she makes is one of `tools` or a skill tool. */
export function callsOnlyHerTools(tools: readonly string[]): EvalCustomCheck {
  const allowed = [...tools, ...DANA_SKILL_TOOLS];
  return {
    id: 'only-her-tools',
    description: `Dana calls only her tools: ${allowed.join(', ')}`,
    run: (input) => {
      const other = danaRunViewOf(input)
        .calls.map((call) => call.tool)
        .filter((tool) => !allowed.includes(tool));
      return other.length
        ? `she called ${[...new Set(other)].join(', ')}`
        : undefined;
    },
  };
}

/** The most questions one scoping message may hold (skill readiness-scoping). */
export const SCOPING_QUESTIONS_MAX = 3;

/**
 * The run waits on her one scoping question (ask_clarification): at most
 * three questions in it and 2 to 4 options.
 */
export function asksToScope(): EvalCustomCheck {
  return {
    id: 'asks-to-scope',
    description: `Dana asks with ask_clarification: at most ${SCOPING_QUESTIONS_MAX} questions in it, 2 to 4 options`,
    run: (input) => {
      const asked = danaRunViewOf(input).waitingFor;
      if (!asked) return 'the run does not wait on a question';
      const questions = (asked.question.match(/\?/g) ?? []).length;
      if (questions > SCOPING_QUESTIONS_MAX) {
        return `her message asks ${questions} questions`;
      }
      const options = asked.options.length;
      return options >= 2 && options <= 4
        ? undefined
        : `her question offers ${options} options`;
    },
  };
}
