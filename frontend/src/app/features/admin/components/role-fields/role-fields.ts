import { Component, OnInit, computed, inject, model, signal } from '@angular/core';
import { DatasourcesApiService } from '../../../datasources/services/datasources-api.service';
import {
  ASSIGNABLE_ROLES,
  AssignableRole,
  ROLE_LABELS,
} from '../../models/admin.models';

let nextId = 0;

/** A datasource as the Datasource select offers it. */
export interface DatasourceOption {
  id: string;
  name: string;
}

/**
 * The **Role** and **Datasource** selects of the Assign role and Add mapping
 * dialogs (ui.md 4.18.1): native selects labelled with `<label for>`. Role
 * offers Maker, Data owner, Approver and Platform admin; Datasource lists
 * the datasources by name and is enabled only for Data owner, where it is
 * required (admin R56, R67).
 */
@Component({
  selector: 'app-role-fields',
  template: `
    <div class="flex flex-col gap-4">
      <div>
        <label [for]="id + '-role'" class="field-label">Role</label>
        <select
          [id]="id + '-role'"
          class="field mt-1"
          (change)="onRole($any($event.target).value)"
        >
          <option value="">Choose a role</option>
          @for (option of roles; track option) {
            <option [value]="option" [selected]="role() === option">
              {{ labels[option] }}
            </option>
          }
        </select>
      </div>
      <div>
        <label [for]="id + '-datasource'" class="field-label">Datasource</label>
        <select
          [id]="id + '-datasource'"
          class="field mt-1"
          [disabled]="role() !== 'data-owner' || !datasources().length"
          [attr.aria-describedby]="id + '-datasource-hint'"
          (change)="datasourceId.set($any($event.target).value)"
        >
          <option value="" [selected]="!datasourceId()">
            {{ datasources().length ? 'Choose a datasource' : 'No datasources' }}
          </option>
          @for (option of datasources(); track option.id) {
            <option [value]="option.id" [selected]="datasourceId() === option.id">
              {{ option.name }}
            </option>
          }
        </select>
        <p [id]="id + '-datasource-hint'" class="mt-1 text-[12px] text-fg-muted">
          Only for Data owner.
        </p>
      </div>
    </div>
  `,
})
export class RoleFields implements OnInit {
  readonly roles = ASSIGNABLE_ROLES;
  readonly labels = ROLE_LABELS;

  private readonly datasourcesApi = inject(DatasourcesApiService);

  readonly role = model<AssignableRole | ''>('');
  readonly datasourceId = model('');

  readonly id = `admin-role-fields-${++nextId}`;
  readonly datasources = signal<DatasourceOption[]>([]);

  /** A role is chosen, and a datasource when it is Data owner. */
  readonly complete = computed(
    () =>
      this.role() !== '' &&
      (this.role() !== 'data-owner' || this.datasourceId() !== ''),
  );

  ngOnInit(): void {
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

  onRole(value: string): void {
    this.role.set(value as AssignableRole | '');
    if (value !== 'data-owner') this.datasourceId.set('');
  }
}

/** The body of an assignment or mapping request: `datasourceId` only for Data owner. */
export function roleBody(
  role: AssignableRole,
  datasourceId: string,
): { role: AssignableRole; datasourceId?: string } {
  return role === 'data-owner' ? { role, datasourceId } : { role };
}
