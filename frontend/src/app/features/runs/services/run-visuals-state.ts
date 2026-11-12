import { Injectable, inject, signal } from '@angular/core';
import { ToastService } from '../../../core/toast/toast.service';
import {
  InteractiveVisualization,
  VisualEvent,
} from '../../sessions/models/session.model';
import { WorkflowRun } from '../../workflows/models/workflow.model';
import {
  RunVisualResult,
  WorkflowRunsApiService,
} from '../../workflows/services/workflow-runs-api.service';

/** Hands a run, as a visual action stored it, to the page showing it. */
export type ApplyRun = (run: WorkflowRun) => void;

/**
 * The visual actions of a run's result (visuals R2, R12-R24 on a run): the
 * Run tab and the run page both hold their run and call this, so a run
 * shows its visual the same way wherever it is open. The visual opens in
 * a section under the answer (`run-visual`).
 */
@Injectable({ providedIn: 'root' })
export class RunVisualsState {
  private readonly api = inject(WorkflowRunsApiService);
  private readonly toast = inject(ToastService);

  /** The run a visual is being generated for. */
  readonly generating = signal<string | null>(null);
  /** The visual open under the answer, with the run it belongs to. */
  readonly shown = signal<{
    runId: string;
    visualization: InteractiveVisualization;
  } | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** The id of the visual whose bundle is downloading. */
  readonly downloading = signal<string | null>(null);

  /** "Generate interactive visuals" on the run's answer (api.md 129). */
  generate(run: WorkflowRun, apply: ApplyRun): void {
    if (this.generating() !== null) return;
    this.generating.set(run.id);
    this.error.set(null);
    this.api.generateVisualization(run.id, run.answer?.at).subscribe({
      next: (result) => {
        this.generating.set(null);
        this.adopt(run.id, result, apply);
      },
      error: (err) => {
        this.generating.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /** The card's View: open that visual at the card's version (api.md 123). */
  view(run: WorkflowRun, event: VisualEvent): void {
    this.load(run.id, event.visualId, event.version);
  }

  /** A version picked from the visual's version menu: read-only view. */
  selectVersion(version: number): void {
    const open = this.shown();
    if (open) this.load(open.runId, open.visualization.id, version);
  }

  /** Make an earlier version current (api.md 131). */
  revert(version: number, apply: ApplyRun): void {
    const open = this.shown();
    if (!open) return;
    this.api
      .revertVisualization(open.runId, open.visualization.id, version)
      .subscribe({
        next: (result) => this.adopt(open.runId, result, apply),
        error: (err) =>
          this.toast.error(err?.error?.message ?? 'Backend unreachable'),
      });
  }

  /** The panel tailored, refreshed or repaired the open visual. */
  adopt(runId: string, result: RunVisualResult, apply: ApplyRun): void {
    if (!result.ok || !result.visualization) return;
    this.error.set(null);
    this.shown.set({ runId, visualization: result.visualization });
    if (result.run) apply(result.run);
  }

  /** Download the open visual's bundle (api.md 124). */
  download(visualization: InteractiveVisualization): void {
    const open = this.shown();
    if (!open || this.downloading()) return;
    this.downloading.set(visualization.id);
    this.api.downloadVisualization(open.runId, visualization.id).subscribe({
      next: (archive) => {
        this.downloading.set(null);
        const slug = visualization.title
          .normalize('NFKD')
          .replace(/[^a-zA-Z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .toLowerCase()
          .slice(0, 64);
        const url = URL.createObjectURL(archive);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${slug || `visual-${visualization.id.slice(0, 8)}`}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        this.toast.success('Visual bundle downloaded');
      },
      error: (err) => {
        this.downloading.set(null);
        this.toast.error(err?.error?.message ?? 'Bundle download failed');
      },
    });
  }

  /** Close the open visual. */
  close(): void {
    this.shown.set(null);
    this.error.set(null);
  }

  private load(runId: string, visualId: string, version?: number): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.getVisualization(runId, visualId, version).subscribe({
      next: (visualization) => {
        this.loading.set(false);
        this.shown.set({ runId, visualization });
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err?.error?.message ?? 'Could not load the visual');
      },
    });
  }
}
