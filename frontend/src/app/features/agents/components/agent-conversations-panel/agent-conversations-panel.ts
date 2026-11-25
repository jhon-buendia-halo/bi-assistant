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
  untracked,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  Archive,
  ArrowLeft,
  History,
  LucideAngularModule,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  SquarePen,
} from 'lucide-angular';
import {
  CONVERSATIONS_PANEL_KEY,
  ConversationSummary,
} from '../../models/conversation.model';
import { ConversationsApiService } from '../../services/conversations-api.service';
import {
  PanelState,
  groupConversations,
  panelStateOf,
  relativeTime,
} from '../../services/conversations-panel.util';

/**
 * The left conversations panel of an agent's conversation (ui.md 4.5.12,
 * agents-evals R115): a 56 px strip by default, 272 px expanded, pushing the
 * chat. Its state is kept on this computer for every agent; first visit is
 * collapsed. Opening the dashboard panel collapses it without saving.
 */
@Component({
  selector: 'app-agent-conversations-panel',
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex shrink-0' },
  template: `
    @if (state() === 'collapsed') {
      <nav
        data-testid="conversations-panel"
        data-state="collapsed"
        aria-label="Conversations"
        class="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border bg-surface py-3"
      >
        <button
          type="button"
          data-testid="conversations-panel-toggle"
          [attr.aria-label]="'Show conversations · ' + total()"
          [attr.aria-expanded]="false"
          title="Show conversations"
          (click)="setStored('expanded')"
          class="btn btn-ghost btn-icon"
        >
          <lucide-angular [img]="PanelLeftOpen" [size]="18" />
        </button>
        <button
          type="button"
          data-testid="conversations-panel-new"
          aria-label="New conversation"
          title="New conversation"
          (click)="newConversation.emit()"
          class="btn btn-primary btn-icon rounded-full"
        >
          <lucide-angular [img]="Plus" [size]="18" />
        </button>
        <button
          type="button"
          data-testid="conversations-panel-history"
          [attr.aria-label]="'Conversations · ' + total()"
          title="Conversations"
          (click)="setStored('expanded')"
          class="btn btn-ghost btn-icon relative"
        >
          <lucide-angular [img]="History" [size]="18" />
          @if (total() > 0) {
            <span
              data-testid="conversations-panel-count"
              class="absolute -top-1 -right-1 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-on-primary"
              >{{ total() }}</span
            >
          }
        </button>
        <button
          type="button"
          data-testid="conversations-panel-archived"
          aria-label="Archived conversations"
          title="Archived conversations"
          (click)="openArchived()"
          class="btn btn-ghost btn-icon mt-auto"
        >
          <lucide-angular [img]="Archive" [size]="18" />
        </button>
      </nav>
    } @else {
      <nav
        data-testid="conversations-panel"
        data-state="expanded"
        aria-label="Conversations"
        class="flex w-[272px] shrink-0 flex-col border-r border-border bg-surface"
      >
        <div class="flex items-center gap-1 px-3 pt-3 pb-2">
          @if (archivedView()) {
            <button
              type="button"
              data-testid="conversations-panel-back"
              aria-label="Back to conversations"
              title="Back to conversations"
              (click)="archivedView.set(false)"
              class="btn btn-ghost btn-icon"
            >
              <lucide-angular [img]="ArrowLeft" [size]="16" />
            </button>
          }
          <h2
            data-testid="conversations-panel-title"
            class="m-0 min-w-0 flex-1 truncate text-[13px] font-semibold text-fg-strong"
          >
            {{
              archivedView()
                ? 'Archived conversations'
                : 'Conversations with ' + agentName()
            }}
          </h2>
          <button
            type="button"
            data-testid="conversations-panel-toggle"
            aria-label="Hide conversations"
            [attr.aria-expanded]="true"
            title="Hide conversations"
            (click)="setStored('collapsed')"
            class="btn btn-ghost btn-icon"
          >
            <lucide-angular [img]="PanelLeftClose" [size]="18" />
          </button>
        </div>
        <div class="flex flex-col gap-2 px-3 pb-2">
          <button
            type="button"
            data-testid="conversations-panel-new"
            (click)="newConversation.emit()"
            class="btn btn-secondary w-full justify-center"
          >
            <lucide-angular [img]="SquarePen" [size]="14" />
            <span>New conversation</span>
          </button>
          <label class="relative block">
            <span class="sr-only">Search conversations</span>
            <lucide-angular
              [img]="Search"
              [size]="14"
              class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted"
            />
            <input
              type="search"
              data-testid="conversations-panel-search"
              placeholder="Search conversations"
              [value]="searchText()"
              (input)="onSearch($any($event.target).value)"
              class="w-full rounded-md border border-border bg-surface py-1.5 pr-2 pl-8 text-[13px] text-fg placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-focus"
            />
          </label>
        </div>
        <div
          class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-2"
          tabindex="0"
          aria-label="Conversation list"
        >
          @for (group of groups(); track group.label) {
            <section data-testid="conversations-panel-group">
              <h3
                class="m-0 px-2 pb-1 text-[11px] font-semibold tracking-wider text-fg-muted uppercase"
              >
                {{ group.label }}
              </h3>
              <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
                @for (item of group.items; track item.id) {
                  <li>
                    <button
                      type="button"
                      data-testid="conversation-item"
                      [attr.aria-current]="
                        item.id === currentId() ? 'true' : null
                      "
                      (click)="open.emit(item)"
                      class="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
                      [class.bg-surface-selected]="item.id === currentId()"
                    >
                      <span
                        class="line-clamp-2 text-[13px] font-medium text-fg-strong"
                        >{{ item.title }}</span
                      >
                      <span class="truncate text-[11px] text-fg-muted"
                        >{{ item.datasets.join(', ') }} ·
                        {{ timeOf(item) }}</span
                      >
                    </button>
                  </li>
                }
              </ul>
            </section>
          } @empty {
            @if (loaded()) {
              <p
                data-testid="conversations-panel-empty"
                class="m-0 px-2 py-3 text-[13px] text-fg-muted"
              >
                {{ emptyText() }}
              </p>
            }
          }
        </div>
        @if (!archivedView()) {
          <div class="border-t border-border p-2">
            <button
              type="button"
              data-testid="conversations-panel-archived"
              (click)="openArchived()"
              class="btn btn-ghost w-full justify-start"
            >
              <lucide-angular [img]="Archive" [size]="14" />
              <span>Archived</span>
            </button>
          </div>
        }
      </nav>
    }
  `,
})
export class AgentConversationsPanel {
  protected readonly Archive = Archive;
  protected readonly ArrowLeft = ArrowLeft;
  protected readonly History = History;
  protected readonly PanelLeftClose = PanelLeftClose;
  protected readonly PanelLeftOpen = PanelLeftOpen;
  protected readonly Plus = Plus;
  protected readonly Search = Search;
  protected readonly SquarePen = SquarePen;

