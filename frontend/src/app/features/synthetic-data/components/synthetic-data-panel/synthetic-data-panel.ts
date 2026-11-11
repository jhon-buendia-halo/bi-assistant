import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { LucideAngularModule, Loader2 } from 'lucide-angular';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { SyntheticDataApiService } from '../../services/synthetic-data-api.service';
import {
  PROFILE_TABLES_MAX,
  SAMPLE_SIZE_MAX,
  SampledProfile,
} from '../../models/synthetic-data.model';
import { minutesLeft, relativeTime } from '../../models/synthetic-data.format';
import { SampledTableCard } from '../sampled-table-card/sampled-table-card';

/** The dataset editor's Profile & synthesize tab (M1-22, story 1.22.1). */
@Component({
  selector: 'app-synthetic-data-panel',
  imports: [LucideAngularModule, SampledTableCard],
  templateUrl: './synthetic-data-panel.html',
})
export class SyntheticDataPanel {
  readonly Loader2 = Loader2;
  readonly dataset = input.required<Dataset>();

  private readonly api = inject(SyntheticDataApiService);
  private subscription: Subscription | null = null;

  constructor() {
    // Leaving the tab aborts the request, so the backend stops sampling.
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
  }

  readonly tablesMax = PROFILE_TABLES_MAX;
  readonly supported = computed(() => this.dataset().datasourceKind !== 'rest');
  readonly allTables = computed(() => this.dataset().tables);
  /** Unchecked keys; every table starts checked. */
  private readonly unchecked = signal<ReadonlySet<string>>(new Set());
  readonly selected = computed(() =>
    this.allTables().filter((t) => !this.unchecked().has(t)),
  );
  readonly tooMany = computed(() => this.selected().length > this.tablesMax);

  readonly running = signal(false);
  readonly runningCount = signal(0);
  readonly error = signal<string | null>(null);
  readonly profile = signal<SampledProfile | null>(null);
  private readonly shownAt = signal(Date.now());

  readonly canProfile = computed(
    () => this.selected().length > 0 && !this.tooMany() && !this.running(),
  );

  readonly summary = computed(() => {
    const p = this.profile();
    if (!p) return '';
    const now = this.shownAt();
    return `${p.tables.length} ${p.tables.length === 1 ? 'table' : 'tables'} · sampled ${relativeTime(p.generatedAt, now)} · expires in ${minutesLeft(p.expiresAt, now)} min`;
  });

  isChecked(key: string): boolean {
    return !this.unchecked().has(key);
  }

  toggle(key: string): void {
    const next = new Set(this.unchecked());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.unchecked.set(next);
  }

  selectAll(): void {
    this.unchecked.set(new Set());
  }

  selectNone(): void {
    this.unchecked.set(new Set(this.allTables()));
  }

  runProfile(): void {
    if (!this.canProfile()) return;
    const tables = this.selected();
    this.error.set(null);
    this.running.set(true);
    this.runningCount.set(tables.length);
    this.subscription = this.api
      .profile({
        datasetName: this.dataset().name,
        tables,
        sampleSize: SAMPLE_SIZE_MAX,
      })
      .subscribe({
        next: (profile) => {
          this.profile.set(profile);
          this.shownAt.set(Date.now());
          this.running.set(false);
        },
        error: (err) => {
          this.error.set(err?.error?.message ?? 'Backend unreachable');
          this.running.set(false);
        },
      });
  }

  /** Aborts the in-flight HTTP request. */
  cancel(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.running.set(false);
  }
}
