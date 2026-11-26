import {
  Component,
  ElementRef,
  viewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, Maximize2, Minimize2, X } from 'lucide-angular';
import { InteractiveVisualPanel } from '../../../sessions/components/interactive-visual-panel/interactive-visual-panel';
import { SessionActionResult } from '../../../sessions/models/session.model';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import { RunVisualResult } from '../../../workflows/services/workflow-runs-api.service';
import { RunVisualsState } from '../../services/run-visuals-state';
import { artifactKind } from '../run-artifact-card/run-artifact-card';

/**
 * A run's visual, open under its answer (visuals R12-R24 on a run): the
 * interactive panel with versions, revert, Refresh and Download over the
 * run's routes, and Full screen. Shown by the Run tab and the run page
 * alike.
 */
@Component({
  selector: 'app-run-visual',
  imports: [LucideAngularModule, InteractiveVisualPanel],
  templateUrl: './run-visual.html',
  styles: `
    /* The side panel: full height on the window's right edge, over the page. */
    .run-visual-sheet {
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 45;
      width: min(820px, calc(100vw - 240px));
      border-radius: 0;
      border-top: 0;
      border-right: 0;
      border-bottom: 0;
      box-shadow: -12px 0 32px rgb(0 0 0 / 0.14);
    }
  `,
})
export class RunVisual {
  protected readonly state = inject(RunVisualsState);
  protected readonly X = X;
  protected readonly Maximize2 = Maximize2;
  protected readonly Minimize2 = Minimize2;

  readonly run = input.required<WorkflowRun>();
  /**
   * A side panel on the window's right edge (visuals R42: a run's artifact
   * card opens the visual here) instead of a section under the answer.
   */
  readonly sheet = input(false);
  /** The run as a visual action stored it. */
  readonly runChange = output<WorkflowRun>();

  /** Whether the visual fills the window (Escape or the backdrop exits). */
  protected readonly fullScreen = signal(false);

  /** What is open, only when it belongs to this run. */
  protected readonly open = computed(() => {
    const shown = this.state.shown();
    return shown !== null && shown.runId === this.run().id ? shown : null;
  });

  /** The open visual's title, for the side panel's header. */
  protected readonly title = computed(
    () => this.open()?.visualization.title ?? null,
  );
  protected readonly kind = computed(() => artifactKind(this.run().workflowId));
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  /** Escape leaves full screen first, then closes the side panel. */
  protected onEscape(): void {
    if (this.fullScreen()) this.fullScreen.set(false);
    else if (this.sheet()) this.state.close();
  }

  constructor() {
    // A closed or replaced visual leaves full screen.
    effect(() => {
      if (this.open() === null) this.fullScreen.set(false);
    });
    // The side panel takes the focus when it opens, so Escape closes it.
    effect(() => {
      const id = this.open()?.visualization.id ?? null;
      if (id === null || !this.sheet()) return;
      setTimeout(() => this.panel()?.nativeElement.focus());
    });
  }

  protected readonly apply = (run: WorkflowRun): void =>
    this.runChange.emit(run);

  protected onRefreshed(result: SessionActionResult & RunVisualResult): void {
    this.state.adopt(this.run().id, result, this.apply);
  }
}
