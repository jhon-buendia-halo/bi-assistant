import {
  Component,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  LucideAngularModule,
  EllipsisVertical,
  LayoutGrid,
  Loader2,
  Lock,
  Plus,
  Search,
  Trash2,
  Workflow,
} from 'lucide-angular';
import {
  Dataset,
  DatasetsApiService,
} from '../../services/datasets-api.service';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  BackgroundTask,
  formatElapsed,
} from '../../../../core/background-tasks/background-tasks.service';
import { DatasetTasksService } from '../../services/dataset-tasks.service';

interface DatasetSection {
  label: string;
  items: Dataset[];
}

@Component({
  selector: 'app-dataset-list',
  imports: [LucideAngularModule],
  templateUrl: './dataset-list.html',
  styleUrl: './dataset-list.scss',
})
export class DatasetList implements OnInit {
  readonly EllipsisVertical = EllipsisVertical;
  readonly LayoutGrid = LayoutGrid;
  readonly Loader2 = Loader2;
  readonly Lock = Lock;
  readonly Plus = Plus;
  readonly Search = Search;
  readonly Trash2 = Trash2;
  readonly Workflow = Workflow;

  private readonly api = inject(DatasetsApiService);
  private readonly toast = inject(ToastService);
  private readonly datasetTasks = inject(DatasetTasksService);
  private readonly tasks = this.datasetTasks.tasks;
  readonly filters = ['All', 'Pinned'];
  readonly activeFilter = signal('All');
  readonly newDataset = output<void>();
  readonly openDataset = output<Dataset>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly sections = signal<DatasetSection[]>([]);
  /** Name of the dataset whose contextual menu is open. */
  readonly menuOpen = signal<string | null>(null);

  /** The list is being re-read after a save ended. */
  private readonly reloading = signal(false);
  private readonly names = computed(
    () => new Set(this.sections().flatMap((s) => s.items.map((i) => i.name))),
  );

  /** Names of the saved datasets being saved again: their row shows the chip. */
  readonly resaving = computed(
    () =>
      new Set(
        this.tasks
          .running()
          .filter((t) => t.kind === 'dataset-save' && this.names().has(t.key))
          .map((t) => t.key),
      ),
  );

  /**
   * Saves of a name not in the list yet: still running, or just ended and the
   * list is being re-read (so the row does not blink out in between).
   */
  readonly pending = computed(() =>
    this.tasks
      .tasks()
      .filter(
        (t) =>
          t.kind === 'dataset-save' &&
          !this.names().has(t.key) &&
          (t.status === 'running' || (t.status === 'done' && this.reloading())),
      ),
  );

  /** Saves that failed, newest per name: error text with Retry / Dismiss. */
  readonly failed = computed(() =>
    this.tasks
      .finished()
      .filter(
        (t) =>
          t.kind === 'dataset-save' &&
          t.status === 'failed' &&
          this.tasks.latest('dataset-save', t.key)?.id === t.id,
      ),
  );

  constructor() {
    this.tasks.finished$.pipe(takeUntilDestroyed()).subscribe((task) => {
      if (task.kind === 'dataset-save') this.reload(true);
    });
  }

  ngOnInit(): void {
    this.reload(false);
  }

  private reload(quiet: boolean): void {
    if (quiet) this.reloading.set(true);
    this.api.getDatasets().subscribe({
      next: (res) => {
        this.sections.set(groupByMonth(res.datasets));
        this.loading.set(false);
        this.reloading.set(false);
      },
      error: (err) => {
        if (!quiet)
          this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
        this.reloading.set(false);
      },
    });
  }

  /** `Saving… 0:12` for a save in flight. */
  savingChip(task: BackgroundTask): string {
    const end = task.finishedAt ?? this.tasks.now();
    return `Saving… ${formatElapsed(end - task.startedAt)}`;
  }

  resavingChip(name: string): string {
    const task = this.tasks.active('dataset-save', name);
    return task ? this.savingChip(task) : 'Saving…';
  }

  pendingInfo(name: string): string {
    const info = this.datasetTasks.pendingInfo().get(name);
    if (!info) return '';
    return `${info.datasourceName} · ${info.entityCount} entities`;
  }

  retry(id: number): void {
    this.tasks.retry(id);
  }

  dismiss(id: number): void {
    this.tasks.dismiss(id);
  }

  toggleMenu(name: string): void {
    this.menuOpen.set(this.menuOpen() === name ? null : name);
  }

  deleteDataset(dataset: Dataset): void {
    this.menuOpen.set(null);
    this.api.deleteDataset(dataset.name).subscribe({
      next: (res) => {
        if (res.ok) {
          this.toast.success(res.message);
          this.sections.set(
            this.sections()
              .map((s) => ({
                ...s,
                items: s.items.filter((i) => i.name !== dataset.name),
              }))
              .filter((s) => s.items.length > 0),
          );
        } else {
          this.toast.error(res.message);
        }
      },
      error: (err) => {
        this.toast.error(err?.error?.message ?? 'Backend unreachable');
      },
    });
  }

  editedLabel(dataset: Dataset): string {
    const date = dataset.updatedAt ? new Date(dataset.updatedAt) : null;
    const when = date
      ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : '';
    const datasource =
      dataset.datasourceKind === 'postgres'
        ? 'PostgreSQL · '
        : dataset.datasourceKind === 'databricks'
          ? 'Databricks · '
          : '';
    return `Edited ${when} · ${datasource}${dataset.tables.length} entities`;
  }
}

/** Group datasets (already newest-first) into month sections. */
function groupByMonth(datasets: Dataset[]): DatasetSection[] {
  const sections: DatasetSection[] = [];
  for (const dataset of datasets) {
    const date = dataset.updatedAt ? new Date(dataset.updatedAt) : null;
    const label = date
      ? date.toLocaleDateString('en-US', { month: 'long', year: undefined })
      : 'Earlier';
    const last = sections[sections.length - 1];
    if (last && last.label === label) last.items.push(dataset);
    else sections.push({ label, items: [dataset] });
  }
  return sections;
}
