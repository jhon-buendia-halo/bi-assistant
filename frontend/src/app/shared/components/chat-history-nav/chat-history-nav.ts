import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

/** One message the user sent, as the navigation lists it. */
export interface ChatHistoryItem {
  /** Matches the `data-history-id` of the message's element in the chat. */
  id: string;
  label: string;
}

/**
 * Chat-history navigation, "Conductor style" (ui.md, Chat-history navigation;
 * workflows R38). One short tick per message the user sent, on the chat's
 * edge, the one in view brighter. Hovering it, or tabbing into it, opens the
 * list of those messages (oldest first); picking one scrolls the chat to it.
 * Shown only when the chat holds two or more user messages.
 *
 * The host passes its scroll container and marks each user message element
 * with `data-history-id="<id>"`.
 */
@Component({
  selector: 'app-chat-history-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length >= 2) {
      <nav
        [attr.aria-label]="label()"
        [attr.data-testid]="testIdPrefix() + '-nav'"
        class="group relative flex flex-col items-end gap-[7px] px-1 py-2"
      >
        @for (item of items(); track item.id) {
          <span
            aria-hidden="true"
            [attr.data-testid]="testIdPrefix() + '-tick'"
            class="block h-[3px] w-6 rounded-full transition-colors"
            [class.bg-fg-muted]="item.id === current()"
            [class.bg-border-strong]="item.id !== current()"
          ></span>
        }
        <ul
          [attr.data-testid]="testIdPrefix() + '-list'"
          class="pointer-events-none absolute top-0 right-full z-30 m-0 mr-2 flex max-h-72 w-72 max-w-[calc(100vw-5rem)] list-none flex-col gap-0.5 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 opacity-0 shadow-lg transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        >
          @for (item of items(); track item.id) {
            <li>
              <button
                type="button"
                [attr.data-testid]="testIdPrefix() + '-item-' + $index"
                [attr.aria-current]="item.id === current() ? 'true' : null"
                [title]="item.label"
                (click)="pick(item.id)"
                class="block w-full truncate rounded-lg px-3 py-2 text-left text-[13px] text-fg hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
                [class.bg-surface-selected]="item.id === current()"
              >
                {{ item.label }}
              </button>
            </li>
          }
        </ul>
      </nav>
    }
  `,
})
export class ChatHistoryNav {
  /** The chat's scrolling element. */
  readonly container = input.required<HTMLElement | null | undefined>();
  readonly items = input.required<ChatHistoryItem[]>();
  /** The landmark's accessible name. */
  readonly label = input('Chat history');
  /** Prefix of the test ids: `<prefix>-nav`, `-tick`, `-list`, `-item-<n>`. */
  readonly testIdPrefix = input('chat-history');
  /** Emits the id of the message just picked, after the chat scrolled to it. */
  readonly picked = output<string>();

  private readonly active = signal<string | null>(null);
  /** The message in view; the last one until the chat is measured. */
  protected readonly current = computed(
    () => this.active() ?? this.items().at(-1)?.id ?? null,
  );

  private readonly destroyRef = inject(DestroyRef);
  private cleanup: (() => void) | null = null;

  constructor() {
    effect(() => {
      const el = this.container();
      const items = this.items();
      this.cleanup?.();
      this.cleanup = null;
      if (!el || items.length < 2) return;
      const update = () => this.update(el, items);
      el.addEventListener('scroll', update, { passive: true });
      const resize =
        typeof ResizeObserver === 'undefined'
          ? null
          : new ResizeObserver(update);
      resize?.observe(el);
      const mutation =
        typeof MutationObserver === 'undefined'
          ? null
          : new MutationObserver(update);
      mutation?.observe(el, { childList: true, subtree: true });
      this.cleanup = () => {
        el.removeEventListener('scroll', update);
        resize?.disconnect();
        mutation?.disconnect();
      };
      update();
    });
    this.destroyRef.onDestroy(() => this.cleanup?.());
  }

  /** The last message whose top passed a third of the chat; the last one at the bottom. */
  private update(el: HTMLElement, items: ChatHistoryItem[]): void {
    const line = el.getBoundingClientRect().top + el.clientHeight / 3;
    const ids = new Set(items.map((i) => i.id));
    let active: string | null = null;
    let first = true;
    for (const node of Array.from(
      el.querySelectorAll<HTMLElement>('[data-history-id]'),
    )) {
      const id = node.dataset['historyId'] ?? '';
      if (!ids.has(id)) continue;
      if (first || node.getBoundingClientRect().top <= line) active = id;
      first = false;
    }
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 8) {
      active = items.at(-1)?.id ?? active;
    }
    this.active.set(active);
  }

  protected pick(id: string): void {
    const el = this.container();
    const node = el?.querySelector<HTMLElement>(
      `[data-history-id="${CSS.escape(id)}"]`,
    );
    if (!el || !node) return;
    el.scrollTop +=
      node.getBoundingClientRect().top - el.getBoundingClientRect().top - 8;
    this.active.set(id);
    this.picked.emit(id);
  }
}
