import { Component, OnInit, inject, output, signal } from '@angular/core';
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
import { Dataset, DatasetsApiService } from '../../services/datasets-api.service';
import { ToastService } from '../../../../core/toast/toast.service';

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

  readonly filters = ['All', 'Pinned', 'Yours', 'Shared with you'];
  readonly activeFilter = signal('All');
  readonly newDataset = output<void>();
  readonly openDataset = output<Dataset>();

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly sections = signal<DatasetSection[]>([]);
  /** Name of the dataset whose contextual menu is open. */
  readonly menuOpen = signal<string | null>(null);

  ngOnInit(): void {
    this.api.getDatasets().subscribe({
      next: (res) => {
        this.sections.set(groupByMonth(res.datasets));
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
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
