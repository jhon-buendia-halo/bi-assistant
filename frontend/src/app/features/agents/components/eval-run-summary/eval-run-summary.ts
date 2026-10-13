import { Component, input } from '@angular/core';
import { EvalRunSummary } from '../../services/agents-api.service';

/**
 * A finished eval run's counts in two tables: by question category and by
 * criterion (agents-evals, Executions; ui.md 4.5).
 */
@Component({
  selector: 'app-eval-run-summary',
  templateUrl: './eval-run-summary.html',
})
export class EvalRunSummaryTables {
  readonly summary = input.required<EvalRunSummary>();
  /** The run's id, which keys the block's test id. */
  readonly jobId = input.required<string>();
}
