import type { EvalCheckSpec } from './suite-loader';

/**
 * The suite checks as pure functions of a finished turn.
 *
 * The `@mastra/evals/checks` scorers read the tool trace out of `run.output`
 * (AI-SDK messages), so they can only grade a bare `agent.generate` — not the
 * production turn (`SessionsService.runTurn`), whose answer can be rewritten
 * by tool-only synthesis, the grounding guard or the review after the agent
 * stops. The parity harness grades the `TurnResult` instead, with these.
 *
 * Kept identical to the Mastra scorers on purpose, so nothing downstream
 * notices the swap: the same ids (`check-includes`, `check-called-tool`, …),
 * names and descriptions, and the same semantics (includes/excludes/equals
 * ignore case; `toolOrder` is a relaxed subsequence). Two deliberate
 * differences: `matches` defaults to the `i` flag (an explicit `flags: ""` is
 * case-sensitive), and `finalSqlSucceeded` is new.
 *
 * Pure module: no Mastra, no Nest, no model calls.
 */

/** A turn as the checks see it. */
export interface EvalCheckTurn {
  /** The final answer text, as the user saw it. */
  text: string;
  /** Tool names in call order, repeats kept, `ask_clarification` included. */
  calledTools: string[];
  /** Error text of every tool call that failed. */
  toolErrors: string[];
  /** The last `run_readonly_sql` call succeeded (and there was one). */
  finalSqlOk: boolean;
}

/**
 * One check's verdict. Structurally identical to `EvalCheckResult` in
 * `assistant.evals.ts`, defined here so this module has no runtime edge to
 * the agent stack.
 */
export interface EvalCheckResult {
  id: string;
  /** e.g. 'Checks if output includes "X"' — the Mastra scorer's wording. */
  description: string;
  score: number;
  passed: boolean;
  /** Why the check failed, in a sentence. */
  reason?: string;
}

/** What the Evals tab lists for a check before a run. */
export interface EvalCheckDescription {
  id: string;
  name: string;
  description: string;
}

type CheckType = EvalCheckSpec['type'];

/** Mastra's scorer id and name per type; `finalSqlSucceeded` follows the pattern. */
const CHECK_META: Readonly<Record<CheckType, { id: string; name: string }>> = {
  includes: { id: 'check-includes', name: 'Includes Check' },
  excludes: { id: 'check-excludes', name: 'Excludes Check' },
  equals: { id: 'check-equals', name: 'Equals Check' },
  matches: { id: 'check-matches', name: 'Matches Check' },
  calledTool: { id: 'check-called-tool', name: 'Called Tool Check' },
  didNotCall: { id: 'check-did-not-call', name: 'Did Not Call Check' },
  toolOrder: { id: 'check-tool-order', name: 'Tool Order Check' },
  noToolErrors: { id: 'check-no-tool-errors', name: 'No Tool Errors Check' },
  usedNoTools: { id: 'check-used-no-tools', name: 'Used No Tools Check' },
  maxToolCalls: { id: 'check-max-tool-calls', name: 'Max Tool Calls Check' },
  finalSqlSucceeded: {
    id: 'check-final-sql-succeeded',
    name: 'Final SQL Succeeded Check',
  },
};

/** The regex a `matches` spec runs: `i` unless the spec says otherwise. */
export function matchesRegExp(spec: EvalCheckSpec): RegExp {
  return new RegExp(spec.pattern ?? '', spec.flags ?? 'i');
}

function baseId(spec: EvalCheckSpec): string {
  const meta = CHECK_META[spec.type];
  if (!meta)
    throw new Error(`Unsupported eval check type "${String(spec.type)}"`);
  return meta.id;
}

/**
 * Result ids for a case's checks, in order: `check-<type>`, with `-2`, `-3`
 * only on a repeated type. The loader rejects repeats in suite files, so in
 * practice every id is the bare one; the suffix keeps a hand-built case from
 * silently merging two scores.
 */
export function checkIds(specs: readonly EvalCheckSpec[]): string[] {
  const seen = new Map<string, number>();
  return specs.map((spec) => {
    const id = baseId(spec);
    const count = (seen.get(id) ?? 0) + 1;
    seen.set(id, count);
    return count === 1 ? id : `${id}-${count}`;
  });
}

/** Mastra's description wording, so the tab reads exactly as it did. */
function descriptionOf(spec: EvalCheckSpec): string {
  switch (spec.type) {
    case 'includes':
      return `Checks if output includes "${spec.value}"`;
    case 'excludes':
      return `Checks that output does not include "${spec.value}"`;
    case 'equals':
      return `Checks if output equals "${spec.value}"`;
    case 'matches':
      return `Checks if output matches pattern ${matchesRegExp(spec).toString()}`;
    case 'calledTool': {
      const times = spec.times ?? 1;
      return `Checks that "${spec.tool}" was called${times > 1 ? ` at least ${times} times` : ''}`;
    }
    case 'didNotCall':
      return `Checks that "${spec.tool}" was NOT called`;
    case 'toolOrder':
      return `Checks tool call order: [${(spec.tools ?? []).join(' → ')}]`;
    case 'maxToolCalls':
      return `Checks that no more than ${spec.max} tool calls were made`;
    case 'usedNoTools':
      return 'Checks that no tools were called';
    case 'noToolErrors':
      return 'Checks that no tool calls resulted in errors';
    case 'finalSqlSucceeded':
      return "Checks that the answer's final SQL query ran successfully";
    default:
      return `Unsupported check type "${String((spec as { type?: string }).type)}"`;
  }
}

/** One spec as the question list shows it (base id — see `describeChecks`). */
export function describeCheck(spec: EvalCheckSpec): EvalCheckDescription {
  return {
    id: baseId(spec),
    name: CHECK_META[spec.type].name,
    description: descriptionOf(spec),
  };
}

