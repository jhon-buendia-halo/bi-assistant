import { jsonText } from './context-segments';
import type {
  SpanKind,
  SpanNode,
  TraceDetail,
} from './entities/session-flow.entity';
import { estimateCostUsd } from './model-prices';
import { toolRows, toolSummary } from './session-trajectory';
import {
  asRecord,
  errorMessage,
  spanStatus,
  toolName,
  type CollapsedSpan,
} from './span-collapse';
import {
  callModel,
  callUsage,
  cut,
  durationMs,
  finishReason,
  num,
} from './span-values';

/** A span's input or output is cut to this many chars. */
export const IO_MAX = 4000;

const KINDS: Record<string, SpanKind> = {
  agent_run: 'agent',
  model_generation: 'model',
  model_step: 'request',
  tool_call: 'tool',
  memory_operation: 'memory',
  skill_action: 'framework',
  processor_run: 'framework',
  workspace_action: 'framework',
  model_inference: 'framework',
};

/** Never shown, framework spans or not. */
const NOISE = new Set(['model_chunk']);

export function spanKind(spanType: string): SpanKind {
  return KINDS[spanType] ?? 'other';
}

function byStart(a: CollapsedSpan, b: CollapsedSpan): number {
  return +a.startedAt - +b.startedAt || a.spanId.localeCompare(b.spanId);
}

const count = (n: number | null): string | null =>
  n === null ? null : n.toLocaleString('en-US');

/** The nearest model_generation at or above a span. */
function generationOf(
  span: CollapsedSpan,
  byId: Map<string, CollapsedSpan>,
): CollapsedSpan | null {
  const seen = new Set<string>();
  let current: CollapsedSpan | undefined = span;
  while (current && !seen.has(current.spanId)) {
    if (current.spanType === 'model_generation') return current;
    seen.add(current.spanId);
    current = current.parentSpanId ? byId.get(current.parentSpanId) : undefined;
  }
  return null;
}

function memoryOperation(span: CollapsedSpan): string {
  const op = span.attributes.operationType;
  if (typeof op === 'string') return op;
  return (span.name ?? '').replace(/^memory:\s*/, '') || 'operation';
}

function label(span: CollapsedSpan, kind: SpanKind): string {
  switch (kind) {
    case 'agent':
      return `agent run · ${span.entityId ?? span.entityName ?? 'agent'}`;
    case 'model':
      return `model call · ${callModel(span) || 'model'}`;
    case 'request': {
      const index = num(span.attributes.stepIndex);
      return index === null ? 'request' : `request ${index + 1}`;
    }
    case 'tool':
      return toolName(span);
    case 'memory':
      return `memory · ${memoryOperation(span)}`;
    default:
      return span.name ?? span.spanType;
  }
}

/** Token, cache, cost and finish facts of a model call or a request. */
function modelDetails(
  span: CollapsedSpan,
  model: string,
  withCost: boolean,
): (readonly [string, string | null])[] {
  const u = callUsage(span);
  const tokens =
    u.inputTokens === null && u.outputTokens === null
      ? null
      : `${count(u.inputTokens) ?? '—'} in / ${count(u.outputTokens) ?? '—'} out`;
  const cache =
    u.cacheReadTokens === null && u.cacheWriteTokens === null
      ? null
      : `read ${count(u.cacheReadTokens) ?? '0'} · write ${count(u.cacheWriteTokens) ?? '0'}`;
  const cost = withCost ? estimateCostUsd(model, u) : null;
  return [
    ['Model', model || null],
    ['Tokens', tokens],
    ['Cache', cache],
    ['Cost', cost === null ? null : `$${cost.toFixed(4)}`],
    ['Finish reason', finishReason(span)],
  ];
}

function details(
  span: CollapsedSpan,
  kind: SpanKind,
  generation: CollapsedSpan | null,
): { label: string; value: string }[] {
  let facts: (readonly [string, string | null])[] = [];
  switch (kind) {
    case 'agent':
      facts = [['Agent', span.entityName ?? span.entityId]];
      break;
    case 'model': {
      const provider = span.attributes.provider;
      const [model, ...rest] = modelDetails(span, callModel(span), true);
      facts = [
        model,
        ['Provider', typeof provider === 'string' ? provider : null],
        ...rest,
      ];
      break;
    }
    case 'request':
      facts = modelDetails(
        span,
        generation ? callModel(generation) : '',
        false,
      );
      break;
    case 'tool': {
      const name = toolName(span);
      facts = [
        ['Tool input', toolSummary(name, span.input)],
        ['Rows', count(toolRows(span.output))],
      ];
      break;
    }
    case 'memory':
      facts = [['Operation', memoryOperation(span)]];
      break;
    default:
      facts = [['Processor', span.entityName ?? span.entityId]];
  }
  facts.push(['Error', errorMessage(span.error)]);
  return facts
    .filter((f): f is readonly [string, string] => !!f[1])
    .map(([l, value]) => ({ label: l, value }));
}

