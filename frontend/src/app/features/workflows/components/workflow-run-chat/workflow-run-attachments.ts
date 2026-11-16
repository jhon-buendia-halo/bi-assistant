import { Component, ElementRef, input, output, viewChild } from '@angular/core';
import { LucideAngularModule, Paperclip, X } from 'lucide-angular';
import { IMAGE_ACCEPT } from '../../services/workflow-input-validation';

/**
 * The reference images of a run's composer (workflows R35; ui.md 4.4b): a
 * paperclip that opens the file picker and a thumbnail for each image, with
 * a button to remove it. It only shows the list and reports what the user
 * did: the picked files and the index to remove. The composer owns the list,
 * checks the files (`composer-images.util.ts`) and takes the paste and the
 * drop on its own box.
 */
@Component({
  selector: 'app-workflow-run-attachments',
  imports: [LucideAngularModule],
  templateUrl: './workflow-run-attachments.html',
  styles: `
    .thumb {
      position: relative;
      display: block;
      height: 3.5rem;
      width: 3.5rem;
    }
    .thumb img {
      height: 100%;
      width: 100%;
      border: 1px solid var(--qti-border);
      border-radius: 0.375rem;
      background-color: var(--qti-surface-muted);
      object-fit: cover;
    }
    .thumb-remove {
      position: absolute;
      top: -0.375rem;
      right: -0.375rem;
      display: inline-flex;
      height: 1.25rem;
      width: 1.25rem;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--qti-border-strong);
      border-radius: 9999px;
      background-color: var(--qti-surface);
      color: var(--qti-fg);
      cursor: pointer;
    }
    .thumb-remove:hover {
      background-color: var(--qti-surface-muted);
    }
    .thumb-remove:focus-visible {
      outline: 2px solid var(--qti-focus);
      outline-offset: 2px;
    }
  `,
  host: { class: 'block' },
})
export class WorkflowRunAttachments {
  protected readonly Paperclip = Paperclip;
  protected readonly X = X;

  /** What each thumbnail shows: a `data:` URL, or the run's input-image URL. */
  readonly images = input.required<readonly string[]>();
  /** The field's label, shown above the row when `showLabel` is on. */
  readonly label = input('Reference images');
  readonly showLabel = input(true);
  /** The most images; the paperclip is disabled at the limit. */
  readonly max = input(4);
  /** One line under the row (the field's help). */
  readonly help = input<string | null>(null);
  /** The refusal to show (a file refused, or the form's error). */
  readonly error = input<string | null>(null);

  /** Files chosen in the picker. */
  readonly picked = output<File[]>();
  /** The index of the thumbnail whose remove button was pressed. */
  readonly removed = output<number>();

  private readonly file = viewChild<ElementRef<HTMLInputElement>>('file');

  protected readonly accept = IMAGE_ACCEPT;

  protected openPicker(): void {
    this.file()?.nativeElement.click();
  }

  protected onFiles(event: Event): void {
    const control = event.target as HTMLInputElement;
    const files = Array.from(control.files ?? []);
    // Reset, so choosing the same file again fires `change`.
    control.value = '';
    if (files.length > 0) this.picked.emit(files);
  }
}
