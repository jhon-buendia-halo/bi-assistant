import { Component, computed, input } from '@angular/core';

/**
 * One turn of the run chat (ui.md 4.4b): what the user sent as a right
 * aligned bubble; an agent's turn on the left with its avatar letter and
 * `Name · Role` above a rounded bubble. `bubble = false` keeps the agent's
 * row and caption but leaves the content bare (a run's answer, its team).
 * Whatever follows the bubble in the agent's column (choices, actions) is
 * projected as `[messageAfter]`.
 */
@Component({
  selector: 'app-run-message',
  host: {
    class: 'flex min-w-0 gap-2.5',
    '[class.justify-end]': "from() === 'user'",
  },
  template: `
    @if (from() === 'agent') {
      <span
        aria-hidden="true"
        class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-info-soft text-[12px] font-semibold text-on-info-soft"
        >{{ initial() }}</span
      >
    }
    <div [class]="columnClass()">
      @if (from() === 'agent' && caption()) {
        <p class="m-0 -mb-1.5 text-[12px] text-fg-muted">{{ caption() }}</p>
      }
      <div [attr.data-testid]="bubbleTestId()" [class]="bubbleClass()">
        <ng-content />
      </div>
      <ng-content select="[messageAfter]" />
    </div>
  `,
})
export class RunMessage {
  readonly from = input<'user' | 'agent'>('agent');
  /** The agent's name, for its caption and avatar letter. */
  readonly name = input('');
  readonly role = input('');
  readonly bubble = input(true);

  protected readonly initial = computed(
    () => this.name().trim().charAt(0).toUpperCase() || '?',
  );
  protected readonly caption = computed(() =>
    [this.name(), this.role()].filter((part) => part.trim() !== '').join(' · '),
  );

  protected readonly columnClass = computed(() => {
    const base = 'flex min-w-0 flex-col gap-2.5';
    if (this.from() === 'user') return `${base} max-w-[85%] items-end`;
    return this.bubble() ? `${base} max-w-[85%]` : `${base} flex-1`;
  });

  protected readonly bubbleTestId = computed(() => {
    if (this.from() === 'user') return 'run-user-message';
    return this.bubble() ? 'run-agent-message' : null;
  });

  protected readonly bubbleClass = computed(() => {
    if (this.from() === 'user') {
      return 'rounded-[18px] bg-primary-soft px-4 py-2.5 text-[14px] leading-normal break-words whitespace-pre-wrap text-fg-strong';
    }
    return this.bubble()
      ? 'rounded-[18px] border border-border bg-surface-muted px-4 py-2.5 text-[14px] leading-normal break-words text-fg'
      : 'flex min-w-0 flex-col gap-3';
  });
}
