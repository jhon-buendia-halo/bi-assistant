import { Component, computed, input, output, signal } from '@angular/core';
import { ChevronRight, LucideAngularModule } from 'lucide-angular';
import { NodeInspection } from '../../models/workflow-node.model';
import { runStats, runTimeline } from '../../services/workflow-run-story';

/**
 * How it ran (ui.md 4.4b): under the run's answer in the Run panel, the run
 * read from top to bottom. Folded, one line with its first figures;
 * unfolded, the run's figures, then each step in one line (its story's
 * headline), whose title opens the step's dialog. Built from the steps'
 * stories (api.md 3.6 `step.story`); shown once a run has steps.
 */
@Component({
  selector: 'app-workflow-run-story',
  imports: [LucideAngularModule],
  templateUrl: './workflow-run-story.html',
})
export class WorkflowRunStory {
  protected readonly ChevronRight = ChevronRight;

  readonly nodes = input.required<readonly NodeInspection[]>();
  /** A step's title was picked: open its dialog. */
  readonly openNode = output<string>();

  protected readonly open = signal(false);
  protected readonly timeline = computed(() => runTimeline(this.nodes()));
  protected readonly stats = computed(() => runStats(this.nodes()));
  /** The folded line's figures: the first three, `value label` each. */
  protected readonly summary = computed(() =>
    this.stats()
      .slice(0, 3)
      .map((stat) => `${stat.value} ${stat.label}`)
      .join(' · '),
  );
  /** Steps that ran or were skipped, against all of them. */
  protected readonly counted = computed(() => {
    const entries = this.timeline();
    const ran = entries.filter(
      (entry) => entry.state !== 'pending' && entry.state !== 'skipped',
    ).length;
    return `${ran} of ${entries.length} steps ran`;
  });
}
