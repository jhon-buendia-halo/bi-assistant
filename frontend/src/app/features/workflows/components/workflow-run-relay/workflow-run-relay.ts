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
import { AgentAvatar } from '../../../../shared/components/agent-avatar/agent-avatar';
import { ActivityStep } from '../../services/agent-activity';
import { RelayItem } from '../../services/team-relay';

/**
 * An orchestrator's work told as a relay (ui.md 4.4b *relay*), under her
 * sentence in the Run panel: her steps in her words and, under each
 * hand-off, the teammate's own work in a block with their portrait, with
 * their queries one click away. It shows while she works and folds behind
 * `Show what the team did` once she is done.
 */
@Component({
  selector: 'app-workflow-run-relay',
  imports: [AgentAvatar, LucideAngularModule, NgTemplateOutlet],
  templateUrl: './workflow-run-relay.html',
  host: { class: 'block' },
})
export class WorkflowRunRelay {
  readonly items = input.required<readonly RelayItem[]>();
  /** She still works: the relay shows; once she is done it folds. */
  readonly live = input(false);
  /** A query's line, or a teammate's queries link, was used. */
  readonly openQuery = output<void>();

  private readonly toggled = signal<boolean | null>(null);

  /** Open while she works, folded once she is done, unless toggled. */
  protected readonly open = computed(() => this.toggled() ?? this.live());

  protected readonly toggleText = computed(() =>
    this.open() ? 'Hide what the team did' : 'Show what the team did',
  );

  protected toggle(): void {
    this.toggled.set(!this.open());
  }

  /** `See Michael's query and data`, `See Michael's 2 queries and data`. */
  protected queriesLink(name: string, queries: number): string {
    return queries === 1
      ? `See ${name}'s query and data`
      : `See ${name}'s ${queries} queries and data`;
  }

  protected title(step: ActivityStep): string {
    return step.detail ? `${step.label}\n${step.detail}` : step.label;
  }

  protected readonly Check = Check;
  protected readonly X = X;
  protected readonly Loader2 = Loader2;
  protected readonly ChevronRight = ChevronRight;
  protected readonly ChevronDown = ChevronDown;
}
