// DI bridge for Mastra tools, same pattern as model-resolver: tools are
// constructed at module load with no Nest DI, so ProjectsService installs the
// real implementations at boot.

/** Column snapshot as stored on a sandbox (mirrors `SandboxEntitySnapshot`). */
export interface SandboxColumnSnapshot {
  name: string;
  type: string;
  nullable: boolean;
  /** Real values observed at save time — schema linking / value matching. */
  sampleValues?: string[];
  description?: string;
}

export interface SandboxSnapshot {
  name: string;
  datasourceId?: string;
  datasourceKind?: 'databricks' | 'postgres';
  tables: string[];
  entities?: {
    key: string;
    columns: SandboxColumnSnapshot[];
  }[];
}

/** A SQL run, plus what the repair loop had to do to make it succeed. */
export interface SqlRunResult {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Present when the original statement failed and was auto-corrected. */
  correctedSql?: string;
  /** The run filled its row limit — the result set is probably incomplete. */
  truncated?: boolean;
  /**
   * Guidance for the agent (repair happened, zero rows came back, or the row
   * limit was reached).
   */
  note?: string;
}

export interface VisualToolResult {
  visualId: string;
  version: number;
  title: string;
  description: string;
}

/**
 * Mirrors `ToolDataRecord` (backend/src/modules/projects/entities) without
 * importing it — same pattern as `SandboxSnapshot`/`SqlRunResult`: this file
 * has no Nest DI and must stay decoupled from feature-module types.
 */
export interface SandboxToolTurnRecord {
  tool: string;
  input?: string;
  columns?: string[];
  rows?: Record<string, unknown>[];
  rowCount?: number;
  truncated?: boolean;
  error?: string;
  rationale?: string;
}

export interface SandboxToolServices {
  /**
   * Create a visual for an answer in the project (latest answer if omitted).
   * `turnRecords`, when present, are the SQL/rows the current chat turn has
   * captured so far — appended to the visual's data alongside the source
   * answer's own records.
   */
  createVisual(
    projectId: string,
    sourceMessageAt: string | undefined,
    instruction: string | undefined,
    turnRecords?: SandboxToolTurnRecord[],
  ): Promise<VisualToolResult>;
  /**
   * Produce a new version of an existing visual from a tailoring request.
   * `turnRecords` are merged onto the visual's stored data the same way as
   * `createVisual`.
   */
  updateVisual(
    projectId: string,
    visualId: string,
    instruction: string,
    turnRecords?: SandboxToolTurnRecord[],
  ): Promise<VisualToolResult>;
  getSandboxes(names: string[]): Promise<SandboxSnapshot[]>;
  sampleRows(
    datasourceId: string,
    entity: string,
    limit: number,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  /**
   * Runs the statement and repairs it on execution errors — `sandboxes` names
   * the sandboxes whose schema the fixer may draw on.
   */
  runReadOnlySql(
    datasourceId: string,
    sql: string,
    limit: number,
    sandboxes: string[],
  ): Promise<SqlRunResult>;
}

let services: SandboxToolServices | null = null;

export function setSandboxToolServices(impl: SandboxToolServices): void {
  services = impl;
}

export function getSandboxToolServices(): SandboxToolServices {
  if (!services) {
    throw new Error('Sandbox tool services not installed yet');
  }
  return services;
}
