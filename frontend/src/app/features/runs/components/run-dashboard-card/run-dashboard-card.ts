import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import {
  BarChart3,
  Download,
  ExternalLink,
  LucideAngularModule,
  PanelRight,
  Save,
} from 'lucide-angular';
import { DashboardRef } from '../../../sessions/models/session.model';
import { RunDashboardState } from '../../services/run-dashboard-state';

function plural(n: number, one: string): string {
  return `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;
}

/**
 * The live dashboard an answer built (bi-dashboard 2.10, dashboard-panel):
 * its title, whether this turn created or updated it and at which version,
 * Draft or Saved, the widget, filter and row counts. A draft offers Show in
 * panel and Save to Artifacts; a saved version Open (the Artifacts page at
 * that version) and Download (its zip). It shares `RunDashboardState` with
 * the side panel, so a save in either shows in both.
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
          class="chip"
          [class.chip-success]="saved()"
          [class.chip-warning]="!saved()"
          data-testid="run-dashboard-status"
          >{{ saved() ? '✓ Saved to Artifacts' : 'Draft' }}</span
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
        @if (saved()) {
          <button
            type="button"
            class="btn btn-primary"
            data-testid="run-dashboard-open"
            [attr.aria-label]="'Open ' + dashboard().title"
            (click)="state.openInArtifacts(dashboard())"
          >
            <lucide-angular [img]="ExternalLink" [size]="14" />
            <span>Open</span>
          </button>
          <button
            type="button"
            class="btn btn-outline"
            data-testid="run-dashboard-download"
            [disabled]="state.downloading() !== null"
            (click)="state.download(dashboard())"
          >
            <lucide-angular [img]="Download" [size]="14" />
            <span>Download</span>
          </button>
        } @else {
          <button
            type="button"
            class="btn btn-outline"
            data-testid="run-dashboard-show"
            [attr.aria-pressed]="state.isShown(dashboard())"
            (click)="state.open(dashboard())"
          >
            <lucide-angular [img]="PanelRight" [size]="14" />
            <span>Show in panel</span>
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="run-dashboard-save"
            [disabled]="state.saving() !== null"
            (click)="state.save(dashboard())"
          >
            <lucide-angular [img]="Save" [size]="14" />
            <span>Save to Artifacts</span>
          </button>
        }
      </div>
    </article>
  `,
})
export class RunDashboardCard {
  protected readonly BarChart3 = BarChart3;
  protected readonly Download = Download;
  protected readonly ExternalLink = ExternalLink;
  protected readonly PanelRight = PanelRight;
  protected readonly Save = Save;

  protected readonly state = inject(RunDashboardState);

  readonly dashboard = input.required<DashboardRef>();

  /** Saved to Artifacts, as the ref or a save since says (dashboard-panel). */
  protected readonly saved = computed(() =>
    this.state.isSaved(this.dashboard()),
  );
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
}
