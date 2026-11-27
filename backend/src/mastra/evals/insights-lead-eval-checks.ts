import type { EvalCustomCheck, EvalCustomCheckInput } from './assistant.evals';
import { derivedFigures, matchesRounded } from './derived-figures';
import { figuresIn } from './avery-workflow-eval-checks';
import {
  insightsLeadScoredAnswer,
  type InsightsLeadRunCall,
  type InsightsLeadRunView,
} from './insights-lead-target';

/**
 * Custom checks of the `insights-lead` set (agents.md 8.1, plan Elena 5):
 * what Elena did in one whole run of her conversation, read from the stored
 * run (`details.output`, `InsightsLeadRunView`). Each description is the
 * rule as the check applies it. They are the counterparts of Avery's checks
 * (`avery-workflow-eval-checks.ts`), so both sets compare on the same rules.
 */

/**
 * The skill tools her skills add (agents.md 7.4): reading a playbook is not
 * a tool outside her own.
 */
export const INSIGHTS_LEAD_SKILL_TOOLS: readonly string[] = [
  'skill',
  'skill_read',
  'skill_search',
];

/** The tool that runs her SQL. */
const QUERY_TOOL = 'run_readonly_sql';

/** The run the case's target stored, as the checks read it. */
export function leadRunViewOf(
  input: EvalCustomCheckInput,
): InsightsLeadRunView {
  const view = input.details?.output as InsightsLeadRunView | undefined;
  if (!view || !Array.isArray(view.calls)) {
    throw new Error('the case has no stored run to read (details.output)');
  }
  return view;
}

/** How many questions she asked the user: her calls, or the run's wait. */
export function leadQuestionsAsked(view: InsightsLeadRunView): number {
  const calls = view.calls.filter(
    (call) => call.tool === 'ask_clarification',
  ).length;
  // The run stops her stream at her question, before its call is stored.
  return Math.max(calls, view.waitingFor ? 1 : 0);
}

/** The calls of her queries that ran without an error. */
function queriesRun(view: InsightsLeadRunView): InsightsLeadRunCall[] {
  return view.calls.filter((call) => call.tool === QUERY_TOOL && !call.error);
}

/**
 * She ran at least one query that did not fail (`run_readonly_sql`), or the
 * run waits for her question's answer: an answer on data comes from data.
 */
export function ranAQuery(): EvalCustomCheck {
  return {
    id: 'ran-a-query',
    description:
      'Elena ran at least one read-only query that succeeded (or the run waits for the user)',
    run: (input) => {
      const view = leadRunViewOf(input);
      if (view.waitingFor) return undefined;
      const all = view.calls.filter((call) => call.tool === QUERY_TOOL).length;
      return queriesRun(view).length
        ? undefined
        : all
          ? `all ${all} of her queries failed`
          : 'she ran no query';
    },
  };
}

/** She asks the user one question at most. */
export function asksAtMostOnce(): EvalCustomCheck {
  return {
    id: 'asks-at-most-once',
    description: 'Elena asks the user at most one question (ask_clarification)',
    run: (input) => {
      const count = leadQuestionsAsked(leadRunViewOf(input));
      return count <= 1 ? undefined : `she asked ${count} questions`;
    },
  };
}

/**
 * Every call she makes is one of her tools (`INSIGHTS_LEAD_TOOL_NAMES`) or
 * one of her skill tools.
 */
export function callsOnlyHerTools(tools: readonly string[]): EvalCustomCheck {
  const allowed = [...tools, ...INSIGHTS_LEAD_SKILL_TOOLS];
  return {
    id: 'only-her-tools',
    description: `Elena calls only her tools: ${allowed.join(', ')}`,
    run: (input) => {
      const other = leadRunViewOf(input)
        .calls.map((call) => call.tool)
        .filter((tool) => !allowed.includes(tool));
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
      const view = leadRunViewOf(input);
      return statuses.includes(view.status)
        ? undefined
        : `the run ended ${view.status}${view.error ? `: ${view.error}` : ''}`;
    },
  };
}

