import type { ReadinessMaturity } from './readiness.model';

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

/**
 * A curated knowledge snippet the assistant's context carried for one answer.
 * Recorded server-side when the block was assembled — the list is what the
 * model was given, not a claim about what it applied.
 */
export interface KnowledgeUse {
  id: string;
  /** Legacy line tag: term = concept, default_filter = constraint. */
  kind: 'instruction' | 'term' | 'default_filter' | 'relation';
  title: string;
  body: string;
  /** Dataset the snippet is scoped to; absent for a global snippet. */
  datasetId?: string;
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
  /** Curated knowledge snippets this answer's context carried. */
  knowledge?: KnowledgeUse[];
  /**
   * Present when a deep-analysis job produced a report. The content is the
   * report's executive summary; the full markdown is downloadable.
   */
  report?: AnalysisReport;
  /** Present when the RFP Builder exported an RFP package this turn. */
  rfpPackage?: RfpPackage;
  /**
   * The last readiness report this turn produced (Data Readiness Agent
   * sessions; data-model 3.4.1). Drives the readiness card.
   */
  readinessReport?: ReadinessReportRef;
  /**
   * Set on a client-only bubble rendered when a turn's stream failed
   * (provider error, dropped connection, backend crash mid-turn). Never
   * persisted server-side — the backend transcript still ends with the
   * unanswered user question, so a retry reuses that question's bubble
   * instead of duplicating it (see `SessionsService.appendUserMessage`).
   */
  error?: boolean;
}

/** A stored RFP package (data-model 3.4.1); `rfp-package` stream payload. */
export interface RfpPackage {
  rfpId: string;
  title: string;
  files: { name: string; bytes: number }[];
  exportedAt: string;
  /** True for a draft exported by `export_rfp_draft` (stored under `rfp/<rfpId>/draft/`). */
  draft?: true;
}

/** `ChatMessage.readinessReport` (data-model 3.4.1): a reference, not the report. */
export interface ReadinessReportRef {
  reportId: string;
  datasourceName: string;
  overallScore: number;
  maturity: ReadinessMaturity;
  generatedAt: string;
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
  'planning' | 'investigating' | 'writing' | 'done' | 'error';

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

export type PanelItemKind =
  'file' | 'document' | 'table' | 'visual' | 'readiness';

interface PanelItemBase {
  id: string;
  kind: PanelItemKind;
  title: string;
  /** ISO time the agent showed it; the latest wins. */
  shownAt: string;
}

export interface FilePanelItem extends PanelItemBase {
  kind: 'file';
  path: string;
  bytes: number;
}

export interface DocumentPanelItem extends PanelItemBase {
  kind: 'document';
  markdown: string;
}

export interface TablePanelItem extends PanelItemBase {
  kind: 'table';
  tool: string;
  input?: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated?: boolean;
}

export interface VisualPanelItem extends PanelItemBase {
  kind: 'visual';
  visualId: string;
}

/** A data-readiness report; id `readiness:<reportId>` (data-model 3.4.4). */
export interface ReadinessPanelItem extends PanelItemBase {
  kind: 'readiness';
  reportId: string;
}

/** Something an agent showed in the right panel (data-model 3.4.4). */
export type PanelItem =
  | FilePanelItem
  | DocumentPanelItem
  | TablePanelItem
  | VisualPanelItem
  | ReadinessPanelItem;

export interface WorkflowPhase {
  number: number;
  title: string;
  skill?: string;
  /** What the user must do in this step (the agent's todo, else the prompt's default). */
  action?: string;
}

/** The agent's `## Workflow` phases and where the session stands. */
export interface WorkflowView {
  phases: WorkflowPhase[];
  current: number | null;
  done: number[];
  /**
   * `prompt`: the steps come from the agent's `## Workflow` section; `agent`:
   * it defined them; `workflow`: its code-defined turn workflow (agent-panel R8a).
   */
  source: 'prompt' | 'agent' | 'workflow';
  /** Step numbers that do not apply. */
  skipped: number[];
  /** The current step waits for the user's answer or decision. */
  waiting?: boolean;
  /** Markdown, ≤ 2,000 chars: what the agent needs from the user in the current phase. */
  note?: string;
  /** The step of a workflow-backed agent's turn that failed (agent-panel R8a). */
  failed?: number;
}

/** `panel-item` stream payload. */
export interface PanelItemEvent {
  item: PanelItem;
}

/** `GET /sessions/:id/panel-items/:itemId/file` response. */
export interface PanelFileContent {
  item: FilePanelItem;
  contentType: string;
  text: string;
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

/**
 * The agent a session was started from (agent-answers R52-R59), derived by
 * the backend from the agent's current Live version. `deleted` sessions keep
 * the name the agent last had and run on the plain assistant.
 */
export interface SessionAgent {
  id: string;
  name: string;
  deleted: boolean;
  description: string;
  starterQuestions: string[];
}

/**
 * The workflow a session runs, as the API sends it (api.md 2.1): the
 * catalogue name; for a user agent's workflow its Live name (a preview's,
 * the draft's), or the name it last had with `deleted` once it is gone.
 */
export interface SessionWorkflowRef {
  id: string;
  name: string;
  kind: 'code' | 'agent';
  deleted: boolean;
}

export interface Session {
  id: string;
  name: string;
  workspaceId?: string;
  datasets: string[];
  /** Set when the session was started from a user agent. */
  agentId?: string;
  /** The agent's name as last seen for this session. */
  agentName?: string;
  /** Set when the session is bound to a built-in agent (e.g. `rfp`). */
  agentKey?: string;
  /** Present when `agentId` or `agentKey` is. */
  agent?: SessionAgent;
  /**
   * An agent editor's preview conversation: held in memory by the backend,
   * never listed with the sessions (agents-evals R60, R61).
   */
  preview?: boolean;
  messages: ChatMessage[];
  visualizations?: SessionVisualization[];
  /** What the agent showed in the right panel, oldest first. */
  panelItems?: PanelItem[];
  /**
   * The workflow the session runs (api.md 2.1; past-chats R65), derived
   * by the backend on every read; always sent from M1-23 on.
   */
  workflowRef?: SessionWorkflowRef;
  /** Present when the agent's prompt has a `## Workflow` section. */
  workflow?: WorkflowView;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * The agent's name as the page header chip shows it (past-chats R57),
 * marked once the agent is gone (R59).
 */
export function sessionAgentLabel(agent: SessionAgent): string {
  return agent.deleted ? `${agent.name} · agent deleted` : agent.name;
}

/** The line under a session's name in the session list: its datasets (R63). */
export function sessionListSubtitle(session: Session): string {
  return session.datasets.join(' · ');
}

/**
 * The workflow's name as the page header chip and the Sessions list chip
 * show it (past-chats R57, R63), marked once its agent is gone (R59).
 */
export function sessionWorkflowLabel(ref: SessionWorkflowRef): string {
  return ref.deleted ? `${ref.name} · agent deleted` : ref.name;
}

/** The assistant's workflow name, for a session the backend sent no ref for. */
export const DEFAULT_SESSION_WORKFLOW = 'Assistant';

/**
 * The workflow chip of a session-list row (R63): the session's workflow,
 * `<name> · agent deleted` once its agent is gone (R59).
 */
export function sessionListWorkflow(session: Session): string {
  return session.workflowRef
    ? sessionWorkflowLabel(session.workflowRef)
    : DEFAULT_SESSION_WORKFLOW;
}

export interface SessionActionResult {
  ok: boolean;
  message: string;
  session?: Session;
  visualization?: InteractiveVisualization;
}
