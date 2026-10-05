import { providerOptionsFor } from '../model-compat';
import {
  evalJudgeAgent,
  evalJudgeOutputSchema,
} from '../agents/eval-judge.agent';
import type { EvalJudgeOutput } from '../agents/eval-judge.agent';
import { lastJudgeModelId, resolveJudgeModel } from '../model-resolver';
import { getDatasetToolServices } from '../tool-services';
import type { DatasetSnapshot } from '../tool-services';
import { evaluateChecks, isTextCheckId } from './eval-checks';
import type {
  EvalCheckDescription,
  EvalCheckResult as PureEvalCheckResult,
} from './eval-checks';
import { labelFailure } from './failure-labels';
import {
  HARNESS_UNMEASURED_PREFIX,
  resetResultSetCheckWarnings,
  runResultSetCheck,
} from './result-set-check';
import type {
  ResultSetCheckOptions,
  ResultSetCheckResult,
} from './result-set-check';
import {
  DEFAULT_SUITE_ID,
  expandVariants,
  listSuites,
  loadSuite,
  referenceSqlsFor,
  assistantEvalSets,
  suiteDatasetError,
  suiteForCases,
} from './suite-loader';
import type {
  AssistantEvalSet,
  AssistantEvalSetCase,
  EvalCheckSpec,
  EvalDifficulty,
  EvalSuite,
  SuiteEvalCase,
} from './suite-loader';
import {
  addUsage,
  clipLogText,
  extractUsageDeep,
  sumUsage,
} from '../../modules/agents/eval-telemetry';
import type {
  EvalCheckLog,
  EvalRunLogAttempt,
  EvalRunLogCaseV2,
  EvalSqlLog,
  EvalVerdict,
  FailureLabel,
  PricingTable,
  TokenUsage,
} from '../../modules/agents/eval-telemetry';
import { buildLogCase } from '../../modules/agents/eval-run-record';
import {
  armOptions,
  sanitizeEngineOptions,
} from '../../modules/engine/engine-options';
import type { EngineOptions } from '../../modules/engine/engine-options';
import type {
  AnswerReview,
  SidePass,
  SqlRepairRecord,
  TurnResult,
} from '../../modules/sessions/turn-result';
import type {
  CrossCheck,
  ToolDataRecord,
} from '../../modules/sessions/entities/session.entity';
import type { SessionsService } from '../../modules/sessions/sessions.service';

/**
 * The parity harness: the assistant's eval suites, run through the
 * production turn.
 *
 * Every attempt is one `SessionsService.runTurn` in a fresh throwaway
 * session — the same turn chat runs, with the metrics block, verified
 * references, reasoning effort, tool-only synthesis, grounding guard, answer
 * review and careful mode a user gets (engineering plan §2.1: the harness
 * used to call `runEvals` on the bare agent, so the Evals tab measured a
 * different system from the one people use). The checks then grade the
 * `TurnResult` — the FINAL text and the tool trace — with the pure
 * evaluators in `eval-checks.ts`, the result-set comparison in
 * `result-set-check.ts` and, for rubric cases, the LLM judge.
 *
 * The metric is pass^k (§4): a case runs `repeat` times, each attempt gets
 * a verdict — PASS, FAIL, GAP (the harness could not measure it) or ERROR
 * (the turn threw, timed out or was stopped) — and `buildLogCase` folds the
 * attempts into the case. GAP is never a failure: it is excluded from the
 * rates and counted on its own.
 *
 * The questions themselves live in `suites/*.json` (see `suite-loader.ts`).
 */

/**
 * One case as the harness runs it. Everything a suite case carries that the
 * harness reads is here; `SuiteEvalCase` (from the loader) only makes
 * `checks` required and adds fields the harness ignores (`trapSql`,
 * `provenance`). A CLI golden-set case is `{ id, category?, question,
 * intent: '', checks: [], expectedSql }`.
 */
export interface AssistantEvalCase {
  /** Short id used when reporting per-question scores. */
  id: string;
  /**
   * The failure class the case probes (`ties`, `value-vocabulary`, `control`,
   * …), carried through to the result so a run can report a pass rate per
   * category, and passed to `runTurn` so `careful: 'auto'` sees it.
   */
  category?: string;
  question: string;
  /** What the question is probing for, for the run report. */
  intent: string;
  /** The declarative checks, graded on the final turn by `eval-checks.ts`. */
  checks?: EvalCheckSpec[];
  /**
   * @deprecated Compatibility view of `checks` (id, name, description) for
   * code written when a case carried live Mastra scorers — use
   * `describeChecks(checks)`. Nothing scores through it.
   */
  scorers?: EvalCheckDescription[];
  /**
   * Trusted SQL against the eval datasource whose live result set is the
   * reference answer — the primary correctness signal (`runResultSetCheck`).
   * `expectedSqlByDialect` overrides it per dialect (`referenceSqlFor`).
   */
  expectedSql?: string;
  expectedSqlByDialect?: { postgres?: string; databricks?: string };
  /**
   * Equally correct references (another unit the question does not name);
   * the result-set check passes on any of them (`referenceSqlsFor`).
   */
  expectedSqlAlternatives?: string[];
  resultSetOptions?: ResultSetCheckOptions;
  /**
   * A natural-language grading rubric for cases a regex/text check on the
   * final answer would judge badly (clarification quality, refusal quality,
   * whether a visual plausibly answers the request) — scored by the LLM judge.
   */
  judgeRubric?: string;
  difficulty?: EvalDifficulty;
  /** Set on a paraphrase variant (`<id>~v1`): the case it rephrases. */
  variantOf?: string;
}

/**
 * The question sets (one per suite file) live in `suite-loader.ts` — pure
 * suite data, so the Agents page can list them without loading the agent
 * graph; re-exported here for existing callers.
 */