/** When she asks, her question offers 2 to 4 options. */
export function clarificationOffersOptions(): EvalCustomCheck {
  return {
    id: 'clarification-options',
    description: 'When Elena asks the user, her question offers 2 to 4 options',
    run: (input) => {
      const asked = leadRunViewOf(input).waitingFor;
      if (!asked) return undefined;
      const count = asked.options.length;
      return count >= 2 && count <= 4
        ? undefined
        : `her question offers ${count} options`;
    },
  };
}

/*
 * The answer and tool checks of the data sets ported from the assistant
 * (`insights-lead-data.evals.ts`): the counterparts of Mastra's built-in
 * `checks.includes`, `matches`, `calledTool`, `didNotCall`, `noToolErrors`
 * and `toolOrder`, which read an agent's own result. These read the stored
 * run instead; the answer is the scored one (her answer, or her question
 * and its options while the run waits). Each id carries its argument, so a
 * case can hold two of a kind.
 */

/** The answer holds `text`, in any case (as `checks.includes`). */
export function answerIncludes(text: string): EvalCustomCheck {
  return {
    id: `answer-includes:${text}`,
    description: `The answer includes "${text}" (any case)`,
    run: (input) =>
      insightsLeadScoredAnswer(leadRunViewOf(input))
        .toLowerCase()
        .includes(text.toLowerCase())
        ? undefined
        : `the answer does not include "${text}"`,
  };
}

/** The answer matches `pattern` (as `checks.matches`). */
export function answerMatches(pattern: RegExp): EvalCustomCheck {
  return {
    id: `answer-matches:${String(pattern)}`,
    description: `The answer matches ${String(pattern)}`,
    run: (input) =>
      new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, '')).test(
        insightsLeadScoredAnswer(leadRunViewOf(input)),
      )
        ? undefined
        : `the answer does not match ${String(pattern)}`,
  };
}

/** How many of her calls used `tool`. */
function callsOf(view: InsightsLeadRunView, tool: string): number {
  return view.calls.filter((call) => call.tool === tool).length;
}

/** She called `tool` at least once (as `checks.calledTool`). */
export function calledTool(tool: string): EvalCustomCheck {
  return {
    id: `called-tool:${tool}`,
    description: `Elena called ${tool}`,
    run: (input) =>
      callsOf(leadRunViewOf(input), tool)
        ? undefined
        : `she never called ${tool}`,
  };
}

/** She never called `tool` (as `checks.didNotCall`). */
export function didNotCall(tool: string): EvalCustomCheck {
  return {
    id: `did-not-call:${tool}`,
    description: `Elena did not call ${tool}`,
    run: (input) => {
      const count = callsOf(leadRunViewOf(input), tool);
      return count
        ? `she called ${tool} ${count} time${count === 1 ? '' : 's'}`
        : undefined;
    },
  };
}

/** None of her calls failed (as `checks.noToolErrors`). */
export function noToolErrors(): EvalCustomCheck {
  return {
    id: 'no-tool-errors',
    description: 'None of her tool calls failed',
    run: (input) => {
      const failed = leadRunViewOf(input).calls.filter((call) => call.error);
      return failed.length
        ? `${failed.length} call${failed.length === 1 ? '' : 's'} failed: ` +
            failed.map((call) => `${call.tool} (${call.error})`).join(', ')
        : undefined;
    },
  };
}

/**
 * Her calls hold `tools` in that order, other calls between them allowed
 * (as `checks.toolOrder`).
 */
