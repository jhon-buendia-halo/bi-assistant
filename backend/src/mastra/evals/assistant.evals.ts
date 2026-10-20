import { runEvals } from '@mastra/core/evals';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraScorer } from '@mastra/core/evals';
import type { Agent } from '@mastra/core/agent';
import { assistantAgent } from '../agents/assistant.agent';
import { resolveAgentModel } from '../model-resolver';
import { modelIdOf, providerOptionsFor } from '../model-compat';
import { USAGE_SINK_CONTEXT_KEY } from '../usage-sink';
import type { UsageSink } from '../usage-sink';
import {
  evalJudgeAgent,
  evalJudgeOutputSchema,
} from '../agents/eval-judge.agent';
import { ASSISTANT_MAX_STEPS } from '../agent-constants';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import {
  SESSION_ID_CONTEXT_KEY,
  TURN_QUESTION_CONTEXT_KEY,
  TURN_RECORDS_CONTEXT_KEY,
} from '../tools/visual.tools';
import { getDatasetToolServices } from '../tool-services';
import type { DatasetSnapshot } from '../tool-services';
import { entityOrientationLines, knowledgeContext } from '../context-blocks';
import {
  AGENT_TOOLS_CONTEXT_KEY,
  isFullSelection,
  type OptionalAgentTool,
  toolSelectionFrom,
} from '../agent-tools';
import { runResultSetCheck } from './result-set-check';
import type { ResultSetCheckOptions } from './result-set-check';
import { loadEvalSets } from './eval-set-files';
import type { EvalCategory, EvalCriterion, EvalSplit } from './eval-set-files';
import { toAssistantEvalSets } from './eval-check-scorers';
import {
  JUDGE_OFF,
  JUDGE_OFF_REASON,
  judgeCriterion,
  shouldJudge,
} from './judge-option';
import type { EvalJudgeSetting } from './judge-option';
import { questionStatus } from './eval-summary';
import type { EvalStatus } from './eval-summary';
import { recordUsage } from './eval-usage';
import type { ModelUsageEntry } from './eval-usage';
import { costUsdOf } from './eval-attempts';
import { evalFixture } from './assistant-eval-datasets';
import type { SampleFixture } from '../../modules/testing-data/fixtures/registry';
import {
  synthesizeToolOnlyTurn,
  toolDataRecord,
} from '../../modules/sessions/turn-data';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import type { SessionsService } from '../../modules/sessions/sessions.service';

/**
 * Eval suite for the Questions to Insights assistant.
 *
 * The questions are data: one JSON file per question bank under `./sets/`,
 * loaded and checked by `./eval-set-files.ts` (ADR-0015). They are grouped into
 * sets, one per bundled sample and datasource kind, and every expected
 * substring in them is a fact that is actually in that sample's data — a check
 * failing means the agent got it wrong, not that the fixture drifted. The RFP
 * Builder's set (`rfp.evals.ts`) stays TypeScript: its custom checks are code.
 *
 * The assistant resolves its entities from the session's datasets via
 * requestContext, so each case carries the dataset it is allowed to query.
 */

/**
 * `runEvals` keys its scores by scorer id, so two scorers of the same kind in
 * one case would collide — the set loader refuses a check type used twice in
 * one case, and each custom check has an id of its own.
 */
export interface AssistantEvalCase {
  /** Short id used when reporting per-question scores. */
  id: string;
  question: string;
  /** What the question is probing for, for the run report. */
  intent: string;
  scorers: MastraScorer<any, any, any, any>[];
  /**
   * The criterion each scorer measures (agents-evals R125, R146), one entry
   * per scorer in the same order; `undefined` where a check names none.
   */
  checkCriteria?: (EvalCriterion | undefined)[];
  /**
   * Trusted SQL against the eval datasource whose live result set is the
   * reference answer. When present, `runAssistantEvalCase` compares it
   * (via `runResultSetCheck`) against the agent's successful
   * `run_readonly_sql` results and adds that as the case's primary
   * correctness signal, on top of the text/tool `scorers` above.
   */
  expectedSql?: string;
  resultSetOptions?: ResultSetCheckOptions;
  /**
   * A natural-language grading rubric for cases where a regex/text check on
   * the final answer would be too brittle (clarification quality, refusal
   * quality, whether a visual plausibly answers the request). When present,
   * `runAssistantEvalCase` scores it with the LLM judge
   * (`../agents/eval-judge.agent`) as an additional check — when the run's
   * judge option allows it; otherwise the check is not scored (R145).
   */
  judgeRubric?: string;
  /**
   * Run the case with this tool selection, as a session bound to a user
   * agent would (agents.md 2.1, 4.2). Omitted = every tool. A set file
   * names it `agentTools` too.
   */
  agentTools?: OptionalAgentTool[];
  /**
   * Deterministic checks the built-in ones cannot express: tool arguments,
   * the order of particular calls, or state read back after the run. Each
   * has its own id, so a case can hold several of the same kind (the
   * built-in checks share one id per kind, see above).
   */
  customChecks?: EvalCustomCheck[];
  /** The case's primary category (research 2.6); never graded. */
  category?: EvalCategory;
  /** `dev`, or `held-out` for cases kept out of prompt tuning. */
  split?: EvalSplit;
  /** Free labels such as `ties`, `control` or `rest:paging`. */
  tags?: string[];
  /** Why the case exists and what it guards; for people, never graded. */
  notes?: string;
}

