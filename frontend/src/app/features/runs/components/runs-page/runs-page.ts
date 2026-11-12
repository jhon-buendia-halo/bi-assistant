import { Component, computed, effect, inject, signal } from '@angular/core';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  EllipsisVertical,
  Loader2,
  LucideAngularModule,
  Search,
  Trash2,
  Workflow,
} from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { SessionsState } from '../../../sessions/services/sessions-state';
import { SessionsList, sessionActivityLabel } from '../../../sessions/components/sessions-list/sessions-list';
import { WorkflowRunSummary } from '../../../workflows/models/workflow.model';
import {
  RUNS_PAGE_SIZE,
  filterRuns,
  runRowStatus,
} from '../../../workflows/services/workflows.util';
import { RunsState, RunsTab } from '../../services/runs-state';

/**
 * The Runs page (app-shell R3, R46; sessions-chat R63): two tabs. Runs lists
 * the stored runs, newest first, ten to a page with search and delete; Past
 * chats lists the old sessions, which open read-only.
 */
@Component({
  selector: 'app-runs-page',
  imports: [LucideAngularModule, SessionsList],
  templateUrl: './runs-page.html',
})
export class RunsPage {
  protected readonly runsState = inject(RunsState);
  protected readonly sessions = inject(SessionsState);
  private readonly toast = inject(ToastService);

  protected readonly Search = Search;
  protected readonly Loader2 = Loader2;
  protected readonly Trash2 = Trash2;
  protected readonly EllipsisVertical = EllipsisVertical;
  protected readonly Copy = Copy;
  protected readonly Workflow = Workflow;
  protected readonly ChevronLeft = ChevronLeft;
  protected readonly ChevronRight = ChevronRight;

  protected readonly tabs: { id: RunsTab; label: string }[] = [
    { id: 'runs', label: 'Runs' },
    { id: 'past-chats', label: 'Past chats' },
  ];

  readonly query = signal('');
  readonly menuOpen = signal<string | null>(null);
  readonly page = signal(1);

  readonly visible = computed(() =>
    filterRuns(this.runsState.runs(), this.query()),
  );
  readonly pageCount = computed(() =>
    Math.max(1, Math.ceil(this.visible().length / RUNS_PAGE_SIZE)),
  );
  readonly pageRows = computed(() => {
    const start = (this.page() - 1) * RUNS_PAGE_SIZE;
    return this.visible().slice(start, start + RUNS_PAGE_SIZE);
  });
  readonly range = computed(() => {
    const total = this.visible().length;
    const start = (this.page() - 1) * RUNS_PAGE_SIZE + 1;
    const end = Math.min(total, start + RUNS_PAGE_SIZE - 1);
    return `${start}–${end} of ${total}`;
  });

  constructor() {
    // A run made since the page last showed is in the list.
    this.runsState.loadRuns();
    effect(() => {
      if (this.page() > this.pageCount()) this.page.set(this.pageCount());
    });
  }

  protected status = runRowStatus;

  protected when(run: WorkflowRunSummary): string {
    return sessionActivityLabel(run.startedAt);
  }

  protected fullDate(run: WorkflowRunSummary): string | null {
    return Number.isNaN(Date.parse(run.startedAt))
      ? null
      : new Date(run.startedAt).toLocaleString();
  }

  protected onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.page.set(1);
  }

  protected goTo(page: number): void {
    this.page.set(Math.min(Math.max(1, page), this.pageCount()));
  }

  protected copyId(id: string): void {
    void navigator.clipboard.writeText(id).then(
      () => this.toast.success('Run ID copied'),
      () => this.toast.error('Copy failed'),
    );
  }

  protected delete(run: WorkflowRunSummary): void {
    this.menuOpen.set(null);
    this.runsState.deleteRun(run);
  }

  protected selectTab(tab: RunsTab): void {
    this.runsState.setTab(tab);
  }
}
