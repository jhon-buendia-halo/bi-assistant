import {
  Component,
  ElementRef,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Plus, Send } from 'lucide-angular';

/** The tallest the message box grows before it scrolls, in px. */
const MAX_HEIGHT = 160;

/**
 * The run chat's message box (ui.md 4.4b): one pill with a round `+` on the
 * left (the inputs and options menu, projected as `[composerMenu]`), a text
 * area that grows with what is typed, and a round Send on the right. Enter
 * sends, Shift+Enter adds a line. Chips of what is set sit above it
 * (`[composerChips]`). Presentational: the host owns the text and what Send
 * does.
 */
@Component({
  selector: 'app-run-composer',
  imports: [LucideAngularModule],
  host: { class: 'relative block' },
  template: `
    <ng-content select="[composerMenu]" />
    <ng-content select="[composerChips]" />
    <form
      [attr.data-testid]="formTestId()"
      [attr.aria-label]="label()"
      class="flex items-end gap-2 rounded-full border border-border-strong bg-surface py-[7px] pr-2 pl-2 shadow-input transition-colors focus-within:border-border-selected"
      [style.border-radius.px]="tall() ? 22 : null"
      [class.bg-surface-selected]="dragging()"
      (submit)="$event.preventDefault(); trySend()"
      (paste)="pasted.emit($event)"
      (dragover)="dragOver.emit($event)"
      (dragleave)="dragLeave.emit()"
      (drop)="dropped.emit($event)"
    >
      @if (withPlus()) {
        <button
          type="button"
          data-testid="run-composer-plus"
          aria-label="Add inputs and options"
          title="Add inputs and options"
          aria-haspopup="true"
          [attr.aria-expanded]="menuOpen()"
          (click)="plus.emit()"
          class="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full text-icon transition-colors hover:text-fg-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          [class.bg-surface-muted]="!menuOpen()"
          [class.bg-surface-selected]="menuOpen()"
          [class.text-fg-strong]="menuOpen()"
        >
          <lucide-angular [img]="Plus" [size]="18" />
        </button>
      } @else {
        <span class="w-2 shrink-0" aria-hidden="true"></span>
      }
      <label [for]="inputId()" class="sr-only">{{ label() }}</label>
      <textarea
        #box
        rows="1"
        [id]="inputId()"
        [attr.data-testid]="inputTestId()"
        [attr.placeholder]="placeholder()"
        [value]="value()"
        (input)="onInput($event)"
        (keydown)="onKey($event)"
        class="min-h-[34px] min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-[7px] text-[14px] leading-5 text-fg-strong outline-none placeholder:text-placeholder"
      ></textarea>
      <button
        type="submit"
        [attr.data-testid]="sendTestId()"
        aria-label="Send"
        title="Send"
        [disabled]="!canSend()"
        class="flex h-[34px] w-[34px] shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-surface-selected disabled:text-placeholder"
      >
        <lucide-angular [img]="Send" [size]="16" />
      </button>
    </form>
  `,
})
export class RunComposer {
  protected readonly Plus = Plus;
  protected readonly Send = Send;

  /** The text in the box; the host keeps it. */
  readonly value = input('');
  readonly placeholder = input('');
  /** The form's and the text area's accessible name. */
  readonly label = input('Message');
  readonly canSend = input(false);
  readonly withPlus = input(true);
  readonly menuOpen = input(false);
  readonly dragging = input(false);
  readonly inputId = input('run-composer-input');
  readonly formTestId = input('run-composer');
  readonly inputTestId = input('run-composer-input');
  readonly sendTestId = input('run-composer-send');

  readonly valueChange = output<string>();
  readonly send = output<void>();
  readonly plus = output<void>();
  readonly pasted = output<ClipboardEvent>();
  readonly dragOver = output<DragEvent>();
  readonly dragLeave = output<void>();
  readonly dropped = output<DragEvent>();

  private readonly box = viewChild<ElementRef<HTMLTextAreaElement>>('box');
  /** More than one line: the pill's ends square off a little. */
  protected readonly tall = signal(false);

  constructor() {
    // A text set from outside (an example, Run again) sizes the box too.
    effect(() => {
      this.value();
      untracked(() => setTimeout(() => this.grow()));
    });
  }

  focus(): void {
    this.box()?.nativeElement.focus();
  }

  protected onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLTextAreaElement).value);
    this.grow();
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    this.trySend();
  }

  /**
   * Enter or the Send button. The host decides whether it sends: `canSend`
   * here can lag the text just typed until the next change detection.
   */
  protected trySend(): void {
    this.send.emit();
  }

  private grow(): void {
    const el = this.box()?.nativeElement;
    if (el === undefined) return;
    el.style.height = 'auto';
    const height = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${height}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
    this.tall.set(height > 40);
  }
}
