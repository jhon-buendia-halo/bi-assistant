import { Inject, Injectable } from '@nestjs/common';
import { EvalRunsRepository } from '../agents/repositories/eval-runs.repository';
import {
  AGENT_QUALITY_CATALOGUE,
  UNKNOWN_MODEL,
  buildAgentQualityPage,
  type QualityAgent,
} from './agent-quality';
import {
  parseAgentQualityQuery,
  type AgentQualityQuery,
} from './dto/agent-quality-query';
import type { AgentQualityPage } from './entities/agent-quality.entity';
import { SpanEventsRepository } from './repositories/span-events.repository';

/** `GET /monitoring/agent-quality` (api.md #163, ADR-0054). */
@Injectable()
export class AgentQualityService {
  constructor(
    private readonly spans: SpanEventsRepository,
    private readonly evalRuns: EvalRunsRepository,
    @Inject(AGENT_QUALITY_CATALOGUE)
    private readonly catalogue: QualityAgent[],
  ) {}

  async getAgentQuality(
    query: AgentQualityQuery = {},
    now: Date = new Date(),
  ): Promise<AgentQualityPage> {
    const filter = parseAgentQualityQuery(query, now);
    const agentIds = this.catalogue.map((a) => a.agentId);
    const hasSpans = await this.spans.hasSpanEvents();
    // Runs with no recorded model match no live call.
    const queryLive = hasSpans && filter.model !== UNKNOWN_MODEL;

    const [runLists, liveCalls, liveModels] = await Promise.all([
      Promise.all(this.catalogue.map((a) => this.evalRuns.list(a.key))),
      queryLive
        ? this.spans.liveCallRows({
            agentIds,
            model: filter.model,
            from: filter.from ?? undefined,
            to: filter.to,
          })
        : Promise.resolve([]),
      hasSpans ? this.spans.liveModels(agentIds) : Promise.resolve([]),
    ]);
    const runs = new Map(this.catalogue.map((a, i) => [a.key, runLists[i]]));
    return buildAgentQualityPage({
      agents: this.catalogue,
      runs,
      liveCalls,
      liveModels,
      filter,
    });
  }
}
