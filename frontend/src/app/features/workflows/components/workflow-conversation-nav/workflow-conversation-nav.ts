import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

/** One question of the conversation, as the navigation lists it. */
export interface ConversationNavItem {
  /** The turn's run id, or `current` for the run shown last. */
  id: string;
  label: string;
}

/**
 * The Business view's conversation navigation (workflows R38; ui.md 4.4b),
 * in the style of a chat minimap: one short tick per question on the
 * chat's right edge, the one in view brighter. Hovering it, or tabbing into
 * it, opens the list of questions beside it; picking one scrolls the chat
 * to that question.
 */
@Component({
  selector: 'app-workflow-conversation-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav
      aria-label="Conversation"
      data-testid="workflow-conversation-nav"
      class="group relative flex flex-col items-end gap-[7px] px-1 py-2"
    >
      @for (item of items(); track item.id) {
        <span
          aria-hidden="true"
          data-testid="workflow-conversation-tick"
          class="block h-[3px] w-6 rounded-full transition-colors"
          [class.bg-fg-muted]="item.id === active()"
          [class.bg-border-strong]="item.id !== active()"
        ></span>
      }
      <ul
        data-testid="workflow-conversation-list"
        class="pointer-events-none absolute top-0 right-full z-30 m-0 mr-2 flex w-72 list-none flex-col gap-0.5 rounded-xl border border-border bg-surface p-1.5 opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
      >
        @for (item of items(); track item.id) {
          <li>
            <button
              type="button"
              [attr.data-testid]="'workflow-conversation-item-' + $index"
              [attr.aria-current]="item.id === active() ? 'true' : null"
              [title]="item.label"
              (click)="pick.emit(item.id)"
              class="block w-full truncate rounded-lg px-3 py-2 text-left text-[13px] text-fg hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
              [class.bg-surface-selected]="item.id === active()"
            >
              {{ item.label }}
            </button>
          </li>
        }
      </ul>
    </nav>
  `,
})
export class WorkflowConversationNav {
  readonly items = input.required<ConversationNavItem[]>();
  /** The id of the question in view. */
  readonly active = input<string | null>(null);
  readonly pick = output<string>();
}
