/**
 * The RFP Builder's per-call context (agents.md 4.1 Block R1, 4.2). Plain
 * code with no Mastra import, so `SessionsService` and the eval harness can
 * share it without pulling the agent into modules Jest loads as CommonJS.
 */

/** requestContext key: the creator recorded on new RFP records (`create_rfp`). */
export const RFP_CREATED_BY_CONTEXT_KEY = 'rfp-created-by';

/**
 * requestContext key: a live `{ rfpId? }` holder, fresh per turn, filled when
 * `create_rfp` or `get_rfp` succeeds. The orchestrator stores it on the
 * session as `rfpId` after the turn (agents.md 5.1).
 */
export const TURN_RFP_CONTEXT_KEY = 'turn-rfp';

/** The value of `turn-rfp`. */
export interface TurnRfpHolder {
  rfpId?: string;
  /** The RFP's last completed stage (0 to 7), from the latest create/get/update result. */
  stage?: number;
}

/** What Block R1 says about the active RFP (an `Rfp` or `RfpSummary`, api.md 2.16.4). */
export interface RfpOrientationRecord {
  id: string;
  title: string;
  clientName: string;
  clientOneCode: string;
  planYear: number;
  status: string;
  stage: number;
}

export interface RfpOrientationInput {
  datasourceId: string;
  datasourceName: string;
  /** The session's active RFP; undefined when none is active yet. */
  rfp?: RfpOrientationRecord;
  /** Today, `YYYY-MM-DD`. */
  today: string;
}

/**
 * Block R1 — RFP orientation (agents.md 4.1): replaces Block 1 for the `rfp`
 * agent. Lines joined with `\n`.
 */
export function rfpOrientationBlock(input: RfpOrientationInput): string {
  const { rfp } = input;
  return [
    `Intellify RFP API for this session: datasource ${input.datasourceId} ("${input.datasourceName}").`,
    rfp
      ? `Active RFP in this session: ${rfp.id} — "${rfp.title}" for ${rfp.clientName} (${rfp.clientOneCode}), plan year ${rfp.planYear}, status ${rfp.status}, last completed stage ${rfp.stage}.`
      : 'No RFP is active in this session yet: start at stage 1.',
    `Today is ${input.today}.`,
  ].join('\n');
}

/** Today as `YYYY-MM-DD` (UTC), for Block R1. */
export function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
