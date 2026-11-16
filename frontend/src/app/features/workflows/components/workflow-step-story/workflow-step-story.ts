import { Component, input } from '@angular/core';
import { CircleCheck, CircleX, LucideAngularModule } from 'lucide-angular';
import { StepStory } from '../../models/workflow.model';

/**
 * A step's story in the Logs (ui.md 4.4b, *Story*): its headline, its facts
 * (names from the data as code, a check with its verdict), what came next,
 * and, for a generic story, where it came from. Presentational: the server
 * tells the story (api.md 3.6 `step.story`).
 */
@Component({
  selector: 'app-workflow-step-story',
  imports: [LucideAngularModule],
  templateUrl: './workflow-step-story.html',
})
export class WorkflowStepStory {
  protected readonly CircleCheck = CircleCheck;
  protected readonly CircleX = CircleX;

  readonly story = input.required<StepStory>();
}
