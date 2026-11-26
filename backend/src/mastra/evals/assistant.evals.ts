import { checks } from '@mastra/evals/checks';
import { runEvals } from '@mastra/core/evals';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraScorer } from '@mastra/core/evals';
import type { Agent } from '@mastra/core/agent';
import { resolveAgentModelConfig } from '../model-resolver';
import { providerOptionsFor } from '../model-compat';
import {
  evalJudgeAgent,
  evalJudgeOutputSchema,
} from '../agents/eval-judge.agent';
import { ASSISTANT_MAX_STEPS } from '../agent-constants';
import { EVAL_RUN_CONTEXT_KEY } from './eval-trace-marker';
import { inEvalRun } from './eval-run-scope';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import { TURN_QUESTION_CONTEXT_KEY } from '../tools/turn-context';
import { getDatasetToolServices } from '../tool-services';
import type { DatasetSnapshot } from '../tool-services';
import { knowledgeContext } from '../context-blocks';
import { runResultSetCheck } from './result-set-check';
import type { ResultSetCheckOptions } from './result-set-check';
import {
  assistantEvalDatasetError,
  evalFixture,
} from './assistant-eval-datasets';
import type { SampleFixture } from '../../modules/testing-data/fixtures/registry';
import {
  synthesizeToolOnlyTurn,
  toolDataRecord,
} from '../../modules/sessions/turn-data';
import type { ToolDataRecord } from '../../modules/sessions/entities/session.entity';
import {
  EVAL_CASE_CONTEXT_KEY,
  evalDetailsOf,
  type EvalRunDetails,
} from './eval-details';

/**
 * The eval runner every agent's sets run on (agents.md 8.1): the case, set
 * and target shapes, and the run of one case (`runAssistantEvalCase`) or of
 * a selection (`runAssistantEvals`). The sets live with their agent
 * (`*.evals.ts`, registered in `eval-sets.ts`); the file keeps its name from
 * when it also held the assistant's sets, which run on Elena now
 * (`insights-lead-data.evals.ts`).
 *
 * Each case runs with the datasets it may query on its requestContext, so
 * the agent resolves its entities from them as a session's turn would.
 */

/**
 * `runEvals` keys its scores by scorer id, so two scorers of the same kind in
 * one case would collide — a case uses each built-in check type at most once.
 */
export interface AssistantEvalCase {
  /** Short id used when reporting per-question scores. */
  id: string;
  question: string;
  /** What the question is probing for, for the run report. */
  intent: string;
  scorers: MastraScorer<any, any, any, any>[];
  /**
   * Trusted SQL against the eval datasource whose live result set is the
   * reference answer. When present, `runAssistantEvalCase` compares it
   * (via `runResultSetCheck`) against the agent's successful
   * `run_readonly_sql` results (the records it captured, else the run's
   * `details.records`) and adds that as the case's primary correctness
   * signal, on top of the text/tool checks.
   */
  expectedSql?: string;
  resultSetOptions?: ResultSetCheckOptions;
  /**
   * A natural-language grading rubric for cases where a regex/text check on
   * the final answer would be too brittle (clarification quality, refusal
   * quality). When present, `runAssistantEvalCase` scores it with the LLM
   * judge (`../agents/eval-judge.agent`) as an additional check.
   */
  judgeRubric?: string;
  /**
   * Deterministic checks the built-in ones cannot express: tool arguments,
   * the order of particular calls, or state read back after the run. Each
   * has its own id, so a case can hold several of the same kind (the
   * built-in checks share one id per kind, see above).
   */
  customChecks?: EvalCustomCheck[];
  /**
   * The frozen input of a case whose target calls one model function
   * (`isolatedCallTarget`, agents.md 8.1): exactly what the call receives,
   * typed by the target's input type. The target reads it from the case,
   * not from `question` (which is then only the case's label).
   */
  input?: unknown;
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
  /**
   * Structured facts of the run (agents.md 8.1, "Run details"): an
   * isolated call's whole `output` and a workflow's step outputs (`steps`). The runner
   * always sets it (`{}` when the target sets none); optional only so a
   * spec can call a check without it.
   */
  details?: EvalRunDetails;
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
  /** The registry key of the agent the set runs on (agents.md 8.1). */
  agentKey: string;
  /**
   * The eval target its cases run on, when its agent has more than one
   * (`eval-sets.ts` `EVAL_TARGET_FACTORIES`). Absent means the agent's own
   * target (its `agentKey`).
   */
  target?: string;
  cases: AssistantEvalCase[];
}

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
 * 8.1, `agentKey`).
 */