/** Text as it is; `{ text }` as its text; anything else as pretty JSON. */
function ioText(value: unknown, preferText: boolean): string | null {
  if (value === null || value === undefined) return null;
  const text = asRecord(value).text;
  const shown = preferText && typeof text === 'string' ? text : jsonText(value);
  return shown === '' ? null : cut(shown, IO_MAX);
}

/** Input / output: tool calls and agent runs in full, model text out only. */
function io(
  span: CollapsedSpan,
  kind: SpanKind,
): { input: string | null; output: string | null } {
  switch (kind) {
    case 'agent':
      return {
        input: ioText(span.input, false),
        output: ioText(span.output, true),
      };
    case 'model':
    case 'request': {
      const text = asRecord(span.output).text;
      return {
        input: null,
        output:
          typeof text === 'string' && text !== '' ? cut(text, IO_MAX) : null,
      };
    }
    case 'memory':
      return { input: null, output: null };
    default:
      // Tool calls and any other span: their input and output in full.
      return {
        input: ioText(span.input, false),
        output: ioText(span.output, false),
      };
  }
}

/**
 * One trace as a span tree, depth-first with children by start time.
 * Framework spans are left out unless `framework` is set; a left-out span's
 * children hang from its nearest kept ancestor. `model_chunk` never shows.
 */
export function buildTraceTree(
  traceId: string,
  all: CollapsedSpan[],
  framework: boolean,
): TraceDetail {
  const spans = all.filter((s) => !NOISE.has(s.spanType));
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const hidden = (s: CollapsedSpan) =>
    !framework && spanKind(s.spanType) === 'framework';
  const kept = spans.filter((s) => !hidden(s));

  /** The nearest kept ancestor's id, or null for a root. */
  const keptParent = (span: CollapsedSpan): string | null => {
    const seen = new Set<string>([span.spanId]);
    let parentId = span.parentSpanId;
    while (parentId && !seen.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) return null;
      if (!hidden(parent)) return parent.spanId;
      seen.add(parentId);
      parentId = parent.parentSpanId;
    }
    return null;
  };

  const children = new Map<string | null, CollapsedSpan[]>();
  const parentOf = new Map<string, string | null>();
  for (const span of kept) {
    const parentId = keptParent(span);
    parentOf.set(span.spanId, parentId);
    children.set(parentId, [...(children.get(parentId) ?? []), span]);
  }

  const start =
    spans.reduce<Date | null>(
      (min, s) => (min === null || s.startedAt < min ? s.startedAt : min),
      null,
    ) ?? new Date(0);
  const roots = children.get(null) ?? [];
  const ends = spans.map((s) => s.endedAt).filter((d): d is Date => d !== null);
  const traceDuration =
    roots.length && roots.every((r) => r.endedAt !== null) && ends.length
      ? Math.max(...ends.map((d) => d.getTime())) - start.getTime()
      : null;

  const nodes: SpanNode[] = [];
  const visit = (span: CollapsedSpan, depth: number) => {
    const kind = spanKind(span.spanType);
    const generation =
      kind === 'model' || kind === 'request' ? generationOf(span, byId) : null;
    nodes.push({
      id: span.spanId,
      parentId: parentOf.get(span.spanId) ?? null,
      depth,
      type: span.spanType,
      kind,
      label: label(span, kind),
      startMs: span.startedAt.getTime() - start.getTime(),
      durationMs: durationMs(span.startedAt, span.endedAt),
      status: spanStatus(span),
      callId: generation?.spanId ?? null,
      details: details(span, kind, generation),
      ...io(span, kind),
    });
    for (const child of (children.get(span.spanId) ?? []).sort(byStart)) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots.sort(byStart)) visit(root, 0);

  return {
    traceId,
    startedAt: start.toISOString(),
    durationMs: traceDuration,
    spans: nodes,
    hiddenFramework: spans.length - kept.length,
  };
}
