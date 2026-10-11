import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Subscription, forkJoin } from 'rxjs';
import { Check, Loader2, LucideAngularModule, Plus, X } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import {
  GroupRoleMapping,
  MATRIX_ROLES,
  NO_GROUPS_YET,
  PERMISSION_MATRIX,
  ROLE_CHIPS,
  ROLE_LABELS,
  roleBadgeLabel,
} from '../../models/admin.models';
import { AdminApiService } from '../../services/admin-api.service';
import { errorMessage } from '../../services/admin-format';
import { AddMappingDialog } from '../add-mapping-dialog/add-mapping-dialog';

/** The label of a mapping's role (`Data owner · <datasource>` for Data owner). */
export const mappingRoleLabel = (mapping: GroupRoleMapping): string =>
  roleBadgeLabel(mapping.role, mapping.datasourceName ?? mapping.datasourceId);

/** The removal confirmation (admin R68, ui.md 4.18.5). */
export function removeMappingQuestion(mapping: GroupRoleMapping): string {
  const role = mappingRoleLabel(mapping);
  return (
    `Remove the mapping “${mapping.groupName} → ${role}”?\n\n` +
    `Members of ${mapping.groupName} lose the ${role} role on their next request, unless they hold it another way.`
  );
}

/**
 * The Roles & permissions tab (admin R65-R68, ui.md 4.18.5): the read-only
 * permission matrix, built from admin R21, and the group mappings with Add
 * mapping and remove-with-confirmation.
 */
@Component({
  selector: 'app-admin-roles',
  imports: [AddMappingDialog, LucideAngularModule],
  templateUrl: './admin-roles.html',
})
export class AdminRolesTab implements OnInit, OnDestroy {
  readonly Check = Check;
  readonly Loader2 = Loader2;
  readonly Plus = Plus;
  readonly X = X;
  readonly matrix = PERMISSION_MATRIX;
  readonly matrixRoles = MATRIX_ROLES;
  readonly roleLabels = ROLE_LABELS;
  readonly roleChips = ROLE_CHIPS;
  readonly noGroupsYet = NO_GROUPS_YET;
  readonly mappingRoleLabel = mappingRoleLabel;

  private readonly api = inject(AdminApiService);
  private readonly toast = inject(ToastService);

  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  readonly error = signal('');
  readonly mappings = signal<GroupRoleMapping[]>([]);
  /** Whether the directory holds any group (Add mapping needs one, R67). */
  readonly hasGroups = signal(false);
  readonly adding = signal(false);
  readonly removingId = signal<string | null>(null);

  private request?: Subscription;

  ngOnInit(): void {
    this.load();
  }

  ngOnDestroy(): void {
    this.request?.unsubscribe();
  }

  load(): void {
    this.request?.unsubscribe();
    if (this.state() !== 'ready') this.state.set('loading');
    this.request = forkJoin({
      mappings: this.api.roleMappings(),
      groups: this.api.groups({ pageSize: 1 }),
    }).subscribe({
      next: ({ mappings, groups }) => {
        this.mappings.set(mappings.mappings);
        this.hasGroups.set(groups.total > 0);
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

  grants(roles: readonly string[], role: string): boolean {
    return roles.includes(role);
  }

  /** Removes a mapping after the confirmation (R68). */
  remove(mapping: GroupRoleMapping): void {
    if (this.removingId() || !window.confirm(removeMappingQuestion(mapping))) return;
    this.removingId.set(mapping.id);
    this.api.removeRoleMapping(mapping.id).subscribe({
      next: (res) => {
        this.removingId.set(null);
        this.toast.success(res.message);
        this.load();
      },
      error: (err) => {
        this.removingId.set(null);
        this.toast.error(errorMessage(err));
      },
    });
  }

  onAdded(): void {
    this.adding.set(false);
    this.load();
  }
}
