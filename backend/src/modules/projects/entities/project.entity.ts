export interface ClarificationOption {
  label: string;
  description?: string;
}

/** One tool invocation's captured result, kept for visuals and transparency. */
export interface ToolDataRecord {
  tool: string;
  /** Tool input worth showing (SQL text, entity name). */
  input?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  /** Total rows the tool returned before storage truncation. */
  rowCount?: number;
  /**
   * True when rows were clipped anywhere: the query hit its row limit, or
   * storage kept fewer rows than the tool returned.
   */
  truncated?: boolean;
  error?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  /** Structured data the assistant retrieved while producing this answer. */
  data?: ToolDataRecord[];
  /**
   * Fully-qualified `catalog.schema.table` entities the assistant queried to
   * produce this answer, derived from `data`. Feeds the chat provenance chips
   * and the visual frame's source list.
   */
  entities?: string[];
  /** Present when the assistant asked a clarifying question with options. */
  clarification?: {
    question: string;
    options: ClarificationOption[];
  };
  /** Present when this turn created, updated or reverted a visual. */
  visual?: VisualEvent;
  /**
   * The answer's final SQL matches a stored verified query, or the user
   * promoted it with a thumbs-up.
   */
  verified?: boolean;
  /**
   * Deterministic one-line provenance summary built at persist time — never
   * model output, same principle as the visual frame.
   */
  interpretation?: string;
  /**
   * The user's rating of this answer. A thumbs-up also stores the answer's
   * question → SQL pair in the verified query library.
   */
  feedback?: MessageFeedback;
  /**
   * Careful mode only: an independent re-derivation of the question's SQL was
   * executed and its result set compared with this answer's.
   */
  crossCheck?: CrossCheck;
  /**
   * Present when a deep-analysis job produced a report. The message content is
   * the report's executive summary; the full markdown lives in the workspace.
   */
  report?: AnalysisReport;
}

export interface AnalysisReport {
  /** Job that produced it — also the download key. */
  jobId: string;
  title: string;
  /** Workspace-relative path of the stored markdown report. */
  path: string;
  /** How many investigation angles the report covers. */
  angles: number;
}

export type MessageFeedback = 'up' | 'down';

export interface CrossCheck {
  /**
   * `agree` — the independent query returned the same results; `disagree` —
   * they differ; `error` — the check could not complete.
   */
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

export interface VisualizationVersion {
  version: number;
  createdAt: string;
  /** The tailoring request that produced this version (absent for v1). */
  instruction?: string;
  sourceMessageAt: string;
}

export interface ProjectVisualization {
  id: string;
  title: string;
  description: string;
  /** Workspace-relative directory containing the visualization bundle. */
  path: string;
  sourceMessageAt: string;
  createdAt: string;
  /**
   * Version history. Files live at `<path>/v<N>/`; legacy single-version
   * visuals (no `versions`) keep their files directly under `<path>/`.
   */
  currentVersion?: number;
  versions?: VisualizationVersion[];
}

export interface InteractiveVisualization extends ProjectVisualization {
  /** Sandboxed, self-contained document assembled from the stored bundle. */
  document: string;
  /** Version the document was assembled from. */
  version: number;
}

export interface ProjectDoc {
  id: string;
  name: string;
  /** Mastra workspace associated one-to-one with this project. */
  workspaceId?: string;
  /** Names of the sandboxes this project works over. */
  sandboxes: string[];
  messages: ChatMessage[];
  visualizations?: ProjectVisualization[];
  createdAt?: string;
  updatedAt?: string;
}
