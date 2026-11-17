import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  BarChart3,
  CircleCheck,
  ExternalLink,
  FileText,
  LucideAngularModule,
  Map as MapIcon,
} from 'lucide-angular';
import { ThemeService } from '../../../../core/theme/theme.service';
import { withVisualTheme } from '../../../sessions/components/interactive-visual-panel/interactive-visual-panel';
import { VisualEvent } from '../../../sessions/models/session.model';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import { WorkflowRunsApiService } from '../../../workflows/services/workflow-runs-api.service';

/** What a run's visual is, as its card names it (visuals R42). */
export interface ArtifactKind {
  label: 'Dashboard' | 'Report' | 'Visual';
  /** Its values are invented (Dashboard Image to Artifact). */
  mock: boolean;
}

/** A visual's kind from the user journey that made it. */
export function artifactKind(workflowId: string): ArtifactKind {
  if (workflowId === 'recreate-dashboard')
    return { label: 'Dashboard', mock: true };
  if (
    workflowId === 'consumption-gap-analysis' ||
    workflowId === 'review-website'
  ) {
    return { label: 'Report', mock: false };
  }
  return { label: 'Visual', mock: false };
}

/** The live preview's frame, drawn at this size and scaled down to the card's thumbnail. */
const PREVIEW = { width: 1280, height: 800, scale: 0.1875 } as const;

/**
 * A visual a run created, as a card in the thread where it was made
 * (visuals R42; ui.md 4.4b): a live, non-interactive preview of the visual
 * at that version, its kind, title and version, whether it was saved to
 * Artifacts, and its actions: Open (the visual in the side panel) and, for
 * a saved dashboard, Map to data.
 */
@Component({
  selector: 'app-run-artifact-card',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="card flex items-center gap-4 p-3"
      data-testid="run-artifact-card"
      [attr.aria-label]="kind().label + ': ' + visual().title"
    >
      <div
        aria-hidden="true"
        data-testid="run-artifact-preview"
        class="relative h-[150px] w-[240px] shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-surface-muted"
        (click)="open.emit(visual())"
      >
        @if (preview(); as doc) {
          <iframe
            tabindex="-1"
            sandbox="allow-scripts"
            referrerpolicy="no-referrer"
            title="Preview"
            class="pointer-events-none origin-top-left border-0 bg-surface"
            [style.width.px]="frame.width"
            [style.height.px]="frame.height"
            [style.transform]="'scale(' + frame.scale + ')'"
            [srcdoc]="doc"
          ></iframe>
        } @else {
          <span class="flex h-full items-center justify-center text-fg-muted">
            <lucide-angular
              [img]="kind().label === 'Report' ? FileText : BarChart3"
              [size]="22"
            />
          </span>
        }
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="chip chip-info" data-testid="run-artifact-kind">
            <lucide-angular
              [img]="kind().label === 'Report' ? FileText : BarChart3"
              [size]="12"
            />
            {{ kind().label }}
          </span>
          @if (kind().mock) {
            <span class="chip chip-warning">Mock data</span>
          }
          <span
            class="text-[12px] text-fg-muted"
            data-testid="run-artifact-version"
            >{{ actionLabel() }} · Version {{ visual().version }}</span
          >
        </div>
        <h3
          class="m-0 truncate text-[15px] leading-6 font-semibold text-fg-strong"
          data-testid="run-artifact-title"
          [title]="visual().title"
        >
          {{ visual().title }}
        </h3>
        @if (savedArtifactId(); as artifactId) {
          <p
            class="m-0 flex items-center gap-1.5 text-[12px] text-fg-muted"
            data-testid="run-artifact-saved"
          >
            <lucide-angular [img]="CircleCheck" [size]="13" />
            <span>Saved to Artifacts</span>
            <button
              type="button"
              class="rounded text-primary hover:underline"
              data-testid="run-artifact-open-saved"
              (click)="openArtifact.emit(artifactId)"
            >
              See it there
            </button>
          </p>
        }
        <div class="mt-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-primary"
            data-testid="run-artifact-open"
            [attr.aria-label]="'Open ' + visual().title"
            (click)="open.emit(visual())"
          >
            <lucide-angular [img]="ExternalLink" [size]="14" />
            <span>Open</span>
          </button>
          @if (savedArtifactId(); as artifactId) {
            <button
              type="button"
              class="btn btn-outline"
              data-testid="run-artifact-map"
              title="Map this dashboard to your datasets"
              (click)="mapToData.emit(artifactId)"
            >
              <lucide-angular [img]="MapIcon" [size]="14" />
              <span>Map to data</span>
            </button>
          }
        </div>
      </div>
    </article>
  `,
})
export class RunArtifactCard {
  protected readonly BarChart3 = BarChart3;
  protected readonly CircleCheck = CircleCheck;
  protected readonly ExternalLink = ExternalLink;
  protected readonly FileText = FileText;
  protected readonly MapIcon = MapIcon;
  protected readonly frame = PREVIEW;

  private readonly api = inject(WorkflowRunsApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly theme = inject(ThemeService);

  readonly run = input.required<WorkflowRun>();
  readonly visual = input.required<VisualEvent>();
  /** The Artifacts entry the run saved (Dashboard Image to Artifact); null when none. */
  readonly savedArtifactId = input<string | null>(null);
  readonly open = output<VisualEvent>();
  readonly mapToData = output<string>();
  readonly openArtifact = output<string>();

  protected readonly kind = computed(() => artifactKind(this.run().workflowId));
  protected readonly actionLabel = computed(() => {
    const action = this.visual().action;
    return action === 'created'
      ? 'Created'
      : action === 'updated'
        ? 'Updated'
        : 'Reverted';
  });

  /** The visual's document at this version, for the preview; null until it loads (or when it cannot). */
  private readonly document = signal<string | null>(null);
  protected readonly preview = computed(() => {
    const doc = this.document();
    return doc === null
      ? null
      : this.sanitizer.bypassSecurityTrustHtml(
          withVisualTheme(doc, this.theme.resolved()),
        );
  });

  /** Which document the preview shows; a refreshed run object does not reload it. */
  private readonly previewKey = computed(
    () => {
      const { visualId, version } = this.visual();
      return { runId: this.run().id, visualId, version };
    },
    {
      equal: (a, b) =>
        a.runId === b.runId &&
        a.visualId === b.visualId &&
        a.version === b.version,
    },
  );

  constructor() {
    effect((onCleanup) => {
      const { runId, visualId, version } = this.previewKey();
      untracked(() => {
        this.document.set(null);
        const subscription = this.api
          .getVisualization(runId, visualId, version)
          .subscribe({
            next: (visualization) =>
              this.document.set(visualization.document ?? null),
            error: () => this.document.set(null),
          });
        onCleanup(() => subscription.unsubscribe());
      });
    });
  }
}
