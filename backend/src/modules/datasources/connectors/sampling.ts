import type { SampleMethod } from '../../synthetic-data/types';

export interface SampleOutcome {
  namespace: string; table: string;
  rowCountEstimate: number | null;
  method: SampleMethod;
  columns: string[];
  rows: Record<string, string | null>[];   // raw text values; never leaves the service
  durationMs: number;
  error?: string;
}
export interface RowSampler<TConfig> {
  sampleTable(config: TConfig, namespace: string, table: string,
              opts: { sampleSize: number; repeatableSeed: number /* 7 */ }): Promise<SampleOutcome>;
}