/** One tool call as the agent made it, with its parsed input and output. */
export interface EvalRawToolCall {
  name: string;
  input: unknown;
  output: unknown;
  /** The call threw, or its result carries an `error`. */
  failed: boolean;
}

/** What a custom check reads. */
export interface EvalCustomCheckInput {
  /** The final answer text. */
  answer: string;
  toolCalls: EvalRawToolCall[];
  datasets: string[];
  /** Values the target's setup produced for the case (e.g. a draft's id). */
  vars: Record<string, string>;
}

/**
 * A deterministic check written in code. `run` answers `undefined` when the
 * check passes and the reason when it fails; a throw fails it too.
 */
export interface EvalCustomCheck {
  /** Unique within its case. */
  id: string;
  description: string;
  run(
    input: EvalCustomCheckInput,
  ): string | undefined | Promise<string | undefined>;
}

/** One earlier turn sent before a case's question (multi-turn cases). */
export interface EvalHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** What a target's setup turns a case into before it runs. */
export interface PreparedEvalQuestion {
  question: string;
  /** Earlier turns, oldest first, sent before the question. */
  history?: EvalHistoryMessage[];
  /** Values the orientation block and the custom checks read. */
  vars?: Record<string, string>;
}

/**
 * A named group of eval questions that share one fixture. Sets exist so the
 * suite can grow past the World Cup sample without the questions tab becoming
 * one undifferentiated list — a future set brings its own schema and its own
 * datasource, and the two must not be run against each other.
 */
export interface AssistantEvalSet {
  /** Stable id, used by the API and the questions tab's selection. */
  id: string;
  name: string;
  /** What the set covers and what it needs to run, shown above its questions. */
  description: string;
  /**
   * The sample this set questions, by `SampleFixture.id`. The data preflight
   * takes the entities the set requires from that registry entry, so the list
   * lives in exactly one place for both the loader and the suite.
   */
  fixtureId: string;
  /**
   * The registry key of the agent the set runs on (agents.md 8.1); absent
   * means the `assistant`.
   */
  agentKey?: string;
  cases: AssistantEvalCase[];
}

/**
 * Every question set the assistant suite offers, in the order of
 * `EVAL_SET_FILES`: World Cup, then its REST API and Databricks variants,
 * Formula 1, the REST- and Databricks-only sets and the
 * synthetic domains. The questions are data under `./sets/` (ADR-0015), read
 * and checked by `loadEvalSets` when this module loads, so a set file the
 * loader refuses stops the backend instead of running a broken case. Adding
 * a question is an edit to a set file, not to this module or the questions
 * tab.
 */
export const ASSISTANT_EVAL_SETS: AssistantEvalSet[] =
  toAssistantEvalSets(loadEvalSets());

/**
 * Every case across every set, flattened. Case ids are unique suite-wide, so
 * the runner and `selectEvalCases` keep working on ids alone and never need
 * to know which set a case came from.
 */
export const ASSISTANT_EVAL_CASES: AssistantEvalCase[] =
  ASSISTANT_EVAL_SETS.flatMap((set) => set.cases);

/** What the orientation builder of an eval target gets for one case. */
export interface EvalOrientationInput {
  datasets: string[];
  snapshots: DatasetSnapshot[];
  requestContext: RequestContext;
  /** The case's setup values (`PreparedEvalQuestion.vars`). */
  vars?: Record<string, string>;
}

/**
 * The agent a set's cases run on and what each case sends it (agents.md
 * 8.1, `agentKey`): the assistant by default, the RFP Builder for the `rfp`
 * set (`rfp.evals.ts`).
 */
export interface EvalTarget {
  /** Registry key of the agent. */
  agentKey: string;
  agent: Agent;
  /** The sets that run on this agent. */
  sets: AssistantEvalSet[];
  /** The orientation system message of a case (Block 1's dataset half, or Block R1). */
  orientation(input: EvalOrientationInput): string | Promise<string>;
  /** Whether the curated-knowledge block (Block 3) is sent. */
  sendsKnowledge: boolean;
  /** Adds the agent's own keys to a case's requestContext. */
  configureContext?(requestContext: RequestContext): void;
  /** The question a case sends, after any setup it needs. */
  prepareQuestion?(
    evalCase: AssistantEvalCase,
    input: Omit<EvalOrientationInput, 'requestContext' | 'vars'>,
  ): Promise<string | PreparedEvalQuestion>;
  /** Clean-up after each case (passed, failed or thrown). Never throws. */
  afterCase?(datasets: string[]): Promise<void>;
  /** Clean-up once a run's cases are done (or it failed). Never throws. */
  finish?(datasets: string[]): Promise<void>;
  /**
   * The registry key of the agent the run's throwaway session is bound to,
   * so session-scoped tools resolve as in a real chat with this agent
   * (`update_workflow` reads the bound agent's `## Workflow`); none for the
   * assistant.
   */
  sessionAgentKey?: string;
  /**
   * How much of each tool input and output the LLM judge reads; the
   * report's 2,000 characters when unset. The RFP Builder's tools answer
   * whole records, so its judge reads more of them.
   */
  judgeTraceChars?: number;
}

