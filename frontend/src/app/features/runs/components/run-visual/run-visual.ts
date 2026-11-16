import {
  Component,
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

/**
 * The workflows whose visual is drawn by code from the run's own data, not
 * from a query: Tailor, Refresh and revert have nothing to act on, so the
 * panel is read-only (agents.md 5.19, 5.20).
 */
const CODE_BUILT_VISUAL_WORKFLOWS: readonly string[] = [
  'review-website',
  'consumption-gap-analysis',
];

/**
 * A run's visual, open under its answer (visuals R12-R24 on a run): the
 * interactive panel with Tailor, versions, Refresh and Download over the
 * run's routes, and Full screen. Shown by the Run tab and the run page
 * alike.
 */
@Component({
  selector: 'app-run-visual',
  imports: [LucideAngularModule, InteractiveVisualPanel],
  templateUrl: './run-visual.html',
})
export class RunVisual {
  protected readonly state = inject(RunVisualsState);
  protected readonly X = X;
  protected readonly Maximize2 = Maximize2;
  protected readonly Minimize2 = Minimize2;

  readonly run = input.required<WorkflowRun>();
  /** The run as a visual action stored it. */
  readonly runChange = output<WorkflowRun>();

  /** Whether the visual fills the window (Escape or the backdrop exits). */
  protected readonly fullScreen = signal(false);

  /** What is open, only when it belongs to this run. */
  protected readonly open = computed(() => {
    const shown = this.state.shown();
    return shown !== null && shown.runId === this.run().id ? shown : null;
  });

  /** A visual drawn by code from the run's data: no Tailor, no Refresh. */
  protected readonly codeBuilt = computed(() =>
    CODE_BUILT_VISUAL_WORKFLOWS.includes(this.run().workflowId),
  );

  constructor() {
    // A closed or replaced visual leaves full screen.
    effect(() => {
      if (this.open() === null) this.fullScreen.set(false);
    });
  }

  protected readonly apply = (run: WorkflowRun): void =>
    this.runChange.emit(run);

  protected onRefreshed(result: SessionActionResult & RunVisualResult): void {
    this.state.adopt(this.run().id, result, this.apply);
  }
}
