import { CHIEF_OF_STAFF_AGENT_KEY } from '../agent-constants';
import type { EvalCustomCheck, EvalCustomCheckInput } from './assistant.evals';
import { derivedFigures, matchesRounded } from './derived-figures';
import type { AveryRunCall, AveryRunView } from './avery-workflow-target';

/**
 * Custom checks of the `avery-michael-workflow` set (agents.md 8.1, 5.23):
 * what Avery did in one whole run of Answer a Business Question (Avery +
 * Michael), read from the stored run (`details.output`, `AveryRunView`).
 * Avery sees each tool's result as its tool hands it to her (no
 * `toModelOutput`): answer_from_data's result holds Michael's reply, his
 * queries' outcome and his checks; the checks read that reply as the run
 * stores it. Each description is the rule as the check applies it.
 */

/** The tools this workflow gives her for a question on data (agents.md 2.21). */
export const AVERY_QUESTION_TOOLS: readonly string[] = [
  'skill',
  'skill_read',
  'skill_search',
  'answer_from_data',
  'ask_clarification',
];

/** The run the case's target stored, as the checks read it. */
export function runViewOf(input: EvalCustomCheckInput): AveryRunView {
  const view = input.details?.output as AveryRunView | undefined;
  if (!view || !Array.isArray(view.calls)) {
    throw new Error('the case has no stored run to read (details.output)');
  }
  return view;
}

/** Avery's own calls (signed `chief-of-staff`), in call order. */
export function averyCalls(view: AveryRunView): AveryRunCall[] {
  return view.calls.filter((call) => call.agent === CHIEF_OF_STAFF_AGENT_KEY);
}

/** How many questions she asked the user: her calls, or the run's wait. */
export function questionsAsked(view: AveryRunView): number {
  const calls = averyCalls(view).filter(
    (call) => call.tool === 'ask_clarification',
  ).length;
  // The run stops her stream at her question, before its call is stored.
  return Math.max(calls, view.waitingFor ? 1 : 0);
}

/** She called answer_from_data between `min` and `max` times. */
export function answerFromDataCalls(min: number, max: number): EvalCustomCheck {
  const times = min === max ? `exactly ${min}` : `between ${min} and ${max}`;
  return {
    id: 'answer-from-data-calls',
    description: `Avery calls answer_from_data ${times} times`,
    run: (input) => {
      const count = averyCalls(runViewOf(input)).filter(
        (call) => call.tool === 'answer_from_data',
      ).length;
      return count >= min && count <= max
        ? undefined
        : `she called answer_from_data ${count} times`;
    },
  };
}

/** She asks the user one question at most. */
export function asksAtMostOnce(): EvalCustomCheck {
  return {
    id: 'asks-at-most-once',
    description: 'Avery asks the user at most one question (ask_clarification)',
    run: (input) => {
      const count = questionsAsked(runViewOf(input));
      return count <= 1 ? undefined : `she asked ${count} questions`;
    },
  };
}

/** Every call she makes is one of her tools for a question on data. */
export function callsOnlyHerTools(
  tools: readonly string[] = AVERY_QUESTION_TOOLS,
): EvalCustomCheck {
  return {
    id: 'only-her-tools',
    description: `Avery calls only her tools for a question on data: ${tools.join(', ')}`,
    run: (input) => {
      const other = averyCalls(runViewOf(input))
        .map((call) => call.tool)
        .filter((tool) => !tools.includes(tool));
      return other.length
        ? `she called ${[...new Set(other)].join(', ')}`
        : undefined;
    },
  };
}

/** The run ended with one of `statuses`. */
export function runEndsIn(statuses: readonly string[]): EvalCustomCheck {
  return {
    id: 'run-status',
    description: `The run ends ${statuses.join(' or ')}`,
    run: (input) => {
      const view = runViewOf(input);
      return statuses.includes(view.status)
        ? undefined
        : `the run ended ${view.status}${view.error ? `: ${view.error}` : ''}`;
    },
  };
}

/** A playbook file path, as her skill_read input names it. */
const PLAYBOOK_FILE = /(?:^|\/)references?\/([\w-]+)\.md$/;

/** The playbooks she read (`skill_read reference/<name>.md`), by name. */
export function playbooksRead(view: AveryRunView): string[] {
  return averyCalls(view)
    .filter((call) => call.tool === 'skill_read')
    .map((call) => PLAYBOOK_FILE.exec(call.input?.trim() ?? '')?.[1])
    .filter((name): name is string => Boolean(name));
}

