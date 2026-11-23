import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  BarChart3,
  Download,
  ExternalLink,
  LucideAngularModule,
} from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { saveBlob } from '../../../../shared/query-evidence/rows-csv';
import { ArtifactsApiService } from '../../../artifacts/services/artifacts-api.service';
import { ArtifactsNavState } from '../../../artifacts/services/artifacts-nav-state';
import { DashboardRef } from '../../../sessions/models/session.model';
import { dashboardZipName } from '../../../artifacts/models/artifact.model';

function plural(n: number, one: string): string {
  return `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;
}

/**
 * The live dashboard an answer built (bi-dashboard 2.10): its title, whether
 * this turn created or updated it and at which version, the widget, filter
 * and row counts, and Open (the Artifacts page at that version) and Download
 * (that version's zip).
 */
@Component({
  selector: 'app-run-dashboard-card',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="card flex flex-col gap-1.5 p-3"
      data-testid="run-dashboard-card"
      [attr.aria-label]="'Dashboard: ' + dashboard().title"
    >
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="chip chip-info">
          <lucide-angular [img]="BarChart3" [size]="12" />
          Dashboard
        </span>
        <span class="chip chip-success" data-testid="run-dashboard-live"
          >Live data</span
        >
        <span
          class="text-[12px] text-fg-muted"
          data-testid="run-dashboard-version"
          >{{ actionLabel() }} · Version {{ dashboard().version }}</span
        >
      </div>
      <h3
        class="m-0 truncate text-[15px] leading-6 font-semibold text-fg-strong"
        data-testid="run-dashboard-title"
        [title]="dashboard().title"
      >
        {{ dashboard().title }}
      </h3>
      <p class="m-0 text-[12px] text-fg-muted" data-testid="run-dashboard-meta">
        {{ meta() }}
      </p>
      <div class="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn btn-primary"
          data-testid="run-dashboard-open"
          [attr.aria-label]="'Open ' + dashboard().title"
          (click)="open()"
        >
          <lucide-angular [img]="ExternalLink" [size]="14" />
          <span>Open</span>
        </button>
        <button
          type="button"
          class="btn btn-outline"
          data-testid="run-dashboard-download"
          [disabled]="downloading()"
          (click)="download()"
        >
          <lucide-angular [img]="Download" [size]="14" />
          <span>Download</span>
        </button>
      </div>
    </article>
  `,
})
export class RunDashboardCard {
  protected readonly BarChart3 = BarChart3;
  protected readonly Download = Download;
  protected readonly ExternalLink = ExternalLink;

  private readonly api = inject(ArtifactsApiService);
  private readonly nav = inject(ArtifactsNavState);
  private readonly toast = inject(ToastService);

  readonly dashboard = input.required<DashboardRef>();
  protected readonly downloading = signal(false);

  protected readonly actionLabel = computed(() =>
    this.dashboard().action === 'created' ? 'Created' : 'Updated',
  );
  protected readonly meta = computed(() => {
    const d = this.dashboard();
    return [
      plural(d.widgetCount, 'widget'),
      plural(d.filterCount, 'filter'),
      plural(d.rowCount, 'row'),
    ].join(' · ');
  });

  protected open(): void {
    const d = this.dashboard();
    this.nav.openArtifact(d.artifactId, d.version);
  }

  protected download(): void {
    const d = this.dashboard();
    if (this.downloading()) return;
    this.downloading.set(true);
    this.api.download(d.artifactId, d.version).subscribe({
      next: (blob) => {
        this.downloading.set(false);
        saveBlob(blob, dashboardZipName(d.title, d.artifactId, d.version));
      },
      error: (err) => {
        this.downloading.set(false);
        this.toast.error(err?.error?.message ?? 'Could not download');
      },
    });
  }
}
