/**
 * Lifecycle of one deep-analysis job: plan the angles, investigate them one by
 * one, write the report.
 */
export type DeepAnalysisStatus =
  'planning' | 'investigating' | 'writing' | 'done' | 'error';

/** One planned investigation angle. */
export interface AnalysisAngle {
  title: string;
  question: string;
}

/** What one angle's investigation produced. */
export interface AngleFinding extends AnalysisAngle {
  /** The agent's prose findings for this angle. */
  findings: string;
  /** Statements the agent reported running, for the data appendix. */
  sql: string[];
}

/** In-process job record — the slow path lives in memory, not in SQLite. */
export interface DeepAnalysisJob {
  id: string;
  sessionId: string;
  question: string;
  status: DeepAnalysisStatus;
  /** Human-readable line for the pending card in the chat. */
  progress?: string;
  /** Angle currently being investigated (1-based) and how many there are. */
  step?: number;
  steps?: number;
  title?: string;
  /** Workspace-relative path of the report once it is written. */
  path?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

/** What polling returns — the job without its internals. */
export type DeepAnalysisView = Pick<
  DeepAnalysisJob,
  'status' | 'progress' | 'step' | 'steps' | 'title' | 'error'
> & { jobId: string };
