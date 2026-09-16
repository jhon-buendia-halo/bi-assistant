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
