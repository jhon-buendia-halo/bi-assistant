import { Injectable, inject, signal } from '@angular/core';
import { PERMISSION_DENIED_MESSAGE } from '../auth/auth.models';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';

export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const DEFAULT_DURATION_MS = 4000;
// Errors stay longer — the user may want to read the details.
const ERROR_DURATION_MS = 8000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly diagnostics = inject(DiagnosticsService);
  private seq = 0;
  readonly toasts = signal<Toast[]>([]);

  success(message: string): void {
    this.show('success', message, DEFAULT_DURATION_MS);
  }

  error(message: string): void {
    // A 403 is toasted by the HTTP interceptor and often again by the view
    // that made the call; the permission toast shows once (ui.md 1.6).
    if (
      message === PERMISSION_DENIED_MESSAGE &&
      this.toasts().some((t) => t.kind === 'error' && t.message === message)
    ) {
      return;
    }
    this.diagnostics.record('error', 'user-visible', message);
    this.show('error', message, ERROR_DURATION_MS);
  }

  info(message: string): void {
    this.show('info', message, DEFAULT_DURATION_MS);
  }

  dismiss(id: number): void {
    this.toasts.set(this.toasts().filter((t) => t.id !== id));
  }

  private show(kind: ToastKind, message: string, durationMs: number): void {
    const toast: Toast = { id: ++this.seq, kind, message };
    this.toasts.set([...this.toasts(), toast]);
    setTimeout(() => this.dismiss(toast.id), durationMs);
  }
}
