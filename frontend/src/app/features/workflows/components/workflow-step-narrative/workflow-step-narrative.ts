import { Component, computed, input, signal } from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import { StepNarrative } from '../../services/workflow-step-narrative';
import { WorkflowStepOutputView } from '../workflow-step-output-view/workflow-step-output-view';

/** A summary longer than this many characters starts folded. */
const SUMMARY_FOLD_AT = 600;

/**
 * The Preview of an agent step's artifact (ui.md 4.4b): the run of one step
 * told as a short report. Its heading and the step's own words, then What it
 * received, What it did (one line per tool call, its SQL on demand), the
 * last query's result (its rows) and What it returned. Presentational: the
 * dialog builds the narrative (`buildStepNarrative`).
 */
@Component({
  selector: 'app-workflow-step-narrative',
  imports: [LucideAngularModule, MarkdownPipe, WorkflowStepOutputView],
  templateUrl: './workflow-step-narrative.html',
})
export class WorkflowStepNarrative {
  protected readonly ChevronRight = ChevronRight;

  readonly narrative = input.required<StepNarrative>();
  /** The raw output: a Plan or a Validate shows as its panel under What it returned. */
  readonly output = input<Record<string, unknown> | null | undefined>(null);
  readonly inputFields = input<readonly string[]>([]);
  /** Shown instead of the report while the step has not run. */
  readonly notRunText = input('');

  /** A long summary shows its first lines until unfolded. */
  protected readonly longSummary = computed(
    () => (this.narrative().summary?.length ?? 0) > SUMMARY_FOLD_AT,
  );
  protected readonly summaryOpen = signal(false);

  /** The actions whose SQL is unfolded, by index. */
  protected readonly openSql = signal<ReadonlySet<number>>(new Set());

  protected toggleSql(index: number): void {
    this.openSql.update((open) => {
      const next = new Set(open);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }
}
