/** Body of `POST /data-readiness/assessments` (api.md 108). */
export interface AssessDto {
  datasourceId: string;
  /** Inventory entity keys narrowing the scope; all entities when omitted. */
  entities?: string[];
  /** Recorded on the report when the assessment comes from a chat. */
  sessionId?: string;
  /**
   * Recorded on the report when the assessment comes from a workflow run;
   * the readiness bridge sets it for a run host, never with `sessionId`.
   */
  runId?: string;
}