/** The assistant's sets, run as they always have been. */
export const ASSISTANT_EVAL_TARGET: EvalTarget = {
  agentKey: 'assistant',
  agent: assistantAgent,
  sets: ASSISTANT_EVAL_SETS,
  // Block 1's dataset half, in the variant the case's tool selection gives.
  orientation: ({ datasets, snapshots, requestContext }) =>
    entityOrientationLines(
      datasets,
      snapshots,
      toolSelectionFrom(requestContext),
    ).join('\n'),
  sendsKnowledge: true,
};

/** One tool the agent called while answering, in call order. */
export interface EvalToolCall {
  name: string;
  /** Arguments the agent passed, JSON-encoded and truncated. */
  input?: string;
  /** What the tool returned, JSON-encoded and truncated. */
  output?: string;
  error?: string;
}

/** What a check produces before the runner gives it a status. */
export interface ScoredCheckResult {
  id: string;
  /** The scorer's own description, e.g. 'Checks if output includes "X"'. */
  description: string;
  score: number;
  passed: boolean;
  /** Why the check scored what it did — populated on failure where known. */
  reason?: string;
}

/** One check's verdict on a question, with why it landed there. */
export interface EvalCheckResult extends ScoredCheckResult {
  /** `not-scored` only for a judge check the run did not call (R146). */
  status: EvalStatus;
  /** The criterion the check measures, when it has one (R146). */
  criterion?: string;
}

/**
 * Outcome of one question: of one attempt as `runAssistantEvalCase` returns
 * it, and of all its attempts once `foldAttempts` (pass^k, R211) has folded
 * them. With more than one attempt, the scores, checks, answer, tool calls,
 * error and duration are the representative attempt's.
 */
export interface AssistantEvalCaseResult {
  id: string;
  /** The question as sent, after any setup the target's case needed. */
  question: string;
  /** The case's category (R147); absent on runs saved before BA-184. */
  category?: string;
  /** The case's split (R215); `dev` for a case that names none. */
  split: EvalSplit;
  /** Score per scorer id, 0..1. Empty when the run threw. */
  scores: Record<string, number>;
  /** Per-check verdicts, in the order the case declares them. */
  checkResults: EvalCheckResult[];
  /** The agent's final answer text. */
  answer: string;
  /** The tool calls the agent made, in order — the executed process. */
  toolCalls: EvalToolCall[];
  /** Passed, failed or not scored (R147). */
  status: EvalStatus;
  /** True exactly when `status` is `passed`: a not-scored question is not. */
  passed: boolean;
  /** Set when the agent run itself failed (connection, model, tool crash). */
  error?: string;
  /** Wall time for the question, in milliseconds. */
  durationMs: number;
  /** The attempts that passed, and the attempts made (R211). */
  passes: number;
  runs: number;
  /** Some attempts passed and some failed; the question counts as failed. */
  flaky: boolean;
  /** Every attempt in order; only when `runs` is above 1. */
  attempts?: EvalAttempt[];
  /** Tokens per agent and model, over every attempt (R219). */
  usage?: ModelUsageEntry[];
  /** US dollars over every attempt; `null` when not priced (R221). */
  costUsd?: number | null;
}

/** One attempt of a question (R210), as a result's `attempts` holds it. */
export interface EvalAttempt {
  /** 1-based. */
  attempt: number;
  status: EvalStatus;
  passed: boolean;
  scores: Record<string, number>;
  checkResults: EvalCheckResult[];
  answer: string;
  toolCalls: EvalToolCall[];
  error?: string;
  durationMs: number;
  /** This attempt's tokens alone, and their cost (`null`: not priced). */
  usage: ModelUsageEntry[];
  costUsd: number | null;
}

/** Tool payloads can be whole result sets; keep the trace readable. */
const MAX_TRACE_FIELD = 2000;

/** Anything `String()` can render: every non-nullish value. */
type Stringable = { toString(): string };