export interface EvalTarget {
  /** Registry key of the agent. */
  agentKey: string;
  agent: Agent;
  /**
   * What a case runs, when not the agent alone: Insights Analyst's cases
   * run him as Avery's answer_from_data does (agents.md 8.1, 5.23). A run of
   * it never gets the tool-only synthesis: its answer is his reply.
   */
  runTarget?: Agent;
  /** The sets that run on this agent. */
  sets: AssistantEvalSet[];
  /** The orientation system message of a case (Block 1's dataset half, or Block D1). */
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
   * How much of each tool input and output the LLM judge reads; the
   * report's 2,000 characters when unset. An agent whose tools answer
   * long results has its judge read more of them.
   */
  judgeTraceChars?: number;
}

/** One tool the agent called while answering, in call order. */
export interface EvalToolCall {
  name: string;
  /** Arguments the agent passed, JSON-encoded and truncated. */
  input?: string;
  /** What the tool returned, JSON-encoded and truncated. */
  output?: string;
  error?: string;
}

/** One scorer's verdict on a question, with why it landed there. */
export interface EvalCheckResult {
  id: string;
  /** The scorer's own description, e.g. 'Checks if output includes "X"'. */
  description: string;
  score: number;
  passed: boolean;
  /** Why the check scored what it did — populated on failure where known. */
  reason?: string;
}

/** Outcome of one question. */
export interface AssistantEvalCaseResult {
  id: string;
  question: string;
  /** Score per scorer id, 0..1. Empty when the run threw. */
  scores: Record<string, number>;
  /** Per-check verdicts, in the order the case declares them. */
  checkResults: EvalCheckResult[];
  /** The agent's final answer text. */
  answer: string;
  /** The tool calls the agent made, in order — the executed process. */
  toolCalls: EvalToolCall[];
  /** True when every scorer scored 1. */
  passed: boolean;
  /** Set when the agent run itself failed (connection, model, tool crash). */
  error?: string;
  /** Wall time for the question, in milliseconds. */
  durationMs: number;
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
  caseIds: string[] | undefined,
  sets: AssistantEvalSet[],
): AssistantEvalCase[] {
  const all = sets.flatMap((set) => set.cases);
  if (!caseIds) return all;
  const wanted = new Set(caseIds);
  return all.filter((evalCase) => wanted.has(evalCase.id));
}

