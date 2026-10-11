import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';

let nextId = 0;

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The frame of every admin dialog (ui.md 4.18.1): a scrim and a centred
 * card labelled by its title and described by its intro. Focus moves to the
 * first control when it opens, stays inside while it is open, and returns to
 * the opener when it closes. Escape asks to close it, unless `busy`.
 * Project the body as content and the buttons with `dialogActions`.
 */
@Component({
  selector: 'app-admin-dialog',
  template: `
    <div class="fixed inset-0 z-40 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-fg-strong/40" aria-hidden="true"></div>
      <div
        #box
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="id + '-title'"
        [attr.aria-describedby]="intro() ? id + '-intro' : null"
        (keydown)="onKeydown($event)"
        class="relative flex max-h-full w-[560px] max-w-full flex-col overflow-y-auto rounded-2xl border border-border bg-surface p-6 shadow-2xl"
      >
        <h2
          [id]="id + '-title'"
          class="text-[16px] leading-6 font-semibold text-fg-strong"
        >
          {{ title() }}
        </h2>
        @if (intro()) {
          <p [id]="id + '-intro'" class="mt-1 text-[13px] text-fg-muted">
            {{ intro() }}
          </p>
        }
        <div class="mt-5">
          <ng-content />
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <ng-content select="[dialogActions]" />
        </div>
      </div>
    </div>
  `,
})
export class AdminDialog implements OnDestroy {
  readonly title = input.required<string>();
  readonly intro = input('');
  /** While an action runs, Escape does nothing. */
  readonly busy = input(false);
  /** Escape: the host closes the dialog without changes. */
  readonly dismiss = output<void>();

  readonly id = `admin-dialog-${++nextId}`;

  private readonly box = viewChild.required<ElementRef<HTMLElement>>('box');
  private readonly opener = inject(DOCUMENT).activeElement as HTMLElement | null;

  constructor() {
    afterNextRender(() => this.focusables()[0]?.focus());
  }

  ngOnDestroy(): void {
    if (this.opener?.isConnected) this.opener.focus();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!this.busy()) this.dismiss.emit();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = this.focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.box().nativeElement.ownerDocument.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(): HTMLElement[] {
    return Array.from(
      this.box().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => !el.hidden && el.getClientRects().length > 0);
  }
}
