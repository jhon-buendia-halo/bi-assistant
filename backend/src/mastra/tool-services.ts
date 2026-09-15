// DI bridge for Mastra tools, same pattern as model-resolver: tools are
// constructed at module load with no Nest DI, so ProjectsService installs the
// real implementations at boot.

export interface SandboxSnapshot {
  name: string;
  datasourceId?: string;
  datasourceKind?: 'databricks' | 'postgres';
  tables: string[];
  entities?: {
    key: string;
    columns: { name: string; type: string; nullable: boolean }[];
  }[];
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
  runReadOnlySql(
    datasourceId: string,
    sql: string,
    limit: number,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
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
