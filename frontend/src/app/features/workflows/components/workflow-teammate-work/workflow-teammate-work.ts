import { Component, computed, input, output } from '@angular/core';
import {
  Check,
  ChevronRight,
  Loader2,
  LucideAngularModule,
  X,
} from 'lucide-angular';
import { ToolDataRecord } from '../../../sessions/models/session.model';
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import {
  NodeToolCallView,
  NodeToolView,
} from '../../models/workflow-node.model';
import { ActivityStep } from '../../services/agent-activity';
import {
  RelayHandOff,
  RelayItem,
  recordIndexOf,
} from '../../services/team-relay';
import { formatNodeDuration } from '../workflow-node-dialog/workflow-node-format';
import { StoryQueryOpen } from '../workflow-step-story/workflow-step-story';

/** One time the orchestrator called the teammate, told in three parts. */
export interface TeammateCallView {
  /** `Call 1 of 2` when she called them more than once; else null. */
  heading: string | null;
  /** Her brief, whole (at most 2 000 characters as stored). */
  asked: string | null;
  /** The teammate's own steps: their queries and lookups. */
  steps: ActivityStep[];
  queries: number;
  /** What they handed back, in their words; null when nothing was kept. */
  reply: string | null;
  error: string | null;
  running: boolean;
  duration: string | null;
}

/**
 * A teammate's work for an orchestrator (ui.md 4.4b, *Teammate dialog*):
 * opened from the teammate's sub-node on the canvas, it tells each time she
 * called them in the run shown in three parts: what she asked, what they
 * did (their queries one click away in the query inspector) and what they
 * handed back. The tool behind the call is a folded technical detail, and
 * the teammate's agent definition one link away.
 */
@Component({
  selector: 'app-workflow-teammate-work',
  imports: [LucideAngularModule, MarkdownPipe],
  templateUrl: './workflow-teammate-work.html',
  host: { class: 'block' },
})
export class WorkflowTeammateWork {
  /** The team tool opened, with its teammate (`tool.teammate`). */
  readonly tool = input.required<NodeToolView>();
  /** The orchestrator step's relay in the run shown; null without a run. */
  readonly relay = input<readonly RelayItem[] | null>(null);
  /** The answer's records, when the page opens queries; else null. */
  readonly answerData = input<readonly ToolDataRecord[] | null>(null);
  /** A run is shown. */
  readonly hasRun = input(false);

  readonly openQuery = output<StoryQueryOpen>();
  /** The Step link in the technical details: open the orchestrator's step. */
  readonly openStep = output<string>();

  protected readonly name = computed(
    () => this.tool().teammate?.name ?? this.tool().name,
  );
  /** The orchestrator's first name: `Avery`. */
  protected readonly lead = computed(() => this.tool().agentName);

  /** Each team call with the teammate's work under it, paired in order. */
  protected readonly calls = computed<TeammateCallView[]>(() => {
    const tool = this.tool();
    const key = tool.teammate?.key;
    const handOffs = (this.relay() ?? []).filter(
      (item): item is RelayHandOff =>
        item.kind === 'teammate' && item.teammate.key === key,
    );
    const calls = tool.calls;
    return calls.map((call, i) => callView(call, handOffs[i], i, calls.length));
  });

  /** Why there is nothing to tell. */
  protected readonly empty = computed(() =>
    this.hasRun()
      ? `${this.lead()} did not call ${this.name()} in the run shown.`
      : `Run the journey to see what ${this.name()} does when ${this.lead()} calls them.`,
  );

  /** A query step opens in the query inspector when the answer holds it. */
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

function callView(
  call: NodeToolCallView,
  handOff: RelayHandOff | undefined,
  i: number,
  total: number,
): TeammateCallView {
  // Their own steps; the relay's closing line (`Wrote the answer`) is the reply below.
  const steps = (handOff?.steps ?? []).filter(
    (step) => step.tool !== '' || step.state === 'current',
  );
  return {
    heading: total > 1 ? `Call ${i + 1} of ${total}` : null,
    asked: call.input?.trim() || null,
    steps,
    queries: steps.filter((step) => step.query).length,
    reply: call.reply?.trim() || null,
    error: call.error ?? null,
    running: !call.finished,
    duration:
      call.durationMs !== undefined
        ? formatNodeDuration(call.durationMs)
        : null,
  };
}
