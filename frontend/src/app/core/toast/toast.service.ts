import { Injectable, inject, signal } from '@angular/core';
import { DiagnosticsService } from '../diagnostics/diagnostics.service';

export type ToastKind = 'success' | 'error' | 'info';

/** A button in the toast (Open, Retry); clicking it also dismisses the toast. */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
}

const DEFAULT_DURATION_MS = 4000;
// Errors stay longer — the user may want to read the details.
const ERROR_DURATION_MS = 8000;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly diagnostics = inject(DiagnosticsService);
  private seq = 0;
  readonly toasts = signal<Toast[]>([]);

  success(message: string, action?: ToastAction): void {
    this.show('success', message, DEFAULT_DURATION_MS, action);
  }

  error(message: string, action?: ToastAction): void {
    this.diagnostics.record('error', 'user-visible', message);
    this.show('error', message, ERROR_DURATION_MS, action);
  }

  info(message: string): void {
    this.show('info', message, DEFAULT_DURATION_MS);
  }

  dismiss(id: number): void {
    this.toasts.set(this.toasts().filter((t) => t.id !== id));
  }

  /** Runs a toast's action, then dismisses the toast. */
  runAction(toast: Toast): void {
    this.dismiss(toast.id);
    toast.action?.run();
  }

  private show(
    kind: ToastKind,
    message: string,
    durationMs: number,
    action?: ToastAction,
  ): void {
    const toast: Toast = action
      ? { id: ++this.seq, kind, message, action }
      : { id: ++this.seq, kind, message };
    this.toasts.set([...this.toasts(), toast]);
    setTimeout(() => this.dismiss(toast.id), durationMs);
  }
}
