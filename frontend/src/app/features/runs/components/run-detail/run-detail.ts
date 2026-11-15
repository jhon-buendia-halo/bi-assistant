import { Component, computed, inject } from '@angular/core';
import {
  ArrowLeft,
  Loader2,
  LucideAngularModule,
  TriangleAlert,
  Workflow,
} from 'lucide-angular';
import { AnswerView } from '../../../sessions/components/answer-view/answer-view';
import {
  runOutputEntries,
  runStatusLine,
  runStepStatusLabel,
} from '../../../workflows/services/workflows.util';
import { RunVisualsState } from '../../services/run-visuals-state';
import { RunsState } from '../../services/runs-state';
import { RunVisual } from '../run-visual/run-visual';
import { WorkflowRun } from '../../../workflows/models/workflow.model';

/** One field of a run's input as `run-detail` shows it. */
export interface RunInputEntry {
  name: string;
  value: string;
}

/** A run's input, field by field: lists joined, anything else as text. */
export function runInputEntries(
  input: Record<string, unknown>,
): RunInputEntry[] {
  return Object.entries(input).map(([name, value]) => ({
    name,
    value: Array.isArray(value) ? value.join(', ') : String(value),
  }));
}

/**
 * A stored run reopened read-only (workflows R19, R23; ui.md 4.4c
 * `run-detail`): a run of a removed workflow, or one still running; any
 * other run opens on its workflow's page. It shows its workflow and status,
 * its input, its steps and the answer through `answer-view`. Only the
 * visual actions of the answer change the run.
 */
@Component({
  selector: 'app-run-detail',
  imports: [LucideAngularModule, AnswerView, RunVisual],
  templateUrl: './run-detail.html',
})
export class RunDetail {
  protected readonly state = inject(RunsState);
  protected readonly visuals = inject(RunVisualsState);

  /** A visual action stored the run: show it as it is now. */
  protected readonly applyRun = (run: WorkflowRun): void =>
    this.state.activeRun.set(run);

  protected readonly ArrowLeft = ArrowLeft;
  protected readonly Loader2 = Loader2;
  protected readonly TriangleAlert = TriangleAlert;
  protected readonly Workflow = Workflow;

  protected readonly stepStatus = runStepStatusLabel;

  protected readonly status = computed(() => {
    const run = this.state.activeRun();
    return run === null ? '' : runStatusLine(run);
  });
  protected readonly inputs = computed(() =>
    runInputEntries(this.state.activeRun()?.input ?? {}),
  );
  /** A run without an answer (code-only): its output, field by field. */
  protected readonly output = computed(() => {
    const run = this.state.activeRun();
    return run === null || run.answer !== undefined
      ? []
      : runOutputEntries(run.output);
  });
}
