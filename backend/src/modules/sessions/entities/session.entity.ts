import type { KnowledgeUse } from '../../knowledge/entities/knowledge-snippet.entity';

export type { KnowledgeUse };

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
  /**
   * Why the assistant ran this call, in its own plain business language —
   * the human reasoning behind the SQL, captured as a required tool argument
   * so it always exists alongside the statement it explains.
   */
  rationale?: string;
  /**
   * Faults the result guards found in this query — a ratio of a sum to
   * itself, a metric constant on every row, an unordered "top N". Persisted
   * so a questionable figure stays visible after the turn, whether or not
   * anyone reads the SQL.
   */
  warnings?: string[];
}

/** One step of the assistant's plain-language route from question to answer. */
export interface ReasoningStep {
  /** 1-based position in the turn. */
  step: number;
  /** Model-authored: what this step checks and why it moves toward the answer. */
  rationale: string;
  /** Tool that carried the step out. */
  tool: string;
  /** The statement (or entity) the step used. */
  input?: string;
  /** Rows the step returned, when it succeeded. */
  rowCount?: number;
  /** Error text, when it failed. */
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
   * How the assistant reasoned its way from the question to this answer: one
   * step per data-gathering call that carried a rationale. Assembled at
   * persist time from `data` — the prose is the model's, the ordering and the
   * outcomes are ours, so the trail can never claim a query that never ran.
   */
  reasoning?: ReasoningStep[];
  /**
   * The curated knowledge snippets this answer's context carried, recorded
   * when the block was assembled rather than reconstructed afterwards. Shown
   * beside the reasoning trail so a reader can see the standing terms,
   * instructions and default filters the assistant was working under — the
   * list is what the model was *given*, not a claim about what it applied.
   */
  knowledge?: KnowledgeUse[];
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
  /** Last time this version's data was refreshed by re-running its SQL. */
  refreshedAt?: string;
}

export interface SessionVisualization {
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

export interface InteractiveVisualization extends SessionVisualization {
  /** Sandboxed, self-contained document assembled from the stored bundle. */
  document: string;
  /** Version the document was assembled from. */
  version: number;
}

export interface SessionDoc {
  id: string;
  name: string;
  /** Mastra workspace associated one-to-one with this session. */
  workspaceId?: string;
  /** Names of the datasets this session works over. */
  datasets: string[];
  /** The user agent the session was started from (sessions-chat R52). */
  agentId?: string;
  /** The agent's Live name, re-stamped by each turn that applies it (R59). */
  agentName?: string;
  messages: ChatMessage[];
  visualizations?: SessionVisualization[];
  createdAt?: string;
  updatedAt?: string;
}

/** The agent a session was started from, as the API shows it (api.md 2.1). */
export interface SessionAgentRef {
  id: string;
  name: string;
  deleted: boolean;
  description: string;
  starterQuestions: string[];
}

/** A session on the wire: the stored document plus its derived `agent`. */
export type SessionView = SessionDoc & { agent?: SessionAgentRef };
