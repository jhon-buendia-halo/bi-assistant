import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  EllipsisVertical,
  Sparkles,
  Loader2,
  LucideAngularModule,
  Search,
  SquarePen,
  Trash2,
} from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  Session,
  sessionListAgent,
  sessionListSubtitle,
} from '../../models/session.model';

/** Sessions per page of the list (sessions-chat R63). */
export const SESSIONS_PAGE_SIZE = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** When a session last had activity: its update time, else its creation. */
export function sessionActivityAt(session: Session): string | null {
  return session.updatedAt ?? session.createdAt ?? null;
}

/**
 * The last activity of a row: `just now`, `5 min ago`, `2 h ago`,
 * `yesterday`, else a short date (sessions-chat R63).
 */
export function sessionActivityLabel(
  at: string | null,
  now: number = Date.now(),
): string {
  if (!at) return '';
  const time = Date.parse(at);
  if (Number.isNaN(time)) return '';
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  if (elapsed < 2 * DAY_MS) return 'yesterday';
  const date = new Date(time);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() === new Date(now).getFullYear()
        ? undefined
        : 'numeric',
  });
}

/**
 * The Sessions page's list (app-shell R3, sessions-chat R63): a search field
 * and one row per session, in the order the backend returns them.
 */
@Component({
  selector: 'app-sessions-list',
  imports: [LucideAngularModule],
  templateUrl: './sessions-list.html',
})
export class SessionsList {
  readonly sessions = input.required<Session[]>();
  readonly loading = input(false);
  readonly activeId = input<string | null>(null);
  readonly deletingId = input<string | null>(null);

  readonly openSession = output<Session>();
  readonly deleteSession = output<Session>();
  readonly newConversation = output<void>();

  protected readonly Search = Search;
  protected readonly Loader2 = Loader2;
  protected readonly SquarePen = SquarePen;
  protected readonly Trash2 = Trash2;
  protected readonly EllipsisVertical = EllipsisVertical;
  protected readonly Copy = Copy;
  protected readonly Sparkles = Sparkles;
  protected readonly ChevronLeft = ChevronLeft;
  protected readonly ChevronRight = ChevronRight;

  private readonly toast = inject(ToastService);

  readonly query = signal('');
  readonly menuOpen = signal<string | null>(null);
  /** 1-based page of the filtered list. */
  readonly page = signal(1);

  /** Sessions matching the search, by name or id. */
  readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.sessions();
    return this.sessions().filter(
      (s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q),
    );
  });

  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.visible().length / SESSIONS_PAGE_SIZE)),
  );

  readonly pageRows = computed(() => {
    const start = (this.page() - 1) * SESSIONS_PAGE_SIZE;
    return this.visible().slice(start, start + SESSIONS_PAGE_SIZE);
  });

  /** `11–20 of 37`. */
  readonly range = computed(() => {
    const total = this.visible().length;
    const start = (this.page() - 1) * SESSIONS_PAGE_SIZE + 1;
    const end = Math.min(total, start + SESSIONS_PAGE_SIZE - 1);
    return `${start}–${end} of ${total}`;
  });

  constructor() {
    // A deletion can empty the last page: stay on a page that exists.
    effect(() => {
      if (this.page() > this.pageCount()) this.page.set(this.pageCount());
    });
  }

  protected subtitle = sessionListSubtitle;
  protected agentName = sessionListAgent;

  protected activity(session: Session): string {
    return sessionActivityLabel(sessionActivityAt(session));
  }

  protected fullDate(session: Session): string | null {
    const at = sessionActivityAt(session);
    return at && !Number.isNaN(Date.parse(at))
      ? new Date(at).toLocaleString()
      : null;
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected goTo(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.pageCount()));
  }

  /** Copy a session's id, which a user shares to diagnose it (R62). */
  protected copyId(id: string): void {
    void navigator.clipboard.writeText(id).then(
      () => this.toast.success('Session ID copied'),
      () => this.toast.error('Copy failed'),
    );
  }

  protected toggleMenu(id: string): void {
    this.menuOpen.set(this.menuOpen() === id ? null : id);
  }

  protected delete(session: Session): void {
    this.menuOpen.set(null);
    this.deleteSession.emit(session);
  }
}
