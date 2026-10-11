import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Loader2, LucideAngularModule } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { AdminOverview } from '../../models/admin.models';
import { AdminApiService } from '../../services/admin-api.service';
import {
  barHeights,
  errorMessage,
  formatCount,
  fullTime,
  plural,
  relativeTime,
  weekLabel,
  weeklyCaption,
} from '../../services/admin-format';
import { AdminDialog } from '../admin-dialog/admin-dialog';
import { InactiveMakersDialog } from '../inactive-makers-dialog/inactive-makers-dialog';
import {
  TransferAgentsDialog,
  TransferCandidate,
} from '../transfer-agents-dialog/transfer-agents-dialog';

type OverviewDialog = 'assign' | 'inspect' | 'clean-up';

export interface AttentionRow {
  key: OverviewDialog;
  text: string;
  count: number;
  badge: string;
  chip: string;
  action: string;
}

/** The three Needs attention rows, in order (admin R42, ui.md 4.18.2). */
export function attentionRows(overview: AdminOverview): AttentionRow[] {
  const { ownerlessAgents, erroredAgents, inactiveMakers } = overview.attention;
  const row = (
    key: OverviewDialog,
    text: string,
    count: number,
    noun: string,
    chip: string,
    action: string,
  ): AttentionRow => ({
    key,
    text,
    count,
    badge: plural(count, noun),
    chip: count === 0 ? 'chip-neutral' : chip,
    action,
  });
  return [
    row('assign', 'Agents without an active owner', ownerlessAgents.count, 'agent', 'chip-danger', 'Assign'),
    row('inspect', 'Agents with errors in the last 7 days', erroredAgents.count, 'agent', 'chip-danger', 'Inspect'),
    row('clean-up', 'Users inactive for 90+ days with Maker role', inactiveMakers.count, 'user', 'chip-neutral', 'Clean up'),
  ];
}

/**
 * The Overview tab (admin R41-R47, ui.md 4.18.2): the two tiles, Needs
 * attention with its Assign / Inspect / Clean up dialogs, the weekly active
 * users chart and Recent activity. Loads each time the tab is selected.
 */
@Component({
  selector: 'app-admin-overview',
  imports: [
    AdminDialog,
    InactiveMakersDialog,
    LucideAngularModule,
    TransferAgentsDialog,
  ],
  templateUrl: './admin-overview.html',
})
export class AdminOverviewTab implements OnInit {
  readonly Loader2 = Loader2;
  readonly formatCount = formatCount;

  private readonly api = inject(AdminApiService);
  private readonly toast = inject(ToastService);

  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  readonly error = signal('');
  readonly overview = signal<AdminOverview | null>(null);
  readonly dialog = signal<OverviewDialog | null>(null);

  readonly attention = computed(() => {
    const overview = this.overview();
    return overview ? attentionRows(overview) : [];
  });

  readonly weeks = computed(() => {
    const weeks = this.overview()?.weeklyActiveUsers ?? [];
    const heights = barHeights(weeks);
    return weeks.map((week, i) => ({
      ...week,
      label: weekLabel(week.weekStart),
      height: heights[i],
      current: i === weeks.length - 1,
      title: `Week of ${weekLabel(week.weekStart)}: ${plural(week.users, 'user')}`,
    }));
  });

  readonly caption = computed(() =>
    weeklyCaption(this.overview()?.weeklyActiveUsers ?? []),
  );

  readonly activity = computed(() =>
    (this.overview()?.recentActivity ?? []).map((item) => ({
      ...item,
      relative: relativeTime(item.at),
      full: fullTime(item.at),
    })),
  );

  readonly ownerless = computed<TransferCandidate[]>(() =>
    (this.overview()?.attention.ownerlessAgents.items ?? []).map((item) => ({
      id: item.agentId,
      name: item.agentName,
      description: `Former owner: ${item.formerOwner?.displayName ?? 'unknown user'}`,
    })),
  );

  readonly errored = computed(() =>
    (this.overview()?.attention.erroredAgents.items ?? []).map((item) => ({
      ...item,
      relative: relativeTime(item.lastErrorAt),
      full: fullTime(item.lastErrorAt),
    })),
  );

  readonly inactiveMakers = computed(
    () => this.overview()?.attention.inactiveMakers.items ?? [],
  );

  ngOnInit(): void {
    this.load();
  }

  /** Loads the overview; a reload keeps the current figures until it answers. */
  load(): void {
    if (this.state() !== 'ready') this.state.set('loading');
    this.api.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.state.set('ready');
      },
      error: (err) => {
        if (this.state() === 'ready') {
          this.toast.error(errorMessage(err));
          return;
        }
        this.error.set(errorMessage(err));
        this.state.set('error');
      },
    });
  }

  open(dialog: OverviewDialog): void {
    this.dialog.set(dialog);
  }

  close(): void {
    this.dialog.set(null);
  }

  /** A dialog changed something: close it and reload the figures. */
  closeAndReload(): void {
    this.close();
    this.load();
  }
}
