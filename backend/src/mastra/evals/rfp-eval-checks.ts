import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import { callRfpApi, rfpApiTarget } from '../tools/rfp.tools';
import type {
  EvalCustomCheck,
  EvalCustomCheckInput,
  EvalRawToolCall,
} from './assistant.evals';

/**
 * The custom checks of the `rfp` eval set (agents.md 8.1): deterministic
 * checks over the RFP Builder's tool calls, their arguments and the record
 * read back from the Intellify RFP API after the case. Each check's id is
 * unique within its case; a check answers `undefined` when it passes and the
 * reason when it fails.
 */

/** A tool call's input as an object (models sometimes send a JSON string). */
export function callInput(call: EvalRawToolCall): Record<string, unknown> {
  let input = call.input;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return {};
    }
  }
  return input && typeof input === 'object'
    ? (input as Record<string, unknown>)
    : {};
}

/** A scalar input field as text; anything else is empty. */
export function fieldText(value: unknown): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}

/** The calls of one tool, in order. */
export function callsOf(
  calls: EvalRawToolCall[],
  name: string,
): EvalRawToolCall[] {
  return calls.filter((call) => call.name === name);
}

/** The skill names the agent loaded with the `skill` tool, in order. */
export function skillsLoaded(calls: EvalRawToolCall[]): string[] {
  return callsOf(calls, 'skill').map((call) =>
    fieldText(callInput(call)['name']).replace(/\/SKILL\.md$/i, ''),
  );
}

