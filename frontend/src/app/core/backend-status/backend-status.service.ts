import { DestroyRef, Injectable, NgZone, inject, signal } from '@angular/core';
import { BackendStatus } from './backend-status.types';

/**
 * Mirrors the main process's backend supervisor status (see
 * frontend/electron/main.cjs) into a signal. In a plain browser (no preload
 * bridge — e.g. `ng serve` outside Electron) the backend is assumed to be
 * managed externally, so status stays 'ready' and the banner never shows.
 */
@Injectable({ providedIn: 'root' })
export class BackendStatusService {
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly bridge =
    typeof window === 'undefined' ? undefined : window.desktop;

  readonly status = signal<BackendStatus>('ready');

  constructor() {
    const unsubscribe = this.bridge?.onBackendStatus((event) => {
      this.zone.run(() => this.status.set(event.status));
    });
    if (unsubscribe) this.destroyRef.onDestroy(unsubscribe);
  }
}
