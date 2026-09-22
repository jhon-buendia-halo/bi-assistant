export type BackendStatus = 'starting' | 'ready' | 'restarting' | 'down';

export interface BackendStatusEvent {
  status: BackendStatus;
}

export interface DesktopBridge {
  onBackendStatus(listener: (event: BackendStatusEvent) => void): () => void;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}
