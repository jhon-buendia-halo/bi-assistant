import type {
  FlowStatus,
  SessionRow,
  TrajectoryModelStep,
  TrajectoryStep,
  TrajectoryToolGroup,
  Turn,
} from './entities/session-flow.entity';
import { estimateCostUsd } from './model-prices';
import {
  asRecord,
  errorMessage,
  spanFailed,
  toolName,
  type CollapsedSpan,
} from './span-collapse';
import {
  callModel,
  callUsage,
  cut,
  durationMs,
  finishReason,
  messages,
  num,
  textParts,
  usage,
} from './span-values';

/** The answer of a turn is cut to this many chars. */
export const ANSWER_MAX = 4000;
/** A tool group's summary is cut to this many chars. */
export const SUMMARY_MAX = 160;
/** A run_readonly_sql summary keeps this many chars of the SQL. */
const SQL_SUMMARY_MAX = 80;

/** What a session's spans add up to (the row minus id, name and dates). */
export type SessionFlow = Omit<
  SessionRow,
  'id' | 'name' | 'firstAt' | 'lastAt'
> & { turnList: Turn[] };

function byStart(a: CollapsedSpan, b: CollapsedSpan): number {
  return +a.startedAt - +b.startedAt || a.spanId.localeCompare(b.spanId);
}

/** Sum of the known values; null when none is known. */
function sumKnown(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}

/** A tool call's one-line summary, from its input. */
export function toolSummary(name: string, input: unknown): string | null {
  const args = asRecord(input);
  if (name === 'describe_entity' && typeof args.entity === 'string') {
    return args.entity;
  }
  if (name === 'run_readonly_sql' && typeof args.sql === 'string') {
    const line = args.sql.replace(/\s+/g, ' ').trim();
    return line.length > SQL_SUMMARY_MAX
      ? `${line.slice(0, SQL_SUMMARY_MAX)}…`
      : line;
  }
  if (typeof input === 'string') return input;
  const first = Object.values(args).find((v) => typeof v === 'string');
  return typeof first === 'string' ? first : null;
}

/** A tool call's row count, from its output's `rowCount` or `rows`. */
export function toolRows(output: unknown): number | null {
  const out = asRecord(output);
  const count = num(out.rowCount);
  if (count !== null) return count;
  return Array.isArray(out.rows) ? out.rows.length : null;
}

/** Tool calls of one tools step, grouped by name in order of first call. */
function groupTools(calls: CollapsedSpan[]): TrajectoryToolGroup[] {
  const groups = new Map<string, CollapsedSpan[]>();
  for (const call of [...calls].sort(byStart)) {
    const name = toolName(call);
    groups.set(name, [...(groups.get(name) ?? []), call]);
  }
  return [...groups].map(([name, list]) => {
    const summaries = [
      ...new Set(
        list
          .map((c) => toolSummary(name, c.input))
          .filter((s): s is string => s !== null && s !== ''),
      ),
    ];
    return {
      name,
      count: list.length,
      durationMs: sumKnown(list.map((c) => durationMs(c.startedAt, c.endedAt))),
      ok: list.every((c) => !spanFailed(c)),
      summary: summaries.length ? cut(summaries.join(', '), SUMMARY_MAX) : null,
      rows: sumKnown(list.map((c) => toolRows(c.output))),
    };
  });
}

/** The nearest ancestor (or self) of a span with the given type. */
function ancestorOfType(
  span: CollapsedSpan,
  type: string,
  byId: Map<string, CollapsedSpan>,
): CollapsedSpan | null {
  const seen = new Set<string>();
  let current: CollapsedSpan | undefined = span;
  while (current && !seen.has(current.spanId)) {
    if (current.spanType === type) return current;
    seen.add(current.spanId);
    current = current.parentSpanId ? byId.get(current.parentSpanId) : undefined;
  }
  return null;
}

interface PlannedStep {
  model: TrajectoryModelStep;
  /** The model_step span, or the generation when it has no steps. */
  span: CollapsedSpan;
  tools: CollapsedSpan[];
}

/**
 * The turn's path: each model call's requests in order, each followed by the
 * tool calls it made (the calls under its model_step; a call outside any step
 * goes after the last request started before it).
 */