function encode(
  value: unknown,
  max: number = MAX_TRACE_FIELD,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const stringable: Stringable = value;
  const text =
    typeof value === 'string'
      ? value
      : (safeStringify(value) ?? String(stringable));
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

/**
 * Pull the tool trace out of an agent result. The runEvals callback types this
 * as `any`; the call/result shape has moved between AI SDK versions, so every
 * field is read defensively. In the currently installed Mastra/AI-SDK
 * version, each entry in `step.toolCalls`/`step.toolResults` is a chunk
 * (`{ type: 'tool-call' | 'tool-result', payload: {...} }`) rather than a flat
 * object — the actual `toolCallId`/`toolName`/`args`/`result` live on
 * `.payload`. Reading them off the chunk itself (as this used to) silently
 * finds nothing, which is why every reported step name used to render
 * "unknown". Both shapes are still accepted, in case a future upgrade
 * flattens the chunk again.
 */
function extractToolCalls(targetResult: unknown): EvalToolCall[] {
  return extractRawToolCalls(targetResult).map((call) => ({
    name: call.name,
    input: encode(call.input),
    output: call.thrown ? undefined : encode(call.output),
    error: call.thrown
      ? (encode(call.output) ?? 'Tool call failed')
      : undefined,
  }));
}

/** The calls with their parsed input and output (for the custom checks). */
function extractRawToolCalls(
  targetResult: unknown,
): (EvalRawToolCall & { thrown: boolean })[] {
  const resultSteps = field(targetResult, 'steps');
  const steps: unknown[] = Array.isArray(resultSteps)
    ? (resultSteps as unknown[])
    : [targetResult];

  const calls: (EvalRawToolCall & { thrown: boolean })[] = [];
  for (const step of steps) {
    if (!step) continue;
    const stepCalls = arrayField(step, 'toolCalls');
    const stepResults = arrayField(step, 'toolResults');

    for (const call of stepCalls) {
      const callPayload = field(call, 'payload') ?? call;
      const match = stepResults.find((result) => {
        const resultPayload = field(result, 'payload') ?? result;
        return (
          field(resultPayload, 'toolCallId') ===
          field(callPayload, 'toolCallId')
        );
      });
      const matchPayload = field(match, 'payload') ?? match;
      const output =
        field(matchPayload, 'output') ?? field(matchPayload, 'result');
      const name: Stringable =
        field(callPayload, 'toolName') ??
        field(callPayload, 'name') ??
        'unknown';
      const thrown = Boolean(field(matchPayload, 'isError'));
      calls.push({
        name: String(name),
        input: field(callPayload, 'input') ?? field(callPayload, 'args'),
        output,
        thrown,
        failed: thrown || typeof field(output, 'error') === 'string',
      });
    }
  }
  return calls;
}

/**
 * `value?.[key]` for a value of unknown shape: undefined when the value is
 * nullish, the property (own or inherited) otherwise.
 */
function field(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** `value?.[key]` when it is an array, else an empty list. */
function arrayField(value: unknown, key: string): unknown[] {
  const entry = field(value, key);
  return Array.isArray(entry) ? (entry as unknown[]) : [];
}

/** A one-line preview of the answer, for reasons that hinge on the output. */
function outputHint(output: unknown): string {
  const text = typeof output === 'string' ? output.trim() : '';
  if (!text) return 'the agent produced no answer text';
  const firstLine = text.split('\n')[0];
  return firstLine.length > 120
    ? `answer began "${firstLine.slice(0, 120)}…"`
    : `answer was "${firstLine}"`;
}

/**
 * The scorer payload carries the comparison it made; turn the known shapes
 * into a sentence. Unknown shapes fall back to the raw payload so a new check
 * still explains itself, just less prettily.
 */
function checkReason(payload: unknown): string | undefined {
  const detail = field(payload, 'preprocessStepResult');
  if (detail && typeof detail === 'object') {
    const at = (key: string): unknown => field(detail, key);
    if ('target' in detail && 'found' in detail) {
      return `expected ${JSON.stringify(at('target'))} in the answer — ${outputHint(at('output'))}`;
    }
    if ('target' in detail && 'excluded' in detail) {
      return `expected ${JSON.stringify(at('target'))} NOT to appear — ${outputHint(at('output'))}`;
    }
    if ('pattern' in detail && 'matched' in detail) {
      return `expected the answer to match ${templateText(at('pattern'))} — ${outputHint(at('output'))}`;
    }
    if ('toolName' in detail && 'actualCount' in detail) {
      const expected = at('expectedTimes') ?? 1;
      return `expected "${templateText(at('toolName'))}" to be called ${templateText(expected)}×, it was called ${templateText(at('actualCount'))}×`;
    }
    if ('toolName' in detail && 'called' in detail) {
      return `expected "${templateText(at('toolName'))}" NOT to be called, it was`;
    }
    if ('expectedOrder' in detail) {
      const actualOrder = at('actualOrder');
      const expectedOrder = at('expectedOrder');
      const actual = Array.isArray(actualOrder)
        ? actualOrder.join(' → ')
        : 'nothing';
      const expected = Array.isArray(expectedOrder)
        ? expectedOrder.join(' → ')
        : String(expectedOrder);
      return `expected the tool order ${expected}, got ${actual || 'nothing'}`;
    }
    if ('errors' in detail || 'toolErrors' in detail) {
      const errors = at('errors') ?? at('toolErrors');
      return `a tool call failed: ${encode(errors) ?? 'unknown error'}`;
    }
    const encoded = encode(detail);
    if (encoded) return encoded;
  }
  const reason = field(payload, 'reason');
  return typeof reason === 'string' ? reason : undefined;
}

/** What a template literal renders for a scorer field of unknown type. */
function templateText(value: unknown): string {
  return String(value);
}

/**
 * The cases to run: the named ones, or all of them when the caller passes no
 * list at all. An explicit empty list selects nothing — it must not be read as
 * "run everything", or an empty selection would start a full (paid) run.
 */
export function selectEvalCases(
  caseIds?: string[],
  sets: AssistantEvalSet[] = ASSISTANT_EVAL_SETS,
): AssistantEvalCase[] {
  const all =
    sets === ASSISTANT_EVAL_SETS
      ? ASSISTANT_EVAL_CASES
      : sets.flatMap((set) => set.cases);
  if (!caseIds) return all;
  const wanted = new Set(caseIds);
  return all.filter((evalCase) => wanted.has(evalCase.id));
}

/** The sets the selection touches — every set when nothing is named. */
export function selectEvalSets(
  caseIds?: string[],
  sets: AssistantEvalSet[] = ASSISTANT_EVAL_SETS,
): AssistantEvalSet[] {
  if (!caseIds) return sets;
  const wanted = new Set(caseIds);
  return sets.filter((set) =>
    set.cases.some((evalCase) => wanted.has(evalCase.id)),
  );
}

/**
 * The sample a selection of questions must be run against. Throws when the
 * selection resolves to no set, to several samples at once (their schemas are
 * unrelated — a run scoped to one cannot answer the other), or to a fixture id
 * the registry does not know.
 */
export function fixtureForCases(
  caseIds?: string[],
  from: AssistantEvalSet[] = ASSISTANT_EVAL_SETS,
): SampleFixture {
  const sets = selectEvalSets(caseIds, from);
  if (sets.length === 0) {
    throw new Error(
      'No question set matches the selected questions, so there is no sample ' +
        'to validate the datasets against.',
    );
  }
  const fixtureIds = Array.from(new Set(sets.map((set) => set.fixtureId)));
  if (fixtureIds.length > 1) {
    throw new Error(
      `The selected questions span several samples (${fixtureIds.join(', ')}) — ` +
        'run one sample at a time.',
    );
  }
  return evalFixture(fixtureIds[0]);
}

/**
 * requestContext scoping the agent to the eval datasets, as a session would —
 * plus, when a throwaway eval session exists, the same `session-id` and a
 * live turn-records array `create_visual`/`update_visual` read via
 * `TURN_RECORDS_CONTEXT_KEY` in a real chat turn (see
 * `SessionsService.streamMessage`), and the attempt's usage sink, which the
 * SQL fixer, the visual designer and the tool-only synthesis report their
 * model calls to (agents.md 8.3). The sink is not part of any prompt.
 */
function evalRequestContext(
  datasets: string[],
  sessionId: string | undefined,
  turnRecords: ToolDataRecord[],
  question: string,
  agentTools: readonly OptionalAgentTool[] | undefined,
  usageSink: UsageSink,
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(DATASETS_CONTEXT_KEY, datasets);
  if (sessionId) requestContext.set(SESSION_ID_CONTEXT_KEY, sessionId);
  requestContext.set(TURN_QUESTION_CONTEXT_KEY, question);
  requestContext.set(TURN_RECORDS_CONTEXT_KEY, turnRecords);
  // The case's tool selection, as a session bound to a user agent carries
  // it (agents.md 4.2); none when the case keeps every tool.
  if (agentTools && !isFullSelection(agentTools)) {
    requestContext.set(AGENT_TOOLS_CONTEXT_KEY, [...agentTools]);
  }
  requestContext.set(USAGE_SINK_CONTEXT_KEY, usageSink);
  return requestContext;
}

/**
 * Mirrors `toolRecords()` in `SessionsService` (the non-streaming turn path)
 * but incrementally, per step, via `targetOptions.onStepFinish` — so a
 * `create_visual`/`update_visual` call later in the *same* run sees the SQL
 * earlier steps already captured, the same way production threads a live
 * records array through requestContext during `streamMessage`.
 */
function captureStepRecords(
  step: unknown,
  turnRecords: ToolDataRecord[],
): void {
  for (const entry of arrayField(step, 'toolResults')) {
    const payload = (field(entry, 'payload') ?? entry) as {
      toolName?: string;
      args?: Record<string, unknown>;
      result?: unknown;
    };
    const record = toolDataRecord(
      payload.toolName ?? 'tool',
      payload.args ?? {},
      payload.result,
    );
    if (record) turnRecords.push(record);
  }
}

/** A throwaway session created purely to give `create_visual`/`update_visual`
 * somewhere to write during an eval run. */
export interface EvalSession {
  id: string;
}

/**
 * `create_visual` looks up the session's latest completed answer before it
 * will do anything — a throwaway session with no chat history has none, so
 * seed one generic placeholder once. The chart's actual data comes from the
 * run's own captured records (merged over this placeholder via
 * `TURN_RECORDS_CONTEXT_KEY`), not from this message's (empty) data.
 */
const EVAL_SESSION_PLACEHOLDER_ANSWER =
  'This is a throwaway session created for the assistant eval suite.';

/**
 * A real, disposable session so `create_visual`/`update_visual` — which read
 * `session-id` from requestContext and look up session state — behave the
 * same way they do in a real chat turn. The one runner of the eval suite,
 * `EvalRunsService`, serves both the app and the CLI (`run-assistant-evals.ts`
 * boots the full Nest app); a run that cannot create one still runs, and
 * `create_visual` then reports "No session in context", scored like any
 * other tool error.
 */
export async function createEvalSession(
  sessions: SessionsService,
  datasets: string[],
  /** Bind the session to this built-in agent (`EvalTarget.sessionAgentKey`). */
  agentKey?: string,
): Promise<EvalSession> {
  const name =
    `${agentKey ?? 'assistant'} eval ${new Date().toISOString()}`.slice(0, 64);
  const session = agentKey
    ? await sessions.createFromAgent(agentKey, name)
    : await sessions.create(name, datasets);
  await sessions.appendAssistantMessage(session.id, {
    content: EVAL_SESSION_PLACEHOLDER_ANSWER,
  });
  return { id: session.id };
}

/** Best-effort cleanup — a throwaway session must never outlive its run. */
export async function cleanupEvalSession(
  sessions: SessionsService | undefined,
  session: EvalSession | undefined,
): Promise<void> {
  if (!sessions || !session) return;
  await sessions.delete(session.id).catch(() => undefined);
}

/** Parse a model's JSON reply, tolerating a markdown fence around it —
 * mirrors `parseJsonObject` in `SessionsService`/`DeepAnalysisService`,
 * duplicated here rather than imported so this module's judge check stays
 * usable without pulling in either of those heavier services. */
function parseJsonObject(text: string | undefined): unknown {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(
      trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''),
    );
  } catch {
    return undefined;
  }
}

