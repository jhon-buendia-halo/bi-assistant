import { Component, computed, input, output } from '@angular/core';
import { AgentAvatar } from '../../../../shared/components/agent-avatar/agent-avatar';
import { AgentStepStory, handoffLine } from '../../services/agent-step-story';

/** One row of the team: an agent, and the handoff into it from the one before. */
interface TeamRow {
  story: AgentStepStory;
  handoff: string | null;
}

/**
 * The run's agents as a team at work (ui.md 4.4b, *Agents at work*): in the
 * Run panel, between the question and the answer, each agent step of the
 * run with its portrait, what it did or is doing in the first person, and
 * the handoff from the agent before. Built from the run's step data only
 * (`agentStepStories`); the node's data opens its dialog, where its queries
 * reach the query inspector as before.
 */
@Component({
  selector: 'app-workflow-run-team',
  imports: [AgentAvatar],
  templateUrl: './workflow-run-team.html',
  host: { class: 'block' },
})
export class WorkflowRunTeam {
  /** Each agent step's story, in the workflow's order. */
  readonly stories = input.required<ReadonlyMap<string, AgentStepStory>>();
  /** Open an agent step's node dialog (its data, its queries). */
  readonly openNode = output<string>();

  /** The agents the run reached or will reach; none before a run. */
  readonly rows = computed<TeamRow[]>(() => {
    const shown = [...this.stories().values()].filter(
      (story) => story.state !== 'idle' && story.state !== 'skipped',
    );
    return shown.map((story, i) => ({
      story,
      handoff: i > 0 ? handoffLine(shown[i - 1], story) : null,
    }));
  });
}
