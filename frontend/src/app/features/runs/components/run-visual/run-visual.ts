import { Component, computed, inject, input, output } from '@angular/core';
import { LucideAngularModule, X } from 'lucide-angular';
import { InteractiveVisualPanel } from '../../../sessions/components/interactive-visual-panel/interactive-visual-panel';
import { SessionActionResult } from '../../../sessions/models/session.model';
import { WorkflowRun } from '../../../workflows/models/workflow.model';
import { RunVisualResult } from '../../../workflows/services/workflow-runs-api.service';
import { RunVisualsState } from '../../services/run-visuals-state';

/**
 * A run's visual, open under its answer (visuals R12-R24 on a run): the
 * interactive panel with Tailor, versions, Refresh and Download over the
 * run's routes. Shown by the Run tab and the run page alike.
 */
@Component({
  selector: 'app-run-visual',
  imports: [LucideAngularModule, InteractiveVisualPanel],
  templateUrl: './run-visual.html',
})
export class RunVisual {
  protected readonly state = inject(RunVisualsState);
  protected readonly X = X;

  readonly run = input.required<WorkflowRun>();
  /** The run as a visual action stored it. */
  readonly runChange = output<WorkflowRun>();

  /** What is open, only when it belongs to this run. */
  protected readonly open = computed(() => {
    const shown = this.state.shown();
    return shown !== null && shown.runId === this.run().id ? shown : null;
  });

  protected readonly apply = (run: WorkflowRun): void =>
    this.runChange.emit(run);

  protected onRefreshed(result: SessionActionResult & RunVisualResult): void {
    this.state.adopt(this.run().id, result, this.apply);
  }
}
