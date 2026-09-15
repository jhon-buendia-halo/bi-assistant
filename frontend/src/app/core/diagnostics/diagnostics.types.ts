export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DiagnosticEntry {
  id: string;
  timestamp: string;
  level: DiagnosticLevel;
  source: string;
  message: string;
  details?: unknown;
}

export interface DiagnosticExportResult {
  ok: boolean;
  canceled: boolean;
  path?: string;
  count?: number;
}

export interface SystemDiagnosticsBridge {
  list(): Promise<DiagnosticEntry[]>;
  record(entry: Omit<DiagnosticEntry, 'id' | 'timestamp'>): void;
  exportForLlm(): Promise<DiagnosticExportResult>;
  subscribe(listener: (entry: DiagnosticEntry) => void): () => void;
}

declare global {
  interface Window {
    systemDiagnostics?: SystemDiagnosticsBridge;
  }
}