/** She reads the playbook `name` (`reference/<name>.md`). */
export function readsPlaybook(name: string): EvalCustomCheck {
  return {
    id: 'reads-playbook',
    description: `Avery reads the ${name} playbook (skill_read reference/${name}.md)`,
    run: (input) => {
      const read = playbooksRead(runViewOf(input));
      return read.includes(name)
        ? undefined
        : `she read ${read.length ? read.map((n) => `${n}.md`).join(', ') : 'no playbook file'}`;
    },
  };
}

/** She reads no playbook file (the question scores 0–1: no playbook). */
export function readsNoPlaybook(): EvalCustomCheck {
  return {
    id: 'reads-no-playbook',
    description:
      'Avery reads no playbook file (no skill_read of a reference/<name>.md)',
    run: (input) => {
      const read = playbooksRead(runViewOf(input));
      return read.length
        ? `she read ${read.map((n) => `${n}.md`).join(', ')}`
        : undefined;
    },
  };
}

/** When she asks, her question offers 2 to 4 options. */
export function clarificationOffersOptions(): EvalCustomCheck {
  return {
    id: 'clarification-options',
    description: 'When Avery asks the user, her question offers 2 to 4 options',
    run: (input) => {
      const asked = runViewOf(input).waitingFor;
      if (!asked) return undefined;
      const count = asked.options.length;
      return count >= 2 && count <= 4
        ? undefined
        : `her question offers ${count} options`;
    },
  };
}

/**
 * The sentences of a text: split after `.`, `!` or `?` followed by a space
 * and a capital, digit or quote, and at line breaks; a decimal point
 * (`2.875`) does not end one.
 */
export function sentencesOf(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=["'“‘(*_A-Z0-9])/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => /[A-Za-z0-9]/.test(sentence));
}

/** A sentence as compared: no markdown emphasis, one space, any case. */
function plain(text: string): string {
  return text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Her closing does not repeat Michael's answer (agents.md 5.23: "Do not
 * repeat Michael's answer: the user sees it"): none of his sentences of 40
 * characters or more appears in it. Its length is free since 2026-11-24:
 * a sentence count failed on every build while what she said was right.
 * A run that waits for the user has no closing yet and passes.
 */
export function closingRepeatsNoAnswer(): EvalCustomCheck {
  return {
    id: 'closing-no-repeat',
    description:
      "Avery's closing does not repeat a sentence of Michael's answer",
    run: (input) => {
      const view = runViewOf(input);
      if (view.waitingFor) return undefined;
      const closing = plain(view.closing);
      const repeated = sentencesOf(view.michaelAnswer)
        .map(plain)
        .filter((sentence) => sentence.length >= 40)
        .find((sentence) => closing.includes(sentence));
      return repeated
        ? `her closing repeats his answer: "${repeated.slice(0, 160)}"`
        : undefined;
    },
  };
}

/** A figure written in a text, with its decimals. */
export interface WrittenFigure {
  value: number;
  decimals: number;
  raw: string;
}

/**
 * The figures written in digits in a text (`88,966` is 88966, `4.3%` is
 * 4.3 with 1 decimal). A number glued to a letter before it (`Q1`) is a
 * label, not a figure.
 */
export function figuresIn(text: string): WrittenFigure[] {
  const found: string[] =
    text.match(
      /(?<![A-Za-z0-9_.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\d])/g,
    ) ?? [];
  return found.map((raw) => {
    const plain = raw.replace(/,/g, '');
    const dot = plain.indexOf('.');
    return {
      value: Number(plain),
      decimals: dot < 0 ? 0 : plain.length - dot - 1,
      raw,
    };
  });
}

/**
 * Every figure in her closing is one of Michael's: in his answer, in his
 * queries' rows or in the question, or derived from them (a sum, a
 * difference, a share as a percent or a ratio), at the decimals she wrote.
 */
export function closingFiguresFromMichael(question: string): EvalCustomCheck {
  return {
    id: 'closing-figures-from-michael',
    description:
      "Every figure in Avery's closing is in Michael's answer, his query rows or the question, or derived from them",
    run: (input) => {
      const view = runViewOf(input);
      const figures = figuresIn(view.closing);
      if (!figures.length) return undefined;
      const extra = [
        ...figuresIn(view.michaelAnswer),
        ...figuresIn(question),
      ].map((figure) => figure.value);
      const known = [
        ...derivedFigures(view.rows, extra),
        ...derivedFigures([], extra),
      ];
      const unknown = figures.filter(
        (figure) => !matchesRounded(figure.value, figure.decimals, known),
      );
      return unknown.length
        ? `her closing states ${unknown.map((f) => f.raw).join(', ')}, which no answer, row or question of the run holds`
        : undefined;
    },
  };
}
