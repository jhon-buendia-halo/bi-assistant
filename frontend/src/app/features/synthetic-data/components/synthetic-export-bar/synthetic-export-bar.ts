import {
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, ChevronDown, Loader2 } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  ExportFormat,
  SampledProfile,
} from '../../models/synthetic-data.model';
import { FORMAT_OPTIONS } from '../../models/synthetic-data.format';
import {
  DownloadError,
  DownloadedFile,
  SyntheticDataApiService,
  saveFile,
} from '../../services/synthetic-data-api.service';
import { Observable } from 'rxjs';

type Menu = 'profile' | 'sample' | null;

/** Export profile (1.22.5) and Export sample rows (1.22.6) on the profile view. */
@Component({
  selector: 'app-synthetic-export-bar',
  imports: [LucideAngularModule],
  templateUrl: './synthetic-export-bar.html',
})
export class SyntheticExportBar {
  readonly ChevronDown = ChevronDown;
  readonly Loader2 = Loader2;
  readonly profile = input.required<SampledProfile>();
  /** The profile is gone from the server cache (404). */
  readonly expired = output<void>();

  private readonly api = inject(SyntheticDataApiService);
  private readonly toast = inject(ToastService);

  readonly profileFormats: { value: 'csv' | 'xlsx'; label: string }[] = [
    { value: 'csv', label: 'CSV' },
    { value: 'xlsx', label: 'Excel' },
  ];
  readonly sampleFormats = FORMAT_OPTIONS;

  readonly menu = signal<Menu>(null);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  /** The format awaiting the real-data confirmation; null when the dialog is closed. */
  readonly confirming = signal<ExportFormat | null>(null);

  private readonly cancelButton =
    viewChild<ElementRef<HTMLButtonElement>>('cancelBtn');
  private readonly exportButton =
    viewChild<ElementRef<HTMLButtonElement>>('confirmBtn');
  private readonly sampleTrigger =
    viewChild<ElementRef<HTMLButtonElement>>('sampleTrigger');

  toggle(menu: Exclude<Menu, null>): void {
    this.menu.set(this.menu() === menu ? null : menu);
  }

  exportProfile(format: 'csv' | 'xlsx'): void {
    this.menu.set(null);
    this.run(
      this.api.exportProfile({ profileId: this.profile().profileId, format }),
    );
  }

  /** Opens the confirm dialog; nothing is sent yet. */
  askSample(format: ExportFormat): void {
    this.menu.set(null);
    this.confirming.set(format);
    // Cancel is the safe default focus: the export contains real rows.
    setTimeout(() => this.cancelButton()?.nativeElement.focus());
  }

  cancelSample(): void {
    this.confirming.set(null);
    setTimeout(() => this.sampleTrigger()?.nativeElement.focus());
  }

  confirmSample(): void {
    const format = this.confirming();
    if (format === null) return;
    this.confirming.set(null);
    this.run(
      this.api.exportSample({
        profileId: this.profile().profileId,
        format,
        confirmRealData: true,
      }),
    );
  }

  /** Keeps Tab inside the dialog and lets Escape cancel. */
  onDialogKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.cancelSample();
      return;
    }
    if (event.key !== 'Tab') return;
    const first = this.cancelButton()?.nativeElement;
    const last = this.exportButton()?.nativeElement;
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private run(call: Observable<DownloadedFile>): void {
    this.error.set(null);
    this.busy.set(true);
    call.subscribe({
      next: (file) => {
        this.busy.set(false);
        saveFile(file);
        this.toast.success(`Downloaded ${file.fileName}`);
      },
      error: (err: DownloadError) => {
        this.busy.set(false);
        if (err.status === 404) this.expired.emit();
        else this.error.set(err.message);
      },
    });
  }
}
