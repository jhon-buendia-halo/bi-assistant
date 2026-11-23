/**
 * Wire shapes of `GET /monitoring/agent-quality` (api.md #163, monitoring
 * R58-R68, ADR-0054).
 */
export interface AgentQualityPage {
  /** ISO; null = all time. */
  from: string | null;
  /** ISO. */
  to: string;
  /**
   * One per built-in agent with at least one eval set; narrowed by agent and by
   * set (a set keeps its own agent only); sorted by persona name.
   */
  rows: AgentQualityRow[];
  /** Never narrowed by the filters. */
  facets: {
    /** Agents with sets, by name. */
    agents: { key: string; name: string }[];
    /** Every set, by agent name then set name. */
    sets: { id: string; name: string; agentKey: string }[];
    /**
     * Distinct run models of those agents ('Unknown' last) plus distinct live
     * call models of their agent ids; sorted.
     */
    models: string[];
  };
}

export interface AgentQualityRow {
  /** Registry key (eval_runs.agentKey). */
  agentKey: string;
  /** Mastra agent id (span entityId). */
  agentId: string;
  /** Persona name. */
  name: string;
  /** Persona title, '' when none. */
  role: string;
  eval: {
    /** none: no completed run ever; no-match: runs exist, none in scope. */
    state: 'none' | 'no-match' | 'ok';
    /** The model the eval figures are on (M, monitoring R61). */
    model: string | null;
    provider: string | null;
    /** Completed runs in scope on M. */
    runs: number;
    lastRun: {
      jobId: string;
      at: string;
      passed: number;
      total: number;
    } | null;
    /** null unless eval.state === 'ok'. */
    pass3:
      | { state: 'ok'; value: number; cases: number; totalCases: number }
      | { state: 'needs-runs'; runs: 0 | 1 | 2 }
      | { state: 'unknown-model' }
      | null;
    /** Case results counted for the tool figures. */
    questions: number;
    toolCalls: number;
    toolCallsPerQuestion: number | null;
    /** 0..1. */
    toolErrorRate: number | null;
  };
  live: {
    calls: number;
    p95Ms: number | null;
    pricedCalls: number;
    costPerCallUsd: number | null;
  };
}
