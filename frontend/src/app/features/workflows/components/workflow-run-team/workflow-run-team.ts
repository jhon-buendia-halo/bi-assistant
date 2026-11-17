import { Component, computed, input, output } from '@angular/core';
import { Brain, Loader2, LucideAngularModule } from 'lucide-angular';
import { AgentAvatar } from '../../../../shared/components/agent-avatar/agent-avatar';
import { ActivityStep } from '../../services/agent-activity';
import {
  AgentStepStory,
  handoffLine,
  upNextLine,
} from '../../services/agent-step-story';
import { AgentActivity } from '../agent-activity/agent-activity';

/** One row of the team: an agent, and the handoff into it from the one before. */
interface TeamRow {
  story: AgentStepStory;
  handoff: string | null;
  /** The step under way, while the agent works; null otherwise. */
  now: ActivityStep | null;
}

/**
 * The run's agents as a team at work (ui.md 4.4b, *Agents at work*): in the
 * Run panel, between the question and the answer, each agent step the run
 * reached with its portrait, what it did or is doing in the first person,
 * its steps in plain words under it, and the handoff from the agent before;
 * the agents still waiting share one `Up next` line. Built from the run's
 * step data only (`agentStepStories`); the node's data opens its dialog,
 * where its queries reach the query inspector as before.
 */
@Component({
  selector: 'app-workflow-run-team',
  imports: [AgentAvatar, AgentActivity, LucideAngularModule],
  templateUrl: './workflow-run-team.html',
  host: { class: 'block' },
})
export class WorkflowRunTeam {
  /** Each agent step's story, in the workflow's order. */
  readonly stories = input.required<ReadonlyMap<string, AgentStepStory>>();
  /** The working agent's latest reasoning; '' when it has none. */
  readonly thought = input('');
  /**
   * Show each agent's steps and thought (Builder). The Business view shows
   * only the step under way, in words (workflows R38).
   */
  readonly showWork = input(true);
  /** Open an agent step's node dialog (its data, its queries). */
  readonly openNode = output<string>();

  /** The agents the run reached; none before a run. */
  readonly rows = computed<TeamRow[]>(() => {
    const shown = [...this.stories().values()].filter(
      (story) =>
        story.state !== 'idle' &&
        story.state !== 'skipped' &&
        story.state !== 'waiting',
    );
    return shown.map((story, i) => ({
      story,
      handoff: i > 0 ? handoffLine(shown[i - 1], story) : null,
      now:
        story.state === 'active'
          ? (story.activity.find((step) => step.state === 'current') ?? null)
          : null,
    }));
  });

  /** The agents still waiting, for the `Up next` line. */
  readonly waiting = computed(() =>
    [...this.stories().values()].filter((story) => story.state === 'waiting'),
  );

  /** `Jessica writes the answer, then Ryan builds the visual`; null when none waits. */
  readonly upNext = computed(() => upNextLine(this.waiting()));

  protected readonly Brain = Brain;
  protected readonly Loader2 = Loader2;
}
