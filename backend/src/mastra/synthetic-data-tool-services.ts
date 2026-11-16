// DI bridge for the Data Readiness Agent's synthetic-data tools (story 1.22.4,
// agents.md 3.14, ADR-0039), same pattern as readiness-tool-services.ts: the
// tools are built at module load with no Nest DI, so SessionsService installs
// the implementation at boot.

import type { SampledProfile } from '../modules/synthetic-data/types';

/** What `generate_synthetic_data` returns to the model (agents.md 3.14). */
export interface SyntheticScriptResult {
  fileName: string;
  /** Workspace-relative path: `synthetic-data/<fileName>`. */
  path: string;
  /** The stored `file` panel item; the orchestrator emits it as `panel-item`. */
  panelItemId: string;
  dialect: SampledProfile['dialect'];
  seed: number;
  targetSchema: string;
  bytes: number;
  tables: { table: string; rows: number }[];
  droppedRelationships: { from: string; to: string }[];
  notSynthesized: { table: string; column: string; reason: string }[];
}

/**
 * Every method resolves the dataset as agents.md 3.13 "Dataset resolution"
 * says and throws an Error whose message is the text the model should see;
 * the tools turn it into `{ error }`.
 */
export interface SyntheticDataToolServices {
  profileSample(input: {
    sessionId: string;
    datasetName?: string;
    /** Entity keys or bare table names; empty = every table of the dataset. */
    tables?: string[];
    signal?: AbortSignal;
  }): Promise<SampledProfile>;
  generateScript(input: {
    sessionId: string;
    datasetName?: string;
    tables?: string[];
    rowsPerTable?: number;
    seed?: number;
    targetSchema?: string;
    profileId?: string;
    signal?: AbortSignal;
  }): Promise<SyntheticScriptResult>;
}

let services: SyntheticDataToolServices | null = null;

export function setSyntheticDataToolServices(
  impl: SyntheticDataToolServices,
): void {
  services = impl;
}

export function getSyntheticDataToolServices(): SyntheticDataToolServices {
  if (!services) {
    throw new Error('Synthetic data tool services not installed yet');
  }
  return services;
}
