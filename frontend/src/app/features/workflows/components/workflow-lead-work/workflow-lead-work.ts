import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output } from '@angular/core';
import {
  Check,
  ChevronRight,
  Loader2,
  LucideAngularModule,
  X,
} from 'lucide-angular';
import { ToolDataRecord } from '../../../sessions/models/session.model';
import { AgentAvatar } from '../../../../shared/components/agent-avatar/agent-avatar';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import { WorkflowTeamMember } from '../../models/workflow.model';
import { toolNodeId } from '../../models/workflow-node.model';
import { ActivityStep } from '../../services/agent-activity';
import {
  RelayHandOff,
  RelayItem,
  recordIndexOf,
} from '../../services/team-relay';
import { StoryQueryOpen } from '../workflow-step-story/workflow-step-story';

/**
 * An orchestrator's step told as her work (ui.md 4.4b, *Orchestrator
 * dialog*), as a teammate's dialog tells theirs: what the user asked, what
 * she did (her steps in her words, each hand-off with the teammate's own
 * work under it, their queries one click from the query inspector and their
 * whole work one link away) and what she handed back, the answer.
 */
@Component({
  selector: 'app-workflow-lead-work',
  imports: [AgentAvatar, LucideAngularModule, MarkdownPipe, NgTemplateOutlet],
  templateUrl: './workflow-lead-work.html',
  host: { class: 'block' },
})
export class WorkflowLeadWork {
  /** The orchestrator's first name: `Avery`. */
  readonly lead = input.required<string>();
  readonly stepId = input.required<string>();
  /** Her team, to find the tool that calls a teammate. */
  readonly team = input<readonly WorkflowTeamMember[]>([]);
  /** The run's question, as the step received it; null when not kept. */
  readonly question = input<string | null>(null);
  /** Her relay in the run shown. */
  readonly relay = input.required<readonly RelayItem[]>();
  /** What she handed back: the step's answer; null while she works. */
  readonly answer = input<string | null>(null);
  /** She still works. */
  readonly running = input(false);
  /** The answer's records, when the page opens queries; else null. */
  readonly answerData = input<readonly ToolDataRecord[] | null>(null);

  readonly openQuery = output<StoryQueryOpen>();
  /** A teammate's whole work: the node id of the tool that calls them. */
  readonly openTeammate = output<string>();

  protected readonly queries = computed(() =>
    this.relay()
      .filter((item): item is RelayHandOff => item.kind === 'teammate')
      .reduce((sum, item) => sum + item.queries, 0),
  );

  /** The node id of the tool that calls a teammate; null when unknown. */
  protected teammateNode(item: RelayHandOff): string | null {
    const member = this.team().find((m) => m.key === item.teammate.key);
    return member ? toolNodeId(this.stepId(), member.tool) : null;
  }

  protected queryIndex(step: ActivityStep): number {
    return step.query ? recordIndexOf(this.answerData() ?? [], step) : -1;
  }

  protected pick(step: ActivityStep, event: Event): void {
    const index = this.queryIndex(step);
    if (index < 0 || !(event.currentTarget instanceof Element)) return;
    this.openQuery.emit({ index, opener: event.currentTarget });
  }

  protected readonly Check = Check;
  protected readonly X = X;
  protected readonly Loader2 = Loader2;
  protected readonly ChevronRight = ChevronRight;
}
