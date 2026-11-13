import {
  AfterViewInit,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { WorkflowWaitingFor } from '../../models/workflow.model';

let nextId = 0;

/**
 * The waiting card (ui.md 4.4b), pinned at the top of the Run panel while a
 * run waits for the user: the step that asks, its question, an option
 * button per choice, a free-text answer and Continue. Focus moves to the
 * card when it appears. Choosing an option sends it; an expired run
 * (`waitingFor.expired`) says so and offers Run again with my answer.
 */
@Component({
  selector: 'app-workflow-run-input-required',
  templateUrl: './workflow-run-input-required.html',
  host: { class: 'block' },
})
export class WorkflowRunInputRequired implements AfterViewInit {
  readonly waiting = input.required<WorkflowWaitingFor>();
  /** The answer is being sent: the controls are off. */
  readonly busy = input(false);
  /** The server refused the answer (not a failed run). */
  readonly error = input<string | null>(null);

  /** Continue, or an option chosen. */
  readonly answered = output<string>();
  /** Run again with my answer (an expired run). */
  readonly rerun = output<string>();

  protected readonly text = signal('');
  protected readonly uid = `workflow-run-input-${nextId++}`;
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');

  protected readonly blank = computed(() => this.text().trim() === '');
  protected readonly expired = computed(() => this.waiting().expired === true);

  ngAfterViewInit(): void {
    this.card().nativeElement.focus();
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  /** An option: sends it, or (expired) fills the answer to run again with. */
  protected pick(option: string): void {
    if (this.expired()) this.text.set(option);
    else if (!this.busy()) this.answered.emit(option);
  }

  protected submit(): void {
    const answer = this.text().trim();
    if (!answer || this.busy()) return;
    if (this.expired()) this.rerun.emit(answer);
    else this.answered.emit(answer);
  }
}
