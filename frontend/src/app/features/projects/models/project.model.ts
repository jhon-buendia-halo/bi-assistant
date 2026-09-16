export interface ClarificationOption {
  label: string;
  description?: string;
}

export interface ToolDataRecord {
  tool: string;
  input?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  error?: string;
  /**
   * True when rows were clipped anywhere: the query hit its row limit, or
   * storage kept fewer rows than the tool returned.
   */
  truncated?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  /** Structured data the assistant retrieved while producing this answer. */
  data?: ToolDataRecord[];
  /** `catalog.schema.table` entities queried to produce this answer. */
  entities?: string[];
  /** Present when the assistant asked a clarifying question with options. */
  clarification?: {
    question: string;
    options: ClarificationOption[];
  };
  /** Present when this turn created, updated or reverted a visual. */
  visual?: VisualEvent;
  /** User rating of this answer; `up` saves it as a verified query. */
  feedback?: MessageFeedback;
  /**
   * The answer's final SQL matches a stored verified query (or was promoted
   * via thumbs-up).
   */
  verified?: boolean;
  /** Deterministic one-line provenance summary, built server-side. */
  interpretation?: string;
  /**
   * Careful mode only: an independent query re-derived from the question was
   * run and its results compared with this answer's.
   */
  crossCheck?: CrossCheck;
  /**
   * Present when a deep-analysis job produced a report. The content is the
   * report's executive summary; the full markdown is downloadable.
   */
  report?: AnalysisReport;
}

export interface AnalysisReport {
  jobId: string;
  title: string;
  /** Workspace-relative path of the stored markdown report. */
  path: string;
  angles: number;
}

/** Deep-analysis job lifecycle, as reported by polling. */
export type DeepAnalysisStatus =
  | 'planning'
  | 'investigating'
  | 'writing'
  | 'done'
  | 'error';

export interface DeepAnalysisResult {
  ok: boolean;
  message: string;
  jobId?: string;
  status?: DeepAnalysisStatus;
  /** Human-readable line for the pending card. */
  progress?: string;
  step?: number;
  steps?: number;
  title?: string;
  error?: string;
}

export type MessageFeedback = 'up' | 'down';

export interface CrossCheck {
  status: 'agree' | 'disagree' | 'error';
  /** Short human-readable line shown as the chip's tooltip. */
  note?: string;
}

export interface VisualEvent {
  visualId: string;
  version: number;
  title: string;
  action: 'created' | 'updated' | 'reverted';
}

/** A data mark the user clicked inside a visual (postMessage `visual-select`). */
export interface DataPointSelection {
  value: string;
  label?: string;
}

export interface VisualizationVersion {
  version: number;
  createdAt: string;
  instruction?: string;
  sourceMessageAt: string;
}

export interface ProjectVisualization {
  id: string;
  title: string;
  description: string;
  path: string;
  sourceMessageAt: string;
  createdAt: string;
  currentVersion?: number;
  versions?: VisualizationVersion[];
}

export interface InteractiveVisualization extends ProjectVisualization {
  document: string;
  version: number;
}

export interface Project {
  id: string;
  name: string;
  workspaceId?: string;
  sandboxes: string[];
  messages: ChatMessage[];
  visualizations?: ProjectVisualization[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectActionResult {
  ok: boolean;
  message: string;
  project?: Project;
  visualization?: InteractiveVisualization;
}
