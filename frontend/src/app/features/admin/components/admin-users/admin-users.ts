import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Subscription } from 'rxjs';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  LucideAngularModule,
  Search,
} from 'lucide-angular';
import { RoleId } from '../../../../core/auth/auth.models';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  AdminGroupRow,
  AdminUserRow,
  DirectoryCounts,
  NO_GROUPS_YET,
  ROLE_BADGE_ORDER,
  ROLE_CHIPS,
  ROLE_LABELS,
  STATUS_CHIPS,
  STATUS_LABELS,
  UsersFilter,
  roleBadgeLabel,
} from '../../models/admin.models';
import { AdminApiService } from '../../services/admin-api.service';
import {
  errorMessage,
  formatCount,
  fullTime,
  lastActiveLabel,
  pageRange,
  relativeTime,
} from '../../services/admin-format';

/** Rows per page (admin R53). */
export const PAGE_SIZE = 25;
/** Delay after the last keystroke before searching (ui.md 4.18.3). */
export const SEARCH_DEBOUNCE_MS = 250;

export type DirectoryView = 'users' | 'groups';

/** The role filter chips, in order (admin R51). */
export function filterChips(
  counts: DirectoryCounts,
): { filter: UsersFilter; label: string }[] {
  return [
    { filter: 'all', label: 'All roles' },
    { filter: 'platform-admin', label: `Platform admins · ${formatCount(counts.platformAdmins)}` },
    { filter: 'approver', label: `Approvers · ${formatCount(counts.approvers)}` },
    { filter: 'data-owner', label: `Data owners · ${formatCount(counts.dataOwners)}` },
    { filter: 'maker', label: `Makers · ${formatCount(counts.makers)}` },
    { filter: 'inactive', label: `Inactive 90d · ${formatCount(counts.inactive)}` },
  ];
}

/** A user's role badges: every role once, in badge order; User alone (admin R52). */
export function roleBadges(row: AdminUserRow): { label: string; chip: string }[] {
  const roles: RoleId[] = ROLE_BADGE_ORDER.filter((role) => row.roles.includes(role));
  return (roles.length ? roles : (['user'] as RoleId[])).map((role) => ({
    label: ROLE_LABELS[role],
    chip: ROLE_CHIPS[role],
  }));
}

/** What an empty table says (admin R57). */
export function emptyMessage(view: DirectoryView, query: string): string {
  if (view === 'users') {
    return query ? 'No users match your search.' : 'No users match this filter.';
  }
  return query ? 'No groups match your search.' : NO_GROUPS_YET;
}

/**
 * The Users & groups tab (admin R49-R57, ui.md 4.18.3): the Users / Groups
 * switch with counts, search, the role filter chips, the table paged by 25,
 * the last sync note and the pagination. The view, search, chip and page
 * reset each time the tab opens, since the tab is created on selection.
 */
@Component({
  selector: 'app-admin-users',
  imports: [LucideAngularModule],
  templateUrl: './admin-users.html',
})
export class AdminUsersTab implements OnInit, OnDestroy {
  readonly ChevronLeft = ChevronLeft;
  readonly ChevronRight = ChevronRight;
  readonly Loader2 = Loader2;
  readonly Search = Search;
  readonly statusLabels = STATUS_LABELS;
  readonly statusChips = STATUS_CHIPS;
  readonly roleBadges = roleBadges;
  readonly lastActiveLabel = lastActiveLabel;
  readonly formatCount = formatCount;

  private readonly api = inject(AdminApiService);
  private readonly toast = inject(ToastService);

  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  readonly error = signal('');

  readonly view = signal<DirectoryView>('users');
  /** The search field's text; `query` follows it 250 ms after typing stops. */
  readonly text = signal('');
  readonly query = signal('');
  readonly filter = signal<UsersFilter>('all');
  readonly page = signal(1);

  readonly users = signal<AdminUserRow[]>([]);
  readonly groups = signal<AdminGroupRow[]>([]);
  readonly total = signal(0);
  readonly counts = signal<DirectoryCounts | null>(null);
  readonly lastSyncAt = signal<string | null>(null);

