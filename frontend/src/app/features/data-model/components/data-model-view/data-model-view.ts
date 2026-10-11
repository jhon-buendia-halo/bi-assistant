import {
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  LucideAngularModule,
  ArrowLeft,
  ChevronRight,
  Download,
  FileWarning,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-angular';
import {
  DataModelApiService,
  slugifyDatasetName,
} from '../../services/data-model-api.service';
import {
  DataModel,
  DataModelVersion,
  DriftResponse,
  MetricsImportReport,
  ModelResponse,
} from '../../models/data-model.model';
import { ModelYamlEditor } from '../model-yaml-editor/model-yaml-editor';
import { ModelVersions } from '../model-versions/model-versions';
import { EntityEditor } from '../entity-editor/entity-editor';
import { ModelMetricsPanel } from '../model-metrics-panel/model-metrics-panel';
import { ToastService } from '../../../../core/toast/toast.service';
import { AuthService } from '../../../../core/auth/auth.service';

type DataModelTab = 'overview' | 'entity' | 'yaml' | 'versions' | 'metrics';

/** The tab strip (ui.md 4.19.2); `entity` opens from an Overview row only. */
const TABS: { id: Exclude<DataModelTab, 'entity'>; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'yaml', label: 'YAML' },
  { id: 'versions', label: 'Versions' },
  { id: 'metrics', label: 'Metrics' },
];

/** `1 metric skipped on import` / `<n> metrics skipped on import`. */
export function metricsSkippedLabel(count: number): string {
  return `${count} ${count === 1 ? 'metric' : 'metrics'} skipped on import`;
}

/** The metrics-import chip's title: one line per skipped metric with its
 * author and the reason (ui.md 4.19.1). */
export function metricsSkippedTitle(report: MetricsImportReport): string {
  return report.skipped
    .map((s) => {
      const author = s.authorName ?? s.author;
      const by = author ? ` by ${author}` : '';
      const kept = s.keptSourceId ? ` with ${s.keptSourceId}` : '';
      return `${s.name}${by} — name clash${kept}`;
    })
    .join('\n');
}

/**
 * The data model editing surface (brief §2, `data-model-view`), opened from
 * the dataset list's new "Data model" action. Header carries the dataset
 * name, the current version badge, a drift pill when the last recorded
 * drift has removed/changed attributes, a metrics-import chip when the last
 * legacy-metrics import skipped any, and Export/Import/Bootstrap (ui.md
 * 4.19). Tabs: Overview (entities/relationships/metrics summary, click an
 * entity to edit it), YAML, Versions, Metrics. Without Manage datasources
 * and datasets every write control is hidden and the children read-only.
 */
@Component({
  selector: 'app-data-model-view',
  imports: [
    LucideAngularModule,
    ModelYamlEditor,
    ModelVersions,
    EntityEditor,
    ModelMetricsPanel,
  ],
  templateUrl: './data-model-view.html',
  styleUrl: './data-model-view.scss',
})
export class DataModelView {
  readonly ArrowLeft = ArrowLeft;
  readonly ChevronRight = ChevronRight;
  readonly Download = Download;
  readonly FileWarning = FileWarning;
  readonly Loader2 = Loader2;
  readonly RefreshCw = RefreshCw;
  readonly Upload = Upload;
  readonly tabs = TABS;

  private readonly api = inject(DataModelApiService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);

  /** Edit controls need Manage datasources and datasets (ui.md 1.6,
   * data-model R40); without it the view is read-only, Export stays. */
  readonly canEdit = computed(() => this.auth.can('manage-datasources'));

  readonly datasetName = input.required<string>();
  readonly back = output<void>();

  private readonly fileInput =
    viewChild<ElementRef<HTMLInputElement>>('importInput');

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly response = signal<ModelResponse | null>(null);
  readonly versions = signal<DataModelVersion[]>([]);
  readonly drift = signal<DriftResponse | null>(null);
  readonly tab = signal<DataModelTab>('overview');
  readonly focusEntityName = signal<string | null>(null);
  readonly exporting = signal(false);
  readonly importing = signal(false);
  readonly bootstrapping = signal(false);

  readonly model = computed<DataModel | null>(
    () => this.response()?.version.model ?? null,
  );
  readonly currentVersion = computed(() => this.response()?.currentVersion ?? 0);
  readonly versionSource = computed(() => this.response()?.version.source ?? '');