export function buildSteps(
  generations: CollapsedSpan[],
  modelSteps: CollapsedSpan[],
  toolCalls: CollapsedSpan[],
  byId: Map<string, CollapsedSpan>,
): TrajectoryStep[] {
  const planned: PlannedStep[] = [];
  for (const generation of [...generations].sort(byStart)) {
    const model = callModel(generation);
    const own = modelSteps
      .filter((s) => s.parentSpanId === generation.spanId)
      .sort(
        (a, b) =>
          (num(a.attributes.stepIndex) ?? Number.MAX_SAFE_INTEGER) -
            (num(b.attributes.stepIndex) ?? Number.MAX_SAFE_INTEGER) ||
          byStart(a, b),
      );
    const spans = own.length ? own : [generation];
    spans.forEach((span, position) => {
      const u = usage(span.attributes);
      planned.push({
        span,
        tools: [],
        model: {
          kind: 'model',
          callId: generation.spanId,
          stepIndex:
            span === generation
              ? 0
              : (num(span.attributes.stepIndex) ?? position),
          model,
          durationMs: durationMs(span.startedAt, span.endedAt),
          inputTokens: num(u.inputTokens),
          outputTokens: num(u.outputTokens),
          finishReason: finishReason(span),
          text: stepText(span),
        },
      });
    });
  }

  const leading: CollapsedSpan[] = [];
  for (const call of toolCalls) {
    const step = ancestorOfType(call, 'model_step', byId);
    let target = step ? planned.find((p) => p.span === step) : undefined;
    if (!target) {
      target = [...planned]
        .reverse()
        .find((p) => p.span.startedAt <= call.startedAt);
    }
    if (target) target.tools.push(call);
    else leading.push(call);
  }

  const steps: TrajectoryStep[] = [];
  if (leading.length) steps.push({ kind: 'tools', tools: groupTools(leading) });
  for (const p of planned) {
    steps.push(p.model);
    if (p.tools.length)
      steps.push({ kind: 'tools', tools: groupTools(p.tools) });
  }
  return steps;
}

/** A model request's short text: what it said before or instead of calling tools. */
const STEP_TEXT_MAX = 200;

function outputText(span: CollapsedSpan | undefined): string | null {
  const text = asRecord(span?.output).text;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function stepText(span: CollapsedSpan): string | null {
  const text = outputText(span);
  return text ? cut(text.replace(/\s+/g, ' '), STEP_TEXT_MAX) : null;
}

/**
 * A turn's answer: the text of the last finished request of its last finished
 * model call. The call's own output joins every request's text (the
 * commentary before each tool call too), so it is only the fallback.
 */
function answerOf(
  generations: CollapsedSpan[],
  modelSteps: CollapsedSpan[],
): string | null {
  const ended = generations.filter((g) => g.endedAt !== null);
  const last = ended[ended.length - 1];
  if (!last) return null;
  const steps = modelSteps
    .filter((s) => s.parentSpanId === last.spanId && s.endedAt !== null)
    .sort(
      (a, b) =>
        (num(a.attributes.stepIndex) ?? 0) - (num(b.attributes.stepIndex) ?? 0),
    );
  return outputText(steps[steps.length - 1]) ?? outputText(last);
}

/** The last user message's text parts of a model call's input. */
function questionOf(generation: CollapsedSpan | undefined): string | null {
  if (!generation) return null;
  const list = messages(generation.input);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'user') return textParts(list[i].content);
  }
  return null;
}

interface BuiltTurn {
  turn: Turn;
  agents: { id: string; name: string }[];
  toolCalls: number;
  errors: number;
  finished: boolean;
}

