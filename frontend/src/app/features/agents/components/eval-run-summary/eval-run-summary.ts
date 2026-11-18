import { Component, input } from '@angular/core';
import { EvalRunSummary } from '../../services/agents-api.service';
import { splitCell } from '../../services/eval-run.util';

/**
 * A finished eval run's counts in two tables: by question category (dev and
 * held-out side by side) and by criterion (agents-evals, Executions; ui.md 4.5).
 */
@Component({
  selector: 'app-eval-run-summary',
  templateUrl: './eval-run-summary.html',
})
export class EvalRunSummaryTables {
  readonly splitCell = splitCell;
  readonly summary = input.required<EvalRunSummary>();
  /** The run's id, which keys the block's test id. */
  readonly jobId = input.required<string>();
}
