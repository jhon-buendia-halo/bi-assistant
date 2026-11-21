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
import { MarkdownPipe } from '../../../../shared/pipes/markdown.pipe';
import { WorkflowRunAttachments } from '../workflow-run-chat/workflow-run-attachments';
import { addImageFiles } from '../workflow-run-chat/composer-images.util';
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
  imports: [MarkdownPipe, WorkflowRunAttachments],
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
  /** Ask for changes on a visual gate, with the reference images attached. */
  readonly answeredWithImages = output<{ answer: string; images: string[] }>();
  /** Open the visual a gate holds (the side panel). */
  readonly openVisual = output<string>();
  /** Run again with my answer (an expired run). */
  readonly rerun = output<string>();

  protected readonly text = signal('');
  protected readonly uid = `workflow-run-input-${nextId++}`;
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');

  protected readonly images = signal<string[]>([]);
  protected readonly imageError = signal<string | null>(null);
  /** The gate holds a visual: Open visual and reference images. */
  protected readonly visualId = computed(() => this.waiting().visualId ?? null);

  protected readonly blank = computed(
    () => this.text().trim() === '' && this.images().length === 0,
  );
  protected readonly expired = computed(() => this.waiting().expired === true);
  /** An approval gate: the agent's outcome waits for an OK (workflows R44). */
  protected readonly gate = computed(() => !!this.waiting().review);

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

  /** Approve a gate: the backend reads the answer `Approve` as the OK. */
  protected approve(): void {
    if (!this.busy()) this.answered.emit('Approve');
  }

  protected async addImages(files: readonly File[]): Promise<void> {
    const { accepted, error } = await addImageFiles(
      files,
      this.images().length,
      'Reference images',
      4,
    );
    this.images.update((list) => [...list, ...accepted].slice(0, 4));
    this.imageError.set(error);
  }

  protected removeImage(index: number): void {
    this.images.update((list) => list.filter((_, i) => i !== index));
    this.imageError.set(null);
  }

  protected submit(): void {
    const answer = this.text().trim();
    if (this.busy()) return;
    if (this.visualId() !== null && !this.expired()) {
      const images = this.images();
      if (!answer && images.length === 0) return;
      this.answeredWithImages.emit({ answer, images: [...images] });
      this.images.set([]);
      this.imageError.set(null);
      return;
    }
    if (!answer) return;
    if (this.expired()) this.rerun.emit(answer);
    else this.answered.emit(answer);
  }
}