/** The sets the selection touches — every set when nothing is named. */
export function selectEvalSets(
  caseIds: string[] | undefined,
  sets: AssistantEvalSet[],
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
  caseIds: string[] | undefined,
  from: AssistantEvalSet[],
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
 * requestContext scoping the agent to the eval datasets, as a session would,
 * with the question as the turn's (`turn-question`, which monitoring reads).
 */
function evalRequestContext(
  datasets: string[],
  question: string,
  /** The eval run's job id; marks the case's traffic in the trace store (ADR-0054). */
  evalRunId?: string,
): RequestContext {
  const requestContext = new RequestContext();
  if (evalRunId) requestContext.set(EVAL_RUN_CONTEXT_KEY, evalRunId);
  requestContext.set(DATASETS_CONTEXT_KEY, datasets);
  requestContext.set(TURN_QUESTION_CONTEXT_KEY, question);
  return requestContext;
}

/**
 * Mirrors `toolRecords()` (the turn engine) but incrementally, per step, via
 * `targetOptions.onStepFinish`: the records of an agent's own run, which the
 * result-set check and the tool-only synthesis read.
 */
export function captureStepRecords(
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

/** Parse a model's JSON reply, tolerating a markdown fence around it —
 * mirrors `parseJsonObject` in `SqlChecks`, duplicated here rather than
 * imported so this module's judge check stays usable without pulling in
 * that heavier service. */
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

/**
 * The judge's prompt (agents.md 8.1): the question, the rubric, the context
 * the target says the assistant was given (only when it reports one, in a
 * section of its own before the tool calls), the tool calls and the answer.
 */
export function judgePrompt(
  evalCase: AssistantEvalCase,
  answer: string,
  toolCalls: EvalToolCall[],
  question: string,
  history: EvalHistoryMessage[],
  context?: string,
): string {
  return [
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
    ...(context
      ? [
          'Catalogue the assistant was given (entities and their columns):',
          context,
          '',
        ]
      : []),
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
}

/**
 * Score a case's tool calls + final answer against its `judgeRubric` with
 * one structured-output `generate` call on `evalJudgeAgent` (same configured
 * model the assistant runs on, via `resolveAgentModel`). Returns `undefined`
 * when the case has no rubric. A judge that errors or returns unparseable
 * JSON scores 0 rather than crashing the run — the run's other checks and
 * remaining cases must still complete.
 */
async function runJudgeCheck(
  evalCase: AssistantEvalCase,
  answer: string,
  toolCalls: EvalToolCall[],
  /** The question as sent, when the target's setup filled it in. */
  question: string = evalCase.question,
  /** Earlier turns sent before the question, if any. */
  history: EvalHistoryMessage[] = [],
  /** What the target reports the assistant was given (`judgeContext`). */
  context?: string,
  /** The case's request context, so the judge's spans carry the eval marker. */
  requestContext?: RequestContext,
): Promise<EvalCheckResult | undefined> {
  if (!evalCase.judgeRubric) return undefined;
  const description = `LLM judge: ${evalCase.judgeRubric}`;
  try {
    const prompt = judgePrompt(
      evalCase,
      answer,
      toolCalls,
      question,
      history,
      context,
    );

    const result = await evalJudgeAgent.generate(prompt, {
      maxSteps: 1,
      toolChoice: 'none',
      requestContext,
      // Deterministic-ish grading: low temperature where the provider
      // supports it, via providerOptions rather than a top-level field the
      // structured-output call overload does not accept.
      providerOptions: providerOptionsFor(await resolveAgentModelConfig(), {
        temperature: 0,
      }),
      structuredOutput: {
        schema: evalJudgeOutputSchema,
        jsonPromptInjection: 'inline',
      },
    });
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
 * Run one question. Each case is its own `runEvals` call because `runEvals`
 * keys and averages scores across the data items of a single call — one call
 * for all ten questions would collapse them into one set of numbers.
 */
/**
 * The scorer of a case with custom checks only: it passes every answer, so
 * the verdict is the custom checks' (Mastra's runEvals needs one scorer).
 */
function anyAnswer() {
  return checks.includes('');
}

export function runAssistantEvalCase(
  evalCase: AssistantEvalCase,
  datasets: string[],
  /** The agent the case runs on (agents.md 8.1). */
  target: EvalTarget,
  /**
   * The curated-knowledge system block (`OntologyService.definitionBlock`)
   * for these datasets, sent when the target `sendsKnowledge`. Both callers
   * (`EvalRunsService`, the CLI in `run-evals.ts`) populate this from
   * `OntologyService`; omitted (or empty) when neither wires one in.
   */
  knowledgeBlock?: string,
  /**
   * The eval run's job id: the trace marker (ADR-0054). The whole case runs
   * in the run's scope (`inEvalRun`), so every span any model call of it
   * starts is marked, whatever request context the target's own code builds;
   * it is also set on the case's request context.
   */
  evalRunId?: string,
): Promise<AssistantEvalCaseResult> {
  return inEvalRun(evalRunId, () =>
    runCaseInScope(evalCase, datasets, knowledgeBlock, target, evalRunId),
  );
}

/** `runAssistantEvalCase`, inside the run's scope. */
async function runCaseInScope(
  evalCase: AssistantEvalCase,
  datasets: string[],
  knowledgeBlock: string | undefined,
  target: EvalTarget,
  evalRunId: string | undefined,
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
  let details: EvalRunDetails = {};
  let scorerPayloads: Record<string, any> = {};
  // Populated live via onStepFinish as the agent's own run executes.
  const turnRecords: ToolDataRecord[] = [];

  try {
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
    const requestContext = evalRequestContext(datasets, question, evalRunId);
    // The case itself, for a target that reads its frozen `input`.
    requestContext.set(EVAL_CASE_CONTEXT_KEY, evalCase);
    target.configureContext?.(requestContext);
    const orientation = await target.orientation({
      datasets,
      snapshots: datasetSnapshots,
      requestContext,
      vars,
    });

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
      // Mastra wants one scorer at least: a case judged only by custom
      // checks (the isolated-call sets) gets one that any answer passes.
      scorers: evalCase.scorers.length ? evalCase.scorers : [anyAnswer()],
      target: target.runTarget ?? target.agent,
      // Same step budget and dataset/entity + join-hint grounding a real chat
      // turn gets from TurnOptions.agentContext — without this the model
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
        answer = String(targetResult?.text ?? '');
        toolCalls = extractToolCalls(targetResult);
        rawToolCalls = extractRawToolCalls(targetResult).map((call) => ({
          name: call.name,
          input: call.input,
          output: call.output,
          failed: call.failed,
        }));
        scorerPayloads = scorerResults ?? {};
        details = evalDetailsOf(targetResult);
      },
    });

    // Mirrors TurnEngine.streamTurn's tool-only-turn fallback: a run
    // that spent every step on tools and never produced prose still gets a
    // reported answer built from what the tools actually returned, instead
    // of scoring/reporting an empty string. Note: `runEvals` scores the
    // target's own output before this callback runs, so this fixes what the
    // report *shows* as the answer; it cannot retroactively change scores
    // already computed against the empty text. With maxSteps now matching
    // production this path should be rare — the empty-answer failures in the
    // original bug report were caused by the 5-step default, not by the
    // model routinely finishing without prose.
    if (!target.runTarget && !answer.trim() && toolCalls.length > 0) {
      answer = await synthesizeToolOnlyTurn(
        target.agent,
        question,
        turnRecords,
        new AbortController().signal,
        providerOptionsFor(await resolveAgentModelConfig(), {
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

    const checkResults: EvalCheckResult[] = evalCase.scorers.map((scorer) => {
      const id = String(scorer.id ?? '');
      const score = scores[id] ?? 0;
      const passed = score === 1;
      return {
        id,
        description: String(scorer.description ?? scorer.name ?? id),
        score,
        passed,
        reason: passed ? undefined : checkReason(scorerPayloads[id]),
      };
    });

    // Result-set comparison (Feature 1) — primary correctness signal for
    // cases with expectedSql, on top of the text/tool scorers above.
    // The agent's own records, else the whole run's (a whole-run target
    // streams no steps here; it hands its stored records back instead).
    const resultSetCheck = await runResultSetCheck(
      evalCase.expectedSql,
      datasets,
      datasetSnapshots,
      turnRecords.length ? turnRecords : (details.records ?? []),
      evalCase.resultSetOptions,
    );
    if (resultSetCheck) checkResults.push(resultSetCheck);

    // Custom checks: tool arguments, call order, state read back.
    for (const check of evalCase.customChecks ?? []) {
      checkResults.push(
        await runCustomCheck(check, {
          answer,
          toolCalls: rawToolCalls,
          datasets,
          vars,
          details,
        }),
      );
    }

    // LLM-judge (Feature 2) — for cases where a regex/text check on the
    // final answer would be too brittle.
    const judgeCheck = await runJudgeCheck(
      evalCase,
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
      details.judgeContext,
      requestContext,
    );
    if (judgeCheck) checkResults.push(judgeCheck);

    return {
      id: evalCase.id,
      question,
      scores,
      checkResults,
      answer,
      toolCalls,
      passed:
        checkResults.length > 0 && checkResults.every((check) => check.passed),
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      id: evalCase.id,
      question,
      scores: {},
      checkResults: [],
      answer,
      toolCalls,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await target.afterCase?.(datasets);
  }
}

/** One custom check's verdict; a throw is a failure with its message. */
async function runCustomCheck(
  check: EvalCustomCheck,
  input: EvalCustomCheckInput,
): Promise<EvalCheckResult> {
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

/** What a run of a selection gets beside its target and datasets. */
export interface EvalRunOptions {
  /** The cases to run; every case of the target's sets when omitted. */
  caseIds?: string[];
  /** Called as each case lands, in order. */
  onCaseComplete?: (result: AssistantEvalCaseResult) => void;
  /** The curated-knowledge block (`runAssistantEvalCase`). */
  knowledgeBlock?: string;
  /** The eval run's job id, passed to every case as the trace marker (ADR-0054). */
  evalRunId?: string;
}

/**
 * Run every selected case of `target`'s sets sequentially against the given
 * datasets, reporting each as it lands. Sequential keeps the load on the
 * datasource (and the model) to what a single user session would produce.
 * The datasets are checked against the selection's sample first, so a
 * wrong scope fails before any model call.
 */
export async function runAssistantEvals(
  target: EvalTarget,
  datasets: string[],
  options: EvalRunOptions = {},
): Promise<AssistantEvalCaseResult[]> {
  const { caseIds, onCaseComplete, knowledgeBlock, evalRunId } = options;
  const datasetError = assistantEvalDatasetError(
    datasets,
    await getDatasetToolServices().getDatasets(datasets),
    fixtureForCases(caseIds, target.sets),
  );
  if (datasetError) throw new Error(datasetError);
  try {
    const results: AssistantEvalCaseResult[] = [];
    for (const evalCase of selectEvalCases(caseIds, target.sets)) {
      const result = await runAssistantEvalCase(
        evalCase,
        datasets,
        target,
        knowledgeBlock,
        evalRunId,
      );
      results.push(result);
      onCaseComplete?.(result);
    }
    return results;
  } finally {
    await inEvalRun(evalRunId, async () => target.finish?.(datasets));
  }
}
