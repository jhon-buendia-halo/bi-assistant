import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionsRepository } from '../sessions/repositories/sessions.repository';
import {
  buildContextSegments,
  type PromptMessage,
  type ToolDefinition,
} from './context-segments';
import { parseLlmCallsQuery, type LlmCallsQuery } from './dto/llm-calls-query';
import type {
  LlmCallDetail,
  LlmCallFacets,
  LlmCallRow,
  LlmCallsPage,
  LlmCallStep,
} from './entities/llm-call.entity';
import { estimateCostUsd, findModelPrice } from './model-prices';
import {
  SpanEventsRepository,
  type LlmCallRecord,
} from './repositories/span-events.repository';
import {
  collapseSpans,
  errorMessage,
  toolName,
  type CollapsedSpan,
} from './span-collapse';

const EMPTY_FACETS: LlmCallFacets = {
  agents: [],
  models: [],
  providers: [],
  sessions: [],
};

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function durationMs(start: Date, end: Date | null): number | null {
  return end ? end.getTime() - start.getTime() : null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function byLabel<T>(label: (item: T) => string): (a: T, b: T) => number {
  return (a, b) =>
    label(a).localeCompare(label(b), undefined, { sensitivity: 'base' });
}

function usage(attributes: Record<string, unknown>): Record<string, unknown> {
  const u = attributes.usage;
  return u && typeof u === 'object' ? (u as Record<string, unknown>) : {};
}

/** The prompt messages of a span input: an array, or `{ messages }`. */
function messages(input: unknown): PromptMessage[] {
  const list: unknown = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
      ? (input as { messages?: unknown }).messages
      : undefined;
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).filter(
    (m): m is PromptMessage =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as { role?: unknown }).role === 'string',
  );
}

/** Monitoring (roadmap 1.21.14, 1.21.15): the app's LLM calls and their context. */
@Injectable()
export class MonitoringService {
  constructor(
    private readonly spans: SpanEventsRepository,
    private readonly sessions: SessionsRepository,
  ) {}

  /** `GET /monitoring/llm-calls`. */
  async listCalls(query: LlmCallsQuery = {}): Promise<LlmCallsPage> {
    const { page, pageSize, filter } = parseLlmCallsQuery(query);
    if (!(await this.spans.hasSpanEvents())) {
      return { items: [], total: 0, page, pageSize, facets: EMPTY_FACETS };
    }
    const [records, total, facetValues] = await Promise.all([
      this.spans.findCalls(filter, pageSize, (page - 1) * pageSize),
      this.spans.countCalls(filter),
      this.spans.facetValues(),
    ]);
    const names = await this.sessionNames([
      ...facetValues.sessionIds,
      ...records.map((r) => r.sessionId),
    ]);
    return {
      items: records.map((r) => this.toRow(r, names)),
      total,
      page,
      pageSize,
      facets: {
        agents: facetValues.agents
          .map((a) => ({ id: a.id, name: a.name ?? a.id }))
          .sort(byLabel((a) => a.name)),
        models: [...facetValues.models].sort(byLabel((m) => m)),
        providers: [...facetValues.providers].sort(byLabel((p) => p)),
        sessions: facetValues.sessionIds
          .map((id) => ({ id, name: names.get(id) ?? null }))
          .sort(byLabel((s) => s.name ?? s.id)),
      },
    };
  }