/** One turn (trace) from its spans. */
function buildTurn(traceId: string, spans: CollapsedSpan[]): BuiltTurn {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const of = (type: string) =>
    spans.filter((s) => s.spanType === type).sort(byStart);
  const runs = of('agent_run');
  const generations = of('model_generation');
  const modelSteps = of('model_step');
  const toolCalls = of('tool_call');
  const root =
    runs.find((r) => !r.parentSpanId || !byId.has(r.parentSpanId)) ?? runs[0];

  const failed = [root, ...runs, ...generations, ...toolCalls].filter(
    (s, i, all) => all.indexOf(s) === i && spanFailed(s),
  );
  const finished = root.endedAt !== null;
  const status: FlowStatus = failed.length
    ? 'failed'
    : finished
      ? 'succeeded'
      : 'running';
  const firstFailure = failed[0];
  const error = firstFailure
    ? (errorMessage(firstFailure.error) ??
      (firstFailure.spanType === 'tool_call'
        ? `${toolName(firstFailure)} failed`
        : null))
    : null;

  const answerText = answerOf(generations, modelSteps);
  const turnQuestion = runs
    .map((r) => r.requestContext['turn-question'])
    .find((q): q is string => typeof q === 'string');

  const usages = generations.map(callUsage);
  const costs = generations.map((g, i) =>
    estimateCostUsd(callModel(g), usages[i]),
  );

  const agents: { id: string; name: string }[] = [];
  for (const run of runs) {
    if (run.entityId && !agents.some((a) => a.id === run.entityId)) {
      agents.push({ id: run.entityId, name: run.entityName ?? run.entityId });
    }
  }

  return {
    agents,
    toolCalls: toolCalls.length,
    errors: failed.length,
    finished,
    turn: {
      index: 0,
      traceId,
      startedAt: root.startedAt.toISOString(),
      durationMs: durationMs(root.startedAt, root.endedAt),
      status,
      agent: root.entityId
        ? { id: root.entityId, name: root.entityName ?? root.entityId }
        : null,
      question: questionOf(generations[0]) ?? turnQuestion ?? null,
      answer: answerText === null ? null : cut(answerText, ANSWER_MAX),
      inputTokens: sumKnown(usages.map((u) => u.inputTokens)),
      outputTokens: sumKnown(usages.map((u) => u.outputTokens)),
      costUsd: sumKnown(costs),
      modelMs: sumKnown(
        generations.map((g) => durationMs(g.startedAt, g.endedAt)),
      ),
      toolMs: sumKnown(
        toolCalls.map((t) => durationMs(t.startedAt, t.endedAt)),
      ),
      error,
      steps: buildSteps(generations, modelSteps, toolCalls, byId),
    },
  };
}

/**
 * Each session's turns and totals, from the spans of its traces (agent runs,
 * model calls and steps, tool calls). A trace belongs to the session of its
 * agent runs' threadId; a trace with no such run is left out.
 */
export function buildSessionFlows(
  spans: CollapsedSpan[],
): Map<string, SessionFlow> {
  const byTrace = new Map<string, CollapsedSpan[]>();
  for (const span of spans) {
    if (!span.traceId) continue;
    byTrace.set(span.traceId, [...(byTrace.get(span.traceId) ?? []), span]);
  }

  const turnsBySession = new Map<string, BuiltTurn[]>();
  for (const [traceId, traceSpans] of byTrace) {
    const sessionId = traceSpans
      .filter((s) => s.spanType === 'agent_run')
      .sort(byStart)
      .find((s) => s.threadId)?.threadId;
    if (!sessionId) continue;
    const built = buildTurn(traceId, traceSpans);
    turnsBySession.set(sessionId, [
      ...(turnsBySession.get(sessionId) ?? []),
      built,
    ]);
  }

  const flows = new Map<string, SessionFlow>();
  for (const [sessionId, built] of turnsBySession) {
    built.sort(
      (a, b) =>
        a.turn.startedAt.localeCompare(b.turn.startedAt) ||
        a.turn.traceId.localeCompare(b.turn.traceId),
    );
    built.forEach((b, i) => (b.turn.index = i + 1));
    const turns = built.map((b) => b.turn);
    const agents: { id: string; name: string }[] = [];
    for (const agent of built.flatMap((b) => b.agents)) {
      if (!agents.some((a) => a.id === agent.id)) agents.push(agent);
    }
    const errors = built.reduce((n, b) => n + b.errors, 0);
    flows.set(sessionId, {
      agents,
      turns: turns.length,
      wallMs: sumKnown(
        built.filter((b) => b.finished).map((b) => b.turn.durationMs),
      ),
      modelMs: sumKnown(turns.map((t) => t.modelMs)),
      toolCalls: built.reduce((n, b) => n + b.toolCalls, 0),
      inputTokens: sumKnown(turns.map((t) => t.inputTokens)),
      outputTokens: sumKnown(turns.map((t) => t.outputTokens)),
      costUsd: sumKnown(turns.map((t) => t.costUsd)),
      errors,
      status: errors
        ? 'failed'
        : built.some((b) => !b.finished)
          ? 'running'
          : 'succeeded',
      turnList: turns,
    });
  }
  return flows;
}
