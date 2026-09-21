import { checks } from '@mastra/evals/checks';
import { runEvals } from '@mastra/core/evals';
import { RequestContext } from '@mastra/core/request-context';
import type { MastraScorer } from '@mastra/core/evals';
import { assistantAgent } from '../agents/assistant.agent';
import { DATASETS_CONTEXT_KEY } from '../tools/dataset.tools';

/**
 * Eval suite for the Questions to Insights assistant.
 *
 * The questions are grounded in the World Cup fixture (docker/postgres/init),
 * so every expected substring below is a fact that is actually in the data —
 * a check failing means the agent got it wrong, not that the fixture drifted.
 *
 * The assistant resolves its entities from the session's datasets via
 * requestContext, so each case carries the dataset it is allowed to query.
 */

/**
 * `runEvals` keys its scores by scorer id, so two scorers of the same kind in
 * one case would collide — each case below uses each check type at most once.
 */
export interface AssistantEvalCase {
  /** Short id used when reporting per-question scores. */
  id: string;
  question: string;
  /** What the question is probing for, for the run report. */
  intent: string;
  scorers: MastraScorer<any, any, any, any>[];
}

export const ASSISTANT_EVAL_CASES: AssistantEvalCase[] = [
  {
    id: 'champion-2022',
    question: 'Who won the 2022 World Cup?',
    intent: 'Single-hop lookup against tournaments — the simplest happy path.',
    scorers: [
      checks.includes('Argentina'),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'final-score-2018',
    question: 'What was the score of the 2018 World Cup final?',
    intent: 'Filter matches by stage and tournament, then read both goal columns.',
    scorers: [
      checks.matches(/4\s*[-–:]\s*2/),
      checks.includes('France'),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'top-scorer-2022',
    question: 'Who scored the most goals in the 2022 World Cup, and how many?',
    intent:
      'Aggregate over goals joined to players, excluding own goals — the classic GROUP BY question.',
    scorers: [
      checks.includes('Messi'),
      checks.matches(/\b4\b/),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'shootouts',
    question:
      'Which knockout matches went to a penalty shootout, and who advanced?',
    intent:
      'Requires noticing that shootouts are encoded as non-null penalty columns, not a flag.',
    scorers: [
      checks.includes('Croatia'),
      checks.matches(/Argentina/i),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'biggest-venue',
    question: 'Which stadium hosted the best-attended match, and what was the attendance?',
    intent: 'Join matches to venues and order by a nullable measure.',
    scorers: [
      checks.includes('Lusail'),
      checks.matches(/88[,.]?966/),
      checks.calledTool('run_readonly_sql'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'schema-discovery',
    question: 'What data do I have available to analyse?',
    intent:
      'Pure discovery — must inspect the session datasets rather than invent entities or run SQL.',
    scorers: [
      checks.calledTool('list_entities'),
      checks.includes('matches'),
      checks.didNotCall('run_readonly_sql'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'ambiguous-best-team',
    question: 'Which team performed best?',
    intent:
      'Ambiguous on both metric and tournament — the agent must ask instead of guessing.',
    scorers: [
      checks.calledTool('ask_clarification'),
      checks.didNotCall('run_readonly_sql'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'possession-vs-result',
    question:
      'In the 2022 knockout rounds, did the team with more possession usually win?',
    intent:
      'Two-table reasoning over match_team_statistics — the answer must be a judgement backed by counts, not a row dump.',
    scorers: [
      checks.calledTool('run_readonly_sql'),
      checks.matches(/\b(possession|%)\b/i),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'out-of-scope',
    question: 'How many goals did Pelé score in the 1970 World Cup?',
    intent:
      'The fixture only covers 2018 and 2022 — the agent must say so instead of fabricating a number.',
    scorers: [
      checks.matches(/\b(no|not|only|1970 is not|does not|doesn't)\b/i),
      checks.excludes('Pelé scored 4'),
      checks.noToolErrors(),
    ],
  },
  {
    id: 'visual-request',
    question:
      'Chart the goals scored by each team in the 2022 knockout stage.',
    intent:
      'Answer first, then build a visual — checks the SQL → create_visual ordering.',
    scorers: [
      checks.toolOrder(['run_readonly_sql', 'create_visual']),
      checks.calledTool('create_visual'),
      checks.noToolErrors(),
    ],
  },
];

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

function encode(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text =
    typeof value === 'string' ? value : safeStringify(value) ?? String(value);
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
 * as `any`, and the call/result shape has moved between AI SDK versions, so
 * every field is read defensively.
 */
function extractToolCalls(targetResult: any): EvalToolCall[] {
  const steps: any[] = Array.isArray(targetResult?.steps)
    ? targetResult.steps
    : [targetResult];

  const calls: EvalToolCall[] = [];
  for (const step of steps) {
    if (!step) continue;
    const stepCalls: any[] = Array.isArray(step.toolCalls) ? step.toolCalls : [];
    const stepResults: any[] = Array.isArray(step.toolResults)
      ? step.toolResults
      : [];

    for (const call of stepCalls) {
      const match = stepResults.find(
        (result) => result?.toolCallId === call?.toolCallId,
      );
      const output = match?.output ?? match?.result;
      calls.push({
        name: String(call?.toolName ?? call?.name ?? 'unknown'),
        input: encode(call?.input ?? call?.args),
        output: match?.isError ? undefined : encode(output),
        error: match?.isError ? encode(output) ?? 'Tool call failed' : undefined,
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

/** requestContext scoping the agent to the eval datasets, as a session would. */
function evalRequestContext(datasets: string[]): RequestContext {
  const requestContext = new RequestContext();
  requestContext.set(DATASETS_CONTEXT_KEY, datasets);
  return requestContext;
}

/**
 * Run one question. Each case is its own `runEvals` call because `runEvals`
 * keys and averages scores across the data items of a single call — one call
 * for all ten questions would collapse them into one set of numbers.
 */
export async function runAssistantEvalCase(
  evalCase: AssistantEvalCase,
  datasets: string[],
): Promise<AssistantEvalCaseResult> {
  const startedAt = Date.now();
  // Captured from the per-item callback: the run itself only reports numbers.
  let answer = '';
  let toolCalls: EvalToolCall[] = [];
  let scorerPayloads: Record<string, any> = {};

  try {
    const result = await runEvals({
      data: [
        {
          input: evalCase.question,
          requestContext: evalRequestContext(datasets),
        },
      ],
      scorers: evalCase.scorers,
      target: assistantAgent,
      onItemComplete: ({ targetResult, scorerResults }) => {
        answer = String(targetResult?.text ?? '');
        toolCalls = extractToolCalls(targetResult);
        scorerPayloads = (scorerResults ?? {}) as Record<string, any>;
      },
    });

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

    return {
      id: evalCase.id,
      question: evalCase.question,
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
      question: evalCase.question,
      scores: {},
      checkResults: [],
      answer,
      toolCalls,
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
 */
export async function runAssistantEvals(
  datasets: string[],
  onCaseComplete?: (result: AssistantEvalCaseResult) => void,
  caseIds?: string[],
): Promise<AssistantEvalCaseResult[]> {
  const results: AssistantEvalCaseResult[] = [];
  for (const evalCase of selectEvalCases(caseIds)) {
    const result = await runAssistantEvalCase(evalCase, datasets);
    results.push(result);
    onCaseComplete?.(result);
  }
  return results;
}
