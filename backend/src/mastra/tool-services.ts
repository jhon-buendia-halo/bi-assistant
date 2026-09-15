// DI bridge for Mastra tools, same pattern as model-resolver: tools are
// constructed at module load with no Nest DI, so ProjectsService installs the
// real implementations at boot.

export interface SandboxSnapshot {
  name: string;
  tables: string[];
  entities?: {
    key: string;
    columns: { name: string; type: string; nullable: boolean }[];
  }[];
}

export interface SandboxToolServices {
  getSandboxes(names: string[]): Promise<SandboxSnapshot[]>;
  sampleRows(
    entity: string,
    limit: number,
  ): Promise<{ columns: string[]; rows: Record<string, unknown>[] }>;
  runReadOnlySql(
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