/** A case's specs as the question list shows them, ids aligned with `evaluateChecks`. */
export function describeChecks(
  specs: readonly EvalCheckSpec[],
): EvalCheckDescription[] {
  const ids = checkIds(specs);
  return specs.map((spec, index) => ({
    ...describeCheck(spec),
    id: ids[index],
  }));
}

/** A one-line preview of the answer, for reasons that hinge on the output. */
function outputHint(text: string): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return 'the agent produced no answer text';
  const firstLine = trimmed.split('\n')[0];
  return firstLine.length > 120
    ? `answer began "${firstLine.slice(0, 120)}…"`
    : `answer was "${firstLine}"`;
}

function count(tools: readonly string[], name: string | undefined): number {
  return tools.filter((tool) => tool === name).length;
}

function clip(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Pass/fail plus the sentence `checkReason()` in `assistant.evals.ts` would say. */
function evaluate(
  spec: EvalCheckSpec,
  turn: EvalCheckTurn,
): { passed: boolean; reason?: string } {
  const text = turn.text ?? '';
  const tools = turn.calledTools ?? [];
  switch (spec.type) {
    case 'includes': {
      const passed = text
        .toLowerCase()
        .includes((spec.value ?? '').toLowerCase());
      return passed
        ? { passed }
        : {
            passed,
            reason: `expected ${JSON.stringify(spec.value)} in the answer — ${outputHint(text)}`,
          };
    }
    case 'excludes': {
      const passed = !text
        .toLowerCase()
        .includes((spec.value ?? '').toLowerCase());
      return passed
        ? { passed }
        : {
            passed,
            reason: `expected ${JSON.stringify(spec.value)} NOT to appear — ${outputHint(text)}`,
          };
    }
    case 'equals': {
      // Trimmed: a trailing newline is not a different answer.
      const passed =
        text.trim().toLowerCase() === (spec.value ?? '').trim().toLowerCase();
      return passed
        ? { passed }
        : {
            passed,
            reason: `expected the answer to equal ${JSON.stringify(spec.value)} — ${outputHint(text)}`,
          };
    }
    case 'matches': {
      const pattern = matchesRegExp(spec);
      const passed = pattern.test(text);
      return passed
        ? { passed }
        : {
            passed,
            reason: `expected the answer to match ${pattern.toString()} — ${outputHint(text)}`,
          };
    }
    case 'calledTool': {
      const expected = spec.times ?? 1;
      const actual = count(tools, spec.tool);
      const passed = actual >= expected;
      return passed
        ? { passed }
        : {
            passed,
            reason: `expected "${spec.tool}" to be called ${expected}×, it was called ${actual}×`,
          };
    }
    case 'didNotCall': {
      const actual = count(tools, spec.tool);
      const passed = actual === 0;
      return passed
        ? { passed }
        : {
            passed,
            reason: `expected "${spec.tool}" NOT to be called, it was (${actual}×)`,
          };
    }
    case 'toolOrder': {
      const expected = spec.tools ?? [];
      let next = 0;
      for (const tool of tools) {
        if (next < expected.length && tool === expected[next]) next += 1;
      }
      const passed = next === expected.length;
      return passed
        ? { passed }
        : {
            passed,
            reason: `expected the tool order ${expected.join(' → ')}, got ${tools.join(' → ') || 'nothing'}`,
          };
    }
    case 'maxToolCalls': {
      const max = spec.max ?? 0;
      const passed = tools.length <= max;
      return passed
        ? { passed }
        : {
            passed,
            reason: `expected at most ${max} tool calls, the agent made ${tools.length}`,
          };
    }
    case 'usedNoTools': {
      const passed = tools.length === 0;
      return passed
        ? { passed }
        : {
            passed,
            reason: `expected no tool calls, the agent made ${tools.length} (${tools.join(', ')})`,
          };
    }
    case 'noToolErrors': {
      const errors = turn.toolErrors ?? [];
      const passed = errors.length === 0;
      return passed
        ? { passed }
        : {
            passed,
            reason: `a tool call failed: ${clip(errors.join(' | '))}`,
          };
    }
    case 'finalSqlSucceeded': {
      const passed = Boolean(turn.finalSqlOk);
      return passed
        ? { passed }
        : {
            passed,
            reason: tools.includes('run_readonly_sql')
              ? "the answer's final SQL query failed"
              : 'the agent never ran a SQL query',
          };
    }
    default:
      throw new Error(
        `Unsupported eval check type "${String((spec as { type?: unknown }).type)}"`,
      );
  }
}

/**
 * Grade a finished turn against a case's checks, in declaration order. Each
 * result carries its id (`checkIds`), the Mastra-worded description, a 0/1
 * score and, on failure, a reason a person can act on.
 */
export function evaluateChecks(
  specs: readonly EvalCheckSpec[],
  turn: EvalCheckTurn,
): EvalCheckResult[] {
  const ids = checkIds(specs);
  return specs.map((spec, index) => {
    const { passed, reason } = evaluate(spec, turn);
    return {
      id: ids[index],
      description: descriptionOf(spec),
      score: passed ? 1 : 0,
      passed,
      ...(reason ? { reason } : {}),
    };
  });
}

/** Text checks judge the prose; the rest judge the tool trace. */
export const TEXT_CHECK_TYPES: ReadonlySet<CheckType> = new Set<CheckType>([
  'includes',
  'excludes',
  'equals',
  'matches',
]);

/** True when `id` (as `evaluateChecks` returns it) is a text check. */
export function isTextCheckId(id: string): boolean {
  const base = id.replace(/-\d+$/, '');
  return [...TEXT_CHECK_TYPES].some((type) => CHECK_META[type].id === base);
}
