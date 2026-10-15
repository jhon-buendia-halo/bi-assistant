import { runEvals } from '@mastra/core/evals';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraScorer } from '@mastra/core/evals';
import { assistantAgent } from '../agents/assistant.agent';
import { resolveAgentModel } from '../model-resolver';
import { providerOptionsFor } from '../model-compat';
import {
  evalJudgeAgent,
  evalJudgeOutputSchema,
} from '../agents/eval-judge.agent';
import { ASSISTANT_MAX_STEPS } from '../agent-constants';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';
import {
  SESSION_ID_CONTEXT_KEY,
  TURN_RECORDS_CONTEXT_KEY,
} from '../tools/visual.tools';
import { getDatasetToolServices } from '../tool-services';
import { entityOrientationLines } from '../context-blocks';
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
import type { SessionsService } from '../../modules/sessions/sessions.service';

/**
 * Eval suite for the Questions to Insights assistant.
 *
 * The questions are data: one JSON file per question bank under `./sets/`,
 * loaded and checked by `./eval-set-files.ts` (ADR-0015). They are grouped into
 * sets, one per bundled sample and datasource kind, and every expected
 * substring in them is a fact that is actually in that sample's data — a check
 * failing means the agent got it wrong, not that the fixture drifted.
 *
 * The assistant resolves its entities from the session's datasets via
 * requestContext, so each case carries the dataset it is allowed to query.
 */

/**
 * `runEvals` keys its scores by scorer id, so two scorers of the same kind in
 * one case would collide — the set loader refuses a check type used twice in
 * one case.
 */
export interface AssistantEvalCase {
  /** Short id used when reporting per-question scores. */
  id: string;
  question: string;
  /** What the question is probing for, for the run report. */
  intent: string;
  scorers: MastraScorer<any, any, any, any>[];
  /**
   * The criterion each scorer measures (agents-evals R124, R145), one entry
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
   * judge option allows it; otherwise the check is not scored (R144).
   */
  judgeRubric?: string;
  /** The case's primary category (research 2.6); never graded. */
  category?: EvalCategory;
  /** `dev`, or `held-out` for cases kept out of prompt tuning. */
  split?: EvalSplit;
  /** Free labels such as `ties`, `control` or `rest:paging`. */
  tags?: string[];
  /** Why the case exists and what it guards; for people, never graded. */
  notes?: string;
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
  cases: AssistantEvalCase[];
}

/**
 * Every question set the assistant suite offers, in order: World Cup, World
 * Cup (REST API), Formula 1, then World Cup (golden set). The questions are
 * data under `./sets/` (ADR-0015), read and checked by `loadEvalSets` when
 * this module loads, so a set file the loader refuses stops the backend
 * instead of running a broken case. Adding a question is an edit to a set
 * file, not to this module or the questions tab.
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
  /** `not-scored` only for a judge check the run did not call (R145). */
  status: EvalStatus;
  /** The criterion the check measures, when it has one (R145). */
  criterion?: string;
}

/** Outcome of one question. */
export interface AssistantEvalCaseResult {
  id: string;
  question: string;
  /** The case's category (R146); absent on runs saved before BA-184. */
  category?: string;
  /** Score per scorer id, 0..1. Empty when the run threw. */
  scores: Record<string, number>;
  /** Per-check verdicts, in the order the case declares them. */
  checkResults: EvalCheckResult[];
  /** The agent's final answer text. */
  answer: string;
  /** The tool calls the agent made, in order — the executed process. */
  toolCalls: EvalToolCall[];
  /** Passed, failed or not scored (R146). */
  status: EvalStatus;
  /** True exactly when `status` is `passed`: a not-scored question is not. */
  passed: boolean;
  /** Set when the agent run itself failed (connection, model, tool crash). */
  error?: string;
  /** Wall time for the question, in milliseconds. */
  durationMs: number;
}

/** Tool payloads can be whole result sets; keep the trace readable. */
const MAX_TRACE_FIELD = 2000;