export function toolOrder(tools: readonly string[]): EvalCustomCheck {
  return {
    id: `tool-order:${tools.join('>')}`,
    description: `Elena calls ${tools.join(', then ')}`,
    run: (input) => {
      const called = leadRunViewOf(input).calls.map((call) => call.tool);
      let next = 0;
      for (const tool of called) if (tool === tools[next]) next++;
      return next >= tools.length
        ? undefined
        : `her calls (${called.join(', ') || 'none'}) do not hold ${tools.join(' then ')}`;
    },
  };
}

/** The most repair rounds a turn makes (plan Elena 2.4: one). */
export const REPAIR_ROUNDS_MAX = 1;

/**
 * The turn repairs its answer once at most: the turn made no more than two
 * attempts (the second answers `Checks on your answer failed:`), so a run
 * that needed more was not stopped by the cap.
 */
export function repairAtMostOnce(): EvalCustomCheck {
  return {
    id: 'repair-at-most-once',
    description: `Elena's turn makes at most ${REPAIR_ROUNDS_MAX} repair round (2 attempts)`,
    run: (input) => {
      const { attempts } = leadRunViewOf(input);
      const rounds = Math.max(0, attempts - 1);
      return rounds <= REPAIR_ROUNDS_MAX
        ? undefined
        : `the turn made ${attempts} attempts (${rounds} repair rounds)`;
    },
  };
}

/** A calendar year, or a day and month (`1 Oct`, `31 December`): dates, not figures. */
const DATE_WORDS =
  /\b(?:19|20)\d{2}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b|\b(?:19|20)\d{2}\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/g;

/**
 * The text a figure is read from: no code (a query or a name in code
 * marks), no list marker or `#` at a line's start, no table separator row,
 * no rank column (the first column of a table headed `#` or `Rank`), which
 * numbers rows, not data, and no year or day and month (a date in a
 * timestamp column is a string, not a figure of the rows).
 */
export function figureText(answer: string): string {
  return rowsAndLists(answer).replace(DATE_WORDS, ' ');
}

/** `figureText` before dates are removed. */
function rowsAndLists(answer: string): string {
  const lines = answer.replace(/```[\s\S]*?```/g, ' ').split('\n');
  let rankColumn = false;
  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('|')) {
        rankColumn = false;
        return line
          .replace(/`[^`]*`/g, ' ')
          .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
      }
      const cells = trimmed.replace(/^\||\|$/g, '').split('|');
      if (cells.every((cell) => /^\s*:?-{2,}:?\s*$/.test(cell))) return '';
      const header = /^\s*[*_]*(?:#|rank)[*_]*\s*$/i.test(cells[0] ?? '');
      const dropRank = rankColumn || header;
      rankColumn = dropRank;
      return (dropRank ? cells.slice(1) : cells).join(' | ');
    })
    .join('\n')
    .replace(/`[^`]*`/g, ' ');
}

/**
 * Every figure in her answer is one of her queries': in a row the stored
 * answer keeps, a query's row count, or the question, or derived from them
 * (a sum, a difference, a share as a percent or a ratio), at the decimals
 * she wrote. The counterpart of Avery's `closingFiguresFromMichael`.
 */
export function figuresFromQueries(question: string): EvalCustomCheck {
  return {
    id: 'figures-from-queries',
    description:
      "Every figure in Elena's answer is in her query rows, a row count or the question, or derived from them",
    run: (input) => {
      const view = leadRunViewOf(input);
      if (view.waitingFor) return undefined;
      const figures = figuresIn(figureText(view.answer));
      if (!figures.length) return undefined;
      const extra = [
        ...figuresIn(question).map((figure) => figure.value),
        ...view.calls.flatMap((call) =>
          call.rowCount === undefined ? [] : [call.rowCount],
        ),
      ];
      const known = derivedFigures(view.rows, extra);
      const unknown = figures.filter(
        (figure) => !matchesRounded(figure.value, figure.decimals, known),
      );
      return unknown.length
        ? `her answer states ${unknown.map((f) => f.raw).join(', ')}, which no query row or question of the run holds`
        : undefined;
    },
  };
}