  /** The user whose detail panel is open (admin R58). */
  readonly selectedId = signal<string | null>(null);

  readonly chips = computed(() => {
    const counts = this.counts();
    return counts ? filterChips(counts) : [];
  });
  readonly range = computed(() => pageRange(this.page(), PAGE_SIZE, this.total()));
  readonly lastPage = computed(() => this.page() * PAGE_SIZE >= this.total());
  readonly empty = computed(() =>
    this.view() === 'users' ? this.users().length === 0 : this.groups().length === 0,
  );
  readonly emptyMessage = computed(() => emptyMessage(this.view(), this.query()));
  readonly lastSync = computed(() => {
    const at = this.lastSyncAt();
    return at ? { relative: relativeTime(at), full: fullTime(at) } : null;
  });

  private request?: Subscription;
  private timer: ReturnType<typeof setTimeout> | null = null;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
    this.clearTimer();
  }

  /** Loads the current view's page; the first load shows the loading line. */
  load(): void {
    this.request?.unsubscribe();
    if (this.state() !== 'ready') this.state.set('loading');
    const failed = (err: unknown) => {
      if (this.state() === 'ready') {
        this.toast.error(errorMessage(err));
        return;
      }
      this.error.set(errorMessage(err));
      this.state.set('error');
    };
    if (this.view() === 'users') {
      this.request = this.api
        .users({
          q: this.query(),
          filter: this.filter(),
          page: this.page(),
          pageSize: PAGE_SIZE,
        })
        .subscribe({
          next: (res) => {
            this.users.set(res.items);
            this.total.set(res.total);
            this.counts.set(res.counts);
            this.lastSyncAt.set(res.lastSyncAt);
            this.state.set('ready');
          },
          error: failed,
        });
    } else {
      this.request = this.api
        .groups({ q: this.query(), page: this.page(), pageSize: PAGE_SIZE })
        .subscribe({
          next: (res) => {
            this.groups.set(res.items);
            this.total.set(res.total);
            this.state.set('ready');
          },
          error: failed,
        });
    }
  }

  /** Reloads the current page (after Assign role, a save or a transfer). */
  reload(): void {
    this.load();
  }

  setView(view: DirectoryView): void {
    if (this.view() === view) return;
    this.view.set(view);
    this.clearTimer();
    this.text.set('');
    this.query.set('');
    this.page.set(1);
    this.selectedId.set(null);
    this.load();
  }

  /** Arrow keys switch the view, as for any tab list. */
  onViewKeydown(event: KeyboardEvent, buttons: HTMLElement[]): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: DirectoryView =
      event.key === 'Home'
        ? 'users'
        : event.key === 'End'
          ? 'groups'
          : this.view() === 'users'
            ? 'groups'
            : 'users';
    this.setView(next);
    buttons[next === 'users' ? 0 : 1]?.focus();
  }

  onSearch(value: string): void {
    this.text.set(value);
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      const query = value.trim();
      if (query === this.query()) return;
      this.query.set(query);
      this.page.set(1);
      this.load();
    }, SEARCH_DEBOUNCE_MS);
  }

  setFilter(filter: UsersFilter): void {
    if (this.filter() === filter) return;
    this.filter.set(filter);
    this.page.set(1);
    this.load();
  }

  previousPage(): void {
    if (this.page() === 1) return;
    this.page.update((page) => page - 1);
    this.load();
  }

  nextPage(): void {
    if (this.lastPage()) return;
    this.page.update((page) => page + 1);
    this.load();
  }

  select(user: AdminUserRow): void {
    this.selectedId.set(user.id);
  }

  groupBadges(group: AdminGroupRow): { label: string; chip: string }[] {
    return group.mappings.map((mapping) => ({
      label: roleBadgeLabel(mapping.role, mapping.datasourceName),
      chip: ROLE_CHIPS[mapping.role],
    }));
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