/** Scorer id for the LLM-judge check, shown in the report's checks table. */
const LLM_JUDGE_CHECK_ID = 'llm-judge';

/** A scored check with its status from its verdict, and its criterion. */
function withStatus(
  check: ScoredCheckResult,
  criterion: string | undefined,
): EvalCheckResult {
  return {
    ...check,
    status: check.passed ? 'passed' : 'failed',
    ...(criterion !== undefined ? { criterion } : {}),
  };
}

/**
 * Score a case's tool calls + final answer against its `judgeRubric` with
 * one structured-output `generate` call on `evalJudgeAgent` (same configured
 * model the assistant runs on, via `resolveAgentModel`). Returns `undefined`
 * when the case has no rubric. A judge that errors or returns unparseable
 * JSON scores 0 rather than crashing the run — the run's other checks and
 * remaining cases must still complete. The judge's call is reported to
 * `usageSink` (R219): its result, or none when the call threw, which counts
 * as a call that reported no tokens.
 */
async function runJudgeCheck(
  evalCase: AssistantEvalCase,
  answer: string,
  toolCalls: EvalToolCall[],
  /** The question as sent, when the target's setup filled it in. */
  question: string = evalCase.question,
  /** Earlier turns sent before the question, if any. */
  history: EvalHistoryMessage[] = [],
  usageSink?: UsageSink,
): Promise<ScoredCheckResult | undefined> {
  if (!evalCase.judgeRubric) return undefined;
  const description = `LLM judge: ${evalCase.judgeRubric}`;
  let called = false;
  try {
    const prompt = [
      ...(history.length
        ? [
            'Earlier conversation, oldest first:',
            ...history.map((m) => `${m.role}: ${m.content}`),
            '',
          ]
        : []),
      `Question asked: ${question}`,
      '',
      'Rubric:',
      evalCase.judgeRubric,
      '',
      'Tool calls the assistant made, in order:',
      toolCalls.length
        ? JSON.stringify(
            toolCalls.map((call) => ({
              name: call.name,
              input: call.input,
              output: call.output,
              error: call.error,
            })),
          )
        : '(none)',
      '',
      "Assistant's final answer to the user:",
      answer || '(the assistant produced no answer text)',
    ].join('\n');

    // Deterministic-ish grading: low temperature where the provider
    // supports it, via providerOptions rather than a top-level field the
    // structured-output call overload does not accept.
    const providerOptions = providerOptionsFor(await resolveAgentModel(), {
      temperature: 0,
    });
    called = true;
    const result = await evalJudgeAgent.generate(prompt, {
      maxSteps: 1,
      toolChoice: 'none',
      providerOptions,
      structuredOutput: {
        schema: evalJudgeOutputSchema,
        jsonPromptInjection: 'inline',
      },
    });
    usageSink?.('judge', result);
    const parsed = evalJudgeOutputSchema.safeParse(
      (result as { object?: unknown }).object ??
        parseJsonObject((result as { text?: string }).text),
    );
    if (!parsed.success) {
      return {
        id: LLM_JUDGE_CHECK_ID,
        description,
        score: 0,
        passed: false,
        reason: 'judge error: the judge did not return valid JSON',
      };
    }
    return {
      id: LLM_JUDGE_CHECK_ID,
      description,
      score: parsed.data.pass ? 1 : 0,
      passed: parsed.data.pass,
      reason: parsed.data.pass ? undefined : parsed.data.reason,
    };
  } catch (err) {
    if (called) usageSink?.('judge', undefined);
    return {
      id: LLM_JUDGE_CHECK_ID,
      description,
      score: 0,
      passed: false,
      reason: `judge error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * The judge check of a case with a rubric (R145, R146): the judge's verdict
 * when the run's option lets it grade this case's category, else a not-scored
 * check, with no model call. Its criterion follows the case's category.
 */
async function judgeCheckFor(
  evalCase: AssistantEvalCase,
  judge: Readonly<EvalJudgeSetting>,
  answer: string,
  toolCalls: EvalToolCall[],
  question: string,
  history: EvalHistoryMessage[],
  usageSink?: UsageSink,
): Promise<EvalCheckResult | undefined> {
  if (!evalCase.judgeRubric) return undefined;
  const criterion = judgeCriterion(evalCase.category);
  if (!shouldJudge(judge, evalCase.category)) {
    return {
      id: LLM_JUDGE_CHECK_ID,
      description: `LLM judge: ${evalCase.judgeRubric}`,
      score: 0,
      passed: false,
      status: 'not-scored',
      reason: JUDGE_OFF_REASON,
      criterion,
    };
  }
  const check = await runJudgeCheck(
    evalCase,
    answer,
    toolCalls,
    question,
    history,
    usageSink,
  );
  return check ? withStatus(check, criterion) : undefined;
}

/** What one attempt needs to know about the run it belongs to. */
export interface EvalAttemptOptions {
  /**
   * The router id of the model the run's agent runs on (`EvalRunView.model`),
   * recorded for every call whose producer names no model (R219). Resolved
   * for the attempt when omitted.
   */
  model?: string;
}

/**
 * The router id of the model the evaluated agent runs on now
 * (`openai/gpt-4o-mini`), as a run records it (R22, R219); undefined when it
 * cannot be resolved, which never fails a run.
 */
export async function evalRunModel(): Promise<string | undefined> {
  try {
    const config = await resolveAgentModel();
    return config ? modelIdOf(config) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Run one question once: one attempt (R210). Each case is its own `runEvals`
 * call because `runEvals` keys and averages scores across the data items of
 * a single call — one call for all ten questions would collapse them into
 * one set of numbers. The result is the attempt's alone (`runs` 1), with the
 * tokens of every model call made for it (R219); `runCaseAttempts` folds a
 * question's attempts.
 */
export async function runAssistantEvalCase(
  evalCase: AssistantEvalCase,
  datasets: string[],
  sessionId?: string,
  /**
   * The curated-knowledge system block (`KnowledgeService.definitionBlock`)
   * for these datasets — same block a real chat turn gets from
   * `SessionsService.agentContext`. `EvalRunsService`, which runs the suite
   * for the app and the CLI, populates this from `KnowledgeService`; omitted
   * (or empty) when no caller wires one in.
   */
  knowledgeBlock?: string,
  /** The agent the case runs on; the assistant when omitted (agents.md 8.1). */
  target: EvalTarget = ASSISTANT_EVAL_TARGET,
  /** The run's judge option (R144); off unless the caller says otherwise. */
  judge: Readonly<EvalJudgeSetting> = JUDGE_OFF,
  options: EvalAttemptOptions = {},
): Promise<AssistantEvalCaseResult> {
  const startedAt = Date.now();
  // The question sent: the case's own, unless the target's setup fills it.
  let question = evalCase.question;
  // Captured from the per-item callback: the run itself only reports numbers.
  let answer = '';
  let toolCalls: EvalToolCall[] = [];
  let rawToolCalls: EvalRawToolCall[] = [];
  let history: EvalHistoryMessage[] = [];
  let vars: Record<string, string> = {};
  let scorerPayloads: Record<string, any> = {};
  // Populated live via onStepFinish as the run executes — the same records a
  // real turn would have threaded through TURN_RECORDS_CONTEXT_KEY.
  const turnRecords: ToolDataRecord[] = [];
  // Every model call made for this attempt, by agent and model (R219). A
  // producer that names no model ran on the run's.
  const usage: ModelUsageEntry[] = [];
  let runModel = options.model;
  const usageSink: UsageSink = (agent, result, model) => {
    try {
      recordUsage(usage, agent, model ?? runModel, result);
    } catch {
      // Recording tokens never fails the attempt it measures.
    }
  };
  // The agent's own generate: started, and whether its result was recorded.
  let assistantCalled = false;
  let assistantRecorded = false;
  /** The fields every attempt result carries, whatever happened. */
  const attemptFields = (status: EvalStatus) => ({
    id: evalCase.id,
    question,
    ...(evalCase.category !== undefined ? { category: evalCase.category } : {}),
    split: evalCase.split ?? 'dev',
    passes: status === 'passed' ? 1 : 0,
    runs: 1,
    flaky: false,
  });

  try {
    runModel ??= await evalRunModel();
    const datasetSnapshots =
      await getDatasetToolServices().getDatasets(datasets);
    if (target.prepareQuestion) {
      const prepared = await target.prepareQuestion(evalCase, {
        datasets,
        snapshots: datasetSnapshots,
      });
      if (typeof prepared === 'string') {
        question = prepared;
      } else {
        question = prepared.question;
        history = prepared.history ?? [];
        vars = prepared.vars ?? {};
      }
    }
    const requestContext = evalRequestContext(
      datasets,
      sessionId,
      turnRecords,
      question,
      evalCase.agentTools,
      usageSink,
    );
    target.configureContext?.(requestContext);
    const orientation = await target.orientation({
      datasets,
      snapshots: datasetSnapshots,
      requestContext,
      vars,
    });

    assistantCalled = true;
    const result = await runEvals({
      data: [
        {
          // A multi-turn case sends its earlier turns before the question.
          input: history.length
            ? [...history, { role: 'user' as const, content: question }]
            : question,
          requestContext,
        },
      ],
      scorers: evalCase.scorers,
      target: target.agent,
      // Same step budget and dataset/entity + join-hint grounding a real chat
      // turn gets from SessionsService.agentContext — without this the model
      // used to run out of steps mid-analysis (the AI-SDK default cap is 5)
      // and every case died with empty answer text.
      targetOptions: {
        maxSteps: ASSISTANT_MAX_STEPS,
        context: [
          { role: 'system', content: orientation },
          ...(target.sendsKnowledge ? knowledgeContext(knowledgeBlock) : []),
        ],
        onStepFinish: (step: unknown) => captureStepRecords(step, turnRecords),
      },
      onItemComplete: ({ targetResult, scorerResults }) => {
        // The agent's generate, every step included (`totalUsage`).
        usageSink('assistant', targetResult);
        assistantRecorded = true;
        answer = String(targetResult?.text ?? '');
        toolCalls = extractToolCalls(targetResult);
        rawToolCalls = extractRawToolCalls(targetResult).map((call) => ({
          name: call.name,
          input: call.input,
          output: call.output,
          failed: call.failed,
        }));
        scorerPayloads = scorerResults ?? {};
      },
    });

    // Mirrors SessionsService.streamMessage's tool-only-turn fallback: a run
    // that spent every step on tools and never produced prose still gets a
    // reported answer built from what the tools actually returned, instead
    // of scoring/reporting an empty string. Note: `runEvals` scores the
    // target's own output before this callback runs, so this fixes what the
    // report *shows* as the answer; it cannot retroactively change scores
    // already computed against the empty text. With maxSteps now matching
    // production this path should be rare — the empty-answer failures in the
    // original bug report were caused by the 5-step default, not by the
    // model routinely finishing without prose.
    if (!answer.trim() && toolCalls.length > 0) {
      answer = await synthesizeToolOnlyTurn(
        target.agent,
        question,
        turnRecords,
        new AbortController().signal,
        providerOptionsFor(await resolveAgentModel(), {
          reasoningEffort: 'medium',
        }),
        undefined,
        requestContext,
      );
    }

    const scores: Record<string, number> = {};
    for (const [id, value] of Object.entries(result.scores ?? {})) {
      scores[id] = typeof value === 'number' ? value : Number(value ?? 0);
    }

    const checkResults: EvalCheckResult[] = evalCase.scorers.map(
      (scorer, index) => {
        const id = String(scorer.id ?? '');
        const score = scores[id] ?? 0;
        const passed = score === 1;
        return withStatus(
          {
            id,
            description: String(scorer.description ?? scorer.name ?? id),
            score,
            passed,
            reason: passed ? undefined : checkReason(scorerPayloads[id]),
          },
          evalCase.checkCriteria?.[index],
        );
      },
    );

    // Result-set comparison (Feature 1) — primary correctness signal for
    // cases with expectedSql, on top of the text/tool scorers above.
    const resultSetCheck = await runResultSetCheck(
      evalCase.expectedSql,
      datasets,
      datasetSnapshots,
      turnRecords,
      evalCase.resultSetOptions,
    );
    if (resultSetCheck) checkResults.push(withStatus(resultSetCheck, 'D1'));

    // Custom checks: tool arguments, call order, state read back. They name
    // no criterion.
    for (const check of evalCase.customChecks ?? []) {
      checkResults.push(
        withStatus(
          await runCustomCheck(check, {
            answer,
            toolCalls: rawToolCalls,
            datasets,
            vars,
          }),
          undefined,
        ),
      );
    }

    // LLM-judge (Feature 2) — for cases where a regex/text check on the
    // final answer would be too brittle. Not called, and not scored, when
    // the run's judge option leaves this case out (R145).
    const judgeCheck = await judgeCheckFor(
      evalCase,
      judge,
      answer,
      target.judgeTraceChars
        ? rawToolCalls.map((call) => ({
            name: call.name,
            input: encode(call.input, target.judgeTraceChars),
            output: call.failed
              ? undefined
              : encode(call.output, target.judgeTraceChars),
            error: call.failed
              ? (encode(call.output, target.judgeTraceChars) ??
                'Tool call failed')
              : undefined,
          }))
        : toolCalls,
      question,
      history,
      usageSink,
    );
    if (judgeCheck) checkResults.push(judgeCheck);

    const status = questionStatus(checkResults);
    return {
      ...attemptFields(status),
      scores,
      checkResults,
      answer,
      toolCalls,
      status,
      passed: status === 'passed',
      durationMs: Date.now() - startedAt,
      usage,
      costUsd: costUsdOf(usage),
    };
  } catch (err) {
    // The generate threw before its result was recorded: a call whose
    // tokens are unknown, never a free one (R219).
    if (assistantCalled && !assistantRecorded) {
      usageSink('assistant', undefined);
    }
    return {
      ...attemptFields('failed'),
      scores: {},
      checkResults: [],
      answer,
      toolCalls,
      status: 'failed',
      passed: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
      usage,
      costUsd: costUsdOf(usage),
    };
  } finally {
    await target.afterCase?.(datasets);
  }
}

/** One custom check's verdict; a throw is a failure with its message. */
async function runCustomCheck(
  check: EvalCustomCheck,
  input: EvalCustomCheckInput,
): Promise<ScoredCheckResult> {
  let reason: string | undefined;
  try {
    reason = await check.run(input);
  } catch (err) {
    reason = `check error: ${err instanceof Error ? err.message : String(err)}`;
  }
  const passed = reason === undefined;
  return {
    id: check.id,
    description: check.description,
    score: passed ? 1 : 0,
    passed,
    reason,
  };
}