export { assistantEvalSets };
export type { AssistantEvalSet, AssistantEvalSetCase };

/**
 * The shipped World Cup suite, as the rest of the backend has always seen it.
 *
 * Loading is deliberately defensive: the cases are a build asset
 * (`nest-cli.json` copies `mastra/evals/suites` into `dist`), and an asset
 * that failed to copy must not stop the desktop app from booting over a
 * feature only developers use. A run started against a missing suite still
 * fails loudly, because `EvalRunsService` goes through `loadSuite`, which
 * throws with the directory it searched.
 */
function loadDefaultSuiteCases(): SuiteEvalCase[] {
  try {
    return expandVariants(loadSuite(DEFAULT_SUITE_ID), false);
  } catch (err) {
    console.warn(
      `Eval suite "${DEFAULT_SUITE_ID}" could not be loaded: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

export const ASSISTANT_EVAL_CASES: SuiteEvalCase[] = loadDefaultSuiteCases();

/** One tool the agent called while answering, in call order. */
export interface EvalToolCall {
  name: string;
  /** Arguments the agent passed (the SQL or entity), truncated. */
  input?: string;
  /** What the tool returned, JSON-encoded and truncated. */
  output?: string;
  error?: string;
}

/** One check's verdict on a question, with why it landed there. */
export interface EvalCheckResult extends PureEvalCheckResult {
  /** Could not be measured — not the same as failed (`GAP`). */
  gap?: boolean;
  /** Result-set check only: matched on an earlier query, not the final one. */
  viaSupportingQuery?: boolean;
  /**
   * Result-set check only, on a case with alternatives: the reference that
   * matched (0 = `expectedSql`, n = `expectedSqlAlternatives[n - 1]`).
   */
  matchedReference?: number;
}

/** Outcome of one question (one attempt, or a case's representative attempt). */
export interface AssistantEvalCaseResult {
  id: string;
  /**
   * The case's failure class, copied from the suite so a stored run can be
   * tallied per category later without re-reading the suite file — suites
   * change, and an old run must stay interpretable against the categories it
   * was actually run with. Absent on runs recorded before categories existed.
   */
  category?: string;
  question: string;
  /** Score per check id, 0..1. Empty when the run threw. */
  scores: Record<string, number>;
  /** Per-check verdicts, in the order the case declares them. */
  checkResults: EvalCheckResult[];
  /** The turn's FINAL answer text (after synthesis, guard and review). */
  answer: string;
  /** The tool calls the turn made, in order — the executed process. */
  toolCalls: EvalToolCall[];
  /** `verdict === 'PASS'` (pass^k over every attempt). */
  passed: boolean;
  /** Set when the turn itself failed, timed out or was stopped. */
  error?: string;
  /** Wall time, in milliseconds — summed over attempts on a case result. */
  durationMs: number;
  /**
   * Tokens spent: the turn (main run + measured side passes) plus the LLM
   * judge, which is a real, paid model call — summed over attempts on a case
   * result. Absent (rather than zeroed) when nothing reported usage, so
   * "free" and "not measured" stay distinguishable.
   */
  usage?: TokenUsage;
  /*
   * The fields below are always set by this harness. They are optional in
   * the type because stored runs recorded before pass^k lack them.
   */
  /** The pass^k verdict (`foldAttempts`); an attempt's own verdict on attempt results. */
  verdict?: EvalVerdict;
  /** Attempts run (the repeat count, fewer when stopped). */
  runs?: number;
  /** Attempts that passed. */
  passes?: number;
  /** `0 < passes < runs`. */
  flaky?: boolean;
  failureLabel?: FailureLabel;
  difficulty?: EvalDifficulty;
  variantOf?: string;
  /** The last successful `run_readonly_sql` of the representative attempt. */
  finalSql?: string;
  repairs?: SqlRepairRecord[];
  warnings?: string[];
  review?: AnswerReview;
  crossCheck?: CrossCheck;
  /** Every attempt, as logged (no result rows). */
  attempts?: EvalRunLogAttempt[];
}

/** A fresh result from this harness: the pass^k fields are always present. */
export type RunEvalCaseResult = AssistantEvalCaseResult &
  Required<
    Pick<AssistantEvalCaseResult, 'verdict' | 'runs' | 'passes' | 'flaky'>
  >;

/**
 * The cases to run: the named ones, or all of them when the caller passes no
 * list at all. An explicit empty list selects nothing — it must not be read as
 * "run everything", or an empty selection would start a full (paid) run.
 */
export function selectEvalCases(caseIds?: string[]): SuiteEvalCase[] {
  if (!caseIds) return ASSISTANT_EVAL_CASES;
  const wanted = new Set(caseIds);
  return ASSISTANT_EVAL_CASES.filter((evalCase) => wanted.has(evalCase.id));
}

/**
 * The suite a selection of questions belongs to — lives in `suite-loader.ts`
 * (pure suite data, no agent graph); re-exported here for existing callers.
 */
export { suiteForCases };

/**
 * The same selection against an arbitrary suite — identical semantics, so a
 * health-insurance run behaves exactly like a World Cup one. With
 * `includeVariants`, each case's paraphrases follow it (`<id>~v1`, …), and
 * selecting a case by id selects its variants too.
 */
export function selectSuiteCases(
  suite: EvalSuite,
  caseIds?: string[],
  includeVariants = false,
): SuiteEvalCase[] {
  const cases = expandVariants(suite, includeVariants);
  if (!caseIds) return cases;
  const wanted = new Set(caseIds);
  return cases.filter(
    (evalCase) =>
      wanted.has(evalCase.id) ||
      (evalCase.variantOf !== undefined && wanted.has(evalCase.variantOf)),
  );
}

/* --------------------------------------------------------------- sessions */

/** A throwaway session one attempt runs in. */
export interface EvalSession {
  id: string;
}

/**
 * `create_visual` looks up the session's latest completed answer before it
 * will do anything — a throwaway session with no chat history has none, so a
 * case that exercises the visual tools gets one generic placeholder. The
 * chart's actual data comes from the turn's own captured records (merged
 * over this placeholder), not from this message's (empty) data.
 *
 * Only those cases, and in neutral words: before a memory thread exists the
 * whole transcript is the model's input, so the placeholder reads as a prior
 * assistant turn. A real first question arrives with no such turn, and a
 * line announcing "the eval suite" told the model it was being tested — the
 * harness must measure the chat the user gets, not a variant of it.
 */
const EVAL_SESSION_PLACEHOLDER_ANSWER =
  'Hi — ask me anything about the datasets in this session.';

/** Tools that need a prior answer in the session to work from. */
const VISUAL_SOURCE_TOOLS = new Set(['create_visual', 'update_visual']);

/** True when a case's checks expect a visual tool call (and so need a source answer). */
export function needsVisualSource(evalCase: {
  checks?: { type: string; tool?: string; tools?: string[] }[];
}): boolean {
  return (evalCase.checks ?? []).some(
    (check) =>
      (check.type === 'calledTool' &&
        !!check.tool &&
        VISUAL_SOURCE_TOOLS.has(check.tool)) ||
      (check.type === 'toolOrder' &&
        (check.tools ?? []).some((tool) => VISUAL_SOURCE_TOOLS.has(tool))),
  );
}

/**
 * A real, disposable session: `runTurn` needs one, and `create_visual`/
 * `update_visual` read session state the way they do in a real chat turn.
 * `name` defaults to a timestamped one; the harness names each attempt's
 * session after its case and attempt so a leaked one can be traced.
 */
export async function createEvalSession(
  sessions: SessionsService,
  datasets: string[],
  name = `assistant eval ${new Date().toISOString()}`,
  options: { seedAnswer?: boolean } = {},
): Promise<EvalSession> {
  const session = await sessions.create(name.slice(0, 64), datasets);
  if (options.seedAnswer ?? true) {
    await sessions.appendAssistantMessage(session.id, {
      content: EVAL_SESSION_PLACEHOLDER_ANSWER,
    });
  }
  return { id: session.id };
}

/** Best-effort cleanup — a throwaway session must never outlive its attempt. */
export async function cleanupEvalSession(
  sessions: SessionsService | undefined,
  session: EvalSession | undefined,
): Promise<void> {
  if (!sessions || !session) return;
  await sessions.delete(session.id).catch(() => undefined);
}

/* ------------------------------------------------------------ the contract */

/** Everything one case needs to run, beyond the case itself. */
export interface EvalCaseContext {
  /** `runTurn`, `create`, `delete`, `appendAssistantMessage`. */
  sessions: SessionsService;
  /** The datasets the turn may query; empty → the suite's declared ones. */
  datasets: string[];
  suite?: EvalSuite;
  /**
   * Overrides over the production defaults (Settings → Engine levers). The
   * CALLER merges `armOptions(arm)` and any explicit overrides into this.
   */
  engine?: Partial<EngineOptions>;
  /** The arm's label, recorded on the persisted message by `runTurn`. */
  arm?: string;
  /**
   * `'postgres' | 'databricks'` → `referenceSqlsFor(case, dialect)`. Absent →
   * the datasets' own datasource kind.
   */
  dialect?: string;
  /** Per attempt, turn + grading. Default `EVAL_TIMEOUT_MS` or 300 000. */
  timeoutMs?: number;
  /** Stops the run: the in-flight attempt is aborted, the rest never start. */
  abortSignal?: AbortSignal;
  /**
   * How long an aborted turn may take to wind down (and hand back its
   * partial data) before the attempt stops waiting for it. Default 10 000.
   */
  abortGraceMs?: number;
}

export interface EvalCaseOutcome {
  /** The representative attempt (first non-PASS, else attempt 1) with the case's pass^k fields. */
  result: RunEvalCaseResult;
  /** `buildLogCase(meta, attempts, hooks?.pricing)` — the v2 run-log entry. */
  logCase: EvalRunLogCaseV2;
  /** `TurnResult.engine` of the first attempt that ran a turn. */
  engine?: EngineOptions;
  /** `TurnResult.configHash` of that attempt. */
  configHash?: string;
  /** `lastJudgeModelId()` when a judge ran. */
  judgeModel?: string;
  /** Side-pass usage, summed over attempts. */
  sidePassUsage?: Partial<Record<SidePass, TokenUsage>>;
  /**
   * `ctx.abortSignal` fired during this case: its last attempt is an ERROR
   * with `error: 'stopped'` (partial data kept) and the remaining attempts
   * never ran. Callers usually treat the case as incomplete.
   */
  stopped: boolean;
}

export interface EvalCaseHooks {
  /** Called after each attempt, in order (index is 0-based). */
  onAttempt?: (attempt: EvalRunLogAttempt, index: number) => void;
  /** Prices `logCase` (`estimatedCostUsd`). */
  pricing?: { model?: string; table: PricingTable };
}

/** Per-attempt budget when neither the caller nor `EVAL_TIMEOUT_MS` sets one. */
export const DEFAULT_EVAL_TIMEOUT_MS = 300_000;
const DEFAULT_ABORT_GRACE_MS = 10_000;

/** The `error` a stopped attempt carries — how a caller tells stop from failure. */
export const EVAL_STOPPED_ERROR = 'stopped';

function attemptTimeoutMs(ctx: EvalCaseContext): number {
  if (ctx.timeoutMs && ctx.timeoutMs > 0) return ctx.timeoutMs;
  const fromEnv = Number(process.env['EVAL_TIMEOUT_MS']);
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : DEFAULT_EVAL_TIMEOUT_MS;
}

/* ----------------------------------------------------------------- verdict */

/**
 * One attempt's verdict from its checks: ERROR when the turn threw, timed
 * out or was stopped; FAIL when any measured check failed; GAP when the only
 * problems are unmeasured checks — or when the case had nothing to measure
 * at all (no checks, no reference, no rubric); else PASS. A gap is never a
 * failure.
 */
export function attemptVerdict(
  checks: readonly { passed: boolean; gap?: boolean }[],
  error?: string,
): EvalVerdict {
  if (error) return 'ERROR';
  if (checks.some((check) => !check.passed && !check.gap)) return 'FAIL';
  if (checks.some((check) => check.gap)) return 'GAP';
  if (!checks.length) return 'GAP';
  return 'PASS';
}

/* ------------------------------------------------------------- tool trace */

/** Tool payloads can be whole result sets; keep the trace readable. */
const MAX_TRACE_FIELD = 2000;
/** Rows of a result shown in the trace (the judge's evidence, the report). */
const TRACE_ROWS = 20;

function encode(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  let text: string;
  try {
    text =
      typeof value === 'string'
        ? value
        : (JSON.stringify(value, null, 2) ?? '[unserializable]');
  } catch {
    text = '[unserializable]';
  }
  return text.length > MAX_TRACE_FIELD
    ? `${text.slice(0, MAX_TRACE_FIELD)}… (truncated)`
    : text;
}

function callFromRecord(record: ToolDataRecord): EvalToolCall {
  return {
    name: record.tool,
    ...(record.input ? { input: encode(record.input) } : {}),
    ...(record.error
      ? { error: record.error }
      : {
          output: encode({
            columns: record.columns,
            rowCount: record.rowCount,
            ...(record.truncated ? { truncated: true } : {}),
            rows: (record.rows ?? []).slice(0, TRACE_ROWS),
          }),
        }),
  };
}

/**
 * The clarification as the user actually saw it: the question, then its
 * options as a bullet list. `ask_clarification`'s question alone reads as
 * vague to a judge that never sees the options a real user was offered — this
 * is the one rendering both the judge's view of the turn and the attempt log
 * use, so neither hides the concrete choices behind a bare question.
 */
function formatClarification(
  clarification: NonNullable<TurnResult['clarification']>,
): string {
  const lines = [clarification.question];
  const options = clarification.options ?? [];
  if (options.length) {
    lines.push('', 'Options offered to the user:');
    for (const option of options) {
      lines.push(
        option.description
          ? `- ${option.label} — ${option.description}`
          : `- ${option.label}`,
      );
    }
  }
  return lines.join('\n');
}

/**
 * The turn's tool calls in call order. `calledTools` names every call; the
 * captured records (SQL and sample runs only) supply inputs and outputs and
 * are matched to calls of the same tool in order. Records no call accounts
 * for (a side pass's) follow at the end.
 *
 * Two tools leave no `ToolDataRecord` of their own, so their evidence is
 * stitched in from elsewhere: `ask_clarification` gets the clarification
 * (question + options) as its `input` — otherwise a judge sees only the
 * question and reads it as vague — and the first `create_visual`/
 * `update_visual` call gets the turn's `VisualEvent` as its `output`, so a
 * rubric like "did it create a visual of X" has something to judge.
 */
function toolCallsOf(turn: TurnResult | undefined): EvalToolCall[] {
  if (!turn) return [];
  const pending = [...(turn.data ?? [])];
  let visualAssigned = false;
  const calls: EvalToolCall[] = (turn.calledTools ?? []).map((name) => {
    const index = pending.findIndex((record) => record.tool === name);
    if (index < 0) {
      if (name === 'ask_clarification' && turn.clarification) {
        return { name, input: encode(turn.clarification) };
      }
      if (
        !visualAssigned &&
        VISUAL_SOURCE_TOOLS.has(name) &&
        turn.message?.visual
      ) {
        visualAssigned = true;
        return { name, output: encode(turn.message.visual) };
      }
      return { name };
    }
    const [record] = pending.splice(index, 1);
    return callFromRecord(record);
  });
  for (const record of pending) calls.push(callFromRecord(record));
  return calls;
}

/* ------------------------------------------------------------------- judge */

/** Check id for the LLM-judge check, shown in the report's checks table. */
const LLM_JUDGE_CHECK_ID = 'llm-judge';

/** Parse a model's JSON reply, tolerating a markdown fence around it. */
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

interface JudgeOpinion {
  verdict?: EvalJudgeOutput;
  error?: string;
  usage?: TokenUsage;
}

async function askJudge(
  prompt: string,
  abortSignal: AbortSignal,
): Promise<JudgeOpinion> {
  try {
    const result = await evalJudgeAgent.generate(prompt, {
      maxSteps: 1,
      toolChoice: 'none',
      abortSignal,
      // Deterministic-ish grading: temperature 0 where the provider supports
      // it, via providerOptions rather than a top-level field the
      // structured-output call overload does not accept.
      // The judge may be pinned to its own model, so the options are filed
      // under the provider the judge — not the assistant — resolves to.
      providerOptions: providerOptionsFor(await resolveJudgeModel(), {
        temperature: 0,
      }),
      structuredOutput: {
        schema: evalJudgeOutputSchema,
        jsonPromptInjection: 'inline',
      },
    });
    // Read before the verdict: a judge that answered with unparseable JSON
    // still burned tokens, and that spend has to land in the log.
    const usage = extractUsageDeep(result);
    const parsed = evalJudgeOutputSchema.safeParse(
      (result as { object?: unknown }).object ??
        parseJsonObject((result as { text?: string }).text),
    );
    if (!parsed.success) {
      return { error: 'the judge did not return valid JSON', usage };
    }
    return { verdict: parsed.data, usage };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

interface JudgeCheckOutcome {
  check: EvalCheckResult;
  /** Every judge call's usage, summed; absent when none reported any. */
  usage?: TokenUsage;
  /** The attempt's signal cut the judge short (no verdict came back). */
  interrupted: boolean;
}

function judgePrompt(
  evalCase: AssistantEvalCase,
  answer: string,
  toolCalls: EvalToolCall[],
): string {
  return [
    `Question asked: ${evalCase.question}`,
    '',
    'Rubric:',
    evalCase.judgeRubric ?? '',
    '',
    'Tool calls the assistant made, in order:',
    toolCalls.length ? JSON.stringify(toolCalls) : '(none)',
    '',
    "Assistant's final answer to the user:",
    answer || '(the assistant produced no answer text)',
  ].join('\n');
}

/**
 * Score the final turn against the case's `judgeRubric` with
 * `evalJudgeAgent` (model: `resolveJudgeModel()`, temperature 0). One retry:
 * when the judge errors or returns invalid JSON, or fails the answer with
 * `confidence: 'low'`, it is asked once more and the second opinion wins. A
 * second error makes the check a measurement GAP — a broken ruler is not a
 * wrong answer. Returns `undefined` when the case has no rubric.
 */
async function runJudgeCheck(
  evalCase: AssistantEvalCase,
  answer: string,
  toolCalls: EvalToolCall[],
  abortSignal: AbortSignal,
): Promise<JudgeCheckOutcome | undefined> {
  if (!evalCase.judgeRubric) return undefined;
  const description = `LLM judge: ${evalCase.judgeRubric}`;
  const prompt = judgePrompt(evalCase, answer, toolCalls);
  const usages: TokenUsage[] = [];
  const ask = async (): Promise<JudgeOpinion> => {
    const opinion = await askJudge(prompt, abortSignal);
    if (opinion.usage) usages.push(opinion.usage);
    return opinion;
  };

  let opinion = await ask();
  let retried = false;
  const doubtful =
    opinion.error !== undefined ||
    (opinion.verdict?.pass === false && opinion.verdict.confidence === 'low');
  if (doubtful && !abortSignal.aborted) {
    retried = true;
    opinion = await ask();
  }
  const usage = usages.length ? sumUsage(usages) : undefined;
  // Only a judge call the signal cut short: a stop that lands after a
  // verdict came back does not undo the verdict.
  const interrupted =
    abortSignal.aborted && (opinion.error !== undefined || !opinion.verdict);

  if (opinion.error !== undefined || !opinion.verdict) {
    return {
      check: {
        id: LLM_JUDGE_CHECK_ID,
        description,
        score: 0,
        passed: false,
        gap: true,
        reason: `${HARNESS_UNMEASURED_PREFIX}: judge error${retried ? ' (twice)' : ''} — ${opinion.error ?? 'no verdict'}`,
      },
      ...(usage ? { usage } : {}),
      interrupted,
    };
  }
  const { pass, reason } = opinion.verdict;
  return {
    check: {
      id: LLM_JUDGE_CHECK_ID,
      description,
      score: pass ? 1 : 0,
      passed: pass,
      ...(pass
        ? {}
        : {
            reason: retried
              ? `${reason} (second opinion after a low-confidence or failed first grading)`
              : reason,
          }),
    },
    ...(usage ? { usage } : {}),
    interrupted,
  };
}

/* ---------------------------------------------------------------- attempts */

/** What every attempt of one case shares, looked up once per case. */
interface CaseScope {
  datasets: string[];
  snapshots: DatasetSnapshot[];
  /** The datasets' datasource kind, when they agree on one. */
  dialect?: string;
  defaultFilterPredicates: string[];
  knownEntities: string[];
}

async function caseScope(datasets: string[]): Promise<CaseScope> {
  let snapshots: DatasetSnapshot[] = [];
  let defaultFilterPredicates: string[] = [];
  try {
    const services = getDatasetToolServices();
    snapshots = (await services.getDatasets(datasets)) ?? [];
    const filters = (await services.defaultFilters?.(datasets)) ?? [];
    defaultFilterPredicates = [
      ...new Set(filters.map((filter) => filter.predicate).filter(Boolean)),
    ];
  } catch {
    // Unresolvable scope is the result-set check's to report (a GAP: no
    // datasource), not a reason to abandon the case before the turn runs.
  }
  const kinds = new Set(
    snapshots.map((snapshot) => snapshot.datasourceKind).filter(Boolean),
  );
  const knownEntities = [
    ...new Set(
      snapshots.flatMap((snapshot) => [
        ...(snapshot.tables ?? []),
        ...(snapshot.entities ?? []).map((entity) => entity.key),
      ]),
    ),
  ];
  return {
    datasets,
    snapshots,
    ...(kinds.size === 1 ? { dialect: [...kinds][0] } : {}),
    defaultFilterPredicates,
    knownEntities,
  };
}

/**
 * Wait for the turn, but not forever once the attempt is aborted: `runTurn`
 * resolves with `aborted: true` and its partial data when it notices, and
 * this gives it `graceMs` to do so before giving up on it. The turn's own
 * promise always has a handler, so a late rejection is never unhandled.
 */
function settleTurn<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  graceMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let grace: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      grace = setTimeout(
        () =>
          reject(
            new Error(
              `the turn did not stop within ${graceMs}ms of being aborted`,
            ),
          ),
        graceMs,
      );
    };
    const done = () => {
      if (grace) clearTimeout(grace);
      signal.removeEventListener('abort', onAbort);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        done();
        resolve(value);
      },
      (error: unknown) => {
        done();
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface AttemptOutcome {
  log: EvalRunLogAttempt;
  result: RunEvalCaseResult;
  turn?: TurnResult;
  judged: boolean;
  judgeModel?: string;
  stopped: boolean;
}

function sqlLog(record: ToolDataRecord): EvalSqlLog {
  return {
    sql: record.input ?? '',
    ok: !record.error,
    ...(record.error ? { error: record.error } : {}),
    ...(record.rowCount !== undefined ? { rowCount: record.rowCount } : {}),
    ...(record.repairs?.length ? { repaired: true } : {}),
  };
}

function checkLog(check: EvalCheckResult): EvalCheckLog {
  return {
    id: check.id,
    passed: check.passed,
    ...(check.reason ? { reason: check.reason } : {}),
    ...(check.gap ? { gap: true } : {}),
    ...(check.matchedReference !== undefined
      ? { matchedReference: check.matchedReference }
      : {}),
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function runAttempt(
  evalCase: AssistantEvalCase,
  ctx: EvalCaseContext,
  scope: CaseScope,
  attempt: number,
): Promise<AttemptOutcome> {
  const started = Date.now();
  const timeoutMs = attemptTimeoutMs(ctx);
  const controller = new AbortController();
  let timedOut = false;
  const onStop = () => controller.abort();
  if (ctx.abortSignal?.aborted) controller.abort();
  else ctx.abortSignal?.addEventListener('abort', onStop, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const interruption = () =>
    timedOut
      ? `timeout after ${Number((timeoutMs / 1000).toFixed(2))}s`
      : EVAL_STOPPED_ERROR;

  let session: EvalSession | undefined;
  let turn: TurnResult | undefined;
  let error: string | undefined;
  let checks: EvalCheckResult[] = [];
  let judgeUsage: TokenUsage | undefined;
  let judged = false;
  let judgeModel: string | undefined;
  let resultSet: ResultSetCheckResult | undefined;
  const references = referenceSqlsFor(evalCase, ctx.dialect ?? scope.dialect);
  // The primary is the one a failure label compares the final SQL against.
  const reference = references[0];
  const toolCalls = () => toolCallsOf(turn);

  try {
    session = await createEvalSession(
      ctx.sessions,
      scope.datasets,
      `eval ${evalCase.id} ${attempt} ${new Date().toISOString()}`,
      { seedAnswer: needsVisualSource(evalCase) },
    );
    try {
      turn = await settleTurn(
        ctx.sessions.runTurn(session.id, evalCase.question, {
          engine: ctx.engine,
          category: evalCase.category,
          arm: ctx.arm,
          abortSignal: controller.signal,
        }),
        controller.signal,
        ctx.abortGraceMs ?? DEFAULT_ABORT_GRACE_MS,
      );
    } catch (err) {
      if (!controller.signal.aborted) throw err;
    }
    if (controller.signal.aborted || turn?.aborted) {
      // Stopped or out of time mid-turn: whatever the turn captured is kept,
      // but an interrupted turn is not graded.
      error = controller.signal.aborted
        ? interruption()
        : 'the turn was aborted';
    } else if (turn?.providerError) {
      // The model provider failed (no credits, rate limit, bad key, network,
      // timeout): the engine was never measured, so this is an ERROR — not
      // the assistant answering wrongly — and there is nothing to grade.
      error = `provider error (${turn.providerError.kind}): ${turn.providerError.message}`;
    } else if (turn) {
      const data = turn.data ?? [];
      const sqlRecords = data.filter(
        (record) => record.tool === 'run_readonly_sql',
      );
      checks = evaluateChecks(evalCase.checks ?? [], {
        text: turn.text ?? '',
        calledTools: turn.calledTools ?? [],
        toolErrors: data
          .filter((record) => record.error)
          .map((record) => record.error as string),
        finalSqlOk:
          sqlRecords.length > 0 && !sqlRecords[sqlRecords.length - 1].error,
      });
      resultSet = await runResultSetCheck(
        references,
        scope.datasets,
        scope.snapshots,
        data,
        { ...evalCase.resultSetOptions, preferFinal: true },
      );
      if (resultSet) checks.push(resultSet);
      const judge = await runJudgeCheck(
        evalCase,
        turn.clarification
          ? formatClarification(turn.clarification)
          : (turn.text ?? ''),
        toolCalls(),
        controller.signal,
      );
      if (judge) {
        judged = true;
        judgeModel = lastJudgeModelId();
        judgeUsage = judge.usage;
        checks.push(judge.check);
        if (judge.interrupted) error = interruption();
      }
    }
  } catch (err) {
    error = controller.signal.aborted ? interruption() : errorText(err);
  } finally {
    clearTimeout(timer);
    ctx.abortSignal?.removeEventListener('abort', onStop);
    await cleanupEvalSession(ctx.sessions, session);
  }

  const stopped = error === EVAL_STOPPED_ERROR;
  const verdict = attemptVerdict(checks, error);
  const data = turn?.data ?? [];
  const toolErrors = data
    .filter((record) => record.error)
    .map((record) => record.error as string);
  const checkLogs = checks.map(checkLog);
  // Stopping is the operator's doing, not the engine's: no failure label.
  const failureLabel =
    (verdict === 'FAIL' || verdict === 'ERROR') && !stopped
      ? labelFailure({
          verdict,
          checks: checkLogs,
          finalSql: turn?.finalSql,
          expectedSql: reference,
          clarified: Boolean(turn?.clarification),
          toolErrors,
          resultMatched:
            resultSet && !resultSet.gap ? resultSet.passed : undefined,
          textChecksFailed: checks.some(
            (check) => !check.passed && !check.gap && isTextCheckId(check.id),
          ),
          defaultFilterPredicates: scope.defaultFilterPredicates,
          knownEntities: scope.knownEntities,
          ...(error ? { error } : {}),
        })
      : undefined;
  const observed = [turn?.usage, judgeUsage].filter(
    (usage): usage is TokenUsage => Boolean(usage),
  );
  const usage = observed.length ? sumUsage(observed) : undefined;
  const durationMs = Date.now() - started;
  const viaSupportingQuery = Boolean(resultSet?.viaSupportingQuery);
  const text = turn?.text ?? '';

  const log: EvalRunLogAttempt = {
    attempt,
    verdict,
    checks: checkLogs,
    ...(turn?.finalSql ? { finalSql: turn.finalSql } : {}),
    sql: data
      .filter((record) => record.tool === 'run_readonly_sql')
      .map(sqlLog),
    ...(turn ? { answer: clipLogText(text) } : {}),
    steps: turn?.steps ?? 0,
    calledTools: [...(turn?.calledTools ?? [])],
    repairs: [...(turn?.repairs ?? [])],
    warnings: [...(turn?.warnings ?? [])],
    ...(turn?.clarification
      ? { clarification: formatClarification(turn.clarification) }
      : {}),
    ...(turn?.crossCheck ? { crossCheck: turn.crossCheck.status } : {}),
    ...(turn?.review ? { review: turn.review.status } : {}),
    ...(failureLabel ? { failureLabel } : {}),
    ...(viaSupportingQuery ? { viaSupportingQuery: true } : {}),
    ...(error ? { error } : {}),
    durationMs,
    ...(usage ? { usage } : {}),
  };

  const scores: Record<string, number> = {};
  for (const check of checks) scores[check.id] = check.score;
  const result: RunEvalCaseResult = {
    id: evalCase.id,
    ...(evalCase.category ? { category: evalCase.category } : {}),
    question: evalCase.question,
    scores,
    checkResults: checks,
    answer: text,
    toolCalls: toolCalls(),
    passed: verdict === 'PASS',
    ...(error ? { error } : {}),
    durationMs,
    ...(usage ? { usage } : {}),
    verdict,
    runs: 1,
    passes: verdict === 'PASS' ? 1 : 0,
    flaky: false,
    ...(failureLabel ? { failureLabel } : {}),
    ...(evalCase.difficulty ? { difficulty: evalCase.difficulty } : {}),
    ...(evalCase.variantOf ? { variantOf: evalCase.variantOf } : {}),
    ...(turn?.finalSql ? { finalSql: turn.finalSql } : {}),
    ...(turn?.repairs?.length ? { repairs: turn.repairs } : {}),
    ...(turn?.warnings?.length ? { warnings: turn.warnings } : {}),
    ...(turn?.review ? { review: turn.review } : {}),
    ...(turn?.crossCheck ? { crossCheck: turn.crossCheck } : {}),
  };
  return { log, result, turn, judged, judgeModel, stopped };
}

/* ------------------------------------------------------------------- cases */

/** Side-pass usage summed per pass; passes nothing reported for are absent. */
export function sumSidePassUsage(
  items: readonly (Partial<Record<SidePass, TokenUsage>> | undefined)[],
): Partial<Record<SidePass, TokenUsage>> {
  const total: Partial<Record<SidePass, TokenUsage>> = {};
  for (const item of items) {
    for (const [pass, usage] of Object.entries(item ?? {}) as [
      SidePass,
      TokenUsage | undefined,
    ][]) {
      if (!usage) continue;
      const sofar = total[pass];
      total[pass] = sofar ? addUsage(sofar, usage) : usage;
    }
  }
  return total;
}

/**
 * Run one case `repeat` times through the production turn — a fresh
 * throwaway session per attempt — and fold the attempts into its pass^k
 * verdict (`buildLogCase`). Attempts run sequentially; only
 * `ctx.abortSignal` ends the loop early (the in-flight attempt is aborted
 * and recorded as `ERROR`/`'stopped'`, the rest never start). A timeout
 * fails only its own attempt.
 */
export async function runAssistantEvalCaseRepeated(
  evalCase: AssistantEvalCase,
  ctx: EvalCaseContext,
  repeat: number,
  hooks?: EvalCaseHooks,
): Promise<EvalCaseOutcome> {
  const runs = Math.max(1, Math.floor(Number(repeat) || 1));
  const datasets = ctx.datasets.length
    ? ctx.datasets
    : (ctx.suite?.datasets ?? []);
  const scope = await caseScope(datasets);
  const attempts: AttemptOutcome[] = [];
  for (let index = 0; index < runs; index++) {
    if (ctx.abortSignal?.aborted) break;
    const outcome = await runAttempt(evalCase, ctx, scope, index + 1);
    attempts.push(outcome);
    hooks?.onAttempt?.(outcome.log, index);
    if (outcome.stopped) break;
  }

  const logs = attempts.map((attempt) => attempt.log);
  const logCase = buildLogCase(
    {
      id: evalCase.id,
      ...(evalCase.category ? { category: evalCase.category } : {}),
      question: evalCase.question,
      ...(evalCase.difficulty ? { difficulty: evalCase.difficulty } : {}),
      ...(evalCase.variantOf ? { variantOf: evalCase.variantOf } : {}),
    },
    logs,
    hooks?.pricing,
  );

  const representative =
    attempts.find((attempt) => attempt.log.verdict !== 'PASS') ?? attempts[0];
  const base: RunEvalCaseResult = representative?.result ?? {
    id: evalCase.id,
    ...(evalCase.category ? { category: evalCase.category } : {}),
    question: evalCase.question,
    scores: {},
    checkResults: [],
    answer: '',
    toolCalls: [],
    passed: false,
    error: EVAL_STOPPED_ERROR,
    durationMs: 0,
    verdict: 'SKIP',
    runs: 0,
    passes: 0,
    flaky: false,
    ...(evalCase.difficulty ? { difficulty: evalCase.difficulty } : {}),
    ...(evalCase.variantOf ? { variantOf: evalCase.variantOf } : {}),
  };
  // The representative attempt's evidence, the case's pass^k fold: verdict,
  // label, time and tokens are over every attempt, not the one shown.
  const result: RunEvalCaseResult = {
    ...base,
    passed: logCase.verdict === 'PASS',
    verdict: logCase.verdict,
    runs: logCase.runs,
    passes: logCase.passes,
    flaky: logCase.flaky,
    durationMs: logCase.durationMs,
    attempts: logs,
  };
  delete result.failureLabel;
  delete result.usage;
  if (logCase.failureLabel) result.failureLabel = logCase.failureLabel;
  if (logCase.usage) result.usage = logCase.usage;

  const first = attempts.find((attempt) => attempt.turn);
  const sidePassUsage = sumSidePassUsage(
    attempts.map((attempt) => attempt.turn?.sidePassUsage),
  );
  const judgeModel = [...attempts]
    .reverse()
    .find((attempt) => attempt.judged && attempt.judgeModel)?.judgeModel;
  return {
    result,
    logCase,
    ...(first?.turn ? { engine: first.turn.engine } : {}),
    ...(first?.turn ? { configHash: first.turn.configHash } : {}),
    ...(judgeModel ? { judgeModel } : {}),
    ...(Object.keys(sidePassUsage).length ? { sidePassUsage } : {}),
    stopped:
      Boolean(ctx.abortSignal?.aborted) || attempts.some((a) => a.stopped),
  };
}

/** One attempt of one case — `runAssistantEvalCaseRepeated` with `repeat: 1`. */
export function runAssistantEvalCase(
  evalCase: AssistantEvalCase,
  ctx: EvalCaseContext,
  hooks?: EvalCaseHooks,
): Promise<EvalCaseOutcome> {
  return runAssistantEvalCaseRepeated(evalCase, ctx, 1, hooks);
}

/* -------------------------------------------------------------------- runs */

/** `armOptions(arm)` with explicit overrides on top — what a caller hands the harness. */
export function mergeEngineOverrides(
  arm: string | undefined,
  engine: Partial<EngineOptions> | undefined,
): Partial<EngineOptions> {
  return {
    ...sanitizeEngineOptions(armOptions(arm)),
    ...sanitizeEngineOptions(engine ?? {}),
  };
}

export interface RunAssistantEvalsOptions {
  /** Attempts per case (pass^k); default 1. */
  repeat?: number;
  /** Explicit lever overrides, applied over the arm's preset. */
  engine?: Partial<EngineOptions>;
  /** An `ARM_PRESETS` name or `custom:{json}`. */
  arm?: string;
  /** Run each case's paraphrase variants too. */
  includeVariants?: boolean;
  /** Reference dialect; default the datasets' datasource kind. */
  dialect?: string;
  timeoutMs?: number;
  abortSignal?: AbortSignal;
  onAttempt?: EvalCaseHooks['onAttempt'];
  pricing?: EvalCaseHooks['pricing'];
  /** Every case's full outcome (log entry, engine, config hash), as it lands. */
  onOutcome?: (outcome: EvalCaseOutcome) => void;
}

/**
 * Run a suite's cases sequentially against the given datasets, reporting each
 * as it lands. Sequential keeps the load on the datasource (and the model) to
 * what a single user session would produce.
 *
 * Every case goes through `runAssistantEvalCaseRepeated`, so `sessions` is
 * required (it is optional in the signature only for the positional
 * compatibility of older callers). `knowledgeBlock` is ignored: `runTurn`
 * builds the same context blocks a chat turn gets.
 */
export async function runAssistantEvals(
  datasets: string[],
  onCaseComplete?: (result: AssistantEvalCaseResult) => void,
  caseIds?: string[],
  sessions?: SessionsService,
  /** @deprecated Ignored — the production turn injects its own knowledge block. */
  _knowledgeBlock?: string,
  /**
   * Which suite to run. Appended after the case ids and optional: when
   * omitted, the suite is the one the named `caseIds` belong to, or the
   * shipped World Cup suite when no ids are named either — so every existing
   * caller keeps working.
   */
  suiteId?: string,
  options: RunAssistantEvalsOptions = {},
): Promise<AssistantEvalCaseResult[]> {
  if (!sessions) {
    throw new Error(
      'runAssistantEvals needs a SessionsService: the parity harness runs every case through SessionsService.runTurn.',
    );
  }
  // One warning per run when a case cannot be measured at all (see
  // `runResultSetCheck`), not one per case.
  resetResultSetCheckWarnings();
  const suite = suiteId
    ? loadSuite(suiteId)
    : caseIds
      ? suiteForCases(caseIds)
      : loadSuite(DEFAULT_SUITE_ID);
  const snapshots = await getDatasetToolServices().getDatasets(datasets);
  const datasetError = suiteDatasetError(suite, datasets, snapshots);
  if (datasetError) throw new Error(datasetError);
  const engine = mergeEngineOverrides(options.arm, options.engine);
  const results: AssistantEvalCaseResult[] = [];
  for (const evalCase of selectSuiteCases(
    suite,
    caseIds,
    options.includeVariants,
  )) {
    if (options.abortSignal?.aborted) break;
    const outcome = await runAssistantEvalCaseRepeated(
      evalCase,
      {
        sessions,
        datasets,
        suite,
        engine,
        ...(options.arm ? { arm: options.arm } : {}),
        ...(options.dialect ? { dialect: options.dialect } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
      },
      options.repeat ?? 1,
      { onAttempt: options.onAttempt, pricing: options.pricing },
    );
    results.push(outcome.result);
    options.onOutcome?.(outcome);
    onCaseComplete?.(outcome.result);
  }
  return results;
}
