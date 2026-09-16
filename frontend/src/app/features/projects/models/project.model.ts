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
}

export type MessageFeedback = 'up' | 'down';

export interface VisualEvent {
  visualId: string;
  version: number;
  title: string;
  action: 'created' | 'updated' | 'reverted';
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
