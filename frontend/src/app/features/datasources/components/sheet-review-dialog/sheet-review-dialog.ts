import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Loader2, TriangleAlert } from 'lucide-angular';
import {
  SheetImport,
  SheetPreview,
  SourceFile,
} from '../../models/datasource.model';
import { FILE_SOURCES_API } from '../../services/file-sources-api';
import { excludedRows } from '../../services/mock-file-sources-api';
import { isProblem, warningLabel } from '../file-sources/sheet-warnings';

const HEADER_ROW_CHOICES = Array.from({ length: 20 }, (_, i) => i + 1);

/** Wide dialog to review one file's sheets: header row, range, exclusions and a grid (wireframe B). */
@Component({
  selector: 'app-sheet-review-dialog',
  imports: [LucideAngularModule],
  templateUrl: './sheet-review-dialog.html',
})
export class SheetReviewDialog implements OnInit, OnDestroy {
  readonly Loader2 = Loader2;
  readonly TriangleAlert = TriangleAlert;
  readonly headerChoices = HEADER_ROW_CHOICES;

  readonly file = input.required<SourceFile>();
  /** The sheet to show first. */
  readonly initialSheet = input<string>();
  /** The element to focus when the dialog closes (the Review button). */
  readonly returnFocusTo = input<HTMLElement | null>(null);
  readonly applied = output<SourceFile>();
  readonly closed = output<void>();

  private readonly api = inject(FILE_SOURCES_API);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly opener = document.activeElement as HTMLElement | null;
  private previewSeq = 0;

  /** The edits, applied to the file only on Apply. */
  readonly draft = signal<SheetImport[]>([]);
  readonly selected = signal('');
  readonly preview = signal<SheetPreview | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly sheet = computed(
    () => this.draft().find((s) => s.sheet === this.selected()) ?? null,
  );
  readonly tableKey = computed(
    () => `file.${this.file().schema}.${this.sheet()?.table ?? ''}`,
  );
  readonly shownRows = computed(() => this.preview()?.rows.map((r) => r.row) ?? []);
  readonly excluded = computed(() => {
    const p = this.preview();
    const s = this.sheet();
    if (!p || !s) return new Set<number>();
    return excludedRows(
      this.shownRows(),
      s.headerRow,
      s.range,
      s.excludeLastRow,
    );
  });
  /** Row number after which the grid skips rows (shown as an ellipsis row). */
  readonly gapAfter = computed(() => {
    const rows = this.shownRows();
    for (let i = 1; i < rows.length; i++) {
      if (rows[i] - rows[i - 1] > 1) return rows[i - 1];
    }
    return null;
  });
  readonly warnings = computed(() => {
    const s = this.sheet();
    return (this.preview()?.warnings ?? s?.warnings ?? []).map((w) => ({
      label: warningLabel(w, s?.excludeLastRow ?? false),
      problem: isProblem(w),
    }));
  });

  ngOnInit(): void {
    const sheets = this.file().sheets.map((s) => ({ ...s }));
    this.draft.set(sheets);
    const first =
      sheets.find((s) => s.sheet === this.initialSheet()) ??
      sheets.find((s) => s.include) ??
      sheets[0];
    if (first) this.select(first.sheet);
    queueMicrotask(() => this.panel()?.nativeElement.focus());
  }

  ngOnDestroy(): void {
    (this.returnFocusTo() ?? this.opener)?.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.cancel();
  }

  select(sheet: string): void {
    this.selected.set(sheet);
    void this.loadPreview();
  }

  patch(patch: Partial<SheetImport>): void {
    const name = this.selected();
    this.draft.update((all) =>
      all.map((s) => (s.sheet === name ? { ...s, ...patch } : s)),
    );
    void this.loadPreview();
  }

  setHeaderRow(row: number): void {
    const s = this.sheet();
    if (!s || !Number.isFinite(row) || row < 1) return;
    // The range starts at the header row: keep its letters, move its row.
    const range = s.range.replace(/^([A-Za-z]+)\d+/, `$1${row}`);
    this.patch({ headerRow: row, range });
  }

  setInclude(sheet: string, include: boolean): void {
    this.draft.update((all) =>
      all.map((s) => (s.sheet === sheet ? { ...s, include } : s)),
    );
  }

  private async loadPreview(): Promise<void> {
    const s = this.sheet();
    if (!s) return;
    const seq = ++this.previewSeq;
    this.loading.set(true);
    this.error.set(null);
    try {
      const preview = await this.api.preview({
        uploadId: this.file().uploadId,
        fileId: this.file().id,
        sheet: s.sheet,
        headerRow: s.headerRow,
        range: s.range,
        excludeLastRow: s.excludeLastRow,
        allText: s.allText,
      });
      if (seq !== this.previewSeq) return;
      this.preview.set(preview);
    } catch (e) {
      if (seq !== this.previewSeq) return;
      this.error.set(e instanceof Error ? e.message : 'Could not read the sheet');
    } finally {
      if (seq === this.previewSeq) this.loading.set(false);
    }
  }

  apply(): void {
    this.applied.emit({ ...this.file(), sheets: this.draft() });
  }

  cancel(): void {
    this.closed.emit();
  }

  cellText(v: string | number | boolean | null): string {
    return v === null ? '' : String(v);
  }

  isNumeric(type: string): boolean {
    return type === 'integer' || type === 'decimal';
  }

  total(): string {
    return (this.preview()?.totalRows ?? 0).toLocaleString('en-US');
  }
}
