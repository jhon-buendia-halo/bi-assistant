export type BackendStatus = 'starting' | 'ready' | 'restarting' | 'down';

export interface BackendStatusEvent {
  status: BackendStatus;
}

export interface DesktopBridge {
  onBackendStatus(listener: (event: BackendStatusEvent) => void): () => void;
  restartBackend(): Promise<{ ok: boolean }>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
