/** Body of `POST /data-readiness/assessments` (api.md). */
export interface AssessDto {
  datasourceId: string;
  /** Optional narrowing: one schema, or one table within it. */
  namespace?: string;
  entity?: string;
  /** Set when the agent runs the assessment from a chat. */
  sessionId?: string;
}
