import {
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Loader2, LucideAngularModule, X } from 'lucide-angular';
import { AuthService } from '../../../../core/auth/auth.service';
import { ToastService } from '../../../../core/toast/toast.service';
import { DatasourcesApiService } from '../../../datasources/services/datasources-api.service';
import {
  AGENT_STATUS,
  AdminUserDetail,
  ROLE_DESCRIPTIONS,
  STATUS_CHIPS,
  STATUS_LABELS,
} from '../../models/admin.models';
import { AdminApiService } from '../../services/admin-api.service';
import { errorMessage } from '../../services/admin-format';
import {
  NO_DATASOURCE_REASON,
  RoleRow,
  desiredGrants,
  initialTicks,
  roleRows,
  saveBlocker,
} from '../../services/user-roles';
import { DatasourceOption } from '../role-fields/role-fields';
import {
  TransferAgentsDialog,
  TransferCandidate,
} from '../transfer-agents-dialog/transfer-agents-dialog';

let nextId = 0;

/**
 * The user detail panel beside the users table (admin R58-R64, ui.md
 * 4.18.4): the user's status, their role checkboxes (direct roles editable,
 * roles from groups, the bootstrap list or your own Platform admin locked
 * with the reason), their read-only groups, the agents they own, Transfer
 * ownership and Save changes. The host re-creates it for each user, so
 * changes not saved are discarded when another user is selected.
 */
@Component({
  selector: 'app-user-detail-panel',
  imports: [LucideAngularModule, TransferAgentsDialog],
  templateUrl: './user-detail-panel.html',
  host: { class: 'block' },
})
export class UserDetailPanel implements OnInit {
  readonly Loader2 = Loader2;
  readonly X = X;
  readonly statusLabels = STATUS_LABELS;
  readonly statusChips = STATUS_CHIPS;
  readonly agentStatus = AGENT_STATUS;
  readonly dataOwnerDescription = ROLE_DESCRIPTIONS['data-owner'];
  readonly noDatasourceReason = NO_DATASOURCE_REASON;

  private readonly api = inject(AdminApiService);
  private readonly datasourcesApi = inject(DatasourcesApiService);
  private readonly toast = inject(ToastService);
  /** Org server or local mode: the groups heading and reasons differ (R74). */
  readonly auth = inject(AuthService);

  readonly userId = input.required<string>();
  /** Close user details, or Escape (R58). */
  readonly close = output<void>();
  /** Roles or ownership changed: the table reloads. */
  readonly changed = output<void>();

  readonly id = `admin-user-panel-${++nextId}`;
  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  readonly error = signal('');
  readonly detail = signal<AdminUserDetail | null>(null);
  readonly datasources = signal<DatasourceOption[]>([]);

  readonly ticks = signal<ReadonlySet<string>>(new Set());
  readonly addDataOwner = signal(false);
  readonly newDatasourceId = signal('');
  readonly saving = signal(false);
  readonly transferring = signal(false);

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  private focused = false;

  readonly rows = computed(() => {
    const detail = this.detail();
    return detail ? roleRows(detail, this.auth.isLocal()) : [];
  });

  /** Datasources the user does not own yet (R59). */
  readonly offered = computed(() => {
    const owned = new Set(this.rows().map((row) => row.datasourceId).filter(Boolean));
    return this.datasources().filter((ds) => !owned.has(ds.id));
  });

  readonly saveBlocker = computed(() =>
    saveBlocker(this.rows(), this.ticks(), this.addDataOwner(), this.newDatasourceId()),
  );

  readonly agents = computed(() => this.detail()?.agents ?? []);

  readonly transferCandidates = computed<TransferCandidate[]>(() =>
    this.agents().map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: AGENT_STATUS[agent.status].label,
    })),
  );

  readonly transferIntro = computed(() => {
    const name = this.detail()?.displayName ?? '';
    return `Move agents from ${name} to another user. Sessions already started from them stay with ${name} and continue with the assistant.`;
  });

  ngOnInit(): void {
    this.load();
    this.datasourcesApi.list().subscribe({
      next: (res) =>
        this.datasources.set(
          res.datasources
            .map((ds) => ({ id: ds.id, name: ds.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      error: () => this.datasources.set([]),
    });
  }

  /** Loads the user; a reload after a save keeps the panel until it answers. */
  load(): void {
    if (this.state() !== 'ready') this.state.set('loading');
    this.api.user(this.userId()).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.ticks.set(initialTicks(roleRows(detail, this.auth.isLocal())));
        this.addDataOwner.set(false);
        this.newDatasourceId.set('');
        this.state.set('ready');
        if (!this.focused) {
          this.focused = true;
          setTimeout(() => this.heading()?.nativeElement.focus());
        }
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

  isTicked(row: RoleRow): boolean {
    return this.ticks().has(row.key);
  }

  toggle(row: RoleRow): void {
    if (row.locked) return;
    const next = new Set(this.ticks());
    if (next.has(row.key)) next.delete(row.key);
    else next.add(row.key);
    this.ticks.set(next);
  }

  toggleAddDataOwner(): void {
    const ticked = !this.addDataOwner();
    this.addDataOwner.set(ticked);
    if (!ticked) this.newDatasourceId.set('');
  }

  /** Escape inside the panel closes it (a dialog or picker stops its own Escape). */
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || this.transferring()) return;
    event.preventDefault();
    this.close.emit();
  }

  /** **Save changes**: replaces the direct roles, all or nothing (R62). */
  save(): void {
    const detail = this.detail();
    if (!detail || this.saving() || this.saveBlocker() !== null) return;
    const roles = desiredGrants(
      this.rows(),
      this.ticks(),
      this.addDataOwner() ? this.newDatasourceId() : null,
    );
    this.saving.set(true);
    this.api.saveRoles(detail.id, roles).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.toast.success(res.message);
        this.load();
        this.changed.emit();
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(errorMessage(err));
      },
    });
  }

  onTransferred(): void {
    this.transferring.set(false);
    this.load();
    this.changed.emit();
  }
}
