import { Component, inject, input, output, signal } from '@angular/core';
import {
  File as FileIcon,
  LucideAngularModule,
  Loader2,
  Table2,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { SheetImport, SourceFile } from '../../models/datasource.model';
import { FILE_SOURCES_API } from '../../services/file-sources-api';
import { SheetReviewDialog } from '../sheet-review-dialog/sheet-review-dialog';
import { isProblem, warningLabel } from './sheet-warnings';

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Drop zone, one card per file and one row per sheet of an Excel / CSV datasource. */
@Component({
  selector: 'app-file-sources',
  imports: [LucideAngularModule, SheetReviewDialog],
  templateUrl: './file-sources.html',
})
export class FileSources {
  readonly FileIcon = FileIcon;
  readonly Loader2 = Loader2;
  readonly Table2 = Table2;
  readonly Trash2 = Trash2;
  readonly TriangleAlert = TriangleAlert;
  readonly Upload = Upload;
  readonly formatSize = formatSize;

  readonly files = input.required<SourceFile[]>();
  readonly filesChange = output<SourceFile[]>();

  private readonly api = inject(FILE_SOURCES_API);
  private readonly toast = inject(ToastService);

  readonly dragging = signal(false);
  readonly uploading = signal(0);
  readonly reviewing = signal<{
    fileId: string;
    sheet: string;
    trigger: HTMLElement | null;
  } | null>(null);
  private replaceId: string | null = null;

  reviewedFile(): SourceFile | null {
    const r = this.reviewing();
    return (r && this.files().find((f) => f.id === r.fileId)) || null;
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    void this.addFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.addFiles(Array.from(input.files ?? []));
    input.value = '';
  }

  onPickReplacement(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const id = this.replaceId;
    input.value = '';
    this.replaceId = null;
    if (file && id) void this.replace(id, file);
  }

  startReplace(id: string, input: HTMLInputElement): void {
    this.replaceId = id;
    input.click();
  }

  private async addFiles(picked: File[]): Promise<void> {
    let list = this.files();
    for (const f of picked) {
      this.uploading.update((n) => n + 1);
      try {
        const { file } = await this.api.upload(f);
        list = [...list, file];
        this.filesChange.emit(list);
      } catch (e) {
        this.toast.error(
          `${f.name}: ${e instanceof Error ? e.message : 'Upload failed'}`,
        );
      } finally {
        this.uploading.update((n) => n - 1);
      }
    }
  }

  /** The new upload takes the old file's id; sheets with the same name keep their table key. */
  private async replace(id: string, picked: File): Promise<void> {
    const old = this.files().find((f) => f.id === id);
    if (!old) return;
    this.uploading.update((n) => n + 1);
    try {
      const { file } = await this.api.upload(picked);
      const sheets = file.sheets.map((s) => {
        const before = old.sheets.find((o) => o.sheet === s.sheet);
        return before ? { ...s, table: before.table } : s;
      });
      if (old.uploadId) void this.api.discard(old.uploadId).catch(() => undefined);
      this.filesChange.emit(
        this.files().map((f) =>
          f.id === id ? { ...file, id, schema: old.schema, sheets } : f,
        ),
      );
    } catch (e) {
      this.toast.error(
        `${picked.name}: ${e instanceof Error ? e.message : 'Upload failed'}`,
      );
    } finally {
      this.uploading.update((n) => n - 1);
    }
  }

  remove(file: SourceFile): void {
    if (file.uploadId) void this.api.discard(file.uploadId).catch(() => undefined);
    this.filesChange.emit(this.files().filter((f) => f.id !== file.id));
  }

  toggleInclude(file: SourceFile, sheet: SheetImport, include: boolean): void {
    this.update({
      ...file,
      sheets: file.sheets.map((s) =>
        s.sheet === sheet.sheet ? { ...s, include } : s,
      ),
    });
  }

  review(file: SourceFile, sheet: SheetImport, event: Event): void {
    this.reviewing.set({
      fileId: file.id,
      sheet: sheet.sheet,
      trigger: event.currentTarget as HTMLElement,
    });
  }

  onApplied(updated: SourceFile): void {
    this.update(updated);
    this.reviewing.set(null);
  }

  private update(updated: SourceFile): void {
    this.filesChange.emit(
      this.files().map((f) => (f.id === updated.id ? updated : f)),
    );
  }

  skipped(sheet: SheetImport): boolean {
    return !!sheet.warnings?.some((w) => w.code === 'no-table');
  }

  problems(sheet: SheetImport): string[] {
    return (sheet.warnings ?? [])
      .filter(isProblem)
      .filter((w) => w.code !== 'no-table')
      .map((w) => warningLabel(w));
  }

  /** `12,480 rows · 8 columns · Header row 3 · A3:H12482` */
  meta(sheet: SheetImport): string {
    if (this.skipped(sheet)) return 'No table found';
    const parts: string[] = [];
    if (sheet.rowCount !== undefined) {
      parts.push(`${sheet.rowCount.toLocaleString('en-US')} rows`);
    }
    const cols = columnCount(sheet.range);
    if (cols) parts.push(`${cols} columns`);
    parts.push(`Header row ${sheet.headerRow}`);
    parts.push(sheet.range);
    return parts.join(' · ');
  }
}

function columnCount(range: string): number {
  const m = /^([A-Za-z]+)\d+:([A-Za-z]+)\d+$/.exec(range.trim());
  if (!m) return 0;
  const n = (s: string) =>
    [...s.toUpperCase()].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
  return n(m[2]) - n(m[1]) + 1;
}
