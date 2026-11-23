import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import {
  Download,
  ExternalLink,
  Loader2,
  LucideAngularModule,
  Maximize2,
  Minimize2,
  Save,
  X,
} from 'lucide-angular';
import { RunDashboardState } from '../../services/run-dashboard-state';

function plural(n: number, one: string): string {
  return `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;
}

/**
 * The dashboard Clara built, open in a side panel beside the chat
 * (dashboard-panel): its title, Draft or Saved, the version and counts, a
 * note on what to do next, Save to Artifacts while it is a draft, Open in
 * Artifacts and Download once it is saved, Full screen and Close, and the
 * dashboard itself in a sandboxed frame. The host puts it beside the chat
 * in a flex row, so it never covers the chat; its width leaves the chat at
 * least 520 px.
 */
@Component({
  selector: 'app-run-dashboard-panel',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'run-dashboard-panel-host',
    '(document:keydown.escape)': 'fullScreen.set(false)',
  },
  styles: `
    :host {
      display: flex;
      flex: none;
      min-height: 0;
      width: clamp(320px, calc(100% - 520px), 640px);
    }
  `,
  template: `
    @if (state.shown(); as d) {
      @if (fullScreen()) {
        <!-- Clicking outside the full-screen dashboard leaves full screen -->
        <button
          type="button"
          aria-label="Exit full screen"
          data-testid="run-dashboard-backdrop"
          class="fixed inset-0 z-40 cursor-default bg-black/40"
          (click)="fullScreen.set(false)"
        ></button>
      }
      <section
        #panel
        tabindex="-1"
        role="complementary"
        aria-label="Dashboard"
        data-testid="run-dashboard-panel"
        class="flex min-h-0 flex-col overflow-hidden bg-surface outline-none"
        [class]="
          fullScreen()
            ? 'fixed inset-4 z-50 rounded-xl border border-border shadow-lg'
            : 'w-full border-l border-border'
        "
        [attr.data-full-screen]="fullScreen() ? 'true' : null"
        [attr.data-status]="d.saved ? 'saved' : 'draft'"
      >
        <header
          class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3"
        >
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <h2
              class="m-0 truncate text-[15px] leading-6 font-semibold text-fg-strong"
              data-testid="run-dashboard-panel-title"
              [title]="d.title"
            >
              {{ d.title }}
            </h2>
            <div
              class="flex flex-wrap items-center gap-1.5 text-[12px] text-fg-muted"
            >
              <span
                class="chip"
                [class.chip-success]="d.saved"
                [class.chip-warning]="!d.saved"
                data-testid="run-dashboard-panel-status"
                >{{ d.saved ? '✓ Saved to Artifacts' : 'Draft' }}</span
              >
              <span class="chip chip-success">Live data</span>
              <span data-testid="run-dashboard-panel-meta">{{ meta() }}</span>
            </div>
          </div>
          @if (d.saved) {
            <button
              type="button"
              class="btn btn-outline shrink-0"
              data-testid="run-dashboard-panel-open"
              (click)="state.openInArtifacts()"
            >
              <lucide-angular [img]="ExternalLink" [size]="14" />
              <span>Open in Artifacts</span>
            </button>
            <button
              type="button"
              class="btn btn-primary shrink-0"
              data-testid="run-dashboard-panel-download"
              [disabled]="state.downloading() !== null"
              (click)="state.download()"
            >
              <lucide-angular [img]="Download" [size]="14" />
              <span>Download</span>
            </button>
          } @else {
            <button
              type="button"
              class="btn btn-primary shrink-0"
              data-testid="run-dashboard-save"
              [disabled]="state.saving() !== null"
              (click)="state.save()"
            >
              <lucide-angular
                [img]="state.saving() !== null ? Loader2 : Save"
                [size]="14"
                [class.animate-spin]="state.saving() !== null"
              />
              <span>Save to Artifacts</span>
            </button>
          }
          <button
            type="button"
            class="btn-icon shrink-0"
            data-testid="run-dashboard-full-screen"
            [attr.aria-label]="
              fullScreen() ? 'Exit full screen' : 'Full screen'
            "
            [attr.title]="fullScreen() ? 'Exit full screen' : 'Full screen'"
            [attr.aria-pressed]="fullScreen()"
            (click)="fullScreen.set(!fullScreen())"
          >
            <lucide-angular
              [img]="fullScreen() ? Minimize2 : Maximize2"
              [size]="16"
            />
          </button>
          <button
            type="button"
            class="btn-icon shrink-0"
            data-testid="run-dashboard-close"
            aria-label="Close dashboard"
            title="Close dashboard"
            (click)="close()"
          >
            <lucide-angular [img]="X" [size]="16" />
          </button>
        </header>
        <p
          class="m-0 shrink-0 border-b border-border bg-surface-muted px-4 py-2 text-[12px] text-fg-muted"
          data-testid="run-dashboard-panel-note"
        >
          @if (d.saved) {
            Saved as version {{ d.version }}. Keep asking {{ lead }} for
            changes: they show here as a new draft until you save again.
          } @else {
            Ask {{ lead }} for changes in the chat: this panel updates with each
            version. Save it when you like it; then you can download it.
          }
        </p>
        @if (state.loading()) {
          <div
            class="flex flex-1 items-center justify-center gap-2.5 text-fg-muted"
          >
            <lucide-angular [img]="Loader2" [size]="16" class="animate-spin" />
            <span>Loading the dashboard…</span>
          </div>
        } @else if (state.error(); as error) {
          <p
            role="alert"
            class="m-4 rounded-md bg-danger-soft px-3 py-2.5 text-[13px] text-on-danger-soft"
            data-testid="run-dashboard-panel-error"
          >
            {{ error }}
          </p>
        } @else if (state.artifact() !== null) {
          <iframe
            data-testid="run-dashboard-frame"
            class="min-h-0 w-full flex-1 border-0 bg-surface"
            sandbox="allow-scripts"
            referrerpolicy="no-referrer"
            [title]="d.title"
            [srcdoc]="document()"
          ></iframe>
        }
      </section>
    }
  `,
})
export class RunDashboardPanel {
  protected readonly state = inject(RunDashboardState);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly Download = Download;
  protected readonly ExternalLink = ExternalLink;
  protected readonly Loader2 = Loader2;
  protected readonly Maximize2 = Maximize2;
  protected readonly Minimize2 = Minimize2;
  protected readonly Save = Save;
  protected readonly X = X;

  /** Who the user asks for changes: the conversation's lead agent. */
  protected readonly lead = 'Avery';

  /** Whether the dashboard fills the window (Escape or the backdrop leaves). */
  protected readonly fullScreen = signal(false);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  protected readonly meta = computed(() => {
    const d = this.state.shown();
    if (d === null) return '';
    return [
      `Version ${d.version}`,
      plural(d.widgetCount, 'widget'),
      plural(d.filterCount, 'filter'),
      ...(d.rowCount !== null ? [plural(d.rowCount, 'row')] : []),
    ].join(' · ');
  });

  /** The version's self-contained document (api.md 145), in the sandbox. */
  protected readonly document = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(
      this.state.artifact()?.document ?? '',
    ),
  );

  constructor() {
    // A closed panel leaves full screen.
    effect(() => {
      if (this.state.shown() === null)
        untracked(() => this.fullScreen.set(false));
    });
    // Full screen takes the focus, so Escape leaves it.
    effect(() => {
      if (!this.fullScreen()) return;
      untracked(() => setTimeout(() => this.panel()?.nativeElement.focus()));
    });
  }

  protected close(): void {
    this.fullScreen.set(false);
    this.state.close();
  }
}
