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
  /** Plain-language reason the assistant ran this call. */
  rationale?: string;
  /**
   * Faults found in the query's own result — a ratio of a sum to itself, a
   * metric identical on every row, a "top N" with nothing ordering it. Shown
   * so a questionable figure is visible even when nobody reviews the SQL.
   */
  warnings?: string[];
}

/** One step of the assistant's plain-language route from question to answer. */
export interface ReasoningStep {
  step: number;
  rationale: string;
  tool: string;
  input?: string;
  rowCount?: number;
  error?: string;
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
  /** How the assistant worked its way from the question to this answer. */
  reasoning?: ReasoningStep[];
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
  /** The column the value belongs to — present when the mark carried `data-qti-column`. */
  column?: string;
}

export interface VisualizationVersion {
  version: number;
  createdAt: string;
  instruction?: string;
  sourceMessageAt: string;
  /** Last time this version's data was refreshed by re-running its SQL. */
  refreshedAt?: string;
}

export interface SessionVisualization {
  id: string;
  title: string;
  description: string;
  path: string;
  sourceMessageAt: string;
  createdAt: string;
  currentVersion?: number;
  versions?: VisualizationVersion[];
}

export interface InteractiveVisualization extends SessionVisualization {
  document: string;
  version: number;
}

export interface Session {
  id: string;
  name: string;
  workspaceId?: string;
  datasets: string[];
  messages: ChatMessage[];
  visualizations?: SessionVisualization[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SessionActionResult {
  ok: boolean;
  message: string;
  session?: Session;
  visualization?: InteractiveVisualization;
}
