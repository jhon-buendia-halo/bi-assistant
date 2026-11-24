import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Download, FileText, LucideAngularModule } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { saveBlob } from '../../../../shared/query-evidence/rows-csv';
import {
  ConversationExportFile,
  ConversationExportRef,
} from '../../models/conversation-export.model';
import { ConversationExportApiService } from '../../services/conversation-export-api.service';

/** `1.6 MB` / `820 KB` / `512 B`. */
export function exportSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function plural(n: number, one: string): string {
  return `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;
}

/**
 * The export an answer made (conversation-export): its title, one line and
 * one Download button per file (PDF, PowerPoint). The button saves the file
 * the way the dashboard card saves its zip.
 */
@Component({
  selector: 'app-run-export-card',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="card flex flex-col gap-1.5 p-3"
      data-testid="run-export-card"
      [attr.aria-label]="'Export: ' + export().title"
    >
      <div class="flex items-center gap-1.5">
        <lucide-angular [img]="FileText" [size]="16" class="text-fg-muted" />
        <h3
          class="m-0 truncate text-[15px] leading-6 font-semibold text-fg-strong"
          data-testid="run-export-title"
          [title]="export().title"
        >
          {{ export().title }}
        </h3>
      </div>
      <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
        @for (line of lines(); track line.file.format) {
          <li
            class="text-[12px] text-fg-muted"
            [attr.data-testid]="'run-export-line-' + line.file.format"
          >
            {{ line.text }}
          </li>
        }
      </ul>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        @for (line of lines(); track line.file.format) {
          <button
            type="button"
            class="btn btn-secondary"
            [attr.data-testid]="'run-export-download-' + line.file.format"
            [disabled]="downloading() !== null"
            (click)="download(line.file)"
          >
            <lucide-angular [img]="Download" [size]="14" />
            <span>Download {{ line.label }}</span>
          </button>
        }
      </div>
    </article>
  `,
})
export class RunExportCard {
  protected readonly Download = Download;
  protected readonly FileText = FileText;

  private readonly api = inject(ConversationExportApiService);
  private readonly toast = inject(ToastService);

  readonly export = input.required<ConversationExportRef>();

  protected readonly downloading = signal<string | null>(null);

  protected readonly lines = computed(() =>
    this.export().files.map((file) => {
      const label = file.format === 'pdf' ? 'PDF' : 'PowerPoint';
      const count =
        file.format === 'pdf'
          ? file.pages !== undefined
            ? plural(file.pages, 'page')
            : null
          : file.slides !== undefined
            ? plural(file.slides, 'slide')
            : null;
      const text = [label, count, exportSize(file.bytes)]
        .filter((p) => p !== null)
        .join(' · ');
      return { file, label, text };
    }),
  );

  protected download(file: ConversationExportFile): void {
    if (this.downloading() !== null) return;
    this.downloading.set(file.format);
    this.api.download(this.export().id, file.format).subscribe({
      next: (blob) => {
        this.downloading.set(null);
        saveBlob(blob, file.fileName);
      },
      error: (err) => {
        this.downloading.set(null);
        this.toast.error(err?.error?.message ?? 'Could not download');
      },
    });
  }
}
