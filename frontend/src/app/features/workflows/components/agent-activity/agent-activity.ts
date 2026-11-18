import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  LucideAngularModule,
  X,
} from 'lucide-angular';
import { ActivityStep } from '../../services/agent-activity';

/** While an agent works, at most this many steps show before the rest fold. */
const RECENT = 3;

/**
 * An agent step's work as a list of plain-language steps (ui.md 4.4b,
 * *Agents at work*), under that agent in the Run panel: a check for a done
 * step, one spinner for the step under way, a cross for a failed one, and
 * the rows a query brought back. A query's line opens the step's queries.
 * While the agent works only its latest steps show, the earlier ones behind
 * `Show <n> earlier steps`; once it ended, all of them fold behind
 * `Show <n> steps`.
 */
@Component({
  selector: 'app-agent-activity',
  imports: [LucideAngularModule, NgTemplateOutlet],
  templateUrl: './agent-activity.html',
  host: { class: 'block' },
})
export class AgentActivity {
  readonly steps = input.required<readonly ActivityStep[]>();
  /** The agent still works (its latest steps show), or it ended (all fold). */
  readonly live = input(true);
  /** A query's line was used: open the step's queries. */
  readonly openQuery = output<void>();

  protected readonly expanded = signal(false);

  /** The steps shown now. */
  protected readonly shown = computed(() => {
    const steps = this.steps();
    if (this.expanded()) return steps;
    if (!this.live()) return [];
    return steps.length > RECENT + 1 ? steps.slice(-RECENT) : steps;
  });

  /** The toggle's text; null when every step shows without one. */
  protected readonly toggleText = computed(() => {
    const total = this.steps().length;
    if (this.expanded()) {
      return this.live() ? 'Hide earlier steps' : 'Hide steps';
    }
    if (!this.live()) return `Show ${total} ${total === 1 ? 'step' : 'steps'}`;
    const hidden = total - this.shown().length;
    return hidden > 0
      ? `Show ${hidden} earlier ${hidden === 1 ? 'step' : 'steps'}`
      : null;
  });

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

  protected title(step: ActivityStep): string {
    return `${step.label}\n${step.detail}`;
  }

  protected readonly Check = Check;
  protected readonly X = X;
  protected readonly Loader2 = Loader2;
  protected readonly ChevronRight = ChevronRight;
  protected readonly ChevronDown = ChevronDown;
}
