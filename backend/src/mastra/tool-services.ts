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

export interface SandboxToolServices {
  /** Create a visual for an answer in the project (latest answer if omitted). */
  createVisual(
    projectId: string,
    sourceMessageAt: string | undefined,
    instruction: string | undefined,
  ): Promise<VisualToolResult>;
  /** Produce a new version of an existing visual from a tailoring request. */
  updateVisual(
    projectId: string,
    visualId: string,
    instruction: string,
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
