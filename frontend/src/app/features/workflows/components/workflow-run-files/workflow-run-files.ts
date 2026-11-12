import { Component, inject, input, signal } from '@angular/core';
import { Download, FileText, LucideAngularModule } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { FilePanelItem } from '../../../sessions/models/session.model';
import { saveFile } from '../../../synthetic-data/services/synthetic-data-api.service';
import { WorkflowRunsApiService } from '../../services/workflow-runs-api.service';

/** The name a file item downloads as: the last segment of its path. */
export function runFileName(item: FilePanelItem): string {
  return item.path.split('/').pop() || 'file.txt';
}

/** `2048` -> `2 KB`; under 1 KB in bytes. */
export function runFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, bytes || 0)} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * The files a run saved in its workspace (a Data Readiness run's synthetic
 * SQL scripts, synthetic-data R43), listed under the run's answer, each
 * downloaded through the run's route (api.md 126).
 */
@Component({
  selector: 'app-workflow-run-files',
  imports: [LucideAngularModule],
  host: { class: 'block' },
  template: `
    <section class="flex flex-col gap-1.5" data-testid="workflow-run-files" aria-labelledby="workflow-run-files-heading">
      <h3 id="workflow-run-files-heading" class="m-0 text-[12px] font-medium text-fg-muted">Files</h3>
      <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
        @for (item of items(); track item.id) {
          <li class="flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2">
            <lucide-angular [img]="FileText" [size]="14" class="shrink-0 text-fg-muted" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-[13px] text-fg-strong">{{ item.title }}</span>
              <span class="truncate text-[12px] text-fg-muted"
                >{{ fileName(item) }} · {{ fileSize(item.bytes) }}</span
              >
            </span>
            <button
              type="button"
              class="btn btn-ghost btn-icon shrink-0"
              [attr.aria-label]="'Download ' + fileName(item)"
              title="Download file"
              [disabled]="downloading() !== null"
              (click)="download(item)"
            >
              <lucide-angular [img]="Download" [size]="14" />
            </button>
          </li>
        }
      </ul>
    </section>
  `,
})
export class WorkflowRunFiles {
  protected readonly Download = Download;
  protected readonly FileText = FileText;

  private readonly api = inject(WorkflowRunsApiService);
  private readonly toast = inject(ToastService);

  readonly runId = input.required<string>();
  readonly items = input.required<FilePanelItem[]>();

  /** The item being downloaded right now. */
  protected readonly downloading = signal<string | null>(null);

  protected readonly fileName = runFileName;
  protected readonly fileSize = runFileSize;

  protected download(item: FilePanelItem): void {
    if (this.downloading() !== null) return;
    const fileName = runFileName(item);
    this.downloading.set(item.id);
    this.api.downloadPanelItem(this.runId(), item.id).subscribe({
      next: (blob) => {
        this.downloading.set(null);
        saveFile({ blob, fileName });
        this.toast.success(`Downloaded ${fileName}`);
      },
      error: () => {
        this.downloading.set(null);
        this.toast.error('Download failed');
      },
    });
  }
}
