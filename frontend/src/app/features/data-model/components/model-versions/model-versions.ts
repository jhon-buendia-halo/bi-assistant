import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, GitCompare, History, Loader2 } from 'lucide-angular';
import { DataModelApiService } from '../../services/data-model-api.service';
import { DataModelVersion } from '../../models/data-model.model';
import { DiffLine, lineDiff } from '../../../../shared/utils/line-diff';
import { ToastService } from '../../../../core/toast/toast.service';

/**
 * Version history (brief §2, `model-versions`): newest first, current
 * marked, revert on any other version, and a two-version line diff
 * (`shared/utils/line-diff.ts`) rendered unified (removed/added lines
 * coloured) rather than side-by-side — simpler to scan for the short,
 * mostly single-field edits this DSL's YAML tends to produce.
 */
@Component({
  selector: 'app-model-versions',
  imports: [LucideAngularModule],
  templateUrl: './model-versions.html',
  styleUrl: './model-versions.scss',
})
export class ModelVersions {
  readonly GitCompare = GitCompare;
  readonly History = History;
  readonly Loader2 = Loader2;

  private readonly api = inject(DataModelApiService);
  private readonly toast = inject(ToastService);

  readonly datasetName = input.required<string>();
  readonly versions = input.required<DataModelVersion[]>();
  readonly currentVersion = input.required<number>();
  readonly reverted = output<number>();

  readonly reverting = signal<number | null>(null);

  readonly sortedVersions = computed(() =>
    [...this.versions()].sort((a, b) => b.version - a.version),
  );

  /** Diff selection — two version numbers, or null until the user picks. */
  readonly compareFrom = signal<number | null>(null);
  readonly compareTo = signal<number | null>(null);

  readonly diff = computed<DiffLine[] | null>(() => {
    const from = this.findVersion(this.compareFrom());
    const to = this.findVersion(this.compareTo());
    if (!from || !to) return null;
    return lineDiff(from.yaml, to.yaml);
  });

  private findVersion(version: number | null): DataModelVersion | undefined {
    if (version === null) return undefined;
    return this.versions().find((v) => v.version === version);
  }

  startCompare(version: number): void {
    const from = this.compareFrom();
    if (from === null || this.compareTo() !== null) {
      this.compareFrom.set(version);
      this.compareTo.set(null);
      return;
    }
    if (version === from) return;
    // Keep chronological order (older -> newer) regardless of click order.
    this.compareFrom.set(Math.min(from, version));
    this.compareTo.set(Math.max(from, version));
  }

  clearCompare(): void {
    this.compareFrom.set(null);
    this.compareTo.set(null);
  }

  isCompareSelected(version: number): boolean {
    return this.compareFrom() === version || this.compareTo() === version;
  }

  revert(version: number): void {
    if (this.reverting() !== null) return;
    this.reverting.set(version);
    this.api.revert(this.datasetName(), version).subscribe({
      next: (res) => {
        this.reverting.set(null);
        if (!res.ok || res.currentVersion === undefined) {
          this.toast.error('Revert failed');
          return;
        }
        this.toast.success(`Reverted to version ${res.currentVersion}`);
        this.reverted.emit(res.currentVersion);
      },
      error: (err) => {
        this.reverting.set(null);
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  /** Absolute local timestamp — named for what it actually renders (review
   * finding 12: the previous `relativeTime` name promised "2 min ago"-style
   * text this never produced). */
  formattedTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString();
  }
}
