import { Component, computed, inject, output, signal, viewChild } from '@angular/core';
import { Loader2, LucideAngularModule } from 'lucide-angular';
import { ToastService } from '../../../../core/toast/toast.service';
import { AssignableRole } from '../../models/admin.models';
import { AdminApiService } from '../../services/admin-api.service';
import { errorMessage } from '../../services/admin-format';
import { AdminDialog } from '../admin-dialog/admin-dialog';
import { DirectoryPicker, PickerOption } from '../directory-picker/directory-picker';
import { RoleFields, roleBody } from '../role-fields/role-fields';

/**
 * **Add mapping** on Roles & permissions (admin R67, ui.md 4.18.5): an
 * Entra ID group, a role and, for Data owner, a datasource. `201` toasts
 * "Mapping added", `200` "Mapping already exists" (info); both close the
 * dialog with `done` so the list reloads. A failure keeps it open.
 */
@Component({
  selector: 'app-add-mapping-dialog',
  imports: [AdminDialog, DirectoryPicker, LucideAngularModule, RoleFields],
  template: `
    <app-admin-dialog
      title="Add mapping"
      intro="Members of the group get the role from their next request."
      [busy]="running()"
      (dismiss)="cancel.emit()"
    >
      <div class="flex flex-col gap-4">
        <app-directory-picker
          label="Entra ID group"
          kind="group"
          placeholder="Search group name"
          (picked)="group.set($event)"
        />
        <app-role-fields [(role)]="role" [(datasourceId)]="datasourceId" />
      </div>
      <ng-container ngProjectAs="[dialogActions]">
        <button
          type="button"
          class="btn btn-outline"
          [disabled]="running()"
          (click)="cancel.emit()"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary"
          [disabled]="!canAdd()"
          (click)="add()"
        >
          @if (running()) {
            <lucide-angular [img]="Loader2" [size]="14" class="animate-spin" />
            <span>Adding…</span>
          } @else {
            <span>Add</span>
          }
        </button>
      </ng-container>
    </app-admin-dialog>
  `,
})
export class AddMappingDialog {
  readonly Loader2 = Loader2;

  private readonly api = inject(AdminApiService);
  private readonly toast = inject(ToastService);

  readonly cancel = output<void>();
  readonly done = output<void>();

  readonly group = signal<PickerOption | null>(null);
  readonly role = signal<AssignableRole | ''>('');
  readonly datasourceId = signal('');
  readonly running = signal(false);

  private readonly fields = viewChild.required(RoleFields);

  readonly canAdd = computed(
    () => !this.running() && this.group() !== null && this.fields().complete(),
  );

  add(): void {
    const group = this.group();
    const role = this.role();
    if (!group || role === '' || !this.canAdd()) return;
    this.running.set(true);
    this.api
      .addRoleMapping({ groupId: group.id, ...roleBody(role, this.datasourceId()) })
      .subscribe({
        next: (res) => {
          this.running.set(false);
          const message = res.body?.message ?? 'Mapping added';
          if (res.status === 201) this.toast.success(message);
          else this.toast.info(message);
          this.done.emit();
        },
        error: (err) => {
          this.running.set(false);
          this.toast.error(errorMessage(err));
        },
      });
  }
}
