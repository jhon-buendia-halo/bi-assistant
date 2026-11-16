import {
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, Loader2 } from 'lucide-angular';
import { BackgroundTasksService } from '../../../../core/background-tasks/background-tasks.service';
import { DatasetTasksService } from '../../../datasets/services/dataset-tasks.service';
import { Dataset } from '../../../datasets/services/datasets-api.service';
import { SyntheticDataApiService } from '../../services/synthetic-data-api.service';
import {
  PROFILE_TABLES_MAX,
  SAMPLE_SIZE_MAX,
  SampledProfile,
} from '../../models/synthetic-data.model';
import { minutesLeft, relativeTime } from '../../models/synthetic-data.format';
import { SampledTableCard } from '../sampled-table-card/sampled-table-card';
import { SyntheticExportBar } from '../synthetic-export-bar/synthetic-export-bar';
import { SyntheticGenerateForm } from '../synthetic-generate-form/synthetic-generate-form';

/** The dataset editor's Profile & synthesize tab (M1-22, story 1.22.1). */
@Component({
  selector: 'app-synthetic-data-panel',
  imports: [
    LucideAngularModule,
    SampledTableCard,
    SyntheticExportBar,
    SyntheticGenerateForm,
  ],
  templateUrl: './synthetic-data-panel.html',
})
export class SyntheticDataPanel implements OnInit {
  readonly Loader2 = Loader2;
  readonly dataset = input.required<Dataset>();

  private readonly api = inject(SyntheticDataApiService);
  private readonly tasks = inject(BackgroundTasksService);
  private readonly datasetTasks = inject(DatasetTasksService);

  constructor() {
    // A profile that ends while this tab is shown appears at once. Leaving
    // the tab no longer aborts the request: it is a background task.
    this.tasks.finished$.pipe(takeUntilDestroyed()).subscribe((task) => {
      if (
        task.kind === 'synthetic-profile' &&
        task.key === this.dataset().name &&
        task.status === 'done'
      ) {
        this.showProfile(task.result as SampledProfile);
      }
    });
  }

  ngOnInit(): void {
    // Back on the tab after the profile ended: show it, unless it expired.
    const done = this.tasks
      .tasks()
      .find(
        (t) =>
          t.kind === 'synthetic-profile' &&
          t.key === this.dataset().name &&
          t.status === 'done',
      );
    const result = done?.result as SampledProfile | undefined;
    if (result && Date.parse(result.expiresAt) > Date.now()) {
      this.showProfile(result);
    }
  }

  private showProfile(profile: SampledProfile): void {
    this.profile.set(profile);
    this.shownAt.set(Date.now());
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

  /** The profile running for this dataset, read from the background task. */
  private readonly task = computed(() =>
    this.tasks.active('synthetic-profile', this.dataset().name),
  );
  readonly running = computed(() => !!this.task());
  /** The table count the task reports in its detail ("Sampling 3 tables"). */
  readonly runningCount = computed(() => {
    const n = /(\d+)/.exec(this.task()?.detail ?? '')?.[1];
    return n ? Number(n) : this.selected().length;
  });
  /** The newest profile run failed: its message, until the next run starts. */
  readonly error = computed<string | null>(() => {
    const last = this.tasks.latest('synthetic-profile', this.dataset().name);
    return last?.status === 'failed'
      ? (last.detail ?? 'Backend unreachable')
      : null;
  });
  readonly profile = signal<SampledProfile | null>(null);
  private readonly shownAt = signal(Date.now());
  /** A generate or export answered 404: the cached profile is gone. */
  readonly expired = signal(false);
  private readonly profileButton =
    viewChild<ElementRef<HTMLButtonElement>>('profileButton');

  markExpired(): void {
    this.expired.set(true);
    setTimeout(() => this.profileButton()?.nativeElement.focus());
  }

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
    const dataset = this.dataset();
    const name = dataset.name;
    this.expired.set(false);
    // A root task: leaving the tab does not stop the sampling or lose the
    // profile, and the service toasts the end (app-shell R58–R63).
    const task = this.tasks.start<SampledProfile>({
      kind: 'synthetic-profile',
      key: name,
      title: `Profiling "${name}"`,
      work: () =>
        this.api.profile({
          datasetName: name,
          tables,
          sampleSize: SAMPLE_SIZE_MAX,
        }),
      outcome: (profile) => ({
        ok: true,
        message: `Profile of "${name}" ready — ${profile?.tables.length ?? tables.length} ${profile?.tables.length === 1 ? 'table' : 'tables'} sampled`,
      }),
      open: () => this.datasetTasks.openDatasetTab(dataset, 'synthesize'),
    });
    this.tasks.update(task.id, {
      detail: `Sampling ${tables.length} ${tables.length === 1 ? 'table' : 'tables'}`,
    });
  }

  /** Stops the sampling: the task is dropped, which aborts the HTTP request. */
  cancel(): void {
    const task = this.task();
    if (task) this.tasks.cancel(task.id);
  }
}