function encode(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text =
    typeof value === 'string' ? value : (safeStringify(value) ?? String(value));
  return text.length > MAX_TRACE_FIELD
    ? `${text.slice(0, MAX_TRACE_FIELD)}… (truncated)`
    : text;
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
function extractToolCalls(targetResult: any): EvalToolCall[] {
  const steps: any[] = Array.isArray(targetResult?.steps)
    ? targetResult.steps
    : [targetResult];

  const calls: EvalToolCall[] = [];
  for (const step of steps) {
    if (!step) continue;
    const stepCalls: any[] = Array.isArray(step.toolCalls)
      ? step.toolCalls
      : [];
    const stepResults: any[] = Array.isArray(step.toolResults)
      ? step.toolResults
      : [];

    for (const call of stepCalls) {
      const callPayload = call?.payload ?? call;
      const match = stepResults.find((result) => {
        const resultPayload = result?.payload ?? result;
        return resultPayload?.toolCallId === callPayload?.toolCallId;
      });
      const matchPayload = match?.payload ?? match;
      const output = matchPayload?.output ?? matchPayload?.result;
      calls.push({
        name: String(callPayload?.toolName ?? callPayload?.name ?? 'unknown'),
        input: encode(callPayload?.input ?? callPayload?.args),
        output: matchPayload?.isError ? undefined : encode(output),
        error: matchPayload?.isError
          ? (encode(output) ?? 'Tool call failed')
          : undefined,
      });
    }
  }
  return calls;
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
function checkReason(payload: any): string | undefined {
  const detail = payload?.preprocessStepResult;
  if (detail && typeof detail === 'object') {
    if ('target' in detail && 'found' in detail) {
      return `expected ${JSON.stringify(detail.target)} in the answer — ${outputHint(detail.output)}`;
    }
    if ('target' in detail && 'excluded' in detail) {
      return `expected ${JSON.stringify(detail.target)} NOT to appear — ${outputHint(detail.output)}`;
    }
    if ('pattern' in detail && 'matched' in detail) {
      return `expected the answer to match ${detail.pattern} — ${outputHint(detail.output)}`;
    }
    if ('toolName' in detail && 'actualCount' in detail) {
      const expected = detail.expectedTimes ?? 1;
      return `expected "${detail.toolName}" to be called ${expected}×, it was called ${detail.actualCount}×`;
    }
    if ('toolName' in detail && 'called' in detail) {
      return `expected "${detail.toolName}" NOT to be called, it was`;
    }
    if ('expectedOrder' in detail) {
      const actual = Array.isArray(detail.actualOrder)
        ? detail.actualOrder.join(' → ')
        : 'nothing';
      const expected = Array.isArray(detail.expectedOrder)
        ? detail.expectedOrder.join(' → ')
        : String(detail.expectedOrder);
      return `expected the tool order ${expected}, got ${actual || 'nothing'}`;
    }
    if ('errors' in detail || 'toolErrors' in detail) {
      const errors = detail.errors ?? detail.toolErrors;
      return `a tool call failed: ${encode(errors) ?? 'unknown error'}`;
    }
    const encoded = encode(detail);
    if (encoded) return encoded;
  }
  return typeof payload?.reason === 'string' ? payload.reason : undefined;
}

/**
 * The cases to run: the named ones, or all of them when the caller passes no
 * list at all. An explicit empty list selects nothing — it must not be read as
 * "run everything", or an empty selection would start a full (paid) run.
 */
export function selectEvalCases(caseIds?: string[]): AssistantEvalCase[] {
  if (!caseIds) return ASSISTANT_EVAL_CASES;
  const wanted = new Set(caseIds);
  return ASSISTANT_EVAL_CASES.filter((evalCase) => wanted.has(evalCase.id));
}

/** The sets the selection touches — every set when nothing is named. */
export function selectEvalSets(caseIds?: string[]): AssistantEvalSet[] {
  if (!caseIds) return ASSISTANT_EVAL_SETS;
  const wanted = new Set(caseIds);
  return ASSISTANT_EVAL_SETS.filter((set) =>
    set.cases.some((evalCase) => wanted.has(evalCase.id)),
  );
}

/**
 * The sample a selection of questions must be run against. Throws when the
 * selection resolves to no set, to several samples at once (their schemas are
 * unrelated — a run scoped to one cannot answer the other), or to a fixture id
 * the registry does not know.
 */
export function fixtureForCases(caseIds?: string[]): SampleFixture {
  const sets = selectEvalSets(caseIds);
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
 * `SessionsService.streamMessage`).
 */
function evalRequestContext(
  datasets: string[],
  sessionId: string | undefined,
  turnRecords: ToolDataRecord[],
): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(DATASETS_CONTEXT_KEY, datasets);
  if (sessionId) requestContext.set(SESSION_ID_CONTEXT_KEY, sessionId);
  requestContext.set(TURN_RECORDS_CONTEXT_KEY, turnRecords);
  return requestContext;
}

/**
 * Mirrors `toolRecords()` in `SessionsService` (the non-streaming turn path)
 * but incrementally, per step, via `targetOptions.onStepFinish` — so a
 * `create_visual`/`update_visual` call later in the *same* run sees the SQL
 * earlier steps already captured, the same way production threads a live
 * records array through requestContext during `streamMessage`.
 */
function captureStepRecords(step: any, turnRecords: ToolDataRecord[]): void {
  const results: any[] = Array.isArray(step?.toolResults)
    ? step.toolResults
    : [];
  for (const entry of results) {
    const payload = (entry?.payload ?? entry) as {
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
 * same way they do in a real chat turn. Both callers of the eval suite
 * (`EvalRunsService`, the in-app runner, and `run-assistant-evals.ts`, the
 * CLI) boot the full Nest app and can hand this a `SessionsService`; callers
 * that cannot (e.g. a lightweight unit test) simply omit it and the suite
 * still runs — `create_visual` then reports "No session in context", scored
 * like any other tool error.
 */
export async function createEvalSession(
  sessions: SessionsService,
  datasets: string[],
): Promise<EvalSession> {
  const session = await sessions.create(
    `assistant eval ${new Date().toISOString()}`.slice(0, 64),
    datasets,
  );
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
 * remaining cases must still complete.
 */
async function runJudgeCheck(
  evalCase: AssistantEvalCase,
  answer: string,
  toolCalls: EvalToolCall[],
): Promise<ScoredCheckResult | undefined> {
  if (!evalCase.judgeRubric) return undefined;
  const description = `LLM judge: ${evalCase.judgeRubric}`;
  try {
    const prompt = [
      `Question asked: ${evalCase.question}`,
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

    const result = await evalJudgeAgent.generate(prompt, {
      maxSteps: 1,
      toolChoice: 'none',
      // Deterministic-ish grading: low temperature where the provider
      // supports it, via providerOptions rather than a top-level field the
      // structured-output call overload does not accept.
      providerOptions: providerOptionsFor(await resolveAgentModel(), {
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
 * The judge check of a case with a rubric (R144, R145): the judge's verdict
 * when the run's option lets it grade this case's category, else a not-scored
 * check, with no model call. Its criterion follows the case's category.
 */
async function judgeCheckFor(
  evalCase: AssistantEvalCase,
  judge: Readonly<EvalJudgeSetting>,
  answer: string,
  toolCalls: EvalToolCall[],
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
  const check = await runJudgeCheck(evalCase, answer, toolCalls);
  return check ? withStatus(check, criterion) : undefined;
}

/**
 * Run one question. Each case is its own `runEvals` call because `runEvals`
 * keys and averages scores across the data items of a single call — one call
 * for all ten questions would collapse them into one set of numbers.
 */
export async function runAssistantEvalCase(
  evalCase: AssistantEvalCase,
  datasets: string[],
  sessionId?: string,
  /**
   * The curated-knowledge system block (`KnowledgeService.definitionBlock`)
   * for these datasets — same block a real chat turn gets from
   * `SessionsService.agentContext`. Both callers (`EvalRunsService`, the CLI
   * in `run-assistant-evals.ts`) populate this from `KnowledgeService`;
   * omitted (or empty) when neither wires one in.
   */
  knowledgeBlock?: string,
  /** The run's judge option (R143); off unless the caller says otherwise. */
  judge: Readonly<EvalJudgeSetting> = JUDGE_OFF,
): Promise<AssistantEvalCaseResult> {
  const startedAt = Date.now();
  // Captured from the per-item callback: the run itself only reports numbers.
  let answer = '';
  let toolCalls: EvalToolCall[] = [];
  let scorerPayloads: Record<string, any> = {};
  // Populated live via onStepFinish as the run executes — the same records a
  // real turn would have threaded through TURN_RECORDS_CONTEXT_KEY.
  const turnRecords: ToolDataRecord[] = [];

  try {
    const datasetSnapshots =
      await getDatasetToolServices().getDatasets(datasets);
    const orientation = entityOrientationLines(datasets, datasetSnapshots).join(
      '\n',
    );

    const result = await runEvals({
      data: [
        {
          input: evalCase.question,
          requestContext: evalRequestContext(datasets, sessionId, turnRecords),
        },
      ],
      scorers: evalCase.scorers,
      target: assistantAgent,
      // Same step budget and dataset/entity + join-hint grounding a real chat
      // turn gets from SessionsService.agentContext — without this the model
      // used to run out of steps mid-analysis (the AI-SDK default cap is 5)
      // and every case died with empty answer text.
      targetOptions: {
        maxSteps: ASSISTANT_MAX_STEPS,
        context: [
          { role: 'system', content: orientation },
          ...(knowledgeBlock
            ? [{ role: 'system' as const, content: knowledgeBlock }]
            : []),
        ],
        onStepFinish: (step: unknown) => captureStepRecords(step, turnRecords),
      },
      onItemComplete: ({ targetResult, scorerResults }) => {
        answer = String(targetResult?.text ?? '');
        toolCalls = extractToolCalls(targetResult);
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
        assistantAgent,
        evalCase.question,
        turnRecords,
        new AbortController().signal,
        providerOptionsFor(await resolveAgentModel(), {
          reasoningEffort: 'medium',
        }),
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

    // LLM-judge (Feature 2) — for cases where a regex/text check on the
    // final answer would be too brittle. Not called, and not scored, when
    // the run's judge option leaves this case out (R144).
    const judgeCheck = await judgeCheckFor(evalCase, judge, answer, toolCalls);
    if (judgeCheck) checkResults.push(judgeCheck);

    const status = questionStatus(checkResults);
    return {
      id: evalCase.id,
      question: evalCase.question,
      ...(evalCase.category !== undefined
        ? { category: evalCase.category }
        : {}),
      scores,
      checkResults,
      answer,
      toolCalls,
      status,
      passed: status === 'passed',
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      id: evalCase.id,
      question: evalCase.question,
      ...(evalCase.category !== undefined
        ? { category: evalCase.category }
        : {}),
      scores: {},
      checkResults: [],
      answer,
      toolCalls,
      status: 'failed',
      passed: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Run every case sequentially against the given datasets, reporting each as it
 * lands. Sequential keeps the load on the datasource (and the model) to what a
 * single user session would produce.
 *
 * `sessions`, when provided, gets one throwaway session created up front and
 * deleted when every case has run (or the run throws) — shared across cases
 * because only the `visual-request` case needs it, so there is no benefit to
 * a fresh one per question.
 */
export async function runAssistantEvals(
  datasets: string[],
  onCaseComplete?: (result: AssistantEvalCaseResult) => void,
  caseIds?: string[],
  sessions?: SessionsService,
  knowledgeBlock?: string,
  judge: Readonly<EvalJudgeSetting> = JUDGE_OFF,
): Promise<AssistantEvalCaseResult[]> {
  const datasetError = assistantEvalDatasetError(
    datasets,
    await getDatasetToolServices().getDatasets(datasets),
    fixtureForCases(caseIds),
  );
  if (datasetError) throw new Error(datasetError);
  const evalSession = sessions
    ? await createEvalSession(sessions, datasets)
    : undefined;
  try {
    const results: AssistantEvalCaseResult[] = [];
    for (const evalCase of selectEvalCases(caseIds)) {
      const result = await runAssistantEvalCase(
        evalCase,
        datasets,
        evalSession?.id,
        knowledgeBlock,
        judge,
      );
      results.push(result);
      onCaseComplete?.(result);
    }
    return results;
  } finally {
    await cleanupEvalSession(sessions, evalSession);
  }
}