  /** Removed/changed attributes only (review finding 12) — matches the
   * header's own "drift warning pill when lastDrift has removed/changed
   * attributes" wording; newly-added columns/tables are not a warning
   * (nothing in the current version references them yet, so there is
   * nothing stale to flag). */
  readonly driftCount = computed(() => {
    const d = this.drift();
    if (!d) return 0;
    return d.removed.length + d.changed.length;
  });

  /** The last metrics import, when it skipped at least one metric. */
  readonly metricsImportSkipped = computed<MetricsImportReport | null>(() => {
    const report = this.drift()?.metricsImport;
    return report && report.skipped.length > 0 ? report : null;
  });
  readonly metricsSkippedLabel = metricsSkippedLabel;
  readonly metricsSkippedTitle = metricsSkippedTitle;

  constructor() {
    effect(() => this.load(this.datasetName()));
  }

  private load(datasetName: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.get(datasetName).subscribe({
      next: (res) => {
        this.response.set(res);
        this.loading.set(false);
      },
      error: (err) => {
        this.loadError.set(err?.error?.message ?? 'Backend unreachable');
        this.loading.set(false);
      },
    });
    this.api.drift(datasetName).subscribe({
      next: (report) => this.drift.set(report),
      // The drift pill is a convenience, not load-bearing — stay quiet on failure.
      error: () => this.drift.set(null),
    });
    this.api.listVersions(datasetName).subscribe({
      next: (res) => this.versions.set(res.versions),
      error: () => this.versions.set([]),
    });
  }

  reload(): void {
    this.load(this.datasetName());
  }

  /** Any write path (YAML save, structured edit, metric CRUD, revert)
   * reports its new version the same way — just reload everything. */
  onVersionChanged(): void {
    this.reload();
  }

  setTab(tab: DataModelTab): void {
    this.tab.set(tab);
  }

  openEntity(name: string): void {
    this.focusEntityName.set(name);
    this.tab.set('entity');
  }

  export(): void {
    if (this.exporting()) return;
    this.exporting.set(true);
    // The filename is built here, not read off the response (review finding
    // 4) — see `slugifyDatasetName`'s doc for why that header is unreadable
    // under Electron's cross-origin `file://` -> `http://localhost:3000` call.
    const filename = `${slugifyDatasetName(this.datasetName())}.model.v${this.currentVersion()}.yaml`;
    this.api.exportYaml(this.datasetName()).subscribe({
      next: (blob) => {
        this.exporting.set(false);
        // Blob URL, not an absolute path — required under Electron's
        // `file://` renderer (CLAUDE.md "Electron gotcha").
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      },
      error: (err) => {
        this.exporting.set(false);
        this.toast.error(err?.error?.message ?? 'Export failed');
      },
    });
  }

  triggerImport(): void {
    if (!this.canEdit()) return;
    this.fileInput()?.nativeElement.click();
  }

  onImportFileSelected(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file next time
    if (!file) return;
    this.importing.set(true);
    file
      .text()
      .then((yaml) => {
        this.api.importYaml(this.datasetName(), yaml).subscribe({
          next: (res) => {
            this.importing.set(false);
            if (!res.ok || res.version === undefined) {
              this.toast.error('Import failed — the file has validation errors');
              return;
            }
            this.toast.success(`Imported as version ${res.version}`);
            this.reload();
          },
          error: (err) => {
            this.importing.set(false);
            this.toast.error(err?.error?.message ?? 'Import failed');
          },
        });
      })
      .catch(() => {
        this.importing.set(false);
        this.toast.error('Could not read the selected file');
      });
  }

  bootstrapFromSnapshot(): void {
    if (this.bootstrapping() || !this.canEdit()) return;
    this.bootstrapping.set(true);
    this.api.bootstrap(this.datasetName()).subscribe({
      next: (res) => {
        this.bootstrapping.set(false);
        if (!res.ok) {
          this.toast.error('Bootstrap failed');
          return;
        }
        this.toast.success(`Rebuilt as version ${res.currentVersion}`);
        this.reload();
      },
      error: (err) => {
        this.bootstrapping.set(false);
        this.toast.error(err?.error?.message ?? 'Bootstrap failed');
      },
    });
  }
}