function names(calls: EvalRawToolCall[]): string {
  return calls.map((call) => call.name).join(' → ') || 'no tool call';
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/** A check with an id made from its description. */
export function check(
  description: string,
  run: EvalCustomCheck['run'],
): EvalCustomCheck {
  return { id: `rfp-${slug(description)}`, description, run };
}

/** `name` was called and at least one call succeeded. */
export function succeeded(name: string): EvalCustomCheck {
  return check(`"${name}" was called and succeeded`, ({ toolCalls }) =>
    callsOf(toolCalls, name).some((call) => !call.failed)
      ? undefined
      : `no successful "${name}" call; tools: ${names(toolCalls)}`,
  );
}

/** `name` was never called. */
export function notCalled(name: string): EvalCustomCheck {
  return check(`"${name}" was not called`, ({ toolCalls }) => {
    const count = callsOf(toolCalls, name).length;
    return count ? `"${name}" was called ${count}×` : undefined;
  });
}

/** The last call of `name` succeeded (an error earlier was repaired). */
export function lastCallSucceeded(name: string): EvalCustomCheck {
  return check(`the last "${name}" call succeeded`, ({ toolCalls }) => {
    const calls = callsOf(toolCalls, name);
    const last = calls[calls.length - 1];
    if (!last) return `"${name}" was not called; tools: ${names(toolCalls)}`;
    return last.failed
      ? `the last "${name}" call failed: ${JSON.stringify(last.output).slice(0, 300)}`
      : undefined;
  });
}

/** Some call of `name` matches `predicate` (on its parsed input). */
export function calledWith(
  name: string,
  description: string,
  predicate: (
    input: Record<string, unknown>,
    call: EvalRawToolCall,
    vars: Record<string, string>,
  ) => boolean,
): EvalCustomCheck {
  return check(
    `"${name}" called with ${description}`,
    ({ toolCalls, vars }) => {
      const calls = callsOf(toolCalls, name);
      if (!calls.length)
        return `"${name}" was not called; tools: ${names(toolCalls)}`;
      return calls.some((call) => predicate(callInput(call), call, vars))
        ? undefined
        : `no "${name}" call with ${description}; inputs: ${calls
            .map((call) => JSON.stringify(callInput(call)))
            .join(' | ')
            .slice(0, 600)}`;
    },
  );
}

/** No call of `name` matches `predicate`. */
export function neverCalledWith(
  name: string,
  description: string,
  predicate: (input: Record<string, unknown>) => boolean,
): EvalCustomCheck {
  return check(
    `"${name}" never called with ${description}`,
    ({ toolCalls }) => {
      const bad = callsOf(toolCalls, name).filter((call) =>
        predicate(callInput(call)),
      );
      return bad.length
        ? `"${name}" was called with ${description}: ${JSON.stringify(callInput(bad[0])).slice(0, 400)}`
        : undefined;
    },
  );
}

/**
 * Each step is a tool name, or a predicate with a label; the steps must
 * happen in this order (other calls may come in between).
 */
export type OrderStep =
  string | { label: string; is: (call: EvalRawToolCall) => boolean };

export function inOrder(steps: OrderStep[]): EvalCustomCheck {
  const label = (step: OrderStep) =>
    typeof step === 'string' ? step : step.label;
  return check(
    `tool order ${steps.map(label).join(' → ')}`,
    ({ toolCalls }) => {
      let next = 0;
      for (const call of toolCalls) {
        const step = steps[next];
        if (!step) break;
        const hit =
          typeof step === 'string' ? call.name === step : step.is(call);
        if (hit) next += 1;
      }
      return next === steps.length
        ? undefined
        : `expected ${steps.map(label).join(' → ')}, got ${names(toolCalls)}`;
    },
  );
}

/** An order step: the `skill` call that loads `skill`. */
export function skillStep(skill: string): OrderStep {
  return {
    label: `skill(${skill})`,
    is: (call) =>
      call.name === 'skill' &&
      fieldText(callInput(call)['name']).replace(/\/SKILL\.md$/i, '') === skill,
  };
}

/** The first call that reads or writes RFP data is `first` (skill and workflow calls aside). */
export function firstDataCall(first: string): EvalCustomCheck {
  const meta = new Set([
    'skill',
    'skill_read',
    'skill_search',
    'update_workflow',
  ]);
  return check(`the first data tool call is "${first}"`, ({ toolCalls }) => {
    const call = toolCalls.find((c) => !meta.has(c.name));
    return call?.name === first
      ? undefined
      : `the first data call was ${call?.name ?? 'none'}; tools: ${names(toolCalls)}`;
  });
}

/** The answer matches `pattern`. */
export function answerMatches(
  pattern: RegExp,
  description: string,
): EvalCustomCheck {
  return check(`answer ${description}`, ({ answer }) =>
    pattern.test(answer)
      ? undefined
      : `the answer does not match ${pattern} — it began "${answer.trim().slice(0, 160)}"`,
  );
}

/** The answer never matches `pattern`. */
export function answerExcludes(
  pattern: RegExp,
  description: string,
): EvalCustomCheck {
  return check(`answer ${description}`, ({ answer }) => {
    const hit = answer.match(pattern);
    return hit ? `the answer contains "${hit[0]}"` : undefined;
  });
}

/** The saved RFP record (api.md 2.16.4), as the checks read it. */
export interface SavedRfp {
  id: string;
  status: string;
  stage: number;
  planYear: number;
  effectiveDate: string;
  sections: Record<string, string | undefined>;
  lines: { line: string; marketBasis: string; planDesignIds: string[] }[];
  carriers: { insurerName: string; lines: string[]; incumbent: boolean }[];
  requirements: { section: string; question: string; required: boolean }[];
  timeline: { milestone: string; dueDate: string }[];
}

/** Read an RFP back through the API the run used. */
export async function readRfp(
  datasets: string[],
  rfpId: string,
): Promise<SavedRfp> {
  const target = await rfpApiTarget({
    get: (key: string) => (key === DATASETS_CONTEXT_KEY ? datasets : undefined),
  });
  if ('error' in target) throw new Error(target.error);
  const rfp = (await callRfpApi(target, 'GET', `/v1/rfps/${rfpId}`)) as
    SavedRfp | { error: string };
  if ('error' in rfp) throw new Error(rfp.error);
  return rfp;
}

/**
 * The case's setup draft (`vars.rfpId`) read back after the run satisfies
 * `problem` (which answers why not, or undefined).
 */
export function savedRfp(
  description: string,
  problem: (rfp: SavedRfp) => string | undefined,
): EvalCustomCheck {
  return check(`saved RFP: ${description}`, async ({ datasets, vars }) => {
    if (!vars['rfpId']) return 'the case has no setup draft to read back';
    return problem(await readRfp(datasets, vars['rfpId']));
  });
}

/** The RFP ids `create_rfp` made in the run. */
export function createdRfpIds(input: EvalCustomCheckInput): string[] {
  return callsOf(input.toolCalls, 'create_rfp')
    .filter((call) => !call.failed)
    .map((call) => (call.output as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string');
}

/** Carriers of a record as sorted `name[lines]` strings, for messages and comparisons. */
export function carrierKeys(rfp: SavedRfp): string[] {
  return rfp.carriers
    .map(
      (c) =>
        `${c.insurerName}[${[...c.lines].sort().join(',')}]${c.incumbent ? '*' : ''}`,
    )
    .sort();
}