  /** `GET /monitoring/llm-calls/:id`. */
  async getCall(id: string): Promise<LlmCallDetail> {
    const record = (await this.spans.hasSpanEvents())
      ? (await this.spans.findCalls({ id }, 1, 0))[0]
      : undefined;
    if (!record) throw new NotFoundException('LLM call not found');
    const names = await this.sessionNames([record.sessionId]);
    const row = this.toRow(record, names);

    const spans = collapseSpans(await this.spans.traceSpanRows(record.traceId));
    const generation = spans.get(id);
    const attributes = generation?.attributes ?? {};
    const all = [...spans.values()];

    const steps = all
      .filter((s) => s.spanType === 'model_step' && s.parentSpanId === id)
      .sort(
        (a, b) => stepIndex(a) - stepIndex(b) || +a.startedAt - +b.startedAt,
      );
    const endedSteps = steps.filter((s) => s.endedAt !== null);
    const lastStep = endedSteps[endedSteps.length - 1] ?? null;

    const started = new Date(row.startedAt);
    const ended = row.endedAt ? new Date(row.endedAt) : null;
    const toolCalls = all
      .filter(
        (s) =>
          s.spanType === 'tool_call' &&
          s.startedAt >= started &&
          (ended === null || s.startedAt <= ended),
      )
      .sort((a, b) => +a.startedAt - +b.startedAt)
      .map((s) => ({ name: toolName(s), input: s.input, output: s.output }));

    const contextTokens =
      num(lastStep ? usage(lastStep.attributes).inputTokens : null) ??
      row.inputTokens;
    const completionStart = attributes.completionStartTime;
    const firstToken =
      typeof completionStart === 'string' ? new Date(completionStart) : null;

    return {
      ...row,
      finishReason:
        typeof attributes.finishReason === 'string'
          ? attributes.finishReason
          : null,
      timeToFirstTokenMs:
        firstToken && !Number.isNaN(firstToken.getTime())
          ? firstToken.getTime() - started.getTime()
          : null,
      error: row.status === 'failed' ? errorMessage(generation?.error) : null,
      contextLimit: findModelPrice(row.model)?.contextLimit ?? null,
      contextTokens,
      steps: steps.map((s, i) => toStep(s, i)),
      segments: buildContextSegments({
        generationMessages: messages(generation?.input),
        lastStepMessages: lastStep ? messages(lastStep.input) : null,
        tools: Array.isArray(attributes.tools)
          ? (attributes.tools as ToolDefinition[])
          : [],
        toolCalls,
        contextTokens,
      }),
    };
  }

  /** Session names of the given thread ids; absent ids have no entry. */
  private async sessionNames(
    ids: (string | null)[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    const found = await Promise.all(unique.map((id) => this.sessions.get(id)));
    const names = new Map<string, string>();
    found.forEach((session, i) => {
      if (session) names.set(unique[i], session.name);
    });
    return names;
  }

  private toRow(r: LlmCallRecord, names: Map<string, string>): LlmCallRow {
    const startedAt = new Date(r.startedAt);
    const endedAt = r.endedAt ? new Date(r.endedAt) : null;
    const tokens = {
      inputTokens: num(r.inputTokens),
      outputTokens: num(r.outputTokens),
      cacheReadTokens: num(r.cacheReadTokens),
      cacheWriteTokens: num(r.cacheWriteTokens),
    };
    return {
      id: r.id,
      traceId: r.traceId,
      startedAt: startedAt.toISOString(),
      endedAt: iso(endedAt),
      durationMs: durationMs(startedAt, endedAt),
      agent: r.agentId
        ? { id: r.agentId, name: r.agentName ?? r.agentId }
        : null,
      model: r.model,
      provider: r.provider,
      session: r.sessionId
        ? { id: r.sessionId, name: names.get(r.sessionId) ?? null }
        : null,
      ...tokens,
      reasoningTokens: num(r.reasoningTokens),
      costUsd: estimateCostUsd(r.model, tokens),
      status: r.status,
    };
  }
}

function stepIndex(span: CollapsedSpan): number {
  return num(span.attributes.stepIndex) ?? Number.MAX_SAFE_INTEGER;
}

function toStep(span: CollapsedSpan, position: number): LlmCallStep {
  const u = usage(span.attributes);
  const finish = span.attributes.finishReason;
  return {
    index: num(span.attributes.stepIndex) ?? position,
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    finishReason: typeof finish === 'string' ? finish : null,
    durationMs: durationMs(span.startedAt, span.endedAt),
  };
}