  private readonly api = inject(ConversationsApiService);

  /** The conversational binding whose conversations are listed. */
  readonly workflowId = input.required<string>();
  readonly agentName = input('Elena');
  /** The shown conversation, highlighted. */
  readonly currentId = input<string | null>(null);
  /** Changes when a run of the shown conversation starts or ends: the list reloads. */
  readonly refreshKey = input<string | null>(null);
  /** The page's dashboard panel is open: collapsed, without saving (R4). */
  readonly pushedAside = input(false);

  readonly open = output<ConversationSummary>();
  readonly newConversation = output<void>();

  private readonly stored = signal<PanelState>(readStored());
  protected readonly state = computed<PanelState>(() =>
    this.pushedAside() ? 'collapsed' : this.stored(),
  );

  protected readonly archivedView = signal(false);
  protected readonly searchText = signal('');
  private readonly query = signal('');
  protected readonly conversations = signal<ConversationSummary[]>([]);
  protected readonly loaded = signal(false);
  /** The not archived conversations, for the badge (unfiltered). */
  protected readonly total = signal(0);

  protected readonly groups = computed(() =>
    groupConversations(this.conversations(), new Date()),
  );
  protected readonly emptyText = computed(() => {
    const q = this.query().trim();
    if (this.archivedView()) return 'No archived conversations.';
    return q === ''
      ? `No conversations yet. Ask ${this.agentName()} a question to start one.`
      : `No conversations match "${q}".`;
  });

  private timer: ReturnType<typeof setTimeout> | undefined;
  private subscription: Subscription | undefined;

  constructor() {
    effect(() => {
      const workflowId = this.workflowId();
      const archived = this.archivedView();
      const q = this.query();
      this.refreshKey();
      untracked(() => this.load(workflowId, archived, q));
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.timer);
      this.subscription?.unsubscribe();
    });
  }

  private load(workflowId: string, archived: boolean, q: string): void {
    this.subscription?.unsubscribe();
    this.subscription = this.api
      .list({ workflowId, archived, q: archived ? '' : q })
      .subscribe({
        next: ({ conversations }) => {
          this.conversations.set(conversations);
          this.loaded.set(true);
          if (!archived && q.trim() === '')
            this.total.set(conversations.length);
        },
        error: () => {
          this.conversations.set([]);
          this.loaded.set(true);
        },
      });
  }

  protected setStored(state: PanelState): void {
    this.stored.set(state);
    try {
      localStorage.setItem(CONVERSATIONS_PANEL_KEY, state);
    } catch {
      // Storage unavailable: the state is kept while the page is open.
    }
  }

  protected openArchived(): void {
    this.archivedView.set(true);
    this.setStored('expanded');
  }

  /** Debounced 250 ms before the list asks for `q`. */
  protected onSearch(value: string): void {
    this.searchText.set(value);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.query.set(value), 250);
  }

  protected timeOf(item: ConversationSummary): string {
    return relativeTime(item.lastActivityAt, new Date());
  }
}

function readStored(): PanelState {
  try {
    return panelStateOf(localStorage.getItem(CONVERSATIONS_PANEL_KEY));
  } catch {
    return 'collapsed';
  }
}
