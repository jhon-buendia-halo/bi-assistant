import { Component, input, output } from '@angular/core';
import {
  CircleCheck,
  CircleX,
  LucideAngularModule,
  SquareArrowOutUpRight,
} from 'lucide-angular';
import { StepStory, StoryFact } from '../../models/workflow.model';

/** A query fact opened in the query inspector: its answer index and the control used. */
export interface StoryQueryOpen {
  index: number;
  opener: Element;
}

/**
 * A step's story (ui.md 4.4b, *Story*): its headline, its facts (names from
 * the data as code, a check with its verdict, a query with **Open query**
 * when the answer has it), what came next, and, for a generic story, where
 * it came from. Presentational: the server tells the story (api.md 3.6
 * `step.story`); the host says where a query is among the answer's queries.
 */
@Component({
  selector: 'app-workflow-step-story',
  imports: [LucideAngularModule],
  templateUrl: './workflow-step-story.html',
})
export class WorkflowStepStory {
  protected readonly CircleCheck = CircleCheck;
  protected readonly CircleX = CircleX;
  protected readonly OpenIcon = SquareArrowOutUpRight;

  readonly story = input.required<StepStory>();
  /** Where a statement is among the answer's queries; null when it is not there. */
  readonly queryIndexOf = input<((sql: string) => number | null) | null>(null);
  readonly openQuery = output<StoryQueryOpen>();

  /** A query fact's index among the answer's queries, else null. */
  protected queryIndex(fact: StoryFact): number | null {
    const find = this.queryIndexOf();
    return fact.sql && find ? find(fact.sql) : null;
  }
}
