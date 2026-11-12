import { Injectable, NotFoundException } from '@nestjs/common';
import { SessionsRepository } from '../sessions/repositories/sessions.repository';
import { WorkflowRunsRepository } from '../workflows/repositories/workflow-runs.repository';
import { runTitle } from '../workflows/workflow-run-steps';
import { buildContextSegments, type ToolDefinition } from './context-segments';
import { parseLlmCallsQuery, type LlmCallsQuery } from './dto/llm-calls-query';
import {
  parseFrameworkFlag,
  parseSessionsQuery,
  type SessionsQuery,
} from './dto/sessions-query';
import type {
  SessionDetail,
  SessionRow,
  SessionsPage,
  TraceDetail,
} from './entities/session-flow.entity';
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
  type SessionRecord,
} from './repositories/span-events.repository';
import { buildSessionFlows, type SessionFlow } from './session-trajectory';
import {
  collapseSpans,
  errorMessage,
  toolName,
  type CollapsedSpan,
} from './span-collapse';
import { buildTraceTree } from './span-tree';
import { durationMs, iso, messages, num, usage } from './span-values';

const EMPTY_FACETS: LlmCallFacets = {
  agents: [],
  models: [],
  providers: [],
  sessions: [],
};

const EMPTY_SESSIONS_FACETS: SessionsPage['facets'] = { agents: [] };

function byLabel<T>(label: (item: T) => string): (a: T, b: T) => number {
  return (a, b) =>
    label(a).localeCompare(label(b), undefined, { sensitivity: 'base' });
}

/**
 * Monitoring (roadmap 1.21.14–1.21.16): the app's LLM calls and their
 * context, the sessions and their execution flow, one turn's span tree.
 */
@Injectable()
export class MonitoringService {
  constructor(
    private readonly spans: SpanEventsRepository,
    private readonly sessions: SessionsRepository,
    private readonly runs: WorkflowRunsRepository,
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
    const names = await this.threadNames([
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
          .map((id) => threadRef(id, names))
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
    const names = await this.threadNames([record.sessionId]);
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

  /** `GET /monitoring/sessions`. */
  async listSessions(query: SessionsQuery = {}): Promise<SessionsPage> {
    const { page, pageSize, filter } = parseSessionsQuery(query);
    if (!(await this.spans.hasSpanEvents())) {
      return {
        items: [],
        total: 0,
        page,
        pageSize,
        facets: EMPTY_SESSIONS_FACETS,
      };
    }
    const [records, total, agents] = await Promise.all([
      this.spans.findSessions(filter, pageSize, (page - 1) * pageSize),
      this.spans.countSessions(filter),
      this.spans.sessionAgents(),
    ]);
    const ids = records.map((r) => r.id);
    const [flows, names] = await Promise.all([
      this.sessionFlows(ids),
      this.threadNames(ids),
    ]);
    return {
      items: records.map((r) => toSessionRow(r, flows.get(r.id), names)),
      total,
      page,
      pageSize,
      facets: {
        agents: agents
          .map((a) => ({ id: a.id, name: a.name ?? a.id }))
          .sort(byLabel((a) => a.name)),
      },
    };
  }

  /** `GET /monitoring/sessions/:id`. */
  async getSession(id: string): Promise<SessionDetail> {
    const record = (await this.spans.hasSpanEvents())
      ? (await this.spans.findSessions({ id }, 1, 0))[0]
      : undefined;
    if (!record) throw new NotFoundException('Session not found');
    const [flows, names] = await Promise.all([
      this.sessionFlows([id]),
      this.threadNames([id]),
    ]);
    const flow = flows.get(id);
    return {
      ...toSessionRow(record, flow, names),
      turnList: flow?.turnList ?? [],
    };
  }

  /** `GET /monitoring/traces/:traceId`. */
  async getTrace(traceId: string, framework?: unknown): Promise<TraceDetail> {
    const rows = (await this.spans.hasSpanEvents())
      ? await this.spans.traceRows(traceId)
      : [];
    if (rows.length === 0) throw new NotFoundException('Trace not found');
    return buildTraceTree(
      traceId,
      [...collapseSpans(rows).values()],
      parseFrameworkFlag(framework),
    );
  }

  private async sessionFlows(ids: string[]): Promise<Map<string, SessionFlow>> {
    const rows = await this.spans.sessionSpanRows(ids);
    return buildSessionFlows([...collapseSpans(rows).values()]);
  }

  /**
   * Names of the given thread ids; absent ids have no entry. A thread is a
   * chat session, or a run's temporary host `run-<id>` (ADR-0041): a run
   * is named `<workflow>: <title>` from its stored document, and a run
   * that was deleted or never existed has no entry, like a deleted chat.
   */
  private async threadNames(
    ids: (string | null)[],
  ): Promise<Map<string, ThreadName>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    const found = await Promise.all(
      unique.map(async (id): Promise<ThreadName | null> => {
        if (id.startsWith(RUN_HOST_ID_PREFIX)) {
          const run = await this.runs.get(id.slice(RUN_HOST_ID_PREFIX.length));
          return run
            ? {
                name: `${run.workflowName}: ${runTitle(run, [])}`,
                runId: run.id,
              }
            : null;
        }
        const session = await this.sessions.get(id);
        return session ? { name: session.name } : null;
      }),
    );
    const names = new Map<string, ThreadName>();
    found.forEach((thread, i) => {
      if (thread) names.set(unique[i], thread);
    });
    return names;
  }

  private toRow(r: LlmCallRecord, names: Map<string, ThreadName>): LlmCallRow {
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
      session: r.sessionId ? threadRef(r.sessionId, names) : null,
      ...tokens,
      reasoningTokens: num(r.reasoningTokens),
      costUsd: estimateCostUsd(r.model, tokens),
      status: r.status,
    };
  }
}

/** A run's temporary host id prefix (`RUN_HOST_ID_PREFIX`, sessions.service). */
const RUN_HOST_ID_PREFIX = 'run-';

/** What a thread id resolves to: a chat's name, or a run's name and id. */
interface ThreadName {
  name: string;
  runId?: string;
}

function threadRef(
  id: string,
  names: Map<string, ThreadName>,
): { id: string; name: string | null; runId?: string } {
  const thread = names.get(id);
  return {
    id,
    name: thread?.name ?? null,
    ...(thread?.runId ? { runId: thread.runId } : {}),
  };
}

/** A sessions-query record with the totals of its spans. */
function toSessionRow(
  record: SessionRecord,
  flow: SessionFlow | undefined,
  names: Map<string, ThreadName>,
): SessionRow {
  return {
    ...threadRef(record.id, names),
    agents: flow?.agents ?? [],
    turns: flow?.turns ?? 0,
    firstAt: new Date(record.firstAt).toISOString(),
    lastAt: new Date(record.lastAt).toISOString(),
    wallMs: flow?.wallMs ?? null,
    modelMs: flow?.modelMs ?? null,
    toolCalls: flow?.toolCalls ?? 0,
    inputTokens: flow?.inputTokens ?? null,
    outputTokens: flow?.outputTokens ?? null,
    costUsd: flow?.costUsd ?? null,
    errors: flow?.errors ?? 0,
    status: flow?.status ?? 'succeeded',
  };
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
